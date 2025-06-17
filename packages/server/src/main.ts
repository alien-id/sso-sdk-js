import { AlienSSOConfigSchema, AlienSSOConfig, AuthorizeResponseSchema, AuthorizeRequestSchema, AuthorizeResponse, PollRequest, PollResponse, PollResponseSchema, PollRequestSchema, ExchangeCodeRequest, ExchangeCodeRequestSchema, ExchangeCodeResponseSchema, ExchangeCodeResponse, VerifyTokenRequest, VerifyTokenRequestSchema, VerifyTokenResponse, VerifyTokenResponseSchema, AuthorizeRequest } from "./schema";
import { Ed25519Signer, sleep } from "./utils";
import { createHash, randomBytes } from 'crypto';

const DEFAULT_BASEURL = 'https://sso.alien.com';

const DEFAULT_POLLING_INTERVAL = 5000;

export class AlienSSOClient {
    readonly config: AlienSSOConfig;
    readonly pollingInterval: number;
    readonly baseUrl: string;
    readonly signer: Ed25519Signer;

    constructor(config: AlienSSOConfig) {
        const parsedConfig = AlienSSOConfigSchema.parse(config);

        this.config = parsedConfig;

        this.signer = new Ed25519Signer(parsedConfig.providerPrivateKey);

        this.baseUrl = parsedConfig.baseUrl || DEFAULT_BASEURL;

        this.pollingInterval = parsedConfig.pollingInterval || DEFAULT_POLLING_INTERVAL;
    }

    private generateCodeVerifier(length: number = 128): string {
        return this.base64urlEncode(randomBytes(length)).slice(0, length);
    }

    private base64urlEncode(buffer: Buffer): string {
        return buffer.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    private generateCodeChallenge(codeVerifier: string): string {
        return this.base64urlEncode(createHash('sha256').update(codeVerifier).digest());
    }

    async authorize(): Promise<any> {
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = this.generateCodeChallenge(codeVerifier);

        sessionStorage.setItem('code_verifier', codeVerifier);

        const signaturePayload: Omit<AuthorizeRequest, 'provider_signature'> = {
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            provider_address: this.config.providerAddress,
        }

        const signature = this.signer.signPayload(signaturePayload);

        const authorizePayload: AuthorizeRequest = {
            ...signaturePayload,
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