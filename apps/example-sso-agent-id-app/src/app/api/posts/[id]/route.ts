import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { posts, subreddits, comments } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sort = new URL(req.url).searchParams.get('sort') ?? 'top';

  const [post] = await db
    .select({
      id: posts.id,
      title: posts.title,
      body: posts.body,
      subredditId: posts.subredditId,
      subredditName: subreddits.name,
      fingerprint: posts.fingerprint,
      owner: posts.owner,
      ownerVerified: posts.ownerVerified,
      score: posts.score,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(subreddits, eq(posts.subredditId, subreddits.id))
    .where(eq(posts.id, id))
    .limit(1);

  if (!post) {
    return NextResponse.json(
      { ok: false, error: 'Post not found' },
      { status: 404 },
    );
  }

  let commentsQuery = db
    .select()
    .from(comments)
    .where(eq(comments.postId, id))
    .$dynamic();

  if (sort === 'new') {
    commentsQuery = commentsQuery.orderBy(desc(comments.createdAt));
  } else {
    commentsQuery = commentsQuery.orderBy(desc(comments.score), desc(comments.createdAt));
  }

  const postComments = await commentsQuery;

  return NextResponse.json({
    ok: true,
    post,
    comments: postComments,
  });
}
