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
import type { Transaction } from "@solana/web3.js";

type SolanaAuthState = {
  sessionAddress?: string | null;
  loading: boolean;
  error?: string | null;
};

type SolanaSsoContextValue = {
  client: AlienSolanaSsoClient;
  auth: SolanaAuthState;
  generateLinkDeeplink: (
    solanaAddress: string
  ) => Promise<import("@alien_org/sso-sdk-core").SolanaLinkResponse>;
  pollAuth: (pollingCode: string) => Promise<Transaction>;
  getAttestation: (solanaAddress: string) => Promise<string>;
};

const SolanaSsoContext = createContext<SolanaSsoContextValue | null>(null);

export function AlienSolanaSsoProvider({
  config,
  children,
}: {
  config: AlienSolanaSsoClientConfig;
  children: ReactNode;
}) {
  const client = useMemo(
    () => new AlienSolanaSsoClient(config),
    [config]
  );
  const [auth, setAuth] = useState<SolanaAuthState>({
    sessionAddress: null,
    loading: false,
    error: null,
  });

  const generateLinkDeeplink = useCallback(
    async (solanaAddress: string) => {
      setAuth((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await client.generateLinkDeeplink(solanaAddress);
        setAuth((s) => ({ ...s, loading: false }));
        return res;
      } catch (e: any) {
        setAuth((s) => ({
          ...s,
          loading: false,
          error: e?.message ?? "Generate link error",
        }));
        throw e;
      }
    },
    [client]
  );

  const pollAuth = useCallback(
    async (pollingCode: string) => {
      setAuth((s) => ({ ...s, loading: true, error: null }));
      try {
        const transaction = await client.pollAuth(pollingCode);
        setAuth((s) => ({ ...s, loading: false }));
        return transaction;
      } catch (e: any) {
        setAuth((s) => ({
          ...s,
          loading: false,
          error: e?.message ?? "Poll error",
        }));
        throw e;
      }
    },
    [client]
  );

  const getAttestation = useCallback(
    async (solanaAddress: string) => {
      setAuth((s) => ({ ...s, loading: true, error: null }));
      try {
        const sessionAddress = await client.getAttestation(solanaAddress);
        setAuth({
          sessionAddress,
          loading: false,
          error: null,
        });
        return sessionAddress;
      } catch (e: any) {
        setAuth((s) => ({
          ...s,
          sessionAddress: null,
          loading: false,
          error: e?.message ?? "Get attestation error",
        }));
        throw e;
      }
    },
    [client]
  );

  const value = useMemo<SolanaSsoContextValue>(
    () => ({
      client,
      auth,
      generateLinkDeeplink,
      pollAuth,
      getAttestation,
    }),
    [client, auth, generateLinkDeeplink, pollAuth, getAttestation]
  );

  return (
    <SolanaSsoContext.Provider value={value}>
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
