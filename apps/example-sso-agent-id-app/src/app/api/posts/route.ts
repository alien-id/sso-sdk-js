import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { posts, subreddits, comments } from '@/db/schema';
import { desc, eq, sql, count } from 'drizzle-orm';
import { authenticateAgent } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subredditName = searchParams.get('subreddit');
  const sort = searchParams.get('sort') ?? 'hot';

  const commentCountSq = db
    .select({ postId: comments.postId, count: count().as('comment_count') })
    .from(comments)
    .groupBy(comments.postId)
    .as('cc');

  let query = db
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
      commentCount: sql<number>`coalesce(${commentCountSq.count}, 0)`.as('comment_count'),
    })
    .from(posts)
    .innerJoin(subreddits, eq(posts.subredditId, subreddits.id))
    .leftJoin(commentCountSq, eq(posts.id, commentCountSq.postId))
    .$dynamic();

  if (subredditName) {
    query = query.where(eq(subreddits.name, subredditName));
  }

  if (sort === 'top') {
    query = query.orderBy(desc(posts.score), desc(posts.createdAt));
  } else if (sort === 'new') {
    query = query.orderBy(desc(posts.createdAt));
  } else {
    // "hot" — score weighted by recency
    query = query.orderBy(
      desc(
        sql`(${posts.score} + 1) / power(extract(epoch from now() - ${posts.createdAt}) / 3600 + 2, 1.5)`,
      ),
    );
  }

  query = query.limit(100);

  const rows = await query;
  return NextResponse.json({ ok: true, posts: rows });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req);
  if (auth instanceof NextResponse) return auth;

  let body: { title?: string; body?: string; subreddit?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json(
      { ok: false, error: 'Title is required' },
      { status: 400 },
    );
  }
  if (title.length > 300) {
    return NextResponse.json(
      { ok: false, error: 'Title too long (max 300 chars)' },
      { status: 400 },
    );
  }

  const postBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!postBody) {
    return NextResponse.json(
      { ok: false, error: 'Body is required' },
      { status: 400 },
    );
  }
  if (postBody.length > 10000) {
    return NextResponse.json(
      { ok: false, error: 'Body too long (max 10000 chars)' },
      { status: 400 },
    );
  }

  const subredditName = typeof body.subreddit === 'string' ? body.subreddit.trim().toLowerCase() : '';
  if (!subredditName) {
    return NextResponse.json(
      { ok: false, error: 'Subreddit name is required' },
      { status: 400 },
    );
  }

  const [sub] = await db
    .select({ id: subreddits.id })
    .from(subreddits)
    .where(eq(subreddits.name, subredditName))
    .limit(1);

  if (!sub) {
    return NextResponse.json(
      { ok: false, error: `Subreddit "${subredditName}" not found` },
      { status: 404 },
    );
  }

  const [post] = await db
    .insert(posts)
    .values({
      title,
      body: postBody,
      subredditId: sub.id,
      fingerprint: auth.fingerprint,
      owner: auth.owner,
      ownerVerified: auth.ownerVerified,
    })
    .returning();

  return NextResponse.json({ ok: true, post: { ...post, subredditName } }, { status: 201 });
}
