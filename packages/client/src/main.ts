import { AuthorizeResponse, PollRequest, PollResponse, PollResponseSchema, PollRequestSchema, ExchangeCodeRequest, ExchangeCodeRequestSchema, ExchangeCodeResponseSchema, ExchangeCodeResponse, VerifyTokenRequest, VerifyTokenRequestSchema, VerifyTokenResponse, VerifyTokenResponseSchema, AlienSsoSdkClientConfig, AlienSsoSdkClientSchema } from "./schema";
import { base64UrlDecode, sleep } from "./utils";

const DEFAULT_SERVER_SDK_BASEURL = 'http://localhost:3000';

const DEFAULT_SSO_BASE_URL = 'https://sso.alien.com';

const DEFAULT_POLLING_INTERVAL = 5000;

export interface JWTHeader {
    alg: string;
    typ: string;
}

export interface AccessTokenPayload {
    app_callback_payload: unknown; // or a specific type if known
    app_callback_session_signature: string;
    app_callback_session_address: string;
    expired_at: number; // Unix timestamp
    issued_at: number;  // Unix timestamp
}

export class AlienSsoSdkClient {
    readonly config: AlienSsoSdkClientConfig;
    readonly pollingInterval: number;
    readonly serverSdkBaseUrl: string;
    readonly ssoBaseUrl: string;

    constructor(config: AlienSsoSdkClientConfig) {
        const parsedConfig = AlienSsoSdkClientSchema.parse(config);

        this.config = parsedConfig;

        // Note: it's possible to remove this fields from config
        // and get it from server client
        // but for now, we keep it for simplicity
        this.ssoBaseUrl = this.config.ssoBaseUrl || DEFAULT_SSO_BASE_URL;

        this.serverSdkBaseUrl = this.config.serverSdkBaseUrl || DEFAULT_SERVER_SDK_BASEURL;

        this.pollingInterval = this.config.pollingInterval || DEFAULT_POLLING_INTERVAL;
    }

    private generateCodeVerifier(length: number = 128) {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return this.base64urlEncode(array);
    }

    private async generateCodeChallenge(codeVerifier: string) {
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);

        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const codeChallenge = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return codeChallenge;
    }

    private base64urlEncode(buffer: Uint8Array) {
        return btoa(String.fromCharCode(...buffer))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async authorize(): Promise<AuthorizeResponse> {
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);

        sessionStorage.setItem('code_verifier', codeVerifier);

        const authorizeUrl = `${this.config.serverSdkBaseUrl}/authorize`;

        const authorizePayload = {
            code_challenge: codeChallenge,
        };

        const response = await fetch(authorizeUrl, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(authorizePayload)
        });

        const json: AuthorizeResponse = await response.json();

        return json;
    }

    async pollForAuthorization(pollingCode: string): Promise<string | null> {
        const pollPayload: PollRequest = {
            polling_code: pollingCode,
        }

        PollRequestSchema.parse(pollPayload);

        const pollingUrl = `${this.config.ssoBaseUrl}/poll`;

        while (true) {
            const response = await fetch(pollingUrl, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(pollPayload)
            });

            if (!response.ok) {
                throw new Error(`Poll failed: ${response.statusText}`);
            }

            const json = await response.json();

            const pollResponse: PollResponse = PollResponseSchema.parse(json);

            if (pollResponse.status === 'authorized' && pollResponse.authorization_code) {
                return pollResponse.authorization_code;
            }

            if (pollResponse.status === 'pending') {
                await sleep(this.pollingInterval);
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
                "Content-Type": "application/json",
            },
            body: JSON.stringify(exchangeCodePayload),
        });

        if (!response.ok) {
            throw new Error(`ExchangeCode failed: ${response.statusText}`);
        }

        const json = await response.json();

        const exchangeCodeResponse: ExchangeCodeResponse = ExchangeCodeResponseSchema.parse(json);

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
                "Content-Type": "application/json",
            },
            body: JSON.stringify(verifyTokenPayload),
        });

        if (!response.ok) {
            throw new Error(`VerifyToken failed: ${response.statusText}`);
        }

        const json = await response.json();

        const verifyTokenResponse: VerifyTokenResponse = VerifyTokenResponseSchema.parse(json);

        if (!verifyTokenResponse.is_valid) {
            throw new Error('Access token is invalid.');
        }

        return verifyTokenResponse.is_valid;
    }

    getAccessToken(): string | null {
        const accessToken = localStorage.getItem('access_token');

        return accessToken;
    }

    getUser(): any {
        const token = this.getAccessToken();

        if (!token) return null;

        const tokenParts = token.split(".");
        if (tokenParts.length !== 3) {
            throw new Error("Invalid token format");
        }

        const headerPart = tokenParts[0];

        if (!headerPart) return null;

        let header: JWTHeader;
        try {
            const headerJson = base64UrlDecode(headerPart);
            header = JSON.parse(headerJson);
        } catch {
            throw new Error("Invalid token header format");
        }

        if (header.alg !== "HS256" || header.typ !== "JWT") {
            throw new Error("Unsupported token algorithm or type");
        }

        const payloadPart = tokenParts[1];

        if (!payloadPart) return null;

        let payload: AccessTokenPayload;
        try {
            const payloadJson = base64UrlDecode(payloadPart);
            payload = JSON.parse(payloadJson);
        } catch {
            throw new Error("Invalid token payload format");
        }

        if (typeof payload.app_callback_payload === "string") {
            try {
                payload.app_callback_payload = JSON.parse(payload.app_callback_payload);
            } catch {
                throw new Error("Invalid app_callback_payload JSON format");
            }
        }

        return payload;
    }

    logout(): void {
        localStorage.removeItem('access_token');
        sessionStorage.removeItem('code_verifier');
    }
}