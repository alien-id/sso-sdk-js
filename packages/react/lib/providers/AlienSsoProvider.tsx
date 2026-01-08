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
  type TokenResponse,
} from "@alien_org/sso-sdk-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  exchangeToken: (authCode: string) => Promise<TokenResponse>;
  verifyAuth: () => Promise<boolean>;
  refreshToken: () => Promise<string | null>;
  logout: () => void;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
};

const SsoContext = createContext<SsoContextValue | null>(null);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

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
}: {
  config: AlienSsoClientConfig;
  children: ReactNode;
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
      const tokenResponse = await client.exchangeToken(authCode);
      const tokenInfo = client.getAuthData();
      const isAuthenticated = Boolean(tokenResponse.access_token && tokenInfo);
      setAuth({
        isAuthenticated,
        token: tokenResponse.access_token,
        tokenInfo,
      });
      return tokenResponse;
    },
    [client],
  );

  const verifyAuth = useCallback(
    async () => {
      const userInfo = await client.verifyAuth();
      const valid = userInfo !== null;
      const token = client.getAccessToken();
      const tokenInfo = client.getAuthData();
      setAuth({
        isAuthenticated: valid,
        token,
        tokenInfo,
      });
      return valid;
    },
    [client],
  );

  const refreshToken = useCallback(
    async (): Promise<string | null> => {
      try {
        const tokenResponse = await client.refreshAccessToken();
        const tokenInfo = client.getAuthData();
        const isAuthenticated = Boolean(tokenResponse.access_token && tokenInfo);
        setAuth({
          isAuthenticated,
          token: tokenResponse.access_token,
          tokenInfo,
        });
        return tokenResponse.access_token;
      } catch {
        // Refresh failed, client.refreshAccessToken already calls logout
        setAuth({
          isAuthenticated: false,
          token: null,
          tokenInfo: null,
        });
        return null;
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
      refreshToken,
      logout,
      openModal,
      closeModal,
      isModalOpen
    }),
    [
      client,
      auth,
      generateDeeplink,
      pollAuth,
      exchangeToken,
      verifyAuth,
      refreshToken,
      logout,
      openModal,
      closeModal,
      isModalOpen
    ],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SsoContext.Provider value={value}>
        {children}
        <SignInModal />
      </SsoContext.Provider>
    </QueryClientProvider>
  );
}

export function useAuth() {
  const ctx = useContext(SsoContext);
  if (!ctx) throw new Error("useSso must be used within <SsoProvider>");
  return ctx;
}
