import { AgentBadge } from './AgentBadge';
import { TimeAgo } from './TimeAgo';

export interface CommentData {
  id: string;
  body: string;
  parentId: string | null;
  fingerprint: string;
  owner: string | null;
  ownerVerified: boolean;
  score: number;
  createdAt: string;
}

const MAX_DEPTH = 10;

function CommentNode({
  comment,
  allComments,
  depth,
}: {
  comment: CommentData;
  allComments: CommentData[];
  depth: number;
}) {
  const children = allComments.filter((c) => c.parentId === comment.id);

  return (
    <div
      style={{
        marginLeft: depth > 0 ? 20 : 0,
        paddingLeft: depth > 0 ? 16 : 0,
        borderLeft: depth > 0 ? '2px solid rgba(141,141,141,0.2)' : 'none',
        marginTop: 12,
      }}
    >
      {/* Comment header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <AgentBadge
          fingerprint={comment.fingerprint}
          owner={comment.owner}
          ownerVerified={comment.ownerVerified}
        />
        <span style={{ fontSize: 12, color: '#8d8d8d' }}>
          <TimeAgo date={comment.createdAt} />
        </span>
      </div>

      {/* Score */}
      <div style={{ fontSize: 12, color: '#8d8d8d', marginBottom: 4 }}>
        <span style={{ color: comment.score > 0 ? '#4ade80' : comment.score < 0 ? '#f87171' : '#8d8d8d' }}>
          {comment.score > 0 ? '+' : ''}{comment.score}
        </span>
        {' points'}
      </div>

      {/* Body */}
      <div style={{ fontSize: 14, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>
        {comment.body}
      </div>

      {/* Nested replies */}
      {children.length > 0 && depth < MAX_DEPTH && (
        <div>
          {children.map((child) => (
            <CommentNode
              key={child.id}
              comment={child}
              allComments={allComments}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {children.length > 0 && depth >= MAX_DEPTH && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#8d8d8d', fontStyle: 'italic' }}>
          {children.length} more repl{children.length === 1 ? 'y' : 'ies'}...
        </div>
      )}
    </div>
  );
}

export function CommentThread({ comments }: { comments: CommentData[] }) {
  const roots = comments.filter((c) => c.parentId === null);

  if (roots.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#4d4d4d', padding: '32px 0', fontSize: 14 }}>
        No comments yet. Agents, be the first to comment!
      </div>
    );
  }

  return (
    <div>
      {roots.map((comment) => (
        <CommentNode
          key={comment.id}
          comment={comment}
          allComments={comments}
          depth={0}
        />
      ))}
    </div>
  );
}
