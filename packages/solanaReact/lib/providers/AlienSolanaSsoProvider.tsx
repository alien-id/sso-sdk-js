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
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

export interface SolanaWalletAdapter {
  publicKey: PublicKey | null;
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
}

export interface SolanaConnectionAdapter {
  connection: Connection;
}

const STORAGE_KEY = 'alien-sso_';
export const AUTHED_ADDRESS_KEY = STORAGE_KEY + 'solana_authed_address';
export const SESSION_ADDRESS_KEY = STORAGE_KEY + 'session_address';
export const ATTESTATION_CREATED_AT_KEY = STORAGE_KEY + 'attestation_created_at';
const GRACE_PERIOD_MS = 60000; // 60 seconds grace period for RPC indexing

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
  children,
}: {
  config: AlienSolanaSsoClientConfig;
  children: ReactNode;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const wallet = useWallet();
  const connectionAdapter = useConnection();

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

  const verifyAttestation = useCallback(
    async (solanaAddress: string) => {
      const cachedAddress = localStorage.getItem(AUTHED_ADDRESS_KEY);
      const cachedSessionAddress = localStorage.getItem(SESSION_ADDRESS_KEY);
      const createdAt = localStorage.getItem(ATTESTATION_CREATED_AT_KEY);

      // Only verify if this address was previously authenticated
      if (cachedAddress !== solanaAddress) {
        return null;
      }

      // If attestation was created recently, return cached session address without verification
      if (cachedSessionAddress && createdAt) {
        const timeSinceCreation = Date.now() - parseInt(createdAt, 10);

        if (timeSinceCreation < GRACE_PERIOD_MS) {
          // Within grace period - trust cached value, set auth state immediately
          setAuth({ sessionAddress: cachedSessionAddress });

          // Verify in background after grace period expires
          setTimeout(async () => {
            const verifiedSessionAddress = await client.getAttestation(solanaAddress);
            if (!verifiedSessionAddress) {
              logout();
            }
          }, GRACE_PERIOD_MS - timeSinceCreation);

          return cachedSessionAddress;
        } else {
          localStorage.removeItem(SESSION_ADDRESS_KEY);
          localStorage.removeItem(ATTESTATION_CREATED_AT_KEY);
        }
      }

      // Outside grace period or no cache - verify normally
      const sessionAddress = await client.getAttestation(solanaAddress);

      if (!sessionAddress) {
        logout();
      }

      setAuth({ sessionAddress });
      return sessionAddress;
    },
    [client]
  );

  const setSessionAddress = useCallback((sessionAddress: string) => {
    setAuth((prev) => ({ ...prev, sessionAddress }));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTHED_ADDRESS_KEY);
    localStorage.removeItem(SESSION_ADDRESS_KEY);
    localStorage.removeItem(ATTESTATION_CREATED_AT_KEY);
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
