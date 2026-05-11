import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const result = await authenticateAgent(req);
  if (result instanceof NextResponse) return result;

  const checks = [
    { label: 'DPoP proof signature valid (RFC 9449 §4.3 step 7)', passed: true },
    { label: 'Proof htm/htu/iat/jti fresh and unreplayed (steps 8–12)', passed: true },
    { label: 'access_token is at+jwt signed by Alien SSO (RFC 9068 §4)', passed: true },
    {
      label: `access_token cnf.jkt binds owner ${result.sub} to agent ${result.jkt.slice(0, 16)}… (§6.1)`,
      passed: true,
    },
  ];

  return NextResponse.json({
    ok: true,
    agent: {
      jkt: result.jkt,
      sub: result.sub,
    },
    checks,
    message: `Hello, agent ${result.jkt.slice(0, 16)}!`,
  });
}
