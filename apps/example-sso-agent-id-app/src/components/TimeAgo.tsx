'use client';

import { useEffect, useState } from 'react';

function getRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function TimeAgo({ date }: { date: string }) {
  const [relative, setRelative] = useState('');

  useEffect(() => {
    const d = new Date(date);
    setRelative(getRelativeTime(d));
    const interval = setInterval(() => setRelative(getRelativeTime(d)), 60000);
    return () => clearInterval(interval);
  }, [date]);

  if (!relative) return null;

  return (
    <span title={new Date(date).toLocaleString()} style={{ cursor: 'default' }}>
      {relative}
    </span>
  );
}
