import { NextRequest, NextResponse } from 'next/server';
import { verifyAgentToken } from '@alien-id/agent-id-sso';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('AgentID ')) {
    return NextResponse.json(
      { ok: false, error: 'Missing header: Authorization: AgentID <token>' },
      { status: 401 },
    );
  }

  const result = verifyAgentToken(auth.slice(8).trim());
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    agent: {
      fingerprint: result.fingerprint,
      owner: result.owner,
      timestamp: result.timestamp,
    },
    message: `Hello, agent ${result.fingerprint.slice(0, 16)}!`,
  });
}
