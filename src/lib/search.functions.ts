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
  if (!withUrl.length) return "";
  const raw = String(withUrl[withUrl.length - 1].url);
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

function bylineChannelId(vr: any): string | undefined {
  const runs = vr?.ownerText?.runs ?? vr?.shortBylineText?.runs ?? vr?.longBylineText?.runs;
  const id = runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
  return typeof id === "string" && id.startsWith("UC") ? id : undefined;
}

export async function innertubePost(endpoint: string, payload: any): Promise<any | null> {
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9,bn;q=0.8",
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
        ...payload,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error(`innertubePost [${endpoint}] failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function extractChannelInfoFromNode(node: any): { channelId?: string; channelThumb?: string } {
  let channelId: string | undefined = undefined;
  let channelThumb: string | undefined = undefined;

  // 1. Direct thumb renderers
  const thumbObj =
    node?.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail ??
    node?.channelThumbnailSupportedRenderers?.channelThumbnailWithStyleRenderer?.thumbnail ??
    node?.channelThumbnail ??
    node?.avatar?.thumbnails ??
    node?.avatar;
  const rawThumb = firstUrl(thumbObj);
  if (rawThumb) channelThumb = rawThumb;

  // 2. Direct channelId from runs / endpoints
  channelId = bylineChannelId(node);
  if (!channelId) {
    const browseId =
      node?.navigationEndpoint?.browseEndpoint?.browseId ??
      node?.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ??
      node?.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    if (typeof browseId === "string" && browseId.startsWith("UC")) channelId = browseId;
  }

  // 3. From lockup metadata commandRuns
  if (!channelId) {
    const commandRuns =
      node?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.commandRuns;
    if (Array.isArray(commandRuns)) {
      for (const cr of commandRuns) {
        const bid = cr?.onTap?.innertubeCommand?.browseEndpoint?.browseId;
        if (typeof bid === "string" && bid.startsWith("UC")) {
          channelId = bid;
          break;
        }
      }
    }
  }

  // 4. From reelWatchEndpoint params (for shorts)
  if (!channelId) {
    const params = node?.onTap?.innertubeCommand?.reelWatchEndpoint?.params;
    if (typeof params === "string") {
      try {
        const decoded = Buffer.from(params, "base64").toString("latin1");
        const ucm = decoded.match(/UC[\w-]{22}/);
        if (ucm) channelId = ucm[0];
      } catch {}
    }
  }

  return { channelId, channelThumb };
}

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

function walk(node: any, out: SearchResult[], seen: Set<string>) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out, seen);
    return;
  }
  const vr = node.videoRenderer ?? node.compactVideoRenderer ?? node.gridVideoRenderer;
  if (vr?.videoId && !seen.has(vr.videoId)) {
    seen.add(vr.videoId);
    const info = extractChannelInfoFromNode(vr);
    out.push({
      id: vr.videoId,
      title: text(vr.title),
      author: text(vr.ownerText) || text(vr.shortBylineText) || text(vr.longBylineText),
      thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
      duration: text(vr.lengthText),
      views: text(vr.shortViewCountText) || text(vr.viewCountText),
      channelId: info.channelId,
      channelThumb: info.channelThumb,
      published: text(vr.publishedTimeText) || undefined,
    });
    return;
  }

  const sl = node.shortsLockupViewModel;
  if (sl) {
    const id =
      sl?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
      sl?.entityId?.replace(/^shorts-shelf-item-/, "") ||
      (typeof sl?.entityId === "string" ? sl.entityId : "");
    if (id && !seen.has(id)) {
      seen.add(id);
      const title =
        sl?.overlayMetadata?.primaryText?.content ||
        text(sl?.accessibilityText)?.split(",")?.[0] ||
        "Shorts";
      const views = sl?.overlayMetadata?.secondaryText?.content || "";
      const thumb =
        sl?.thumbnailViewModel?.thumbnailViewModel?.image?.sources?.[0]?.url ||
        firstUrl(sl?.thumbnailViewModel) ||
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      const author =
        text(sl?.accessibilityText)?.split("|")?.[1]?.trim() ||
        text(sl?.accessibilityText)?.split(",")?.[1]?.trim() ||
        "Shorts";
      const info = extractChannelInfoFromNode(sl);
      out.push({
        id,
        title: title.trim() || "Shorts",
        author,
        thumbnail: thumb,
        duration: "শর্টস",
        views,
        channelId: info.channelId,
        channelThumb: info.channelThumb,
      });
      return;
    }
  }

  const lv = node.lockupViewModel;
  if (lv) {
    const id = lv?.contentId;
    const type = String(lv?.contentType ?? "");
    if (typeof id === "string" && id && !seen.has(id) && !type.includes("PLAYLIST")) {
      seen.add(id);
      const title = text(lv?.metadata?.lockupMetadataViewModel?.title);
      if (title) {
        const meta = metadataStrings(lv?.metadata?.lockupMetadataViewModel);
        const badges = badgeTexts(lv);
        const thumb = firstUrl(findAll(lv?.contentImage, "thumbnailViewModel")[0]?.image);
        const info = extractChannelInfoFromNode(lv);
        out.push({
          id,
          title,
          author: meta[0] || "",
          thumbnail: thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          duration: badges.find((b) => /^\d+(:\d+)+$/.test(b)) ?? (type.includes("SHORT") ? "শর্টস" : ""),
          views: meta.find((m) => /view/i.test(m)) ?? "",
          published: meta.find((m) => /ago|streamed|premier/i.test(m)) ?? undefined,
          channelId: info.channelId,
          channelThumb: info.channelThumb,
        });
        return;
      }
    }
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
  if (node.continuationCommand?.token) {
    return String(node.continuationCommand.token);
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

async function fetchContinuation(initialToken: string): Promise<{ results: SearchResult[]; continuationToken?: string }> {
  let currentToken: string | undefined = initialToken;
  let jumps = 0;
  while (currentToken && jumps < 2) {
    jumps++;
    try {
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
          continuation: currentToken,
        }),
      });
      if (!res.ok) break;
      const json = await res.json();
      const out: SearchResult[] = [];
      walk(json, out, new Set());
      const nextToken = findContinuationToken(json);
      const valid = out.filter((r) => r.title);
      if (valid.length > 0 || !nextToken) {
        return { results: valid, continuationToken: nextToken };
      }
      currentToken = nextToken;
    } catch {
      break;
    }
  }
  return { results: [] };
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

    // Innertube direct fallback if web scrape fails or is rate-limited
    try {
      const raw = await innertubePost("search", { query: q });
      if (raw) {
        const out: SearchResult[] = [];
        walk(raw, out, new Set());
        const valid = out.filter((r) => r.title).slice(0, 30);
        if (valid.length) {
          const channel = findChannelCard(raw);
          const continuationToken = findContinuationToken(raw);
          return { ok: true, results: valid, channel, continuationToken };
        }
      }
    } catch (e) {
      console.error("searchYouTube innertube fallback error:", e);
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

export type PlaylistItem = { id: string; title: string; thumbnail: string; count: string; author?: string };
export type ChannelPage = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  banner: string;
  subs: string;
  videoCount: string;
  description?: string;
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

function parseLockups(
  data: any,
  videos: SearchResult[],
  playlists: PlaylistItem[],
  authorName: string,
  channelId: string,
  channelThumb?: string,
) {
  const seen = new Set<string>();

  // Modern YouTube shortsLockupViewModel for channel shorts
  for (const sl of findAll(data, "shortsLockupViewModel")) {
    const id =
      sl?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
      sl?.entityId?.replace(/^shorts-shelf-item-/, "") ||
      findAll(sl, "videoId")[0];
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    const title =
      sl?.overlayMetadata?.primaryText?.content ||
      text(sl?.accessibilityText)?.split(",")?.[0] ||
      "Shorts";
    const views = sl?.overlayMetadata?.secondaryText?.content || "";
    const thumb =
      sl?.thumbnailViewModel?.thumbnailViewModel?.image?.sources?.[0]?.url ||
      firstUrl(sl?.thumbnailViewModel) ||
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    videos.push({
      id,
      title: title.trim() || "Shorts",
      author: authorName,
      thumbnail: thumb,
      duration: "শর্টস",
      views,
      channelId,
      channelThumb,
    });
  }

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
        duration: badges.find((b) => /^\d+(:\d+)+$/.test(b)) ?? (type.includes("SHORT") ? "শর্টস" : ""),
        views: meta.find((m) => /view/i.test(m)) ?? "",
        published: meta.find((m) => /ago|streamed|premier/i.test(m)) ?? "",
        channelId,
        channelThumb,
      });
    }
  }
}

const TAB_PARAMS: Record<string, string> = {
  videos: "EgZ2aWRlb3PyBgQKAjoA",
  shorts: "EgZzaG9ydHPyBgUKA5oBAA%3D%3D",
  live: "EgdzdHJlYW1z8gYECgI6AA%3D%3D",
  playlists: "EglwbGF5bGlzdHPyBgoKCEIGCgIQaCIA",
  podcasts: "Eghwb2RjYXN0c_IGBAoCSgA%3D",
  posts: "EgVwb3N0c_IGBAoCSgA%3D",
};

export const channelData = createServerFn({ method: "GET" })
  .validator((d: { id: string; tab?: string }) => {
    if (typeof d?.id !== "string" || !d.id) throw new Error("id required");
    return { id: d.id.slice(0, 100), tab: typeof d?.tab === "string" ? d.tab : "videos" };
  })
  .handler(async ({ data }): Promise<ChannelResponse> => {
    let targetId = data.id.trim();

    // 1. Resolve ID if not a UC... id
    if (!targetId.startsWith("UC")) {
      try {
        if (targetId.startsWith("@") || targetId.includes("youtube.com")) {
          const url = targetId.startsWith("http") ? targetId : `https://www.youtube.com/${targetId}`;
          const res = await innertubePost("navigation/resolve_url", { url });
          const bid = res?.endpoint?.browseEndpoint?.browseId;
          if (typeof bid === "string" && bid.startsWith("UC")) targetId = bid;
        } else {
          // Channel search filter
          const chJson = await innertubePost("search", { query: targetId, params: "EgIQAg%3D%3D" });
          const cr = findAll(chJson, "channelRenderer")[0];
          if (cr?.channelId) targetId = String(cr.channelId);
          else {
            const bid = findAll(chJson, "browseEndpoint").find((b: any) => String(b?.browseId ?? "").startsWith("UC"))?.browseId;
            if (typeof bid === "string") targetId = bid;
          }
        }
      } catch (e) {
        console.error("resolveChannel in channelData", e);
      }
    }

    // 2. Fetch channel via Innertube browse if resolved to UC...
    if (targetId.startsWith("UC")) {
      try {
        const tabParam = TAB_PARAMS[data.tab] ?? TAB_PARAMS.videos;
        const json = await innertubePost("browse", { browseId: targetId, params: tabParam });
        if (json) {
          const header =
            findAll(json, "pageHeaderViewModel")[0] ||
            findAll(json, "c4TabbedHeaderRenderer")[0] ||
            findAll(json, "pageHeaderRenderer")[0];

          const name =
            text(header?.title?.dynamicTextViewModel?.text) ||
            text(header?.title) ||
            "";
          const rawAvatar =
            firstUrl(findAll(header?.image ?? {}, "avatarViewModel")[0]?.image) ||
            firstUrl(findAll(json, "avatarViewModel")[0]?.image) ||
            firstUrl(findAll(json, "avatar")[0]);
          const avatar = rawAvatar.startsWith("//") ? `https:${rawAvatar}` : rawAvatar;
          const rawBanner =
            firstUrl(findAll(header?.banner ?? {}, "imageBannerViewModel")[0]?.image) ||
            firstUrl(findAll(json, "imageBannerViewModel")[0]?.image);
          const banner = rawBanner.startsWith("//") ? `https:${rawBanner}` : rawBanner;
          const rows = metadataStrings(header);

          const videos: SearchResult[] = [];
          const playlists: PlaylistItem[] = [];
          const author = name || data.id;
          parseLockups(json, videos, playlists, author, targetId, avatar);

          const legacy: SearchResult[] = [];
          walk(json, legacy, new Set(videos.map((v) => v.id)));
          for (const v of legacy) {
            videos.push({
              ...v,
              author: v.author || author,
              channelId: v.channelId ?? targetId,
              channelThumb: v.channelThumb || avatar || undefined,
            });
          }

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

          if (videos.length > 0 || name) {
            return {
              ok: true,
              channel: {
                id: targetId,
                name: name || data.id,
                handle: rows.find((r) => r.startsWith("@")) ?? (data.id.startsWith("@") ? data.id : ""),
                avatar,
                banner,
                subs: rows.find((r) => /subscriber/i.test(r)) ?? "",
                videoCount: rows.find((r) => /video/i.test(r)) ?? `${videos.length} ভিডিও`,
                tabs: tabs.length ? tabs : ["videos"],
                videos: videos.slice(0, 50),
                playlists: playlists.slice(0, 40),
                posts: posts.slice(0, 20),
              },
            };
          }
        }
      } catch (e) {
        console.error("Innertube browse error:", e);
      }
    }

    // 3. Fallback: web scrape
    const path = TAB_PATH[data.tab] ?? "";
    const base = targetId.startsWith("UC") ? `channel/${targetId}` : `${targetId.startsWith("@") ? "" : "@"}${targetId}`;
    const url = `https://www.youtube.com/${base}${path ? `/${path}` : ""}?hl=en&gl=BD`;
    try {
      const json = await fetchJson(url);
      if (json) {
        const header = findAll(json, "pageHeaderViewModel")[0];
        const name =
          text(header?.title?.dynamicTextViewModel?.text) ||
          findAll(json, "c4TabbedHeaderRenderer")[0]?.title ||
          "";
        const rawAvatar = firstUrl(findAll(header?.image ?? {}, "avatarViewModel")[0]?.image) || firstUrl(findAll(json, "avatar")[0]);
        const avatar = rawAvatar.startsWith("//") ? `https:${rawAvatar}` : rawAvatar;
        const banner = firstUrl(findAll(header?.banner ?? {}, "imageBannerViewModel")[0]?.image);
        const rows = metadataStrings(header);
        const videos: SearchResult[] = [];
        const playlists: PlaylistItem[] = [];
        const author = name || data.id;
        parseLockups(json, videos, playlists, author, targetId, avatar);
        const legacy: SearchResult[] = [];
        walk(json, legacy, new Set(videos.map((v) => v.id)));
        for (const v of legacy) {
          videos.push({
            ...v,
            author: v.author || author,
            channelId: v.channelId ?? targetId,
            channelThumb: v.channelThumb || avatar || undefined,
          });
        }
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
        if (videos.length > 0 || name) {
          return {
            ok: true,
            channel: {
              id: targetId,
              name: name || data.id,
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
      }
    } catch (e) {
      console.error("Web scrape channel error:", e);
    }

    // 4. Ultimate Guaranteed Fallback: search YouTube for channel name / query
    try {
      const searchRes = await innertubePost("search", { query: data.id });
      if (searchRes) {
        const out: SearchResult[] = [];
        walk(searchRes, out, new Set());
        const valid = out.filter((r) => r.title).slice(0, 30);
        const card = findChannelCard(searchRes);
        if (valid.length > 0 || card) {
          const cardAvatar = card?.avatar || valid.find((v) => v.channelThumb)?.channelThumb || "";
          return {
            ok: true,
            channel: {
              id: card?.id || targetId,
              name: card?.name || data.id,
              handle: card?.handle || (data.id.startsWith("@") ? data.id : ""),
              avatar: cardAvatar,
              banner: "",
              subs: card?.subs || "",
              videoCount: card?.videoCount || `${valid.length}+ ভিডিও`,
              tabs: ["videos"],
              videos: valid.map((v) => ({ ...v, author: card?.name || v.author, channelThumb: v.channelThumb || cardAvatar })),
              playlists: [],
              posts: [],
            },
          };
        }
      }
    } catch (e) {
      console.error("Channel search fallback error:", e);
    }

    return { ok: false, error: "unavailable" };
  });

// ---------------- single video details (upload date, views, description) ----------------

export type VideoMeta = {
  author?: string | undefined;
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
  .validator((d: { id: string }) => {
    if (typeof d?.id !== "string" || !d.id) throw new Error("id required");
    return { id: d.id.slice(0, 20) };
  })
  .handler(async ({ data }): Promise<VideoMeta> => {
    const out: VideoMeta = {};

    // 1. Primary: YouTube Innertube next endpoint (highly reliable, returns full owner avatar, subs, views)
    try {
      const nextJson = await innertubePost("next", { videoId: data.id });
      if (nextJson) {
        const owner = findAll(nextJson, "videoOwnerRenderer")[0];
        const ownerTitle = text(owner?.title);
        if (ownerTitle) out.author = ownerTitle;
        const thumb = firstUrl(owner?.thumbnail);
        if (thumb) out.channelThumb = thumb.startsWith("//") ? `https:${thumb}` : thumb;
        const cid = owner?.navigationEndpoint?.browseEndpoint?.browseId;
        if (typeof cid === "string" && cid.startsWith("UC")) out.channelId = cid;
        out.subs = text(owner?.subscriberCountText) || out.subs;

        const primary = findAll(nextJson, "videoPrimaryInfoRenderer")[0];
        const rawViews = text(primary?.viewCount?.videoViewCountRenderer?.viewCount) || text(primary?.viewCount);
        if (rawViews) out.views = rawViews;
        out.publishedAgo = text(primary?.relativeDateText) || out.publishedAgo;
        out.published = text(primary?.dateText) || out.published;

        const secondary = findAll(nextJson, "videoSecondaryInfoRenderer")[0];
        const desc = secondary?.attributedDescription?.content || text(secondary?.description);
        if (typeof desc === "string") out.description = desc.slice(0, 1200);

        if (out.author || out.channelThumb || out.channelId) {
          return out;
        }
      }
    } catch (e) {
      console.error("videoMeta next", e instanceof Error ? e.message : e);
    }

    // 2. Secondary: YouTube Innertube player endpoint
    try {
      const pJson = await innertubePost("player", { videoId: data.id });
      if (pJson?.videoDetails) {
        const vd = pJson.videoDetails;
        if (vd.author && !out.author) out.author = vd.author;
        if (vd.channelId && !out.channelId) out.channelId = vd.channelId;
        if (vd.viewCount && !out.views) out.views = `${Number(vd.viewCount).toLocaleString("bn-BD")} বার দেখা হয়েছে`;
        if (vd.shortDescription && !out.description) out.description = vd.shortDescription.slice(0, 1200);
      }
      if (pJson?.microformat?.playerMicroformatRenderer) {
        const mf = pJson.microformat.playerMicroformatRenderer;
        const iso = mf.publishDate ?? mf.uploadDate;
        if (typeof iso === "string" && !out.published) out.published = formatDate(iso);
      }
      if (out.author || out.channelThumb || out.channelId) {
        return out;
      }
    } catch (e) {
      console.error("videoMeta player", e instanceof Error ? e.message : e);
    }

    // 3. Fallback: Web scrape watch page
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
        const pr = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|<\/script>)/s);
        if (pr) {
          try {
            const p = JSON.parse(pr[1]!);
            const mf = p?.microformat?.playerMicroformatRenderer;
            const iso = mf?.publishDate ?? mf?.uploadDate;
            if (typeof iso === "string" && !out.published) out.published = formatDate(iso);
            const vc = p?.videoDetails?.viewCount;
            if (vc && !out.views) out.views = `${Number(vc).toLocaleString("bn-BD")} বার দেখা হয়েছে`;
            if (p?.videoDetails?.author && !out.author) out.author = p.videoDetails.author;
            if (p?.videoDetails?.channelId && !out.channelId) out.channelId = p.videoDetails.channelId;
            const desc = p?.videoDetails?.shortDescription;
            if (typeof desc === "string" && !out.description) out.description = desc.slice(0, 1200);
          } catch {}
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
            const ownerTitle = text(owner?.title);
            if (ownerTitle && !out.author) out.author = ownerTitle;
            out.channelThumb = firstUrl(owner?.thumbnail) || out.channelThumb;
            out.subs = text(owner?.subscriberCountText) || out.subs;
            out.channelId = owner?.navigationEndpoint?.browseEndpoint?.browseId ?? out.channelId;
          } catch {}
        }

        if (out.published || out.views || out.channelThumb || out.channelId) return out;
      } catch (e) {
        console.error("videoMeta", e instanceof Error ? e.message : e);
      }
      await sleep(400);
    }
    return out;
  });

