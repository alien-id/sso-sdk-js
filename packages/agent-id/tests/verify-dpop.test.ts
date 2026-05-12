import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import { verifyDPoPRequest } from '../src';
import type { JWKS } from '../src';

// ─── Test helpers ────────────────────────────────────────────────────────────

const EXPECTED_ISSUER = 'https://sso.alien-api.com';
const EXPECTED_AUDIENCE = 'test-resource';
const RESOURCE_URL = 'https://api.example.test/v1/whoami';

function toB64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function sha256B64url(input: string): string {
  return toB64url(createHash('sha256').update(input).digest());
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
  // Raw 32-byte public key (strip 12-byte SPKI prefix).
  const xRaw = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12);
  const x = toB64url(xRaw);
  return { publicKeyPem, privateKeyPem, jwk: { kty: 'OKP', crv: 'Ed25519', x } };
}

function generateRSA() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  return { publicKey, privateKey, jwk };
}

function jwkThumbprintOKP(jwk: { kty: string; crv: string; x: string }): string {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return toB64url(createHash('sha256').update(canonical).digest());
}

// Mint an RFC 9068 at+jwt access token signed with the test SSO RSA key.
function mintAccessToken(args: {
  rsa: ReturnType<typeof generateRSA>;
  kid: string;
  sub: string;
  agentJkt: string;
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
  payloadOverrides?: Record<string, unknown>;
  headerOverrides?: Record<string, unknown>;
}): string {
  const header = { typ: 'at+jwt', alg: 'RS256', kid: args.kid, ...(args.headerOverrides ?? {}) };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: args.iss ?? EXPECTED_ISSUER,
    sub: args.sub,
    // Mirror the SSO's `aud = [client_id, issuer]` shape so the
    // federated-audience default succeeds when callers don't pin
    // expectedAudience. Tests that exercise scope-specific behavior
    // override this explicitly.
    aud: args.aud ?? [EXPECTED_AUDIENCE, EXPECTED_ISSUER],
    iat: args.iat ?? now,
    exp: args.exp ?? now + 600,
    cnf: { jkt: args.agentJkt },
    ...(args.payloadOverrides ?? {}),
  };
  const headerB64 = toB64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = toB64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign('sha256', Buffer.from(signingInput), args.rsa.privateKey);
  return `${signingInput}.${toB64url(sig)}`;
}

// Build a DPoP proof per RFC 9449 §4.2.
function mintDPoPProof(args: {
  agent: ReturnType<typeof generateEd25519>;
  htm: string;
  htu: string;
  accessToken: string;
  iat?: number;
  jti?: string;
  payloadOverrides?: Record<string, unknown>;
  headerOverrides?: Record<string, unknown>;
}): string {
  const header = {
    typ: 'dpop+jwt',
    alg: 'EdDSA',
    jwk: args.agent.jwk,
    ...(args.headerOverrides ?? {}),
  };
  // Strip query+fragment from htu the same way RFC 9449 §4.2 requires.
  const cleanHtu = (() => {
    try {
      const u = new URL(args.htu);
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return args.htu;
    }
  })();
  const payload = {
    jti: args.jti ?? randomUUID(),
    htm: args.htm,
    htu: cleanHtu,
    iat: args.iat ?? Math.floor(Date.now() / 1000),
    ath: sha256B64url(args.accessToken),
    ...(args.payloadOverrides ?? {}),
  };
  const headerB64 = toB64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = toB64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign(null, Buffer.from(signingInput), createPrivateKey(args.agent.privateKeyPem));
  return `${signingInput}.${toB64url(sig)}`;
}

interface BuiltRequest {
  req: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
  };
  accessToken: string;
  proof: string;
  agentJkt: string;
  jwks: JWKS;
  sub: string;
}

interface BuildRequestOpts {
  method?: string;
  url?: string;
  sub?: string;
  accessTokenOverrides?: Parameters<typeof mintAccessToken>[0] extends infer P ? Partial<P> : never;
  proofOverrides?: Parameters<typeof mintDPoPProof>[0] extends infer P ? Partial<P> : never;
  authHeader?: string;            // raw override
  dpopHeader?: string | string[]; // raw override
  omitAuth?: boolean;
  omitDpop?: boolean;
}

