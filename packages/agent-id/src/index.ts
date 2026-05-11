import { createHash } from 'node:crypto';
import { jwkThumbprintOKP, verifyEdDsaJwt, verifyRS256 } from './crypto';
export { fetchAlienJWKS, DEFAULT_SSO_BASE_URL } from './jwt';
import { DEFAULT_SSO_BASE_URL, parseJwt } from './jwt';
import type {
  JWK,
  VerifyDPoPFailure,
  VerifyDPoPOptions,
  VerifyDPoPResult,
} from './types';

export type {
  JWK,
  JWKS,
  DPoPJtiStore,
  VerifyDPoPFailure,
  VerifyDPoPOptions,
  VerifyDPoPResult,
  VerifyDPoPSuccess,
} from './types';

// ─── RFC 9449 DPoP verifier ────────────────────────────────────────────────

function fail(code: string, error: string): VerifyDPoPFailure {
  return { ok: false, code, error };
}

// Module-scoped default jti replay cache. Single-process; production
// callers should pass a shared store via `opts.jtiStore`.
const defaultJtiSeen = new Map<string, number>();
const DEFAULT_JTI_CACHE_MAX = 10_000;

const defaultJtiStore = {
  has(jti: string): boolean {
    return defaultJtiSeen.has(jti);
  },
  add(jti: string, iat: number): void {
    if (defaultJtiSeen.size >= DEFAULT_JTI_CACHE_MAX) {
      const oldest = defaultJtiSeen.keys().next().value as string | undefined;
      if (oldest !== undefined) defaultJtiSeen.delete(oldest);
    }
    defaultJtiSeen.set(jti, iat);
  },
};

