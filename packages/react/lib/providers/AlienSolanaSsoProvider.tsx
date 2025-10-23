"use client";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import {
  AlienSolanaSsoClient,
  type AlienSolanaSsoClientConfig,
} from "@alien_org/sso-sdk-core";
import type { QueryClient } from "@tanstack/react-query";
import { SolanaSignInModal } from "../components";
import type { PublicKey, Transaction, VersionedTransaction, Connection } from "@solana/web3.js";

export interface SolanaWalletAdapter {
  publicKey: PublicKey | null;
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
}

export interface SolanaConnectionAdapter {
  connection: Connection;
}

type SolanaAuthState = {
  sessionAddress?: string | null;
  solanaAddress?: string | null;
};

type SolanaSsoContextValue = {
  client: AlienSolanaSsoClient;
  auth: SolanaAuthState;
  wallet: SolanaWalletAdapter;
  connectionAdapter: SolanaConnectionAdapter;
  queryClient: QueryClient;
  generateDeeplink: (
    solanaAddress: string
  ) => Promise<import("@alien_org/sso-sdk-core").SolanaLinkResponse>;
  pollAuth: (pollingCode: string) => Promise<import("@alien_org/sso-sdk-core").SolanaPollResponse>;
  getAttestation: (solanaAddress: string) => Promise<string | null>;
  logout: () => void;
  openModal: (solanaAddress: string) => void;
  closeModal: () => void;
  isModalOpen: boolean;
};

// Internal context with additional methods for modal
type SolanaSsoInternalContextValue = SolanaSsoContextValue & {
  setSessionAddress: (sessionAddress: string) => void;
};

const SolanaSsoContext = createContext<SolanaSsoContextValue | null>(null);
const SolanaSsoInternalContext = createContext<SolanaSsoInternalContextValue | null>(null);

export function AlienSolanaSsoProvider({
  config,
  wallet,
  connectionAdapter,
  children,
  queryClient,
}: {
  config: AlienSolanaSsoClientConfig;
  wallet: SolanaWalletAdapter;
  connectionAdapter: SolanaConnectionAdapter;
  children: ReactNode;
  queryClient: QueryClient;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const client = useMemo(
    () => new AlienSolanaSsoClient(config),
    [config]
  );
  const [auth, setAuth] = useState<SolanaAuthState>({
    sessionAddress: null,
    solanaAddress: null,
  });

  const generateDeeplink = useCallback(
    async (solanaAddress: string) => {
      return await client.generateDeeplink(solanaAddress);
    },
    [client]
  );

  const pollAuth = useCallback(
    async (pollingCode: string) => {
      return await client.pollAuth(pollingCode);
    },
    [client]
  );

  const getAttestation = useCallback(
    async (solanaAddress: string) => {
      const sessionAddress = await client.getAttestation(solanaAddress);
      setAuth((prev) => ({ ...prev, sessionAddress }));
      return sessionAddress;
    },
    [client]
  );

  const setSessionAddress = useCallback((sessionAddress: string) => {
    setAuth((prev) => ({ ...prev, sessionAddress }));
  }, []);

  const logout = useCallback(() => {
    setAuth({ sessionAddress: null, solanaAddress: null });
  }, []);

  const openModal = useCallback((solanaAddress: string) => {
    setAuth((prev) => ({ ...prev, solanaAddress }));
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const value = useMemo<SolanaSsoContextValue>(
    () => ({
      client,
      auth,
      wallet,
      connectionAdapter,
      queryClient,
      generateDeeplink,
      pollAuth,
      getAttestation,
      logout,
      openModal,
      closeModal,
      isModalOpen
    }),
    [
      client,
      auth,
      wallet,
      connectionAdapter,
      queryClient,
      generateDeeplink,
      pollAuth,
      getAttestation,
      logout,
      openModal,
      closeModal,
      isModalOpen
    ]
  );

  const internalValue = useMemo<SolanaSsoInternalContextValue>(
    () => ({
      ...value,
      setSessionAddress,
    }),
    [value, setSessionAddress]
  );

  return (
    <SolanaSsoContext.Provider value={value}>
      <SolanaSsoInternalContext.Provider value={internalValue}>
        <SolanaSignInModal />
      </SolanaSsoInternalContext.Provider>
      {children}
    </SolanaSsoContext.Provider>
  );
}

export function useSolanaAuth() {
  const ctx = useContext(SolanaSsoContext);
  if (!ctx)
    throw new Error("useSolanaAuth must be used within <AlienSolanaSsoProvider>");
  return ctx;
}

// Internal hook for modal only
export function useSolanaAuthInternal() {
  const ctx = useContext(SolanaSsoInternalContext);
  if (!ctx)
    throw new Error("useSolanaAuthInternal must be used within <AlienSolanaSsoProvider>");
  return ctx;
}