function buildRequest(opts: BuildRequestOpts = {}): BuiltRequest {
  const agent = generateEd25519();
  const rsa = generateRSA();
  const kid = 'sso-test-kid';
  const agentJkt = jwkThumbprintOKP(agent.jwk);
  const sub = opts.sub ?? '00000003010000000000539c741e0df8';
  const method = opts.method ?? 'GET';
  const url = opts.url ?? RESOURCE_URL;

  const accessToken = mintAccessToken({
    rsa,
    kid,
    sub,
    agentJkt,
    ...(opts.accessTokenOverrides as object),
  });
  const proof = mintDPoPProof({
    agent,
    htm: method,
    htu: url,
    accessToken,
    ...(opts.proofOverrides as object),
  });

  const jwks: JWKS = {
    keys: [{ ...rsa.jwk, kty: 'RSA', kid, use: 'sig', alg: 'RS256' }],
  };

  const headers: Record<string, string | string[] | undefined> = {};
  if (!opts.omitAuth) {
    headers.authorization = opts.authHeader ?? `DPoP ${accessToken}`;
  }
  if (!opts.omitDpop) {
    headers.dpop = opts.dpopHeader ?? proof;
  }

  return {
    req: { method, url, headers },
    accessToken,
    proof,
    agentJkt,
    jwks,
    sub,
  };
}

function expectFailure(result: ReturnType<typeof verifyDPoPRequest>, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
  }
}

