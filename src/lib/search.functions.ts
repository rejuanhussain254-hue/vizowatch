import { createServerFn } from "@tanstack/react-start";

export type SearchResult = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: string;
  views: string;
  channelId?: string | undefined;
  channelThumb?: string | undefined;
  published?: string | undefined;
};

function text(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v.simpleText) return v.simpleText;
  if (v.content) return v.content;
  if (Array.isArray(v.runs)) return v.runs.map((r: any) => r.text).join("");
  return "";
}

function firstUrl(sources: any): string {
  const list = sources?.sources ?? sources?.thumbnails ?? sources;
  if (!Array.isArray(list)) return "";
  const withUrl = list.filter((s: any) => typeof s?.url === "string");
  return withUrl.length ? String(withUrl[withUrl.length - 1].url) : "";
}

function bylineChannelId(vr: any): string | undefined {
  const runs = vr?.ownerText?.runs ?? vr?.shortBylineText?.runs ?? vr?.longBylineText?.runs;
  const id = runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
  return typeof id === "string" && id.startsWith("UC") ? id : undefined;
}

function walk(node: any, out: SearchResult[], seen: Set<string>) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out, seen);
    return;
  }
  const vr = node.videoRenderer ?? node.compactVideoRenderer ?? node.gridVideoRenderer;
  if (vr?.videoId && !seen.has(vr.videoId)) {
    seen.add(vr.videoId);
    out.push({
      id: vr.videoId,
      title: text(vr.title),
      author: text(vr.ownerText) || text(vr.shortBylineText) || text(vr.longBylineText),
      thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
      duration: text(vr.lengthText),
      views: text(vr.shortViewCountText) || text(vr.viewCountText),
      channelId: bylineChannelId(vr),
      channelThumb:
        firstUrl(vr.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail) ||
        firstUrl(vr.channelThumbnail) ||
        undefined,
      published: text(vr.publishedTimeText) || undefined,
    });
    return;
  }
  for (const k of Object.keys(node)) walk(node[k], out, seen);
}

async function fetchJson(url: string): Promise<any | null> {
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
  if (!m) return null;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return null;
  }
}

export type ChannelCard = {
  id: string;
  name: string;
  handle?: string | undefined;
  avatar: string;
  subs?: string | undefined;
  videoCount?: string | undefined;
  description?: string | undefined;
};

export type SearchResponse =
  | {
      ok: true;
      results: SearchResult[];
      channel?: ChannelCard | undefined;
      continuationToken?: string | undefined;
    }
  | { ok: false; error: string };

function findChannelCard(node: any): ChannelCard | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (node.channelRenderer) {
    const cr = node.channelRenderer;
    const rawAvatar = firstUrl(cr.thumbnail);
    const avatar = rawAvatar.startsWith("//") ? `https:${rawAvatar}` : rawAvatar;
    const handle = cr.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl?.replace(/^\//, "") || undefined;
    return {
      id: cr.channelId || "",
      name: text(cr.title),
      handle,
      avatar,
      subs: text(cr.subscriberCountText) || undefined,
      videoCount: text(cr.videoCountText) || undefined,
      description: text(cr.descriptionSnippet) || undefined,
    };
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const c = findChannelCard(item);
      if (c) return c;
    }
    return undefined;
  }
  for (const k of Object.keys(node)) {
    if (k === "trackingParams") continue;
    const c = findChannelCard(node[k]);
    if (c) return c;
  }
  return undefined;
}

function findContinuationToken(node: any): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
    return String(node.continuationItemRenderer.continuationEndpoint.continuationCommand.token);
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const tok = findContinuationToken(item);
      if (tok) return tok;
    }
    return undefined;
  }
  for (const k of Object.keys(node)) {
    if (k === "trackingParams") continue;
    const tok = findContinuationToken(node[k]);
    if (tok) return tok;
  }
  return undefined;
}

async function fetchContinuation(token: string): Promise<{ results: SearchResult[]; continuationToken?: string }> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240410.01.00",
          hl: "en",
          gl: "BD",
        },
      },
      continuation: token,
    }),
  });
  if (!res.ok) return { results: [] };
  const json = await res.json();
  const out: SearchResult[] = [];
  walk(json, out, new Set());
  const nextToken = findContinuationToken(json);
  return { results: out.filter((r) => r.title), continuationToken: nextToken };
}

