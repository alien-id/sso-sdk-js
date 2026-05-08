import {
  AuthorizeResponse,
  AuthorizeResponseSchema,
  PollRequest,
  PollRequestSchema,
  PollResponse,
  PollResponseSchema,
  TokenResponse,
  TokenResponseSchema,
  assertBearerTokenType,
  assertDPoPTokenType,
  TokenInfo,
  TokenInfoSchema,
  UserInfoResponse,
  UserInfoResponseSchema,
} from './schema';
import { JwksCache, type JWKS, verifyIdToken } from './verify';
import {
  type DPoPKeypair,
  createDPoPProof,
  dpopJwkThumbprint,
} from './dpop';
import { z } from 'zod/v4-mini';

// Browser-compatible base64url encoding/decoding
function base64urlEncode(input: string): string {
  const base64 = btoa(input);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return base64urlEncode(str);
}

function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

const POLLING_INTERVAL = 5000;

const STORAGE_KEY = 'alien-sso_';
const ACCESS_TOKEN_KEY = STORAGE_KEY + 'access_token';
const ID_TOKEN_KEY = STORAGE_KEY + 'id_token';
const ID_TOKEN_CLAIMS_KEY = STORAGE_KEY + 'id_token_claims';
const REFRESH_TOKEN_KEY = STORAGE_KEY + 'refresh_token';
const TOKEN_EXPIRY_KEY = STORAGE_KEY + 'token_expiry';
const STATE_KEY = STORAGE_KEY + 'state';
const CODE_VERIFIER_KEY = STORAGE_KEY + 'code_verifier';
// OIDC Core §3.1.2.1: when the client sends `nonce` on the auth
// request, the id_token MUST replay it back. We persist the request-
// time nonce here so the post-exchange verifier can enforce equality
// (§3.1.3.7 step 11) and detect id_token replay across sessions.
const NONCE_KEY = STORAGE_KEY + 'nonce';

/**
 * Storage abstraction for tokens (RFC 6749 §10.16 / OAuth 2.0 BCP).
 *
 * The default implementation is `MemoryTokenStorage` — tokens are
 * unreachable from XSS but do not survive a page reload. Integrators that
 * need persistence-across-reload can opt into `LocalStorageTokenStorage`,
 * accepting the documented XSS exposure.
 *
 * BREAKING CHANGE: prior versions defaulted to localStorage.
 */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * In-memory token storage — recommended default. Tokens are unreachable
 * from XSS but do not survive a page reload.
 */
export class MemoryTokenStorage implements TokenStorage {
  private readonly store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Persistent token storage backed by `localStorage`. Survives reload but
 * is reachable from any script on the origin — exposed to XSS exfiltration
 * (RFC 6749 §10.16 / OAuth 2.0 BCP). Opt in only when the persistence
 * trade-off is acceptable.
 *
 * SECURITY: For refresh-token storage, prefer `MemoryTokenStorage`
 * (default) or a sessionStorage-backed implementation. localStorage is
 * the highest-risk option — any XSS-injected script reads it freely.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  getItem(key: string): string | null {
    return localStorage.getItem(key);
  }
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  }
  removeItem(key: string): void {
    localStorage.removeItem(key);
  }
}

const joinUrl = (base: string, path: string): string => {
  return new URL(path, base).toString();
};

export interface JWTHeader {
  alg: string;
  typ: string;
  kid?: string;
  // RFC 7515 §4.1.11: list of header parameters the producer flagged as
  // critical. We support no extensions, so any presence means "invalid".
  crit?: string[];
}

export const AlienSsoClientSchema = z.object({
  ssoBaseUrl: z.url(),
  providerAddress: z.string(),
  pollingInterval: z.optional(z.number()),
  // RFC 6749 §4.1.3: when `redirect_uri` is included in the authorize
  // request, the token request MUST also include it with an identical
  // value. Optional — the deeplink+poll flow does not need it.
  redirectUri: z.optional(z.url()),
});

