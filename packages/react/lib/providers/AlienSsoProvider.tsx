'use client';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
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
  /**
   * @internal Deduplicates SignInModal instances. The provider auto-renders
   * one modal; if a consumer renders another manually, both would mount and
   * stack on top of each other. Each instance claims the slot on mount —
   * only the holder actually renders. Returns true when `instance` holds
   * the slot.
   */
  claimModalSlot: (instance: object) => boolean;
  /** @internal Releases the modal slot on unmount. */
  releaseModalSlot: (instance: object) => void;
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
  // Memoize on config *values*, not the object identity. Integrators commonly
  // pass an inline `config={{...}}` literal (it's the pattern in our own docs),
  // which is a new object every render; keying on `[config]` would rebuild the
  // client — and tear down the whole auth context — on each parent re-render.
  // Object-typed fields (tokenStorage, dpop) are expected to be stable refs.
  const client = useMemo(
    () => new AlienSsoClient(config),
    [
      config.ssoBaseUrl,
      config.providerAddress,
      config.pollingInterval,
      config.redirectUri,
      config.allowInsecureSsoBaseUrl,
      config.tokenStorage,
      config.dpop,
    ],
  );
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
      if (!tokenResponse.access_token || !tokenInfo) {
        // The exchange resolved but produced no usable session (e.g. a missing
        // or unverifiable id_token, so getAuthData() is null). Surface it as a
        // failure so the UI shows an error instead of a false "success" — the
        // success screen and auth state must never disagree.
        throw new Error('Token exchange did not establish a session');
      }
      setAuth({
        isAuthenticated: true,
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
    // The sign-in flow derives its state from these cached queries (the
    // exchange entry has staleTime: Infinity). Without clearing them, an inline
    // SignInPanel would re-render the stale success screen after logout instead
    // of a fresh QR. Reset the flow so the next sign-in starts clean.
    queryClient.removeQueries({ queryKey: ['auth-poll'] });
    queryClient.removeQueries({ queryKey: ['auth-exchange'] });
    queryClient.removeQueries({ queryKey: ['auth-deeplink'] });
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

  // See SsoContextValue.claimModalSlot — first SignInModal instance to claim
  // wins; duplicates render nothing until the holder unmounts.
  const modalSlotRef = useRef<object | null>(null);
  const claimModalSlot = useCallback((instance: object) => {
    if (modalSlotRef.current === null) {
      modalSlotRef.current = instance;
    }
    return modalSlotRef.current === instance;
  }, []);
  const releaseModalSlot = useCallback((instance: object) => {
    if (modalSlotRef.current === instance) {
      modalSlotRef.current = null;
    }
  }, []);

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
      claimModalSlot,
      releaseModalSlot,
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
      claimModalSlot,
      releaseModalSlot,
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
