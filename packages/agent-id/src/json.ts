function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    out[key] = sortValue(value[key]);
  }
  return out;
}

export function canonicalJSONString(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