export type AlienSsoClientConfig = z.infer<typeof AlienSsoClientSchema> & {
  /**
   * Optional override for token persistence. Defaults to in-memory
   * (`MemoryTokenStorage`) — tokens are out of XSS reach but do not
   * survive a page reload (RFC 6749 §10.16). Pass
   * `new LocalStorageTokenStorage()` to opt into persistence-across-reload.
   *
   * BREAKING CHANGE: prior versions defaulted to localStorage.
   */
  tokenStorage?: TokenStorage;
  /**
   * Dev opt-in: accept `http://` for non-loopback `ssoBaseUrl`. RFC 6749
   * §10 requires TLS for bearer credentials, so the default rejects plain
   * HTTP except for loopback (localhost / 127.0.0.1 / [::1]). Set this to
   * `true` only in development environments where the SSO is fronted by a
   * non-TLS terminator (e.g. a `*.lan.dev` host).
   */
  allowInsecureSsoBaseUrl?: boolean;
  /**
   * Opt into RFC 9449 DPoP. When provided, the client requests a
   * sender-constrained access token: `dpop_jkt` is sent on `/authorize`,
   * a DPoP proof header is sent on `/oauth/token` (code exchange and
   * refresh), and `token_type=DPoP` is required on the response. Tokens
   * issued without DPoP from this codepath would be rejected by the
   * resource server, so we hard-fail rather than silently accept Bearer.
   *
   * When omitted, behavior is unchanged — the client remains a Bearer-
   * only OIDC consumer.
   */
  dpop?: { keypair: import('./dpop').DPoPKeypair };
};

// RFC 6749 §10: bearer credentials and refresh tokens MUST be transmitted
// over TLS. We allow http:// only for loopback hosts (development), or when
// the integrator explicitly opts in via `allowInsecureSsoBaseUrl`.
function assertSsoBaseUrlSafe(
  ssoBaseUrl: string,
  allowInsecure: boolean,
): void {
  let url: URL;
  try {
    url = new URL(ssoBaseUrl);
  } catch {
    throw new Error(`ssoBaseUrl is not a valid URL: ${ssoBaseUrl}`);
  }
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:') {
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      allowInsecure
    ) {
      return;
    }
    throw new Error(
      `ssoBaseUrl must use https:// (got ${url.protocol}//${url.host}); set allowInsecureSsoBaseUrl: true to override in dev`,
    );
  }
  throw new Error(
    `ssoBaseUrl must use https:// (got ${url.protocol}//${url.host})`,
  );
}

export class AlienSsoClient {
  readonly config: AlienSsoClientConfig;
  readonly pollingInterval: number;
  readonly ssoBaseUrl: string;
  readonly providerAddress: string;
  readonly redirectUri?: string;
  private readonly tokenStorage: TokenStorage;
  private readonly jwksCache: JwksCache;
  // RFC 9449 §5: when set, the client requests DPoP-bound tokens. The
  // keypair is reused across exchange + refresh so the binding survives
  // refresh-token rotation. Resetting it would invalidate any in-flight
  // bound tokens (cnf.jkt would no longer match the proof signer).
  private readonly dpopKeypair: DPoPKeypair | null;

  // Per-provider singleton to deduplicate concurrent refresh requests.
  // Keyed by providerAddress so two clients on different providers don't
  // share refresh state (RFC 6749 §10.4 sticky-binding).
  private static refreshPromises: Map<string, Promise<TokenResponse>> =
    new Map();

  constructor(config: AlienSsoClientConfig) {
    const parsed = AlienSsoClientSchema.parse(config);
    assertSsoBaseUrlSafe(
      parsed.ssoBaseUrl,
      config.allowInsecureSsoBaseUrl === true,
    );
    this.config = { ...parsed, tokenStorage: config.tokenStorage };

    this.ssoBaseUrl = parsed.ssoBaseUrl;
    this.providerAddress = parsed.providerAddress;
    this.pollingInterval = parsed.pollingInterval || POLLING_INTERVAL;
    this.redirectUri = parsed.redirectUri;
    this.tokenStorage = config.tokenStorage ?? new MemoryTokenStorage();
    this.jwksCache = new JwksCache(joinUrl(this.ssoBaseUrl, '/oauth/jwks'));
    this.dpopKeypair = config.dpop?.keypair ?? null;
  }

