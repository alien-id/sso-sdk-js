import { AuthorizeResponseSchema, AuthorizeRequestSchema, AuthorizeResponse, PollRequest, PollResponse, PollResponseSchema, PollRequestSchema, ExchangeCodeRequest, ExchangeCodeRequestSchema, ExchangeCodeResponseSchema, ExchangeCodeResponse, VerifyTokenRequest, VerifyTokenRequestSchema, VerifyTokenResponse, VerifyTokenResponseSchema, AuthorizeRequest, AlienSsoSdkClientConfig, AlienSsoSdkClientSchema } from "./schema";
import { sleep } from "./utils";

const DEFAULT_SERVER_SDK_BASEURL = 'http://localhost:3000';

const DEFAULT_SSO_BASE_URL = 'https://sso.alien.com';

const DEFAULT_POLLING_INTERVAL = 5000;

export class AlienSsoSdkClient {
    readonly config: AlienSsoSdkClientConfig;
    readonly pollingInterval: number;
    readonly serverSdkBaseUrl: string;
    readonly ssoBaseUrl: string;

    constructor(config: AlienSsoSdkClientConfig) {
        const parsedConfig = AlienSsoSdkClientSchema.parse(config);

        this.config = parsedConfig;

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
        const hashArray = new Uint8Array(hashBuffer);

        return this.base64urlEncode(hashArray);
    }

    private base64urlEncode(buffer: Uint8Array) {
        return btoa(String.fromCharCode(...buffer))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async authorize(): Promise<AuthorizeResponse> {
        const codeVerifier = 'test_code_verifier_string_which_is_long_enough'; // this.generateCodeVerifier();
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

    logout(): void {
        localStorage.removeItem('access_token');
        sessionStorage.removeItem('code_verifier');
    }
}