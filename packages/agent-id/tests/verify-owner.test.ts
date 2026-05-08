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

// `expectedAudience` is REQUIRED on VerifyOwnerOptions; `expectedIssuer`
// is optional (defaults to Alien SSO's production endpoint). Tests pin
// both explicitly via `EXPECTED` so each call site stays compact and the
// suite is robust to changes in the library default.
const DEFAULT_EXPECTED_ISSUER = 'https://sso.alien-api.com';
const DEFAULT_EXPECTED_AUDIENCE = 'test-provider';
function EXPECTED<T extends { jwks: JWKS }>(opts: T) {
  return {
    expectedIssuer: DEFAULT_EXPECTED_ISSUER,
    expectedAudience: DEFAULT_EXPECTED_AUDIENCE,
    ...opts,
  };
}

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

// RFC 7638 thumbprint for an Ed25519 public key (PEM-encoded SPKI).
// Mirrors `ed25519JwkThumbprint` in `src/crypto.ts` so the test fixture
// stays decoupled from the production helper while producing the
// byte-identical jkt the verifier checks against `cnf.jkt`.
function ed25519Thumbprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({
    format: 'der',
    type: 'spki',
  });
  // SPKI for Ed25519 is 12 bytes of fixed prefix + 32 raw key bytes.
  const x = der.subarray(12).toString('base64url');
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
  return createHash('sha256').update(canonical).digest('base64url');
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
  /**
   * When true, builds an id_token without a `cnf.jkt` claim. Used to
   * exercise the RFC 7800 §3.1 / RFC 9449 §6.1 PoP-binding check; the
   * default fixture binds `cnf.jkt` to the agent key so the rest of the
   * suite reaches the assertions it actually targets.
   */
  omitCnf?: boolean;
  timestamp?: number;
}

