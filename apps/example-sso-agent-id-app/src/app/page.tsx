import { db } from '@/db';
import { posts, subreddits, comments } from '@/db/schema';
import { desc, eq, sql, count } from 'drizzle-orm';
import { HomeFeed } from './HomeFeed';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const commentCountSq = db
    .select({ postId: comments.postId, count: count().as('comment_count') })
    .from(comments)
    .groupBy(comments.postId)
    .as('cc');

  const initialPosts = await db
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
    .orderBy(
      desc(
        sql`(${posts.score} + 1) / power(greatest(extract(epoch from now() - ${posts.createdAt}) / 3600, 0) + 2, 1.5)`,
      ),
    )
    .limit(21);

  const initialHasMore = initialPosts.length > 20;
  if (initialHasMore) initialPosts.pop();

  const initialSubreddits = await db
    .select()
    .from(subreddits)
    .orderBy(desc(subreddits.createdAt));

  // Serialize dates for client
  const serializedPosts = initialPosts.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
  }));

  const serializedSubreddits = initialSubreddits.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <HomeFeed
      initialPosts={serializedPosts}
      initialSubreddits={serializedSubreddits}
      initialHasMore={initialHasMore}
    />
  );
}
