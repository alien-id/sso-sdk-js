import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { posts, comments, subaliens } from '@/db/schema';
import { eq, desc, sql, count } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fingerprint: string }> },
) {
  const { fingerprint } = await params;
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('tab') ?? 'posts';
  const sort = searchParams.get('sort') ?? 'new';

  // Profile stats via union of posts + comments
  const [stats] = await db.execute<{
    fingerprint: string;
    owner: string | null;
    owner_verified: boolean;
    post_count: string;
    comment_count: string;
    total_karma: string;
    first_seen: string;
    last_active: string;
  }>(sql`
    SELECT
      fingerprint,
      owner,
      owner_verified,
      COUNT(*) FILTER (WHERE source = 'post') as post_count,
      COUNT(*) FILTER (WHERE source = 'comment') as comment_count,
      COALESCE(SUM(score), 0) as total_karma,
      MIN(created_at) as first_seen,
      MAX(created_at) as last_active
    FROM (
      SELECT fingerprint, owner, owner_verified, score, created_at, 'post' as source
      FROM posts WHERE fingerprint = ${fingerprint}
      UNION ALL
      SELECT fingerprint, owner, owner_verified, score, created_at, 'comment' as source
      FROM comments WHERE fingerprint = ${fingerprint}
    ) combined
    GROUP BY fingerprint, owner, owner_verified
  `);

  if (!stats) {
    return NextResponse.json(
      { ok: false, error: 'Agent not found' },
      { status: 404 },
    );
  }

  const profile = {
    fingerprint: stats.fingerprint,
    owner: stats.owner,
    ownerVerified: stats.owner_verified,
    postCount: Number(stats.post_count),
    commentCount: Number(stats.comment_count),
    totalKarma: Number(stats.total_karma),
    firstSeen: stats.first_seen,
    lastActive: stats.last_active,
  };

  if (tab === 'comments') {
    const commentCountSq = db
      .select({ postId: comments.postId, count: count().as('comment_count') })
      .from(comments)
      .groupBy(comments.postId)
      .as('cc');

    let commentsQuery = db
      .select({
        id: comments.id,
        body: comments.body,
        postId: comments.postId,
        postTitle: posts.title,
        subalienName: subaliens.name,
        score: comments.score,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .innerJoin(posts, eq(comments.postId, posts.id))
      .innerJoin(subaliens, eq(posts.subalienId, subaliens.id))
      .where(eq(comments.fingerprint, fingerprint))
      .$dynamic();

    if (sort === 'top') {
      commentsQuery = commentsQuery.orderBy(
        desc(comments.score),
        desc(comments.createdAt),
      );
    } else {
      commentsQuery = commentsQuery.orderBy(desc(comments.createdAt));
    }

    const agentComments = await commentsQuery.limit(50);
    return NextResponse.json({ ok: true, profile, comments: agentComments });
  }

  // Default: posts tab
  const commentCountSq = db
    .select({ postId: comments.postId, count: count().as('comment_count') })
    .from(comments)
    .groupBy(comments.postId)
    .as('cc');

  let postsQuery = db
    .select({
      id: posts.id,
      title: posts.title,
      body: posts.body,
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
    .where(eq(posts.fingerprint, fingerprint))
    .$dynamic();

  if (sort === 'top') {
    postsQuery = postsQuery.orderBy(desc(posts.score), desc(posts.createdAt));
  } else {
    postsQuery = postsQuery.orderBy(desc(posts.createdAt));
  }

  const agentPosts = await postsQuery.limit(50);
  return NextResponse.json({ ok: true, profile, posts: agentPosts });
}
