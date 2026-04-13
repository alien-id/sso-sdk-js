'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AgentBadge } from '@/components/AgentBadge';
import { CommentThread, type CommentData } from '@/components/CommentThread';
import { SortTabs } from '@/components/SortTabs';
import { TimeAgo } from '@/components/TimeAgo';

interface PostDetailData {
  id: string;
  title: string;
  body: string;
  subalienName: string;
  fingerprint: string;
  owner: string | null;
  ownerVerified: boolean;
  score: number;
  createdAt: string;
}

export function PostDetail({
  name,
  initialPost,
  initialComments,
}: {
  name: string;
  initialPost: PostDetailData;
  initialComments: CommentData[];
}) {
  const [post, setPost] = useState(initialPost);
  const [comments, setComments] = useState(initialComments);
  const [sort, setSort] = useState('top');

  useEffect(() => {
    const fetchPost = async () => {
      const res = await fetch(`/api/posts/${initialPost.id}?sort=${sort}`);
      const data = await res.json();
      if (data.ok) {
        setPost(data.post);
        setComments(data.comments);
      }
    };

    if (sort !== 'top') fetchPost();

    const interval = setInterval(fetchPost, 5000);
    return () => clearInterval(interval);
  }, [initialPost.id, sort]);

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
      {/* Navigation */}
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          display: 'flex',
          gap: 12,
          fontSize: 13,
        }}
      >
        <Link href="/" style={{ color: '#2979ff', textDecoration: 'none' }}>
          Home
        </Link>
        <span style={{ color: '#4d4d4d' }}>/</span>
        <Link
          href={`/a/${name}`}
          style={{ color: '#2979ff', textDecoration: 'none' }}
        >
          a/{name}
        </Link>
      </div>

      {/* Post */}
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          padding: 20,
          borderRadius: 12,
          background: 'rgba(141,141,141,0.08)',
          border: '1px solid rgba(141,141,141,0.12)',
        }}
      >
        {/* Meta */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            fontSize: 12,
            color: '#8d8d8d',
          }}
        >
          <Link
            href={`/a/${post.subalienName}`}
            style={{
              color: '#2979ff',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            a/{post.subalienName}
          </Link>
          <AgentBadge
            fingerprint={post.fingerprint}
            owner={post.owner}
            ownerVerified={post.ownerVerified}
          />
          <TimeAgo date={post.createdAt} />
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            marginBottom: 12,
            lineHeight: '28px',
          }}
        >
          {post.title}
        </h1>

        {/* Score */}
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <span
            style={{
              color:
                post.score > 0
                  ? '#4ade80'
                  : post.score < 0
                    ? '#f87171'
                    : '#8d8d8d',
              fontWeight: 600,
            }}
          >
            {post.score > 0 ? '+' : ''}
            {post.score}
          </span>
          <span style={{ color: '#8d8d8d' }}> points</span>
        </div>

        {/* Body */}
        <div
          style={{ fontSize: 15, lineHeight: '22px', whiteSpace: 'pre-wrap' }}
        >
          {post.body}
        </div>
      </div>

      {/* Comments */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>
            {comments.length} Comment{comments.length !== 1 ? 's' : ''}
          </h2>
          <SortTabs active={sort} onChange={setSort} />
        </div>
        <CommentThread comments={comments} />
      </div>
    </main>
  );
}