async function fetchResults(url: string): Promise<SearchResult[]> {
  const data = await fetchJson(url);
  if (!data) return [];
  const out: SearchResult[] = [];
  walk(data, out, new Set());
  return out.filter((r) => r.title).slice(0, 30);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const searchYouTube = createServerFn({ method: "GET" })
  .validator((d: { q?: string; token?: string }) => {
    return {
      q: typeof d?.q === "string" ? d.q.slice(0, 200) : "",
      token: typeof d?.token === "string" ? d.token.slice(0, 2000) : undefined,
    };
  })
  .handler(async ({ data }): Promise<SearchResponse> => {
    if (data.token) {
      try {
        const cont = await fetchContinuation(data.token);
        return { ok: true, results: cont.results, continuationToken: cont.continuationToken };
      } catch (e) {
        const err = e instanceof Error ? e.message : "continuation failed";
        return { ok: false, error: err };
      }
    }

    const q = data.q.trim() || "trending videos bangladesh today";
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&gl=BD&hl=en`;
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await fetchJson(url);
        if (raw) {
          const out: SearchResult[] = [];
          walk(raw, out, new Set());
          const valid = out.filter((r) => r.title).slice(0, 30);
          if (valid.length || attempt === 2) {
            const channel = findChannelCard(raw);
            const continuationToken = findContinuationToken(raw);
            return { ok: true, results: valid, channel, continuationToken };
          }
        }
        lastErr = "empty";
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "fetch failed";
        console.error("searchYouTube attempt", attempt + 1, lastErr);
      }
      await sleep(400 * (attempt + 1));
    }
    return { ok: false, error: lastErr || "unavailable" };
  });

export const suggestYouTube = createServerFn({ method: "GET" })
  .validator((d: { q?: string }) => {
    return { q: typeof d?.q === "string" ? d.q.slice(0, 100) : "" };
  })
  .handler(async ({ data }): Promise<string[]> => {
    const q = data.q.trim();
    if (!q) return [];
    try {
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=bn&gl=BD&q=${encodeURIComponent(q)}`,
        { headers: { "user-agent": "Mozilla/5.0", "accept-language": "bn-BD,bn;q=0.9,en;q=0.8" } },
      );
      if (!res.ok) return [];
      const raw = await res.text();
      const parsed = JSON.parse(raw) as [string, string[]];
      return (parsed[1] ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 10);
    } catch {
      return [];
    }
  });

// ---------------- channel pages ----------------

export type PlaylistItem = { id: string; title: string; thumbnail: string; count: string };
export type ChannelPage = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  banner: string;
  subs: string;
  videoCount: string;
  tabs: string[];
  videos: SearchResult[];
  playlists: PlaylistItem[];
  posts: PostItem[];
};
export type PostItem = { id: string; text: string; published: string; image: string };
export type ChannelResponse = { ok: true; channel: ChannelPage } | { ok: false; error: string };

const TAB_PATH: Record<string, string> = {
  videos: "videos",
  shorts: "shorts",
  live: "streams",
  playlists: "playlists",
  podcasts: "podcasts",
  posts: "community",
};

function findAll(node: any, key: string, out: any[] = [], limit = 400): any[] {
  if (!node || typeof node !== "object" || out.length >= limit) return out;
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, key, out, limit);
    return out;
  }
  for (const k of Object.keys(node)) {
    if (k === key) out.push(node[k]);
    else findAll(node[k], key, out, limit);
  }
  return out;
}

function metadataStrings(vm: any): string[] {
  const rows = vm?.metadata?.contentMetadataViewModel?.metadataRows ?? vm?.metadataRows ?? [];
  const out: string[] = [];
  for (const row of rows) for (const part of row?.metadataParts ?? []) {
    const t = text(part?.text);
    if (t) out.push(t);
  }
  return out;
}

function badgeTexts(vm: any): string[] {
  return findAll(vm, "thumbnailBadgeViewModel")
    .map((b: any) => text(b?.text))
    .filter(Boolean);
}

