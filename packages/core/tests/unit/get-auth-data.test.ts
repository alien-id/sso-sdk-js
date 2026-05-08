import { generateKeyPairSync, createSign } from 'node:crypto';
import nock from 'nock';
import { AlienSsoClient, MemoryTokenStorage } from '../../src/client';
import { UserInfoResponseSchema } from '../../src/schema';

const PROVIDER = '0xProvider';
const ISSUER = 'https://sso.alien.com';

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeRsaKeyPair(): { privateKeyPem: string; jwk: any; kid: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'k1';
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' },
    kid,
  };
}

function signRs256(headerObj: object, payloadObj: object, privateKeyPem: string): string {
  const headerB64 = b64url(JSON.stringify(headerObj));
  const payloadB64 = b64url(JSON.stringify(payloadObj));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign('sha256');
  signer.update(signingInput);
  const sig = signer.sign(privateKeyPem);
  return `${signingInput}.${b64url(sig)}`;
}

const KEYS = makeRsaKeyPair();

function freshClient(storage = new MemoryTokenStorage()): AlienSsoClient {
  const c = new AlienSsoClient({
    ssoBaseUrl: ISSUER,
    providerAddress: PROVIDER,
    tokenStorage: storage,
  });
  // Inject the JWKS for tests so no HTTP is needed during exchange.
  (c as any).injectJwks({ keys: [KEYS.jwk] });
  return c;
}

function mockTokenEndpoint(idToken: string, refreshToken: string | undefined = 'rt-1'): void {
  const body: Record<string, unknown> = {
    access_token: 'at-1',
    token_type: 'Bearer',
    expires_in: 3600,
    id_token: idToken,
  };
  if (refreshToken !== undefined) body.refresh_token = refreshToken;
  nock(ISSUER).post('/oauth/token').reply(200, body);
}

function seedSession(): void {
  // The exchange path expects a sessionStorage code_verifier from a prior
  // generateDeeplink. Stub a simple in-memory session.
  (globalThis as any).sessionStorage = {
    _store: new Map<string, string>(),
    getItem(k: string) { return this._store.get(k) ?? null; },
    setItem(k: string, v: string) { this._store.set(k, v); },
    removeItem(k: string) { this._store.delete(k); },
  };
  (globalThis as any).sessionStorage.setItem('alien-sso_code_verifier', 'cv-1');
}

