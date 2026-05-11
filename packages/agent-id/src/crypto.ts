import { createHash, createPublicKey, verify } from 'node:crypto';
import type { JWK } from './types';

// RFC 7518 §3.3 / RFC 8725 §3.5: RS256 keys MUST be ≥ 2048 bits. The JWK
// `n` parameter is the unsigned modulus encoded base64url with no leading
// zero byte (RFC 7518 §6.3.1), so 256 bytes corresponds to exactly 2048
// bits.
const MIN_RSA_MODULUS_BYTES = 256;

export function verifyRS256(
  headerB64url: string,
  payloadB64url: string,
  signatureB64url: string,
  jwk: JWK,
): boolean {
  if (typeof jwk.n !== 'string' || Buffer.from(jwk.n, 'base64url').length < MIN_RSA_MODULUS_BYTES) {
    return false;
  }
  const keyObj = createPublicKey({ key: jwk, format: 'jwk' });
  const data = `${headerB64url}.${payloadB64url}`;
  const signature = Buffer.from(signatureB64url, 'base64url');
  return verify('sha256', Buffer.from(data), keyObj, signature);
}

/**
 * RFC 7638 JWK Thumbprint of an OKP/Ed25519 JWK. Canonical members for
 * an OKP key are `{"crv","kty","x"}` in lexical order with no whitespace.
 * SHA-256, then base64url (no padding). Throws if the JWK is not a
 * well-formed OKP/Ed25519 public key.
 */
export function jwkThumbprintOKP(jwk: { kty?: unknown; crv?: unknown; x?: unknown }): string {
  if (jwk.kty !== 'OKP') {
    throw new Error(`jwkThumbprintOKP: kty must be OKP, got ${String(jwk.kty)}`);
  }
  if (jwk.crv !== 'Ed25519') {
    throw new Error(`jwkThumbprintOKP: crv must be Ed25519, got ${String(jwk.crv)}`);
  }
  if (typeof jwk.x !== 'string' || jwk.x.length === 0) {
    throw new Error('jwkThumbprintOKP: x is required');
  }
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`;
  return createHash('sha256').update(canonical).digest('base64url');
}

/**
 * Verify an EdDSA (Ed25519) JWS detached signature against an OKP JWK.
 * Used to check DPoP proofs (RFC 9449 §4.3 step 7) — the public key is
 * carried in the proof's own `jwk` header.
 */
export function verifyEdDsaJwt(
  headerB64url: string,
  payloadB64url: string,
  signatureB64url: string,
  jwk: { kty?: unknown; crv?: unknown; x?: unknown },
): boolean {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    return false;
  }
  const raw = Buffer.from(jwk.x, 'base64url');
  if (raw.length !== 32) return false;
  // RFC 8037 §2: Ed25519 SPKI is a fixed 12-byte AlgorithmIdentifier prefix
  // + 32 raw key bytes.
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    raw,
  ]);
  const keyObj = createPublicKey({ key: der, format: 'der', type: 'spki' });
  const data = `${headerB64url}.${payloadB64url}`;
  const signature = Buffer.from(signatureB64url, 'base64url');
  return verify(null, Buffer.from(data), keyObj, signature);
}
