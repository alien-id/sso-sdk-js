import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';
import { verifyAgentTokenWithOwner, verifyAgentRequestWithOwner } from '../src';
import type { JWKS, VerifyOwnerSuccess } from '../src';

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
  const publicKeyHex = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(12) // strip SPKI prefix, 32 bytes remain
    .toString('hex');
  const privateKeyRaw = privateKey
    .export({ format: 'der', type: 'pkcs8' })
    .subarray(16) // strip PKCS8 prefix, 32 bytes remain
    .toString('hex');
  return { publicKeyPem, privateKeyPem, publicKeyHex, privateKeyRaw };
}

function generateRSA() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  return { publicKey, privateKey, jwk };
}

function fingerprintPem(pem: string): string {
  const der = createPublicKey(pem).export({ format: 'der', type: 'spki' });
  return createHash('sha256').update(der).digest('hex');
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
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

function signEd25519B64url(data: string, privateKeyPem: string): string {
  const sig = sign(null, Buffer.from(data), createPrivateKey(privateKeyPem));
  return toB64url(sig);
}

function signEd25519Hex(message: string, privateKeyPem: string): string {
  return sign(
    null,
    Buffer.from(message),
    createPrivateKey(privateKeyPem),
  ).toString('hex');
}

function buildJwt(
  payload: Record<string, unknown>,
  rsaPrivateKey: ReturnType<typeof generateRSA>['privateKey'],
  kid: string,
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const headerB64 = toB64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = toB64url(Buffer.from(JSON.stringify(payload)));
  const data = `${headerB64}.${payloadB64}`;
  const sig = sign('sha256', Buffer.from(data), rsaPrivateKey);
  return `${data}.${toB64url(sig)}`;
}

interface FullChainTokenOpts {
  agentKeys?: ReturnType<typeof generateEd25519>;
  rsa?: ReturnType<typeof generateRSA>;
  rsaKid?: string;
  owner?: string;
  ownerSessionProof?: Record<string, unknown> | null;
  idTokenPayloadOverrides?: Record<string, unknown>;
  bindingPayloadOverrides?: Record<string, unknown>;
  bindingSignatureOverride?: string;
  idTokenOverride?: string;
  idTokenHashOverride?: string;
  omitOwnerBinding?: boolean;
  omitIdToken?: boolean;
  omitOwner?: boolean;
  timestamp?: number;
}

function buildFullChainToken(opts: FullChainTokenOpts = {}) {
  const agentKeys = opts.agentKeys ?? generateEd25519();
  const rsa = opts.rsa ?? generateRSA();
  const rsaKid = opts.rsaKid ?? 'test-kid';
  const owner = opts.owner ?? '00000003010000000000539c741e0df8';
  const fp = fingerprintPem(agentKeys.publicKeyPem);

  // Build id_token
  const idTokenPayload = {
    iss: 'https://sso.alien-api.com',
    sub: owner,
    aud: 'test-provider',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...opts.idTokenPayloadOverrides,
  };
  const idToken =
    opts.idTokenOverride ?? buildJwt(idTokenPayload, rsa.privateKey, rsaKid);

  // Build owner session proof
  let ownerSessionProof: Record<string, unknown> | null = null;
  if (opts.ownerSessionProof !== undefined) {
    ownerSessionProof = opts.ownerSessionProof;
  }

  // Build owner binding payload
  const bindingPayload: Record<string, unknown> = {
    version: 1,
    issuedAt: Date.now(),
    issuer: 'https://sso.alien-api.com',
    providerAddress: 'test-provider',
    ownerSessionSub: owner,
    ownerAudience: 'test-provider',
    idTokenHash: opts.idTokenHashOverride ?? sha256Hex(idToken),
    ownerSessionProof,
    ownerSessionProofHash: ownerSessionProof
      ? sha256Hex(canonicalJSON(ownerSessionProof))
      : null,
    agentInstance: {
      hostname: 'test-host',
      publicKeyFingerprint: fp,
      publicKeyPem: agentKeys.publicKeyPem,
    },
    ...opts.bindingPayloadOverrides,
  };

  const bindingCanonical = canonicalJSON(bindingPayload);
  const bindingPayloadHash = sha256Hex(bindingCanonical);
  const bindingSignature =
    opts.bindingSignatureOverride ??
    signEd25519B64url(bindingCanonical, agentKeys.privateKeyPem);

  const ownerBinding = {
    id: randomBytes(16).toString('hex'),
    payload: bindingPayload,
    payloadHash: bindingPayloadHash,
    signature: bindingSignature,
    createdAt: Date.now(),
  };

  // Build the agent token — sign only core fields, attach proof fields after
  const corePayload: Record<string, unknown> = {
    v: 1,
    fingerprint: fp,
    publicKeyPem: agentKeys.publicKeyPem,
    timestamp: opts.timestamp ?? Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };
  if (!opts.omitOwner) {
    corePayload.owner = owner;
  }

  const canonical = canonicalJSON(corePayload);
  const sig = signEd25519B64url(canonical, agentKeys.privateKeyPem);

  const fullPayload: Record<string, unknown> = { ...corePayload, sig };
  if (!opts.omitOwnerBinding) {
    fullPayload.ownerBinding = ownerBinding;
  }
  if (!opts.omitIdToken) {
    fullPayload.idToken = idToken;
  }

  const tokenB64 = toB64url(Buffer.from(JSON.stringify(fullPayload)));

  const jwks: JWKS = {
    keys: [{ ...rsa.jwk, kty: 'RSA', kid: rsaKid, use: 'sig', alg: 'RS256' }],
  };

  return { tokenB64, jwks, agentKeys, rsa, owner, fp };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('verifyAgentTokenWithOwner', () => {
  describe('happy path', () => {
    it('verifies a full chain token without owner session proof', () => {
      const { tokenB64, jwks, fp, owner } = buildFullChainToken();
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.fingerprint).toBe(fp);
      expect(result.owner).toBe(owner);
      expect(result.ownerVerified).toBe(true);
      expect((result as VerifyOwnerSuccess).ownerProofVerified).toBe(false);
      expect((result as VerifyOwnerSuccess).issuer).toBe(
        'https://sso.alien-api.com',
      );
    });

    it('verifies a full chain token with owner session proof', () => {
      const agentKeys = generateEd25519();
      const proofKeys = generateEd25519();
      const owner = '00000003010000000000539c741e0df8';
      const seed = randomBytes(16).toString('hex');
      const message = `${owner}${seed}`;
      const sessionSignature = signEd25519Hex(message, proofKeys.privateKeyPem);

      const ownerSessionProof = {
        sessionAddress: owner,
        sessionSignature,
        sessionSignatureSeed: seed,
        sessionPublicKey: proofKeys.publicKeyHex,
        providerAddress: 'test-provider',
        signatureVerifiedAt: Math.floor(Date.now() / 1000),
      };

      const { tokenB64, jwks } = buildFullChainToken({
        agentKeys,
        owner,
        ownerSessionProof,
      });

      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ownerVerified).toBe(true);
      expect((result as VerifyOwnerSuccess).ownerProofVerified).toBe(true);
    });
  });

  describe('missing fields', () => {
    it('rejects token without ownerBinding', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        omitOwnerBinding: true,
      });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result).toEqual({
        ok: false,
        error: 'Missing field: ownerBinding',
      });
    });

    it('rejects token without idToken', () => {
      const { tokenB64, jwks } = buildFullChainToken({ omitIdToken: true });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result).toEqual({ ok: false, error: 'Missing field: idToken' });
    });

    it('rejects token without owner', () => {
      const { tokenB64, jwks } = buildFullChainToken({ omitOwner: true });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result).toEqual({
        ok: false,
        error: 'Token has no owner to verify',
      });
    });
  });

  describe('owner binding verification', () => {
    it('rejects tampered binding payload hash', () => {
      const agentKeys = generateEd25519();
      const rsa = generateRSA();
      const { tokenB64, jwks } = buildFullChainToken({ agentKeys, rsa });

      // Tamper with the payload hash — proof fields are outside the token signature
      const parsed = JSON.parse(Buffer.from(tokenB64, 'base64url').toString());
      parsed.ownerBinding.payloadHash = 'deadbeef'.repeat(8);
      const tamperedToken = toB64url(Buffer.from(JSON.stringify(parsed)));

      const result = verifyAgentTokenWithOwner(tamperedToken, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Owner binding payload hash mismatch');
    });

    it('rejects binding signed by a different key', () => {
      const agentKeys = generateEd25519();
      const otherKeys = generateEd25519();
      const { tokenB64, jwks } = buildFullChainToken({
        agentKeys,
        bindingSignatureOverride: signEd25519B64url(
          'whatever',
          otherKeys.privateKeyPem,
        ),
      });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Owner binding signature verification failed');
    });

    it('rejects binding with wrong agent fingerprint', () => {
      const otherKeys = generateEd25519();
      const { tokenB64, jwks } = buildFullChainToken({
        bindingPayloadOverrides: {
          agentInstance: {
            hostname: 'test-host',
            publicKeyFingerprint: fingerprintPem(otherKeys.publicKeyPem),
            publicKeyPem: otherKeys.publicKeyPem,
          },
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Owner binding agent fingerprint mismatch');
    });

    it('rejects binding with wrong ownerSessionSub', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        bindingPayloadOverrides: { ownerSessionSub: 'wrong-owner' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Owner binding ownerSessionSub mismatch');
    });
  });

  describe('id_token verification', () => {
    it('rejects when id_token hash does not match binding', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenHashOverride: 'deadbeef'.repeat(8),
      });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token hash does not match owner binding');
    });

    it('rejects id_token signed by wrong RSA key', () => {
      const rsa1 = generateRSA();
      const rsa2 = generateRSA();
      // Token signed by rsa1, JWKS contains rsa2
      const { tokenB64 } = buildFullChainToken({ rsa: rsa1, rsaKid: 'kid1' });
      const jwks: JWKS = {
        keys: [
          { ...rsa2.jwk, kid: 'kid1', use: 'sig', alg: 'RS256', kty: 'RSA' },
        ],
      };
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token signature verification failed');
    });

    it('rejects when no JWKS key matches kid', () => {
      const { tokenB64 } = buildFullChainToken({ rsaKid: 'kid-a' });
      const jwks: JWKS = { keys: [{ kty: 'RSA', kid: 'kid-b', use: 'sig' }] };
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('No matching JWKS key');
    });

    it('rejects when id_token sub does not match owner', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { sub: 'different-human' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token sub does not match token owner');
    });

    it('rejects JWKS key matching kid/kty but missing RSA fields (n, e)', () => {
      const { tokenB64 } = buildFullChainToken({ rsaKid: 'kid-incomplete' });
      const jwks: JWKS = {
        keys: [
          { kty: 'RSA', kid: 'kid-incomplete', use: 'sig', alg: 'RS256' } as JWKS['keys'][number],
        ],
      };
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result).toEqual({
        ok: false,
        error: 'Invalid JWKS key: missing required RSA fields (n, e)',
      });
    });

    it('accepts expired id_token (signature-only verification)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(true);
    });
  });

  describe('owner session proof', () => {
    it('rejects proof with wrong sessionAddress', () => {
      const proofKeys = generateEd25519();
      const wrongOwner = 'wrong-address';
      const seed = randomBytes(16).toString('hex');
      const sessionSignature = signEd25519Hex(
        `${wrongOwner}${seed}`,
        proofKeys.privateKeyPem,
      );

      const { tokenB64, jwks } = buildFullChainToken({
        ownerSessionProof: {
          sessionAddress: wrongOwner,
          sessionSignature,
          sessionSignatureSeed: seed,
          sessionPublicKey: proofKeys.publicKeyHex,
        },
      });

      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Owner session proof address mismatch');
    });

    it('rejects proof with invalid signature', () => {
      const proofKeys = generateEd25519();
      const otherKeys = generateEd25519();
      const owner = '00000003010000000000539c741e0df8';
      const seed = randomBytes(16).toString('hex');
      // Sign with wrong key
      const sessionSignature = signEd25519Hex(
        `${owner}${seed}`,
        otherKeys.privateKeyPem,
      );

      const { tokenB64, jwks } = buildFullChainToken({
        owner,
        ownerSessionProof: {
          sessionAddress: owner,
          sessionSignature,
          sessionSignatureSeed: seed,
          sessionPublicKey: proofKeys.publicKeyHex, // doesn't match signer
        },
      });

      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Owner session proof signature failed');
    });

    it('rejects proof with incomplete fields', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        ownerSessionProof: {
          sessionAddress: '00000003010000000000539c741e0df8',
          // missing other fields
        },
      });

      const result = verifyAgentTokenWithOwner(tokenB64, { jwks });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Incomplete owner session proof fields');
    });
  });
});

describe('verifyAgentRequestWithOwner', () => {
  it('extracts and verifies from Authorization header', () => {
    const { tokenB64, jwks, owner } = buildFullChainToken();
    const req = { headers: { authorization: `AgentID ${tokenB64}` } };
    const result = verifyAgentRequestWithOwner(req, { jwks });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.owner).toBe(owner);
    expect(result.ownerVerified).toBe(true);
  });

  it('rejects missing Authorization header', () => {
    const { jwks } = buildFullChainToken();
    const req = { headers: {} };
    const result = verifyAgentRequestWithOwner(req, { jwks });
    expect(result).toEqual({
      ok: false,
      error: 'Missing header: Authorization: AgentID <token>',
    });
  });
});
