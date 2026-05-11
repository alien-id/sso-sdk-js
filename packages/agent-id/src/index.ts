import { createHash } from 'node:crypto';
import {
  ed25519JwkThumbprint,
  fingerprintPublicKeyPem,
  jwkThumbprintOKP,
  sha256Hex,
  verifyEdDsaJwt,
  verifyEd25519Base64Url,
  verifyRS256,
} from './crypto';
import { canonicalJSONString } from './json';
export { fetchAlienJWKS, DEFAULT_SSO_BASE_URL } from './jwt';
import { DEFAULT_SSO_BASE_URL, parseJwt } from './jwt';
import type {
  JWK,
  JWKS,
  OwnerBinding,
  VerifyDPoPFailure,
  VerifyDPoPOptions,
  VerifyDPoPResult,
  VerifyDPoPSuccess,
  VerifyOptions,
  VerifyOwnerOptions,
  VerifyOwnerSuccess,
  VerifyResult,
} from './types';

export type {
  JWK,
  JWKS,
  OwnerBinding,
  VerifyDPoPFailure,
  VerifyDPoPOptions,
  VerifyDPoPResult,
  VerifyDPoPSuccess,
  VerifyFailure,
  VerifyOptions,
  VerifyOwnerOptions,
  VerifyOwnerSuccess,
  VerifyResult,
  VerifySuccess,
} from './types';

/**
 * Verify an Alien Agent ID token.
 *
 * The token is a base64url-encoded JSON payload signed with the agent's
 * Ed25519 key. Verification confirms the agent holds the private key,
 * the fingerprint matches the public key, and the token is fresh.
 *
 * @param tokenB64 - The base64url-encoded token (everything after "AgentID " in the Authorization header).
 * @param opts - Optional configuration.
 * @returns Verification result with agent identity on success, or error on failure.
 */
// RFC 4648 §5: base64url is the URL-safe alphabet
//   ALPHA / DIGIT / "-" / "_"
// with no padding and "without the inclusion of any line breaks,
// whitespace, or other additional characters". Node's Buffer.from(s,
// 'base64url') is permissive — it silently ignores characters outside
// the alphabet, which would let an attacker smuggle non-canonical bytes
// through the outer envelope decode and have them surface as JSON
// content. Gate the input with a strict regex before decode so
// structural validation cannot depend on cryptographic failure paths.
const OUTER_BASE64URL = /^[A-Za-z0-9_-]+$/;

