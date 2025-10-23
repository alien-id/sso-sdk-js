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
import type { QueryClient } from "@tanstack/react-query";
import { SignInModal } from "../components";

type AuthState = {
  isAuthenticated: boolean;
  token?: string | null;
  tokenInfo?: ReturnType<AlienSsoClient["getAuthData"]> | null;
};

type SsoContextValue = {
  client: AlienSsoClient;
  auth: AuthState;
  queryClient: QueryClient;
  generateDeeplink: () => Promise<
    import("@alien_org/sso-sdk-core").AuthorizeResponse
  >;
  pollAuth: (pollingCode: string) => Promise<import("@alien_org/sso-sdk-core").PollResponse>;
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
    };
  } catch {
    return {
      isAuthenticated: false,
      token: null,
      tokenInfo: null,
    };
  }
}

export function AlienSsoProvider({
  config,
  children,
  queryClient,
}: {
  config: AlienSsoClientConfig;
  children: ReactNode;
  queryClient: QueryClient;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const client = useMemo(() => new AlienSsoClient(config), [config]);
  const [auth, setAuth] = useState<AuthState>(() => getInitialAuth(client));

  const generateDeeplink = useCallback(async () => {
    return await client.generateDeeplink();
  }, [client]);

  const pollAuth = useCallback(
    async (pollingCode: string) => {
      return await client.pollAuth(pollingCode);
    },
    [client],
  );

  const exchangeToken = useCallback(
    async (authCode: string) => {
      const token = await client.exchangeToken(authCode);
      const tokenInfo = client.getAuthData();
      const isAuthenticated = Boolean(token && tokenInfo);
      setAuth({
        isAuthenticated,
        token,
        tokenInfo,
      });
      return token;
    },
    [client],
  );

  const verifyAuth = useCallback(
    async () => {
      try {
        const valid = await client.verifyAuth();
        const token = client.getAccessToken();
        const tokenInfo = client.getAuthData();
        setAuth({
          isAuthenticated: valid,
          token,
          tokenInfo,
        });
        return valid;
      } catch {
        setAuth({
          isAuthenticated: false,
          token: null,
          tokenInfo: null,
        });
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
    });
  }, [client]);


  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  const value = useMemo<SsoContextValue>(
    () => ({
      client,
      auth,
      queryClient,
      generateDeeplink,
      pollAuth,
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
      queryClient,
      generateDeeplink,
      pollAuth,
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
