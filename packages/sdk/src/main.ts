import { AuthorizeRequest, Signature } from "./types";
import { AlienSSOConfigSchema, AlienSSOConfig, AuthorizeResponseSchema, AuthorizeRequestSchema, AuthorizeResponse, PollRequest, PollResponse, PollResponseSchema, PollRequestSchema, ExchangeCodeRequest, ExchangeCodeRequestSchema, ExchangeCodeResponseSchema, ExchangeCodeResponse, VerifyTokenRequest, VerifyTokenRequestSchema, VerifyTokenResponse, VerifyTokenResponseSchema } from "./schema";
import { makeSignature, sleep } from "./utils";

const DEFAULT_BASEURL = 'https://sso.alien.com';

const DEFAULT_POLLING_INTERVAL = 5000;

export class AlienSSOClient {
    readonly config: AlienSSOConfig;
    readonly pollingInterval: number;
    readonly baseUrl: string;

    constructor(config: AlienSSOConfig) {
        const parsedConfig = AlienSSOConfigSchema.parse(config);

        this.config = parsedConfig;

        this.baseUrl = this.config.baseUrl || DEFAULT_BASEURL;

        this.pollingInterval = this.config.pollingInterval || DEFAULT_POLLING_INTERVAL;
    }

    private generateCodeVerifier(): string {
        const array = new Uint32Array(56 / 2);

        window.crypto.getRandomValues(array);

        return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
    }

    private async generateCodeChallenge(codeVerifier: string): Promise<string> {
        const encoder = new TextEncoder();

        const data = encoder.encode(codeVerifier);

        const digest = await window.crypto.subtle.digest('SHA-256', data);

        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async authorize(): Promise<any> {
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);

        sessionStorage.setItem('code_verifier', codeVerifier);

        const signaturePayload: Signature = {
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            provider_address: this.config.providerAddress,
        }

        const signaturePayloadString = JSON.stringify(signaturePayload);
        const encoder = new TextEncoder();
        const encodedSignaturePayload = encoder.encode(signaturePayloadString);

        const signature = await makeSignature(encodedSignaturePayload, this.config.providerPrivateKey);

        const authorizePayload: AuthorizeRequest = {
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            provider_address: this.config.providerAddress,
            provider_signature: signature,
        };

        AuthorizeRequestSchema.parse(authorizePayload);

        const autorizationUrl = `${this.config.baseUrl}/authorize`;

        const response = await fetch(autorizationUrl, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(authorizePayload)
        });

        if (!response.ok) {
            throw new Error(`Authorization failed: ${response.statusText}`);
        }

        const json = await response.json();

        const authorizeResponse: AuthorizeResponse = AuthorizeResponseSchema.parse(json);

        return authorizeResponse;
    }

    async pollForAuthorization(pollingCode: string): Promise<string | null> {
        const pollPayload: PollRequest = {
            polling_code: pollingCode,
        }

        PollRequestSchema.parse(pollPayload);

        const pollingUrl = `${this.config.baseUrl}/poll`;

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

        const exchangeUrl = `${this.config.baseUrl}/access_token/exchange`;

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
            localStorage.setItem('access_token', exchangeCodeResponse.access_token);

            return exchangeCodeResponse.access_token;
        } else {
            throw new Error('Exchange failed');
        }
    }

    async verifyToken(): Promise<boolean> {
        const verifyTokenPayload: VerifyTokenRequest = {
            access_token: this.getAccessToken(),
        };

        VerifyTokenRequestSchema.parse(verifyTokenPayload);

        const verifyTokenUrl = `${this.config.baseUrl}/access_token/verify`;

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

    getAccessToken(): string {
        const accessToken = localStorage.getItem('access_token');

        if (!accessToken) {
            throw new Error('Access token not found. Please login first.');
        }

        return accessToken;
    }

    logout(): void {
        localStorage.removeItem('access_token');
        sessionStorage.removeItem('code_verifier');
    }
}