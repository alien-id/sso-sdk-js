import { AlienSsoSdkServerConfigSchema, AlienSsoSdkServerConfig, AuthorizeResponseSchema, AuthorizeRequestSchema, AuthorizeResponse, PollRequest, PollResponse, PollResponseSchema, PollRequestSchema, ExchangeCodeRequest, ExchangeCodeRequestSchema, ExchangeCodeResponseSchema, ExchangeCodeResponse, VerifyTokenRequest, VerifyTokenRequestSchema, VerifyTokenResponse, VerifyTokenResponseSchema, AuthorizeRequest } from "./schema";
// import { Ed25519Signer } from "./utils";
// import { createHash, randomBytes } from 'crypto';
import { sign, verify, createPrivateKey, createPublicKey } from 'crypto';
import { wrapEd25519PrivateKey } from "./utils";

const DEFAULT_SSO_BASE_URL = 'https://sso.alien-api.com';

const DEFAULT_POLLING_INTERVAL = 5000;

export class AlienSsoSdkServer {
    readonly config: AlienSsoSdkServerConfig;
    readonly pollingInterval: number;
    readonly ssoBaseUrl: string;
    // readonly signer: Ed25519Signer;

    constructor(config: AlienSsoSdkServerConfig) {
        const parsedConfig = AlienSsoSdkServerConfigSchema.parse(config);

        this.config = parsedConfig;

        // this.signer = new Ed25519Signer(parsedConfig.providerPrivateKey);

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

            console.log(
                "Signature (hex):",
                signature,
                signature === 'f1c35d6888545b4bc942096cf962451d664728ee6466c6c9255f34db8086362bdc614165eed42d0276a4890593ca32617cf5c4fa5d37cd657757aa9754f90c0b'
            );

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

            // MOCK FOR SESSION SIGNATURE
            const privateKeyBytesS = Buffer.from('20d924904b0fcebf36733b962453846077096b18f23c1e9df0820278959c5decb613c665c13e2fa4a1a5be164caf2f2b8b0051808a1ef64fa7f8f40298885581', 'hex');

            const pkcs8KeyS = wrapEd25519PrivateKey(privateKeyBytesS);

            const privateKeyS = createPrivateKey({
                key: pkcs8KeyS,
                format: 'der',
                type: 'pkcs8'
            });

            const mock = {
                "payload": {
                    "full_name": "aleksei zasulskii"
                },
                "session_address": "00000001010000000000000800000000"
            }
            const mockMessage = JSON.stringify(mock);
            const mockMessageBytes = Buffer.from(mockMessage, 'utf8');

            const mockSignature = sign(null, mockMessageBytes, privateKeyS).toString('hex');

            console.log('mockSignature===', mockSignature);


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