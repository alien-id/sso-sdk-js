import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const result = await authenticateAgent(req);
  if (result instanceof NextResponse) return result;

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
