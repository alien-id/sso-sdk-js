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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SolanaSignInModal } from "../components";
import type { PublicKey, Transaction, VersionedTransaction, Connection } from "@solana/web3.js";

export interface SolanaWalletAdapter {
  publicKey: PublicKey | null;
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
}

export interface SolanaConnectionAdapter {
  connection: Connection;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

type SolanaAuthState = {
  sessionAddress?: string | null;
  solanaAddress?: string | null;
};

type SolanaSsoContextValue = {
  client: AlienSolanaSsoClient;
  auth: SolanaAuthState;
  wallet: SolanaWalletAdapter;
  connectionAdapter: SolanaConnectionAdapter;
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

const SolanaSsoContext = createContext<SolanaSsoContextValue | null>(null);

export function AlienSolanaSsoProvider({
  config,
  wallet,
  connectionAdapter,
  children,
}: {
  config: AlienSolanaSsoClientConfig;
  wallet: SolanaWalletAdapter;
  connectionAdapter: SolanaConnectionAdapter;
  children: ReactNode;
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
      generateDeeplink,
      pollAuth,
      getAttestation,
      logout,
      openModal,
      closeModal,
      isModalOpen
    ]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SolanaSsoContext.Provider value={value}>
        <SolanaSignInModal />
        {children}
      </SolanaSsoContext.Provider>
    </QueryClientProvider>
  );
}

export function useSolanaAuth() {
  const ctx = useContext(SolanaSsoContext);
  if (!ctx)
    throw new Error("useSolanaAuth must be used within <AlienSolanaSsoProvider>");
  return ctx;
}