function normalizeHtu(input: string): string {
  const u = new URL(input);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * Verify an inbound HTTP request that carries an RFC 9449 DPoP proof
 * alongside an Alien at+jwt access token.
 *
 * Walks the RFC 9449 §4.3 checklist plus the §6.1 / RFC 7800 §3.1
 * cnf.jkt binding and the RFC 9068 §4 access-token claim checks. On
 * success, the caller can trust `sub` (the human owner per the SSO's
 * signature) and `jkt` (the agent's DPoP key thumbprint per the
 * proof's own signature).
 *
 * No custom envelope: every fact this function trusts is signed either
 * by the SSO (over standard at+jwt claims) or by the agent (over the
 * RFC 9449-defined DPoP proof claims).
 */
export function verifyDPoPRequest(
  req: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
  },
  opts: VerifyDPoPOptions,
): VerifyDPoPResult {
  // §4.3 step 1: exactly one Authorization header carrying the DPoP scheme.
  const authHeader = req.headers.authorization ?? req.headers.Authorization;
  if (Array.isArray(authHeader) || typeof authHeader !== 'string' || !authHeader) {
    return fail('missing_authorization', 'Missing or duplicate Authorization header');
  }
  // RFC 7235 §2.1: scheme names compare case-insensitively.
  const authMatch = /^DPoP\s+(\S+)$/i.exec(authHeader);
  if (!authMatch) {
    return fail('invalid_scheme', 'Expected `Authorization: DPoP <access_token>`');
  }
  const accessToken = authMatch[1];

  // §4.3 step 1: exactly one DPoP proof header.
  const dpopHeader = req.headers.dpop ?? req.headers.DPoP;
  if (Array.isArray(dpopHeader) || typeof dpopHeader !== 'string' || !dpopHeader) {
    return fail('missing_dpop', 'Missing or duplicate DPoP header');
  }

  // §4.3 step 2: proof is a well-formed JWS.
  let proof: ReturnType<typeof parseJwt>;
  try {
    proof = parseJwt(dpopHeader);
  } catch (err) {
    return fail('malformed_proof', `Proof not a valid JWS: ${(err as Error).message}`);
  }

  // §4.3 step 4: typ MUST be dpop+jwt.
  if (proof.header.typ !== 'dpop+jwt') {
    return fail('bad_proof_typ', `Proof typ must be 'dpop+jwt', got ${String(proof.header.typ)}`);
  }
  // §4.3 step 5: alg MUST be asymmetric, not none. Alien agents are
  // Ed25519, so EdDSA only.
  if (proof.header.alg !== 'EdDSA') {
    return fail('bad_proof_alg', `Proof alg must be 'EdDSA', got ${String(proof.header.alg)}`);
  }
  // §4.3 step 6: jwk in header, public only.
  const proofJwk = proof.header.jwk as
    | { kty?: unknown; crv?: unknown; x?: unknown; d?: unknown }
    | undefined;
  if (!proofJwk || typeof proofJwk !== 'object') {
    return fail('missing_proof_jwk', 'Proof header missing `jwk`');
  }
  if (proofJwk.kty !== 'OKP' || proofJwk.crv !== 'Ed25519' || typeof proofJwk.x !== 'string') {
    return fail('bad_proof_jwk', 'Proof jwk must be {kty:OKP, crv:Ed25519, x}');
  }
  if ('d' in proofJwk) {
    return fail('private_in_proof_jwk', 'Proof jwk leaks private member `d`');
  }

  // §4.3 step 7: signature verifies with the embedded jwk.
  let proofSigOk: boolean;
  try {
    proofSigOk = verifyEdDsaJwt(
      proof.headerB64url,
      proof.payloadB64url,
      proof.signatureB64url,
      proofJwk,
    );
  } catch (err) {
    return fail('proof_sig_error', (err as Error).message);
  }
  if (!proofSigOk) {
    return fail('bad_proof_signature', 'Proof signature failed verification');
  }

  // §4.3 step 8: htm matches request method (case-sensitive).
  if (proof.payload.htm !== req.method) {
    return fail(
      'bad_proof_htm',
      `Proof htm ${String(proof.payload.htm)} != request method ${req.method}`,
    );
  }

  // §4.3 step 9: htu matches request URL, query+fragment stripped, with
  // symmetric URL normalization.
  let requestHtu: string;
  let claimedHtu: string;
  try {
    requestHtu = normalizeHtu(req.url);
    claimedHtu = normalizeHtu(String(proof.payload.htu));
  } catch {
    return fail('bad_proof_htu', 'Proof htu is not a parseable URL');
  }
  if (claimedHtu !== requestHtu) {
    return fail('bad_proof_htu', `Proof htu ${claimedHtu} != request URL ${requestHtu}`);
  }

  // §4.3 step 11: iat within ±maxAge window.
  const proofMaxAgeSec = opts.proofMaxAgeSec ?? 30;
  if (typeof proof.payload.iat !== 'number') {
    return fail('bad_proof_iat', 'Proof iat is not a NumericDate');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - proof.payload.iat;
  if (ageSec > proofMaxAgeSec) {
    return fail('stale_proof', `Proof age ${ageSec}s > max ${proofMaxAgeSec}s`);
  }
  if (ageSec < -proofMaxAgeSec) {
    return fail('future_proof', `Proof iat ${-ageSec}s in the future`);
  }

  // §4.3 step 12: jti not previously seen.
  if (typeof proof.payload.jti !== 'string' || !proof.payload.jti) {
    return fail('missing_proof_jti', 'Proof missing jti');
  }
  const jtiStore = opts.jtiStore ?? defaultJtiStore;
  if (jtiStore.has(proof.payload.jti)) {
    return fail('replayed_proof_jti', 'Proof jti has already been seen');
  }

  // §4.3 step 10 + RFC 9068 §4: parse + verify the access_token.
  let at: ReturnType<typeof parseJwt>;
  try {
    at = parseJwt(accessToken);
  } catch (err) {
    return fail('malformed_access_token', `access_token not a JWS: ${(err as Error).message}`);
  }
  // RFC 9068 §2.1 + §4: typ MUST be at+jwt (or application/at+jwt).
  const atTypRaw = at.header.typ;
  const atTyp = typeof atTypRaw === 'string' ? atTypRaw.toLowerCase() : '';
  if (atTyp !== 'at+jwt' && atTyp !== 'application/at+jwt') {
    return fail(
      'bad_access_token_typ',
      `access_token typ must be 'at+jwt' (RFC 9068 §4), got ${String(atTypRaw)}`,
    );
  }

  // Resolve the signing key from the SSO JWKS.
  const atAlg = at.header.alg;
  if (atAlg !== 'RS256') {
    return fail('bad_access_token_alg', `access_token alg must be RS256, got ${String(atAlg)}`);
  }
  const kid = at.header.kid as string | undefined;
  const jwk = opts.jwks.keys.find(
    (k: JWK) =>
      k.kid === kid &&
      k.kty === 'RSA' &&
      (k.use === 'sig' || !k.use) &&
      (!k.alg || k.alg === 'RS256'),
  );
  if (!jwk) {
    return fail('unknown_access_token_kid', `No JWKS entry for kid=${String(kid)}`);
  }
  let atSigOk: boolean;
  try {
    atSigOk = verifyRS256(at.headerB64url, at.payloadB64url, at.signatureB64url, jwk);
  } catch (err) {
    return fail('access_token_sig_error', (err as Error).message);
  }
  if (!atSigOk) {
    return fail('bad_access_token_signature', 'access_token signature failed verification');
  }

  // RFC 9068 §4: claim checks.
  const expectedIssuer = opts.expectedIssuer ?? DEFAULT_SSO_BASE_URL;
  if (at.payload.iss !== expectedIssuer) {
    return fail(
      'bad_access_token_iss',
      `access_token iss ${String(at.payload.iss)} != ${expectedIssuer}`,
    );
  }
  if (opts.expectedAudience !== undefined) {
    const aud = at.payload.aud;
    const audOk = Array.isArray(aud)
      ? aud.includes(opts.expectedAudience)
      : aud === opts.expectedAudience;
    if (!audOk) {
      return fail(
        'bad_access_token_aud',
        `access_token aud does not include ${opts.expectedAudience}`,
      );
    }
  }
  const clockSkewSec = opts.clockSkewSec ?? 30;
  if (typeof at.payload.exp !== 'number' || at.payload.exp + clockSkewSec <= nowSec) {
    return fail('expired_access_token', 'access_token is expired');
  }
  if (typeof at.payload.sub !== 'string' || !at.payload.sub) {
    return fail('missing_access_token_sub', 'access_token missing sub');
  }

  // §6.1 + RFC 7800 §3.1: cnf.jkt MUST equal thumbprint(proof.jwk).
  const cnf = at.payload.cnf as { jkt?: unknown } | undefined;
  const atJkt = cnf?.jkt;
  if (typeof atJkt !== 'string' || !atJkt) {
    return fail('missing_cnf_jkt', 'access_token missing cnf.jkt');
  }
  const proofJkt = jwkThumbprintOKP(proofJwk);
  if (atJkt !== proofJkt) {
    return fail('jkt_mismatch', `access_token cnf.jkt ${atJkt} != proof jwk thumbprint ${proofJkt}`);
  }

  // §4.3 step 10: ath = b64url(sha256(access_token)).
  const expectedAth = createHash('sha256').update(accessToken).digest('base64url');
  if (proof.payload.ath !== expectedAth) {
    return fail('bad_proof_ath', 'Proof ath does not match sha256(access_token)');
  }

  // All checks passed — record jti and return.
  jtiStore.add(proof.payload.jti, proof.payload.iat);

  return {
    ok: true,
    sub: at.payload.sub,
    jkt: proofJkt,
    accessTokenClaims: at.payload,
    proofClaims: proof.payload,
  };
}
