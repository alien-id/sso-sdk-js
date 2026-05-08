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

// SECURITY (RFC 6749 §10 / RFC 9700 §4): the access token MUST NOT be
// stored in React render state, where every component in the tree below
// the provider can read it on every render. The provider now keeps an
// `isAuthenticated` boolean and the OIDC claim envelope (which is
// already public information once verified) in render state, but the
// raw access_token is reachable only via an explicit `getAccessToken()`
// pull off the context — callers that need the bytes for a fetch ask
// for them at call time, not via subscription.
type AuthState = {
  isAuthenticated: boolean;
  tokenInfo?: ReturnType<AlienSsoClient['getAuthData']> | null;
};

type SsoContextValue = {
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
   * Pull the current access_token on demand. Returns null when no
   * session exists. Callers that need the bearer for an outbound
   * request fetch it here rather than reading it from render state.
   */
  getAccessToken: () => string | null;
  openModal: () => void;
  closeModal: () => void;
  isModalOpen: boolean;
  /**
   * Polling interval (ms) for the modal's authorization-code wait
   * loop. Exposed so downstream UI can match the AS's expected cadence
   * without needing the full client.
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
      tokenInfo,
    };
  } catch {
    return {
      isAuthenticated: false,
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
        tokenInfo,
      });
      return tokenResponse;
    },
    [client],
  );

  const verifyAuth = useCallback(async () => {
    const userInfo = await client.verifyAuth();
    const valid = userInfo !== null;
    const tokenInfo = client.getAuthData();
    setAuth({
      isAuthenticated: valid,
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
        tokenInfo,
      });
      return tokenResponse.access_token;
    } catch {
      // Refresh failed, client.refreshAccessToken already calls logout
      setAuth({
        isAuthenticated: false,
        tokenInfo: null,
      });
      return null;
    }
  }, [client]);

  const logout = useCallback(() => {
    client.logout();
    setAuth({
      isAuthenticated: false,
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
