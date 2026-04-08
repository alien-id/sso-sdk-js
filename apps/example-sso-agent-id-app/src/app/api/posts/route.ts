import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAlienJWKS,
  verifyAgentToken,
  verifyAgentTokenWithOwner,
  type JWKS,
} from '@alien-id/sso-agent-id';
import { addPost, getPosts } from './store';

let jwksCache: JWKS | null = null;

async function getJWKS(): Promise<JWKS> {
  if (!jwksCache) {
    jwksCache = await fetchAlienJWKS();
  }
  return jwksCache;
}

export async function GET() {
  return NextResponse.json({ ok: true, posts: getPosts() });
}

export async function POST(req: NextRequest) {
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

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json(
      { ok: false, error: 'Message is required' },
      { status: 400 },
    );
  }
  if (message.length > 500) {
    return NextResponse.json(
      { ok: false, error: 'Message too long (max 500 chars)' },
      { status: 400 },
    );
  }

  const post = addPost(
    message,
    result.fingerprint,
    result.owner,
    result.ownerVerified,
  );
  return NextResponse.json({ ok: true, post }, { status: 201 });
}
