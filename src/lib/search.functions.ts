import { createServerFn } from "@tanstack/react-start";

export type SearchResult = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: string;
  views: string;
};

function text(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v.simpleText) return v.simpleText;
  if (Array.isArray(v.runs)) return v.runs.map((r: any) => r.text).join("");
  return "";
}

function walk(node: any, out: SearchResult[], seen: Set<string>) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out, seen);
    return;
  }
  const vr = node.videoRenderer ?? node.compactVideoRenderer;
  if (vr?.videoId && !seen.has(vr.videoId)) {
    seen.add(vr.videoId);
    out.push({
      id: vr.videoId,
      title: text(vr.title),
      author: text(vr.ownerText) || text(vr.shortBylineText) || text(vr.longBylineText),
      thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
      duration: text(vr.lengthText),
      views: text(vr.shortViewCountText),
    });
    return;
  }
  for (const k of Object.keys(node)) walk(node[k], out, seen);
}

async function fetchResults(url: string): Promise<SearchResult[]> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9,bn;q=0.8",
      cookie: "CONSENT=YES+1; SOCS=CAI",
    },
  });
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  let data: any;
  try {
    data = JSON.parse(m[1]!);
  } catch {
    return [];
  }
  const out: SearchResult[] = [];
  walk(data, out, new Set());
  return out.filter((r) => r.title).slice(0, 30);
}

export const searchYouTube = createServerFn({ method: "GET" })
  .inputValidator((d: { q: string }) => {
    if (typeof d?.q !== "string") throw new Error("q required");
    return { q: d.q.slice(0, 200) };
  })
  .handler(async ({ data }) => {
    const q = data.q.trim() || "new bangla hindi songs this week";
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D&gl=BD&hl=en`;
    try {
      return await fetchResults(url);
    } catch {
      return [] as SearchResult[];
    }
  });
