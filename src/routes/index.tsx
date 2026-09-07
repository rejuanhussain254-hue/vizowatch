import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePlayer } from "@/hooks/usePlayer";
import { useAuth } from "@/hooks/useAuth";
import { clearCloudHistory, mergeHistoryOnSignIn, updateCloudPosition, upsertCloudHistory } from "@/lib/history-sync";
import { searchYouTube, type SearchResult } from "@/lib/search.functions";
import {
  clearHistory,
  extractVideoId,
  fetchTrack,
  formatTime,
  loadHistory,
  loadQueue,
  pushHistory,
  saveQueue,
  timeAgo,
  updateHistoryPosition,
  type HistoryItem,
  type Track,
} from "@/lib/youtube";

type Search = { url?: string; text?: string; title?: string; v?: string };

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Echo — ইউটিউব ব্যাকগ্রাউন্ড প্লেয়ার" },
      { name: "description", content: "অ্যাপের ভেতরেই ইউটিউব খুঁজুন, সাইন-ইন ছাড়াই যেকোনো ভিডিও ব্যাকগ্রাউন্ডে চালান। কুই, ইতিহাস, লক-স্ক্রিন কন্ট্রোল সহ।" },
      { property: "og:title", content: "Echo — ইউটিউব ব্যাকগ্রাউন্ড প্লেয়ার" },
      { property: "og:description", content: "সাইন-ইন ছাড়াই ইউটিউব ভিডিও ব্যাকগ্রাউন্ডে শুনুন।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Search => {
    const out: Search = {};
    for (const k of ["url", "text", "title", "v"] as const) if (typeof s[k] === "string") out[k] = s[k] as string;
    return out;
  },
  component: Index,
});

const PLAYER_ID = "echo-yt-player";

const CATEGORIES: { label: string; q: string }[] = [
  { label: "হোম", q: "" },
  { label: "ট্রেন্ডিং", q: "trending videos bangladesh today" },
  { label: "নাটক", q: "bangla natok new" },
  { label: "খবর", q: "bangla news today live" },
  { label: "গান", q: "new bangla hindi songs" },
  { label: "ইসলামিক", q: "bangla waz islamic" },
  { label: "খেলা", q: "cricket football highlights today" },
  { label: "কমেডি", q: "bangla funny video comedy" },
  { label: "রান্না", q: "bangla recipe cooking" },
  { label: "ভ্লগ", q: "bangla vlog" },
  { label: "পডকাস্ট", q: "bangla podcast" },
  { label: "শিক্ষা", q: "bangla tutorial education" },
  { label: "প্রযুক্তি", q: "bangla tech review" },
  { label: "সিনেমা", q: "bangla movie full hd" },
  { label: "কার্টুন", q: "bangla cartoon kids" },
  { label: "ভ্রমণ", q: "bangladesh travel vlog" },
  { label: "গেমিং", q: "bangla gaming" },
];

function Eq({ className = "bg-primary" }: { className?: string }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0, -250, -500, -750].map((d) => (
        <span key={d} className={`eq-bar h-full w-[3px] rounded-full ${className}`} style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function PlayIcon({ playing, className = "" }: { playing: boolean; className?: string }) {
  return playing ? (
    <span className={`flex gap-1 ${className}`} aria-hidden>
      <span className="block h-4 w-1 rounded-full bg-current" />
      <span className="block h-4 w-1 rounded-full bg-current" />
    </span>
  ) : (
    <span className={`ml-0.5 block h-0 w-0 border-y-[8px] border-l-[13px] border-y-transparent border-l-current ${className}`} aria-hidden />
  );
}

function SkipIcon({ back = false }: { back?: boolean }) {
  return (
    <span className={`flex items-center ${back ? "flex-row-reverse" : ""}`} aria-hidden>
      <span className={`block h-0 w-0 border-y-[6px] border-y-transparent ${back ? "border-r-[9px] border-r-current" : "border-l-[9px] border-l-current"}`} />
      <span className={`block h-3.5 w-[3px] rounded-full bg-current ${back ? "mr-[2px]" : "ml-[2px]"}`} />
    </span>
  );
}

function Skeleton() {
  return (
    <ul className="mt-3 space-y-2.5" aria-label="লোড হচ্ছে">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="glass flex animate-pulse items-center gap-3 rounded-3xl p-2.5 ring-1 ring-border">
          <span className="h-14 w-[88px] shrink-0 rounded-[14px] bg-lilac/50" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 w-4/5 rounded-full bg-lilac/50" />
            <span className="block h-3 w-1/2 rounded-full bg-lilac/40" />
          </span>
        </li>
      ))}
    </ul>
  );
}

