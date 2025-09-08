"use client";
import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from "react";
import type { ReactNode } from "react";
import {
  AlienSsoSdkClient,
  type AlienSsoSdkClientConfig,
} from "@alien_org/sso-sdk-core";

type AuthState = {
  isAuthenticated: boolean;
  token?: string | null;
  tokenInfo?: ReturnType<AlienSsoSdkClient["getAuthData"]> | null;
  loading: boolean;
  error?: string | null;
  bootstrapped: boolean;
};

type SsoContextValue = {
  client: AlienSsoSdkClient;
  auth: AuthState;
  getAuthDeeplink: () => Promise<
    import("@alien_org/sso-sdk-core").AuthorizeResponse
  >;
  pollAuth: (pollingCode: string) => Promise<string | null>;
  exchangeToken: (authCode: string) => Promise<string | null>;
  verifyAuth: () => Promise<boolean>;
  logout: () => void;
};

const SsoContext = createContext<SsoContextValue | null>(null);

export function AlienSsoProvider({
  config,
  children,
}: {
  config: AlienSsoSdkClientConfig;
  children: ReactNode;
}) {
  const client = useMemo(() => new AlienSsoSdkClient(config), [config]);

  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    token: null,
    tokenInfo: null,
    loading: false,
    error: null,
    bootstrapped: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const token = client.getAccessToken();
      const tokenInfo = client.getAuthData();
      setAuth((s) => ({
        ...s,
        token,
        tokenInfo,
        isAuthenticated: Boolean(token && tokenInfo),
        bootstrapped: true,
      }));
    } catch (e: any) {
      setAuth((s) => ({
        ...s,
        error: e?.message ?? "Init error",
        bootstrapped: true,
      }));
    }
  }, [client]);

  const getAuthDeeplink = useCallback(async () => {
    setAuth((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await client.getAuthDeeplink();
      setAuth((s) => ({ ...s, loading: false }));
      return res;
    } catch (e: any) {
      setAuth((s) => ({
        ...s,
        loading: false,
        error: e?.message ?? "Authorize error",
      }));
      throw e;
    }
  }, [client]);

  const pollAuth = useCallback(
    async (pollingCode: string) => {
      setAuth((s) => ({ ...s, loading: true, error: null }));
      try {
        const code = await client.pollAuth(pollingCode);
        setAuth((s) => ({ ...s, loading: false }));
        return code;
      } catch (e: any) {
        setAuth((s) => ({
          ...s,
          loading: false,
          error: e?.message ?? "Poll error",
        }));
        throw e;
      }
    },
    [client],
  );

  const exchangeToken = useCallback(
    async (authCode: string) => {
      setAuth((s) => ({ ...s, loading: true, error: null }));
      try {
        const token = await client.exchangeToken(authCode);
        const tokenInfo = client.getAuthData();
        const isAuthenticated = Boolean(token && tokenInfo);
        setAuth({
          isAuthenticated,
          token,
          tokenInfo,
          loading: false,
          error: null,
          bootstrapped: true,
        });
        return token;
      } catch (e: any) {
        setAuth((s) => ({
          ...s,
          loading: false,
          error: e?.message ?? "Exchange error",
        }));
        throw e;
      }
    },
    [client],
  );

  const verifyAuth = useCallback(async () => {
    setAuth((s) => ({ ...s, loading: true, error: null }));
    try {
      const valid = await client.verifyAuth();
      const token = client.getAccessToken();
      const tokenInfo = client.getAuthData();
      setAuth((s) => ({
        ...s,
        isAuthenticated: valid,
        token,
        tokenInfo,
        loading: false,
        error: null,
      }));
      return valid;
    } catch (e: any) {
      setAuth((s) => ({
        ...s,
        isAuthenticated: false,
        token: null,
        tokenInfo: null,
        loading: false,
        error: e?.message ?? "Verify error",
      }));
      return false;
    }
  }, [client]);

  const logout = useCallback(() => {
    client.logout();
    setAuth({
      isAuthenticated: false,
      token: null,
      tokenInfo: null,
      loading: false,
      error: null,
      bootstrapped: true,
    });
  }, [client]);

  const value = useMemo<SsoContextValue>(
    () => ({
      client,
      auth,
      getAuthDeeplink,
      pollAuth,
      exchangeToken,
      verifyAuth,
      logout,
    }),
    [
      client,
      auth,
      getAuthDeeplink,
      pollAuth,
      exchangeToken,
      verifyAuth,
      logout,
    ],
  );

  return <SsoContext.Provider value={value}>{children}</SsoContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(SsoContext);
  if (!ctx) throw new Error("useSso must be used within <SsoProvider>");
  return ctx;
}
