import type { JWKS } from './types';

const DEFAULT_SSO_BASE_URL = 'https://sso.alien-api.com';

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
  const header = JSON.parse(Buffer.from(headerB64url, 'base64url').toString());
  const payload = JSON.parse(
    Buffer.from(payloadB64url, 'base64url').toString(),
  );
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
