'use client';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import {
  AlienSsoClient,
  type AlienSsoClientConfig,
  type TokenResponse,
} from '@alien-id/sso';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SignInModal } from '../components';

export type AgentIdConfig = {
  enabled: boolean;
  skillUrl?: string;
};

export type AlienSsoProviderConfig = AlienSsoClientConfig & {
  agentId?: AgentIdConfig;
};

type AuthState = {
  isAuthenticated: boolean;
  /**
   * The current access token in render state. Convenient for callers
   * that read `auth.token` to set an `Authorization` header. For
   * callers that want a fresh pull on each request (no render-state
   * cache), use `getAccessToken()` off the context — it reads from
   * storage on every call. The two are always in sync.
   */
  token?: string | null;
  tokenInfo?: ReturnType<AlienSsoClient['getAuthData']> | null;
};

type SsoContextValue = {
  /**
   * The underlying `AlienSsoClient` instance. Exposed for callers that
   * need methods beyond the convenience helpers on this context
   * (e.g. `client.pollingInterval`, `client.getRefreshToken()`).
   * v1-compatible — pre-RFC-9449 consumers reached for the client
   * directly, and there's no benefit in hiding it now that DPoP and
   * cnf.jkt are wired in.
   */
  client: AlienSsoClient;
  auth: AuthState;
  queryClient: QueryClient;
  generateDeeplink: () => Promise<import('@alien-id/sso').AuthorizeResponse>;
  pollAuth: (
    pollingCode: string,
  ) => Promise<import('@alien-id/sso').PollResponse>;
  exchangeToken: (authCode: string) => Promise<TokenResponse>;
  verifyAuth: () => Promise<boolean>;
  refreshToken: () => Promise<string | null>;
  logout: () => void;
  /**
   * Pull the current access_token on demand from storage. Returns null
   * when no session exists. Equivalent to reading `auth.token` from
   * render state — `getAccessToken()` is the no-cache, no-render-state
   * variant for callers that prefer pulling at call time.
   */
  getAccessToken: () => string | null;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
  /**
   * Polling interval (ms) for the modal's authorization-code wait
   * loop. Same value as `client.pollingInterval`; exposed at the top
   * level for downstream UI that doesn't want to reach through the
   * client ref.
   */
  pollingInterval: number;
  agentIdEnabled: boolean;
  agentIdSkillUrl?: string;
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
  config: AlienSsoProviderConfig;
  children: ReactNode;
}) {
  const agentIdEnabled = config.agentId?.enabled ?? false;
  const agentIdSkillUrl = config.agentId?.skillUrl ?? '/ALIEN-SKILL.md';
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

  const verifyAuth = useCallback(async () => {
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
  }, [client]);

  const refreshToken = useCallback(async (): Promise<string | null> => {
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
  }, [client]);

  const logout = useCallback(() => {
    client.logout();
    setAuth({
      isAuthenticated: false,
      token: null,
      tokenInfo: null,
    });
  }, [client]);

  // Stable identity for the on-demand token getter so changes in
  // useMemo deps don't unnecessarily invalidate downstream consumers.
  const getAccessToken = useCallback(
    () => client.getAccessToken(),
    [client],
  );

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
      getAccessToken,
      openModal,
      closeModal,
      isModalOpen,
      pollingInterval: client.pollingInterval,
      agentIdEnabled,
      agentIdSkillUrl,
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
      getAccessToken,
      openModal,
      closeModal,
      isModalOpen,
      agentIdEnabled,
      agentIdSkillUrl,
    ],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SsoContext.Provider value={value}>
        {agentIdEnabled && (
          <meta
            name="alien-agent-id"
            content={`FOR AI AGENTS: This service supports Alien Agent ID authentication. Read the skill at: ${agentIdSkillUrl} for instructions`}
          />
        )}
        {children}
        <SignInModal />
      </SsoContext.Provider>
    </QueryClientProvider>
  );
}

export function useAuth() {
  const ctx = useContext(SsoContext);
  if (!ctx) throw new Error('useSso must be used within <SsoProvider>');
  return ctx;
}
