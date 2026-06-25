import { createSign, generateKeyPairSync } from 'node:crypto';
import { vi } from 'vitest';

export const SSO_URL = 'http://localhost:4710';

// A unique providerAddress per test scopes the cache keys, so entries don't
// leak across tests on the module-level QueryClient.
let testSeq = 0;
export const makeConfig = () => ({
  ssoBaseUrl: SSO_URL,
  providerAddress: String(++testSeq).padStart(32, '0'),
  pollingInterval: 25,
});

export type SsoCalls = { authorize: number; poll: number; token: number };

export interface MockSsoOptions {
  /** Poll responses, one per poll call; the last entry repeats. */
  pollStatuses?: string[];
  /** When set, /oauth/token responds with this HTTP status instead of 200. */
  tokenStatus?: number;
  /**
   * Omit the id_token from the token response. The exchange still resolves
   * (access_token persists), but no session is established (getAuthData stays
   * null) — the no-valid-session case.
   */
  omitIdToken?: boolean;
}

// --- id_token minting (mirrors the real RS256 OIDC id_token) ----------------
// The SDK verifies the id_token against /oauth/jwks before establishing a
// session, so a realistic success path must serve a signed token + JWKS.
const NONCE_KEY = 'alien-sso_nonce';
const KID = 'test-key-1';
const KEY_PAIR = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_JWK = KEY_PAIR.publicKey.export({ format: 'jwk' });

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64url');

// `audience` must equal the client's providerAddress (read from the token
// request's client_id); `iss` must equal ssoBaseUrl exactly; `nonce` must
// replay the value generateDeeplink stored — all enforced by verifyIdToken.
function mintIdToken(audience: string): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const now = Math.floor(Date.now() / 1000);
  const nonce =
    typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(NONCE_KEY)
      : null;
  const payload: Record<string, unknown> = {
    iss: SSO_URL,
    sub: 'session-address-test',
    aud: audience,
    exp: now + 3600,
    iat: now,
  };
  if (nonce) payload.nonce = nonce;
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign('sha256');
  signer.update(signingInput);
  return `${signingInput}.${b64url(signer.sign(KEY_PAIR.privateKey))}`;
}

/** In-process SSO server mocked at the global-fetch boundary. Returns a live
 *  call counter. */
export function mockSso({
  pollStatuses = ['pending'],
  tokenStatus = 200,
  omitIdToken = false,
}: MockSsoOptions = {}) {
  const calls: SsoCalls = { authorize: 0, poll: 0, token: 0 };
  let state: string | null = null;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/oauth/authorize') {
        calls.authorize++;
        state = url.searchParams.get('state');
        return json({
          deep_link: `alien://auth?n=${calls.authorize}`,
          polling_code: `poll-code-${testSeq}-${calls.authorize}`,
          expired_at: Math.floor(Date.now() / 1000) + 300,
        });
      }
      if (url.pathname === '/oauth/jwks') {
        return json({ keys: [{ ...PUBLIC_JWK, kid: KID, alg: 'RS256', use: 'sig' }] });
      }
      if (url.pathname === '/oauth/poll') {
        calls.poll++;
        const status =
          pollStatuses[Math.min(calls.poll, pollStatuses.length) - 1];
        return json(
          status === 'authorized'
            ? {
                status,
                // Rotates per authorize() generation, mirroring the server
                // issuing a fresh code for each new deeplink/poll session.
                authorization_code: `auth-code-${testSeq}-${calls.authorize}`,
                state,
              }
            : { status },
        );
      }
      if (url.pathname === '/oauth/token') {
        calls.token++;
        if (tokenStatus !== 200) return json({ error: 'server_error' }, tokenStatus);
        // The id_token's audience must match the client_id (providerAddress)
        // sent in the form body, or verifyIdToken rejects it.
        const audience =
          new URLSearchParams(String(init?.body ?? '')).get('client_id') ?? '';
        const body: Record<string, unknown> = {
          access_token: `at-${calls.token}`,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: `rt-${calls.token}`,
        };
        if (!omitIdToken) body.id_token = mintIdToken(audience);
        return json(body);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );

  return calls;
}

export const qrLoadingIndicator = () =>
  document.querySelector('[class*="qrCodeSpin"]');
