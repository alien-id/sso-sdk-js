// RFC 9449 DPoP — proof-of-possession proof construction for the SSO core
// SDK's OIDC client. Uses Web Crypto only (browser + modern Node) so no new
// runtime dependency is added.

function base64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for environments without crypto.randomUUID — 16 random bytes
  // formatted as v4 UUID (RFC 4122 §4.4).
  const r = new Uint8Array(16);
  crypto.getRandomValues(r);
  r[6] = (r[6] & 0x0f) | 0x40;
  r[8] = (r[8] & 0x3f) | 0x80;
  const hex = Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface OkpEd25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
}

export interface DPoPKeypair {
  privateKey: CryptoKey;
  publicJwk: OkpEd25519Jwk;
}

/**
 * Generate a fresh non-extractable Ed25519 keypair for DPoP signing
 * (RFC 9449 §4.1 — alg MUST be asymmetric). The private key never leaves
 * Web Crypto; the public JWK is what the SDK embeds in proof headers and
 * uses to derive `dpop_jkt` for the authorization request.
 */
export async function createDPoPKeypair(): Promise<DPoPKeypair> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'Ed25519' } as EcKeyGenParams,
    false,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pubJwk = (await crypto.subtle.exportKey(
    'jwk',
    kp.publicKey,
  )) as JsonWebKey;
  if (
    pubJwk.kty !== 'OKP' ||
    pubJwk.crv !== 'Ed25519' ||
    typeof pubJwk.x !== 'string'
  ) {
    throw new Error('Web Crypto returned a non-Ed25519 JWK');
  }
  return {
    privateKey: kp.privateKey,
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: pubJwk.x },
  };
}

function canonicalizeHtu(rawUrl: string): string {
  // RFC 9449 §4.3: htu equals the request URI without query and fragment.
  // We canonicalise via WHATWG URL so trailing slashes / default ports
  // normalise consistently between issuer and verifier.
  const u = new URL(rawUrl);
  u.search = '';
  u.hash = '';
  return u.toString();
}

export interface DPoPProofParams {
  htm: string;
  htu: string;
  /** When present, becomes the `ath` claim — base64url(SHA-256(accessToken)). */
  accessToken?: string;
  /** When present, becomes the `nonce` claim (RFC 9449 §8/§9 retry). */
  nonce?: string;
}

/**
 * Build a compact JWS DPoP proof per RFC 9449 §4. Header carries
 * `typ=dpop+jwt`, `alg=EdDSA`, `jwk` (public-only). Payload carries
 * `htm`, `htu`, `iat`, `jti`, optional `ath` (when proof binds an AT),
 * and optional `nonce` (when the AS or RS issued one).
 */
export async function createDPoPProof(
  keypair: DPoPKeypair,
  params: DPoPProofParams,
): Promise<string> {
  const header = {
    typ: 'dpop+jwt',
    alg: 'EdDSA',
    jwk: keypair.publicJwk,
  };
  const payload: Record<string, unknown> = {
    htm: params.htm,
    htu: canonicalizeHtu(params.htu),
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  };
  if (params.accessToken !== undefined) {
    const ath = await sha256(params.accessToken);
    payload.ath = base64urlEncode(ath);
  }
  if (params.nonce !== undefined) {
    payload.nonce = params.nonce;
  }
  const headerB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(header)),
  );
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBuf = await crypto.subtle.sign(
    { name: 'Ed25519' },
    keypair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = base64urlEncode(new Uint8Array(sigBuf));
  return `${signingInput}.${sigB64}`;
}

/**
 * RFC 7638 JWK Thumbprint of an Ed25519 public key.
 *
 * Canonical JSON for an OKP/Ed25519 key is exactly
 * `{"crv":"Ed25519","kty":"OKP","x":"<x>"}` — lex-ordered members, no
 * whitespace. SHA-256 the bytes, then base64url (no padding).
 *
 * Used to derive `dpop_jkt` for the authorization request and to verify
 * `cnf.jkt` on the resulting DPoP-bound access token.
 */
export async function dpopJwkThumbprint(jwk: OkpEd25519Jwk): Promise<string> {
  const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${jwk.x}"}`;
  return base64urlEncode(await sha256(canonical));
}
