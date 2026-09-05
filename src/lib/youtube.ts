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
      if (m) return m[1];
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

export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