export function verifyAgentToken(
  tokenB64: string,
  opts: VerifyOptions = {},
): VerifyResult {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  const clockSkewMs = opts.clockSkewMs ?? 30 * 1000;

  if (typeof tokenB64 !== 'string' || !OUTER_BASE64URL.test(tokenB64)) {
    return { ok: false, error: 'Invalid token encoding' };
  }

  let parsed: Record<string, unknown>;
  try {
    const json = Buffer.from(tokenB64, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid token encoding' };
  }

  if (parsed.v !== 1) {
    return { ok: false, error: `Unsupported token version: ${parsed.v}` };
  }

  const { sig, fingerprint, publicKeyPem, owner, timestamp, nonce } = parsed;

  if (typeof sig !== 'string') {
    return { ok: false, error: 'Missing or invalid field: sig' };
  }
  if (typeof fingerprint !== 'string') {
    return { ok: false, error: 'Missing or invalid field: fingerprint' };
  }
  if (typeof publicKeyPem !== 'string') {
    return { ok: false, error: 'Missing or invalid field: publicKeyPem' };
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return { ok: false, error: 'Missing or invalid field: timestamp' };
  }
  if (typeof nonce !== 'string') {
    return { ok: false, error: 'Missing or invalid field: nonce' };
  }
  if (owner !== undefined && owner !== null && typeof owner !== 'string') {
    return { ok: false, error: 'Invalid field: owner' };
  }

  const age = Date.now() - timestamp;
  if (age < -clockSkewMs || age > maxAgeMs) {
    return {
      ok: false,
      error: `Token expired (age: ${Math.round(age / 1000)}s)`,
    };
  }

  let computedFingerprint: string;
  try {
    computedFingerprint = fingerprintPublicKeyPem(publicKeyPem);
  } catch {
    return { ok: false, error: 'Invalid public key in token' };
  }
  if (computedFingerprint !== fingerprint) {
    return { ok: false, error: 'Fingerprint does not match public key' };
  }

  const payloadFields: Record<string, unknown> = {
    v: parsed.v,
    fingerprint,
    publicKeyPem,
    timestamp,
    nonce,
  };
  if (owner !== undefined) {
    payloadFields.owner = owner;
  }
  const canonical = canonicalJSONString(payloadFields);
  let sigOk: boolean;
  try {
    sigOk = verifyEd25519Base64Url(canonical, sig, publicKeyPem);
  } catch {
    return { ok: false, error: 'Signature verification error' };
  }
  if (!sigOk) {
    return { ok: false, error: 'Signature verification failed' };
  }

  return {
    ok: true,
    fingerprint,
    publicKeyPem,
    owner: owner ?? null,
    ownerVerified: false,
    timestamp,
    nonce,
  };
}

// ─── Full chain verification ──────────────────────────────────────────────

/**
 * Verify an Alien Agent ID token with full owner chain verification.
 *
 * In addition to the basic token checks, this verifies:
 * 1. The owner binding was signed by the agent's key
 * 2. The binding references the correct agent fingerprint
 * 3. The id_token RS256 signature is valid against the provided JWKS
 * 4. The id_token sub matches the claimed owner
 * 5. The id_token hash matches the binding
 * 6. The owner session proof signature (if present)
 *
 * @param tokenB64 - The base64url-encoded token.
 * @param opts - Options including pre-fetched JWKS.
 */
export function verifyAgentTokenWithOwner(
  tokenB64: string,
  opts: VerifyOwnerOptions,
): VerifyResult {
  // Step 1: Run basic verification
  const basic = verifyAgentToken(tokenB64, opts);
  if (!basic.ok) return basic;

  // Re-parse to get the full-chain fields
  const parsed: Record<string, unknown> = JSON.parse(
    Buffer.from(tokenB64, 'base64url').toString('utf8'),
  );

  const ownerBinding = parsed.ownerBinding as OwnerBinding | undefined;
  const idToken = parsed.idToken as string | undefined;

  if (!ownerBinding || typeof ownerBinding !== 'object') {
    return { ok: false, error: 'Missing field: ownerBinding' };
  }
  if (typeof idToken !== 'string') {
    return { ok: false, error: 'Missing field: idToken' };
  }
  if (!basic.owner) {
    return { ok: false, error: 'Token has no owner to verify' };
  }

  const { payload, payloadHash, signature } = ownerBinding;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Invalid ownerBinding.payload' };
  }
  if (typeof payloadHash !== 'string') {
    return { ok: false, error: 'Invalid ownerBinding.payloadHash' };
  }
  if (typeof signature !== 'string') {
    return { ok: false, error: 'Invalid ownerBinding.signature' };
  }

  // Step 2: Verify owner binding signature with agent's key
  const bindingCanonical = canonicalJSONString(payload);
  const computedHash = sha256Hex(bindingCanonical);
  if (computedHash !== payloadHash) {
    return { ok: false, error: 'Owner binding payload hash mismatch' };
  }

  let bindingSigOk: boolean;
  try {
    bindingSigOk = verifyEd25519Base64Url(
      bindingCanonical,
      signature,
      basic.publicKeyPem,
    );
  } catch {
    return { ok: false, error: 'Owner binding signature verification error' };
  }
  if (!bindingSigOk) {
    return { ok: false, error: 'Owner binding signature verification failed' };
  }

  // Step 3: Verify binding references this agent's key
  const agentInstance = payload.agentInstance as
    | Record<string, unknown>
    | undefined;
  if (
    !agentInstance ||
    agentInstance.publicKeyFingerprint !== basic.fingerprint
  ) {
    return { ok: false, error: 'Owner binding agent fingerprint mismatch' };
  }

  // Step 4: Verify binding owner matches token owner
  if (payload.ownerSessionSub !== basic.owner) {
    return { ok: false, error: 'Owner binding ownerSessionSub mismatch' };
  }

  // Step 5: Verify id_token hash matches binding
  const idTokenHash = sha256Hex(idToken);
  if (payload.idTokenHash !== idTokenHash) {
    return { ok: false, error: 'id_token hash does not match owner binding' };
  }

  // Step 6: Verify id_token RS256 signature against JWKS
  let jwt: ReturnType<typeof parseJwt>;
  try {
    jwt = parseJwt(idToken);
  } catch {
    return { ok: false, error: 'Invalid id_token encoding' };
  }

  if (jwt.header.alg !== 'RS256') {
    return { ok: false, error: `Unsupported id_token alg: ${jwt.header.alg}` };
  }

  // RFC 8725 §3.7 / RFC 7515 §4.1.9: cross-JWT-confusion defense. id_tokens
  // SHOULD declare `typ=JWT`. RFC 6838 §4.2 makes the comparison
  // case-insensitive and treats the bare value as `application/`-prefixed.
  // Reject distinguishable AT-shaped types (e.g. `at+jwt`) outright.
  const typRaw = jwt.header.typ;
  if (typRaw !== undefined) {
    const typLower = typeof typRaw === 'string' ? typRaw.toLowerCase() : '';
    if (typLower !== 'jwt' && typLower !== 'application/jwt') {
      return { ok: false, error: `Unexpected id_token typ: ${typRaw}` };
    }
  }

  // RFC 7515 §4.1.11: a JWS with a `crit` parameter listing extensions the
  // verifier does not understand MUST be rejected before signature checks.
  if (jwt.header.crit !== undefined) {
    return { ok: false, error: 'Unrecognized JWT crit header' };
  }

  const kid = jwt.header.kid as string | undefined;
  const jwk = opts.jwks.keys.find(
    (k) =>
      k.kid === kid &&
      k.kty === 'RSA' &&
      (k.use === 'sig' || !k.use) &&
      // RFC 7515 §10.7: when the JWK pins an `alg`, it MUST match the
      // header alg before signature verification.
      (!k.alg || k.alg === 'RS256'),
  );
  if (!jwk) {
    return { ok: false, error: `No matching JWKS key for kid: ${kid}` };
  }
  if (!jwk.n || !jwk.e) {
    return { ok: false, error: 'Invalid JWKS key: missing required RSA fields (n, e)' };
  }

  let rsaOk: boolean;
  try {
    rsaOk = verifyRS256(
      jwt.headerB64url,
      jwt.payloadB64url,
      jwt.signatureB64url,
      jwk,
    );
  } catch {
    return { ok: false, error: 'id_token signature verification error' };
  }
  if (!rsaOk) {
    return { ok: false, error: 'id_token signature verification failed' };
  }

  // Step 7: Verify id_token sub matches owner
  if (jwt.payload.sub !== basic.owner) {
    return { ok: false, error: 'id_token sub does not match token owner' };
  }

  // Step 7b: Validate temporal + identity claims (RFC 7519 §4.1.1, §4.1.3,
  // §4.1.4, §4.1.5). `expectedAudience` is caller-supplied (the app's own
  // OAuth client_id); `expectedIssuer` defaults to Alien SSO's production
  // endpoint when omitted.
  const expectedIssuer = opts.expectedIssuer ?? DEFAULT_SSO_BASE_URL;
  const nowSec = Math.floor(Date.now() / 1000);
  const skewSec = Math.ceil((opts.clockSkewMs ?? 30_000) / 1000);

  const exp = jwt.payload.exp;
  if (typeof exp !== 'number' || nowSec - skewSec >= exp) {
    return { ok: false, error: 'id_token expired' };
  }

  // RFC 7519 §4.1.5: nbf, when present, MUST be a NumericDate. A
  // non-numeric value is malformed and MUST cause rejection — silently
  // ignoring it would let an attacker bypass the not-before check by
  // sending a string.
  const nbf = jwt.payload.nbf;
  if (nbf !== undefined) {
    if (typeof nbf !== 'number') {
      return { ok: false, error: 'id_token nbf must be NumericDate' };
    }
    if (nowSec + skewSec < nbf) {
      return { ok: false, error: 'id_token not yet valid' };
    }
  }

  // RFC 7519 §4.1.6: iat, when present, MUST be a NumericDate.
  const iat = jwt.payload.iat;
  if (iat !== undefined && typeof iat !== 'number') {
    return { ok: false, error: 'id_token iat must be NumericDate' };
  }

  if (jwt.payload.iss !== expectedIssuer) {
    return { ok: false, error: 'id_token issuer mismatch' };
  }

  const aud = jwt.payload.aud;
  const audList = Array.isArray(aud) ? aud : [aud];
  if (!audList.includes(opts.expectedAudience)) {
    return { ok: false, error: 'id_token audience mismatch' };
  }

  // OIDC §3.1.3.7 step 3: reject when any aud entry is outside the
  // trusted set. Default trust set is {expectedAudience}.
  const trusted = new Set<unknown>(
    opts.trustedAudiences ?? [opts.expectedAudience],
  );
  trusted.add(opts.expectedAudience);
  for (const a of audList) {
    if (!trusted.has(a)) {
      return { ok: false, error: 'id_token aud not in trustedAudiences' };
    }
  }

  // OIDC §3.1.3.7.6: with multi-audience id_tokens, `azp` MUST be
  // present and equal the Client's id. §3.1.3.7.7: when present, azp
  // MUST equal client_id regardless of aud arity.
  const azp = jwt.payload.azp;
  if (audList.length > 1 && azp === undefined) {
    return { ok: false, error: 'id_token azp missing for multi-audience' };
  }
  if (azp !== undefined && azp !== opts.expectedAudience) {
    return { ok: false, error: 'id_token azp mismatch' };
  }

  // OIDC §3.1.3.7 step 11: when the Client sent a `nonce` in the
  // authorization request, the id_token MUST replay it byte-for-byte.
  // Mirrors core's verify_id_token contract.
  if (opts.expectedNonce !== undefined) {
    if (jwt.payload.nonce !== opts.expectedNonce) {
      return { ok: false, error: 'id_token nonce mismatch' };
    }
  }

  // Step 7c: cnf.jkt MUST equal RFC 7638 thumbprint of the agent's public
  // key (RFC 7800 §3.1 / RFC 9449 §6.1). Without this check the id_token
  // is not bound to the presenting agent — an attacker can substitute
  // their own keypair across the binding payload + proof bundle while
  // reusing a stolen id_token verbatim. Anchors at the agent key, not
  // the binding's self-embedded key.
  let expectedJkt: string;
  try {
    expectedJkt = ed25519JwkThumbprint(basic.publicKeyPem);
  } catch (err) {
    return {
      ok: false,
      error: `cnf.jkt anchor: ${err instanceof Error ? err.message : 'invalid agent key'}`,
    };
  }
  const cnf = jwt.payload.cnf as { jkt?: unknown } | undefined;
  const actualJkt = cnf?.jkt;
  if (typeof actualJkt !== 'string' || actualJkt.length === 0) {
    return { ok: false, error: 'id_token missing cnf.jkt' };
  }
  if (actualJkt !== expectedJkt) {
    return { ok: false, error: 'id_token cnf.jkt does not bind to agent key' };
  }

  const result: VerifyOwnerSuccess = {
    ok: true,
    fingerprint: basic.fingerprint,
    publicKeyPem: basic.publicKeyPem,
    owner: basic.owner,
    ownerVerified: true,
    issuer: typeof jwt.payload.iss === 'string' ? jwt.payload.iss : '',
    timestamp: basic.timestamp,
    nonce: basic.nonce,
  };
  return result;
}

