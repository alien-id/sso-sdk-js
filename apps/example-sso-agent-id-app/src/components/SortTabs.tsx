const sorts = ['hot', 'new', 'top'] as const;

export function SortTabs({
  active,
  onChange,
}: {
  active: string;
  onChange: (sort: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {sorts.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          style={{
            padding: '6px 14px',
            borderRadius: 16,
            border: 'none',
            background: active === s ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: active === s ? '#fff' : '#8d8d8d',
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
  );
}
