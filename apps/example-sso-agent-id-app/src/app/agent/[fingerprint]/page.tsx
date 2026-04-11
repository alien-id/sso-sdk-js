'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PostCard, type PostData } from '@/components/PostCard';
import { TimeAgo } from '@/components/TimeAgo';

interface Profile {
  fingerprint: string;
  owner: string | null;
  ownerVerified: boolean;
  postCount: number;
  commentCount: number;
  totalKarma: number;
  firstSeen: string;
  lastActive: string;
}

interface AgentComment {
  id: string;
  body: string;
  postId: string;
  postTitle: string;
  subredditName: string;
  score: number;
  createdAt: string;
}

export default function AgentProfilePage() {
  const { fingerprint } = useParams<{ fingerprint: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<PostData[]>([]);
  const [comments, setComments] = useState<AgentComment[]>([]);
  const [tab, setTab] = useState<'posts' | 'comments'>('posts');
  const [sort, setSort] = useState('new');
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch(`/api/agents/${fingerprint}?tab=${tab}&sort=${sort}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Agent not found');
        return;
      }
      setProfile(data.profile);
      if (tab === 'posts') setPosts(data.posts ?? []);
      if (tab === 'comments') setComments(data.comments ?? []);
    };
    fetchData();
  }, [fingerprint, tab, sort]);

  if (error) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#f87171' }}>{error}</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#8d8d8d' }}>Loading...</p>
      </main>
    );
  }

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
      {/* Back */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        <Link href="/" style={{ color: '#2979ff', textDecoration: 'none', fontSize: 13 }}>
          ← Back to feed
        </Link>
      </div>

      {/* Profile card */}
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
        {/* Fingerprint */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
            {profile.fingerprint}
          </span>
          {profile.ownerVerified && (
            <span
              title={`Owner verified — ${profile.owner}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#2979ff',
                color: '#fff',
                fontSize: 11,
                fontFamily: 'sans-serif',
                flexShrink: 0,
              }}
            >
              ✓
            </span>
          )}
        </div>

        {/* Owner */}
        {profile.owner && (
          <div style={{ fontSize: 13, color: '#8d8d8d', marginBottom: 16 }}>
            Owner: <span style={{ fontFamily: 'monospace' }}>{profile.owner}</span>
          </div>
        )}

        {/* Stats grid */}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Karma" value={profile.totalKarma} color={profile.totalKarma > 0 ? '#4ade80' : profile.totalKarma < 0 ? '#f87171' : '#8d8d8d'} />
          <Stat label="Posts" value={profile.postCount} />
          <Stat label="Comments" value={profile.commentCount} />
          <Stat label="First seen" value={new Date(profile.firstSeen).toLocaleDateString()} />
          <Stat label="Last active" value={new Date(profile.lastActive).toLocaleDateString()} />
        </div>
      </div>

      {/* Tabs + sort */}
      <div style={{ width: '100%', maxWidth: 640, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['posts', 'comments'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: '6px 14px',
                borderRadius: 16,
                border: 'none',
                background: tab === t ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: tab === t ? '#fff' : '#8d8d8d',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['new', 'top'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              style={{
                padding: '6px 14px',
                borderRadius: 16,
                border: 'none',
                background: sort === s ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: sort === s ? '#fff' : '#8d8d8d',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ width: '100%', maxWidth: 640 }}>
        {tab === 'posts' && (
          posts.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#4d4d4d', padding: '32px 0', fontSize: 14 }}>
              No posts yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {posts.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )
        )}

        {tab === 'comments' && (
          comments.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#4d4d4d', padding: '32px 0', fontSize: 14 }}>
              No comments yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {comments.map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    background: 'rgba(141,141,141,0.08)',
                    border: '1px solid rgba(141,141,141,0.12)',
                  }}
                >
                  {/* Context */}
                  <div style={{ fontSize: 12, color: '#8d8d8d', marginBottom: 8 }}>
                    <Link
                      href={`/a/${c.subredditName}/post/${c.postId}`}
                      style={{ color: '#2979ff', textDecoration: 'none' }}
                    >
                      {c.postTitle}
                    </Link>
                    {' in '}
                    <Link
                      href={`/a/${c.subredditName}`}
                      style={{ color: '#2979ff', textDecoration: 'none' }}
                    >
                      a/{c.subredditName}
                    </Link>
                  </div>

                  {/* Body */}
                  <div style={{ fontSize: 14, lineHeight: '20px', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                    {c.body.length > 300 ? c.body.slice(0, 300) + '...' : c.body}
                  </div>

                  {/* Footer */}
                  <div style={{ fontSize: 12, color: '#8d8d8d', display: 'flex', gap: 16 }}>
                    <span style={{ color: c.score > 0 ? '#4ade80' : c.score < 0 ? '#f87171' : '#8d8d8d' }}>
                      {c.score > 0 ? '+' : ''}{c.score} points
                    </span>
                    <TimeAgo date={c.createdAt} />
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 600, color: color ?? '#fff' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#8d8d8d' }}>{label}</div>
    </div>
  );
}
