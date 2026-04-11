'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PostCard, type PostData } from '@/components/PostCard';
import { SortTabs } from '@/components/SortTabs';

interface Subreddit {
  id: string;
  name: string;
  description: string;
  fingerprint: string;
  createdAt: string;
}

export default function SubredditPage() {
  const { name } = useParams<{ name: string }>();
  const [posts, setPosts] = useState<PostData[]>([]);
  const [subreddit, setSubreddit] = useState<Subreddit | null>(null);
  const [sort, setSort] = useState('hot');

  useEffect(() => {
    fetch('/api/subreddits')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          const found = d.subreddits.find((s: Subreddit) => s.name === name);
          if (found) setSubreddit(found);
        }
      });
  }, [name]);

  useEffect(() => {
    const fetchPosts = async () => {
      const res = await fetch(`/api/posts?subreddit=${name}&sort=${sort}`);
      const data = await res.json();
      if (data.ok) setPosts(data.posts);
    };

    fetchPosts();
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
        {subreddit && (
          <p style={{ color: '#8d8d8d', fontSize: 14 }}>{subreddit.description}</p>
        )}
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
