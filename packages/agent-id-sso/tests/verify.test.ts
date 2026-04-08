import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { verifyAgentToken, verifyAgentRequest } from '../src';

// ─── Test helpers ─────────────────────────────────────────────────────────

function generateEd25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({
    format: 'pem',
    type: 'spki',
  }) as string;
  const privateKeyPem = privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  }) as string;
  return { publicKeyPem, privateKeyPem };
}

function fingerprintPem(pem: string): string {
  const der = createPublicKey(pem).export({ format: 'der', type: 'spki' });
  return createHash('sha256').update(der).digest('hex');
}

function toB64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

interface TokenFields {
  publicKeyPem?: string;
  privateKeyPem?: string;
  fingerprint?: string;
  timestamp?: number;
  nonce?: string;
  owner?: string | null;
  v?: number;
  extraFields?: Record<string, unknown>;
  skipSign?: boolean;
  overrideSig?: string;
}

function buildToken(opts: TokenFields = {}): string {
  const keys =
    opts.publicKeyPem && opts.privateKeyPem
      ? { publicKeyPem: opts.publicKeyPem, privateKeyPem: opts.privateKeyPem }
      : generateEd25519();

  const fp = opts.fingerprint ?? fingerprintPem(keys.publicKeyPem);

  const payload: Record<string, unknown> = {
    v: opts.v ?? 1,
    fingerprint: fp,
    publicKeyPem: keys.publicKeyPem,
    timestamp: opts.timestamp ?? Date.now(),
    nonce: opts.nonce ?? randomBytes(16).toString('hex'),
    ...(opts.owner !== undefined ? { owner: opts.owner } : {}),
    ...opts.extraFields,
  };

  if (opts.skipSign) {
    payload.sig = opts.overrideSig ?? 'invalid';
  } else {
    const canonical = canonicalJSON(payload);
    const sigBuf = sign(
      null,
      Buffer.from(canonical),
      createPrivateKey(keys.privateKeyPem),
    );
    payload.sig = opts.overrideSig ?? toB64url(sigBuf);
  }

  const json = JSON.stringify(payload);
  return toB64url(Buffer.from(json, 'utf8'));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('verifyAgentToken', () => {
  const keys = generateEd25519();

  describe('happy path', () => {
    it('verifies a valid token', () => {
      const token = buildToken(keys);
      const result = verifyAgentToken(token);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.fingerprint).toBe(fingerprintPem(keys.publicKeyPem));
      expect(result.publicKeyPem).toBe(keys.publicKeyPem);
      expect(result.owner).toBeNull();
      expect(typeof result.timestamp).toBe('number');
      expect(typeof result.nonce).toBe('string');
    });

    it('verifies a token with an owner', () => {
      const token = buildToken({ ...keys, owner: 'alice.alien' });
      const result = verifyAgentToken(token);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.owner).toBe('alice.alien');
    });

    it('verifies a token with owner explicitly set to null', () => {
      const token = buildToken({ ...keys, owner: null });
      const result = verifyAgentToken(token);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.owner).toBeNull();
    });
  });

  describe('encoding errors', () => {
    it('rejects non-base64 garbage', () => {
      const result = verifyAgentToken('!!!not-valid!!!');
      expect(result).toEqual({ ok: false, error: 'Invalid token encoding' });
    });

    it('rejects base64 that is not JSON', () => {
      const token = toB64url(Buffer.from('not json'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({ ok: false, error: 'Invalid token encoding' });
    });
  });

  describe('version check', () => {
    it('rejects version 0', () => {
      const token = buildToken({ ...keys, v: 0 });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Unsupported token version');
    });

    it('rejects version 2', () => {
      const token = buildToken({ ...keys, v: 2 });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Unsupported token version');
    });

    it('rejects missing version', () => {
      // Build a raw token without v field
      const payload: Record<string, unknown> = {
        fingerprint: fingerprintPem(keys.publicKeyPem),
        publicKeyPem: keys.publicKeyPem,
        timestamp: Date.now(),
        nonce: randomBytes(16).toString('hex'),
        sig: 'placeholder',
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Unsupported token version');
    });
  });

  describe('missing or invalid fields', () => {
    it('rejects missing sig', () => {
      const payload = {
        v: 1,
        fingerprint: fingerprintPem(keys.publicKeyPem),
        publicKeyPem: keys.publicKeyPem,
        timestamp: Date.now(),
        nonce: randomBytes(16).toString('hex'),
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({
        ok: false,
        error: 'Missing or invalid field: sig',
      });
    });

    it('rejects missing fingerprint', () => {
      const payload = {
        v: 1,
        sig: 'abc',
        publicKeyPem: keys.publicKeyPem,
        timestamp: Date.now(),
        nonce: randomBytes(16).toString('hex'),
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({
        ok: false,
        error: 'Missing or invalid field: fingerprint',
      });
    });

    it('rejects missing publicKeyPem', () => {
      const payload = {
        v: 1,
        sig: 'abc',
        fingerprint: 'abc',
        timestamp: Date.now(),
        nonce: randomBytes(16).toString('hex'),
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({
        ok: false,
        error: 'Missing or invalid field: publicKeyPem',
      });
    });

    it('rejects missing timestamp', () => {
      const payload = {
        v: 1,
        sig: 'abc',
        fingerprint: 'abc',
        publicKeyPem: keys.publicKeyPem,
        nonce: randomBytes(16).toString('hex'),
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({
        ok: false,
        error: 'Missing or invalid field: timestamp',
      });
    });

    it('rejects non-finite timestamp', () => {
      const payload = {
        v: 1,
        sig: 'abc',
        fingerprint: 'abc',
        publicKeyPem: keys.publicKeyPem,
        timestamp: Infinity,
        nonce: randomBytes(16).toString('hex'),
      };
      // Infinity becomes null in JSON, so timestamp will be null
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({
        ok: false,
        error: 'Missing or invalid field: timestamp',
      });
    });

    it('rejects missing nonce', () => {
      const payload = {
        v: 1,
        sig: 'abc',
        fingerprint: 'abc',
        publicKeyPem: keys.publicKeyPem,
        timestamp: Date.now(),
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({
        ok: false,
        error: 'Missing or invalid field: nonce',
      });
    });

    it('rejects owner that is a number', () => {
      const payload = {
        v: 1,
        sig: 'abc',
        fingerprint: 'abc',
        publicKeyPem: keys.publicKeyPem,
        timestamp: Date.now(),
        nonce: randomBytes(16).toString('hex'),
        owner: 42,
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({ ok: false, error: 'Invalid field: owner' });
    });
  });

  describe('expiry and clock skew', () => {
    it('rejects an expired token (older than maxAgeMs)', () => {
      const token = buildToken({
        ...keys,
        timestamp: Date.now() - 6 * 60 * 1000,
      });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Token expired');
    });

    it('accepts a token within maxAgeMs', () => {
      const token = buildToken({
        ...keys,
        timestamp: Date.now() - 4 * 60 * 1000,
      });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(true);
    });

    it('accepts a slightly future-dated token within clockSkewMs', () => {
      const token = buildToken({ ...keys, timestamp: Date.now() + 20 * 1000 });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(true);
    });

    it('rejects a future-dated token beyond clockSkewMs', () => {
      const token = buildToken({ ...keys, timestamp: Date.now() + 60 * 1000 });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Token expired');
    });

    it('respects custom maxAgeMs', () => {
      const token = buildToken({ ...keys, timestamp: Date.now() - 2000 });
      const result = verifyAgentToken(token, { maxAgeMs: 1000 });
      expect(result.ok).toBe(false);
    });

    it('respects custom clockSkewMs', () => {
      const token = buildToken({ ...keys, timestamp: Date.now() + 5000 });
      const result = verifyAgentToken(token, { clockSkewMs: 10_000 });
      expect(result.ok).toBe(true);
    });
  });

  describe('fingerprint verification', () => {
    it('rejects a token with a tampered fingerprint', () => {
      const token = buildToken({ ...keys, fingerprint: 'deadbeef'.repeat(8) });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Fingerprint does not match public key');
    });

    it('rejects a token with an invalid public key', () => {
      const payload = {
        v: 1,
        sig: 'abc',
        fingerprint: 'abc',
        publicKeyPem: 'not-a-pem',
        timestamp: Date.now(),
        nonce: randomBytes(16).toString('hex'),
      };
      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result).toEqual({
        ok: false,
        error: 'Invalid public key in token',
      });
    });
  });

  describe('signature verification', () => {
    it('rejects a token with an invalid signature', () => {
      const token = buildToken({
        ...keys,
        skipSign: true,
        overrideSig: toB64url(randomBytes(64)),
      });
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Signature verification failed');
    });

    it('rejects a token signed by a different key', () => {
      const otherKeys = generateEd25519();
      // Sign with otherKeys private key but include keys.publicKeyPem
      const fp = fingerprintPem(keys.publicKeyPem);
      const payload: Record<string, unknown> = {
        v: 1,
        fingerprint: fp,
        publicKeyPem: keys.publicKeyPem,
        timestamp: Date.now(),
        nonce: randomBytes(16).toString('hex'),
      };
      const canonical = canonicalJSON(payload);
      const sigBuf = sign(
        null,
        Buffer.from(canonical),
        createPrivateKey(otherKeys.privateKeyPem),
      );
      payload.sig = toB64url(sigBuf);

      const json = JSON.stringify(payload);
      const token = toB64url(Buffer.from(json, 'utf8'));
      const result = verifyAgentToken(token);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Signature verification failed');
    });
  });
});

describe('verifyAgentRequest', () => {
  const keys = generateEd25519();

  it('extracts and verifies from Authorization header', () => {
    const token = buildToken(keys);
    const req = { headers: { authorization: `AgentID ${token}` } };
    const result = verifyAgentRequest(req);
    expect(result.ok).toBe(true);
  });

  it('rejects missing Authorization header', () => {
    const req = { headers: {} };
    const result = verifyAgentRequest(req);
    expect(result).toEqual({
      ok: false,
      error: 'Missing header: Authorization: AgentID <token>',
    });
  });

  it('rejects wrong auth scheme', () => {
    const req = { headers: { authorization: 'Bearer some-token' } };
    const result = verifyAgentRequest(req);
    expect(result).toEqual({
      ok: false,
      error: 'Missing header: Authorization: AgentID <token>',
    });
  });

  it('handles extra whitespace after AgentID prefix', () => {
    const token = buildToken(keys);
    const req = { headers: { authorization: `AgentID   ${token}  ` } };
    const result = verifyAgentRequest(req);
    expect(result.ok).toBe(true);
  });

  it('passes options through to verifyAgentToken', () => {
    const token = buildToken({ ...keys, timestamp: Date.now() - 2000 });
    const req = { headers: { authorization: `AgentID ${token}` } };
    const result = verifyAgentRequest(req, { maxAgeMs: 1000 });
    expect(result.ok).toBe(false);
  });
});