// ─── Express/Connect middleware ────────────────────────────────────────────

/**
 * Extract and verify the Agent ID token from a request's Authorization header.
 *
 * @param req - Any object with a `headers` property (works with Express, Fastify, Node http, etc.).
 * @param opts - Optional verification configuration.
 * @returns Verification result.
 */
export function verifyAgentRequest(
  req: { headers: Record<string, string | string[] | undefined> },
  opts?: VerifyOptions,
): VerifyResult {
  const auth = req.headers.authorization;
  if (Array.isArray(auth)) {
    return { ok: false, error: 'Multiple Authorization headers' };
  }
  if (typeof auth !== 'string' || !auth.startsWith('AgentID ')) {
    return {
      ok: false,
      error: 'Missing header: Authorization: AgentID <token>',
    };
  }
  return verifyAgentToken(auth.slice(8).trim(), opts);
}

/**
 * Extract and verify a full-chain Agent ID token from a request's Authorization header.
 *
 * @param req - Any object with a `headers` property.
 * @param opts - Options including pre-fetched JWKS.
 * @returns Verification result with verified owner on success.
 */
export function verifyAgentRequestWithOwner(
  req: { headers: Record<string, string | string[] | undefined> },
  opts: VerifyOwnerOptions,
): VerifyResult {
  const auth = req.headers.authorization;
  if (Array.isArray(auth)) {
    return { ok: false, error: 'Multiple Authorization headers' };
  }
  if (typeof auth !== 'string' || !auth.startsWith('AgentID ')) {
    return {
      ok: false,
      error: 'Missing header: Authorization: AgentID <token>',
    };
  }
  return verifyAgentTokenWithOwner(auth.slice(8).trim(), opts);
}

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