function parseLockups(data: any, videos: SearchResult[], playlists: PlaylistItem[], authorName: string, channelId: string) {
  const seen = new Set<string>();
  for (const lv of findAll(data, "lockupViewModel")) {
    const id = lv?.contentId;
    const type = String(lv?.contentType ?? "");
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    const title = text(lv?.metadata?.lockupMetadataViewModel?.title);
    const thumb = firstUrl(findAll(lv?.contentImage, "thumbnailViewModel")[0]?.image);
    const meta = metadataStrings(lv?.metadata?.lockupMetadataViewModel);
    const badges = badgeTexts(lv);
    if (type.includes("PLAYLIST")) {
      if (!title) continue;
      playlists.push({ id, title, thumbnail: thumb, count: badges[0] ?? meta[0] ?? "" });
    } else if (type.includes("VIDEO") || type.includes("SHORT")) {
      if (!title) continue;
      videos.push({
        id,
        title,
        author: authorName,
        thumbnail: thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        duration: badges.find((b) => /^\d+(:\d+)+$/.test(b)) ?? "",
        views: meta.find((m) => /view/i.test(m)) ?? "",
        published: meta.find((m) => /ago|streamed|premier/i.test(m)) ?? "",
        channelId,
      });
    }
  }
}

export const channelData = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string; tab?: string }) => {
    if (typeof d?.id !== "string" || !d.id) throw new Error("id required");
    return { id: d.id.slice(0, 40), tab: typeof d?.tab === "string" ? d.tab : "videos" };
  })
  .handler(async ({ data }): Promise<ChannelResponse> => {
    const path = TAB_PATH[data.tab] ?? "";
    const base = data.id.startsWith("UC") ? `channel/${data.id}` : `${data.id.startsWith("@") ? "" : "@"}${data.id}`;
    const url = `https://www.youtube.com/${base}${path ? `/${path}` : ""}?hl=en&gl=BD`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const json = await fetchJson(url);
        if (json) {
          const header = findAll(json, "pageHeaderViewModel")[0];
          const name =
            text(header?.title?.dynamicTextViewModel?.text) ||
            findAll(json, "c4TabbedHeaderRenderer")[0]?.title ||
            "";
          const avatar = firstUrl(findAll(header?.image ?? {}, "avatarViewModel")[0]?.image) || firstUrl(findAll(json, "avatar")[0]);
          const banner = firstUrl(findAll(header?.banner ?? {}, "imageBannerViewModel")[0]?.image);
          const rows = metadataStrings(header);
          const videos: SearchResult[] = [];
          const playlists: PlaylistItem[] = [];
          const author = name || "";
          parseLockups(json, videos, playlists, author, data.id);
          const legacy: SearchResult[] = [];
          walk(json, legacy, new Set(videos.map((v) => v.id)));
          for (const v of legacy) videos.push({ ...v, author: v.author || author, channelId: v.channelId ?? data.id });
          const tabs = findAll(json, "tabRenderer")
            .map((t: any) => String(t?.title ?? ""))
            .filter(Boolean);
          const posts: PostItem[] = [];
          for (const p of findAll(json, "backstagePostRenderer")) {
            const body = text(p?.contentText);
            if (!body) continue;
            posts.push({
              id: String(p?.postId ?? posts.length),
              text: body.slice(0, 600),
              published: text(p?.publishedTimeText),
              image: firstUrl(findAll(p?.backstageAttachment ?? {}, "thumbnail")[0]),
            });
          }
          return {
            ok: true,
            channel: {
              id: data.id,
              name,
              handle: rows.find((r) => r.startsWith("@")) ?? "",
              avatar,
              banner,
              subs: rows.find((r) => /subscriber/i.test(r)) ?? "",
              videoCount: rows.find((r) => /video/i.test(r)) ?? "",
              tabs,
              videos: videos.slice(0, 40),
              playlists: playlists.slice(0, 40),
              posts: posts.slice(0, 20),
            },
          };
        }
      } catch (e) {
        console.error("channelData", e instanceof Error ? e.message : e);
      }
      await sleep(400 * (attempt + 1));
    }
    return { ok: false, error: "unavailable" };
  });

// ---------------- single video details (upload date, views, description) ----------------

export type VideoMeta = {
  published?: string | undefined;
  publishedAgo?: string | undefined;
  views?: string | undefined;
  description?: string | undefined;
  channelId?: string | undefined;
  channelThumb?: string | undefined;
  subs?: string | undefined;
  likes?: string | undefined;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
}

