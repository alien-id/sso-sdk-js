import { generateKeyPairSync, createSign } from 'node:crypto';
import nock from 'nock';
import { AlienSsoClient, MemoryTokenStorage } from '../../src/client';
import { TokenResponseSchema } from '../../src/schema';

const PROVIDER = '0xProvider';
const ISSUER = 'https://sso.alien.com';

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const KEYS = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' },
    kid: 'k1',
  };
})();

function signRs256(headerObj: object, payloadObj: object): string {
  const headerB64 = b64url(JSON.stringify(headerObj));
  const payloadB64 = b64url(JSON.stringify(payloadObj));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign('sha256');
  signer.update(signingInput);
  return `${signingInput}.${b64url(signer.sign(KEYS.privateKeyPem))}`;
}

function freshClient(): AlienSsoClient {
  const c = new AlienSsoClient({
    ssoBaseUrl: ISSUER,
    providerAddress: PROVIDER,
    tokenStorage: new MemoryTokenStorage(),
  });
  (c as any).injectJwks({ keys: [KEYS.jwk] });
  return c;
}

describe('TokenResponseSchema (RFC 6749 §6: refresh_token optional)', () => {
  it('parses a refresh response without refresh_token', () => {
    expect(() =>
      TokenResponseSchema.parse({
        access_token: 'at-2',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    ).not.toThrow();
  });
});

describe('refreshAccessToken (RFC 6749 §6 retention)', () => {
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    nock.cleanAll();
    (globalThis as any).sessionStorage = {
      _store: new Map<string, string>(),
      getItem(k: string) { return this._store.get(k) ?? null; },
      setItem(k: string, v: string) { this._store.set(k, v); },
      removeItem(k: string) { this._store.delete(k); },
    };
    (globalThis as any).sessionStorage.setItem('alien-sso_code_verifier', 'cv-1');
  });

  afterEach(() => nock.cleanAll());

  it('retains the prior refresh_token when refresh response omits one', async () => {
    // Initial exchange — establishes a refresh_token in storage.
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      { iss: ISSUER, sub: 'user-1', aud: PROVIDER, exp: now + 3600, iat: now },
    );
    nock(ISSUER).post('/oauth/token').reply(200, {
      access_token: 'at-1',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      refresh_token: 'rt-original',
    });
    const client = freshClient();
    await client.exchangeToken('auth-code-1');
    expect(client.getRefreshToken()).toBe('rt-original');

    // Refresh — server omits refresh_token (RFC 6749 §6 lets the AS skip it).
    nock(ISSUER).post('/oauth/token').reply(200, {
      access_token: 'at-2',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      // refresh_token intentionally absent
    });
    await client.refreshAccessToken();
    expect(client.getRefreshToken()).toBe('rt-original');
    expect(client.getAccessToken()).toBe('at-2');
  });

  it('replaces the refresh_token when the AS issues a new one', async () => {
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid: KEYS.kid },
      { iss: ISSUER, sub: 'user-1', aud: PROVIDER, exp: now + 3600, iat: now },
    );
    nock(ISSUER).post('/oauth/token').reply(200, {
      access_token: 'at-1',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      refresh_token: 'rt-1',
    });
    const client = freshClient();
    await client.exchangeToken('auth-code-1');

    nock(ISSUER).post('/oauth/token').reply(200, {
      access_token: 'at-2',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      refresh_token: 'rt-2',
    });
    await client.refreshAccessToken();
    expect(client.getRefreshToken()).toBe('rt-2');
  });
});
