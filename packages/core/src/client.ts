import {
  AuthorizeResponse,
  AuthorizeResponseSchema,
  PollRequest,
  PollRequestSchema,
  PollResponse,
  PollResponseSchema,
  TokenResponse,
  TokenResponseSchema,
  TokenInfo,
  TokenInfoSchema,
  UserInfoResponse,
  UserInfoResponseSchema,
} from './schema';
import { z } from 'zod/v4-mini';
import { sha256 } from 'js-sha256';

// Browser-compatible base64url encoding/decoding
function base64urlEncode(input: string): string {
  const base64 = btoa(input);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

const SSO_BASE_URL = 'https://sso.alien.com';
const POLLING_INTERVAL = 5000;

const STORAGE_KEY = 'alien-sso_';
const REFRESH_TOKEN_KEY = STORAGE_KEY + 'refresh_token';
const TOKEN_EXPIRY_KEY = STORAGE_KEY + 'token_expiry';

const joinUrl = (base: string, path: string): string => {
  return new URL(path, base).toString();
};

export interface JWTHeader {
  alg: string;
  typ: string;
  kid?: string;
}

export const AlienSsoClientSchema = z.object({
  ssoBaseUrl: z.url(),
  providerAddress: z.string(),
  pollingInterval: z.optional(z.number()),
});

export type AlienSsoClientConfig = z.infer<typeof AlienSsoClientSchema>;

export class AlienSsoClient {
  readonly config: AlienSsoClientConfig;
  readonly pollingInterval: number;
  readonly ssoBaseUrl: string;
  readonly providerAddress: string;

  // Singleton promise to prevent concurrent refresh token requests
  private static refreshPromise: Promise<TokenResponse> | null = null;

  constructor(config: AlienSsoClientConfig) {
    this.config = AlienSsoClientSchema.parse(config);

    this.ssoBaseUrl = this.config.ssoBaseUrl || SSO_BASE_URL;
    this.providerAddress = this.config.providerAddress;
    this.pollingInterval = this.config.pollingInterval || POLLING_INTERVAL;
  }

  private generateCodeVerifier(length: number = 128) {
    let array: Uint8Array;

    const cryptoObj = typeof window !== 'undefined' && window.crypto;

    if (cryptoObj && cryptoObj.getRandomValues) {
      array = new Uint8Array(length);
      cryptoObj.getRandomValues(array);
    } else {
      array = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }

    let str = '';
    for (let i = 0; i < array.length; i++) {
      str += String.fromCharCode(array[i]);
    }

    return base64urlEncode(str);
  }

  private generateCodeChallenge(codeVerifier: string): string {
    // RFC 7636: code_challenge = BASE64URL(SHA256(code_verifier))
    const hashArray = sha256.array(codeVerifier);
    const hashBytes = String.fromCharCode(...hashArray);
    return base64urlEncode(hashBytes);
  }

  /**
   * Initiates OAuth2 authorization flow with response_mode=json for SPA
   * GET /oauth/authorize?response_type=code&response_mode=json&...
   */
  async generateDeeplink(): Promise<AuthorizeResponse> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    sessionStorage.setItem(STORAGE_KEY + 'code_verifier', codeVerifier);

    // Build OAuth2 authorize URL with query params
    const params = new URLSearchParams({
      response_type: 'code',
      response_mode: 'json',
      client_id: this.providerAddress,
      scope: 'openid',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

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
    return PollResponseSchema.parse(json);
  }

  /**
   * Exchanges authorization code for tokens
   * POST /oauth/token (application/x-www-form-urlencoded)
   * Returns both access_token and id_token
   */
  async exchangeToken(authorizationCode: string): Promise<TokenResponse> {
    const codeVerifier = sessionStorage.getItem(STORAGE_KEY + 'code_verifier');

    if (!codeVerifier) throw new Error('Missing code verifier.');

    // Build form-urlencoded body (OAuth2 standard)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      client_id: this.providerAddress,
      code_verifier: codeVerifier,
    });

    const response = await fetch(
      joinUrl(this.config.ssoBaseUrl, '/oauth/token'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Token exchange failed: ${error.error_description || error.error || response.statusText}`);
    }

    const json = await response.json();
    const tokenResponse = TokenResponseSchema.parse(json);

    // Store tokens
    localStorage.setItem(STORAGE_KEY + 'access_token', tokenResponse.access_token);
    localStorage.setItem(STORAGE_KEY + 'id_token', tokenResponse.id_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokenResponse.refresh_token);

    // Calculate and store expiry timestamp (expires_in is in seconds)
    const expiryTime = Date.now() + (tokenResponse.expires_in * 1000);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());

    // Clear code verifier after successful exchange
    sessionStorage.removeItem(STORAGE_KEY + 'code_verifier');

    return tokenResponse;
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
      return UserInfoResponseSchema.parse(json);
    });
  }

  /**
   * Gets stored access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem(STORAGE_KEY + 'access_token');
  }

  /**
   * Gets stored ID token
   */
  getIdToken(): string | null {
    return localStorage.getItem(STORAGE_KEY + 'id_token');
  }

  /**
   * Decodes and validates JWT token to extract claims
   * Works with both access_token and id_token (EdDSA signed)
   */
  getAuthData(): TokenInfo | null {
    // Prefer id_token as it contains more user claims
    const token = this.getIdToken() || this.getAccessToken();

    if (!token) return null;

    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return null;
    }

    let header: JWTHeader;
    try {
      const headerJson = base64urlDecode(tokenParts[0]);
      header = JSON.parse(headerJson);
    } catch {
      return null;
    }

    // Accept RS256 (current OIDC standard)
    if (header.alg !== 'RS256' || header.typ !== 'JWT') {
      return null;
    }

    let payload: TokenInfo;
    try {
      const payloadJson = JSON.parse(base64urlDecode(tokenParts[1]));
      payload = TokenInfoSchema.parse(payloadJson);
    } catch {
      return null;
    }

    // Verify audience matches this client's provider address
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(this.providerAddress)) {
      return null;
    }

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
   * Checks if the current token is expired
   */
  isTokenExpired(): boolean {
    const authData = this.getAuthData();
    if (!authData) return true;
    return Date.now() / 1000 > authData.exp;
  }

  /**
   * Clears all stored authentication data
   */
  logout(): void {
    localStorage.removeItem(STORAGE_KEY + 'access_token');
    localStorage.removeItem(STORAGE_KEY + 'id_token');
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    sessionStorage.removeItem(STORAGE_KEY + 'code_verifier');
  }

  /**
   * Gets stored refresh token
   */
  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
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
    const expiryStr = localStorage.getItem(TOKEN_EXPIRY_KEY);

    if (!expiryStr) return true;

    const expiry = parseInt(expiryStr, 10);
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

    return now >= (expiry - bufferTime);
  }

  /**
   * Refreshes the access token using the stored refresh token
   * POST /oauth/token with grant_type=refresh_token
   * Uses singleton pattern to prevent concurrent refresh requests (race condition)
   */
  async refreshAccessToken(): Promise<TokenResponse> {
    // If refresh is already in progress, wait for it
    if (AlienSsoClient.refreshPromise) {
      return AlienSsoClient.refreshPromise;
    }

    // Start new refresh and store promise
    AlienSsoClient.refreshPromise = this.doRefreshAccessToken()
      .finally(() => {
        AlienSsoClient.refreshPromise = null;
      });

    return AlienSsoClient.refreshPromise;
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

    const response = await fetch(
      joinUrl(this.config.ssoBaseUrl, '/oauth/token'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));

      // If refresh fails, clear all tokens
      this.logout();

      throw new Error(`Token refresh failed: ${error.error_description || error.error || response.statusText}`);
    }

    const json = await response.json();
    const tokenResponse = TokenResponseSchema.parse(json);

    // Store new tokens
    localStorage.setItem(STORAGE_KEY + 'access_token', tokenResponse.access_token);
    localStorage.setItem(STORAGE_KEY + 'id_token', tokenResponse.id_token);
    localStorage.setItem(REFRESH_TOKEN_KEY, tokenResponse.refresh_token);

    const expiryTime = Date.now() + (tokenResponse.expires_in * 1000);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiryTime.toString());

    return tokenResponse;
  }

  /**
   * Executes a function that makes an authenticated request
   * Automatically refreshes token and retries on 401 error
   */
  async withAutoRefresh<T>(
    requestFn: () => Promise<T>,
    maxRetries: number = 1
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error: any) {
      // Check if error is a 401 and we haven't exceeded retries
      const is401 = error?.response?.status === 401 ||
                    error?.message?.includes('401') ||
                    error?.message?.includes('Unauthorized');

      if (is401 && maxRetries > 0 && this.hasRefreshToken()) {
        // Try to refresh token
        try {
          await this.refreshAccessToken();
          // Retry the original request
          return await requestFn();
        } catch (refreshError) {
          // Refresh failed, throw original error
          throw error;
        }
      }

      throw error;
    }
  }
}
