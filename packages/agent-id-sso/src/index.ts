import {
  fingerprintPublicKeyPem,
  sha256Hex,
  verifyEd25519Base64Url,
  verifyEd25519Hex,
  verifyRS256,
} from './crypto';
import { canonicalJSONString } from './json';
export { fetchAlienJWKS } from './jwt';
import { parseJwt } from './jwt';
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
export function verifyAgentToken(
  tokenB64: string,
  opts: VerifyOptions = {},
): VerifyResult {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  const clockSkewMs = opts.clockSkewMs ?? 30 * 1000;

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

  const kid = jwt.header.kid as string | undefined;
  const jwk = opts.jwks.keys.find(
    (k) => k.kid === kid && k.kty === 'RSA' && (k.use === 'sig' || !k.use),
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

  // Step 8: Verify owner session proof (optional)
  let ownerProofVerified = false;
  const proof = payload.ownerSessionProof as
    | Record<string, unknown>
    | null
    | undefined;
  if (proof && typeof proof === 'object') {
    const {
      sessionAddress,
      sessionSignature,
      sessionSignatureSeed,
      sessionPublicKey,
    } = proof;

    if (
      typeof sessionAddress !== 'string' ||
      typeof sessionSignature !== 'string' ||
      typeof sessionSignatureSeed !== 'string' ||
      typeof sessionPublicKey !== 'string'
    ) {
      return { ok: false, error: 'Incomplete owner session proof fields' };
    }

    if (sessionAddress !== basic.owner) {
      return { ok: false, error: 'Owner session proof address mismatch' };
    }

    const message = `${sessionAddress}${sessionSignatureSeed}`;
    let proofOk: boolean;
    try {
      proofOk = verifyEd25519Hex(message, sessionSignature, sessionPublicKey);
    } catch {
      return { ok: false, error: 'Owner session proof signature error' };
    }
    if (!proofOk) {
      return { ok: false, error: 'Owner session proof signature failed' };
    }

    ownerProofVerified = true;
  }

  const result: VerifyOwnerSuccess = {
    ok: true,
    fingerprint: basic.fingerprint,
    publicKeyPem: basic.publicKeyPem,
    owner: basic.owner,
    ownerVerified: true,
    ownerProofVerified,
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
