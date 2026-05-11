import {
  ed25519JwkThumbprint,
  fingerprintPublicKeyPem,
  sha256Hex,
  verifyEd25519Base64Url,
  verifyRS256,
} from './crypto';
import { canonicalJSONString } from './json';
export { fetchAlienJWKS, DEFAULT_SSO_BASE_URL } from './jwt';
import { DEFAULT_SSO_BASE_URL, parseJwt } from './jwt';
import type {
  OwnerBinding,
  VerifyOptions,
  VerifyOwnerOptions,
  VerifyOwnerSuccess,
  VerifyResult,
} from './types';

export type {
  JWK,
  JWKS,
  OwnerBinding,
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
