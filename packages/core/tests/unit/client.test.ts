import nock from 'nock';
import { AlienSsoClient, MemoryTokenStorage } from '../../src/client';

describe('AlienSsoSdkClient', () => {
  let client: AlienSsoClient;

  beforeEach(() => {
    client = new AlienSsoClient({
      ssoBaseUrl: 'https://sso.alien-api.com',
      providerAddress: '0xProviderAddress',
    });
  });

  describe('generateCodeVerifier', () => {
    it('should return a non-empty string', () => {
      const codeVerifier = (client as any).generateCodeVerifier();
      expect(typeof codeVerifier).toBe('string');
      expect(codeVerifier.length).toBeGreaterThan(0);
    });

    it('should return a base64url-encoded string', () => {
      const codeVerifier = (client as any).generateCodeVerifier();
      // Base64url: only letters, numbers, -, _
      expect(codeVerifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('should return different values on consecutive calls', () => {
      const v1 = (client as any).generateCodeVerifier();
      const v2 = (client as any).generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });

    // RFC 7636 §4.1: code_verifier "minimum length of 43 characters and a
    // maximum length of 128 characters". §7.1 recommends ≥256 bits of
    // entropy → 32 random octets.
    it('produces a verifier within the 43-128 character RFC 7636 range', () => {
      const codeVerifier = (client as any).generateCodeVerifier();
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeVerifier.length).toBeLessThanOrEqual(128);
    });

    // RFC 7636 §7.1: "The client SHOULD create a 'code_verifier' with a
    // minimum of 256 bits of entropy" produced by a CSPRNG. We refuse to
    // run without one rather than fall back to a non-cryptographic source.
    it('throws when no CSPRNG is available', () => {
      const originalGlobalCrypto = (globalThis as any).crypto;
      const originalWindow = (globalThis as any).window;
      try {
        (globalThis as any).crypto = undefined;
        (globalThis as any).window = undefined;
        expect(() => (client as any).generateCodeVerifier()).toThrow(
          /CSPRNG/i,
        );
      } finally {
        (globalThis as any).crypto = originalGlobalCrypto;
        (globalThis as any).window = originalWindow;
      }
    });
  });

  // RFC 6749 §10.16 / OAuth 2.0 BCP: tokens kept on the client MUST be
  // protected from unauthorized disclosure. Persisting refresh_tokens to
  // `localStorage` exposes them to any XSS on the origin; the default
  // storage is now in-memory and integrators must explicitly opt into
  // `LocalStorageTokenStorage` if they need persistence.
  describe('MemoryTokenStorage', () => {
    it('stores and retrieves token-bound values without touching localStorage', () => {
      const storage = new MemoryTokenStorage();
      storage.setItem('alien-sso_access_token', 'value-1');
      expect(storage.getItem('alien-sso_access_token')).toBe('value-1');
      expect(storage.getItem('not-set')).toBeNull();
      storage.removeItem('alien-sso_access_token');
      expect(storage.getItem('alien-sso_access_token')).toBeNull();
    });

    // Default is environment-aware: LocalStorage when `localStorage` is
    // available (browser), Memory otherwise (Node/SSR — no global).
    it('client without explicit tokenStorage uses localStorage when available', () => {
      const localStorageMock = {
        getItem: jest.fn().mockReturnValue(null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };
      (globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock;

      const c = new AlienSsoClient({
        ssoBaseUrl: 'https://sso.alien-api.com',
        providerAddress: '0xProvider',
      });

      // Read access must go to localStorage when the default kicked in.
      expect(c.getAccessToken()).toBeNull();
      expect(localStorageMock.getItem).toHaveBeenCalledWith(
        'alien-sso_access_token',
      );

      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    });

    it('client without explicit tokenStorage falls back to memory when localStorage is undefined', () => {
      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;

      const c = new AlienSsoClient({
        ssoBaseUrl: 'https://sso.alien-api.com',
        providerAddress: '0xProvider',
      });

      // Should not throw despite the absent localStorage global.
      expect(c.getAccessToken()).toBeNull();
    });

    it('explicit MemoryTokenStorage opts out of localStorage even when it is available', () => {
      const localStorageMock = {
        getItem: jest.fn().mockReturnValue(null),
        setItem: jest.fn(),
        removeItem: jest.fn(),
      };
      (globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock;

      const c = new AlienSsoClient({
        ssoBaseUrl: 'https://sso.alien-api.com',
        providerAddress: '0xProvider',
        tokenStorage: new MemoryTokenStorage(),
      });

      expect(c.getAccessToken()).toBeNull();
      expect(localStorageMock.getItem).not.toHaveBeenCalled();

      delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    });
  });

  // RFC 6749 §10: bearer credentials MUST be transmitted over TLS. Reject
  // ssoBaseUrl that is not https://, with a loopback exception for dev and
  // an explicit `allowInsecureSsoBaseUrl: true` opt-in for non-loopback dev
  // environments (e.g. lan.dev hostnames behind an HTTP terminator).
  describe('ssoBaseUrl scheme guard (RFC 6749 §10)', () => {
    it('accepts https://', () => {
      expect(
        () =>
          new AlienSsoClient({
            ssoBaseUrl: 'https://sso.alien-api.com',
            providerAddress: '0xProvider',
          }),
      ).not.toThrow();
    });

    it('rejects http:// for non-loopback hosts by default', () => {
      expect(
        () =>
          new AlienSsoClient({
            ssoBaseUrl: 'http://sso.example.com',
            providerAddress: '0xProvider',
          }),
      ).toThrow(/https/i);
    });

    it('accepts http://localhost without opt-in (dev loopback)', () => {
      expect(
        () =>
          new AlienSsoClient({
            ssoBaseUrl: 'http://localhost:8080',
            providerAddress: '0xProvider',
          }),
      ).not.toThrow();
    });

    it('accepts http://127.0.0.1 without opt-in (dev loopback)', () => {
      expect(
        () =>
          new AlienSsoClient({
            ssoBaseUrl: 'http://127.0.0.1:8080',
            providerAddress: '0xProvider',
          }),
      ).not.toThrow();
    });

    it('accepts http:// for non-loopback when allowInsecureSsoBaseUrl is true', () => {
      expect(
        () =>
          new AlienSsoClient({
            ssoBaseUrl: 'http://sso.lan.dev',
            providerAddress: '0xProvider',
            allowInsecureSsoBaseUrl: true,
          }),
      ).not.toThrow();
    });

    it('rejects unknown schemes (ftp://, file://) even with opt-in', () => {
      expect(
        () =>
          new AlienSsoClient({
            ssoBaseUrl: 'ftp://sso.example.com',
            providerAddress: '0xProvider',
            allowInsecureSsoBaseUrl: true,
          }),
      ).toThrow();
    });
  });

  // RFC 9207 §2.4: when the AS includes the `iss` parameter on the
  // authorization response, the Client MUST verify that it identifies
  // the expected issuer. Without this check, an AS-mix-up attacker can
  // trick the Client into delivering an authorization code from one AS
  // to a different AS.
  describe('pollAuth — RFC 9207 §2.4 iss verification', () => {
    const ISSUER = 'https://sso.alien-api.com';

    beforeEach(() => {
      nock.cleanAll();
      (globalThis as any).sessionStorage = {
        _store: new Map<string, string>(),
        getItem(k: string) {
          return this._store.get(k) ?? null;
        },
        setItem(k: string, v: string) {
          this._store.set(k, v);
        },
        removeItem(k: string) {
          this._store.delete(k);
        },
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('rejects a poll response whose iss does not equal ssoBaseUrl', async () => {
      nock(ISSUER).post('/oauth/poll').reply(200, {
        status: 'authorized',
        authorization_code: 'code-1',
        iss: 'https://attacker.example',
      });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
      });
      await expect(c.pollAuth('polling-code-1')).rejects.toThrow(/9207/);
    });

    it('accepts a poll response whose iss equals ssoBaseUrl', async () => {
      nock(ISSUER).post('/oauth/poll').reply(200, {
        status: 'authorized',
        authorization_code: 'code-1',
        iss: ISSUER,
      });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
      });
      const r = await c.pollAuth('polling-code-1');
      expect(r.authorization_code).toBe('code-1');
    });

    it('accepts a poll response that omits iss (AS does not advertise the param)', async () => {
      nock(ISSUER).post('/oauth/poll').reply(200, {
        status: 'authorized',
        authorization_code: 'code-1',
      });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
      });
      const r = await c.pollAuth('polling-code-1');
      expect(r.authorization_code).toBe('code-1');
    });

    it('accepts a pending poll heartbeat that omits state even when client persisted one', async () => {
      // Regression: state-check used to fire on every poll, breaking the
      // pending-tick path against any AS that only emits state on the
      // final authorized response.
      (
        globalThis as unknown as { sessionStorage: { setItem(k: string, v: string): void } }
      ).sessionStorage.setItem('alien-sso_state', 'persisted-state-xyz');
      nock(ISSUER).post('/oauth/poll').reply(200, { status: 'pending' });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
      });
      const r = await c.pollAuth('polling-code-1');
      expect(r.status).toBe('pending');
    });

    it('still rejects an authorized poll whose state mismatches the persisted one', async () => {
      (
        globalThis as unknown as { sessionStorage: { setItem(k: string, v: string): void } }
      ).sessionStorage.setItem('alien-sso_state', 'persisted-state-xyz');
      nock(ISSUER).post('/oauth/poll').reply(200, {
        status: 'authorized',
        authorization_code: 'code-1',
        state: 'attacker-state',
        iss: ISSUER,
      });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
      });
      await expect(c.pollAuth('polling-code-1')).rejects.toThrow(
        /state mismatch/,
      );
    });
  });

  describe('generateCodeChallenge', () => {
    it('should return a base64url-encoded SHA-256 hash', async () => {
      const codeVerifier = 'test-verifier';
      const challenge = await (client as any).generateCodeChallenge(
        codeVerifier,
      );

      expect(typeof challenge).toBe('string');
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/); // base64url only
      expect(challenge.length).toBe(43); // SHA-256 = 32 bytes = 43 base64url chars
    });

    it('should return consistent hash for same verifier', async () => {
      const verifier = 'same-verifier';
      const hash1 = await (client as any).generateCodeChallenge(verifier);
      const hash2 = await (client as any).generateCodeChallenge(verifier);
      expect(hash1).toBe(hash2);
    });

    it('should return different hashes for different verifiers', async () => {
      const hash1 = await (client as any).generateCodeChallenge('verifier1');
      const hash2 = await (client as any).generateCodeChallenge('verifier2');
      expect(hash1).not.toBe(hash2);
    });
  });

  // RFC 9449 §5: when the client wants a DPoP-bound access token, it MUST
  // send `dpop_jkt` (the JWK thumbprint of its DPoP key) on the authorize
  // request so the AS can mint the token bound to that key.
  describe('generateDeeplink — RFC 9449 §5 dpop_jkt', () => {
    const ISSUER = 'https://sso.alien-api.com';

    beforeEach(() => {
      nock.cleanAll();
      (globalThis as any).sessionStorage = {
        _store: new Map<string, string>(),
        getItem(k: string) {
          return this._store.get(k) ?? null;
        },
        setItem(k: string, v: string) {
          this._store.set(k, v);
        },
        removeItem(k: string) {
          this._store.delete(k);
        },
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('omits dpop_jkt when no dpop config is supplied', async () => {
      let queriedUrl: string | undefined;
      nock(ISSUER)
        .get('/oauth/authorize')
        .query((q) => {
          queriedUrl = JSON.stringify(q);
          return true;
        })
        .reply(200, {
          deep_link: 'x',
          polling_code: 'p',
          expired_at: 1,
        });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
      });
      await c.generateDeeplink();
      expect(queriedUrl).not.toContain('dpop_jkt');
    });

    it('sends dpop_jkt = thumbprint(publicJwk) when a DPoP keypair is configured', async () => {
      const { createDPoPKeypair, dpopJwkThumbprint } = await import(
        '../../src/dpop'
      );
      const keypair = await createDPoPKeypair();
      const expectedJkt = await dpopJwkThumbprint(keypair.publicJwk);

      let queryDpopJkt: string | undefined;
      nock(ISSUER)
        .get('/oauth/authorize')
        .query((q) => {
          queryDpopJkt = q.dpop_jkt as string | undefined;
          return true;
        })
        .reply(200, {
          deep_link: 'x',
          polling_code: 'p',
          expired_at: 1,
        });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
        dpop: { keypair },
      });
      await c.generateDeeplink();
      expect(queryDpopJkt).toBe(expectedJkt);
    });
  });

  describe('exchangeToken — RFC 9449 §5 DPoP proof on /oauth/token', () => {
    const ISSUER = 'https://sso.alien-api.com';

    beforeEach(() => {
      nock.cleanAll();
      (globalThis as any).sessionStorage = {
        _store: new Map<string, string>([['alien-sso_code_verifier', 'cv-1']]),
        getItem(k: string) {
          return this._store.get(k) ?? null;
        },
        setItem(k: string, v: string) {
          this._store.set(k, v);
        },
        removeItem(k: string) {
          this._store.delete(k);
        },
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('sends a DPoP proof header on /oauth/token when keypair is configured', async () => {
      const { createDPoPKeypair } = await import('../../src/dpop');
      const keypair = await createDPoPKeypair();

      let receivedDpop: string | undefined;
      nock(ISSUER)
        .post('/oauth/token')
        .reply(function (_uri, _body) {
          receivedDpop = (this.req.headers as any).dpop as string | undefined;
          return [
            200,
            {
              access_token: 'at',
              token_type: 'DPoP',
              expires_in: 60,
            },
          ];
        });

      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
        dpop: { keypair },
      });
      // exchangeToken's id_token verification path persists if id_token is
      // present; we omit id_token to keep this test focused on DPoP proof.
      await c.exchangeToken('auth-code-1');

      expect(receivedDpop).toBeDefined();
      const parts = (receivedDpop as string).split('.');
      expect(parts).toHaveLength(3);
      // Header.typ MUST be dpop+jwt.
      const header = JSON.parse(
        Buffer.from(parts[0], 'base64').toString('utf-8'),
      );
      expect(header.typ).toBe('dpop+jwt');
      // Payload.htm/htu must match the request.
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64').toString('utf-8'),
      );
      expect(payload.htm).toBe('POST');
      expect(payload.htu).toBe(`${ISSUER}/oauth/token`);
    });

    it('rejects token_type=Bearer when DPoP keypair is configured (silent-downgrade defense)', async () => {
      const { createDPoPKeypair } = await import('../../src/dpop');
      const keypair = await createDPoPKeypair();
      nock(ISSUER).post('/oauth/token').reply(200, {
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 60,
      });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
        dpop: { keypair },
      });
      await expect(c.exchangeToken('auth-code-1')).rejects.toThrow(
        /token_type must be DPoP/,
      );
    });

    it('omits the DPoP header when no keypair is configured (regression: Bearer flow)', async () => {
      let receivedDpop: string | undefined;
      nock(ISSUER)
        .post('/oauth/token')
        .reply(function (_uri, _body) {
          receivedDpop = (this.req.headers as any).dpop as string | undefined;
          return [
            200,
            {
              access_token: 'at',
              token_type: 'Bearer',
              expires_in: 60,
            },
          ];
        });
      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
      });
      await c.exchangeToken('auth-code-1');
      expect(receivedDpop).toBeUndefined();
    });
  });

  describe('refreshAccessToken — RFC 9449 §5 sticky-binding', () => {
    const ISSUER = 'https://sso.alien-api.com';

    beforeEach(() => {
      nock.cleanAll();
      const memStore = new Map<string, string>([
        ['alien-sso_refresh_token', 'rt-1'],
      ]);
      (globalThis as any).sessionStorage = {
        _store: memStore,
        getItem(k: string) {
          return this._store.get(k) ?? null;
        },
        setItem(k: string, v: string) {
          this._store.set(k, v);
        },
        removeItem(k: string) {
          this._store.delete(k);
        },
      };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('sends DPoP proof signed by the SAME keypair on refresh as on initial exchange', async () => {
      const { createDPoPKeypair, dpopJwkThumbprint } = await import(
        '../../src/dpop'
      );
      const keypair = await createDPoPKeypair();
      const expectedJkt = await dpopJwkThumbprint(keypair.publicJwk);

      let refreshDpop: string | undefined;
      nock(ISSUER)
        .post('/oauth/token')
        .reply(function (_uri, _body) {
          refreshDpop = (this.req.headers as any).dpop as string | undefined;
          return [
            200,
            { access_token: 'at2', token_type: 'DPoP', expires_in: 60 },
          ];
        });

      const c = new AlienSsoClient({
        ssoBaseUrl: ISSUER,
        providerAddress: '0xProvider',
        tokenStorage: new MemoryTokenStorage(),
        dpop: { keypair },
      });
      // Seed the refresh token directly into the memory storage. Construct
      // by triggering exchangeToken would also work but is heavier.
      (c as any).tokenStorage.setItem('alien-sso_refresh_token', 'rt-1');

      await c.refreshAccessToken();

      expect(refreshDpop).toBeDefined();
      const headerB64 = (refreshDpop as string).split('.')[0];
      const header = JSON.parse(
        Buffer.from(headerB64, 'base64').toString('utf-8'),
      );
      // Sticky-binding: thumbprint of the JWK in the refresh proof header
      // MUST equal the original keypair's thumbprint.
      const refreshJkt = await dpopJwkThumbprint(header.jwk);
      expect(refreshJkt).toBe(expectedJkt);
    });
  });
});
