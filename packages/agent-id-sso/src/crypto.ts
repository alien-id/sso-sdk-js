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

export function verifyRS256(
  headerB64url: string,
  payloadB64url: string,
  signatureB64url: string,
  jwk: JWK,
): boolean {
  const keyObj = createPublicKey({ key: jwk, format: 'jwk' });
  const data = `${headerB64url}.${payloadB64url}`;
  const signature = Buffer.from(signatureB64url, 'base64url');
  return verify('sha256', Buffer.from(data), keyObj, signature);
}
