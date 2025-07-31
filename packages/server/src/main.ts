import { AlienSsoSdkServerConfigSchema, AlienSsoSdkServerConfig, AuthorizeResponseSchema, AuthorizeRequestSchema, AuthorizeResponse, AuthorizeRequest } from "./schema";
import { sign, createPrivateKey } from 'crypto';
import { wrapEd25519PrivateKey } from "./utils";

const DEFAULT_SSO_BASE_URL = 'https://sso.alien-api.com';

const DEFAULT_POLLING_INTERVAL = 5000;

export class AlienSsoSdkServer {
    readonly config: AlienSsoSdkServerConfig;
    readonly pollingInterval: number;
    readonly ssoBaseUrl: string;

    constructor(config: AlienSsoSdkServerConfig) {
        const parsedConfig = AlienSsoSdkServerConfigSchema.parse(config);

        this.config = parsedConfig;

        this.ssoBaseUrl = parsedConfig.ssoBaseUrl || DEFAULT_SSO_BASE_URL;

        this.pollingInterval = parsedConfig.pollingInterval || DEFAULT_POLLING_INTERVAL;
    }

    async authorize(codeChallenge: string): Promise<AuthorizeResponse | null> {
        try {
            console.log('codeChallenge', codeChallenge);

            // Note: order of fields important!
            const signaturePayload: Omit<AuthorizeRequest, 'provider_signature'> = {
                provider_address: this.config.providerAddress,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256',
            }

            // Your 64-byte private key (hex: 32-byte secret + 32-byte public)
            const privateKeyBytes = Buffer.from(this.config.providerPrivateKey, 'hex');

            const pkcs8Key = wrapEd25519PrivateKey(privateKeyBytes);

            const privateKey = createPrivateKey({
                key: pkcs8Key,
                format: 'der',
                type: 'pkcs8'
            });

            const message = JSON.stringify(signaturePayload);
            const messageBytes = Buffer.from(message, 'utf8');

            const signature = sign(null, messageBytes, privateKey).toString('hex');

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

            const deepLinkBytes = Buffer.from(deep_link, 'utf8');

            const deepLinkSignature = sign(null, deepLinkBytes, privateKey).toString('hex');

            const deepLinkUrl = new URL(deep_link);

            deepLinkUrl.searchParams.set('link_signature', deepLinkSignature);

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