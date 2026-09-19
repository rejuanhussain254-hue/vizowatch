// Tiny client-side cache for YouTube data (search, channels, playlists, metadata).
// Keeps results in memory for instant re-renders and mirrors them to sessionStorage
// so going back to a channel/feed doesn't refetch and re-render everything.

const STORE_PREFIX = "echo.cache.";
const MAX_ENTRIES = 120;

type Entry<T> = { v: T; exp: number };

const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export const TTL = {
  search: 15 * 60 * 1000,
  suggest: 30 * 60 * 1000,
  channel: 30 * 60 * 1000,
  playlist: 30 * 60 * 1000,
  meta: 6 * 60 * 60 * 1000,
} as const;

function now() {
  return Date.now();
}

function readStore<T>(key: string): Entry<T> | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    if (!e || typeof e.exp !== "number" || e.exp < now()) {
      sessionStorage.removeItem(STORE_PREFIX + key);
      return null;
    }
    return e;
  } catch {
    return null;
  }
}

function writeStore<T>(key: string, entry: Entry<T>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // storage full — drop our own oldest keys and give up quietly
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith(STORE_PREFIX)) sessionStorage.removeItem(k);
      }
      sessionStorage.setItem(STORE_PREFIX + key, JSON.stringify(entry));
    } catch {
      /* noop */
    }
  }
}

export function cacheGet<T>(key: string): T | null {
  const hit = mem.get(key) as Entry<T> | undefined;
  if (hit && hit.exp > now()) return hit.v;
  if (hit) mem.delete(key);
  const stored = readStore<T>(key);
  if (stored) {
    mem.set(key, stored as Entry<unknown>);
    return stored.v;
  }
  return null;
}

export function cacheSet<T>(key: string, value: T, ttl: number) {
  const entry: Entry<T> = { v: value, exp: now() + ttl };
  if (mem.size >= MAX_ENTRIES) {
    const oldest = mem.keys().next().value;
    if (oldest) mem.delete(oldest);
  }
  mem.set(key, entry as Entry<unknown>);
  writeStore(key, entry);
}

/**
 * Return a cached value, or run `fn` once and cache it.
 * Identical concurrent calls share a single request.
 * `keep` decides whether a result is worth caching (skip failures).
 */
export async function cached<T>(
  key: string,
  ttl: number,
  fn: () => Promise<T>,
  keep: (value: T) => boolean = () => true,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = (async () => {
    try {
      const value = await fn();
      if (keep(value)) cacheSet(key, value, ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p as Promise<unknown>);
  return p;
}
