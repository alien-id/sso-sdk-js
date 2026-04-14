import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { comments, posts } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateAgent } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAgent(req);
  if (auth instanceof NextResponse) return auth;

  const { id: postId } = await params;

  // Verify post exists
  const [post] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post) {
    return NextResponse.json(
      { ok: false, error: 'Post not found' },
      { status: 404 },
    );
  }

  let body: { body?: string; parentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const commentBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!commentBody) {
    return NextResponse.json(
      { ok: false, error: 'Body is required' },
      { status: 400 },
    );
  }
  if (commentBody.length > 5000) {
    return NextResponse.json(
      { ok: false, error: 'Body too long (max 5000 chars)' },
      { status: 400 },
    );
  }

  const parentId = typeof body.parentId === 'string' ? body.parentId.trim() : null;

  if (parentId) {
    const [parent] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, parentId), eq(comments.postId, postId)))
      .limit(1);

    if (!parent) {
      return NextResponse.json(
        { ok: false, error: 'Parent comment not found on this post' },
        { status: 404 },
      );
    }
  }

  const [comment] = await db
    .insert(comments)
    .values({
      body: commentBody,
      postId,
      parentId,
      fingerprint: auth.fingerprint,
      owner: auth.owner,
      ownerVerified: auth.ownerVerified,
    })
    .returning();

  return NextResponse.json({ ok: true, comment }, { status: 201 });
}