function buildFullChainToken(opts: FullChainTokenOpts = {}) {
  const agentKeys = opts.agentKeys ?? generateEd25519();
  const rsa = opts.rsa ?? generateRSA();
  const rsaKid = opts.rsaKid ?? 'test-kid';
  const owner = opts.owner ?? '00000003010000000000539c741e0df8';
  const fp = fingerprintPem(agentKeys.publicKeyPem);

  // Build id_token. The default `cnf.jkt` binds the id_token to the
  // agent key per RFC 7800 §3.1 / RFC 9449 §6.1; the verifier rejects
  // tokens that lack it. Tests can drop the claim with `omitCnf` or
  // override via `idTokenPayloadOverrides.cnf` to reach the binding
  // failure modes.
  const idTokenPayload = {
    iss: 'https://sso.alien-api.com',
    sub: owner,
    aud: 'test-provider',
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...(opts.omitCnf
      ? {}
      : { cnf: { jkt: ed25519Thumbprint(agentKeys.publicKeyPem) } }),
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
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));

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

      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));

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
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result).toEqual({
        ok: false,
        error: 'Missing field: ownerBinding',
      });
    });

    it('rejects token without idToken', () => {
      const { tokenB64, jwks } = buildFullChainToken({ omitIdToken: true });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result).toEqual({ ok: false, error: 'Missing field: idToken' });
    });

    it('rejects token without owner', () => {
      const { tokenB64, jwks } = buildFullChainToken({ omitOwner: true });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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

      const result = verifyAgentTokenWithOwner(tamperedToken, EXPECTED({ jwks }));
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
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Owner binding agent fingerprint mismatch');
    });

    it('rejects binding with wrong ownerSessionSub', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        bindingPayloadOverrides: { ownerSessionSub: 'wrong-owner' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token signature verification failed');
    });

    it('rejects when no JWKS key matches kid', () => {
      const { tokenB64 } = buildFullChainToken({ rsaKid: 'kid-a' });
      const jwks: JWKS = { keys: [{ kty: 'RSA', kid: 'kid-b', use: 'sig' }] };
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('No matching JWKS key');
    });

    it('rejects when id_token sub does not match owner', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { sub: 'different-human' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token sub does not match token owner');
    });

    // RFC 7515 §4.1.11: an extension with `crit` header that the verifier
    // does not understand MUST be rejected before signature verification.
    it('rejects id_token with an unrecognized crit header', () => {
      const agentKeys = generateEd25519();
      const rsa = generateRSA();
      const rsaKid = 'kid-crit';
      const owner = '00000003010000000000539c741e0df8';

      const idTokenPayload = {
        iss: 'https://sso.alien-api.com',
        sub: owner,
        aud: 'test-provider',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      const headerB64 = toB64url(
        Buffer.from(
          JSON.stringify({
            alg: 'RS256',
            typ: 'JWT',
            kid: rsaKid,
            crit: ['unknown-extension'],
            'unknown-extension': 'value',
          }),
        ),
      );
      const payloadB64 = toB64url(Buffer.from(JSON.stringify(idTokenPayload)));
      const sig = sign(
        'sha256',
        Buffer.from(`${headerB64}.${payloadB64}`),
        rsa.privateKey,
      );
      const idToken = `${headerB64}.${payloadB64}.${toB64url(sig)}`;

      const { tokenB64, jwks } = buildFullChainToken({
        agentKeys,
        rsa,
        rsaKid,
        owner,
        idTokenOverride: idToken,
        idTokenHashOverride: sha256Hex(idToken),
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Unrecognized JWT crit header');
    });

    // RFC 7515 §10.7: a JWK that pins an `alg` MUST be matched against the
    // declared header alg before signature verification.
    it('rejects JWK whose alg does not match RS256', () => {
      const { tokenB64, rsa } = buildFullChainToken({ rsaKid: 'kid-mismatch' });
      const jwks: JWKS = {
        keys: [
          {
            ...rsa.jwk,
            kty: 'RSA',
            kid: 'kid-mismatch',
            use: 'sig',
            alg: 'PS256',
          } as JWKS['keys'][number],
        ],
      };
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('No matching JWKS key');
    });

    it('rejects JWKS key matching kid/kty but missing RSA fields (n, e)', () => {
      const { tokenB64 } = buildFullChainToken({ rsaKid: 'kid-incomplete' });
      const jwks: JWKS = {
        keys: [
          { kty: 'RSA', kid: 'kid-incomplete', use: 'sig', alg: 'RS256' } as JWKS['keys'][number],
        ],
      };
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result).toEqual({
        ok: false,
        error: 'Invalid JWKS key: missing required RSA fields (n, e)',
      });
    });

    // RFC 7519 §4.1.4: "the current date/time MUST be before the expiration
    // date/time listed in the 'exp' claim."
    it('rejects expired id_token (RFC 7519 §4.1.4)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token expired');
    });

    // RFC 7519 §4.1.5: "the current date/time MUST be after or equal to the
    // not-before date/time listed in the 'nbf' claim."
    it('rejects id_token with future nbf (RFC 7519 §4.1.5)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          nbf: Math.floor(Date.now() / 1000) + 3600, // not valid for an hour
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token not yet valid');
    });

    // RFC 8725 §3.7 / RFC 7515 §4.1.9: id_token typ MUST distinguish from
    // the AT profile to defend against cross-JWT confusion. A token typed
    // `at+jwt` masquerading as an id_token must be rejected before any
    // claim-based decision.
    it('rejects id_token whose header typ is at+jwt (RFC 8725 §3.7)', () => {
      const rsa = generateRSA();
      const rsaKid = 'kid-typ';
      const owner = '00000003010000000000539c741e0df8';
      const idTokenPayload = {
        iss: 'https://sso.alien-api.com',
        sub: owner,
        aud: 'test-provider',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      };
      // Hand-rolled with typ=at+jwt instead of JWT.
      const headerB64 = toB64url(
        Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'at+jwt', kid: rsaKid })),
      );
      const payloadB64 = toB64url(Buffer.from(JSON.stringify(idTokenPayload)));
      const sig = sign('sha256', Buffer.from(`${headerB64}.${payloadB64}`), rsa.privateKey);
      const idToken = `${headerB64}.${payloadB64}.${toB64url(sig)}`;

      const { tokenB64, jwks } = buildFullChainToken({
        rsa,
        rsaKid,
        owner,
        idTokenOverride: idToken,
        idTokenHashOverride: sha256Hex(idToken),
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/Unexpected id_token typ/);
    });

    // RFC 7515 §2 / RFC 4648 §5: each compact-JWS segment MUST consist of
    // [A-Za-z0-9_-] only, with no padding or whitespace. A token whose
    // id_token has whitespace inside a segment must be rejected before any
    // crypto runs.
    it('rejects id_token whose segment has non-canonical base64url characters (RFC 7515 §2)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenOverride: 'aGVhZGVy.cGF5\nbG9hZA.c2ln',
        idTokenHashOverride: sha256Hex('aGVhZGVy.cGF5\nbG9hZA.c2ln'),
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Invalid id_token encoding');
    });

    // RFC 7519 §4.1.6: "iat" (issued at) MUST be a NumericDate when present.
    // A non-numeric iat indicates a malformed token and must be rejected
    // before claim values are trusted.
    it('rejects id_token with non-numeric iat (RFC 7519 §4.1.6)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          iat: '1700000000', // string, not NumericDate
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token iat must be NumericDate');
    });

    // RFC 7519 §4.1.1: When the consumer of a JWT has an expected issuer,
    // the iss MUST exactly match.
    it('rejects id_token with wrong iss', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { iss: 'https://attacker.example' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token issuer mismatch');
    });

    // RFC 7519 §4.1.3: "If the principal processing the claim does not
    // identify itself with a value in the 'aud' claim ... the JWT MUST be
    // rejected." expectedAudience is REQUIRED on options.
    it('rejects id_token with wrong aud', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { aud: 'someone-else' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token audience mismatch');
    });

    // expectedAudience accepts string or string-array aud (RFC 7519 §4.1.3).
    // Multi-aud requires the caller to widen `trustedAudiences` per OIDC
    // §3.1.3.7 step 3.
    it('accepts id_token aud array containing expectedAudience when trust set is widened', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          aud: ['someone-else', 'test-provider'],
          azp: 'test-provider',
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, {
        ...EXPECTED({ jwks }),
        trustedAudiences: ['test-provider', 'someone-else'],
      });
      expect(result.ok).toBe(true);
    });

    // OIDC §3.1.3.7 step 3: "The ID Token MUST be rejected if it ...
    // contains additional audiences not trusted by the Client." Default
    // trust set is {expectedAudience}; an unwidened multi-aud token must
    // be rejected even when azp is present and matches.
    it('rejects multi-audience id_token whose extra aud is not in default trust set (OIDC §3.1.3.7 step 3)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          aud: ['test-provider', 'rogue'],
          azp: 'test-provider',
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token aud not in trustedAudiences');
    });

    // OIDC §3.1.3.7.6: with multi-audience id_tokens, `azp` MUST be present
    // and equal to expectedAudience (the Client's id). Trust set is widened
    // here so the test isolates the azp-presence rule from the §3.1.3.7
    // step 3 trust check.
    it('rejects multi-audience id_token without azp (OIDC §3.1.3.7.6)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          aud: ['someone-else', 'test-provider'],
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, {
        ...EXPECTED({ jwks }),
        trustedAudiences: ['test-provider', 'someone-else'],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token azp missing for multi-audience');
    });

    it('rejects multi-audience id_token with mismatched azp (OIDC §3.1.3.7.6)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          aud: ['someone-else', 'test-provider'],
          azp: 'someone-else',
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, {
        ...EXPECTED({ jwks }),
        trustedAudiences: ['test-provider', 'someone-else'],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token azp mismatch');
    });

    // OIDC §3.1.3.7.7: when azp is present at all, it MUST equal the
    // Client's id. Single-audience tokens are not exempt.
    it('rejects single-audience id_token with mismatched azp (OIDC §3.1.3.7.7)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { azp: 'someone-else' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token azp mismatch');
    });

    // RFC 7800 §3.1 / RFC 9449 §6.1: the id_token MUST carry a `cnf.jkt`
    // PoP confirmation. Without it the id_token is not bound to the
    // presenting agent — an attacker who steals an id_token could replay
    // it across a fabricated binding and proof bundle.
    it('rejects id_token missing cnf.jkt (RFC 7800 §3.1, RFC 9449 §6.1)', () => {
      const { tokenB64, jwks } = buildFullChainToken({ omitCnf: true });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token missing cnf.jkt');
    });

    // RFC 7800 §3.1: cnf.jkt MUST be the RFC 7638 thumbprint of the
    // presenter's key. A non-matching thumbprint is a binding violation
    // even if every other claim verifies.
    it('rejects id_token whose cnf.jkt does not bind to the agent key', () => {
      const otherKeys = generateEd25519();
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: {
          cnf: { jkt: ed25519Thumbprint(otherKeys.publicKeyPem) },
        },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token cnf.jkt does not bind to agent key');
    });
  });

  describe('RFC 7519 §4.1.5 nbf NumericDate', () => {
    it('rejects id_token whose nbf is a string (not a NumericDate)', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { nbf: 'not-a-number' },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token nbf must be NumericDate');
    });

    it('still rejects future numeric nbf', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { nbf: Math.floor(Date.now() / 1000) + 3600 },
      });
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token not yet valid');
    });

    it('accepts id_token with no nbf', () => {
      const { tokenB64, jwks } = buildFullChainToken();
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
      expect(result.ok).toBe(true);
    });
  });

  describe('expectedNonce (OIDC §3.1.3.7 step 11)', () => {
    it('rejects id_token whose nonce does not match expectedNonce', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { nonce: 'minted-by-AS-for-some-other-request' },
      });
      const result = verifyAgentTokenWithOwner(
        tokenB64,
        EXPECTED({ jwks, expectedNonce: 'the-nonce-the-RP-actually-sent' }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token nonce mismatch');
    });

    it('rejects id_token missing nonce when expectedNonce is supplied', () => {
      const { tokenB64, jwks } = buildFullChainToken();
      const result = verifyAgentTokenWithOwner(
        tokenB64,
        EXPECTED({ jwks, expectedNonce: 'rp-nonce' }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('id_token nonce mismatch');
    });

    it('accepts id_token whose nonce equals expectedNonce', () => {
      const { tokenB64, jwks } = buildFullChainToken({
        idTokenPayloadOverrides: { nonce: 'rp-supplied-nonce-abcdef' },
      });
      const result = verifyAgentTokenWithOwner(
        tokenB64,
        EXPECTED({ jwks, expectedNonce: 'rp-supplied-nonce-abcdef' }),
      );
      expect(result.ok).toBe(true);
    });

    it('does not require nonce when expectedNonce is not supplied (RP did not request one)', () => {
      const { tokenB64, jwks } = buildFullChainToken();
      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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

      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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

      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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

      const result = verifyAgentTokenWithOwner(tokenB64, EXPECTED({ jwks }));
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
    const result = verifyAgentRequestWithOwner(req, EXPECTED({ jwks }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.owner).toBe(owner);
    expect(result.ownerVerified).toBe(true);
  });

  it('rejects missing Authorization header', () => {
    const { jwks } = buildFullChainToken();
    const req = { headers: {} };
    const result = verifyAgentRequestWithOwner(req, EXPECTED({ jwks }));
    expect(result).toEqual({
      ok: false,
      error: 'Missing header: Authorization: AgentID <token>',
    });
  });
});