describe('getAuthData (verified-on-exchange)', () => {
  const now = Math.floor(Date.now() / 1000);
  const basePayload = {
    iss: ISSUER,
    sub: 'user-1',
    aud: PROVIDER,
    exp: now + 3600,
    iat: now,
  };

  beforeEach(() => {
    nock.cleanAll();
    seedSession();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('exposes claims after a successful exchange (OIDC §3.1.3.7)', async () => {
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      basePayload,
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();
    await client.exchangeToken('auth-code-1');

    const claims = client.getAuthData();
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe('user-1');
  });

  it('rejects an exchange whose id_token has a bad signature (RFC 7519 §7.2)', async () => {
    const otherKeys = makeRsaKeyPair();
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      basePayload,
      otherKeys.privateKeyPem, // signed with a key NOT in the JWKS
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();

    await expect(client.exchangeToken('auth-code-1')).rejects.toThrow(/id_token/i);
    expect(client.getAuthData()).toBeNull();
    expect(client.getAccessToken()).toBeNull();
  });

  it('rejects an id_token whose iss does not match (OIDC §3.1.3.7.2)', async () => {
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      { ...basePayload, iss: 'https://attacker.example' },
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();
    await expect(client.exchangeToken('auth-code-1')).rejects.toThrow(/id_token/i);
  });

  it('rejects an exchange whose id_token exp is already past (RFC 7519 §4.1.4)', async () => {
    const expired = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      { ...basePayload, exp: now - 600 },
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(expired);
    const client = freshClient();
    await expect(client.exchangeToken('auth-code-1')).rejects.toThrow(/id_token/i);
    expect(client.getAuthData()).toBeNull();
  });

  it('getAuthData returns null after the cached payload exp passes (read-time re-check)', async () => {
    // Stage a payload whose exp is two seconds in the future so the
    // verifier accepts it at exchange time, then advance time past exp by
    // mutating Date.now and verify getAuthData returns null without
    // re-running the verifier.
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      { ...basePayload, exp: now + 5 },
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();
    await client.exchangeToken('auth-code-1');
    expect(client.getAuthData()).not.toBeNull();

    const realNow = Date.now;
    Date.now = () => (now + 600) * 1000;
    try {
      expect(client.getAuthData()).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('UserInfoResponse schema surfaces backend-emitted aud field', () => {
    const parsed = UserInfoResponseSchema.parse({ sub: 'user-1', aud: PROVIDER });
    expect(parsed.aud).toBe(PROVIDER);
  });

  // OIDC Core §3.1.3.7 step 11: when the client sent `nonce` on /authorize,
  // the id_token MUST replay it. We stage the request-time nonce in
  // sessionStorage (mirroring `generateDeeplink`'s persistence) and assert
  // that an id_token whose `nonce` claim does not match is rejected.
  it('rejects an id_token whose nonce does not match the request-time nonce (OIDC §3.1.3.7 step 11)', async () => {
    seedSession();
    (globalThis as any).sessionStorage.setItem('alien-sso_nonce', 'rp-nonce-A');
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      { ...basePayload, nonce: 'wrong-nonce-from-AS' },
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();
    await expect(client.exchangeToken('auth-code-1')).rejects.toThrow(/id_token/i);
    expect(client.getAuthData()).toBeNull();
  });

  it('accepts an id_token whose nonce equals the request-time nonce', async () => {
    seedSession();
    (globalThis as any).sessionStorage.setItem('alien-sso_nonce', 'rp-nonce-B');
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      { ...basePayload, nonce: 'rp-nonce-B' },
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();
    await client.exchangeToken('auth-code-1');
    expect(client.getAuthData()!.sub).toBe('user-1');
    // Single-use semantics: after a successful exchange the request-time
    // nonce must be cleared so a subsequent refresh cannot bind to it.
    expect(
      (globalThis as any).sessionStorage.getItem('alien-sso_nonce'),
    ).toBeNull();
  });

  it('rejects an id_token missing sub (RFC 7519 §4.1.2 / OIDC §3.1.3.7)', async () => {
    const { sub: _omit, ...rest } = basePayload;
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      rest,
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();
    await expect(client.exchangeToken('auth-code-1')).rejects.toThrow(/id_token/i);
    expect(client.getAuthData()).toBeNull();
  });
});

// OIDC Core 1.0 §5.3.2: "The sub Claim in the UserInfo Response MUST be
// verified to exactly match the sub Claim in the ID Token; if they do not
// match, the UserInfo Response values MUST NOT be used." Without this
// gate, an attacker that can substitute the userinfo response could
// confuse the relying party into treating one user's userinfo as another.
describe('verifyAuth — OIDC §5.3.2 userinfo.sub binding', () => {
  const now = Math.floor(Date.now() / 1000);
  const basePayload = {
    iss: ISSUER,
    sub: 'user-1',
    aud: PROVIDER,
    exp: now + 3600,
    iat: now,
  };

  beforeEach(() => {
    nock.cleanAll();
    seedSession();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  async function authedClient(): Promise<AlienSsoClient> {
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      basePayload,
      KEYS.privateKeyPem,
    );
    mockTokenEndpoint(idToken);
    const client = freshClient();
    await client.exchangeToken('auth-code-1');
    return client;
  }

  it('rejects userinfo whose sub does not match the verified id_token.sub', async () => {
    const client = await authedClient();
    nock(ISSUER).get('/oauth/userinfo').reply(200, {
      sub: 'attacker-sub',
      address: 'addr-X',
    });
    await expect(client.verifyAuth()).rejects.toThrow(/userinfo\.sub mismatch/);
    // Token-substitution defense: session is cleared on mismatch.
    expect(client.getAuthData()).toBeNull();
  });

  it('accepts userinfo whose sub matches the verified id_token.sub', async () => {
    const client = await authedClient();
    nock(ISSUER).get('/oauth/userinfo').reply(200, {
      sub: 'user-1',
      address: 'addr-1',
    });
    const userinfo = await client.verifyAuth();
    expect(userinfo).not.toBeNull();
    expect(userinfo!.sub).toBe('user-1');
  });
});
