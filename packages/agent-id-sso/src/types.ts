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
  /** Whether the owner session proof (human consent signature) was present and valid. */
  ownerProofVerified: boolean;
  /** The id_token issuer URL. */
  issuer: string;
}

export interface VerifyFailure {
  ok: false;
  /** Human-readable error message. */
  error: string;
}

export type VerifyResult = VerifySuccess | VerifyOwnerSuccess | VerifyFailure;