  /**
   * Test/dev seam — pre-load the JWKS cache to avoid an HTTP fetch during
   * `exchangeToken`/`refreshAccessToken`. Production callers should rely on
   * the automatic JWKS fetch from `${ssoBaseUrl}/oauth/jwks`.
   */
  injectJwks(jwks: JWKS): void {
    this.jwksCache.inject(jwks);
  }

  // RFC 7636 §4.1: code_verifier length must be 43..128 characters.
  // §7.1 recommends ≥256 bits of entropy — 32 random octets satisfies
  // both, base64url-encoding to exactly 43 characters.
  private generateCodeVerifier(byteLength: number = 32): string {
    const cryptoObj: Crypto | undefined =
      (typeof globalThis !== 'undefined' &&
        (globalThis as { crypto?: Crypto }).crypto) ||
      (typeof window !== 'undefined' && window.crypto) ||
      undefined;

    // RFC 7636 §7.1: SHOULD use a "suitable random number generator". We
    // refuse to run without a CSPRNG rather than fall back to Math.random.
    if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
      throw new Error(
        'PKCE requires a CSPRNG (crypto.getRandomValues); refusing to use a non-cryptographic fallback',
      );
    }

    const array = new Uint8Array(byteLength);
    cryptoObj.getRandomValues(array);

    let str = '';
    for (let i = 0; i < array.length; i++) {
      str += String.fromCharCode(array[i]);
    }

