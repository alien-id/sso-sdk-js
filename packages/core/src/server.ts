import {
  AuthorizeResponseSchema,
  AuthorizeRequestSchema,
  AuthorizeResponse,
  AuthorizeRequest,
} from './schema';
import { z } from 'zod/v4-mini';
import { signAsync } from '@noble/ed25519';
import { AuthenticationError, ValidationError } from './errors';
import { joinUrl } from './utils';

const DEFAULT_SSO_BASE_URL = 'https://sso.alien-api.com';

export const AlienSsoSdkServerConfigSchema = z.object({
  providerAddress: z.string(),
  providerPrivateKey: z.string(),
  ssoBaseUrl: z.url(),
});

export type AlienSsoSdkServerConfig = z.infer<
  typeof AlienSsoSdkServerConfigSchema
>;

export class AlienSsoSdkServer {
  readonly config: AlienSsoSdkServerConfig;
  readonly ssoBaseUrl: string;

  constructor(config: AlienSsoSdkServerConfig) {
    const parsedConfig = AlienSsoSdkServerConfigSchema.parse(config);

    this.config = parsedConfig;
    this.ssoBaseUrl = parsedConfig.ssoBaseUrl || DEFAULT_SSO_BASE_URL;
  }

  async authorize(codeChallenge: string): Promise<AuthorizeResponse | null> {
    if (!codeChallenge || codeChallenge.length !== 64) {
      throw new ValidationError('Invalid code challenge');
    }

    // Note: order of fields important!
    const signaturePayload: Omit<AuthorizeRequest, 'provider_signature'> = {
      provider_address: this.config.providerAddress,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
    const message = JSON.stringify(signaturePayload);
    const messageBytes = new TextEncoder().encode(message);

    const privateKeyBytes = Buffer.from(this.config.providerPrivateKey, 'hex');

    const signature = await signAsync(messageBytes, privateKeyBytes);

    const authorizePayload: AuthorizeRequest = {
      ...signaturePayload,
      provider_signature: Buffer.from(signature).toString('hex'),
    };

    AuthorizeRequestSchema.parse(authorizePayload);

    const response = await fetch(
      joinUrl(this.config.ssoBaseUrl, '/authorize'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authorizePayload),
      },
    );

    if (!response.ok) {
      throw new AuthenticationError(
        `SSO Router Authorization failed: ${response.status} ${response.statusText} ${await response.text()}`,
      );
    }

    const json = await response.json();

    const { deep_link, polling_code, expired_at }: AuthorizeResponse =
      AuthorizeResponseSchema.parse(json);

    const deepLinkBytes = Buffer.from(deep_link, 'utf8');

    const deepLinkSignature = await signAsync(deepLinkBytes, privateKeyBytes);

    const deepLinkUrl = new URL(deep_link);

    deepLinkUrl.searchParams.set(
      'link_signature',
      Buffer.from(deepLinkSignature).toString('hex'),
    );

    return {
      deep_link: deepLinkUrl.toString(),
      polling_code,
      expired_at,
    };
  }
}