// Each test below corresponds to one RFC-mandated rejection. They pin
// the wire-format contract so future refactors of the internals can't
// silently weaken the verifier.
describe('verifyDPoPRequest — RFC 9449 §4.3', () => {
  it('verifies a well-formed DPoP request end-to-end', () => {
    const { req, jwks, agentJkt, sub } = buildRequest();

    const result = verifyDPoPRequest(req, {
      jwks,
      expectedIssuer: EXPECTED_ISSUER,
      expectedAudience: EXPECTED_AUDIENCE,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sub).toBe(sub);
      expect(result.jkt).toBe(agentJkt);
      expect(result.accessTokenClaims.iss).toBe(EXPECTED_ISSUER);
      expect(result.proofClaims.htm).toBe('GET');
    }
  });

  // ─── Step 1: header presence & uniqueness ──────────────────────────────────

  describe('Authorization header', () => {
    it('rejects missing Authorization', () => {
      const { req, jwks } = buildRequest({ omitAuth: true });
      expectFailure(
        verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
        'missing_authorization',
      );
    });

    it('rejects duplicate Authorization (array-valued)', () => {
      const { req, jwks, accessToken } = buildRequest({ omitAuth: true });
      req.headers.authorization = [`DPoP ${accessToken}`, `DPoP ${accessToken}`];
      expectFailure(
        verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
        'missing_authorization',
      );
    });

    it('rejects a non-DPoP scheme', () => {
      const built = buildRequest();
      built.req.headers.authorization = `Bearer ${built.accessToken}`;
      expectFailure(
        verifyDPoPRequest(built.req, { jwks: built.jwks, expectedIssuer: EXPECTED_ISSUER }),
        'invalid_scheme',
      );
    });

    it('accepts the DPoP scheme case-insensitively (RFC 7235 §2.1)', () => {
      const built = buildRequest();
      built.req.headers.authorization = `dpop ${built.accessToken}`;
      const result = verifyDPoPRequest(built.req, {
        jwks: built.jwks,
        expectedIssuer: EXPECTED_ISSUER,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('DPoP header', () => {
    it('rejects missing DPoP header', () => {
      const { req, jwks } = buildRequest({ omitDpop: true });
      expectFailure(
        verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
        'missing_dpop',
      );
    });

    it('rejects duplicate DPoP (array-valued)', () => {
      const { req, jwks, proof } = buildRequest();
      req.headers.dpop = [proof, proof];
      expectFailure(
        verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
        'missing_dpop',
      );
    });
  });

  // ─── Step 2: well-formed JWS ───────────────────────────────────────────────

  it('rejects a malformed proof JWS', () => {
    const { req, jwks } = buildRequest({ dpopHeader: 'not.a.jwt' });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'malformed_proof',
    );
  });

  // ─── Step 4: typ ───────────────────────────────────────────────────────────

  it('rejects proof when typ != dpop+jwt', () => {
    const agent = generateEd25519();
    const rsa = generateRSA();
    const kid = 'k1';
    const agentJkt = jwkThumbprintOKP(agent.jwk);
    const accessToken = mintAccessToken({ rsa, kid, sub: 's', agentJkt });
    const proof = mintDPoPProof({
      agent,
      htm: 'GET',
      htu: RESOURCE_URL,
      accessToken,
      headerOverrides: { typ: 'jwt' },
    });
    const jwks: JWKS = {
      keys: [{ ...rsa.jwk, kty: 'RSA', kid, use: 'sig', alg: 'RS256' }],
    };
    expectFailure(
      verifyDPoPRequest(
        {
          method: 'GET',
          url: RESOURCE_URL,
          headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
        },
        { jwks, expectedIssuer: EXPECTED_ISSUER },
      ),
      'bad_proof_typ',
    );
  });

  // ─── Step 5: alg ───────────────────────────────────────────────────────────

  it('rejects proof when alg != EdDSA', () => {
    // Build a proof that claims RS256 in the header but is actually
    // Ed25519-signed. Verifier MUST reject on alg before signature work.
    const agent = generateEd25519();
    const rsa = generateRSA();
    const kid = 'k1';
    const agentJkt = jwkThumbprintOKP(agent.jwk);
    const accessToken = mintAccessToken({ rsa, kid, sub: 's', agentJkt });
    const proof = mintDPoPProof({
      agent,
      htm: 'GET',
      htu: RESOURCE_URL,
      accessToken,
      headerOverrides: { alg: 'RS256' },
    });
    const jwks: JWKS = {
      keys: [{ ...rsa.jwk, kty: 'RSA', kid, use: 'sig', alg: 'RS256' }],
    };
    expectFailure(
      verifyDPoPRequest(
        {
          method: 'GET',
          url: RESOURCE_URL,
          headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
        },
        { jwks, expectedIssuer: EXPECTED_ISSUER },
      ),
      'bad_proof_alg',
    );
  });

  // ─── Step 6: jwk shape & private-member rejection ─────────────────────────

  it('rejects proof when header jwk is missing', () => {
    const { req, jwks, accessToken } = buildRequest({ omitDpop: true });
    // Hand-craft a proof without the jwk header — sign with Ed25519 but
    // omit the jwk. Verifier should reject before signature verification.
    const agent = generateEd25519();
    const headerB64 = toB64url(
      Buffer.from(JSON.stringify({ typ: 'dpop+jwt', alg: 'EdDSA' })),
    );
    const payloadB64 = toB64url(
      Buffer.from(
        JSON.stringify({
          jti: randomUUID(),
          htm: 'GET',
          htu: RESOURCE_URL,
          iat: Math.floor(Date.now() / 1000),
          ath: sha256B64url(accessToken),
        }),
      ),
    );
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = sign(null, Buffer.from(signingInput), createPrivateKey(agent.privateKeyPem));
    req.headers.dpop = `${signingInput}.${toB64url(sig)}`;
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'missing_proof_jwk',
    );
  });

  it('rejects proof when jwk has wrong kty/crv', () => {
    const agent = generateEd25519();
    const rsa = generateRSA();
    const kid = 'k1';
    const agentJkt = jwkThumbprintOKP(agent.jwk);
    const accessToken = mintAccessToken({ rsa, kid, sub: 's', agentJkt });
    const proof = mintDPoPProof({
      agent,
      htm: 'GET',
      htu: RESOURCE_URL,
      accessToken,
      headerOverrides: { jwk: { kty: 'EC', crv: 'P-256', x: 'fake' } },
    });
    const jwks: JWKS = {
      keys: [{ ...rsa.jwk, kty: 'RSA', kid, use: 'sig', alg: 'RS256' }],
    };
    expectFailure(
      verifyDPoPRequest(
        {
          method: 'GET',
          url: RESOURCE_URL,
          headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
        },
        { jwks, expectedIssuer: EXPECTED_ISSUER },
      ),
      'bad_proof_jwk',
    );
  });

  it('rejects proof when jwk leaks private member d', () => {
    const agent = generateEd25519();
    const rsa = generateRSA();
    const kid = 'k1';
    const agentJkt = jwkThumbprintOKP(agent.jwk);
    const accessToken = mintAccessToken({ rsa, kid, sub: 's', agentJkt });
    const proof = mintDPoPProof({
      agent,
      htm: 'GET',
      htu: RESOURCE_URL,
      accessToken,
      headerOverrides: { jwk: { ...agent.jwk, d: 'leaked-private-key' } },
    });
    const jwks: JWKS = {
      keys: [{ ...rsa.jwk, kty: 'RSA', kid, use: 'sig', alg: 'RS256' }],
    };
    expectFailure(
      verifyDPoPRequest(
        {
          method: 'GET',
          url: RESOURCE_URL,
          headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
        },
        { jwks, expectedIssuer: EXPECTED_ISSUER },
      ),
      'private_in_proof_jwk',
    );
  });

  // ─── Step 7: signature ─────────────────────────────────────────────────────

  it('rejects proof signed by a different key than the one in jwk', () => {
    const realAgent = generateEd25519();
    const attacker = generateEd25519();
    const rsa = generateRSA();
    const kid = 'k1';
    const agentJkt = jwkThumbprintOKP(realAgent.jwk);
    const accessToken = mintAccessToken({ rsa, kid, sub: 's', agentJkt });
    // Build the proof with realAgent's jwk in the header but signed by attacker.
    const header = { typ: 'dpop+jwt', alg: 'EdDSA', jwk: realAgent.jwk };
    const payload = {
      jti: randomUUID(),
      htm: 'GET',
      htu: RESOURCE_URL,
      iat: Math.floor(Date.now() / 1000),
      ath: sha256B64url(accessToken),
    };
    const headerB64 = toB64url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = toB64url(Buffer.from(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = sign(null, Buffer.from(signingInput), createPrivateKey(attacker.privateKeyPem));
    const proof = `${signingInput}.${toB64url(sig)}`;
    const jwks: JWKS = {
      keys: [{ ...rsa.jwk, kty: 'RSA', kid, use: 'sig', alg: 'RS256' }],
    };
    expectFailure(
      verifyDPoPRequest(
        {
          method: 'GET',
          url: RESOURCE_URL,
          headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
        },
        { jwks, expectedIssuer: EXPECTED_ISSUER },
      ),
      'bad_proof_signature',
    );
  });

  // ─── Step 8: htm ───────────────────────────────────────────────────────────

  it('rejects proof when htm does not match request method', () => {
    const { req, jwks } = buildRequest({
      method: 'GET',
      // Proof was minted for GET (default), but caller switches to POST.
    });
    req.method = 'POST';
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'bad_proof_htm',
    );
  });

  // ─── Step 9: htu ───────────────────────────────────────────────────────────

  it('rejects proof when htu does not match request URL', () => {
    const { req, jwks } = buildRequest({
      proofOverrides: { htu: 'https://other.example.test/different/path' },
    });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'bad_proof_htu',
    );
  });

  it('accepts proof when htu has query/fragment that request does not (normalized away)', () => {
    const { req, jwks } = buildRequest({
      proofOverrides: { htu: `${RESOURCE_URL}?foo=bar#frag` },
    });
    // mintDPoPProof normalizes via URL.toString(); verifier strips
    // search+hash symmetrically. Both sides land on the same URL.
    const result = verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER });
    expect(result.ok).toBe(true);
  });

  // ─── Step 11: iat freshness ────────────────────────────────────────────────

  it('rejects stale proof (iat too old)', () => {
    const past = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const { req, jwks } = buildRequest({ proofOverrides: { iat: past } });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER, proofMaxAgeSec: 30 }),
      'stale_proof',
    );
  });

  it('rejects future-dated proof (iat outside skew)', () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const { req, jwks } = buildRequest({ proofOverrides: { iat: future } });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER, proofMaxAgeSec: 30 }),
      'future_proof',
    );
  });

  // ─── Step 12: jti replay ───────────────────────────────────────────────────

  it('rejects replayed jti within the freshness window', () => {
    const { req, jwks } = buildRequest();
    const first = verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER });
    expect(first.ok).toBe(true);
    const second = verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER });
    expectFailure(second, 'replayed_proof_jti');
  });

  it('honors a caller-supplied jtiStore', () => {
    const seen = new Set<string>();
    const jtiStore = {
      has: (jti: string) => seen.has(jti),
      add: (jti: string) => {
        seen.add(jti);
      },
    };
    const { req, jwks } = buildRequest();
    expect(seen.size).toBe(0);
    const r1 = verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER, jtiStore });
    expect(r1.ok).toBe(true);
    expect(seen.size).toBe(1);
    // Second request with same proof must be rejected via the supplied store.
    const r2 = verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER, jtiStore });
    expectFailure(r2, 'replayed_proof_jti');
  });

  // ─── RFC 9068 §4: access token claims ──────────────────────────────────────

  it('rejects access_token with typ != at+jwt (cross-JWT confusion gate)', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { headerOverrides: { typ: 'JWT' } },
    });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'bad_access_token_typ',
    );
  });

  it('rejects access_token signed by a key not in JWKS', () => {
    const { req } = buildRequest();
    // Use an unrelated JWKS that doesn't contain the AT's signing kid.
    const otherRsa = generateRSA();
    const jwks: JWKS = {
      keys: [{ ...otherRsa.jwk, kty: 'RSA', kid: 'unrelated', use: 'sig', alg: 'RS256' }],
    };
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'unknown_access_token_kid',
    );
  });

  it('rejects access_token with wrong RSA signature', () => {
    const agent = generateEd25519();
    const realRsa = generateRSA();
    const fakeRsa = generateRSA();
    const kid = 'k1';
    const agentJkt = jwkThumbprintOKP(agent.jwk);
    // Mint AT with realRsa, but publish fakeRsa under the same kid — the
    // verifier looks up by kid, then signature verification fails.
    const accessToken = mintAccessToken({ rsa: realRsa, kid, sub: 's', agentJkt });
    const proof = mintDPoPProof({ agent, htm: 'GET', htu: RESOURCE_URL, accessToken });
    const jwks: JWKS = {
      keys: [{ ...fakeRsa.jwk, kty: 'RSA', kid, use: 'sig', alg: 'RS256' }],
    };
    expectFailure(
      verifyDPoPRequest(
        {
          method: 'GET',
          url: RESOURCE_URL,
          headers: { authorization: `DPoP ${accessToken}`, dpop: proof },
        },
        { jwks, expectedIssuer: EXPECTED_ISSUER },
      ),
      'bad_access_token_signature',
    );
  });

  it('rejects access_token with wrong issuer', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { iss: 'https://attacker.example' },
    });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'bad_access_token_iss',
    );
  });

  it('rejects access_token whose aud excludes expectedAudience', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { aud: 'unrelated-resource' },
    });
    expectFailure(
      verifyDPoPRequest(req, {
        jwks,
        expectedIssuer: EXPECTED_ISSUER,
        expectedAudience: EXPECTED_AUDIENCE,
      }),
      'bad_access_token_aud',
    );
  });

  // ─── Federated audience: default expectedAudience falls back to expectedIssuer
  // The Alien SSO mints `aud = [client_id, issuer]` so any agent-id
  // token presented to any Alien-aware RS satisfies the default check.

  it('accepts AT with issuer in aud array when expectedAudience is omitted (federated default)', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: {
        aud: [EXPECTED_AUDIENCE, EXPECTED_ISSUER] as unknown as string,
      },
    });
    const result = verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER });
    expect(result.ok).toBe(true);
  });

  it('accepts AT with aud === issuer string when expectedAudience is omitted', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { aud: EXPECTED_ISSUER },
    });
    const result = verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER });
    expect(result.ok).toBe(true);
  });

  it('rejects AT whose aud lacks the issuer when expectedAudience is omitted', () => {
    // Defends against id_token confusion: an id+jwt from the same SSO
    // carries `aud = client_id` only (no issuer), and would have been
    // accepted under the pre-2.1.0 "skip aud" default.
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { aud: 'some-client-id' },
    });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'bad_access_token_aud',
    );
  });

  it('accepts AT with mismatching aud when expectedAudience is false (opt-out)', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { aud: 'anything' },
    });
    const result = verifyDPoPRequest(req, {
      jwks,
      expectedIssuer: EXPECTED_ISSUER,
      expectedAudience: false,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects expired access_token', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { iat: past - 60, exp: past },
    });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'expired_access_token',
    );
  });

  // ─── RFC 9449 §6.1 + RFC 7800 §3.1: cnf.jkt binding ────────────────────────

  it('rejects access_token without cnf.jkt', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { payloadOverrides: { cnf: undefined } },
    });
    // Note: spreading {cnf: undefined} into mintAccessToken places it
    // back into the payload as undefined which is dropped at stringify.
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'missing_cnf_jkt',
    );
  });

  it('rejects access_token whose cnf.jkt does not match the DPoP key', () => {
    const { req, jwks } = buildRequest({
      accessTokenOverrides: { agentJkt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'jkt_mismatch',
    );
  });

  // ─── RFC 9449 §4.3 step 10: ath binding ───────────────────────────────────

  it('rejects proof whose ath does not match sha256(access_token)', () => {
    const { req, jwks } = buildRequest({
      proofOverrides: { payloadOverrides: { ath: sha256B64url('different-token') } },
    });
    expectFailure(
      verifyDPoPRequest(req, { jwks, expectedIssuer: EXPECTED_ISSUER }),
      'bad_proof_ath',
    );
  });
});
