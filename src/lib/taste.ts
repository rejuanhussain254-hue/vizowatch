// YouTube-Style Recommendation & Ranking Algorithm Engine for Vizowatch
// Inspired by Google / YouTube Recommendation System (Candidate Generation -> Scoring & Ranking -> Diversification)

export type Taste = {
  genres: Record<string, number>; // genre -> affinity score
  channels: Record<string, number>; // channel -> affinity score
  terms: Record<string, number>; // search terms -> affinity score
  penalties: Record<string, number>; // channel/genre -> skip penalty
  watchRatio: Record<string, number>; // channel -> historical average completion ratio (0.0 to 1.0)
  repeatVideos: Record<string, number>; // videoId -> play count
  recentChannels: string[]; // FIFO queue of recently watched channels (for fatigue prevention)
  at: number;
};

const KEY = "echo.taste.v2";
const LEGACY_KEY = "echo.taste.v1";
const HALF_LIFE_DAYS = 14;
const MAX_KEYS = 50;
const MIN_SCORE = 0.05;

export function emptyTaste(): Taste {
  return {
    genres: {},
    channels: {},
    terms: {},
    penalties: {},
    watchRatio: {},
    repeatVideos: {},
    recentChannels: [],
    at: Date.now(),
  };
}

function prune(map: Record<string, number> = {}, factor: number) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const s = v * factor;
    if (s >= MIN_SCORE) out[k] = Math.round(s * 1000) / 1000;
  }
  const keys = Object.keys(out)
    .sort((a, b) => (out[b] ?? 0) - (out[a] ?? 0))
    .slice(0, MAX_KEYS);
  const capped: Record<string, number> = {};
  for (const k of keys) capped[k] = out[k]!;
  return capped;
}

