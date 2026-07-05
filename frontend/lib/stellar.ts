import * as StellarSdk from '@stellar/stellar-sdk';
import { Brand, ActivityEvent } from '@/types';

export const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';

// Replace this with actual contract ID after deployment
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || 'PLACEHOLDER_CONTRACT_ID';

export const rpcServer = new StellarSdk.rpc.Server(RPC_URL);
export const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);

/**
 * Parse a Soroban ScVal map into a Brand object
 */
function parseScValToBrand(scVal: StellarSdk.xdr.ScVal): Brand | null {
  try {
    const map = scVal.map();
    if (!map) return null;

    let name = '';
    let owner = '';
    let timestamp = 0;

    for (const entry of map) {
      const key = entry.key().sym()?.toString();
      const val = entry.val();
      if (key === 'name') name = StellarSdk.scValToNative(val) as string;
      if (key === 'owner') owner = StellarSdk.Address.fromScVal(val).toString();
      if (key === 'timestamp') timestamp = Number(StellarSdk.scValToNative(val));
    }

    return { name, owner, timestamp };
  } catch {
    return null;
  }
}

/**
 * Fetch all registered brands from the contract
 */
export async function fetchAllBrands(): Promise<Brand[]> {
  if (CONTRACT_ID === 'PLACEHOLDER_CONTRACT_ID') return [];

  try {
    const contract = new StellarSdk.Contract(CONTRACT_ID);
    const account = new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), '0');

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call('get_all_brands'))
      .setTimeout(30)
      .build();

    const sim = await rpcServer.simulateTransaction(tx);
    if (!StellarSdk.rpc.Api.isSimulationSuccess(sim)) return [];

    const resultVal = (sim as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    if (!resultVal) return [];

    const vec = resultVal.vec();
    if (!vec) return [];

    return vec.map(parseScValToBrand).filter(Boolean) as Brand[];
  } catch (e) {
    console.error('Failed to fetch brands:', e);
    return [];
  }
}

/**
 * Build and return the assembled + signed XDR for register_brand
 */
export async function buildRegisterBrandTx(
  ownerPublicKey: string,
  brandName: string
): Promise<StellarSdk.Transaction> {
  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const account = await rpcServer.getAccount(ownerPublicKey);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'register_brand',
        StellarSdk.nativeToScVal(ownerPublicKey, { type: 'address' }),
        StellarSdk.nativeToScVal(brandName, { type: 'string' })
      )
    )
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);
  if (!StellarSdk.rpc.Api.isSimulationSuccess(simResult)) {
    throw new Error('Simulation failed: ' + JSON.stringify(simResult));
  }

  return StellarSdk.rpc.assembleTransaction(tx, simResult).build();
}

/**
 * Submit a signed XDR to the network
 */
export async function submitTransaction(signedXdr: string): Promise<string> {
  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await rpcServer.sendTransaction(tx);

  if (sendResult.status === 'ERROR') {
    throw new Error('Submit failed: ' + sendResult.errorResult);
  }

  // Poll until confirmed
  let getResult = await rpcServer.getTransaction(sendResult.hash);
  let attempts = 0;
  while (
    getResult.status === StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < 15
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await rpcServer.getTransaction(sendResult.hash);
    attempts++;
  }

  if (getResult.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error('Transaction failed on-chain');
  }

  return sendResult.hash;
}

/**
 * Poll for BrandRegistered events from contract
 */
export async function fetchBrandEvents(startLedger: number): Promise<ActivityEvent[]> {
  if (CONTRACT_ID === 'PLACEHOLDER_CONTRACT_ID') return [];

  try {
    const events = await rpcServer.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACT_ID],
          topics: [['*', '*']],
        },
      ],
      limit: 20,
    });

    return events.events
      .filter((e) => {
        const topic0 = e.topic[0];
        return topic0 && StellarSdk.scValToNative(topic0) === 'BrandRegistered';
      })
      .map((e, i) => {
        const val = e.value;
        const map = val?.map?.() || [];
        let brandName = '';
        let owner = '';
        let timestamp = 0;

        try {
          for (const entry of map) {
            const key = entry.key().sym()?.toString();
            if (key === 'name') brandName = StellarSdk.scValToNative(entry.val()) as string;
            if (key === 'owner') owner = StellarSdk.Address.fromScVal(entry.val()).toString();
            if (key === 'timestamp') timestamp = Number(StellarSdk.scValToNative(entry.val()));
          }
        } catch {
          brandName = 'Unknown';
        }

        return {
          id: `${e.txHash}-${i}`,
          brandName,
          owner,
          timestamp,
          txHash: e.txHash,
        };
      });
  } catch (e) {
    console.error('Failed to fetch events:', e);
    return [];
  }
}
