import {
  AuthorizeResponse,
  AuthorizeResponseSchema,
  ExchangeCodeRequest,
  ExchangeCodeRequestSchema,
  ExchangeCodeResponse,
  ExchangeCodeResponseSchema,
  InternalAuthorizeRequest,
  InternalAuthorizeRequestSchema,
  PollRequest,
  PollRequestSchema,
  PollResponse,
  PollResponseSchema,
  TokenInfo,
  TokenInfoSchema,
  UserInfo,
  UserInfoSchema,
  VerifyTokenRequest,
  VerifyTokenRequestSchema,
  VerifyTokenResponse,
  VerifyTokenResponseSchema,
} from './schema';
import { z } from 'zod/v4-mini';
import base64url from 'base64url';
import CryptoJS from 'crypto-js';

const DEFAULT_SERVER_SDK_BASEURL = 'http://localhost:3000';
const DEFAULT_SSO_BASE_URL = 'https://sso.alien.com';
const DEFAULT_POLLING_INTERVAL = 5000;

export interface JWTHeader {
  alg: string;
  typ: string;
}

export const AlienSsoSdkClientSchema = z.object({
  serverSdkBaseUrl: z.string(),
  ssoBaseUrl: z.url(),
  pollingInterval: z.optional(z.number()),
});

export type AlienSsoSdkClientConfig = z.infer<typeof AlienSsoSdkClientSchema>;

export class AlienSsoSdkClient {
  readonly config: AlienSsoSdkClientConfig;
  readonly pollingInterval: number;
  readonly serverSdkBaseUrl: string;
  readonly ssoBaseUrl: string;

  constructor(config: AlienSsoSdkClientConfig) {
    this.config = AlienSsoSdkClientSchema.parse(config);

    this.ssoBaseUrl = this.config.ssoBaseUrl || DEFAULT_SSO_BASE_URL;
    this.serverSdkBaseUrl =
      this.config.serverSdkBaseUrl || DEFAULT_SERVER_SDK_BASEURL;
    this.pollingInterval =
      this.config.pollingInterval || DEFAULT_POLLING_INTERVAL;
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

    return base64url.encode(str);
  }

  private async generateCodeChallenge(codeVerifier: string) {
    return CryptoJS.SHA256(codeVerifier).toString(CryptoJS.enc.Hex);
  }

  async authorize(): Promise<AuthorizeResponse> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    sessionStorage.setItem('code_verifier', codeVerifier);

    const authorizeUrl = `${this.config.serverSdkBaseUrl}/authorize`;

    const authorizePayload: InternalAuthorizeRequest = {
      code_challenge: codeChallenge,
    };

    InternalAuthorizeRequestSchema.parse(authorizePayload);

    const response = await fetch(authorizeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(authorizePayload),
    });

    const json = await response.json();

    console.log(json);

    return AuthorizeResponseSchema.parse(json);
  }

  async pollForAuthorization(pollingCode: string): Promise<string | null> {
    const pollPayload: PollRequest = {
      polling_code: pollingCode,
    };

    PollRequestSchema.parse(pollPayload);

    const pollingUrl = `${this.config.ssoBaseUrl}/poll`;

    while (true) {
      const response = await fetch(pollingUrl, {
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

      const pollResponse: PollResponse = PollResponseSchema.parse(json);

      if (
        pollResponse.status === 'authorized' &&
        pollResponse.authorization_code
      ) {
        return pollResponse.authorization_code;
      }

      if (pollResponse.status === 'pending') {
        await new Promise((resolve) =>
          setTimeout(resolve, this.pollingInterval),
        );
      } else {
        throw new Error(`Poll failed`);
      }
    }
  }

  async exchangeCode(authorizationCode: string): Promise<string | null> {
    const codeVerifier = sessionStorage.getItem('code_verifier');

    if (!codeVerifier) throw new Error('Missing code verifier.');

    const exchangeCodePayload: ExchangeCodeRequest = {
      authorization_code: authorizationCode,
      code_verifier: codeVerifier,
    };

    ExchangeCodeRequestSchema.parse(exchangeCodePayload);

    const exchangeUrl = `${this.config.ssoBaseUrl}/access_token/exchange`;

    const response = await fetch(exchangeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(exchangeCodePayload),
    });

    if (!response.ok) {
      throw new Error(`ExchangeCode failed: ${response.statusText}`);
    }

    const json = await response.json();

    const exchangeCodeResponse: ExchangeCodeResponse =
      ExchangeCodeResponseSchema.parse(json);

    if (exchangeCodeResponse.access_token) {
      // Note: need to rework it to httpOnly cookie
      // For now, we store it in localStorage for simplicity
      localStorage.setItem('access_token', exchangeCodeResponse.access_token);

      return exchangeCodeResponse.access_token;
    } else {
      throw new Error('Exchange failed');
    }
  }

  async verifyToken(): Promise<boolean> {
    const access_token = this.getAccessToken();

    if (!access_token) {
      throw new Error('Access token is invalid.');
    }

    const verifyTokenPayload: VerifyTokenRequest = {
      access_token,
    };

    VerifyTokenRequestSchema.parse(verifyTokenPayload);

    const verifyTokenUrl = `${this.config.ssoBaseUrl}/access_token/verify`;

    const response = await fetch(verifyTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(verifyTokenPayload),
    });

    if (!response.ok) {
      throw new Error(`VerifyToken failed: ${response.statusText}`);
    }

    const json = await response.json();

    const verifyTokenResponse: VerifyTokenResponse =
      VerifyTokenResponseSchema.parse(json);

    if (!verifyTokenResponse.is_valid) {
      throw new Error('Access token is invalid.');
    }

    return verifyTokenResponse.is_valid;
  }

  getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  }

  getTokenData(): TokenInfo & { user: UserInfo } {
    const token = this.getAccessToken();

    if (!token) return null;

    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const headerPart = tokenParts[0];

    if (!headerPart) return null;

    let header: JWTHeader;
    try {
      const headerJson = base64url.decode(headerPart);
      header = JSON.parse(headerJson);
    } catch {
      throw new Error('Invalid token header format');
    }

    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new Error('Unsupported token algorithm or type');
    }

    const payloadPart = tokenParts[1];

    if (!payloadPart) return null;

    let payload: TokenInfo;
    try {
      const payloadJson = JSON.parse(base64url.decode(payloadPart));
      payload = TokenInfoSchema.parse(payloadJson);
    } catch {
      throw new Error('Invalid token payload format');
    }

    let user: UserInfo;
    if (typeof payload.app_callback_payload === 'string') {
      try {
        const userJson = JSON.parse(payload.app_callback_payload);
        user = UserInfoSchema.parse(userJson);
      } catch {
        throw new Error('Invalid app_callback_payload JSON format');
      }
    }

    return Object.assign({}, payload, { user });
  }

  logout(): void {
    localStorage.removeItem('access_token');
    sessionStorage.removeItem('code_verifier');
  }
}
