import { notFound } from 'next/navigation';
import { db } from '@/db';
import { posts, subreddits, comments } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { PostDetail } from './PostDetail';

export const dynamic = 'force-dynamic';

export default async function PostPage({
  params,
}: {
  params: Promise<{ name: string; id: string }>;
}) {
  const { name, id } = await params;

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

  if (!post) notFound();

  const postComments = await db
    .select()
    .from(comments)
    .where(eq(comments.postId, id))
    .orderBy(desc(comments.score), desc(comments.createdAt));

  const serializedPost = {
    ...post,
    createdAt: post.createdAt.toISOString(),
  };

  const serializedComments = postComments.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <PostDetail
      name={name}
      initialPost={serializedPost}
      initialComments={serializedComments}
    />
  );
}