export function loadTaste(): Taste {
  if (typeof window === "undefined") return emptyTaste();
  try {
    let raw = localStorage.getItem(KEY);
    // Backward compatibility with v1
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        return {
          ...emptyTaste(),
          genres: legacy.genres ?? {},
          channels: legacy.channels ?? {},
          terms: legacy.terms ?? {},
          at: legacy.at ?? Date.now(),
        };
      }
      return emptyTaste();
    }

    const p = JSON.parse(raw) as Partial<Taste>;
    const days = Math.max(0, (Date.now() - (p.at ?? Date.now())) / 86_400_000);
    const factor = Math.pow(0.5, days / HALF_LIFE_DAYS);

    return {
      genres: prune(p.genres ?? {}, factor),
      channels: prune(p.channels ?? {}, factor),
      terms: prune(p.terms ?? {}, factor),
      penalties: prune(p.penalties ?? {}, factor),
      watchRatio: p.watchRatio ?? {},
      repeatVideos: p.repeatVideos ?? {},
      recentChannels: Array.isArray(p.recentChannels) ? p.recentChannels.slice(-15) : [],
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
export function bumpTaste(
  t: Taste,
  kind: "genres" | "channels" | "terms" | "penalties",
  key: string,
  weight = 1,
): Taste {
  const k = key.trim();
  if (!k) return t;
  const next: Taste = {
    ...t,
    genres: { ...t.genres },
    channels: { ...t.channels },
    terms: { ...t.terms },
    penalties: { ...t.penalties },
    watchRatio: { ...t.watchRatio },
    repeatVideos: { ...t.repeatVideos },
    recentChannels: [...t.recentChannels],
  };

  next[kind][k] = (next[kind][k] ?? 0) + weight;
  next[kind] = prune(next[kind], 1);
  next.at = Date.now();
  saveTaste(next);
  return next;
}

/** Record video start: track repeat listens and register recent channel */
export function recordVideoStart(
  t: Taste,
  video: { id: string; author?: string; genre?: string },
): Taste {
  const next: Taste = {
    ...t,
    genres: { ...t.genres },
    channels: { ...t.channels },
    terms: { ...t.terms },
    penalties: { ...t.penalties },
    watchRatio: { ...t.watchRatio },
    repeatVideos: { ...t.repeatVideos },
    recentChannels: [...t.recentChannels],
  };

  // 1. Repeat play boost (listening to a track multiple times is a massive positive signal)
  next.repeatVideos[video.id] = (next.repeatVideos[video.id] ?? 0) + 1;

  // 2. Update recent channels for fatigue detection
  if (video.author) {
    next.recentChannels = [...next.recentChannels.filter((c) => c !== video.author), video.author].slice(-15);
    // Baseline intent signal
    next.channels[video.author] = (next.channels[video.author] ?? 0) + 0.8;
  }

  if (video.genre) {
    next.genres[video.genre] = (next.genres[video.genre] ?? 0) + 0.8;
  }

  next.at = Date.now();
  saveTaste(next);
  return next;
}

/** Record user engagement based on actual watch completion & time */
export function recordVideoEngagement(
  t: Taste,
  data: {
    videoId: string;
    author?: string;
    genre?: string;
    watchedSeconds: number;
    totalDuration: number;
  },
): Taste {
  const { videoId, author, genre, watchedSeconds, totalDuration } = data;
  if (!author && !genre) return t;

  const next: Taste = {
    ...t,
    genres: { ...t.genres },
    channels: { ...t.channels },
    terms: { ...t.terms },
    penalties: { ...t.penalties },
    watchRatio: { ...t.watchRatio },
    repeatVideos: { ...t.repeatVideos },
    recentChannels: [...t.recentChannels],
  };

  const ratio = totalDuration > 0 ? Math.min(1, watchedSeconds / totalDuration) : 0;

  // Update Moving Average of Completion Ratio per channel
  if (author) {
    const prevRatio = next.watchRatio[author] ?? 0.5;
    next.watchRatio[author] = Math.round((prevRatio * 0.65 + ratio * 0.35) * 100) / 100;
  }

  // YouTube Retention Signal Model:
  // Case A: Quick Skip (<15s watched on video >35s) -> Negative Feedback / Skip Penalty
  if (watchedSeconds < 15 && totalDuration > 35) {
    if (author) {
      next.penalties[author] = (next.penalties[author] ?? 0) + 1.8;
      if (next.channels[author]) {
        next.channels[author] = Math.max(0, next.channels[author] - 1.2);
      }
    }
    if (genre && next.genres[genre]) {
      next.genres[genre] = Math.max(0, next.genres[genre] - 0.8);
    }
  }
  // Case B: High Retention (>= 70% or > 4 minutes watched) -> Strong YouTube Satisfaction Signal
  else if (ratio >= 0.7 || watchedSeconds >= 240) {
    if (author) {
      next.channels[author] = (next.channels[author] ?? 0) + 3.0;
      // Reduce past penalties if user enjoyed this one
      if (next.penalties[author]) next.penalties[author] = Math.max(0, next.penalties[author] - 1.0);
    }
    if (genre) {
      next.genres[genre] = (next.genres[genre] ?? 0) + 2.2;
    }
  }
  // Case C: Moderate Watch (30% - 70%) -> Positive reinforcement
  else if (ratio >= 0.3 || watchedSeconds >= 60) {
    if (author) next.channels[author] = (next.channels[author] ?? 0) + 1.2;
    if (genre) next.genres[genre] = (next.genres[genre] ?? 0) + 0.8;
  }

  next.channels = prune(next.channels, 1);
  next.genres = prune(next.genres, 1);
  next.penalties = prune(next.penalties, 1);
  next.at = Date.now();
  saveTaste(next);
  return next;
}

export function topTaste(map: Record<string, number> = {}, n: number): string[] {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// Convert Bengali / English view strings ("1.2M views", "৪৫০ হাজার ভিউ", "12K") into a numeric score
export function parseViewCount(raw?: string): number {
  if (!raw) return 0;
  // Convert Bengali numerals to Latin
  const norm = raw.replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString()).toLowerCase();
  const numMatch = norm.match(/([\d.]+)/);
  if (!numMatch) return 0;
  const num = parseFloat(numMatch[1]!);
  if (isNaN(num)) return 0;

  if (norm.includes("b") || norm.includes("বিলিয়ন")) return num * 1_000_000_000;
  if (norm.includes("m") || norm.includes("মিলিয়ন")) return num * 1_000_000;
  if (norm.includes("cr") || norm.includes("কোটি")) return num * 10_000_000;
  if (norm.includes("লাখ")) return num * 100_000;
  if (norm.includes("k") || norm.includes("হাজার")) return num * 1_000;
  return num;
}

// Recency / Freshness score based on upload date string
export function parseFreshness(raw?: string): number {
  if (!raw) return 0.5;
  const s = raw.toLowerCase();
  if (s.includes("minute") || s.includes("মিনিট") || s.includes("second") || s.includes("সেকেন্ড")) return 4.0;
  if (s.includes("hour") || s.includes("ঘণ্টা")) return 3.2;
  if (s.includes("day") || s.includes("দিন") || s.includes("গতকাল")) {
    if (s.includes("1") || s.includes("১")) return 2.6;
    if (s.includes("2") || s.includes("২") || s.includes("3") || s.includes("৩")) return 2.0;
    return 1.6;
  }
  if (s.includes("week") || s.includes("সপ্তাহ")) return 1.2;
  if (s.includes("month") || s.includes("মাস")) return 0.7;
  return 0.3; // older evergreen
}

/**
 * YouTube-style Multi-Factor Video Scoring:
 * Score = TasteMatch + RetentionBonus + ViewsLog + Freshness - FatiguePenalty - SkipPenalty + ExplorationNoise
 */
export function calculateAlgorithmScore(
  t: Taste,
  video: {
    id: string;
    title: string;
    author?: string;
    views?: string;
    published?: string;
  },
  options: {
    genre?: string;
    channelOccurrencesInFeed?: number;
    currentPlayingAuthor?: string;
    currentPlayingGenre?: string;
  } = {},
): number {
  let score = 0;
  const lowTitle = video.title.toLowerCase();
  const author = video.author?.trim();

  // 1. Channel Affinity (Balanced signal - capped so one channel doesn't dominate)
  if (author) {
    const chanScore = t.channels[author] ?? 0;
    if (chanScore > 0) {
      score += Math.min(chanScore * 1.5, 4.0);
    } else {
      // Fuzzy author match
      for (const [c, v] of Object.entries(t.channels)) {
        if (author.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(author.toLowerCase())) {
          score += Math.min(v * 1.2, 2.5);
          break;
        }
      }
    }

    // Historical average completion bonus
    const avgRatio = t.watchRatio[author];
    if (avgRatio !== undefined) {
      score += (avgRatio - 0.4) * 3.0; // Boost if user tends to watch >= 50%
    }

    // Penalty deduction for previously skipped channels
    const penalty = t.penalties[author] ?? 0;
    if (penalty > 0) {
      score -= penalty * 3.0;
    }
  }

  // 2. Genre Affinity
  if (options.genre && t.genres[options.genre]) {
    score += t.genres[options.genre] * 2.5;
  }

  // 3. Search Term Matching
  for (const [term, v] of Object.entries(t.terms)) {
    const words = term.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (words.length && words.some((w) => lowTitle.includes(w))) {
      score += v * 0.7;
    }
  }

  // 4. Repeat Video Affinity (Favorite songs / re-watches)
  const repeats = t.repeatVideos[video.id] ?? 0;
  if (repeats > 0) {
    score += Math.min(repeats * 2.0, 5.0);
  }

  // 5. Popularity (Logarithmic views velocity)
  const views = parseViewCount(video.views);
  if (views > 0) {
    score += Math.min(Math.log10(views) * 0.55, 4.0);
  }

  // 6. Content Freshness
  const fresh = parseFreshness(video.published);
  score += fresh * 0.8;

  // 7. Context Continuity (If on watch page / Up next)
  if (options.currentPlayingGenre && options.genre === options.currentPlayingGenre) {
    score += 2.5; // Maintain current vibe (e.g. keep playing gazal or music)
  }
  if (options.currentPlayingAuthor && author && author.toLowerCase() === options.currentPlayingAuthor.toLowerCase()) {
    score += 2.0; // Same artist / creator continuation
  }

  // 8. Channel Fatigue Prevention (YouTube de-clustering)
  // Penalize if the same channel already appeared multiple times in this feed batch
  const occurrences = options.channelOccurrencesInFeed ?? 0;
  if (occurrences > 0) {
    score -= occurrences * 3.2; // Diminishing returns so 1 creator doesn't hijack the feed
  }

  // Immediate history fatigue (if played in last 3 sessions, give slight discount)
  if (author && t.recentChannels.slice(-3).includes(author)) {
    score -= 1.5;
  }

  // 9. Deprioritize already-watched / seen videos so user sees FRESH videos on reload
  if (options.seenVideoIds && options.seenVideoIds.has(video.id)) {
    score -= 3.5; // Watched videos move down, fresh videos move up
  }

  // 10. Exploration Factor (Epsilon-greedy discovery)
  // Add a minor deterministic pseudo-random jitter based on title hash so results don't stagnate
  let hash = 0;
  for (let i = 0; i < video.title.length; i++) hash = (hash * 31 + video.title.charCodeAt(i)) & 0xfffff;
  const explorationJitter = (hash % 100) / 100 * 0.6;
  score += explorationJitter;

  return Math.round(score * 100) / 100;
}

/** Legacy wrapper for backward compatibility */
export function tasteScore(t: Taste, text: string, author?: string, genre?: string): number {
  return calculateAlgorithmScore(t, { id: "", title: text, author }, { genre });
}

/**
 * YouTube-style Diversity & Interleaving:
 * Enforces a strict quota (max 2 videos per channel in the feed batch)
 * and strictly prevents consecutive videos from the same creator
 */
export function diversifyVideoFeed<T extends { author?: string }>(videos: T[], maxPerChannel = 2): T[] {
  if (videos.length <= 2) return videos;

  // Step 1: Enforce channel quota (max 2 videos per creator in the batch)
  const channelCounts: Record<string, number> = {};
  const capped: T[] = [];
  const overflow: T[] = [];

  for (const v of videos) {
    const author = (v.author?.trim() || "unknown").toLowerCase();
    const count = channelCounts[author] ?? 0;
    if (count < maxPerChannel) {
      channelCounts[author] = count + 1;
      capped.push(v);
    } else {
      overflow.push(v);
    }
  }

  // Step 2: Strict interleaving so no two consecutive videos share the same author
  const result: T[] = [];
  const pool = [...capped];

  while (pool.length > 0) {
    let pickIndex = -1;
    const lastAuthor = result[result.length - 1]?.author?.trim().toLowerCase();

    for (let i = 0; i < pool.length; i++) {
      const candidateAuthor = pool[i]!.author?.trim().toLowerCase() ?? "";
      if (!lastAuthor || !candidateAuthor || candidateAuthor !== lastAuthor) {
        pickIndex = i;
        break;
      }
    }

    // If all remaining videos share the same author, attempt to interleave with overflow from a different creator
    if (pickIndex === -1) {
      const altIndex = overflow.findIndex((o) => {
        const a = o.author?.trim().toLowerCase() ?? "";
        return a && a !== lastAuthor;
      });
      if (altIndex !== -1) {
        result.push(overflow.splice(altIndex, 1)[0]!);
        continue;
      }
      pickIndex = 0;
    }

    const [chosen] = pool.splice(pickIndex, 1);
    if (chosen) result.push(chosen);
  }

  return result;
}

const DYNAMIC_TRENDING_SEEDS = [
  "trending videos bangladesh",
  "bangla new viral song",
  "বাংলা নতুন নাটক trending",
  "bangladesh viral news today",
  "bangla comedy funny drama",
  "bangla islamic waz new",
  "bangladesh sports cricket highlights",
  "bangla new gadgets tech review",
  "bangla cooking food recipe",
  "bangla popular podcast",
  "bangladesh travel vlog viral",
  "bangla acoustic unplugged songs",
];

/**
 * YouTube Candidate Generation:
 * Dynamically rotates candidate seeds so that every page refresh produces FRESH, NEW videos
 */
export function buildYouTubeCandidateQueries(
  t: Taste,
  history: { title: string; author?: string; position?: number; duration?: number }[],
  baseCategories: { label: string; q: string }[],
): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();

  const add = (q: string) => {
    const clean = q.trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      queries.push(clean);
    }
  };

  // 1. Dynamic Rotating Trending Seeds (Randomized on every refresh so user gets fresh mix)
  const shuffledSeeds = [...DYNAMIC_TRENDING_SEEDS].sort(() => Math.random() - 0.5);
  for (const s of shuffledSeeds.slice(0, 3)) {
    add(s);
  }

  // 2. User's Top Genres with dynamic modifiers
  const topGenres = topTaste(t.genres, 3);
  const genreModifiers = ["নতুন", "সেরা ভিডিও", "trending", "viral"];
  for (const g of topGenres) {
    const mod = genreModifiers[Math.floor(Math.random() * genreModifiers.length)]!;
    add(`${g} ${mod}`);
  }

  // 3. Exploration: Pick 4-5 diverse categories from base pool
  const categoryPool = baseCategories
    .filter((c) => c.q && !c.q.includes("trending"))
    .map((c) => c.q);
  const shuffledCats = [...categoryPool].sort(() => Math.random() - 0.5);
  for (const exp of shuffledCats.slice(0, 5)) {
    add(exp);
  }

  // 4. User Search Terms (if any)
  const topTerms = topTaste(t.terms, 2);
  for (const term of topTerms) {
    add(term);
  }

  // 5. Creator queries (placed later so single channels don't hijack initial feed load)
  const topChannels = topTaste(t.channels, 2);
  for (const c of topChannels) {
    add(c);
  }

  return queries;
}
