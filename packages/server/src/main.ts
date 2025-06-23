import { AlienSsoSdkServerConfigSchema, AlienSsoSdkServerConfig, AuthorizeResponseSchema, AuthorizeRequestSchema, AuthorizeResponse, PollRequest, PollResponse, PollResponseSchema, PollRequestSchema, ExchangeCodeRequest, ExchangeCodeRequestSchema, ExchangeCodeResponseSchema, ExchangeCodeResponse, VerifyTokenRequest, VerifyTokenRequestSchema, VerifyTokenResponse, VerifyTokenResponseSchema, AuthorizeRequest } from "./schema";
import { Ed25519Signer } from "./utils";
// import { createHash, randomBytes } from 'crypto';

const DEFAULT_SSO_BASE_URL = 'https://sso.alien.com';

const DEFAULT_POLLING_INTERVAL = 5000;

export class AlienSsoSdkServer {
    readonly config: AlienSsoSdkServerConfig;
    readonly pollingInterval: number;
    readonly ssoBaseUrl: string;
    readonly signer: Ed25519Signer;

    constructor(config: AlienSsoSdkServerConfig) {
        const parsedConfig = AlienSsoSdkServerConfigSchema.parse(config);

        this.config = parsedConfig;

        this.signer = new Ed25519Signer(parsedConfig.providerPrivateKey);

        this.ssoBaseUrl = parsedConfig.ssoBaseUrl || DEFAULT_SSO_BASE_URL;

        this.pollingInterval = parsedConfig.pollingInterval || DEFAULT_POLLING_INTERVAL;
    }

    // private base64urlEncode(buffer: Buffer): string {
    //     return buffer.toString('base64')
    //         .replace(/\+/g, '-')
    //         .replace(/\//g, '_')
    //         .replace(/=+$/, '');
    // }

    // private generateCodeVerifier(length: number = 128): string {
    //     return this.base64urlEncode(randomBytes(length)).slice(0, length);
    // }


    // private generateCodeChallenge(codeVerifier: string): string {
    //     return this.base64urlEncode(createHash('sha256').update(codeVerifier).digest());
    // }

    async authorize(codeChallenge: string): Promise<AuthorizeResponse | null> {
        try {
            console.log('codeChallenge', codeChallenge);

            const signaturePayload: Omit<AuthorizeRequest, 'provider_signature'> = {
                code_challenge_method: 'S256',
                code_challenge: codeChallenge,
                provider_address: this.config.providerAddress,
            }

            const signature = this.signer.signPayload(JSON.stringify(signaturePayload));

            const authorizePayload: AuthorizeRequest = {
                ...signaturePayload,
                provider_signature: signature,
            };

            AuthorizeRequestSchema.parse(authorizePayload);

            const autorizationUrl = `${this.config.ssoBaseUrl}/authorize`;
            console.log('authorizePayload', authorizePayload, autorizationUrl);

            const response = await fetch(autorizationUrl, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(authorizePayload)
            });

            if (!response.ok) {
                const text = await response.text();

                throw new Error(`Authorization failed: ${text}`);
            }

            const json = await response.json();

            const { deep_link, polling_code, expired_at }: AuthorizeResponse = AuthorizeResponseSchema.parse(json);

            const linkSignature = this.signer.signPayload(deep_link);

            const deepLinkUrl = new URL(deep_link);

            deepLinkUrl.searchParams.set('link_signature', linkSignature);

            return {
                deep_link: deepLinkUrl.toString(),
                polling_code,
                expired_at
            };
        } catch (error) {
            console.log("server-sdk: authorize error", error);

            return null;
        }
    }
}