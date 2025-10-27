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
} from "@alien_org/solana-sso-sdk-core";
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

const STORAGE_KEY = 'alien-sso_';
export const AUTHED_ADDRESS_KEY = STORAGE_KEY + 'solana_authed_address';

type SolanaAuthState = {
  sessionAddress?: string | null;
};

type SolanaSsoContextValue = {
  client: AlienSolanaSsoClient;
  auth: SolanaAuthState;
  wallet: SolanaWalletAdapter;
  connectionAdapter: SolanaConnectionAdapter;
  queryClient: QueryClient;
  generateDeeplink: (
    solanaAddress: string
  ) => Promise<import("@alien_org/solana-sso-sdk-core").SolanaLinkResponse>;
  pollAuth: (pollingCode: string) => Promise<import("@alien_org/solana-sso-sdk-core").SolanaPollResponse>;
  getAttestation: (solanaAddress: string) => Promise<string | null>;
  verifyAttestation: (solanaAddress: string) => Promise<string | null>;
  logout: () => void;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
};

// Internal context with additional methods for modal
type SolanaSsoInternalContextValue = SolanaSsoContextValue & {
  setSessionAddress: (sessionAddress: string) => void;
};

const SolanaSsoContext = createContext<SolanaSsoContextValue | null>(null);
const SolanaSsoInternalContext = createContext<SolanaSsoInternalContextValue | null>(null);

// Create a single QueryClient instance for the Solana SSO provider
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

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

      if (sessionAddress) {
        // Save to cache on success
        localStorage.setItem(AUTHED_ADDRESS_KEY, solanaAddress);
        setAuth({ sessionAddress });
      } else {
        setAuth({ sessionAddress: null });
      }

      return sessionAddress;
    },
    [client]
  );

  const verifyAttestation = useCallback(
    async (solanaAddress: string) => {
      const cachedAddress = localStorage.getItem(AUTHED_ADDRESS_KEY);

      // Only verify if this address was previously authenticated
      if (cachedAddress !== solanaAddress) {
        return null;
      }

      const sessionAddress = await getAttestation(solanaAddress);

      if (!sessionAddress) {
        localStorage.removeItem(AUTHED_ADDRESS_KEY);
      }

      return sessionAddress;
    },
    [getAttestation]
  );

  const setSessionAddress = useCallback((sessionAddress: string) => {
    setAuth((prev) => ({ ...prev, sessionAddress }));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTHED_ADDRESS_KEY);
    setAuth({ sessionAddress: null });
  }, []);

  const openModal = useCallback(
    () => {
      setIsModalOpen(true);
    },
    []
  );

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
      verifyAttestation,
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
      verifyAttestation,
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
    <QueryClientProvider client={queryClient}>
      <SolanaSsoContext.Provider value={value}>
        <SolanaSsoInternalContext.Provider value={internalValue}>
          <SolanaSignInModal />
        </SolanaSsoInternalContext.Provider>
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

// Internal hook for modal only
export function useSolanaAuthInternal() {
  const ctx = useContext(SolanaSsoInternalContext);
  if (!ctx)
    throw new Error("useSolanaAuthInternal must be used within <AlienSolanaSsoProvider>");
  return ctx;
}