type Row = Track & { duration?: string | number; views?: string };
function VideoRow({ r, active, playing, onPlay, onQueue, sub, progress }: { r: Row; active: boolean; playing: boolean; onPlay: () => void; onQueue?: () => void; sub?: string; progress?: number }) {
  return (
    <li className={`flex items-center gap-2 rounded-3xl p-2.5 ring-1 ${active ? "bg-primary-soft/80 ring-primary/25" : "glass ring-border"}`}>
      <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="relative shrink-0">
          <img src={r.thumbnail} alt="" className="h-14 w-[88px] rounded-[14px] object-cover ring-1 ring-border" loading="lazy" />
          {typeof r.duration === "string" && r.duration && <span className="absolute right-1 bottom-1 rounded-md bg-foreground/80 px-1 text-[10px] font-medium text-background">{r.duration}</span>}
          {progress != null && progress > 0.01 && (
            <span className="absolute inset-x-1 bottom-0.5 h-[3px] overflow-hidden rounded-full bg-foreground/30">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-display text-[14px] font-semibold leading-snug">{r.title}</span>
          <span className="block truncate text-[12px] text-muted-foreground">{sub ?? `${r.author}${r.views ? ` · ${r.views}` : ""}`}</span>
        </span>
      </button>
      {active && playing ? (
        <span className="px-2"><Eq /></span>
      ) : onQueue ? (
        <button onClick={onQueue} aria-label="প্লেলিস্টে যোগ" title="প্লেলিস্টে যোগ" className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background">
          <span className="relative block size-3"><span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-current" /><span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-current" /></span>
        </button>
      ) : null}
    </li>
  );
}

function Index() {
  const [queue, setQueue] = useState<Track[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [profileOpen, setProfileOpen] = useState(false);
  const [bigVideo, setBigVideo] = useState(false);
  const toggleBigVideo = () => {
    const next = !bigVideo;
    setBigVideo(next);
    const el = document.getElementById(PLAYER_ID)?.parentElement as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
    try {
      if (next && el?.requestFullscreen) void el.requestFullscreen().catch(() => {});
      else if (next && el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (!next && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } catch {}
  };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setBigVideo(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [lastQuery, setLastQuery] = useState("");
  const [category, setCategory] = useState<string | null>("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [relatedState, setRelatedState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [relatedTick, setRelatedTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const player = usePlayer(queue, PLAYER_ID);
  const search = Route.useSearch();
  const navigate = useNavigate();
  const runSearch = useServerFn(searchYouTube);
  const { user, signOut } = useAuth();
  const userId = user?.id ?? null;
  const [syncing, setSyncing] = useState(false);
  const { current, playing, time, duration } = player;
  const open = !!search.v;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  // ---- search with client-side retry ----
  const fetchWithRetry = useCallback(
    async (q: string): Promise<SearchResult[] | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await runSearch({ data: { q } });
          if (res.ok) return res.results;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      return null;
    },
    [runSearch],
  );

  // ---- home feed: mixed videos from every category, loaded page by page on scroll ----
  const feedOrder = useRef<string[]>([]);
  const feedPage = useRef(0);
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [slotRect, setSlotRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [pipDismissed, setPipDismissed] = useState(false);
  const playerMode: "big" | "watch" | "pip" | "hidden" = bigVideo ? "big" : open ? "watch" : current && !pipDismissed ? "pip" : "hidden";
  // where the player docks on the watch page — the sheet slides for 500ms, so measure again once it settles
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = slotRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // the sheet is translating while it opens; compute the resting position from its final layout
      const sheet = el.closest<HTMLElement>("[data-watch-sheet]");
      const shift = sheet ? sheet.getBoundingClientRect().top - (window.innerHeight - sheet.offsetHeight) : 0;
      setSlotRect({ top: r.top - shift, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const t = setTimeout(measure, 550);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); };
  }, [open, hydrated]);
  useEffect(() => { setPipDismissed(false); }, [current?.id, open]);
  const feedSeen = useRef<Set<string>>(new Set());
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const feedDone = feedPage.current >= feedOrder.current.length && feedOrder.current.length > 0;
  const sentinel = useRef<HTMLDivElement>(null);

  const loadFeedPage = useCallback(
    async (reset: boolean) => {
      if (reset) {
        const pool = CATEGORIES.filter((c) => c.q).map((c) => c.q);
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const t = pool[i]!; pool[i] = pool[j]!; pool[j] = t;
        }
        feedOrder.current = pool;
        feedPage.current = 0;
        feedSeen.current = new Set();
        setResults([]);
        setSearchState("loading");
      } else {
        if (feedLoadingMore || feedPage.current >= feedOrder.current.length) return;
        setFeedLoadingMore(true);
      }
      const take = reset ? 2 : 1;
      const qs = feedOrder.current.slice(feedPage.current, feedPage.current + take);
      feedPage.current += take;
      const batches = await Promise.all(qs.map((q) => fetchWithRetry(q)));
      const fresh: SearchResult[] = [];
      // interleave the batches so the feed looks mixed, like YouTube home
      const max = Math.max(0, ...batches.map((b) => b?.length ?? 0));
      for (let i = 0; i < max; i++) {
        for (const b of batches) {
          const r = b?.[i];
          if (r && !feedSeen.current.has(r.id)) {
            feedSeen.current.add(r.id);
            fresh.push(r);
          }
        }
      }
      if (reset) {
        if (batches.every((b) => b === null)) {
          setSearchState("error");
        } else {
          setResults(fresh);
          setSearchState("ok");
        }
      } else {
        setResults((prev) => [...prev, ...fresh]);
        setFeedLoadingMore(false);
      }
    },
    [fetchWithRetry, feedLoadingMore],
  );

  const doSearch = useCallback(
    async (q: string) => {
      setLastQuery(q);
      if (!q.trim()) {
        await loadFeedPage(true);
        return;
      }
      feedOrder.current = [];
      setSearchState("loading");
      const r = await fetchWithRetry(q);
      if (r) {
        setResults(r);
        setSearchState("ok");
      } else {
        setResults([]);
        setSearchState("error");
      }
    },
    [fetchWithRetry, loadFeedPage],
  );

  useEffect(() => {
    doSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // infinite scroll for the home feed
  const isHome = lastQuery.trim().length === 0;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !isHome || searchState !== "ok") return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadFeedPage(false);
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [isHome, searchState, loadFeedPage]);

  // ---- persistence ----
  useEffect(() => {
    setQueue(loadQueue());
    setHistory(loadHistory());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveQueue(queue);
  }, [queue, hydrated]);

  // signed in → merge local history with the cloud copy and use the merged list
  useEffect(() => {
    if (!userId || !hydrated) return;
    let cancelled = false;
    setSyncing(true);
    mergeHistoryOnSignIn(userId)
      .then((merged) => { if (!cancelled) setHistory(merged); })
      .catch(() => { if (!cancelled) flash("ইতিহাস সিঙ্ক হয়নি"); })
      .finally(() => { if (!cancelled) setSyncing(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, hydrated]);

  // record history + keep resume position fresh (locally, and in the cloud when signed in)
  useEffect(() => {
    if (!current) return;
    const next = pushHistory(current);
    setHistory(next);
    const item = next.find((h) => h.id === current.id);
    if (userId && item) upsertCloudHistory(userId, item);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastSaved = useRef(0);
  useEffect(() => {
    if (!current || !duration) return;
    if (Math.abs(time - lastSaved.current) < 5) return;
    lastSaved.current = time;
    updateHistoryPosition(current.id, time, duration);
    if (userId) {
      const item = loadHistory().find((h) => h.id === current.id);
      if (item) updateCloudPosition(userId, current.id, item.position, item.duration);
    }
  }, [time, duration, current, userId]);

  // ---- watch page (?v=ID) ----
  const openWatch = (id: string) => navigate({ to: "/", search: { v: id } });
  const closeWatch = () => navigate({ to: "/", search: {}, replace: true });

  const playTrack = useCallback(
    (track: Track, startAt = 0) => {
      const q = loadQueue();
      let idx = q.findIndex((t) => t.id === track.id);
      if (idx === -1) {
        q.push(track);
        idx = q.length - 1;
        setQueue(q);
        saveQueue(q);
      }
      setTimeout(() => player.playAt(idx, startAt), 60);
      openWatch(track.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player.playAt],
  );

  // ?v= present (deep link / reload / back-forward) but not playing that video → start it
  useEffect(() => {
    if (!hydrated || !player.ready || !search.v) return;
    if (current?.id === search.v) return;
    const id = search.v;
    (async () => {
      const known = loadQueue().find((t) => t.id === id) ?? loadHistory().find((t) => t.id === id) ?? (await fetchTrack(id));
      const pos = loadHistory().find((h) => h.id === id)?.position ?? 0;
      playTrack(known, pos);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, player.ready, search.v]);

  // related videos for the watch page
  useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    setRelatedState("loading");
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await runSearch({ data: { q: `${current.title.split(/[|(\[-]/)[0]!.trim()} ${current.author}` } });
          if (cancelled) return;
          if (res.ok) {
            let list = res.results.filter((r) => r.id !== current.id).slice(0, 12);
            if (list.length === 0) list = results.filter((r) => r.id !== current.id).slice(0, 12);
            setRelated(list);
            setRelatedState("ok");
            return;
          }
        } catch {
          /* retry */
        }
      }
      if (cancelled) return;
      const fallback = results.filter((r) => r.id !== current.id).slice(0, 12);
      if (fallback.length > 0) {
        setRelated(fallback);
        setRelatedState("ok");
      } else setRelatedState("error");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current?.id, relatedTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared from YouTube (Share → Echo) or opened with ?url=
  useEffect(() => {
    if (!hydrated || !player.ready) return;
    const shared = [search.url, search.text, search.title].filter(Boolean).join(" ");
    const id = shared ? extractVideoId(shared) ?? extractVideoId(shared.match(/https?:\/\/\S+/)?.[0] ?? "") : null;
    if (!id) return;
    (async () => playTrack(loadQueue().find((t) => t.id === id) ?? (await fetchTrack(id))))();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, player.ready, search.url, search.text, search.title]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const q = input.trim();
    if (!q) return setError("ভিডিওর নাম বা ইউটিউব লিংক দিন।");
    const id = extractVideoId(q);
    if (!id) {
      setCategory(null);
      return doSearch(q);
    }
    setBusy(true);
    const track = await fetchTrack(id);
    setBusy(false);
    setInput("");
    playTrack(track);
  }

  function addToQueue(t: Track) {
    if (queue.some((x) => x.id === t.id)) return flash("আগেই প্লেলিস্টে আছে");
    setQueue((q) => [...q, { id: t.id, title: t.title, author: t.author, thumbnail: t.thumbnail }]);
    flash("প্লেলিস্টে যোগ হয়েছে");
  }

  function remove(i: number) {
    setQueue((q) => q.filter((_, k) => k !== i));
    if (player.index !== null && i < player.index) player.setIndex(player.index - 1);
    else if (player.index === i) player.setIndex(null);
  }

  const resume = history.find((h) => h.position > 10 && h.id !== current?.id);
  const upNext = player.index !== null ? queue.slice(player.index + 1, player.index + 6) : queue.slice(0, 5);
  const isSearch = lastQuery.trim().length > 0;
  const catLabel = CATEGORIES.find((c) => c.q === category)?.label ?? null;

  return (
    <div className="relative min-h-screen overflow-hidden font-body">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="animate-glow absolute -top-24 -left-16 size-72 rounded-full bg-sun/60 blur-3xl" />
        <div className="animate-glow absolute top-1/3 -right-20 size-80 rounded-full bg-mint/60 blur-3xl" style={{ animationDelay: "-6s" }} />
        <div className="animate-glow absolute bottom-24 left-1/4 size-72 rounded-full bg-rose/50 blur-3xl" style={{ animationDelay: "-3s" }} />
        <div className="animate-glow absolute -bottom-16 right-6 size-60 rounded-full bg-lilac/60 blur-3xl" style={{ animationDelay: "-9s" }} />
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-[420px] flex-col px-5 pb-10">
        <header className="flex items-center gap-3 pt-6">
          <div className="flex shrink-0 items-center gap-2">
            <div className="grid size-9 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-primary">
              <Eq className="bg-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight">Echo</span>
          </div>
          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-background px-3 py-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder=""
                aria-label="ইউটিউবে খুঁজুন"
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
                inputMode="search"
                autoComplete="off"
              />
              {input && (
                <button type="button" onClick={() => { setInput(""); setCategory(""); doSearch(""); }} aria-label="মুছুন" className="text-[12px] text-muted-foreground">✕</button>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || searchState === "loading"}
              aria-label="খুঁজুন"
              className="grid size-9 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-primary transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
              )}
            </button>
          </form>
          <button
            onClick={() => setProfileOpen(true)}
            aria-label="প্রোফাইল"
            className={`relative grid size-9 shrink-0 place-items-center rounded-full ring-1 transition active:scale-95 ${user ? "bg-primary text-primary-foreground ring-primary shadow-primary font-display text-sm font-bold" : "bg-glass ring-border"}`}
          >
            {user ? (
              (user.email ?? "?")[0]?.toUpperCase()
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            )}
            {hydrated && queue.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-rose px-1 text-[10px] font-bold text-foreground ring-2 ring-background">{queue.length}</span>
            )}
          </button>
        </header>
        {error && <p className="mt-2 text-center text-[12px] text-muted-foreground">{error}</p>}

        <nav aria-label="ক্যাটাগরি" className="-mx-5 mt-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((c) => {
            const on = category === c.q;
            return (
              <button
                key={c.label}
                onClick={() => { setCategory(c.q); setInput(""); doSearch(c.q); }}
                className={`shrink-0 rounded-full px-3.5 py-1.5 font-display text-[13px] font-semibold ring-1 transition active:scale-95 ${on ? "bg-primary text-primary-foreground ring-primary shadow-primary" : "bg-glass text-foreground ring-border"}`}
              >
                {c.label}
              </button>
            );
          })}
        </nav>

        {resume && !open && (
          <button
            onClick={() => playTrack(resume, resume.position)}
            className="mt-4 flex w-full items-center gap-3 rounded-3xl bg-primary p-3 text-left text-primary-foreground shadow-primary transition active:scale-[0.99]"
          >
            <img src={resume.thumbnail} alt="" className="h-12 w-[76px] rounded-xl object-cover" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] opacity-80">যেখানে ছেড়েছিলেন · {formatTime(resume.position)} থেকে চালু করুন</span>
              <span className="block truncate font-display text-[14px] font-semibold">{resume.title}</span>
            </span>
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary-foreground text-primary"><PlayIcon playing={false} /></span>
          </button>
        )}


        {/* Search / trending */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{catLabel ? (catLabel === "হোম" ? "আপনার জন্য" : catLabel) : isSearch ? `"${lastQuery}"` : "আপনার জন্য"}</h2>
          {searchState === "loading" && <span className="text-[12px] text-muted-foreground">খোঁজা হচ্ছে…</span>}
        </div>

        {searchState === "loading" && <Skeleton />}

        {searchState === "error" && (
          <div className="glass mt-3 rounded-3xl p-5 text-center">
            <p className="font-display text-sm font-semibold">ইউটিউব থেকে ফলাফল আনা যায়নি</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">ইন্টারনেট দেখুন বা একটু পরে আবার চেষ্টা করুন।</p>
            <button onClick={() => doSearch(lastQuery)} className="mt-3 rounded-2xl bg-primary px-4 py-2 font-display text-[13px] font-semibold text-primary-foreground shadow-primary">
              আবার চেষ্টা করুন
            </button>
          </div>
        )}

        {searchState === "ok" && results.length === 0 && (
          <div className="glass mt-3 rounded-3xl p-5 text-center">
            <p className="font-display text-sm font-semibold">{catLabel ?? `"${lastQuery}"`} — কিছু পাওয়া যায়নি</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">বানান বদলে দেখুন, বা ইউটিউব লিংক সরাসরি পেস্ট করুন।</p>
            <button onClick={() => { setInput(""); setCategory(""); doSearch(""); }} className="mt-3 rounded-2xl bg-glass px-4 py-2 font-display text-[13px] font-semibold ring-1 ring-border">
              হোমে ফিরুন
            </button>
          </div>
        )}

        {searchState === "ok" && results.length > 0 && (
          <ul className="mt-3 space-y-2.5">
            {results.map((r) => (
              <VideoRow key={r.id} r={r} active={current?.id === r.id} playing={playing} onPlay={() => playTrack(r)} onQueue={() => addToQueue(r)} />
            ))}
          </ul>
        )}

        {isHome && searchState === "ok" && (
          <div ref={sentinel} className="py-4 text-center text-[12px] text-muted-foreground">
            {feedLoadingMore ? "আরও ভিডিও আসছে…" : feedDone ? "আজকের মতো এটুকুই" : ""}
          </div>
        )}

        <section className="glass mt-8 rounded-3xl p-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <p className="font-display text-sm font-semibold text-foreground">ব্যাকগ্রাউন্ডে চালাতে</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>ব্রাউজারের মেনু থেকে <b className="text-foreground">Add to Home screen</b> করে অ্যাপের মতো খুলুন।</li>
            <li>প্লে চালু রেখে স্ক্রিন অফ করুন — লক-স্ক্রিন থেকেই প্লে/পজ, পরের ভিডিও করা যাবে।</li>
            <li>ইউটিউবে সাইন-ইন লাগবে না।</li>
          </ul>
        </section>
      </main>

      {/* Profile sheet — account, playlist, history */}
      {profileOpen && <button aria-label="বন্ধ" onClick={() => setProfileOpen(false)} className="fixed inset-0 z-20 bg-foreground/20 backdrop-blur-[2px]" />}
      <div
        className={`fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[420px] flex-col rounded-t-[28px] bg-background/95 backdrop-blur-xl transition-transform duration-500 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] ${profileOpen ? "translate-y-0" : "translate-y-full"}`}
        style={{ height: "92dvh" }}
        aria-hidden={!profileOpen}
        role="dialog"
        aria-label="প্রোফাইল"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <p className="font-display text-base font-bold">প্রোফাইল</p>
          <button onClick={() => setProfileOpen(false)} aria-label="বন্ধ" className="grid size-9 place-items-center rounded-2xl bg-glass ring-1 ring-border text-[13px]">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-10">
          {user ? (
            <div className="glass mt-4 flex items-center gap-3 rounded-3xl p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary font-display text-base font-bold text-primary-foreground shadow-primary">{(user.email ?? "?")[0]?.toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14px] font-semibold">{user.email}</span>
                <span className="block text-[12px] text-muted-foreground">{syncing ? "সিঙ্ক হচ্ছে…" : "✓ ইতিহাস সব ডিভাইসে সিঙ্ক চালু"}</span>
              </span>
              <button onClick={() => signOut()} className="shrink-0 rounded-full bg-glass px-3 py-1.5 text-[11px] font-medium ring-1 ring-border">সাইন-আউট</button>
            </div>
          ) : (
            <div className="glass mt-4 rounded-3xl p-4">
              <p className="font-display text-[15px] font-semibold">সাইন-ইন করুন</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">ইতিহাস ও রিজিউম পজিশন সব ডিভাইসে সিঙ্ক থাকবে।</p>
              <div className="mt-3 flex gap-2">
                <Link to="/auth" className="flex-1 rounded-2xl bg-primary px-4 py-2.5 text-center font-display text-[13px] font-semibold text-primary-foreground shadow-primary">লগইন</Link>
                <Link to="/auth" className="flex-1 rounded-2xl bg-background px-4 py-2.5 text-center font-display text-[13px] font-semibold ring-1 ring-border">সাইনআপ</Link>
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <div className="flex gap-1 rounded-2xl bg-glass p-1 ring-1 ring-border">
              {(["queue", "history"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-xl px-3 py-1.5 font-display text-[13px] font-semibold transition ${tab === t ? "bg-primary text-primary-foreground shadow-primary" : "text-muted-foreground"}`}
                >
                  {t === "queue" ? `প্লেলিস্ট · ${queue.length}` : `ইতিহাস · ${history.length}`}
                </button>
              ))}
            </div>
            {tab === "queue" && queue.length > 0 && (
              <button onClick={() => { setQueue([]); player.setIndex(null); }} className="text-[12px] text-muted-foreground">সব মুছুন</button>
            )}
            {tab === "history" && history.length > 0 && (
              <button onClick={() => { clearHistory(); setHistory([]); if (userId) clearCloudHistory(userId); }} className="text-[12px] text-muted-foreground">সব মুছুন</button>
            )}
          </div>

          {tab === "queue" && (
            <>
              {hydrated && queue.length === 0 && (
                <p className="glass mt-3 rounded-3xl p-5 text-center text-[13px] text-muted-foreground">প্লেলিস্ট খালি। হোমের যেকোনো ভিডিওর <b className="text-foreground">+</b> চাপলে এখানে যোগ হবে।</p>
              )}
              <ul className="mt-3 space-y-2.5">
                {queue.map((t, i) => {
                  const active = player.index === i;
                  return (
                    <li key={t.id} className={`flex items-center gap-2 rounded-3xl p-2.5 ring-1 ${active ? "bg-primary-soft/80 ring-primary/25" : "glass ring-border"}`}>
                      <span className="w-5 shrink-0 text-center text-[11px] text-muted-foreground">{i + 1}</span>
                      <button onClick={() => { player.playAt(i); setProfileOpen(false); openWatch(t.id); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <img src={t.thumbnail} alt="" className="size-12 shrink-0 rounded-[12px] object-cover ring-1 ring-border" loading="lazy" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-display text-[14px] font-semibold">{t.title}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{t.author}</span>
                        </span>
                      </button>
                      {active && playing ? (
                        <span className="pr-1"><Eq /></span>
                      ) : (
                        <button onClick={() => remove(i)} aria-label="মুছুন" className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-background">
                          <span className="block h-[2px] w-3 rounded-full bg-current" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {tab === "history" && (
            <>
              {hydrated && history.length === 0 && (
                <p className="glass mt-3 rounded-3xl p-5 text-center text-[13px] text-muted-foreground">এখনো কিছু দেখা হয়নি। যা চালাবেন তা এখানে জমা থাকবে।</p>
              )}
              <ul className="mt-3 space-y-2.5">
                {history.map((h) => (
                  <VideoRow
                    key={h.id}
                    r={h}
                    active={current?.id === h.id}
                    playing={playing}
                    onPlay={() => { setProfileOpen(false); playTrack(h, h.position); }}
                    onQueue={() => addToQueue(h)}
                    sub={`${timeAgo(h.at)}${h.position > 10 ? ` · ${formatTime(h.position)} থেকে` : ""}`}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Watch page (?v=ID) — the player iframe lives here permanently so audio never stops */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[420px] flex-col bg-background/95 backdrop-blur-xl transition-transform duration-500 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] ${open ? "translate-y-0" : "translate-y-full"}`}
        style={{ height: "100dvh" }}
        aria-hidden={!open}
        data-watch-sheet
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <button onClick={closeWatch} aria-label="বন্ধ" className="grid size-10 place-items-center rounded-2xl bg-glass ring-1 ring-border">
            <span className="block h-[2px] w-4 rounded-full bg-foreground" />
          </button>
          <p className="font-display text-sm font-semibold">এখন চলছে</p>
          <button
            onClick={() => player.setRepeat(!player.repeat)}
            className={`rounded-2xl px-3 py-2 text-[12px] font-semibold ring-1 ring-border ${player.repeat ? "bg-primary text-primary-foreground" : "bg-glass"}`}
          >
            রিপিট
          </button>
        </div>

        {/* slot the floating player docks into while the watch page is open */}
        <div ref={slotRef} className="mx-5 mt-4 aspect-video rounded-3xl bg-lilac/40 ring-1 ring-border" />

        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          <div className="px-5 pt-4">
            <p className="line-clamp-2 font-display text-lg font-bold leading-snug">{current?.title ?? "কোনো ভিডিও বাছাই হয়নি"}</p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{current?.author ?? "কুই থেকে একটি ভিডিও বেছে নিন"}</p>
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={Math.min(time, duration || 0)}
              onChange={(e) => player.seek(Number(e.target.value))}
              className="mt-4 w-full accent-primary"
              aria-label="সিক"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{formatTime(time)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-5">
              <button onClick={player.prev} aria-label="আগের ভিডিও" className="grid size-14 place-items-center rounded-2xl bg-glass ring-1 ring-border"><SkipIcon back /></button>
              <button onClick={player.toggle} aria-label={playing ? "পজ" : "প্লে"} className="grid size-[72px] place-items-center rounded-3xl bg-primary text-primary-foreground shadow-primary">
                <PlayIcon playing={playing} />
              </button>
              <button onClick={player.next} aria-label="পরের ভিডিও" className="grid size-14 place-items-center rounded-2xl bg-glass ring-1 ring-border"><SkipIcon /></button>
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">স্ক্রিন অফ করলেও চলতে থাকবে · লক-স্ক্রিন থেকে কন্ট্রোল করুন</p>

            {current && player.captionTracks.length > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-glass px-3 py-2 ring-1 ring-border">
                <button
                  onClick={() => player.setCaptions(!player.captionsOn)}
                  aria-pressed={player.captionsOn}
                  aria-label="সাবটাইটেল"
                  className={`grid h-8 min-w-10 place-items-center rounded-xl px-2 font-display text-[12px] font-bold transition ${player.captionsOn ? "bg-primary text-primary-foreground shadow-primary" : "bg-background text-muted-foreground ring-1 ring-border"}`}
                >
                  CC
                </button>
                <span className="flex-1 text-[12px]">{player.captionsOn ? "সাবটাইটেল চালু" : "সাবটাইটেল বন্ধ"}</span>
                {player.captionsOn && player.captionTracks.length > 1 && (
                  <select
                    value={player.captionLang ?? ""}
                    onChange={(e) => player.setCaptions(true, e.target.value)}
                    aria-label="সাবটাইটেল ভাষা"
                    className="max-w-[140px] rounded-xl bg-background px-2 py-1 text-[12px] ring-1 ring-border outline-none"
                  >
                    {player.captionTracks.map((t) => (
                      <option key={t.code} value={t.code}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {current && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => navigator.share?.({ url: `https://youtu.be/${current.id}`, title: current.title }).catch(() => {})}
                  className="flex-1 rounded-2xl bg-glass py-2 text-[12px] font-semibold ring-1 ring-border"
                >
                  শেয়ার
                </button>
                <a href={`https://www.youtube.com/watch?v=${current.id}`} target="_blank" rel="noopener" className="flex-1 rounded-2xl bg-glass py-2 text-center text-[12px] font-semibold ring-1 ring-border">
                  ইউটিউবে দেখুন
                </a>
              </div>
            )}

            {upNext.length > 0 && (
              <>
                <h3 className="mt-6 font-display text-base font-semibold">পরে বাজবে</h3>
                <ul className="mt-2 space-y-2">
                  {upNext.map((t) => {
                    const i = queue.findIndex((x) => x.id === t.id);
                    return (
                      <li key={t.id} className="glass flex items-center gap-3 rounded-2xl p-2 ring-1 ring-border">
                        <button onClick={() => { player.playAt(i); openWatch(t.id); }} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <img src={t.thumbnail} alt="" className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-border" loading="lazy" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold">{t.title}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{t.author}</span>
                          </span>
                        </button>
                        <button onClick={() => remove(i)} aria-label="কুই থেকে মুছুন" className="grid size-8 place-items-center rounded-full text-muted-foreground"><span className="block h-[2px] w-3 rounded-full bg-current" /></button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <h3 className="mt-6 font-display text-base font-semibold">সম্পর্কিত ভিডিও</h3>
            {relatedState === "loading" && <Skeleton />}
            {relatedState === "error" && (
              <p className="glass mt-2 rounded-2xl p-4 text-center text-[12.5px] text-muted-foreground">
                সম্পর্কিত ভিডিও আনা যায়নি। <button onClick={() => setRelatedTick((t) => t + 1)} className="font-semibold text-primary">আবার চেষ্টা</button>
              </p>
            )}
            {relatedState === "ok" && related.length === 0 && (
              <p className="glass mt-2 rounded-2xl p-4 text-center text-[12.5px] text-muted-foreground">এই ভিডিওর সাথে মেলে এমন কিছু পাওয়া যায়নি।</p>
            )}
            {relatedState === "ok" && related.length > 0 && (
              <ul className="mt-2 space-y-2">
                {related.map((r) => (
                  <VideoRow key={r.id} r={r} active={false} playing={false} onPlay={() => playTrack(r)} onQueue={() => addToQueue(r)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Floating player — one element, moved between big / watch slot / pop-up corner so playback never restarts */}
      <div
        className={`fixed z-[45] overflow-hidden bg-foreground transition-all duration-500 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] ${
          playerMode === "big" ? "grid place-items-center rounded-none" : playerMode === "pip" ? "rounded-2xl shadow-primary ring-1 ring-border" : playerMode === "watch" ? "rounded-3xl ring-1 ring-border" : "pointer-events-none opacity-0"
        }`}
        style={
          playerMode === "big"
            ? { inset: 0 }
            : playerMode === "watch" && slotRect
              ? { top: slotRect.top, left: slotRect.left, width: slotRect.width, height: slotRect.height }
              : playerMode === "pip"
                ? { right: 12, bottom: 16, width: 190, height: 107 }
                : { right: 12, bottom: 16, width: 1, height: 1 }
        }
      >
        <div id={PLAYER_ID} className={playerMode === "big" ? "aspect-video w-full max-h-full" : "size-full"} />
        {playerMode === "big" && (
          <div
            className="absolute inset-0 touch-none"
            onTouchStart={(e) => { const t = e.touches[0]!; swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }; }}
            onTouchEnd={(e) => {
              const s = swipeRef.current; swipeRef.current = null;
              const t = e.changedTouches[0];
              if (!s || !t) return;
              const dx = t.clientX - s.x, dy = t.clientY - s.y;
              const swipe = Math.hypot(dx, dy) > 60 && Date.now() - s.t < 800;
              if (!swipe) { player.toggle(); return; }
              const dir = Math.abs(dy) > Math.abs(dx) ? dy : dx;
              if (dir < 0) { player.next(); flash("পরের ভিডিও"); } else { player.prev(); flash("আগের ভিডিও"); }
            }}
          >
            <p className="pointer-events-none absolute inset-x-0 top-16 text-center text-[11px] text-background/70">উপরে সোয়াইপ করলে পরের ভিডিও · ট্যাপ করলে প্লে/পজ</p>
          </div>
        )}
        {playerMode === "pip" && (
          <>
            <button onClick={() => current && openWatch(current.id)} aria-label="ভিডিও পেইজ খুলুন" className="absolute inset-0" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-foreground/80 to-transparent px-2 pb-1.5 pt-4 text-background">
              <button onClick={player.toggle} aria-label={playing ? "পজ" : "প্লে"} className="grid size-8 place-items-center rounded-lg bg-background/20"><PlayIcon playing={playing} className="size-4" /></button>
              <button onClick={player.next} aria-label="পরের" className="grid size-8 place-items-center rounded-lg bg-background/20"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg></button>
              <button onClick={() => { player.toggle(); setPipDismissed(true); }} aria-label="বন্ধ" className="grid size-8 place-items-center rounded-lg bg-background/20"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            </div>
          </>
        )}
        {(playerMode === "big" || playerMode === "watch") && (
          <button
            onClick={toggleBigVideo}
            aria-label={bigVideo ? "ছোট করুন" : "বড় করুন"}
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-xl bg-background/80 text-foreground shadow ring-1 ring-border backdrop-blur"
          >
            {bigVideo ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" /></svg>
            )}
          </button>
        )}
        {playerMode === "big" && (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-foreground/80 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8 text-background">
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={Math.min(time, duration || 0)}
              onChange={(e) => player.seek(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label="সিক"
            />
            <div className="mt-1 flex items-center justify-between text-[12px] font-semibold">
              <span>{formatTime(time)} / {formatTime(duration)}</span>
              <div className="flex items-center gap-2">
                <button onClick={player.prev} aria-label="আগের" className="grid size-9 place-items-center rounded-xl bg-background/20"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg></button>
                <button onClick={player.toggle} aria-label={playing ? "পজ" : "প্লে"} className="grid size-10 place-items-center rounded-xl bg-background/20"><PlayIcon playing={playing} className="size-5" /></button>
                <button onClick={player.next} aria-label="পরের" className="grid size-9 place-items-center rounded-xl bg-background/20"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg></button>
              </div>
            </div>
          </div>
        )}
      </div>


      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          <span className="rounded-full bg-foreground px-4 py-2 text-[12px] font-semibold text-background shadow-primary">{toast}</span>
        </div>
      )}
    </div>
  );
}
