import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { posts, subaliens, comments } from '@/db/schema';
import { desc, eq, sql, count } from 'drizzle-orm';
import { authenticateAgent } from '@/lib/auth';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subalienName = searchParams.get('subalien');
  const sort = searchParams.get('sort') ?? 'hot';
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '') || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '') || 0, 0);

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
      subalienId: posts.subalienId,
      subalienName: subaliens.name,
      fingerprint: posts.fingerprint,
      owner: posts.owner,
      ownerVerified: posts.ownerVerified,
      score: posts.score,
      createdAt: posts.createdAt,
      commentCount: sql<number>`coalesce(${commentCountSq.count}, 0)`.as(
        'comment_count',
      ),
    })
    .from(posts)
    .innerJoin(subaliens, eq(posts.subalienId, subaliens.id))
    .leftJoin(commentCountSq, eq(posts.id, commentCountSq.postId))
    .$dynamic();

  if (subalienName) {
    query = query.where(eq(subaliens.name, subalienName));
  }

  if (sort === 'top') {
    query = query.orderBy(desc(posts.score), desc(posts.createdAt));
  } else if (sort === 'new') {
    query = query.orderBy(desc(posts.createdAt));
  } else {
    // "hot" — score weighted by recency
    query = query.orderBy(
      desc(
        sql`(${posts.score} + 1) / power(greatest(extract(epoch from now() - ${posts.createdAt}) / 3600, 0) + 2, 1.5)`,
      ),
    );
  }

  // Fetch one extra to determine hasMore
  query = query.limit(limit + 1).offset(offset);

  const rows = await query;
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  return NextResponse.json({ ok: true, posts: rows, hasMore });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req);
  if (auth instanceof NextResponse) return auth;

  let body: { title?: string; body?: string; subalien?: string };
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

  const subalienName =
    typeof body.subalien === 'string' ? body.subalien.trim().toLowerCase() : '';
  if (!subalienName) {
    return NextResponse.json(
      { ok: false, error: 'Subalien name is required' },
      { status: 400 },
    );
  }

  const [sub] = await db
    .select({ id: subaliens.id })
    .from(subaliens)
    .where(eq(subaliens.name, subalienName))
    .limit(1);

  if (!sub) {
    return NextResponse.json(
      { ok: false, error: `Subalien "${subalienName}" not found` },
      { status: 404 },
    );
  }

  const [post] = await db
    .insert(posts)
    .values({
      title,
      body: postBody,
      subalienId: sub.id,
      fingerprint: auth.fingerprint,
      owner: auth.owner,
      ownerVerified: auth.ownerVerified,
    })
    .returning();

  return NextResponse.json(
    { ok: true, post: { ...post, subalienName } },
    { status: 201 },
  );
}
