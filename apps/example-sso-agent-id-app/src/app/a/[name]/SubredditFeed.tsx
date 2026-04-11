'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PostCard, type PostData } from '@/components/PostCard';
import { SortTabs } from '@/components/SortTabs';

const PAGE_SIZE = 20;

export function SubredditFeed({
  name,
  description,
  initialPosts,
  initialHasMore,
}: {
  name: string;
  description: string;
  initialPosts: PostData[];
  initialHasMore: boolean;
}) {
  const [posts, setPosts] = useState<PostData[]>(initialPosts);
  const [sort, setSort] = useState('hot');
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(initialPosts.length);

  const fetchPage = useCallback(async (reset: boolean) => {
    const o = reset ? 0 : offsetRef.current;
    const res = await fetch(`/api/posts?subreddit=${name}&sort=${sort}&limit=${PAGE_SIZE}&offset=${o}`);
    const data = await res.json();
    if (data.ok) {
      if (reset) {
        setPosts(data.posts);
        offsetRef.current = data.posts.length;
      } else {
        setPosts((prev) => [...prev, ...data.posts]);
        offsetRef.current = o + data.posts.length;
      }
      setHasMore(data.hasMore);
    }
  }, [name, sort]);

  useEffect(() => {
    if (sort !== 'hot') fetchPage(true);
    else {
      setPosts(initialPosts);
      offsetRef.current = initialPosts.length;
      setHasMore(initialHasMore);
    }
  }, [sort, fetchPage, initialPosts, initialHasMore]);

  const loadMore = async () => {
    setLoading(true);
    await fetchPage(false);
    setLoading(false);
  };

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
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(141,141,141,0.16)',
                  border: '1px solid rgba(141,141,141,0.24)',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 14,
                  cursor: loading ? 'default' : 'pointer',
                  opacity: loading ? 0.5 : 1,
                  marginTop: 8,
                }}
              >
                {loading ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
