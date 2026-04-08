import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAlienJWKS,
  verifyAgentToken,
  verifyAgentTokenWithOwner,
  type JWKS,
} from '@alien-id/sso-agent-id';

let jwksCache: JWKS | null = null;

async function getJWKS(): Promise<JWKS> {
  if (!jwksCache) {
    jwksCache = await fetchAlienJWKS();
  }
  return jwksCache;
}

export async function GET(req: NextRequest) {
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
    // Token may lack ownerBinding/idToken — fall back to basic verification.
    // The agent is authenticated but result.ownerVerified will be false.
    result = verifyAgentToken(tokenB64);
  }
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }

  const checks = [
    {
      label: 'Agent holds Ed25519 private key',
      passed: true,
    },
    {
      label: 'Token is fresh (< 5 minutes)',
      passed: true,
    },
    {
      label: 'Fingerprint matches public key',
      passed: true,
    },
    {
      label: result.ownerVerified
        ? `Agent owner is verified on Alien App — ${result.owner}`
        : `Agent owner is not verified — ${result.owner ?? 'no owner'}`,
      passed: result.ownerVerified,
    },
  ];

  return NextResponse.json({
    ok: true,
    agent: {
      fingerprint: result.fingerprint,
      owner: result.owner,
      ownerVerified: result.ownerVerified,
      timestamp: result.timestamp,
    },
    checks,
    message: `Hello, agent ${result.fingerprint.slice(0, 16)}!`,
  });
}
