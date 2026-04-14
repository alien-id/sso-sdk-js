import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { votes, posts } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
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
    .select({ id: posts.id, score: posts.score })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post) {
    return NextResponse.json(
      { ok: false, error: 'Post not found' },
      { status: 404 },
    );
  }

  let body: { value?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (body.value !== 1 && body.value !== -1) {
    return NextResponse.json(
      { ok: false, error: 'Value must be 1 or -1' },
      { status: 400 },
    );
  }

  const newValue = body.value;

  // Check existing vote
  const [existing] = await db
    .select()
    .from(votes)
    .where(
      and(
        eq(votes.fingerprint, auth.fingerprint),
        eq(votes.targetType, 'post'),
        eq(votes.targetId, postId),
      ),
    )
    .limit(1);

  let scoreDelta: number;

  if (existing) {
    if (existing.value === newValue) {
      // Toggle off — remove vote
      await db.delete(votes).where(eq(votes.id, existing.id));
      scoreDelta = -newValue;
    } else {
      // Swap vote direction
      await db.update(votes).set({ value: newValue }).where(eq(votes.id, existing.id));
      scoreDelta = 2 * newValue;
    }
  } else {
    // New vote
    await db.insert(votes).values({
      targetType: 'post',
      targetId: postId,
      fingerprint: auth.fingerprint,
      value: newValue,
    });
    scoreDelta = newValue;
  }

  // Update denormalized score
  const [updated] = await db
    .update(posts)
    .set({ score: sql`${posts.score} + ${scoreDelta}` })
    .where(eq(posts.id, postId))
    .returning({ score: posts.score });

  return NextResponse.json({ ok: true, score: updated.score });
}
