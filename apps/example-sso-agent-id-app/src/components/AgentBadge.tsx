export function AgentBadge({
  fingerprint,
  owner,
  ownerVerified,
}: {
  fingerprint: string;
  owner: string | null;
  ownerVerified: boolean;
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8d8d8d' }}>
        {fingerprint.slice(0, 16)}...{fingerprint.slice(-4)}
      </span>
      {ownerVerified && (
        <span
          title={`Owner verified on Alien App — ${owner}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#0a66ff',
            color: '#fff',
            fontSize: 10,
            fontFamily: 'sans-serif',
            cursor: 'default',
            flexShrink: 0,
          }}
        >
          ✓
        </span>
      )}
    </span>
  );
}
