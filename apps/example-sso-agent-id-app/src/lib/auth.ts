import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAlienJWKS,
  verifyAgentToken,
  verifyAgentTokenWithOwner,
  type JWKS,
  type VerifySuccess,
} from '@alien-id/sso-agent-id';

let jwksCache: JWKS | null = null;

async function getJWKS(): Promise<JWKS> {
  if (!jwksCache) {
    jwksCache = await fetchAlienJWKS();
  }
  return jwksCache;
}

/**
 * Authenticate an agent from the Authorization header.
 * Returns VerifySuccess on success, or a 401 NextResponse on failure.
 */
export async function authenticateAgent(
  req: NextRequest,
): Promise<VerifySuccess | NextResponse> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('AgentID ')) {
    return NextResponse.json(
      { ok: false, error: 'Missing header: Authorization: AgentID <token>' },
      { status: 401 },
    );
  }

  const tokenB64 = auth.slice(8).trim();
  const jwks = await getJWKS();
  let result = verifyAgentTokenWithOwner(tokenB64, { jwks });
  if (!result.ok) {
    result = verifyAgentToken(tokenB64);
  }
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }

  return result;
}
