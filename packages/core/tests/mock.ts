import nock from 'nock';
import base64url from 'base64url';
import { generateKeyPairSync, createSign } from 'node:crypto';

function b64urlBuf(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const MOCK_KEY_PAIR = generateKeyPairSync('rsa', { modulusLength: 2048 });

export const initializeSsoMock = (baseUrl) => {
  nock(baseUrl).get('/sso/health').reply(200);

  // RFC 6749 §10.12: capture `state` from /oauth/authorize so the poll
  // endpoint can echo it back; the SDK validates the round-trip.
  let lastState: string | undefined;

  // OAuth2 authorize endpoint (GET with query params, response_mode=json)
  nock(baseUrl)
    .persist()
    .get(/\/oauth\/authorize.*/)
    .reply(function (uri) {
      try {
        const stateParam = new URL(uri, baseUrl).searchParams.get('state');
        if (stateParam) lastState = stateParam;
      } catch {
        /* ignore */
      }
      return [
        200,
        {
          deep_link: 'alienapp://authorize_session',
          polling_code: 'polling-code-test-1234-5678',
          expired_at: Math.floor(Date.now() / 1000) + 300,
        },
      ];
    });

  // OAuth2 poll endpoint — echoes captured state for CSRF round-trip.
  nock(baseUrl)
    .persist()
    .post('/oauth/poll')
    .reply(() => [
      200,
      {
        status: 'authorized',
        authorization_code: 'auth-code-test-1234-5678',
        ...(lastState ? { state: lastState } : {}),
      },
    ]);

  // Mint a real RS256-signed id_token so the SDK's verifier accepts it.
  // Reuse a process-wide key pair so multiple `initializeSsoMock` calls
  // (from CSRF round-trip tests that nock.cleanAll() between assertions)
  // produce id_tokens that verify against the JWKS already cached on the
  // client.
  const { privateKey, publicKey } = MOCK_KEY_PAIR;
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'test-key-1';
  const NONCE_KEY = 'alien-sso_nonce';

  function mintIdToken(): string {
    const tokenHeader = { alg: 'RS256', typ: 'JWT', kid };
    const now = Math.floor(Date.now() / 1000);
    // OIDC §3.1.3.7.11: a real SSO that received `nonce` on /authorize
    // MUST replay it in the id_token. The client at exchange time
    // pulls the request-time nonce out of sessionStorage (NONCE_KEY)
    // and asks the verifier to enforce equality. Mirror that here so
    // tests cover the realistic flow rather than the lax pre-cutover
    // path. When sessionStorage isn't a thing (some CSRF unit tests),
    // omit `nonce` — the verifier only enforces when expectedNonce is
    // set, which the client only does when the nonce key was written.
    const storedNonce =
      typeof sessionStorage !== 'undefined' && sessionStorage !== null
        ? sessionStorage.getItem(NONCE_KEY)
        : null;
    const tokenPayload: Record<string, unknown> = {
      // OIDC §3.1.3.7.2: iss MUST exactly match the configured issuer; we
      // pin it to the SDK's ssoBaseUrl so the verifier accepts the token.
      iss: baseUrl,
      sub: 'session-address-test',
      aud: '00000001000000000000000000000000',
      exp: now + 3600,
      iat: now,
    };
    if (storedNonce) tokenPayload.nonce = storedNonce;
    const headerB64 = base64url.encode(JSON.stringify(tokenHeader));
    const payloadB64 = base64url.encode(JSON.stringify(tokenPayload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const signer = createSign('sha256');
    signer.update(signingInput);
    return `${signingInput}.${b64urlBuf(signer.sign(privateKey))}`;
  }

  const accessToken = [
    base64url.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })),
    base64url.encode(JSON.stringify({ sub: 'session-address-test' })),
    'access-token-signature-test-1234-5678',
  ].join('.');

  // RFC 7517: serve the JWKS so the SDK can verify the id_token signature.
  nock(baseUrl)
    .persist()
    .get('/oauth/jwks')
    .reply(200, { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] });

  // OAuth2 token endpoint (form-urlencoded). Mint the id_token at
  // request time so it picks up whatever nonce sessionStorage has at
  // exchange time, mirroring how a real SSO replays the /authorize
  // nonce in the issued id_token.
  nock(baseUrl)
    .persist()
    .post('/oauth/token')
    .reply(() => [
      200,
      {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: mintIdToken(),
        refresh_token: 'refresh-token-test-1234-5678',
      },
    ]);

  // OAuth2 userinfo endpoint
  nock(baseUrl).persist().get('/oauth/userinfo').reply(200, {
    sub: 'session-address-test',
  });
};

export const initializeLocalStorageMock = () => {
  class LocalStorageMock {
    store: Record<string, any>;

    constructor() {
      this.store = {};
    }

    clear() {
      this.store = {};
    }

    getItem(key) {
      return this.store[key] || null;
    }

    setItem(key, value) {
      this.store[key] = String(value);
    }

    removeItem(key) {
      delete this.store[key];
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  global.localStorage = new LocalStorageMock();
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  global.sessionStorage = new LocalStorageMock();
};
