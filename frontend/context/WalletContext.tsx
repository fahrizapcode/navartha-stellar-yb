'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit';
import { FreighterModule, FREIGHTER_ID } from '@creit.tech/stellar-wallets-kit/modules/freighter';

interface WalletContextType {
  kit: any;
  publicKey: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

let isInitialized = false;

function initWalletKit() {
  if (!isInitialized) {
    StellarWalletsKit.init({
      network: Networks.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
    isInitialized = true;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initWalletKit();
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setIsConnecting(true);
    initWalletKit();
    try {
      const { address } = await StellarWalletsKit.authModal();
      setPublicKey(address);
    } catch (e: any) {
      if (e?.message?.includes('User declined')) {
        setError('Koneksi wallet ditolak oleh pengguna.');
      } else if (e?.message?.includes('not installed')) {
        setError('Freighter Wallet tidak terdeteksi. Silakan install terlebih dahulu.');
      } else {
        setError(e?.message || 'Gagal menghubungkan wallet.');
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setError(null);
    StellarWalletsKit.disconnect().catch(console.error);
  }, []);

  return (
    <WalletContext.Provider
      value={{ kit: StellarWalletsKit, publicKey, isConnected: !!publicKey, isConnecting, error, connect, disconnect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
