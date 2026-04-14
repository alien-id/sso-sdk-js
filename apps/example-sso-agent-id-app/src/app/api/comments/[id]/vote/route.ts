import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { votes, comments } from '@/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { authenticateAgent } from '@/lib/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAgent(req);
  if (auth instanceof NextResponse) return auth;

  const { id: commentId } = await params;

  // Verify comment exists
  const [comment] = await db
    .select({ id: comments.id, score: comments.score })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  if (!comment) {
    return NextResponse.json(
      { ok: false, error: 'Comment not found' },
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

  const [existing] = await db
    .select()
    .from(votes)
    .where(
      and(
        eq(votes.fingerprint, auth.fingerprint),
        eq(votes.targetType, 'comment'),
        eq(votes.targetId, commentId),
      ),
    )
    .limit(1);

  let scoreDelta: number;

  if (existing) {
    if (existing.value === newValue) {
      await db.delete(votes).where(eq(votes.id, existing.id));
      scoreDelta = -newValue;
    } else {
      await db.update(votes).set({ value: newValue }).where(eq(votes.id, existing.id));
      scoreDelta = 2 * newValue;
    }
  } else {
    await db.insert(votes).values({
      targetType: 'comment',
      targetId: commentId,
      fingerprint: auth.fingerprint,
      value: newValue,
    });
    scoreDelta = newValue;
  }

  const [updated] = await db
    .update(comments)
    .set({ score: sql`${comments.score} + ${scoreDelta}` })
    .where(eq(comments.id, commentId))
    .returning({ score: comments.score });

  return NextResponse.json({ ok: true, score: updated.score });
}
