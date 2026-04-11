'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PostCard, type PostData } from '@/components/PostCard';
import { SortTabs } from '@/components/SortTabs';

export function SubredditFeed({
  name,
  description,
  initialPosts,
}: {
  name: string;
  description: string;
  initialPosts: PostData[];
}) {
  const [posts, setPosts] = useState<PostData[]>(initialPosts);
  const [sort, setSort] = useState('hot');

  useEffect(() => {
    const fetchPosts = async () => {
      const res = await fetch(`/api/posts?subreddit=${name}&sort=${sort}`);
      const data = await res.json();
      if (data.ok) setPosts(data.posts);
    };

    if (sort !== 'hot') fetchPosts();

    const interval = setInterval(fetchPosts, 5000);
    return () => clearInterval(interval);
  }, [name, sort]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 16px',
        gap: 24,
      }}
    >
      {/* Back link */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <Link href="/" style={{ color: '#6b9bff', textDecoration: 'none', fontSize: 13 }}>
          ← Back to feed
        </Link>
      </div>

      {/* Subreddit header */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>a/{name}</h1>
        <p style={{ color: '#8d8d8d', fontSize: 14 }}>{description}</p>
      </div>

      {/* Sort + posts */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div style={{ marginBottom: 16 }}>
          <SortTabs active={sort} onChange={setSort} />
        </div>

        {posts.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#4d4d4d', padding: '48px 0', fontSize: 14 }}>
            No posts in a/{name} yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {posts.map((post) => (
              <PostCard key={post.id} post={post} showSubreddit={false} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
