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
import { PublicKey, type Transaction } from "@solana/web3.js";

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
  pollAuth: (pollingCode: string) => Promise<import("@alien_org/sso-sdk-core").SolanaPollResponse>;
  startPollingLoop: (
    pollingCode: string,
    callbacks: {
      onAuthorized: (transaction: Transaction) => void | Promise<void>;
      onRejected?: () => void | Promise<void>;
      onError?: (error: Error) => void | Promise<void>;
    }
  ) => Promise<() => void>;
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
        const pollResponse = await client.pollAuth(pollingCode);
        setAuth((s) => ({ ...s, loading: false }));
        return pollResponse;
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

  const startPollingLoop = useCallback(
    async (
      pollingCode: string,
      callbacks: {
        onAuthorized: (transaction: Transaction) => void | Promise<void>;
        onRejected?: () => void | Promise<void>;
        onError?: (error: Error) => void | Promise<void>;
      }
    ): Promise<() => void> => {
      let intervalId: ReturnType<typeof setInterval> | null = null;
      let isActive = true;

      const poll = async () => {
        if (!isActive) return;

        try {
          const result = await client.pollAuth(pollingCode);

          if (result.status === 'authorized') {
            isActive = false;
            if (intervalId) clearInterval(intervalId);

            const transaction = client.buildCreateAttestationTransaction({
              payerPublicKey: new PublicKey(result.solana_address!),
              sessionAddress: result.session_address!,
              oracleSignature: Buffer.from(result.oracle_signature!, 'hex'),
              oraclePublicKey: new PublicKey(result.oracle_public_key!),
              timestamp: result.timestamp!,
              expiry: 0,
            });
            await callbacks.onAuthorized(transaction);
          } else if (result.status === 'rejected') {
            isActive = false;
            if (intervalId) clearInterval(intervalId);
            await callbacks.onRejected?.();
          }
        } catch (error) {
          await callbacks.onError?.(error as Error);
        }
      };

      poll();
      intervalId = setInterval(poll, client.pollingInterval);

      return () => {
        isActive = false;
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };
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
      startPollingLoop,
      getAttestation,
    }),
    [client, auth, generateLinkDeeplink, pollAuth, startPollingLoop, getAttestation]
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
