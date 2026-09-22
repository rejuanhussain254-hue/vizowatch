// What this person likes to watch: genres, channels and search terms, scored and
// decayed over time, so the home feed can lean towards their own taste.

export type Taste = {
  genres: Record<string, number>;
  channels: Record<string, number>;
  terms: Record<string, number>;
  at: number;
};

const KEY = "echo.taste.v1";
const HALF_LIFE_DAYS = 14;
const MAX_KEYS = 40;
const MIN_SCORE = 0.08;

export function emptyTaste(): Taste {
  return { genres: {}, channels: {}, terms: {}, at: Date.now() };
}

function prune(map: Record<string, number>, factor: number) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const s = v * factor;
    if (s >= MIN_SCORE) out[k] = Math.round(s * 1000) / 1000;
  }
  const keys = Object.keys(out).sort((a, b) => (out[b] ?? 0) - (out[a] ?? 0)).slice(0, MAX_KEYS);
  const capped: Record<string, number> = {};
  for (const k of keys) capped[k] = out[k]!;
  return capped;
}

export function loadTaste(): Taste {
  if (typeof window === "undefined") return emptyTaste();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyTaste();
    const p = JSON.parse(raw) as Partial<Taste>;
    const days = Math.max(0, (Date.now() - (p.at ?? Date.now())) / 86_400_000);
    const factor = Math.pow(0.5, days / HALF_LIFE_DAYS);
    return {
      genres: prune(p.genres ?? {}, factor),
      channels: prune(p.channels ?? {}, factor),
      terms: prune(p.terms ?? {}, factor),
      at: Date.now(),
    };
  } catch {
    return emptyTaste();
  }
}

export function saveTaste(t: Taste) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...t, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** Add weight to one signal and persist. Returns the updated profile. */
export function bumpTaste(t: Taste, kind: keyof Omit<Taste, "at">, key: string, weight = 1): Taste {
  const k = key.trim();
  if (!k) return t;
  const next: Taste = { ...t, genres: { ...t.genres }, channels: { ...t.channels }, terms: { ...t.terms } };
  next[kind][k] = (next[kind][k] ?? 0) + weight;
  next[kind] = prune(next[kind], 1);
  next.at = Date.now();
  saveTaste(next);
  return next;
}

export function topTaste(map: Record<string, number>, n: number) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/** How well a video matches this taste profile (bigger = closer to what they watch). */
export function tasteScore(t: Taste, text: string, author?: string, genre?: string) {
  let s = 0;
  const low = text.toLowerCase();
  if (genre) s += (t.genres[genre] ?? 0) * 2;
  if (author) {
    const a = t.channels[author];
    if (a) s += a * 3;
    else {
      for (const [c, v] of Object.entries(t.channels)) {
        if (author.toLowerCase().includes(c.toLowerCase())) { s += v * 2; break; }
      }
    }
  }
  for (const [term, v] of Object.entries(t.terms)) {
    const w = term.toLowerCase().split(/\s+/).filter((x) => x.length > 2);
    if (w.length && w.some((x) => low.includes(x))) s += v * 0.6;
  }
  return s;
}
