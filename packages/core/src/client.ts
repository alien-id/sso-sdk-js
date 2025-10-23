import {
  AuthorizeRequest,
  AuthorizeResponse,
  AuthorizeResponseSchema,
  ExchangeCodeRequest,
  ExchangeCodeRequestSchema,
  ExchangeCodeResponse,
  ExchangeCodeResponseSchema,
  AuthorizeRequestSchema,
  PollRequest,
  PollRequestSchema,
  PollResponse,
  PollResponseSchema,
  TokenInfo,
  TokenInfoSchema,
  VerifyTokenRequest,
  VerifyTokenRequestSchema,
  VerifyTokenResponse,
  VerifyTokenResponseSchema,
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

const joinUrl = (base: string, path: string): string => {
  return new URL(path, base).toString();
};

export interface JWTHeader {
  alg: string;
  typ: string;
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
    return sha256(codeVerifier);
  }

  async generateDeeplink(): Promise<AuthorizeResponse> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    sessionStorage.setItem(STORAGE_KEY + 'code_verifier', codeVerifier);

    const authorizeUrl = `${this.config.ssoBaseUrl}/sso/authorize`;

    const authorizePayload: AuthorizeRequest = {
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    };

    AuthorizeRequestSchema.parse(authorizePayload);

    const response = await fetch(authorizeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PROVIDER-ADDRESS': this.providerAddress,
      },
      body: JSON.stringify(authorizePayload),
    });

    const json = await response.json();

    return AuthorizeResponseSchema.parse(json);
  }

  async pollAuth(pollingCode: string): Promise<PollResponse> {
    const pollPayload: PollRequest = {
      polling_code: pollingCode,
    };

    PollRequestSchema.parse(pollPayload);

    const response = await fetch(joinUrl(this.config.ssoBaseUrl, '/sso/poll'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PROVIDER-ADDRESS': this.providerAddress,
      },
      body: JSON.stringify(pollPayload),
    });

    if (!response.ok) {
      throw new Error(`Poll failed: ${response.statusText}`);
    }

    const json = await response.json();
    return PollResponseSchema.parse(json);
  }

  async exchangeToken(authorizationCode: string): Promise<string> {
    const codeVerifier = sessionStorage.getItem(STORAGE_KEY + 'code_verifier');

    if (!codeVerifier) throw new Error('Missing code verifier.');

    const exchangeCodePayload: ExchangeCodeRequest = {
      authorization_code: authorizationCode,
      code_verifier: codeVerifier,
    };

    ExchangeCodeRequestSchema.parse(exchangeCodePayload);

    const response = await fetch(
      joinUrl(this.config.ssoBaseUrl, '/sso/access_token/exchange'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PROVIDER-ADDRESS': this.providerAddress,
        },
        body: JSON.stringify(exchangeCodePayload),
      },
    );

    if (!response.ok) {
      throw new Error(`ExchangeCode failed: ${response.statusText}`);
    }

    const json = await response.json();

    const exchangeCodeResponse: ExchangeCodeResponse =
      ExchangeCodeResponseSchema.parse(json);

    if (exchangeCodeResponse.access_token) {
      localStorage.setItem(
        STORAGE_KEY + 'access_token',
        exchangeCodeResponse.access_token,
      );

      return exchangeCodeResponse.access_token;
    } else {
      throw new Error('Exchange failed');
    }
  }

  async verifyAuth(): Promise<boolean> {
    const access_token = this.getAccessToken();

    if (!access_token) {
      throw new Error('Access token is invalid.');
    }

    const verifyTokenPayload: VerifyTokenRequest = {
      access_token,
    };

    VerifyTokenRequestSchema.parse(verifyTokenPayload);

    const response = await fetch(
      joinUrl(this.config.ssoBaseUrl, '/sso/access_token/verify'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PROVIDER-ADDRESS': this.providerAddress,
        },
        body: JSON.stringify(verifyTokenPayload),
      },
    );

    if (!response.ok) {
      throw new Error(`VerifyToken failed: ${response.statusText}`);
    }

    const json = await response.json();

    const verifyTokenResponse: VerifyTokenResponse =
      VerifyTokenResponseSchema.parse(json);

    return verifyTokenResponse.is_valid;
  }

  getAccessToken(): string | null {
    return localStorage.getItem(STORAGE_KEY + 'access_token');
  }

  getAuthData(): TokenInfo | null {
    const token = this.getAccessToken();

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

    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null;
    }

    let payload: TokenInfo;
    try {
      const payloadJson = JSON.parse(base64urlDecode(tokenParts[1]));
      payload = TokenInfoSchema.parse(payloadJson);
    } catch {
      return null;
    }

    return payload;
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY + 'access_token');
    sessionStorage.removeItem(STORAGE_KEY + 'code_verifier');
  }
}
