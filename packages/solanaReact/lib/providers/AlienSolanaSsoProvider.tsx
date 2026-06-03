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
  // Used to sign the on-chain create-attestation transaction during the L0 bind
  // ceremony. Provided by @solana/wallet-adapter-react's useWallet().
  signTransaction?: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
}

export interface SolanaConnectionAdapter {
  connection: Connection;
}

type SolanaSsoContextValue = {
  client: AlienSolanaSsoClient;
  wallet: SolanaWalletAdapter;
  connectionAdapter: SolanaConnectionAdapter;
  queryClient: QueryClient;
  generateDeeplink: (
    solanaAddress: string
  ) => Promise<import("@alien-id/sso-solana").SolanaLinkResponse>;
  pollAuth: (pollingCode: string) => Promise<import("@alien-id/sso-solana").SolanaPollResponse>;
  verifyAttestation: (solanaAddress: string) => Promise<string | null>;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
};

const SolanaSsoContext = createContext<SolanaSsoContextValue | null>(null);

// Create a single QueryClient instance for the Solana SSO provider
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Provider for the Alien Solana SSO **enrollment + lookup** primitive.
 *
 * This is NOT an auth system: it never establishes a session and holds no
 * "signed in" state. It exposes the two things only Alien can provide — the L0
 * bind ceremony (via the sign-in modal) and the L1 `verifyAttestation` lookup —
 * and leaves proof-of-possession, sessions, and tokens to the integrator's
 * backend (or the regular OIDC SSO). See ADR-0002 and docs/solana-integration.md.
 */
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

  /**
   * Reports the historical wallet→identity binding for `solanaAddress`, i.e.
   * the session address (the owner Alien ID) recorded on-chain, or `null` if
   * none exists.
   *
   * Binding-info ONLY (L1 lookup). This proves the wallet was once linked; it
   * proves NEITHER current possession of the wallet's private key NOR a live
   * session, so it never authenticates — that is the F-06 bug. To authenticate
   * a returning wallet, your backend must verify a fresh proof-of-possession
   * (`buildPopMessage` + `verifyPopSignature` from `@alien-id/sso-solana`) and
   * then mint its own session. Do not pass an address sourced from anything
   * other than the connected wallet adapter (e.g. a URL/form/API value) and
   * expect it to mean the user controls that wallet.
   */
  const verifyAttestation = useCallback(
    async (solanaAddress: string) => {
      return await client.getAttestation(solanaAddress);
    },
    [client]
  );

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
      wallet,
      connectionAdapter,
      queryClient,
      generateDeeplink,
      pollAuth,
      verifyAttestation,
      openModal,
      closeModal,
      isModalOpen
    }),
    [
      client,
      wallet,
      connectionAdapter,
      queryClient,
      generateDeeplink,
      pollAuth,
      verifyAttestation,
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
