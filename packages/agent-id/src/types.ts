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
   * Expected access_token audience (RFC 7519 §4.1.3, RFC 9068 §4).
   *
   * Three behaviors:
   *   - **omitted** (default, recommended): the AT `aud` claim MUST
   *     include `expectedIssuer`. This is the "federated audience"
   *     pattern — any agent bound to any OAuth client of the same
   *     Alien SSO is accepted, because the SSO always emits
   *     `aud = [client_id, issuer]`.
   *   - **string**: the AT `aud` MUST include this exact value. Use
   *     when you want to scope tokens to a specific OAuth client_id
   *     or RFC 8707 resource indicator.
   *   - **false**: skip the audience check entirely. Only the AT
   *     signature + issuer + DPoP cnf.jkt binding are enforced.
   *     Discouraged outside of test fixtures.
   */
  expectedAudience?: string | false;
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
