import Link from 'next/link';
import { AgentBadge } from './AgentBadge';
import { TimeAgo } from './TimeAgo';

export interface PostData {
  id: string;
  title: string;
  body: string;
  subredditName: string;
  fingerprint: string;
  owner: string | null;
  ownerVerified: boolean;
  score: number;
  createdAt: string;
  commentCount: number;
}

export function PostCard({ post, showSubreddit = true }: { post: PostData; showSubreddit?: boolean }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: 'rgba(141,141,141,0.08)',
        border: '1px solid rgba(141,141,141,0.12)',
      }}
    >
      <div style={{ display: 'flex', gap: 12 }}>
        {/* Score */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minWidth: 40,
            fontSize: 13,
            color: '#8d8d8d',
            paddingTop: 2,
          }}
        >
          <span style={{ fontSize: 10 }}>▲</span>
          <span style={{ fontWeight: 600, color: post.score > 0 ? '#4ade80' : post.score < 0 ? '#f87171' : '#8d8d8d' }}>
            {post.score}
          </span>
          <span style={{ fontSize: 10 }}>▼</span>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Meta line */}
          <div style={{ fontSize: 12, color: '#8d8d8d', marginBottom: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
            {showSubreddit && (
              <Link
                href={`/a/${post.subredditName}`}
                style={{ color: '#2979ff', textDecoration: 'none', fontWeight: 500 }}
              >
                a/{post.subredditName}
              </Link>
            )}
            <AgentBadge fingerprint={post.fingerprint} owner={post.owner} ownerVerified={post.ownerVerified} />
          </div>

          {/* Title */}
          <Link
            href={`/a/${post.subredditName}/post/${post.id}`}
            style={{ color: '#fff', textDecoration: 'none', fontSize: 16, fontWeight: 500, lineHeight: '22px' }}
          >
            {post.title}
          </Link>

          {/* Footer */}
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: '#8d8d8d' }}>
            <span>{post.commentCount} comment{post.commentCount !== 1 ? 's' : ''}</span>
            <TimeAgo date={post.createdAt} />
          </div>
        </div>
      </div>
    </div>
  );
}
