import type { JWKS } from './types';

export const DEFAULT_SSO_BASE_URL = 'https://sso.alien-api.com';

// RFC 4648 §5 / RFC 7515 §2: base64url is [A-Za-z0-9_-] with no padding.
// Node's Buffer.from(*, 'base64url') silently tolerates whitespace and
// alien chars, so we gate each segment before decoding (RFC 7519 §7.2).
const BASE64URL_REGEX = /^[A-Za-z0-9_-]*$/;

function decodeJwtSegment(seg: string): Buffer {
  if (!BASE64URL_REGEX.test(seg)) {
    throw new Error(
      'Invalid JWT: segment contains characters outside RFC 4648 §5 base64url alphabet',
    );
  }
  if (seg.length % 4 === 1) {
    throw new Error('Invalid JWT: segment has invalid length');
  }
  return Buffer.from(seg, 'base64url');
}

export function parseJwt(token: string): {
  headerB64url: string;
  payloadB64url: string;
  signatureB64url: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }
  const [headerB64url, payloadB64url, signatureB64url] = parts;
  // Validate the signature segment alphabet too — verify-owner consumes it
  // raw via base64url decoding for the Ed25519 check.
  decodeJwtSegment(signatureB64url);
  const header = JSON.parse(decodeJwtSegment(headerB64url).toString());
  const payload = JSON.parse(decodeJwtSegment(payloadB64url).toString());
  return { headerB64url, payloadB64url, signatureB64url, header, payload };
}

/**
 * Fetch the JWKS (JSON Web Key Set) from the Alien SSO server.
 * Callers should cache the result and refresh periodically.
 *
 * @param ssoBaseUrl - SSO server base URL. Default: https://sso.alien-api.com
 */
export async function fetchAlienJWKS(
  ssoBaseUrl: string = DEFAULT_SSO_BASE_URL,
): Promise<JWKS> {
  const url = `${ssoBaseUrl.replace(/\/+$/, '')}/oauth/jwks`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch JWKS: ${res.status} ${res.statusText}`);
  }
  const jwks = (await res.json()) as JWKS;
  if (!Array.isArray(jwks.keys)) {
    throw new Error('JWKS response missing keys[]');
  }
  return jwks;
}
