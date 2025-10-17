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
  AlienSsoClient,
  type AlienSsoClientConfig,
} from "@alien_org/sso-sdk-core";
import { SignInModal } from "../components";

type AuthState = {
  isAuthenticated: boolean;
  token?: string | null;
  tokenInfo?: ReturnType<AlienSsoClient["getAuthData"]> | null;
  loading: boolean;
  error?: string | null;
};

type SsoContextValue = {
  client: AlienSsoClient;
  auth: AuthState;
  getAuthDeeplink: () => Promise<
    import("@alien_org/sso-sdk-core").AuthorizeResponse
  >;
  pollAuth: (pollingCode: string) => Promise<import("@alien_org/sso-sdk-core").PollResponse>;
  startPollingLoop: (
    pollingCode: string,
    callbacks: {
      onAuthorized: (authorizationCode: string) => void | Promise<void>;
      onRejected?: () => void | Promise<void>;
      onError?: (error: Error) => void | Promise<void>;
    }
  ) => Promise<() => void>;
  exchangeToken: (authCode: string) => Promise<string>;
  verifyAuth: () => Promise<boolean>;
  logout: () => void;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
};

const SsoContext = createContext<SsoContextValue | null>(null);

function getInitialAuth(client: AlienSsoClient): AuthState {
  try {
    const token = client.getAccessToken();
    const tokenInfo = client.getAuthData();
    return {
      isAuthenticated: Boolean(token && tokenInfo),
      token,
      tokenInfo,
      loading: false,
      error: null,
    };
  } catch (e: any) {
    return {
      isAuthenticated: false,
      token: null,
      tokenInfo: null,
      loading: false,
      error: e?.message ?? "Init error",
    };
  }
}

export function AlienSsoProvider({
  config,
  children,
}: {
  config: AlienSsoClientConfig;
  children: ReactNode;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const client = useMemo(() => new AlienSsoClient(config), [config]);
  const [auth, setAuth] = useState<AuthState>(() => getInitialAuth(client));

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
        const data = await client.pollAuth(pollingCode);
        setAuth((s) => ({ ...s, loading: false }));
        return data;
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

  const startPollingLoop = useCallback(
    async (
      pollingCode: string,
      callbacks: {
        onAuthorized: (authorizationCode: string) => void | Promise<void>;
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

          if (result.status === 'authorized' && result.authorization_code) {
            isActive = false;
            if (intervalId) clearInterval(intervalId);
            await callbacks.onAuthorized(result.authorization_code);
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

  const verifyAuth = useCallback(
    async () => {
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
    },
    [client],
  );

  const logout = useCallback(() => {
    client.logout();
    setAuth({
      isAuthenticated: false,
      token: null,
      tokenInfo: null,
      loading: false,
      error: null,
    });
  }, [client]);


  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  const value = useMemo<SsoContextValue>(
    () => ({
      client,
      auth,
      getAuthDeeplink,
      pollAuth,
      startPollingLoop,
      exchangeToken,
      verifyAuth,
      logout,
      openModal,
      closeModal,
      isModalOpen
    }),
    [
      client,
      auth,
      getAuthDeeplink,
      pollAuth,
      startPollingLoop,
      exchangeToken,
      verifyAuth,
      logout,
      openModal,
      closeModal,
      isModalOpen
    ],
  );

  return (
    <SsoContext.Provider value={value}>
      {children}
      <SignInModal />
    </SsoContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(SsoContext);
  if (!ctx) throw new Error("useSso must be used within <SsoProvider>");
  return ctx;
}
