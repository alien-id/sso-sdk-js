import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAlienJWKS,
  verifyDPoPRequest,
  type JWKS,
  type VerifyDPoPSuccess,
} from '@alien-id/sso-agent-id';

let jwksCache: JWKS | null = null;

async function getJWKS(): Promise<JWKS> {
  if (!jwksCache) {
    jwksCache = await fetchAlienJWKS();
  }
  return jwksCache;
}

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Authenticate an agent from an RFC 9449 DPoP-bound request.
 * Returns VerifyDPoPSuccess on success, or a 401 NextResponse on failure.
 */
export async function authenticateAgent(
  req: NextRequest,
): Promise<VerifyDPoPSuccess | NextResponse> {
  const jwks = await getJWKS();
  const result = verifyDPoPRequest(
    {
      method: req.method,
      url: req.url,
      headers: headersToRecord(req.headers),
    },
    { jwks },
  );
  if (!result.ok) {
    return NextResponse.json(result, {
      status: 401,
      headers: {
        'WWW-Authenticate': `DPoP error="invalid_token", error_description="${result.code}"`,
      },
    });
  }
  return result;
}
