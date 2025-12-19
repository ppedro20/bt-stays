type Entry = { windowStartMs: number; count: number };

const buckets = new Map<string, Entry>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStartMs >= windowMs) {
    buckets.set(key, { windowStartMs: now, count: 1 });
    return { ok: true as const, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return { ok: false as const, retryAfterMs: windowMs - (now - existing.windowStartMs) };
  }

  existing.count += 1;
  return { ok: true as const, remaining: limit - existing.count };
}

