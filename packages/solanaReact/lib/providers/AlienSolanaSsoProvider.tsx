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
} from "@alien-id/sso-solana";
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
const GRACE_PERIOD_MS = 60000; // 60 seconds grace period for RPC indexing

// Namespace cache keys by (providerAddress, ssoBaseUrl) so a freshly created
// session for one provider/environment cannot be replayed within the
// grace-period window by a different provider mounted in the same origin.
// The suffix is a short URL-safe digest of the two fields.
function namespaceSuffix(providerAddress: string, ssoBaseUrl: string): string {
  const input = `${providerAddress}|${ssoBaseUrl}`;
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

export function getSolanaAuthedAddressKey(providerAddress: string, ssoBaseUrl: string): string {
  return `${STORAGE_KEY}solana_authed_address_${namespaceSuffix(providerAddress, ssoBaseUrl)}`;
}
export function getSessionAddressKey(providerAddress: string, ssoBaseUrl: string): string {
  return `${STORAGE_KEY}session_address_${namespaceSuffix(providerAddress, ssoBaseUrl)}`;
}
export function getAttestationCreatedAtKey(providerAddress: string, ssoBaseUrl: string): string {
  return `${STORAGE_KEY}attestation_created_at_${namespaceSuffix(providerAddress, ssoBaseUrl)}`;
}

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
  ) => Promise<import("@alien-id/sso-solana").SolanaLinkResponse>;
  pollAuth: (pollingCode: string) => Promise<import("@alien-id/sso-solana").SolanaPollResponse>;
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

  const authedAddressKey = useMemo(
    () => getSolanaAuthedAddressKey(client.providerAddress, client.ssoBaseUrl),
    [client]
  );
  const sessionAddressKey = useMemo(
    () => getSessionAddressKey(client.providerAddress, client.ssoBaseUrl),
    [client]
  );
  const attestationCreatedAtKey = useMemo(
    () => getAttestationCreatedAtKey(client.providerAddress, client.ssoBaseUrl),
    [client]
  );

  const verifyAttestation = useCallback(
    async (solanaAddress: string) => {
      const cachedAddress = localStorage.getItem(authedAddressKey);
      const cachedSessionAddress = localStorage.getItem(sessionAddressKey);
      const createdAt = localStorage.getItem(attestationCreatedAtKey);

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
          localStorage.removeItem(sessionAddressKey);
          localStorage.removeItem(attestationCreatedAtKey);
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
    [client, authedAddressKey, sessionAddressKey, attestationCreatedAtKey]
  );

  const setSessionAddress = useCallback((sessionAddress: string) => {
    setAuth((prev) => ({ ...prev, sessionAddress }));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(authedAddressKey);
    localStorage.removeItem(sessionAddressKey);
    localStorage.removeItem(attestationCreatedAtKey);
    setAuth({ sessionAddress: null });
  }, [authedAddressKey, sessionAddressKey, attestationCreatedAtKey]);

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
