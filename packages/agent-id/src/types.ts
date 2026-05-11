// ─── JWKS types ───────────────────────────────────────────────────────────

export interface JWK {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

export interface JWKS {
  keys: JWK[];
}

// ─── Owner binding types ──────────────────────────────────────────────────

export interface OwnerBinding {
  payload: Record<string, unknown>;
  payloadHash: string;
  signature: string;
}

// ─── Verify options & results ─────────────────────────────────────────────

export interface VerifyOptions {
  /** Maximum token age in milliseconds. Default: 300000 (5 minutes). */
  maxAgeMs?: number;
  /** Allowed clock skew in milliseconds (for future-dated tokens). Default: 30000 (30 seconds). */
  clockSkewMs?: number;
}

export interface VerifyOwnerOptions extends VerifyOptions {
  /** Pre-fetched JWKS from the Alien SSO server. */
  jwks: JWKS;
  /**
   * Expected id_token issuer (RFC 7519 §4.1.1). Optional — defaults to
   * Alien SSO's production endpoint (`DEFAULT_SSO_BASE_URL`). Override
   * only when verifying tokens from a non-default deployment (staging,
   * self-hosted, tests).
   */
  expectedIssuer?: string;
  /**
   * Expected id_token audience (RFC 7519 §4.1.3 / OIDC §3.1.3.7.4).
   * REQUIRED. Must equal the verifying app's OAuth `client_id`
   * (`providerAddress`) — the id_token's `aud` claim must contain this
   * value, and OIDC §3.1.3.7 step 3 requires the recipient to verify the
   * token was issued for them. The library cannot default this because
   * each integrating app has its own `client_id`.
   */
  expectedAudience: string;
  /**
   * OIDC Core 1.0 §3.1.3.7 step 3: "The ID Token MUST be rejected if it
   * contains additional audiences not trusted by the Client." When
   * omitted, the trust set is `{expectedAudience}` — any extra audience
   * is rejected. Pass an explicit list to widen the trust set (e.g. for
   * federated/RFC 8707 resource-indicator scenarios). `expectedAudience`
   * is implicitly trusted regardless of this list.
   */
  trustedAudiences?: readonly string[];
  /**
   * OIDC Core 1.0 §3.1.3.7 step 11: when the authorization request sent
   * a `nonce`, the id_token MUST carry the same value and the Client
   * MUST verify exact equality. When supplied, the id_token's `nonce`
   * claim must be present and equal this value; otherwise verification
   * fails. Omit only if the Client did not request a nonce (the AS will
   * then not include one).
   */
  expectedNonce?: string;
}

export interface VerifySuccess {
  ok: true;
  /** SHA-256 hex fingerprint of the agent's public key (stable across sessions). */
  fingerprint: string;
  /** Agent's Ed25519 public key in SPKI PEM format. */
  publicKeyPem: string;
  /** Human owner's AlienID address, or null if unbound. */
  owner: string | null;
  /** Whether the owner claim has been cryptographically verified via the full chain. */
  ownerVerified: boolean;
  /** Token creation timestamp in milliseconds. */
  timestamp: number;
  /** Random 128-bit hex nonce (unique per token). */
  nonce: string;
}

export interface VerifyOwnerSuccess extends VerifySuccess {
  ownerVerified: true;
  /** The id_token issuer URL. */
  issuer: string;
}

export interface VerifyFailure {
  ok: false;
  /** Human-readable error message. */
  error: string;
}

export type VerifyResult = VerifySuccess | VerifyOwnerSuccess | VerifyFailure;

// ─── RFC 9449 DPoP verifier types ─────────────────────────────────────────

/**
 * Pluggable replay-protection store for the DPoP proof's `jti` claim
 * (RFC 9449 §11.1). Default in-memory store is single-process — pass a
 * Redis/Memcached-backed implementation to share replay state across
 * resource-server instances.
 */
export interface DPoPJtiStore {
  /** Has this jti been observed inside the freshness window? */
  has(jti: string): boolean;
  /** Record the jti with its proof `iat` (unix seconds). */
  add(jti: string, iat: number): void;
}

export interface VerifyDPoPOptions {
  /** Pre-fetched JWKS from the SSO (RFC 9068 §4 access-token signature key). */
  jwks: JWKS;
  /**
   * Expected access_token issuer (RFC 7519 §4.1.1). Defaults to Alien
   * SSO's production endpoint when omitted.
   */
  expectedIssuer?: string;
  /**
   * Expected access_token audience (RFC 7519 §4.1.3). Optional — when
   * provided, the AT `aud` claim MUST include it. When omitted, the
   * audience check is skipped (the SSO's signature still binds the
   * AT to its issuer).
   */
  expectedAudience?: string;
  /**
   * DPoP proof freshness window in seconds (RFC 9449 §4.3 step 11).
   * Default: 30.
   */
  proofMaxAgeSec?: number;
  /**
   * Clock skew allowance in seconds applied to access_token `exp`.
   * Default: 30.
   */
  clockSkewSec?: number;
  /**
   * Replay-protection store for the DPoP proof's `jti`. Default: an
   * in-memory `Map` scoped to the verifier's import (single-process).
   * Inject a shared store for multi-instance deployments.
   */
  jtiStore?: DPoPJtiStore;
}

export interface VerifyDPoPSuccess {
  ok: true;
  /** Access token's `sub` claim (the human owner). */
  sub: string;
  /** RFC 7638 thumbprint of the agent's DPoP key (also the AT's `cnf.jkt`). */
  jkt: string;
  /** Decoded access_token claims (RFC 9068 §2.2). */
  accessTokenClaims: Record<string, unknown>;
  /** Decoded DPoP proof claims (RFC 9449 §4.2). */
  proofClaims: Record<string, unknown>;
}

export interface VerifyDPoPFailure {
  ok: false;
  /**
   * Machine-readable error label aligned with RFC 9449 / RFC 9068 / RFC
   * 6750 categories (e.g. `invalid_token`, `bad_proof_signature`,
   * `jkt_mismatch`). Stable across releases; new values may be added.
   */
  code: string;
  /** Human-readable error message. */
  error: string;
}

export type VerifyDPoPResult = VerifyDPoPSuccess | VerifyDPoPFailure;
