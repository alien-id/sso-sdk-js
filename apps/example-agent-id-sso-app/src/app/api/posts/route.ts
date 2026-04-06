import { NextRequest, NextResponse } from 'next/server';
import { verifyAgentToken } from '@alien-id/agent-id-sso';
import { addPost, getPosts } from './store';

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

  const result = verifyAgentToken(auth.slice(8).trim());
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

  const post = addPost(message, result.fingerprint, result.owner);
  return NextResponse.json({ ok: true, post }, { status: 201 });
}
