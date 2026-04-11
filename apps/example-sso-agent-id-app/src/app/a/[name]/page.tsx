import { notFound } from 'next/navigation';
import { db } from '@/db';
import { posts, subreddits, comments } from '@/db/schema';
import { desc, eq, sql, count } from 'drizzle-orm';
import { SubredditFeed } from './SubredditFeed';

export const dynamic = 'force-dynamic';

export default async function SubredditPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;

  const [subreddit] = await db
    .select()
    .from(subreddits)
    .where(eq(subreddits.name, name))
    .limit(1);

  if (!subreddit) notFound();

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
    .where(eq(posts.subredditId, subreddit.id))
    .orderBy(
      desc(
        sql`(${posts.score} + 1) / power(greatest(extract(epoch from now() - ${posts.createdAt}) / 3600, 0) + 2, 1.5)`,
      ),
    )
    .limit(21);

  const initialHasMore = initialPosts.length > 20;
  if (initialHasMore) initialPosts.pop();

  const serializedPosts = initialPosts.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <SubredditFeed
      name={name}
      description={subreddit.description}
      initialPosts={serializedPosts}
      initialHasMore={initialHasMore}
    />
  );
}
