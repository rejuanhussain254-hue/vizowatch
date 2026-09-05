export type Track = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
};

export const STORAGE_KEY = "echo.queue.v1";

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s);
    const host = url.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return url.pathname.slice(1, 12) || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v) return v.slice(0, 11);
      const m = url.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1] ?? null;
    }
  } catch {
    /* not a url */
  }
  return null;
}

export async function fetchTrack(id: string): Promise<Track> {
  const thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  try {
    const res = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
    );
    const data = (await res.json()) as { title?: string; author_name?: string };
    return {
      id,
      title: data.title ?? "YouTube ভিডিও",
      author: data.author_name ?? "YouTube",
      thumbnail,
    };
  } catch {
    return { id, title: "YouTube ভিডিও", author: "YouTube", thumbnail };
  }
}

export function loadQueue(): Track[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Track[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue: Track[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

// ---- Recent history + resume position ----
export type HistoryItem = Track & { at: number; position: number; duration: number };
export const HISTORY_KEY = "echo.history.v1";
const HISTORY_MAX = 30;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function pushHistory(track: Track): HistoryItem[] {
  const prev = loadHistory().filter((h) => h.id !== track.id);
  const old = loadHistory().find((h) => h.id === track.id);
  const item: HistoryItem = { ...track, at: Date.now(), position: old?.position ?? 0, duration: old?.duration ?? 0 };
  const next = [item, ...prev].slice(0, HISTORY_MAX);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function updateHistoryPosition(id: string, position: number, duration: number) {
  const list = loadHistory();
  const item = list.find((h) => h.id === id);
  if (!item) return;
  // Treat the last few seconds as "finished" so resume restarts from the top.
  item.position = duration && duration - position < 8 ? 0 : Math.floor(position);
  item.duration = Math.floor(duration);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

export function timeAgo(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "এইমাত্র";
  if (m < 60) return `${m} মিনিট আগে`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return `${Math.round(h / 24)} দিন আগে`;
}

export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