    return base64urlEncode(str);
  }

  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    // RFC 7636 §4.2: code_challenge = BASE64URL(SHA256(code_verifier)).
    const cryptoObj: Crypto | undefined =
      (typeof globalThis !== 'undefined' &&
        (globalThis as { crypto?: Crypto }).crypto) ||
      (typeof window !== 'undefined' && window.crypto) ||
      undefined;
    if (!cryptoObj || !cryptoObj.subtle) {
      throw new Error('PKCE requires a SubtleCrypto implementation');
    }
    const encoded = new TextEncoder().encode(codeVerifier);
    const buffer = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(buffer).set(encoded);
    const digest = await cryptoObj.subtle.digest('SHA-256', buffer);
    return base64urlEncodeBytes(new Uint8Array(digest));
  }

  /**
   * Initiates OAuth2 authorization flow with response_mode=json for SPA
   * GET /oauth/authorize?response_type=code&response_mode=json&...
   */
  async generateDeeplink(): Promise<AuthorizeResponse> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    // RFC 6749 §10.12: clients MUST use `state` to prevent CSRF. We mint
    // and persist it even in poll-mode flow so callers in redirect-mode
    // inherit CSRF protection without further wiring.
    const state = this.generateCodeVerifier();
    // OIDC Core §3.1.2.1 / §15.5.2: the Client SHOULD send a nonce that
    // it correlates with the post-exchange id_token to defend against
    // id_token replay. We mint a fresh CSPRNG value per authorize call
    // and persist it so `persistTokens` can pass it as `expectedNonce`.
    const nonce = this.generateCodeVerifier();

    sessionStorage.setItem(CODE_VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(NONCE_KEY, nonce);

    // Build OAuth2 authorize URL with query params
    const params = new URLSearchParams({
      response_type: 'code',
      response_mode: 'json',
      client_id: this.providerAddress,
      scope: 'openid',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    if (this.redirectUri) {
      params.set('redirect_uri', this.redirectUri);
    }
    // RFC 9449 §5: when the client wants a DPoP-bound access token, it MUST
    // send `dpop_jkt` so the AS can mint cnf.jkt = thumbprint of the same
    // key the client will sign proofs with.
    if (this.dpopKeypair) {
      params.set(
        'dpop_jkt',
        await dpopJwkThumbprint(this.dpopKeypair.publicJwk),
      );
    }

    const authorizeUrl = `${this.config.ssoBaseUrl}/oauth/authorize?${params.toString()}`;

    const response = await fetch(authorizeUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Authorize failed: ${error.error_description || error.error || response.statusText}`);
    }

    const json = await response.json();
    return AuthorizeResponseSchema.parse(json);
  }

  /**
   * Polls for authorization completion
   * POST /oauth/poll
   */
  async pollAuth(pollingCode: string): Promise<PollResponse> {
    const pollPayload: PollRequest = {
      polling_code: pollingCode,
    };

    PollRequestSchema.parse(pollPayload);

    const response = await fetch(joinUrl(this.config.ssoBaseUrl, '/oauth/poll'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pollPayload),
    });

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.statusText}`);
    }

    const json = await response.json();
    const parsed = PollResponseSchema.parse(json);

    // RFC 6749 §10.12: when the client sent `state`, it MUST verify that
    // the auth response carries the same value back. We track state in
    // sessionStorage from `generateDeeplink`; if it's set, the response
    // MUST include matching state — missing state is a rejection too,
    // since CSRF protection cannot be silently dropped.
    const persistedState = sessionStorage.getItem(STATE_KEY);
    if (persistedState) {
      if (!parsed.state) {
        throw new Error(
          'Auth response missing state parameter (RFC 6749 §10.12)',
        );
      }
      if (parsed.state !== persistedState) {
        throw new Error('Auth response state mismatch (RFC 6749 §10.12)');
      }
    }

    // RFC 9207 §2.4: when the AS includes `iss` on the authorization
    // response, the Client MUST validate that the value identifies the
    // expected issuer. This defends against AS mix-up attacks where an
    // attacker tricks the client into sending a code from one AS to a
    // different AS. We compare against `ssoBaseUrl` because the SSO AS
    // uses that as its issuer (per its OIDC metadata).
    if (parsed.iss !== undefined && parsed.iss !== this.ssoBaseUrl) {
      throw new Error('Auth response issuer mismatch (RFC 9207 §2.4)');
    }

    return parsed;
  }

  /**
   * Exchanges authorization code for tokens
   * POST /oauth/token (application/x-www-form-urlencoded)
   * Returns both access_token and id_token
   */
  async exchangeToken(authorizationCode: string): Promise<TokenResponse> {
    const codeVerifier = sessionStorage.getItem(CODE_VERIFIER_KEY);

    if (!codeVerifier) throw new Error('Missing code verifier.');

    // Build form-urlencoded body (OAuth2 standard)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      client_id: this.providerAddress,
      code_verifier: codeVerifier,
    });
    // RFC 6749 §4.1.3: when authorize used `redirect_uri`, the token
    // request MUST repeat the identical value.
    if (this.redirectUri) {
      body.set('redirect_uri', this.redirectUri);
    }

    const tokenUrl = joinUrl(this.config.ssoBaseUrl, '/oauth/token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.dpopKeypair) {
      headers['DPoP'] = await createDPoPProof(this.dpopKeypair, {
        htm: 'POST',
        htu: tokenUrl,
      });
    }
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Token exchange failed: ${error.error_description || error.error || response.statusText}`);
    }

    const json = await response.json();
    const tokenResponse = TokenResponseSchema.parse(json);
    if (this.dpopKeypair) {
      assertDPoPTokenType(tokenResponse.token_type);
    } else {
      assertBearerTokenType(tokenResponse.token_type);
    }

    await this.persistTokens(tokenResponse);

    // Clear code verifier after successful exchange
    sessionStorage.removeItem(CODE_VERIFIER_KEY);

    return tokenResponse;
  }

  private async persistTokens(tokenResponse: TokenResponse): Promise<void> {
    // Verify the id_token BEFORE we surface or persist its claims
    // (OIDC §3.1.3.7 / RFC 7519 §7.2). Failing the verification clears
    // any prior session state to prevent stale-claim leakage.
    if (tokenResponse.id_token) {
      const jwks = await this.jwksCache.get();
      // OIDC §3.1.3.7 step 11: when we sent a `nonce` on /authorize,
      // the id_token MUST replay it. We pull the request-time nonce
      // from sessionStorage (set in `generateDeeplink`) and require an
      // exact match — defending against id_token replay across sessions.
      // Refresh-grant id_tokens (no original /authorize round trip)
      // omit `nonce`, so we only enforce when one is present.
      const expectedNonce =
        typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem(NONCE_KEY) ?? undefined
          : undefined;
      const verified = await verifyIdToken(tokenResponse.id_token, {
        jwks,
        expectedIssuer: this.ssoBaseUrl,
        expectedAudience: this.providerAddress,
        expectedNonce: expectedNonce || undefined,
      });
      if (verified === null) {
        this.logout();
        throw new Error('id_token verification failed');
      }
      // Clear the request-time nonce — it's single-use; each /authorize
      // call mints a fresh one. Leaving it would let a future refresh
      // verify against the wrong nonce.
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(NONCE_KEY);
      }
      this.tokenStorage.setItem(ID_TOKEN_KEY, tokenResponse.id_token);
      this.tokenStorage.setItem(
        ID_TOKEN_CLAIMS_KEY,
        JSON.stringify(verified.payload),
      );
    }

    this.tokenStorage.setItem(ACCESS_TOKEN_KEY, tokenResponse.access_token);
    // RFC 6749 §6: refresh_token reissuance is OPTIONAL. When the response
    // omits one, retain the prior refresh_token so the client can keep
    // refreshing instead of being forced to re-authenticate.
    if (tokenResponse.refresh_token) {
      this.tokenStorage.setItem(REFRESH_TOKEN_KEY, tokenResponse.refresh_token);
    }
    const expiryTime = Date.now() + tokenResponse.expires_in * 1000;
    this.tokenStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());
  }

  /**
   * Verifies authentication by calling userinfo endpoint
   * GET /oauth/userinfo
   * Automatically refreshes token on 401 if refresh token is available
   */
  async verifyAuth(): Promise<UserInfoResponse | null> {
    return this.withAutoRefresh(async () => {
      const accessToken = this.getAccessToken();

      if (!accessToken) {
        return null;
      }

      const response = await fetch(
        joinUrl(this.config.ssoBaseUrl, '/oauth/userinfo'),
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        if (response.status === 401) {
          const error = new Error('Unauthorized') as Error & { response?: { status: number } };
          error.response = { status: 401 };
          throw error;
        }
        return null;
      }

      const json = await response.json();
      const userinfo = UserInfoResponseSchema.parse(json);
      // OIDC Core 1.0 §5.3.2: the `sub` claim returned by the userinfo
      // endpoint MUST exactly match the verified `sub` of the id_token. If
      // they differ, treat as a token-substitution attack: clear the
      // session and fail closed rather than expose mismatched claims.
      const idTokenSub = this.getAuthData()?.sub;
      if (idTokenSub && userinfo.sub && userinfo.sub !== idTokenSub) {
        this.logout();
        throw new Error(
          `userinfo.sub mismatch (OIDC §5.3.2): expected ${idTokenSub}, got ${userinfo.sub}`,
        );
      }
      return userinfo;
    });
  }

  /**
   * Gets stored access token
   */
  getAccessToken(): string | null {
    return this.tokenStorage.getItem(ACCESS_TOKEN_KEY);
  }

  /**
   * Gets stored ID token
   */
  getIdToken(): string | null {
    return this.tokenStorage.getItem(ID_TOKEN_KEY);
  }

  /**
   * Returns the verified id_token claims persisted at exchange/refresh time.
   *
   * Verification (OIDC §3.1.3.7 / RFC 7519 §7.2) — signature against the
   * issuer JWKS, iss/aud/azp/exp/nbf/iat/typ/crit — runs in
   * `persistTokens`. This method only re-checks `exp` against the current
   * clock and applies the schema, since claims may have been verified
   * minutes ago. RFC 9068 §6: never falls back to the access_token.
   */
  getAuthData(): TokenInfo | null {
    const raw = this.tokenStorage.getItem(ID_TOKEN_CLAIMS_KEY);
    if (!raw) return null;

    let payload: TokenInfo;
    try {
      payload = TokenInfoSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= payload.exp) return null;

    return payload;
  }

  /**
   * Gets the subject (user identifier) from the token
   */
  getSubject(): string | null {
    const authData = this.getAuthData();
    return authData?.sub || null;
  }

  /**
   * Checks if the current token is expired.
   *
   * Backed by the stored `expires_in` timestamp from the token endpoint
   * response — never by inspecting the access_token (RFC 9068 §6).
   */
  isTokenExpired(): boolean {
    const expiryStr = this.tokenStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiryStr) return true;
    const expiry = parseInt(expiryStr, 10);
    if (!Number.isFinite(expiry)) return true;
    return Date.now() >= expiry;
  }

  /**
   * Clears all stored authentication data
   */
  logout(): void {
    this.tokenStorage.removeItem(ACCESS_TOKEN_KEY);
    this.tokenStorage.removeItem(ID_TOKEN_KEY);
    this.tokenStorage.removeItem(ID_TOKEN_CLAIMS_KEY);
    this.tokenStorage.removeItem(REFRESH_TOKEN_KEY);
    this.tokenStorage.removeItem(TOKEN_EXPIRY_KEY);
    sessionStorage.removeItem(CODE_VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(NONCE_KEY);
  }

  /**
   * Gets stored refresh token
   */
  getRefreshToken(): string | null {
    return this.tokenStorage.getItem(REFRESH_TOKEN_KEY);
  }

  /**
   * Checks if a refresh token is available
   */
  hasRefreshToken(): boolean {
    return !!this.getRefreshToken();
  }

  /**
   * Checks if the access token is expired or will expire soon (within 5 minutes)
   */
  isAccessTokenExpired(): boolean {
    const expiryStr = this.tokenStorage.getItem(TOKEN_EXPIRY_KEY);

    if (!expiryStr) return true;

    const expiry = parseInt(expiryStr, 10);
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

    return now >= (expiry - bufferTime);
  }

  /**
   * Refreshes the access token using the stored refresh token
   * POST /oauth/token with grant_type=refresh_token
   *
   * Concurrent refresh requests are deduplicated *per provider* — two
   * `AlienSsoClient` instances configured for different `providerAddress`
   * values will not block each other.
   */
  async refreshAccessToken(): Promise<TokenResponse> {
    const key = this.providerAddress;
    const inFlight = AlienSsoClient.refreshPromises.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.doRefreshAccessToken().finally(() => {
      AlienSsoClient.refreshPromises.delete(key);
    });
    AlienSsoClient.refreshPromises.set(key, promise);
    return promise;
  }

  /**
   * Internal method that performs the actual token refresh
   */
  private async doRefreshAccessToken(): Promise<TokenResponse> {
    const refreshToken = this.getRefreshToken();

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.providerAddress,
    });

    const tokenUrl = joinUrl(this.config.ssoBaseUrl, '/oauth/token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.dpopKeypair) {
      // RFC 9449 §5 sticky-binding: refresh proof MUST be signed by the
      // same keypair as the original exchange.
      headers['DPoP'] = await createDPoPProof(this.dpopKeypair, {
        htm: 'POST',
        htu: tokenUrl,
      });
    }
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));

      // If refresh fails, clear all tokens
      this.logout();

      throw new Error(`Token refresh failed: ${error.error_description || error.error || response.statusText}`);
    }

    const json = await response.json();
    const tokenResponse = TokenResponseSchema.parse(json);
    if (this.dpopKeypair) {
      assertDPoPTokenType(tokenResponse.token_type);
    } else {
      assertBearerTokenType(tokenResponse.token_type);
    }

    await this.persistTokens(tokenResponse);

    return tokenResponse;
  }

  /**
   * Executes a function that makes an authenticated request
   * Automatically refreshes token and retries on 401 error
   */
  async withAutoRefresh<T>(
    requestFn: () => Promise<T>,
    maxRetries: number = 1,
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error: unknown) {
      const is401 =
        typeof error === 'object' &&
        error !== null &&
        (error as { response?: { status?: number } }).response?.status === 401;

      if (is401 && maxRetries > 0 && this.hasRefreshToken()) {
        try {
          await this.refreshAccessToken();
          return await requestFn();
        } catch (refreshError) {
          // Refresh failed — surface the original 401 but keep the
          // refresh failure visible so SREs can correlate.
          // eslint-disable-next-line no-console
          console.warn('Token refresh failed during auto-retry:', refreshError);
          throw error;
        }
      }

      throw error;
    }
  }
}
