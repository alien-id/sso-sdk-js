import { notFound } from 'next/navigation';
import { db } from '@/db';
import { posts, subaliens, comments } from '@/db/schema';
import { desc, eq, sql, count } from 'drizzle-orm';
import { SubalienFeed } from './SubalienFeed';

export const dynamic = 'force-dynamic';

export default async function SubalienPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;

  const [subalien] = await db
    .select()
    .from(subaliens)
    .where(eq(subaliens.name, name))
    .limit(1);

  if (!subalien) notFound();

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
    .where(eq(posts.subalienId, subalien.id))
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
    <SubalienFeed
      name={name}
      description={subalien.description}
      initialPosts={serializedPosts}
      initialHasMore={initialHasMore}
    />
  );
}