export const videoMeta = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => {
    if (typeof d?.id !== "string" || !d.id) throw new Error("id required");
    return { id: d.id.slice(0, 20) };
  })
  .handler(async ({ data }): Promise<VideoMeta> => {
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(data.id)}&hl=en&gl=BD`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "accept-language": "en-US,en;q=0.9,bn;q=0.8",
            cookie: "CONSENT=YES+1; SOCS=CAI",
          },
        });
        const html = await res.text();
        const out: VideoMeta = {};
        const pr = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s);
        if (pr) {
          try {
            const p = JSON.parse(pr[1]!);
            const mf = p?.microformat?.playerMicroformatRenderer;
            const iso = mf?.publishDate ?? mf?.uploadDate;
            if (typeof iso === "string") out.published = formatDate(iso);
            const vc = p?.videoDetails?.viewCount;
            if (vc) out.views = `${Number(vc).toLocaleString("bn-BD")} বার দেখা হয়েছে`;
            if (p?.videoDetails?.channelId) out.channelId = p.videoDetails.channelId;
            const desc = p?.videoDetails?.shortDescription;
            if (typeof desc === "string") out.description = desc.slice(0, 1200);
          } catch {
            /* ignore */
          }
        }
        const idm = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
        if (idm) {
          try {
            const d = JSON.parse(idm[1]!);
            const primary = findAll(d, "videoPrimaryInfoRenderer")[0];
            const secondary = findAll(d, "videoSecondaryInfoRenderer")[0];
            out.publishedAgo = text(primary?.relativeDateText) || out.publishedAgo;
            if (!out.published) out.published = text(primary?.dateText) || out.published;
            if (!out.views) out.views = text(primary?.viewCount?.videoViewCountRenderer?.viewCount) || out.views;
            const owner = secondary?.owner?.videoOwnerRenderer;
            out.channelThumb = firstUrl(owner?.thumbnail) || out.channelThumb;
            out.subs = text(owner?.subscriberCountText) || out.subs;
            out.channelId = owner?.navigationEndpoint?.browseEndpoint?.browseId ?? out.channelId;
          } catch {
            /* ignore */
          }
        }
        if (out.published || out.views || out.channelThumb) return out;
      } catch (e) {
        console.error("videoMeta", e instanceof Error ? e.message : e);
      }
      await sleep(500);
    }
    return {};
  });

// ---------------- playlist contents ----------------

export type PlaylistResponse = { ok: true; title: string; videos: SearchResult[] } | { ok: false; error: string };

export const playlistData = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => {
    if (typeof d?.id !== "string" || !d.id) throw new Error("id required");
    return { id: d.id.slice(0, 60) };
  })
  .handler(async ({ data }): Promise<PlaylistResponse> => {
    const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(data.id)}&hl=en&gl=BD`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const json = await fetchJson(url);
        if (json) {
          const videos: SearchResult[] = [];
          const seen = new Set<string>();
          for (const pv of findAll(json, "playlistVideoRenderer")) {
            const id = pv?.videoId;
            if (typeof id !== "string" || seen.has(id)) continue;
            seen.add(id);
            videos.push({
              id,
              title: text(pv.title),
              author: text(pv.shortBylineText),
              thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              duration: text(pv.lengthText),
              views: "",
              channelId: bylineChannelId(pv),
            });
          }
          if (videos.length) {
            const title = text(findAll(json, "dynamicTextViewModel")[0]?.text) || "প্লেলিস্ট";
            return { ok: true, title, videos: videos.slice(0, 60) };
          }
        }
      } catch (e) {
        console.error("playlistData", e instanceof Error ? e.message : e);
      }
      await sleep(400 * (attempt + 1));
    }
    return { ok: false, error: "unavailable" };
  });

// resolve a channel id from a channel name (used when a row has no channelId)
export const resolveChannel = createServerFn({ method: "GET" })
  .inputValidator((d: { name: string }) => {
    if (typeof d?.name !== "string") throw new Error("name required");
    return { name: d.name.slice(0, 120) };
  })
  .handler(async ({ data }): Promise<string | null> => {
    const q = data.name.trim();
    if (!q) return null;
    try {
      const json = await fetchJson(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D&hl=en&gl=BD`,
      );
      if (!json) return null;
      const cr = findAll(json, "channelRenderer")[0];
      const id = cr?.channelId ?? findAll(json, "browseEndpoint").find((b: any) => String(b?.browseId ?? "").startsWith("UC"))?.browseId;
      return typeof id === "string" ? id : null;
    } catch {
      return null;
    }
  });
