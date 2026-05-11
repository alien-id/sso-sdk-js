import { createHash, createPublicKey, verify } from 'node:crypto';
import type { JWK } from './types';

export function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function fingerprintPublicKeyPem(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({
    format: 'der',
    type: 'spki',
  });
  return createHash('sha256').update(der).digest('hex');
}

export function verifyEd25519Base64Url(
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

const ED25519_RAW_KEY_LENGTH = 32;

export function verifyEd25519Hex(
  message: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  const raw = Buffer.from(publicKeyHex, 'hex');
  if (raw.length !== ED25519_RAW_KEY_LENGTH) {
    throw new Error(
      `Invalid Ed25519 public key: expected ${ED25519_RAW_KEY_LENGTH} bytes, got ${raw.length}`,
    );
  }
  const keyObj = createPublicKey({
    key: Buffer.concat([
      // Ed25519 SPKI prefix: SEQUENCE(SEQUENCE(OID 1.3.101.112), BIT STRING(32 bytes))
      Buffer.from('302a300506032b6570032100', 'hex'),
      raw,
    ]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, Buffer.from(message), keyObj, Buffer.from(signatureHex, 'hex'));
}

// RFC 7518 §3.3 / RFC 8725 §3.5: RS256 keys MUST be ≥ 2048 bits. The JWK
// `n` parameter is the unsigned modulus encoded base64url with no leading
// zero byte (RFC 7518 §6.3.1), so 256 bytes corresponds to exactly 2048
// bits.
const MIN_RSA_MODULUS_BYTES = 256;

// RFC 8037 §2: Ed25519 SPKI AlgorithmIdentifier prefix (12 bytes:
// SEQUENCE(SEQUENCE(OID 1.3.101.112), BIT STRING)). The full SPKI is
// 44 bytes; the trailing 32 bytes are the raw public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * RFC 7638 JWK Thumbprint of an Ed25519 public key (PEM-encoded SPKI).
 *
 * Canonical JSON for an OKP/Ed25519 key is exactly
 * `{"crv":"Ed25519","kty":"OKP","x":"<x>"}` — lex-ordered members, no
 * whitespace. SHA-256 the bytes, then base64url (no padding).
 *
 * Used to verify `cnf.jkt` on an SSO-issued id_token: the thumbprint of
 * the agent's public key MUST equal the id_token's `cnf.jkt` for proof-
 * of-possession (RFC 7800 §3.1, RFC 9449 §6.1).
 */
export function ed25519JwkThumbprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({
    format: 'der',
    type: 'spki',
  });
  if (der.length !== 44 || !der.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('ed25519JwkThumbprint: not an Ed25519 SPKI public key');
  }
  const rawKey = der.subarray(12);
  const x = rawKey.toString('base64url');
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${x}"}`;
  return createHash('sha256').update(canonical).digest('base64url');
}

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
