import { createHash, createPublicKey, verify } from 'node:crypto';

// ─── Canonical JSON ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    out[key] = sortValue(value[key]);
  }
  return out;
}

function canonicalJSONString(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

// ─── Crypto helpers ────────────────────────────────────────────────────────

function fingerprintPublicKeyPem(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({
    format: 'der',
    type: 'spki',
  });
  return createHash('sha256').update(der).digest('hex');
}

function verifyEd25519Base64Url(
  payload: string,
  signatureB64url: string,
  publicKeyPem: string,
): boolean {
  const signature = Buffer.from(signatureB64url, 'base64url');
  return verify(
    null,
    Buffer.from(payload),
    createPublicKey(publicKeyPem),
    signature,
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface VerifyOptions {
  /** Maximum token age in milliseconds. Default: 300000 (5 minutes). */
  maxAgeMs?: number;
  /** Allowed clock skew in milliseconds (for future-dated tokens). Default: 30000 (30 seconds). */
  clockSkewMs?: number;
}

export interface VerifySuccess {
  ok: true;
  /** SHA-256 hex fingerprint of the agent's public key (stable across sessions). */
  fingerprint: string;
  /** Agent's Ed25519 public key in SPKI PEM format. */
  publicKeyPem: string;
  /** Human owner's AlienID address, or null if unbound. */
  owner: string | null;
  /** Token creation timestamp in milliseconds. */
  timestamp: number;
  /** Random 128-bit hex nonce (unique per token). */
  nonce: string;
}

export interface VerifyFailure {
  ok: false;
  /** Human-readable error message. */
  error: string;
}

export type VerifyResult = VerifySuccess | VerifyFailure;

// ─── Token verification ────────────────────────────────────────────────────

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

  const { sig: _, ...payloadFields } = parsed;
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
    timestamp,
    nonce,
  };
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
  if (typeof auth !== 'string' || !auth.startsWith('AgentID ')) {
    return {
      ok: false,
      error: 'Missing header: Authorization: AgentID <token>',
    };
  }
  return verifyAgentToken(auth.slice(8).trim(), opts);
}