// ---------------- playlist contents ----------------

export type PlaylistResponse = { ok: true; title: string; videos: SearchResult[] } | { ok: false; error: string };

export const playlistData = createServerFn({ method: "GET" })
  .validator((d: { id: string }) => {
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
  .validator((d: { name: string }) => {
    if (typeof d?.name !== "string") throw new Error("name required");
    return { name: d.name.slice(0, 120) };
  })
  .handler(async ({ data }): Promise<string | null> => {
    const q = data.name.trim();
    if (!q) return null;
    if (q.startsWith("UC") && q.length >= 20) return q;

    // 1. If it's a handle (@...) or YouTube URL
    if (q.startsWith("@") || q.includes("youtube.com")) {
      try {
        const url = q.startsWith("http") ? q : `https://www.youtube.com/${q}`;
        const res = await innertubePost("navigation/resolve_url", { url });
        const id = res?.endpoint?.browseEndpoint?.browseId;
        if (typeof id === "string" && id.startsWith("UC")) return id;
      } catch {}
    }

    // 2. Innertube Channel Search (params: 'EgIQAg%3D%3D')
    try {
      const chJson = await innertubePost("search", { query: q, params: "EgIQAg%3D%3D" });
      if (chJson) {
        const cr = findAll(chJson, "channelRenderer")[0];
        if (cr?.channelId) return String(cr.channelId);
        const bid = findAll(chJson, "browseEndpoint").find((b: any) => String(b?.browseId ?? "").startsWith("UC"))?.browseId;
        if (typeof bid === "string") return bid;
      }
    } catch {}

    // 3. Innertube Regular Search
    try {
      const sJson = await innertubePost("search", { query: q });
      if (sJson) {
        const cr = findAll(sJson, "channelRenderer")[0];
        if (cr?.channelId) return String(cr.channelId);
        const bid = findAll(sJson, "browseEndpoint").find((b: any) => String(b?.browseId ?? "").startsWith("UC"))?.browseId;
        if (typeof bid === "string") return bid;
      }
    } catch {}

    // 4. Web scraping fallback
    try {
      let json = await fetchJson(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAg%253D%253D&hl=en&gl=BD`,
      );
      let cr = findAll(json, "channelRenderer")[0];
      let id = cr?.channelId ?? findAll(json, "browseEndpoint").find((b: any) => String(b?.browseId ?? "").startsWith("UC"))?.browseId;
      if (id) return typeof id === "string" ? id : null;

      json = await fetchJson(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=BD`,
      );
      cr = findAll(json, "channelRenderer")[0];
      id = cr?.channelId ?? findAll(json, "browseEndpoint").find((b: any) => String(b?.browseId ?? "").startsWith("UC"))?.browseId;
      return typeof id === "string" ? id : null;
    } catch {
      return null;
    }
  });

// ---------------- public YouTube playlists ----------------
export const publicPlaylists = createServerFn({ method: "GET" })
  .validator((d: { q?: string }) => {
    return { q: typeof d?.q === "string" ? d.q.slice(0, 100) : "bangla songs popular playlist" };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; playlists: PlaylistItem[] }> => {
    const q = (data?.q ?? "").trim() || "bangla songs popular playlist";
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAw%253D%253D&gl=BD&hl=en`;
    try {
      const json = await fetchJson(url);
      if (!json) return { ok: false, playlists: [] };
      const playlists: PlaylistItem[] = [];
      const seen = new Set<string>();

      for (const lv of findAll(json, "lockupViewModel")) {
        const id = lv?.contentId;
        const type = String(lv?.contentType ?? "");
        if (typeof id !== "string" || seen.has(id)) continue;
        if (type.includes("PLAYLIST")) {
          seen.add(id);
          const title = text(lv?.metadata?.lockupMetadataViewModel?.title);
          const thumb = firstUrl(findAll(lv?.contentImage, "thumbnailViewModel")[0]?.image);
          const badges = badgeTexts(lv);
          const meta = metadataStrings(lv?.metadata?.lockupMetadataViewModel);
          if (title) {
            playlists.push({
              id,
              title,
              thumbnail: thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              count: badges[0] ?? meta[0] ?? "প্লেলিস্ট",
              author: meta.find((m) => !m.includes("video") && !m.includes("view")) || "",
            });
          }
        }
      }

      for (const pr of findAll(json, "playlistRenderer")) {
        const id = pr?.playlistId;
        if (typeof id !== "string" || seen.has(id)) continue;
        seen.add(id);
        const title = text(pr.title);
        const thumb = firstUrl(pr.thumbnails) || firstUrl(pr.thumbnail);
        const count = text(pr.videoCount) || text(pr.videoCountShortText) || "প্লেলিস্ট";
        const author = text(pr.shortBylineText) || text(pr.longBylineText) || "";
        if (title) {
          playlists.push({ id, title, thumbnail: thumb, count, author });
        }
      }

      return { ok: true, playlists: playlists.slice(0, 16) };
    } catch (e) {
      console.error("publicPlaylists error", e);
      return { ok: false, playlists: [] };
    }
  });

function extractShortAuthor(rawTitle: string): string {
  const atMatch = rawTitle.match(/@([\w.-]{3,30})/);
  if (atMatch) return `@${atMatch[1]}`;
  const genericTags = new Set([
    "shorts", "short", "viral", "trending", "reels", "reel", "fyp", "foryou",
    "foryoupage", "tiktok", "ytshorts", "bangla", "bangladesh", "comedy",
    "funny", "status", "video", "videos", "music", "song", "entertainment"
  ]);
  const hashMatches = rawTitle.matchAll(/#([\w.-]{3,25})/g);
  for (const m of hashMatches) {
    const tag = m[1]!.toLowerCase();
    if (!genericTags.has(tag) && !tag.endsWith("shorts") && !tag.endsWith("reels")) {
      return `@${m[1]}`;
    }
  }
  return "";
}

// ---------------- YouTube Shorts / Stories ----------------
export const trendingShorts = createServerFn({ method: "GET" })
  .validator((d: { q?: string }) => {
    return { q: typeof d?.q === "string" ? d.q.slice(0, 100) : "bangla shorts viral trending" };
  })
  .handler(async ({ data }): Promise<{ ok: boolean; shorts: SearchResult[] }> => {
    const q = (data?.q ?? "").trim() || "bangla shorts viral trending";
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&gl=BD&hl=en`;
    try {
      const json = await fetchJson(url);
      if (!json) return { ok: false, shorts: [] };
      const shorts: SearchResult[] = [];
      const seen = new Set<string>();

      // Modern YouTube shortsLockupViewModel (YouTube Shorts Shelves)
      for (const sl of findAll(json, "shortsLockupViewModel")) {
        const id =
          sl?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
          sl?.entityId?.replace(/^shorts-shelf-item-/, "") ||
          findAll(sl, "videoId")[0];
        if (typeof id !== "string" || !id || seen.has(id)) continue;
        seen.add(id);
        const title =
          sl?.overlayMetadata?.primaryText?.content ||
          text(sl?.accessibilityText)?.split(",")?.[0] ||
          "Shorts";
        const views = sl?.overlayMetadata?.secondaryText?.content || "";
        const thumb =
          sl?.thumbnailViewModel?.thumbnailViewModel?.image?.sources?.[0]?.url ||
          firstUrl(sl?.thumbnailViewModel) ||
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

        const params = sl?.onTap?.innertubeCommand?.reelWatchEndpoint?.params || "";
        let channelId: string | undefined = undefined;
        try {
          const decoded = Buffer.from(params, "base64").toString("latin1");
          const ucm = decoded.match(/UC[\w-]{22}/);
          if (ucm) channelId = ucm[0];
        } catch {}

        const author = extractShortAuthor(title) || (channelId ? "ক্রিয়েটর" : "Shorts");

        const info = extractChannelInfoFromNode(sl);
        shorts.push({
          id,
          title: title.trim() || "Shorts",
          author,
          thumbnail: thumb,
          duration: "শর্টস",
          views,
          channelId: channelId || info.channelId,
          channelThumb: info.channelThumb,
        });
      }

      for (const rir of findAll(json, "reelItemRenderer")) {
        const id = rir?.videoId;
        if (typeof id !== "string" || seen.has(id)) continue;
        seen.add(id);
        const info = extractChannelInfoFromNode(rir);
        shorts.push({
          id,
          title: text(rir.headline) || "Shorts",
          author: text(rir.ownerText) || text(rir.shortBylineText) || "YouTube",
          thumbnail: firstUrl(rir.thumbnail) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          duration: "শর্টস",
          views: text(rir.viewCountText),
          channelId: bylineChannelId(rir) || info.channelId,
          channelThumb: info.channelThumb,
        });
      }

      for (const lv of findAll(json, "lockupViewModel")) {
        const id = lv?.contentId;
        const type = String(lv?.contentType ?? "");
        if (typeof id !== "string" || seen.has(id)) continue;
        if (type.includes("SHORT")) {
          seen.add(id);
          const title = text(lv?.metadata?.lockupMetadataViewModel?.title);
          const thumb = firstUrl(findAll(lv?.contentImage, "thumbnailViewModel")[0]?.image);
          const meta = metadataStrings(lv?.metadata?.lockupMetadataViewModel);
          const info = extractChannelInfoFromNode(lv);
          shorts.push({
            id,
            title: title || "Shorts",
            author: meta.find((m) => !m.includes("view")) || "YouTube",
            thumbnail: thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            duration: "শর্টস",
            views: meta.find((m) => m.includes("view")) || "",
            channelId: info.channelId,
            channelThumb: info.channelThumb,
          });
        }
      }

      if (shorts.length < 10) {
        const vids: SearchResult[] = [];
        walk(json, vids, seen);
        for (const v of vids) {
          if (shorts.length >= 25) break;
          if (v.title.toLowerCase().includes("short") || (v.duration && v.duration.length <= 4 && !v.duration.includes(":00"))) {
            shorts.push({ ...v, duration: "শর্টস" });
          }
        }
      }

      if (shorts.length > 0) {
        return { ok: true, shorts: shorts.slice(0, 30) };
      }

      // Innertube search fallback
      const fallbackJson = await innertubePost("search", { query: `${q} shorts` });
      if (fallbackJson) {
        const fallbackShorts: SearchResult[] = [];
        walk(fallbackJson, fallbackShorts, new Set());
        const valid = fallbackShorts.slice(0, 30);
        if (valid.length) {
          return { ok: true, shorts: valid.map((s) => ({ ...s, duration: "শর্টস" })) };
        }
      }

      return { ok: true, shorts: shorts.slice(0, 30) };
    } catch (e) {
      console.error("trendingShorts error", e);
      try {
        const fallbackJson = await innertubePost("search", { query: `${q} shorts` });
        if (fallbackJson) {
          const fallbackShorts: SearchResult[] = [];
          walk(fallbackJson, fallbackShorts, new Set());
          if (fallbackShorts.length) {
            return { ok: true, shorts: fallbackShorts.slice(0, 30).map((s) => ({ ...s, duration: "শর্টস" })) };
          }
        }
      } catch {}
      return { ok: false, shorts: [] };
    }
  });
