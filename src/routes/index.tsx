import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from "react";
import { usePlayer } from "@/hooks/usePlayer";
import { useAuth } from "@/hooks/useAuth";
import { clearCloudHistory, mergeHistoryOnSignIn, updateCloudPosition, upsertCloudHistory } from "@/lib/history-sync";
import { cached, cacheGet, cacheSet, TTL } from "@/lib/cache";
import {
  channelData,
  playlistData,
  publicPlaylists,
  resolveChannel,
  searchYouTube,
  suggestYouTube,
  trendingShorts,
  videoMeta,
  type ChannelCard,
  type ChannelPage,
  type PlaylistItem,
  type SearchResult,
  type VideoMeta,
} from "@/lib/search.functions";
import {
  clearHistory,
  extractVideoId,
  fetchTrack,
  formatTime,
  loadHistory,
  loadQueue,
  loadSearches,
  pushHistory,
  pushSearch,
  removeSearch,
  clearSearches,
  saveQueue,
  timeAgo,
  updateHistoryPosition,
  type HistoryItem,
  type Track,
} from "@/lib/youtube";
import {
  type UserPlaylist,
  loadUserPlaylists,
  saveUserPlaylists,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  toggleTrackInPlaylist,
  removeTrackFromPlaylist,
} from "@/lib/playlists";
import {
  bumpTaste,
  emptyTaste,
  loadTaste,
  topTaste,
  recordVideoStart,
  recordVideoEngagement,
  calculateAlgorithmScore,
  diversifyVideoFeed,
  buildYouTubeCandidateQueries,
  type Taste,
} from "@/lib/taste";


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

// detect the kind of video (gazal, natok, news…) so related picks stay in the same genre
const GENRES: [RegExp, string][] = [
  [/গজল|gojol|ghazal|gazal|নাশিদ|nasheed/i, "গজল"],
  [/ওয়াজ|waz|তাফসির|খুতবা|islamic|ইসলামিক|কুরআন|quran/i, "ইসলামিক ওয়াজ"],
  [/নাটক|natok|drama|টেলিফিল্ম/i, "বাংলা নাটক"],
  [/খবর|সংবাদ|news|বুলেটিন|bulletin/i, "সংবাদ"],
  [/গান|song|music|lyrical|মিউজিক|audio/i, "গান"],
  [/podcast|পডকাস্ট|আড্ডা|interview|সাক্ষাৎকার/i, "পডকাস্ট"],
  [/রান্না|recipe|cooking|রেসিপি/i, "রান্নার রেসিপি"],
  [/vlog|ভ্লগ|travel|ভ্রমণ/i, "ভ্লগ"],
  [/funny|কমেডি|comedy|মজার|prank/i, "কমেডি"],
  [/খেলা|cricket|football|ক্রিকেট|ফুটবল|highlights|sports/i, "খেলার হাইলাইটস"],
  [/gaming|গেমিং|gameplay|free fire|pubg/i, "গেমিং"],
  [/cartoon|কার্টুন|animation|শিশু/i, "কার্টুন"],
  [/movie|সিনেমা|film|চলচ্চিত্র|trailer/i, "বাংলা সিনেমা"],
  [/শিক্ষা|class|lecture|tutorial|শেখা|পড়া/i, "শিক্ষামূলক"],
  [/প্রযুক্তি|tech|mobile|review|রিভিউ|gadget/i, "প্রযুক্তি রিভিউ"],
];
function genreOf(text: string) {
  for (const [re, name] of GENRES) if (re.test(text)) return name;
  return "";
}

const CHANNEL_TABS: { key: "videos" | "shorts" | "live" | "playlists" | "posts"; label: string }[] = [
  { key: "videos", label: "ভিডিও" },
  { key: "shorts", label: "শর্টস" },
  { key: "live", label: "লাইভ" },
  { key: "playlists", label: "প্লেলিস্ট" },
  { key: "posts", label: "স্টোরি/পোস্ট" },
];

const CATEGORIES: { label: string; q: string }[] = [
  { label: "হোম", q: "" },
  { label: "স্টোরি / শর্টস", q: "shorts" },
  { label: "পাবলিক প্লেলিস্ট", q: "playlists" },
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

const POPULAR_SEARCHES = ["বাংলা নাটক", "নতুন বাংলা গান", "ওয়াজ মাহফিল", "মুভি", "খবর লাইভ", "কার্টুন", "রান্না রেসিপি"];

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

// YouTube-style seek bar: buffered track, played track, draggable knob, time bubble
function SeekBar({ time, duration, loaded, onSeek, dark }: { time: number; duration: number; loaded: number; onSeek: (t: number) => void; dark?: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dur = duration || 0;
  const shown = drag ?? Math.min(time, dur);
  const pct = dur > 0 ? Math.min(100, (shown / dur) * 100) : 0;
  const buf = Math.max(pct, Math.min(100, (loaded || 0) * 100));

  const posFrom = (clientX: number) => {
    const el = barRef.current;
    if (!el || dur <= 0) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur;
  };

  return (
    <div className="select-none">
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="সিক"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={formatTime(shown)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); onSeek(Math.min(dur, time + 5)); }
          if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(Math.max(0, time - 5)); }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(posFrom(e.clientX));
        }}
        onPointerMove={(e) => { if (drag != null) setDrag(posFrom(e.clientX)); }}
        onPointerUp={(e) => {
          const t = drag ?? posFrom(e.clientX);
          setDrag(null);
          onSeek(t);
        }}
        onPointerCancel={() => setDrag(null)}
        className="group relative flex h-5 cursor-pointer touch-none items-center"
      >
        <span className={`relative block h-[5px] w-full overflow-hidden rounded-full ${dark ? "bg-background/30" : "bg-lilac/70"}`}>
          <span className={`absolute inset-y-0 left-0 rounded-full ${dark ? "bg-background/45" : "bg-primary/25"}`} style={{ width: `${buf}%` }} />
          <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </span>
        <span
          className={`pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-primary transition-transform ${drag != null ? "scale-125" : ""}`}
          style={{ left: `${pct}%` }}
        />
        {drag != null && (
          <span className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-lg bg-foreground px-2 py-1 font-display text-[11px] font-semibold text-background" style={{ left: `${pct}%` }}>
            {formatTime(drag)}
          </span>
        )}
      </div>
      <div className={`flex justify-between font-display text-[11.5px] font-semibold tabular-nums ${dark ? "text-background/90" : "text-muted-foreground"}`}>
        <span>{formatTime(shown)}</span>
        <span>{dur > 0 ? `-${formatTime(Math.max(0, dur - shown))}` : formatTime(0)}</span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <ul className="mt-3 space-y-3" aria-label="লোড হচ্ছে">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="glass flex animate-pulse items-center gap-3 rounded-3xl p-2.5 ring-1 ring-border">
          <span className="h-[88px] w-[156px] shrink-0 rounded-2xl bg-lilac/50" />
          <span className="flex-1 space-y-2">
            <span className="block h-4 w-4/5 rounded-full bg-lilac/50" />
            <span className="block h-3 w-1/2 rounded-full bg-lilac/40" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Avatar({ src, name, size = "size-9", text = "text-[13px]" }: { src?: string | undefined; name?: string | undefined; size?: string; text?: string }) {
  const initial = (name ?? "?").trim()[0]?.toUpperCase() ?? "?";
  if (src) return <img src={src} alt="" className={`${size} shrink-0 rounded-full bg-lilac/30 object-cover ring-2 ring-background/80 shadow-sm`} loading="lazy" referrerPolicy="no-referrer" />;
  return <span className={`grid ${size} shrink-0 place-items-center rounded-full bg-gradient-to-tr from-primary to-indigo-600 font-display ${text} font-bold text-primary-foreground shadow-sm`}>{initial}</span>;
}

function VideoRow({ r, active, playing, onPlay, onQueue, onChannel, sub, progress, compact }: { r: Row; active: boolean; playing: boolean; onPlay: () => void; onQueue?: () => void; onChannel?: () => void; sub?: string; progress?: number; compact?: boolean }) {
  const meta = sub ?? [r.author, r.views, r.published].filter(Boolean).join(" · ");

  if (compact) {
    return (
      <li className={`group relative flex items-center gap-2.5 rounded-2xl p-2 ring-1 transition-all duration-200 ${active ? "glass-card ring-2 ring-primary/80 bg-primary/10 shadow-sm" : "glass-card ring-border/70 hover:ring-primary/30 hover:bg-white/90"}`}>
        <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="relative shrink-0 overflow-hidden rounded-xl">
            <img src={r.thumbnail} alt="" className="h-[72px] w-[128px] object-cover transition-transform duration-300 group-hover:scale-105" loading="lazy" />
            {typeof r.duration === "string" && r.duration && (
              <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur-sm">
                {r.duration}
              </span>
            )}
            {progress != null && progress > 0.01 && (
              <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-white/30">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress * 100)}%` }} />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 font-display text-[13.5px] font-bold leading-snug text-foreground group-hover:text-primary transition-colors">{r.title}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{meta}</span>
          </span>
        </button>
        {active && playing ? (
          <span className="px-2 shrink-0"><Eq /></span>
        ) : onQueue ? (
          <button onClick={onQueue} aria-label="প্লেলিস্টে যোগ" title="প্লেলিস্টে যোগ" className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <li className={`group glass-card relative flex flex-col overflow-hidden rounded-3xl p-2.5 ring-1 transition-all duration-300 hover:shadow-xl hover:shadow-primary/8 ${active ? "ring-2 ring-primary/80 bg-primary/5 shadow-md shadow-primary/15" : "ring-border/80 hover:ring-primary/40 hover:-translate-y-0.5"}`}>
      <button onClick={onPlay} className="relative block w-full text-left">
        <span className="relative block aspect-video w-full overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-border/50">
          <img src={r.thumbnail} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" />
          {/* Hover play overlay */}
          <span className="absolute inset-0 grid place-items-center bg-black/25 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <span className="grid size-12 place-items-center rounded-full bg-gradient-to-tr from-primary to-indigo-600 text-white shadow-lg shadow-black/40 transition-transform duration-300 group-hover:scale-105">
              <PlayIcon playing={active && playing} />
            </span>
          </span>
          {typeof r.duration === "string" && r.duration && (
            <span className="absolute right-2 bottom-2 rounded-lg bg-black/85 backdrop-blur-md px-2 py-0.5 text-[11px] font-semibold text-white tracking-wide shadow-sm">
              {r.duration}
            </span>
          )}
          {progress != null && progress > 0.01 && (
            <span className="absolute inset-x-2 bottom-1.5 h-1 overflow-hidden rounded-full bg-white/30 backdrop-blur-sm">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </span>
          )}
        </span>
      </button>

      <div className="flex items-start gap-3 px-1 pt-3 pb-1">
        {onChannel ? (
          <button onClick={onChannel} aria-label={`${r.author} চ্যানেল দেখুন`} className="shrink-0 transition active:scale-95 hover:opacity-85">
            <Avatar src={r.channelThumb} name={r.author} size="size-9" />
          </button>
        ) : (
          <Avatar src={r.channelThumb} name={r.author} size="size-9" />
        )}
        <span className="min-w-0 flex-1">
          <button onClick={onPlay} className="block w-full text-left">
            <span className="line-clamp-2 font-display text-[14.5px] font-bold leading-snug text-foreground group-hover:text-primary transition-colors">{r.title}</span>
          </button>
          {onChannel ? (
            <button onClick={onChannel} className="mt-1 block max-w-full truncate text-left text-[12px] font-medium text-muted-foreground hover:text-foreground hover:underline transition-colors">{meta}</button>
          ) : (
            <span className="mt-1 block truncate text-[12px] font-medium text-muted-foreground">{meta}</span>
          )}
        </span>
        {active && playing ? (
          <span className="pt-1.5 shrink-0"><Eq /></span>
        ) : onQueue ? (
          <button
            onClick={onQueue}
            aria-label="প্লেলিস্টে যোগ"
            title="প্লেলিস্টে যোগ"
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-all active:scale-90"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        ) : null}
      </div>
    </li>
  );
}


function Index() {
  const [queue, setQueue] = useState<Track[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [taste, setTaste] = useState<Taste>(() => emptyTaste());
  const tasteObjRef = useRef(taste);
  tasteObjRef.current = taste;
  const bump = useCallback((kind: "genres" | "channels" | "terms", key: string, w = 1) => {
    setTaste((t) => bumpTaste(t, kind, key, w));
  }, []);

  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"playlists" | "history">("history");
  const [userPlaylists, setUserPlaylists] = useState<UserPlaylist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [saveModalTrack, setSaveModalTrack] = useState<Track | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [showNewPlaylistInput, setShowNewPlaylistInput] = useState(false);
  const [showProfileNewPl, setShowProfileNewPl] = useState(false);
  const [profileNewPlTitle, setProfileNewPlTitle] = useState("");
  const [editingPlId, setEditingPlId] = useState<string | null>(null);
  const [editPlTitle, setEditPlTitle] = useState("");
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
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [lastQuery, setLastQuery] = useState("");
  const [category, setCategory] = useState<string | null>("");
  const [channel, setChannel] = useState<string | null>(null);
  const [chan, setChan] = useState<ChannelPage | null>(null);
  const [chanState, setChanState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [chanTab, setChanTab] = useState<"videos" | "shorts" | "live" | "playlists" | "posts">("videos");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [searchChannel, setSearchChannel] = useState<ChannelCard | undefined>(undefined);
  const [searchContinuationToken, setSearchContinuationToken] = useState<string | undefined>(undefined);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [related, setRelated] = useState<SearchResult[]>([]);
  const [relatedState, setRelatedState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [relatedTick, setRelatedTick] = useState(0);
  const [relatedMore, setRelatedMore] = useState(false);
  const relQueriesRef = useRef<string[]>([]);
  const relSeenRef = useRef<Set<string>>(new Set());
  const relSentinelRef = useRef<HTMLDivElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const endedRef = useRef<() => boolean>(() => false);
  const player = usePlayer(queue, PLAYER_ID, () => endedRef.current());
  const search = Route.useSearch();
  const navigate = useNavigate();
  const runSearch = useServerFn(searchYouTube);
  const runSuggest = useServerFn(suggestYouTube);
  const runChannel = useServerFn(channelData);
  const runPlaylist = useServerFn(playlistData);
  const runResolveChannel = useServerFn(resolveChannel);
  const runVideoMeta = useServerFn(videoMeta);
  const runPublicPlaylists = useServerFn(publicPlaylists);
  const runTrendingShorts = useServerFn(trendingShorts);
  const [homeShorts, setHomeShorts] = useState<SearchResult[]>([]);
  const [homePlaylists, setHomePlaylists] = useState<PlaylistItem[]>([]);
  const [publicPlaylistsList, setPublicPlaylistsList] = useState<PlaylistItem[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [playlistsExpanded, setPlaylistsExpanded] = useState(false);
  const [searches, setSearches] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const isInteractingWithSugRef = useRef(false);

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
    async (q: string, bypassCache = false): Promise<SearchResult[] | null> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (bypassCache) {
            const res = await runSearch({ data: { q } });
            if (res.ok) return res.results;
          } else {
            const res = await cached(`search:${q}`, TTL.search, () => runSearch({ data: { q } }), (r) => r.ok);
            if (res.ok) return res.results;
          }
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
  const [pipMin, setPipMin] = useState(false);
  const [pipPos, setPipPos] = useState<{ left: number; top: number } | null>(null);
  const pipPrefLoaded = useRef(false);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const [pipDragging, setPipDragging] = useState(false);
  const playerMode: "big" | "watch" | "pip" | "hidden" = bigVideo ? "big" : open ? "watch" : current && !pipDismissed ? "pip" : "hidden";
  const pipW = pipMin ? 116 : 190;
  const pipH = pipMin ? 44 : 107;

  // keep the pop-up inside the screen (rotation / keyboard / resize)
  const clampPip = useCallback(
    (left: number, top: number) => {
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      return {
        left: Math.min(Math.max(8, left), Math.max(8, vw - pipW - 8)),
        top: Math.min(Math.max(8, top), Math.max(8, vh - pipH - 8)),
      };
    },
    [pipW, pipH],
  );

  // remember the pop-up's last place and size between sessions
  useEffect(() => {
    if (typeof window === "undefined" || pipPrefLoaded.current) return;
    pipPrefLoaded.current = true;
    try {
      const raw = localStorage.getItem("echo.pip");
      if (!raw) return;
      const p = JSON.parse(raw) as { xr?: number; yr?: number; min?: boolean };
      if (typeof p.min === "boolean") setPipMin(p.min);
      if (typeof p.xr === "number" && typeof p.yr === "number") {
        const vw = window.visualViewport?.width ?? window.innerWidth;
        const vh = window.visualViewport?.height ?? window.innerHeight;
        setPipPos({ left: p.xr * vw, top: p.yr * vh });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !pipPrefLoaded.current) return;
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    try {
      localStorage.setItem(
        "echo.pip",
        JSON.stringify(pipPos ? { xr: pipPos.left / vw, yr: pipPos.top / vh, min: pipMin } : { min: pipMin }),
      );
    } catch {
      /* ignore */
    }
  }, [pipPos, pipMin]);

  useEffect(() => {
    if (playerMode !== "pip" || typeof window === "undefined") return;
    setPipPos((p) => {
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      return clampPip(p?.left ?? vw - pipW - 12, p?.top ?? vh - pipH - 88);
    });
    const onResize = () => setPipPos((p) => (p ? clampPip(p.left, p.top) : p));
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [playerMode, clampPip, pipW, pipH]);


  const pipDragStart = (e: RPointerEvent) => {
    if (!pipPos) return;
    if ((e.target as HTMLElement).closest("button")) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = { dx: e.clientX - pipPos.left, dy: e.clientY - pipPos.top, moved: false };
    setPipDragging(true);
  };
  const pipDragMove = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.moved = true;
    setPipPos(clampPip(e.clientX - d.dx, e.clientY - d.dy));
  };
  const pipDragEnd = () => {
    const moved = dragRef.current?.moved ?? false;
    dragRef.current = null;
    setPipDragging(false);
    return moved;
  };

  const closePipVideo = useCallback(() => {
    player.stop();
    setPipDismissed(true);
    setPipMin(false);
    if (open) closeWatch();
  }, [player, open]);

  // ---- floating window that stays on top of other apps (where the browser supports it) ----
  const playerBoxRef = useRef<HTMLDivElement>(null);
  const [docPip, setDocPip] = useState(false);
  const docPipWinRef = useRef<Window | null>(null);
  const openDocPip = useCallback(async (silent = false) => {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window?: Window | null } }).documentPictureInPicture;
    const box = playerBoxRef.current;
    if (docPipWinRef.current && !docPipWinRef.current.closed) return;
    if (!dpip || !box) {
      if (!silent) flash("এই ফোনের ব্রাউজার অ্যাপের বাইরে ভাসমান ভিডিও দেখায় না — শব্দ চলতে থাকবে");
      return;
    }
    try {
      const w = await dpip.requestWindow({ width: 400, height: 225 });
      docPipWinRef.current = w;
      w.document.body.style.cssText = "margin:0;background:#000;overflow:hidden";
      w.document.body.append(box);
      setDocPip(true);
      const back = () => {
        document.body.append(box);
        docPipWinRef.current = null;
        setDocPip(false);
      };
      w.addEventListener("pagehide", back);
      w.addEventListener("unload", back);
    } catch {
      if (!silent) flash("ভাসমান উইন্ডো খোলা যায়নি");
    }
  }, []);

  // leaving the app while a video plays: float it automatically, no button press needed
  useEffect(() => {
    if (!playing) return;
    const tryFloat = () => { void openDocPip(true); };
    window.addEventListener("blur", tryFloat);
    window.addEventListener("pagehide", tryFloat);
    const onHide = () => { if (document.visibilityState === "hidden") tryFloat(); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("blur", tryFloat);
      window.removeEventListener("pagehide", tryFloat);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [playing, openDocPip]);

  // playing in the background: bring the pop-up player back on screen when the user returns
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && playing) {
        setPipDismissed(false);
      }

    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [playing]);

  // where the player docks on the watch page — the sheet slides for 500ms, so measure again once it settles
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = slotRef.current;
      if (!el) return;
      // use layout geometry (offset*) so the sheet's opening transform can't distort the box
      let left = 0;
      let top = 0;
      let node: HTMLElement | null = el;
      while (node) {
        left += node.offsetLeft;
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      const vw = window.visualViewport?.width ?? window.innerWidth;
      const width = Math.min(el.offsetWidth, vw - left * 2);
      setSlotRect({ top, left, width, height: Math.round((width * 9) / 16) });
    };
    measure();
    const t = setTimeout(measure, 550);
    const ro = new ResizeObserver(measure);
    if (slotRef.current) ro.observe(slotRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [open, hydrated]);

  useEffect(() => { setPipDismissed(false); setPipMin(false); }, [current?.id, open]);
  const feedSeen = useRef<Set<string>>(new Set());
  const previousFeedChannels = useRef<Set<string>>(new Set());
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const feedDone = feedPage.current >= feedOrder.current.length && feedOrder.current.length > 0;
  const sentinel = useRef<HTMLDivElement>(null);

  const loadFeedPage = useCallback(
    async (reset: boolean) => {
      if (reset) {
        // Collect channels from current top results to cool them down during this refresh
        const cooling = new Set(
          resultsRef.current.slice(0, 10).map((r) => (r.author?.trim() || "").toLowerCase()).filter(Boolean),
        );
        previousFeedChannels.current = cooling;

        // YouTube-style Candidate Generation: Multi-shelf candidate mix
        const queries = buildYouTubeCandidateQueries(tasteObjRef.current, history, CATEGORIES);
        feedOrder.current = queries;

        feedPage.current = 0;
        feedSeen.current = new Set();
        setResults([]);
        setSearchState("loading");
      } else {
        if (feedLoadingMore || feedPage.current >= feedOrder.current.length) return;
        setFeedLoadingMore(true);
      }
      const take = reset ? 4 : 2;
      const qs = feedOrder.current.slice(feedPage.current, feedPage.current + take);
      feedPage.current += take;
      const batches = await Promise.all(qs.map((q) => fetchWithRetry(q, reset)));
      const fresh: SearchResult[] = [];
      const channelFeedCount: Record<string, number> = {};

      // On reset, enforce strict max 1 video per channel so every card is from a unique creator
      const channelLimit = reset ? 1 : 2;
      const max = Math.max(0, ...batches.map((b) => b?.length ?? 0));
      for (let i = 0; i < max; i++) {
        for (const b of batches) {
          const r = b?.[i];
          if (r && !feedSeen.current.has(r.id)) {
            const author = (r.author?.trim() || "unknown").toLowerCase();
            const count = channelFeedCount[author] ?? 0;
            if (count < channelLimit) {
              channelFeedCount[author] = count + 1;
              feedSeen.current.add(r.id);
              fresh.push(r);
            }
          }
        }
      }

      // rank the mix using YouTube Multi-factor Scoring with Channel Frequency & Fatigue Penalty
      const t = tasteObjRef.current;
      const channelCounts: Record<string, number> = {};
      const seenIds = new Set(history.map((h) => h.id));
      const ranked = fresh
        .map((r, i) => {
          const author = r.author?.trim() || "";
          const occurrences = channelCounts[author] ?? 0;
          const genre = genreOf(`${r.title} ${r.author ?? ""}`);
          const score = calculateAlgorithmScore(t, r, {
            genre,
            channelOccurrencesInFeed: occurrences,
            seenVideoIds: seenIds,
            coolingChannels: previousFeedChannels.current,
          });
          channelCounts[author] = occurrences + 1;
          return { r, i, s: score };
        })
        .sort((a, b) => (b.s === a.s ? a.i - b.i : b.s - a.s))
        .map((x) => x.r);

      const diversified = diversifyVideoFeed(ranked, reset ? 1 : 2);

      if (reset) {
        if (batches.every((b) => b === null)) {
          setSearchState("error");
        } else {
          setResults(diversified);
          setSearchState("ok");
        }
      } else {
        setResults((prev) => [...prev, ...diversified]);
        setFeedLoadingMore(false);
      }
    },
    [fetchWithRetry, feedLoadingMore, history],
  );


  const SHORTS_ROTATION = [
    "bangla viral shorts trending",
    "bangla funny comedy shorts reels",
    "viral reels shorts bangladesh",
    "bangla natok emotional clip shorts",
    "trending viral music shorts bangla",
    "popular funny shorts 2026",
    "islamic viral shorts bangla",
  ];

  const PLAYLIST_ROTATION = [
    "bangla popular playlist songs natok",
    "bangla hit songs all time playlist",
    "bangladesh best drama series playlist",
    "top bengali music album playlist",
    "bangla romantic songs hits playlist",
    "islamic gazal nasheed playlist bangla",
    "bangla acoustic unplugged playlist",
  ];

  const shortsIndexRef = useRef(Math.floor(Math.random() * 7));
  const plIndexRef = useRef(Math.floor(Math.random() * 7));

  const loadHomeExtras = useCallback(
    async (force = false) => {
      try {
        if (force) {
          shortsIndexRef.current = (shortsIndexRef.current + 1) % SHORTS_ROTATION.length;
          plIndexRef.current = (plIndexRef.current + 1) % PLAYLIST_ROTATION.length;
        }
        const shortsQuery = SHORTS_ROTATION[shortsIndexRef.current];
        const plQuery = PLAYLIST_ROTATION[plIndexRef.current];

        const fetchShorts = async () => {
          if (!force) {
            const hit = cacheGet<{ ok: boolean; shorts: SearchResult[] }>(`home:shorts:${shortsQuery}`);
            if (hit?.ok && hit.shorts?.length) return hit;
          }
          const res = await runTrendingShorts({ data: { q: shortsQuery } });
          if (res.ok && res.shorts.length > 0) {
            cacheSet(`home:shorts:${shortsQuery}`, res, TTL.search);
          }
          return res;
        };

        const fetchPlaylists = async () => {
          if (!force) {
            const hit = cacheGet<{ ok: boolean; playlists: PlaylistItem[] }>(`home:playlists:${plQuery}`);
            if (hit?.ok && hit.playlists?.length) return hit;
          }
          const res = await runPublicPlaylists({ data: { q: plQuery } });
          if (res.ok && res.playlists.length > 0) {
            cacheSet(`home:playlists:${plQuery}`, res, TTL.search);
          }
          return res;
        };

        const [shortsRes, plRes] = await Promise.all([fetchShorts(), fetchPlaylists()]);
        if (shortsRes?.ok && shortsRes.shorts?.length) {
          const shuffled = [...shortsRes.shorts].sort(() => Math.random() - 0.5);
          setHomeShorts(shuffled);
        }
        if (plRes?.ok && plRes.playlists?.length) {
          const shuffledPl = [...plRes.playlists].sort(() => Math.random() - 0.5);
          setHomePlaylists(shuffledPl);
        }
      } catch {
        /* ignore */
      }
    },
    [runTrendingShorts, runPublicPlaylists],
  );

  const doSearch = useCallback(
    async (q: string) => {
      const term = q.trim();
      setLastQuery(term);
      setSearchChannel(undefined);
      setSearchContinuationToken(undefined);
      setPublicPlaylistsList([]);
      if (!term) {
        await loadFeedPage(true);
        void loadHomeExtras(true);
        return;
      }
      feedOrder.current = [];
      setSearchState("loading");

      if (term === "shorts") {
        try {
          const qStr = SHORTS_ROTATION[Math.floor(Math.random() * SHORTS_ROTATION.length)];
          const res = await runTrendingShorts({ data: { q: qStr } });
          if (res.ok && res.shorts.length > 0) {
            setResults(res.shorts);
            setSearchState("ok");
          } else {
            setResults([]);
            setSearchState("error");
          }
        } catch {
          setResults([]);
          setSearchState("error");
        }
        return;
      }

      if (term === "playlists") {
        try {
          const qStr = PLAYLIST_ROTATION[Math.floor(Math.random() * PLAYLIST_ROTATION.length)];
          const res = await runPublicPlaylists({ data: { q: qStr } });
          if (res.ok && res.playlists.length > 0) {
            setPublicPlaylistsList(res.playlists);
            setResults([]);
            setSearchState("ok");
          } else {
            setPublicPlaylistsList([]);
            setSearchState("error");
          }
        } catch {
          setPublicPlaylistsList([]);
          setSearchState("error");
        }
        return;
      }

      try {
        const res = await cached(`search:v3:${term}`, TTL.search, () => runSearch({ data: { q: term } }), (r) => r.ok);
        if (res.ok) {
          setResults(res.results);
          setSearchChannel(res.channel);
          setSearchContinuationToken(res.continuationToken);
          setSearchState("ok");
        } else {
          setResults([]);
          setSearchState("error");
        }
      } catch {
        setResults([]);
        setSearchState("error");
      }
    },
    [loadFeedPage, loadHomeExtras, runSearch, runTrendingShorts, runPublicPlaylists],
  );

  const loadMoreSearchResults = useCallback(async () => {
    if (!searchContinuationToken || searchLoadingMore) return;
    setSearchLoadingMore(true);
    try {
      const res = await runSearch({ data: { token: searchContinuationToken } });
      if (res.ok && res.results.length > 0) {
        const seenIds = new Set(resultsRef.current.map((r) => r.id));
        const fresh = res.results.filter((r) => !seenIds.has(r.id));
        setResults((prev) => [...prev, ...fresh]);
        setSearchContinuationToken(res.continuationToken);
      } else {
        setSearchContinuationToken(undefined);
      }
    } catch {
      setSearchContinuationToken(undefined);
    } finally {
      setSearchLoadingMore(false);
    }
  }, [searchContinuationToken, searchLoadingMore, runSearch]);

  // run a search term from the box / a suggestion / a saved search — and remember it
  const runTerm = useCallback(
    (q: string) => {
      const term = q.trim();
      if (!term) return;
      setInput(term);
      setSugOpen(false);
      setSuggestions([]);
      setCategory(null);
      setChannel(null);
      setSearches(pushSearch(term));
      bump("terms", term, 1);
      void doSearch(term);
    },
    [doSearch, bump],
  );


  // live suggestions while typing (debounced)
  useEffect(() => {
    const q = input.trim();
    if (!sugOpen || !q || extractVideoId(q)) { setSuggestions([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const list = await cached(`sug:${q}`, TTL.suggest, () => runSuggest({ data: { q } }), (l) => l.length > 0);
        if (!cancelled) setSuggestions(list);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [input, sugOpen, runSuggest]);



  // ---- taste profile: what genres/channels this person actually watches ----
  const tasteRef = useRef<string[]>([]);
  useEffect(() => {
    const genreScore = new Map<string, number>();
    const chanScore = new Map<string, number>();
    // long-lived profile (survives app restarts, decays over weeks)
    for (const [g, v] of Object.entries(taste.genres)) genreScore.set(g, v * 10);
    for (const [c, v] of Object.entries(taste.channels)) chanScore.set(c, v * 10);
    history.slice(0, 30).forEach((h, i) => {
      const w = 30 - i;
      const g = genreOf(`${h.title} ${h.author ?? ""}`);
      if (g) genreScore.set(g, (genreScore.get(g) ?? 0) + w);
      if (h.author) chanScore.set(h.author, (chanScore.get(h.author) ?? 0) + w);
    });
    const top = (m: Map<string, number>, n: number) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
    tasteRef.current = [
      ...top(genreScore, 3).map((g) => `${g} নতুন ভিডিও`),
      ...top(chanScore, 2).map((c) => `${c} ভিডিও`),
      ...topTaste(taste.terms, 2),
    ];
  }, [history, taste]);


  useEffect(() => {
    if (!hydrated) return;
    doSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);


  // infinite scroll for the home feed
  const isHome = lastQuery.trim().length === 0;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || searchState !== "ok") return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      if (isHome) {
        loadFeedPage(false);
      } else if (searchContinuationToken) {
        void loadMoreSearchResults();
      }
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [isHome, searchState, searchContinuationToken, loadFeedPage, loadMoreSearchResults]);

  // ---- persistence ----
  useEffect(() => {
    setQueue(loadQueue());
    setHistory(loadHistory());
    setTaste(loadTaste());

    setSearches(loadSearches());
    setUserPlaylists(loadUserPlaylists());
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
  const liveRef = useRef<{ id: string; time: number; duration: number } | null>(null);
  liveRef.current = current ? { id: current.id, time, duration } : liveRef.current;
  const prevIdRef = useRef<string | null>(null);
  const prevTrackRef = useRef<Track | null>(null);
  useEffect(() => {
    if (!current) return;
    // flush the outgoing video's progress before switching (swipe / next / zoom exit)
    const prev = prevIdRef.current;
    const prevTrack = prevTrackRef.current;
    const live = liveRef.current;
    if (prev && prev !== current.id && live && live.id === prev && live.duration) {
      updateHistoryPosition(prev, live.time, live.duration);
      if (userId) {
        const item = loadHistory().find((h) => h.id === prev);
        if (item) updateCloudPosition(userId, prev, item.position, item.duration);
      }
      // YouTube Retention Algorithm: Record engagement on outgoing track (skip penalty vs watch completion)
      const prevGenre = genreOf(`${prevTrack?.title ?? ""} ${prevTrack?.author ?? ""}`);
      setTaste((t) =>
        recordVideoEngagement(t, {
          videoId: prev,
          author: prevTrack?.author,
          genre: prevGenre,
          watchedSeconds: live.time,
          totalDuration: live.duration,
        }),
      );
    }
    prevIdRef.current = current.id;
    prevTrackRef.current = current;
    lastSaved.current = 0;
    const next = pushHistory(current);
    setHistory(next);
    const item = next.find((h) => h.id === current.id);
    if (userId && item) upsertCloudHistory(userId, item);

    // YouTube Candidate Algorithm: Register video play start (repeat listen, channel recency)
    const g = genreOf(`${current.title} ${current.author ?? ""}`);
    setTaste((t) => recordVideoStart(t, { id: current.id, author: current.author, genre: g }));
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // watched more than half → a much stronger signal than just opening it
  const deepRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!current || !duration || time / duration < 0.5) return;
    if (deepRef.current.has(current.id)) return;
    deepRef.current.add(current.id);
    const g = genreOf(`${current.title} ${current.author ?? ""}`);
    setTaste((t) =>
      recordVideoEngagement(t, {
        videoId: current.id,
        author: current.author,
        genre: g,
        watchedSeconds: time,
        totalDuration: duration,
      }),
    );
  }, [time, duration, current]);

  const lastSaved = useRef(0);
  useEffect(() => {
    if (!current || !duration) return;
    if (Math.abs(time - lastSaved.current) < 5) return;
    lastSaved.current = time;
    updateHistoryPosition(current.id, time, duration);
    setHistory(loadHistory());
    if (userId) {
      const item = loadHistory().find((h) => h.id === current.id);
      if (item) updateCloudPosition(userId, current.id, item.position, item.duration);
    }
  }, [time, duration, current, userId]);

  // watched progress per video, kept fresh across feed/related switches
  const progressOf = useCallback(
    (id: string) => {
      if (current?.id === id && duration) return time / duration;
      const h = history.find((x) => x.id === id);
      return h && h.duration ? h.position / h.duration : 0;
    },
    [history, current?.id, time, duration],
  );
  const savedPosOf = useCallback((id: string) => history.find((x) => x.id === id)?.position ?? 0, [history]);


  // ---- watch page (?v=ID) ----
  const openWatch = (id: string) => navigate({ to: "/", search: { v: id } });
  const closeWatch = () => navigate({ to: "/", search: {}, replace: true });

  // open a channel: show that channel's videos on the home list
  const chanIdRef = useRef<string | null>(null);
  const loadChannel = useCallback(
    async (id: string, tab: typeof chanTab) => {
      setChanState("loading");
      try {
        const res = await cached(`chan:${id}:${tab}`, TTL.channel, () => runChannel({ data: { id, tab } }), (r) => r.ok);
        if (chanIdRef.current !== id) return;
        if (res.ok) {
          setChan(res.channel);
          setChanState("ok");
        } else setChanState("error");
      } catch {
        setChanState("error");
      }
    },
    [runChannel],
  );

  const openChannel = (name?: string, channelId?: string) => {
    const n = (name ?? "").trim();
    if (!n && !channelId) return;
    if (open) closeWatch();
    setProfileOpen(false);
    setCategory(null);
    setChannel(n || channelId!);
    setInput("");
    setSugOpen(false);
    setChanTab("videos");
    setChan(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    void (async () => {
      let id = channelId ?? null;
      setChanState("loading");
      if (!id) {
        try {
          id = await cached(`chanid:${n}`, TTL.channel, () => runResolveChannel({ data: { name: n } }), (v) => !!v);
        } catch {
          id = null;
        }
      }
      chanIdRef.current = id;
      if (id) void loadChannel(id, "videos");
      else {
        setChanState("idle");
        void doSearch(`${n} ভিডিও`);
      }
    })();
  };

  const openChannelTab = (tab: typeof chanTab) => {
    setChanTab(tab);
    if (chanIdRef.current) void loadChannel(chanIdRef.current, tab);
  };

  const backHome = () => {
    setChannel(null);
    setChan(null);
    setChanState("idle");
    chanIdRef.current = null;
    setCategory("");
    setInput("");
    setSearchChannel(undefined);
    setSearchContinuationToken(undefined);
    doSearch("");
  };

  const openPlaylist = async (id: string, title: string) => {
    flash(`${title} — লোড হচ্ছে…`);
    try {
      const res = await cached(`pl:${id}`, TTL.playlist, () => runPlaylist({ data: { id } }), (r) => r.ok);
      if (!res.ok || res.videos.length === 0) return flash("প্লেলিস্ট আনা যায়নি");
      const list = res.videos.map((v) => ({ id: v.id, title: v.title, author: v.author, thumbnail: v.thumbnail }));
      setQueue(list);
      saveQueue(list);
      setTimeout(() => player.playAt(0), 80);
      openWatch(list[0]!.id);
    } catch {
      flash("প্লেলিস্ট আনা যায়নি");
    }
  };

  const playTrack = useCallback(
    (track: Track, startAt = 0) => {
      const q = loadQueue();
      const idx = q.findIndex((t) => t.id === track.id);
      if (idx !== -1) {
        player.playAt(idx, startAt);
      } else {
        player.playDirect(track, startAt);
      }
      openWatch(track.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player.playAt, player.playDirect],
  );

  // "up next" = the next queued video, else the first related one
  const queuedNext = player.index !== null ? queue[player.index + 1] ?? null : null;
  const nextUp: Track | null =
    queuedNext ??
    related.find((r) => r.id !== current?.id && !queue.some((t) => t.id === r.id)) ??
    results.find((r) => r.id !== current?.id && !queue.some((t) => t.id === r.id)) ??
    null;
  const playUpNext = useCallback(() => {
    if (!nextUp) return false;
    playTrack(nextUp, savedPosOf(nextUp.id));
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextUp?.id, playTrack, savedPosOf]);
  // when a video finishes, record full completion retention & auto-play the related "up next" one
  endedRef.current = () => {
    if (current && duration) {
      const g = genreOf(`${current.title} ${current.author ?? ""}`);
      setTaste((t) =>
        recordVideoEngagement(t, {
          videoId: current.id,
          author: current.author,
          genre: g,
          watchedSeconds: duration,
          totalDuration: duration,
        }),
      );
    }
    return queuedNext ? false : playUpNext();
  };


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

  // upload date, view count, channel avatar for the video being watched
  useEffect(() => {
    if (!current?.id) return;
    let cancelled = false;
    const fromList =
      results.find((r) => r.id === current.id) ?? related.find((r) => r.id === current.id) ?? null;
    const seed: VideoMeta = {};
    if (fromList?.published) seed.publishedAgo = fromList.published;
    if (fromList?.views) seed.views = fromList.views;
    if (fromList?.channelThumb) seed.channelThumb = fromList.channelThumb;
    if (fromList?.channelId) seed.channelId = fromList.channelId;
    setMeta(fromList ? seed : null);
    (async () => {
      try {
        const m = await cached(`meta:${current.id}`, TTL.meta, () => runVideoMeta({ data: { id: current.id } }), (x) => !!x && Object.keys(x).length > 0);
        if (cancelled) return;
        setMeta((prev) => ({ ...(prev ?? {}), ...m }));
      } catch {
        /* keep list metadata */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // related videos for the watch page — same genre/topic first, then more of the same kind
  useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    setRelatedState("loading");
    const cleanTitle = current.title.replace(/[|(\[\]•·].*$/, "").replace(/\d{4}/g, "").trim();
    const topicWords = cleanTitle.split(/\s+/).slice(0, 5).join(" ");
    const author = current.author?.trim();
    const genre = genreOf(`${current.title} ${author}`);
    const queries = [
      author ? `${author} ${topicWords}` : topicWords,
      topicWords,
      author ? `${author} video` : `${genre} ${topicWords}`,
      genre ? `${genre} নতুন` : `${topicWords} new`,
    ].filter((q) => q && q.trim().length > 1);
    relQueriesRef.current = queries.slice(2);
    relSeenRef.current = new Set<string>([current.id]);
    (async () => {
      const seen = relSeenRef.current;
      const list: SearchResult[] = [];
      for (const q of queries.slice(0, 3)) {
        if (cancelled) return;
        try {
          const res = await cached(`search:${q}`, TTL.search, () => runSearch({ data: { q } }), (r) => r.ok);
          if (res.ok) {
            for (const r of res.results) {
              if (seen.has(r.id)) continue;
              seen.add(r.id);
              list.push(r);
            }
          }
        } catch {
          /* try next */
        }
        if (list.length >= 12) break;
      }
      if (cancelled) return;
      if (list.length > 0) {
        const t = tasteObjRef.current;
        const currentGenre = genreOf(`${current.title} ${current.author ?? ""}`);
        const rankedRelated = list
          .map((r, i) => ({
            r,
            i,
            s: calculateAlgorithmScore(t, r, {
              genre: genreOf(`${r.title} ${r.author ?? ""}`),
              currentPlayingAuthor: current.author,
              currentPlayingGenre: currentGenre,
            }),
          }))
          .sort((a, b) => (b.s === a.s ? a.i - b.i : b.s - a.s))
          .map((x) => x.r);

        const diversifiedRelated = diversifyVideoFeed(rankedRelated);
        setRelated(diversifiedRelated);
        setRelatedState("ok");
      } else setRelatedState("error");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current?.id, relatedTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-load more related videos when the list bottom comes into view
  const loadMoreRelated = useCallback(async () => {
    if (relatedMore || relQueriesRef.current.length === 0) return;
    setRelatedMore(true);
    try {
      const q = relQueriesRef.current.shift()!;
      const res = await cached(`search:${q}`, TTL.search, () => runSearch({ data: { q } }), (r) => r.ok);
      if (res.ok) {
        const seen = relSeenRef.current;
        const add: SearchResult[] = [];
        for (const r of res.results) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          add.push(r);
        }
        if (add.length) setRelated((prev) => [...prev, ...add]);
      }
    } catch {
      /* ignore, next scroll tries the next query */
    }
    setRelatedMore(false);
  }, [relatedMore]);

  useEffect(() => {
    const el = relSentinelRef.current;
    if (!el || relatedState !== "ok") return;
    const io = new IntersectionObserver((es) => {
      if (es[0]?.isIntersecting) void loadMoreRelated();
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [relatedState, loadMoreRelated, related.length]);




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
      runTerm(q);
      return;
    }
    setSugOpen(false);

    setBusy(true);
    const track = await fetchTrack(id);
    setBusy(false);
    setInput("");
    playTrack(track);
  }

  const openSaveModal = useCallback((t: Track) => {
    setSaveModalTrack(t);
    setShowNewPlaylistInput(false);
    setNewPlaylistName("");
  }, []);

  function addToQueue(t: Track) {
    openSaveModal(t);
  }

  const handleCreateFromModal = () => {
    const title = newPlaylistName.trim();
    if (!title || !saveModalTrack) return;
    const newPl = createPlaylist(title, saveModalTrack);
    const updated = loadUserPlaylists();
    setUserPlaylists(updated);
    setNewPlaylistName("");
    setShowNewPlaylistInput(false);
    flash(`"${newPl.title}" প্লেলিস্টে সেভ হয়েছে`);
  };

  const handleToggleInPlaylist = (playlistId: string) => {
    if (!saveModalTrack) return;
    const res = toggleTrackInPlaylist(playlistId, saveModalTrack);
    setUserPlaylists(res.playlists);
    flash(res.added ? `"${res.playlistTitle}"-এ যোগ হয়েছে` : `"${res.playlistTitle}" থেকে সরানো হয়েছে`);
  };

  const handleCreateFromProfile = () => {
    const title = profileNewPlTitle.trim();
    if (!title) return;
    const newPl = createPlaylist(title);
    setUserPlaylists(loadUserPlaylists());
    setProfileNewPlTitle("");
    setShowProfileNewPl(false);
    setActivePlaylistId(newPl.id);
    flash(`"${newPl.title}" প্লেলিস্ট তৈরি হয়েছে`);
  };

  const handleDeletePlaylist = (playlistId: string, title: string) => {
    if (typeof window !== "undefined" && !window.confirm(`আপনি কি নিশ্চিত যে "${title}" প্লেলিস্টটি মুছে ফেলতে চান?`)) return;
    const updated = deletePlaylist(playlistId);
    setUserPlaylists(updated);
    if (activePlaylistId === playlistId) setActivePlaylistId(null);
    flash(`"${title}" প্লেলিস্ট মুছে ফেলা হয়েছে`);
  };

  const handleRenamePlaylist = (playlistId: string) => {
    const title = editPlTitle.trim();
    if (!title) return;
    const updated = renamePlaylist(playlistId, title);
    setUserPlaylists(updated);
    setEditingPlId(null);
    flash("প্লেলিস্টের নাম পরিবর্তন হয়েছে");
  };

  const handleRemoveVideoFromPlaylist = (playlistId: string, videoId: string) => {
    const updated = removeTrackFromPlaylist(playlistId, videoId);
    setUserPlaylists(updated);
    flash("ভিডিওটি প্লেলিস্ট থেকে সরানো হয়েছে");
  };

  const playUserPlaylist = (playlist: UserPlaylist, startIndex = 0) => {
    if (playlist.videos.length === 0) {
      flash("এই প্লেলিস্টে কোনো ভিডিও নেই");
      return;
    }
    setQueue(playlist.videos);
    saveQueue(playlist.videos);
    player.playAt(startIndex);
    setProfileOpen(false);
    openWatch(playlist.videos[startIndex]!.id);
    flash(`"${playlist.title}" প্লেলিস্ট চলছে`);
  };

  function remove(i: number) {
    setQueue((q) => q.filter((_, k) => k !== i));
    if (player.index !== null && i < player.index) player.setIndex(player.index - 1);
    else if (player.index === i) player.setIndex(null);
  }

  const resume = history.find((h) => h.position > 10 && (!playing || h.id !== current?.id));
  const upNext = player.index !== null && queue.length > 1 ? queue.slice(player.index + 1, player.index + 6) : [];
  const isSearch = lastQuery.trim().length > 0;
  const catLabel = CATEGORIES.find((c) => c.q === category)?.label ?? null;
  const chanView = !!channel && chanState !== "idle";

  // ---- YouTube-style Pull to Refresh ----
  const [pullY, setPullY] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const pullStartX = useRef(0);
  const isPulling = useRef(false);
  const pullYRef = useRef(0);

  const handleRefresh = useCallback(async () => {
    if (isSearch) {
      await doSearch(lastQuery);
    } else {
      await Promise.all([loadFeedPage(true), loadHomeExtras(true)]);
    }
  }, [isSearch, lastQuery, doSearch, loadFeedPage, loadHomeExtras]);

  useEffect(() => {
    if (open || chanView) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 5) return;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      pullStartY.current = touch.clientY;
      pullStartX.current = touch.clientX;
      isPulling.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isPullRefreshing) return;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      const dy = touch.clientY - pullStartY.current;
      const dx = touch.clientX - pullStartX.current;

      if (window.scrollY <= 2 && dy > 4 && Math.abs(dy) > Math.abs(dx) * 1.1) {
        isPulling.current = true;
        const dist = Math.min(80, Math.pow(dy, 0.82) * 1.6);
        pullYRef.current = dist;
        setPullY(dist);
        if (e.cancelable && dy > 12) {
          e.preventDefault();
        }
      } else if (dy <= 0 && isPulling.current) {
        isPulling.current = false;
        pullYRef.current = 0;
        setPullY(0);
      }
    };

    const onTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;
      const currentDist = pullYRef.current;
      if (currentDist >= 55) {
        setIsPullRefreshing(true);
        pullYRef.current = 55;
        setPullY(55);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try { navigator.vibrate(18); } catch {}
        }
        void handleRefresh().finally(() => {
          setIsPullRefreshing(false);
          pullYRef.current = 0;
          setPullY(0);
        });
      } else {
        pullYRef.current = 0;
        setPullY(0);
      }
    };

    let mouseActive = false;
    let mouseStartY = 0;
    const onMouseDown = (e: MouseEvent) => {
      if (window.scrollY > 5 || e.clientY > 180 || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, button, a, textarea, select, [role='slider']")) return;
      mouseActive = true;
      mouseStartY = e.clientY;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mouseActive || isPullRefreshing) return;
      const dy = e.clientY - mouseStartY;
      if (window.scrollY <= 2 && dy > 4) {
        const dist = Math.min(80, Math.pow(dy, 0.82) * 1.6);
        pullYRef.current = dist;
        setPullY(dist);
      }
    };
    const onMouseUp = () => {
      if (!mouseActive) return;
      mouseActive = false;
      if (pullYRef.current >= 55) {
        setIsPullRefreshing(true);
        pullYRef.current = 55;
        setPullY(55);
        void handleRefresh().finally(() => {
          setIsPullRefreshing(false);
          pullYRef.current = 0;
          setPullY(0);
        });
      } else {
        pullYRef.current = 0;
        setPullY(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [open, chanView, isPullRefreshing, handleRefresh]);

  useEffect(() => {
    if (isPullRefreshing && searchState !== "loading") {
      setIsPullRefreshing(false);
      pullYRef.current = 0;
      setPullY(0);
    }
  }, [searchState, isPullRefreshing]);

  return (
    <div className="relative min-h-screen overflow-hidden font-body">
      {/* YouTube-style Floating Pull to Refresh indicator */}
      <div
        className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-50 transition-all duration-200 ease-out"
        style={{
          transform: `translate3d(-50%, ${pullY}px, 0)`,
          opacity: pullY > 6 ? Math.min(1, pullY / 32) : 0,
        }}
        aria-hidden={pullY <= 6}
      >
        <div className="flex size-11 items-center justify-center rounded-full bg-white/95 dark:bg-card/95 shadow-xl shadow-black/15 ring-1 ring-border/80 backdrop-blur-md">
          {isPullRefreshing || (searchState === "loading" && pullY > 0) ? (
            <svg className="size-5 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg
              className={`size-5 text-primary transition-transform duration-75 ${pullY >= 55 ? "scale-110 text-indigo-600" : ""}`}
              style={{
                transform: `rotate(${pullY * 5}deg) scale(${Math.min(1, 0.65 + (pullY / 60) * 0.35)})`,
              }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          )}
        </div>
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="animate-glow absolute -top-24 -left-16 size-72 rounded-full bg-sun/60 blur-3xl" />
        <div className="animate-glow absolute top-1/3 -right-20 size-80 rounded-full bg-mint/60 blur-3xl" style={{ animationDelay: "-6s" }} />
        <div className="animate-glow absolute bottom-24 left-1/4 size-72 rounded-full bg-rose/50 blur-3xl" style={{ animationDelay: "-3s" }} />
        <div className="animate-glow absolute -bottom-16 right-6 size-60 rounded-full bg-lilac/60 blur-3xl" style={{ animationDelay: "-9s" }} />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full min-w-0 max-w-[420px] flex-col px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <header className="relative z-30 flex items-center gap-2.5 pt-[max(1.5rem,env(safe-area-inset-top))]">
          {/* Logo on Left OR Back Button when in Search mode */}
          {isSearch ? (
            <button
              onClick={backHome}
              aria-label="হোমে ফিরে যান"
              title="হোমে ফিরুন"
              className="grid size-9 shrink-0 place-items-center rounded-xl glass-card ring-1 ring-border/80 text-foreground hover:bg-primary/10 hover:text-primary transition-all active:scale-95"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <button onClick={backHome} className="flex shrink-0 items-center gap-2 text-left group">
              <div className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary via-indigo-600 to-rose-500 text-primary-foreground shadow-sm shadow-primary/25 transition-transform group-active:scale-95">
                <Eq className="bg-white" />
              </div>
              <span className="font-display text-lg font-black tracking-tight text-foreground hidden min-[360px]:inline">
                Vizo<span className="text-primary font-black">Watch</span>
              </span>
            </button>
          )}

          {/* Search Box in the Middle */}
          <form onSubmit={submit} className="relative flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 w-full items-center gap-1.5 rounded-2xl glass-card px-3 py-1.5 ring-1 ring-border/80 focus-within:ring-2 focus-within:ring-primary focus-within:shadow-md focus-within:shadow-primary/10 transition-all">
              <input
                value={input}
                onChange={(e) => { setInput(e.target.value); setSugOpen(true); }}
                onFocus={() => { setSearches(loadSearches()); setSugOpen(true); }}
                onClick={() => { setSearches(loadSearches()); setSugOpen(true); }}
                onBlur={() => {
                  setTimeout(() => {
                    if (!isInteractingWithSugRef.current) setSugOpen(false);
                  }, 180);
                }}
                placeholder="গান, নাটক, লিংক খুঁজুন..."
                aria-label="ইউটিউবে খুঁজুন"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/80"
                inputMode="search"
                autoComplete="off"
              />
              {input && (
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setInput("");
                    setSuggestions([]);
                    setSearches(loadSearches());
                    setSugOpen(true);
                  }}
                  aria-label="মুছুন"
                  className="grid size-4 shrink-0 place-items-center rounded-full bg-muted/80 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  ✕
                </button>
              )}
              <button
                type="submit"
                disabled={busy || searchState === "loading"}
                aria-label="খুঁজুন"
                className="shrink-0 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                {busy || searchState === "loading" ? (
                  <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                  </svg>
                )}
              </button>
            </div>

            {sugOpen && (() => {
              const qTrim = input.trim();
              const qLower = qTrim.toLowerCase();
              const isTyping = qTrim.length > 0;
              const matchingSearches = isTyping
                ? searches.filter((s) => s.toLowerCase().includes(qLower))
                : searches;
              const cleanSuggestions = isTyping
                ? suggestions.filter((s) => !matchingSearches.some((m) => m.toLowerCase() === s.toLowerCase()))
                : [];
              const hasItems = matchingSearches.length > 0 || cleanSuggestions.length > 0;

              return (
                <div
                  onPointerDown={() => { isInteractingWithSugRef.current = true; }}
                  onPointerUp={() => { setTimeout(() => { isInteractingWithSugRef.current = false; }, 200); }}
                  className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl bg-background/98 shadow-xl shadow-primary/10 ring-1 ring-border/80 backdrop-blur-xl"
                >
                  {/* Header when not typing */}
                  {!isTyping && matchingSearches.length > 0 && (
                    <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1 text-[11px] font-semibold text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                        </svg>
                        সাম্প্রতিক সার্চ
                      </span>
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          setSearches(clearSearches());
                        }}
                        className="font-semibold text-primary hover:underline"
                      >
                        সব মুছুন
                      </button>
                    </div>
                  )}

                  {/* Empty state: popular searches */}
                  {!isTyping && matchingSearches.length === 0 && (
                    <div className="p-3">
                      <p className="text-[11px] font-semibold text-muted-foreground mb-2">জনপ্রিয় সার্চ</p>
                      <div className="flex flex-wrap gap-1.5">
                        {POPULAR_SEARCHES.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              runTerm(tag);
                            }}
                            onClick={() => runTerm(tag)}
                            className="rounded-full bg-primary/10 px-3 py-1 font-display text-[12px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* List of matching recent searches and live YouTube suggestions */}
                  {hasItems && (
                    <ul className="max-h-[320px] overflow-y-auto py-1.5">
                      {/* 1. Matching Recent Searches first */}
                      {matchingSearches.map((s) => (
                        <li key={`hist-${s}`} className="flex items-center justify-between gap-1 px-2 hover:bg-primary/5 transition-colors">
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              runTerm(s);
                            }}
                            onClick={() => runTerm(s)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground hover:text-primary transition-colors"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-primary/70" aria-hidden>
                              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                            </svg>
                            <span className="min-w-0 flex-1 truncate">{s}</span>
                          </button>
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              setSearches(removeSearch(s));
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSearches(removeSearch(s));
                            }}
                            aria-label="মুছুন"
                            title="মুছুন"
                            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          >
                            ✕
                          </button>
                        </li>
                      ))}

                      {/* 2. Live YouTube Suggestions */}
                      {cleanSuggestions.map((s) => (
                        <li key={`sug-${s}`} className="flex items-center justify-between gap-1 px-2 hover:bg-primary/5 transition-colors">
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              runTerm(s);
                            }}
                            onClick={() => runTerm(s)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] font-medium text-foreground hover:text-primary transition-colors"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted-foreground" aria-hidden>
                              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                            </svg>
                            <span className="min-w-0 flex-1 truncate">{s}</span>
                          </button>
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              setInput(s);
                              setSugOpen(true);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInput(s);
                              setSugOpen(true);
                            }}
                            aria-label="সার্চ বক্সে নিন"
                            title="সার্চ বক্সে নিন"
                            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M7 17L17 7M7 7h10v10" />
                            </svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Direct search hint if user is typing and no suggestions yet */}
                  {isTyping && !hasItems && (
                    <div className="p-2">
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          runTerm(qTrim);
                        }}
                        onClick={() => runTerm(qTrim)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] font-medium text-primary hover:bg-primary/10 transition-colors"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-primary" aria-hidden>
                          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                        </svg>
                        <span className="truncate">"{qTrim}" খুঁজুন</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </form>

          {/* Profile on Right */}
          <button
            onClick={() => setProfileOpen(true)}
            aria-label="প্রোফাইল"
            className={`relative grid size-9 shrink-0 place-items-center rounded-xl ring-1 transition-all active:scale-95 ${user ? "bg-gradient-to-tr from-primary to-indigo-600 text-primary-foreground ring-primary shadow-sm shadow-primary/25 font-display text-sm font-bold" : "glass-card ring-border/80 hover:bg-white"}`}
          >
            {user ? (
              (user.email ?? "?")[0]?.toUpperCase()
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
              </svg>
            )}
            {hydrated && queue.length > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[9.5px] font-extrabold text-white ring-2 ring-background shadow">{queue.length}</span>
            )}
          </button>
        </header>
        {error && <p className="mt-2 text-center text-[12px] text-muted-foreground">{error}</p>}

        <nav aria-label="ক্যাটাগরি" className="-mx-5 mt-4 flex items-center gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((c) => {
            const on = category === c.q;
            return (
              <button
                key={c.label}
                onClick={() => { setCategory(c.q); setChannel(null); setInput(""); if (c.q) bump("terms", c.q, 0.5); doSearch(c.q); }}
                className={`shrink-0 rounded-full px-4 py-1.5 font-display text-[13px] font-bold transition-all duration-200 active:scale-95 ${
                  on
                    ? "bg-gradient-to-r from-primary to-indigo-600 text-primary-foreground shadow-md shadow-primary/25 ring-1 ring-primary/40"
                    : "glass-card text-foreground/85 hover:text-foreground hover:bg-white ring-1 ring-border/70"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </nav>

        {/* Channel page */}
        {chanView && (
          <section className="mt-6">
            <div className="flex items-center justify-between">
              <button onClick={backHome} className="rounded-full bg-glass px-3 py-1 font-display text-[12px] font-semibold ring-1 ring-border">← হোম</button>
              {chanState === "loading" && <span className="text-[12px] text-muted-foreground">লোড হচ্ছে…</span>}
            </div>
            {chan?.banner && (
              <img src={chan.banner} alt="" className="mt-3 aspect-[6/1] w-full rounded-2xl object-cover ring-1 ring-border" referrerPolicy="no-referrer" />
            )}
            <div className="mt-3 flex items-center gap-3">
              <Avatar src={chan?.avatar} name={chan?.name ?? channel ?? "?"} size="size-16" text="text-xl" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg font-bold">{chan?.name || channel}</h2>
                <p className="truncate text-[12px] text-muted-foreground">
                  {[chan?.handle, chan?.subs, chan?.videoCount].filter(Boolean).join(" · ") || "চ্যানেল"}
                </p>
              </div>
            </div>
            <nav aria-label="চ্যানেল ট্যাব" className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {CHANNEL_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => openChannelTab(t.key)}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 font-display text-[13px] font-semibold ring-1 transition active:scale-95 ${chanTab === t.key ? "bg-primary text-primary-foreground ring-primary shadow-primary" : "bg-glass ring-border"}`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {chanState === "loading" && <Skeleton />}
            {chanState === "error" && (
              <div className="glass mt-3 rounded-3xl p-5 text-center">
                <p className="font-display text-sm font-semibold">চ্যানেল আনা যায়নি</p>
                <button onClick={() => chanIdRef.current && loadChannel(chanIdRef.current, chanTab)} className="mt-3 rounded-2xl bg-primary px-4 py-2 font-display text-[13px] font-semibold text-primary-foreground shadow-primary">আবার চেষ্টা</button>
              </div>
            )}
            {chanState === "ok" && chan && chanTab === "playlists" && (
              chan.playlists.length ? (
                <ul className="mt-3 grid grid-cols-2 gap-3">
                  {chan.playlists.map((p) => (
                    <li key={p.id}>
                      <button onClick={() => openPlaylist(p.id, p.title)} className="block w-full text-left">
                        <span className="relative block">
                          <img src={p.thumbnail} alt="" className="aspect-video w-full rounded-2xl object-cover ring-1 ring-border" loading="lazy" referrerPolicy="no-referrer" />
                          {p.count && <span className="absolute right-1.5 bottom-1.5 rounded-md bg-foreground/80 px-1.5 py-0.5 text-[10.5px] font-medium text-background">{p.count}</span>}
                        </span>
                        <span className="mt-1.5 line-clamp-2 block font-display text-[13.5px] font-semibold leading-snug">{p.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="glass mt-3 rounded-3xl p-5 text-center text-[12.5px] text-muted-foreground">এই চ্যানেলে প্লেলিস্ট নেই।</p>
              )
            )}
            {chanState === "ok" && chan && chanTab === "posts" && (
              chan.posts.length ? (
                <ul className="mt-3 space-y-3">
                  {chan.posts.map((p) => (
                    <li key={p.id} className="glass rounded-3xl p-3 ring-1 ring-border">
                      <p className="whitespace-pre-line text-[13px] leading-relaxed">{p.text}</p>
                      {p.image && <img src={p.image} alt="" className="mt-2 w-full rounded-2xl object-cover" loading="lazy" referrerPolicy="no-referrer" />}
                      {p.published && <p className="mt-1.5 text-[11px] text-muted-foreground">{p.published}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="glass mt-3 rounded-3xl p-5 text-center text-[12.5px] text-muted-foreground">কোনো পোস্ট বা স্টোরি নেই।</p>
              )
            )}
            {chanState === "ok" && chan && chanTab !== "playlists" && chanTab !== "posts" && (
              chan.videos.length ? (
                <ul className="mt-3 space-y-3">
                  {chan.videos.map((r) => (
                    <VideoRow key={r.id} r={r} active={current?.id === r.id} playing={playing} progress={progressOf(r.id)} onPlay={() => playTrack(r, savedPosOf(r.id))} onQueue={() => addToQueue(r)} />
                  ))}
                </ul>
              ) : (
                <p className="glass mt-3 rounded-3xl p-5 text-center text-[12.5px] text-muted-foreground">এই ট্যাবে কিছু নেই।</p>
              )
            )}
          </section>
        )}

        {/* Search / trending */}
        {!chanView && (
          <div className="mt-6 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">
              {channel ? `চ্যানেল · ${channel}` : isSearch ? `"${lastQuery}" এর ফলাফল` : catLabel && catLabel !== "হোম" ? catLabel : "আপনার জন্য"}
            </h2>
            {isSearch ? (
              <button
                onClick={backHome}
                className="rounded-full bg-glass px-3 py-1 font-display text-[12px] font-semibold ring-1 ring-border text-primary hover:bg-primary/10 transition-colors"
              >
                ← হোমে ফিরুন
              </button>
            ) : channel ? (
              <button
                onClick={backHome}
                className="rounded-full bg-glass px-3 py-1 font-display text-[12px] font-semibold ring-1 ring-border"
              >
                হোম
              </button>
            ) : null}
            {searchState === "loading" && <span className="text-[12px] text-muted-foreground">খোঁজা হচ্ছে…</span>}
          </div>
        )}

        {/* YouTube Channel Card (when search matches a creator/channel) */}
        {!chanView && isSearch && searchChannel && searchState === "ok" && (
          <div className="glass-card mt-3 overflow-hidden rounded-3xl p-3.5 ring-1 ring-border/80 shadow-md shadow-primary/5 transition-all">
            <div className="flex items-center gap-3">
              <Avatar src={searchChannel.avatar} name={searchChannel.name} size="size-14" text="text-lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate font-display text-[15px] font-bold text-foreground">{searchChannel.name}</h3>
                  <span className="grid size-3.5 place-items-center rounded-full bg-primary text-white text-[9px]" title="ভেরিফায়েড">✓</span>
                </div>
                {searchChannel.handle && (
                  <p className="truncate text-[12px] text-muted-foreground">{searchChannel.handle}</p>
                )}
                {(searchChannel.subs || searchChannel.videoCount) && (
                  <p className="mt-0.5 truncate text-[11.5px] font-medium text-muted-foreground">
                    {[searchChannel.subs, searchChannel.videoCount].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <button
                onClick={() => openChannel(searchChannel.name, searchChannel.id)}
                className="shrink-0 rounded-2xl bg-gradient-to-tr from-primary to-indigo-600 px-3.5 py-1.5 font-display text-[12.5px] font-bold text-white shadow-sm shadow-primary/20 hover:opacity-95 active:scale-95 transition-all"
              >
                চ্যানেল দেখুন
              </button>
            </div>
            {searchChannel.description && (
              <p className="mt-2.5 line-clamp-2 text-[11.5px] text-muted-foreground/80 leading-relaxed border-t border-border/50 pt-2">
                {searchChannel.description}
              </p>
            )}
          </div>
        )}

        {!chanView && searchState === "loading" && <Skeleton />}

        {!chanView && searchState === "error" && (
          <div className="glass mt-3 rounded-3xl p-5 text-center">
            <p className="font-display text-sm font-semibold">ইউটিউব থেকে ফলাফল আনা যায়নি</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">ইন্টারনেট দেখুন বা একটু পরে আবার চেষ্টা করুন।</p>
            <button onClick={() => doSearch(lastQuery)} className="mt-3 rounded-2xl bg-primary px-4 py-2 font-display text-[13px] font-semibold text-primary-foreground shadow-primary">
              আবার চেষ্টা করুন
            </button>
          </div>
        )}

        {!chanView && searchState === "ok" && results.length === 0 && (
          <div className="glass mt-3 rounded-3xl p-5 text-center">
            <p className="font-display text-sm font-semibold">{catLabel ?? `"${lastQuery}"`} — কিছু পাওয়া যায়নি</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">বানান বদলে দেখুন, বা ইউটিউব লিংক সরাসরি পেস্ট করুন।</p>
            <button onClick={() => { setInput(""); setCategory(""); doSearch(""); }} className="mt-3 rounded-2xl bg-glass px-4 py-2 font-display text-[13px] font-semibold ring-1 ring-border">
              হোমে ফিরুন
            </button>
          </div>
        )}

        {/* If user picked "পাবলিক প্লেলিস্ট" category */}
        {!chanView && category === "playlists" && searchState === "ok" && (
          <div className="mt-4">
            {publicPlaylistsList.length === 0 ? (
              <p className="glass mt-3 rounded-3xl p-5 text-center text-[12.5px] text-muted-foreground">কোনো প্লেলিস্ট পাওয়া যায়নি।</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {publicPlaylistsList.map((pl) => (
                  <li key={pl.id} className="glass-card rounded-2xl p-2.5 ring-1 ring-border/80 hover:ring-primary/40 transition-all">
                    <button onClick={() => openPlaylist(pl.id, pl.title)} className="block w-full text-left group">
                      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/60">
                        <img src={pl.thumbnail} alt="" className="size-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                        <div className="absolute inset-y-0 right-0 w-12 bg-black/75 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-0.5">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                          </svg>
                          <span className="text-[10.5px] font-bold">{pl.count}</span>
                        </div>
                      </div>
                      <h4 className="mt-2 line-clamp-2 font-display text-[13.5px] font-bold text-foreground group-hover:text-primary transition-colors">{pl.title}</h4>
                      {pl.author && <p className="truncate text-[11.5px] text-muted-foreground mt-0.5">{pl.author}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* If user picked "স্টোরি / শর্টস" category */}
        {!chanView && category === "shorts" && searchState === "ok" && results.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {results.map((s) => (
              <button
                key={s.id}
                onClick={() => playTrack(s)}
                className="group relative overflow-hidden rounded-2xl glass-card ring-1 ring-border/80 hover:ring-primary/40 text-left transition-all active:scale-95"
              >
                <div className="relative aspect-[9/16] w-full overflow-hidden bg-black/80">
                  <img src={s.thumbnail} alt="" className="size-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                  <div className="absolute top-2 left-2">
                    <span className="grid size-5 place-items-center rounded-full bg-red-600/90 text-white text-[10px]">▶</span>
                  </div>
                  <div className="absolute inset-x-2 bottom-2">
                    <p className="line-clamp-2 font-display text-[12px] font-bold text-white leading-snug drop-shadow">{s.title}</p>
                    {s.views && <p className="text-[10px] text-white/80 mt-0.5">{s.views}</p>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Regular Videos List with YouTube-style embedded Shorts & Playlists */}
        {!chanView && category !== "playlists" && category !== "shorts" && searchState === "ok" && results.length > 0 && (
          <div className="mt-3 space-y-3">
            {/* Top videos */}
            <ul className="space-y-3">
              {results.slice(0, isHome ? 2 : undefined).map((r) => (
                <VideoRow key={r.id} r={r} active={current?.id === r.id} playing={playing} progress={progressOf(r.id)} onPlay={() => playTrack(r, savedPosOf(r.id))} onQueue={() => addToQueue(r)} onChannel={() => openChannel(r.author, r.channelId)} />
              ))}
            </ul>

            {/* Embedded Shorts / Stories Carousel */}
            {isHome && homeShorts.length > 0 && (
              <div className="py-2 my-1">
                <div className="flex items-center justify-between px-1 mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-lg bg-red-600 text-white shadow-sm shadow-red-500/30">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.77 10.32l-1.2-.5-1.1-.47.6-1.46c.74-1.8.06-3.9-1.63-4.9-1.92-1.12-4.38-.55-5.6 1.3l-4.2 6.8c-.85 1.37-.8 3.1.13 4.4 1 1.4 2.7 2.1 4.4 1.8l1.2.5 1.1.46-.6 1.47c-.74 1.8-.06 3.9 1.63 4.9 1.92 1.12 4.38.55 5.6-1.3l4.2-6.8c.85-1.37.8-3.1-.13-4.4-1-1.4-2.7-2.1-4.4-1.8z" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-display text-[14.5px] font-bold text-foreground">শর্টস ও স্টোরি</h3>
                      <p className="text-[11px] text-muted-foreground">ইউটিউব ট্রেন্ডিং শর্টস</p>
                    </div>
                  </div>
                  <button onClick={() => { setCategory("shorts"); doSearch("shorts"); }} className="text-[11.5px] font-bold text-primary hover:underline">
                    সব দেখুন →
                  </button>
                </div>
                <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {homeShorts.slice(0, 10).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => playTrack(s)}
                      className="group relative w-[124px] shrink-0 overflow-hidden rounded-2xl glass-card ring-1 ring-border/80 hover:ring-primary/40 text-left transition-all active:scale-95"
                    >
                      <div className="relative aspect-[9/16] w-full overflow-hidden bg-black/80">
                        <img src={s.thumbnail} alt="" className="size-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                        <div className="absolute top-2 left-2">
                          <span className="grid size-5 place-items-center rounded-full bg-red-600/90 text-white text-[10px]">▶</span>
                        </div>
                        <div className="absolute inset-x-2 bottom-2">
                          <p className="line-clamp-2 font-display text-[12px] font-bold text-white leading-snug drop-shadow">{s.title}</p>
                          {s.views && <p className="text-[10px] text-white/80 mt-0.5">{s.views}</p>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Middle videos */}
            {isHome && results.length > 2 && (
              <ul className="space-y-3">
                {results.slice(2, 5).map((r) => (
                  <VideoRow key={r.id} r={r} active={current?.id === r.id} playing={playing} progress={progressOf(r.id)} onPlay={() => playTrack(r, savedPosOf(r.id))} onQueue={() => addToQueue(r)} onChannel={() => openChannel(r.author, r.channelId)} />
                ))}
              </ul>
            )}

            {/* Embedded Playlists Shelf */}
            {isHome && homePlaylists.length > 0 && (
              <div className="py-2 my-1">
                <div className="flex items-center justify-between px-1 mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-500/30">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-display text-[14.5px] font-bold text-foreground">জনপ্রিয় পাবলিক প্লেলিস্ট</h3>
                      <p className="text-[11px] text-muted-foreground">ইউটিউব অ্যালবাম ও সংকলন</p>
                    </div>
                  </div>
                  <button onClick={() => { setCategory("playlists"); doSearch("playlists"); }} className="text-[11.5px] font-bold text-primary hover:underline">
                    সব দেখুন →
                  </button>
                </div>
                <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {homePlaylists.slice(0, 8).map((pl) => (
                    <button
                      key={pl.id}
                      onClick={() => openPlaylist(pl.id, pl.title)}
                      className="group relative w-[190px] shrink-0 overflow-hidden rounded-2xl glass-card p-2 ring-1 ring-border/80 hover:ring-primary/40 text-left transition-all active:scale-95"
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/60">
                        <img src={pl.thumbnail} alt="" className="size-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                        <div className="absolute inset-y-0 right-0 w-11 bg-black/75 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-0.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                          </svg>
                          <span className="text-[10px] font-bold">{pl.count}</span>
                        </div>
                      </div>
                      <p className="mt-1.5 line-clamp-1 font-display text-[12.5px] font-bold text-foreground group-hover:text-primary transition-colors">{pl.title}</p>
                      {pl.author && <p className="truncate text-[11px] text-muted-foreground">{pl.author}</p>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Remaining videos */}
            {isHome && results.length > 5 && (
              <ul className="space-y-3">
                {results.slice(5).map((r) => (
                  <VideoRow key={r.id} r={r} active={current?.id === r.id} playing={playing} progress={progressOf(r.id)} onPlay={() => playTrack(r, savedPosOf(r.id))} onQueue={() => addToQueue(r)} onChannel={() => openChannel(r.author, r.channelId)} />
                ))}
              </ul>
            )}
          </div>
        )}

        {!chanView && searchState === "ok" && (
          <div ref={sentinel} className="py-4 text-center text-[12px] text-muted-foreground">
            {isHome ? (
              feedLoadingMore ? "আরও ভিডিও আসছে…" : feedDone ? "আজকের মতো এটুকুই" : ""
            ) : (
              searchLoadingMore ? (
                <span className="inline-flex items-center gap-2">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  আরও ফলাফল লোড হচ্ছে…
                </span>
              ) : searchContinuationToken ? (
                "স্ক্রোল করে আরও দেখুন…"
              ) : (
                "সব ফলাফল দেখানো হয়েছে"
              )
            )}
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

          {/* Resume video card */}
          {resume && (
            <div
              onClick={() => {
                setProfileOpen(false);
                playTrack(resume, resume.position);
              }}
              className="glass-card mt-4 overflow-hidden rounded-3xl p-3 ring-1 ring-primary/30 shadow-md shadow-primary/5 transition-all hover:shadow-lg hover:shadow-primary/10 cursor-pointer active:scale-[0.99] group"
            >
              <div className="flex items-center gap-3.5">
                <div className="relative shrink-0 overflow-hidden rounded-2xl ring-1 ring-border/50">
                  <img src={resume.thumbnail} alt="" className="h-16 w-28 object-cover group-hover:scale-105 transition-transform" />
                  <span className="absolute inset-0 bg-black/20" />
                  {resume.duration ? (
                    <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-white/30 backdrop-blur-sm">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (resume.position / resume.duration) * 100)}%` }} />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary">
                    <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                    <span>যেখানে ছেড়েছিলেন · {formatTime(resume.position)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 font-display text-[14px] font-bold text-foreground group-hover:text-primary transition-colors">{resume.title}</p>
                  <p className="line-clamp-1 text-[11.5px] font-medium text-muted-foreground">{resume.author}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProfileOpen(false);
                    playTrack(resume, resume.position);
                  }}
                  aria-label="চালান"
                  className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-tr from-primary to-indigo-600 text-primary-foreground shadow-md shadow-primary/30 transition-all hover:opacity-95 active:scale-90"
                >
                  <PlayIcon playing={false} />
                </button>
              </div>
            </div>
          )}

          {/* Active Playlist Details View */}
          {activePlaylistId ? (
            (() => {
              const currentPl = userPlaylists.find((p) => p.id === activePlaylistId);
              if (!currentPl) {
                return (
                  <p className="glass mt-4 rounded-3xl p-5 text-center text-[13px] text-muted-foreground">
                    প্লেলিস্ট পাওয়া যায়নি।
                  </p>
                );
              }
              const isEditing = editingPlId === currentPl.id;
              return (
                <div className="mt-4 space-y-3">
                  {/* Playlist header */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => { setActivePlaylistId(null); setEditingPlId(null); }}
                      className="flex items-center gap-1.5 text-[12px] font-bold text-primary hover:underline"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                      <span>← ফিরে যান</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (isEditing) {
                            setEditingPlId(null);
                          } else {
                            setEditingPlId(currentPl.id);
                            setEditPlTitle(currentPl.title);
                          }
                        }}
                        aria-label="নাম পরিবর্তন"
                        title="নাম পরিবর্তন"
                        className="grid size-8 place-items-center rounded-xl bg-glass ring-1 ring-border text-muted-foreground hover:text-foreground text-[11px]"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDeletePlaylist(currentPl.id, currentPl.title)}
                        aria-label="প্লেলিস্ট মুছুন"
                        title="প্লেলিস্ট মুছুন"
                        className="grid size-8 place-items-center rounded-xl bg-glass ring-1 ring-border text-rose-500 hover:bg-rose-500/10 text-[11px]"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Title & Edit */}
                  {isEditing ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editPlTitle}
                        onChange={(e) => setEditPlTitle(e.target.value)}
                        className="flex-1 rounded-xl bg-muted/70 px-3 py-1.5 text-[13px] outline-none ring-1 ring-primary"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") handleRenamePlaylist(currentPl.id); }}
                      />
                      <button
                        onClick={() => handleRenamePlaylist(currentPl.id)}
                        className="rounded-xl bg-primary px-3 py-1.5 text-[12px] font-bold text-primary-foreground shadow-sm shadow-primary/25"
                      >
                        সেভ
                      </button>
                    </div>
                  ) : (
                    <div>
                      <h3 className="font-display text-base font-bold text-foreground">{currentPl.title}</h3>
                      <p className="text-[11.5px] text-muted-foreground">{currentPl.videos.length}টি ভিডিও</p>
                    </div>
                  )}

                  {/* Play All Button */}
                  {currentPl.videos.length > 0 && (
                    <button
                      onClick={() => playUserPlaylist(currentPl, 0)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-tr from-primary to-indigo-600 py-2.5 font-display text-[13px] font-bold text-primary-foreground shadow-md shadow-primary/25 active:scale-95 transition-transform"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      <span>সবগুলো চালান ({currentPl.videos.length})</span>
                    </button>
                  )}

                  {/* Video List */}
                  {currentPl.videos.length === 0 ? (
                    <p className="glass mt-3 rounded-3xl p-5 text-center text-[13px] text-muted-foreground">
                      এই প্লেলিস্টে কোনো ভিডিও নেই। হোম বা সার্চের যেকোনো ভিডিওর <b className="text-foreground">+</b> চাপলে এখানে যোগ হবে।
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2.5">
                      {currentPl.videos.map((t, i) => {
                        const isCurrentActive = current?.id === t.id && playing;
                        return (
                          <li key={`${t.id}-${i}`} className="flex items-center gap-2 rounded-2xl glass-card p-2 ring-1 ring-border/80 hover:ring-primary/30 transition-all">
                            <span className="w-5 shrink-0 text-center font-display text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
                            <button
                              onClick={() => playUserPlaylist(currentPl, i)}
                              className="flex min-w-0 flex-1 items-center gap-2.5 text-left group"
                            >
                              <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border">
                                <img src={t.thumbnail} alt="" className="size-full object-cover transition group-hover:scale-105" loading="lazy" />
                                {isCurrentActive && (
                                  <div className="absolute inset-0 grid place-items-center bg-black/40">
                                    <Eq className="bg-white" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-1 font-display text-[13px] font-bold text-foreground group-hover:text-primary transition-colors">{t.title}</p>
                                <p className="line-clamp-1 text-[11px] text-muted-foreground">{t.author}</p>
                              </div>
                            </button>
                            <button
                              onClick={() => handleRemoveVideoFromPlaylist(currentPl.id, t.id)}
                              aria-label="প্লেলিস্ট থেকে সরান"
                              title="প্লেলিস্ট থেকে সরান"
                              className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="mt-5 space-y-6">
              {/* 1. History Section (YouTube-style carousel / list) */}
              <section>
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <h3 className="font-display text-[14.5px] font-bold text-foreground">
                      ইতিহাস {history.length > 0 && <span className="text-[12px] font-semibold text-muted-foreground">({history.length})</span>}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {history.length > 0 && (
                      <button
                        onClick={() => setHistoryExpanded((v) => !v)}
                        className="text-[12px] font-bold text-primary hover:underline"
                      >
                        {historyExpanded ? "← সংক্ষেপ" : "সব দেখুন"}
                      </button>
                    )}
                    {historyExpanded && history.length > 0 && (
                      <button
                        onClick={() => { clearHistory(); setHistory([]); if (userId) clearCloudHistory(userId); }}
                        className="text-[11.5px] text-rose-500 hover:underline"
                      >
                        সব মুছুন
                      </button>
                    )}
                  </div>
                </div>

                {hydrated && history.length === 0 ? (
                  <p className="glass rounded-2xl p-4 text-center text-[12.5px] text-muted-foreground">এখনো কিছু দেখা হয়নি। যা চালাবেন তা এখানে জমা থাকবে।</p>
                ) : historyExpanded ? (
                  <ul className="mt-2 space-y-2.5">
                    {history.map((h) => (
                      <VideoRow
                        key={h.id}
                        r={h}
                        compact
                        active={current?.id === h.id}
                        playing={playing}
                        progress={progressOf(h.id)}
                        onPlay={() => { setProfileOpen(false); playTrack(h, h.position); }}
                        onQueue={() => addToQueue(h)}
                        sub={`${timeAgo(h.at)}${h.position > 10 ? ` · ${formatTime(h.position)} থেকে` : ""}`}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {history.slice(0, 15).map((h) => (
                      <button
                        key={h.id}
                        onClick={() => { setProfileOpen(false); playTrack(h, h.position); }}
                        className="group relative w-[148px] shrink-0 text-left transition-all active:scale-95"
                      >
                        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-muted ring-1 ring-border/80 group-hover:ring-primary/40">
                          <img src={h.thumbnail} alt="" className="size-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                          {h.duration ? (
                            <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-white/30 backdrop-blur-sm">
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{ width: `${Math.min(100, (h.position / h.duration) * 100)}%` }}
                              />
                            </span>
                          ) : null}
                          {h.position > 10 && (
                            <span className="absolute top-1.5 right-1.5 rounded-md bg-black/75 px-1 py-0.5 text-[9.5px] font-medium text-white backdrop-blur-[2px]">
                              {formatTime(h.position)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 line-clamp-2 font-display text-[12px] font-bold text-foreground leading-snug group-hover:text-primary transition-colors">{h.title}</p>
                        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{h.author}</p>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* 2. Playlists Section (YouTube-style carousel / list) */}
              <section>
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-primary">
                      <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                    </svg>
                    <h3 className="font-display text-[14.5px] font-bold text-foreground">
                      আপনার প্লেলিস্ট {userPlaylists.length > 0 && <span className="text-[12px] font-semibold text-muted-foreground">({userPlaylists.length})</span>}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowProfileNewPl((v) => !v)}
                      className="flex items-center gap-1 rounded-xl bg-primary/10 hover:bg-primary/20 px-2.5 py-1 text-[11.5px] font-bold text-primary transition active:scale-95"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>নতুন</span>
                    </button>
                    {userPlaylists.length > 0 && (
                      <button
                        onClick={() => setPlaylistsExpanded((v) => !v)}
                        className="text-[12px] font-bold text-primary hover:underline"
                      >
                        {playlistsExpanded ? "← সংক্ষেপ" : "সব দেখুন"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Create Playlist Input */}
                {showProfileNewPl && (
                  <div className="glass-card mb-3 rounded-2xl p-3 ring-1 ring-primary/40 space-y-2 animate-in fade-in duration-200">
                    <input
                      type="text"
                      autoFocus
                      value={profileNewPlTitle}
                      onChange={(e) => setProfileNewPlTitle(e.target.value)}
                      placeholder="প্লেলিস্টের নাম লিখুন (যেমন: প্রিয় গান)..."
                      className="w-full rounded-xl bg-background/80 px-3 py-2 text-[13px] outline-none ring-1 ring-border focus:ring-2 focus:ring-primary"
                      onKeyDown={(e) => { if (e.key === "Enter") handleCreateFromProfile(); }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowProfileNewPl(false); setProfileNewPlTitle(""); }}
                        className="flex-1 rounded-xl bg-muted py-1.5 text-[12px] font-semibold text-muted-foreground"
                      >
                        বাতিল
                      </button>
                      <button
                        onClick={handleCreateFromProfile}
                        disabled={!profileNewPlTitle.trim()}
                        className="flex-1 rounded-xl bg-primary py-1.5 text-[12px] font-bold text-primary-foreground shadow-sm shadow-primary/25 disabled:opacity-50"
                      >
                        তৈরি করুন
                      </button>
                    </div>
                  </div>
                )}

                {userPlaylists.length === 0 ? (
                  <p className="glass rounded-2xl p-4 text-center text-[12.5px] text-muted-foreground">কোনো প্লেলিস্ট নেই। উপরে <b className="text-foreground">+ নতুন</b> চাপুন অথবা যেকোনো ভিডিওর নিচের <b className="text-foreground">+</b> বাটনে চাপুন।</p>
                ) : playlistsExpanded ? (
                  <ul className="space-y-2.5">
                    {userPlaylists.map((pl) => {
                      const firstThumb = pl.videos[0]?.thumbnail;
                      return (
                        <li
                          key={pl.id}
                          className="group glass-card flex items-center justify-between gap-3 rounded-2xl p-2.5 ring-1 ring-border/80 hover:ring-primary/40 hover:bg-white/80 transition-all cursor-pointer"
                          onClick={() => setActivePlaylistId(pl.id)}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-xl bg-muted/60 ring-1 ring-border/60">
                              {firstThumb ? (
                                <img src={firstThumb} alt="" className="size-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                              ) : (
                                <div className="grid size-full place-items-center bg-primary/10 text-primary">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                                  </svg>
                                </div>
                              )}
                              <div className="absolute inset-y-0 right-0 w-8 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-0.5">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                                </svg>
                                <span className="text-[9.5px] font-bold">{pl.videos.length}</span>
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-display text-[13.5px] font-bold text-foreground truncate group-hover:text-primary transition-colors">{pl.title}</h4>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{pl.videos.length}টি ভিডিও · {timeAgo(pl.updatedAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {pl.videos.length > 0 && (
                              <button
                                onClick={() => playUserPlaylist(pl, 0)}
                                aria-label="সব চালান"
                                title="সব চালান"
                                className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/25 hover:scale-105 active:scale-95 transition-transform"
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                  <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => handleDeletePlaylist(pl.id, pl.title)}
                              aria-label="প্লেলিস্ট মুছুন"
                              title="প্লেলিস্ট মুছুন"
                              className="grid size-8 place-items-center rounded-xl text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition-colors"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {userPlaylists.map((pl) => {
                      const firstThumb = pl.videos[0]?.thumbnail;
                      return (
                        <div
                          key={pl.id}
                          onClick={() => setActivePlaylistId(pl.id)}
                          className="group relative w-[160px] shrink-0 cursor-pointer text-left transition-all active:scale-95"
                        >
                          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-muted ring-1 ring-border/80 group-hover:ring-primary/40">
                            {firstThumb ? (
                              <img src={firstThumb} alt="" className="size-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                            ) : (
                              <div className="grid size-full place-items-center bg-primary/10 text-primary">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                                </svg>
                              </div>
                            )}
                            <div className="absolute inset-y-0 right-0 w-9 bg-black/65 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-0.5">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                              </svg>
                              <span className="text-[10px] font-bold">{pl.videos.length}</span>
                            </div>
                          </div>
                          <p className="mt-1.5 line-clamp-1 font-display text-[12.5px] font-bold text-foreground group-hover:text-primary transition-colors">{pl.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{pl.videos.length}টি ভিডিও</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* 3. Recommended Public Playlists Section */}
              {homePlaylists.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <div className="flex items-center gap-1.5">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-indigo-600">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                      </svg>
                      <h3 className="font-display text-[14.5px] font-bold text-foreground">জনপ্রিয় পাবলিক প্লেলিস্ট</h3>
                    </div>
                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        setCategory("playlists");
                        doSearch("playlists");
                      }}
                      className="text-[12px] font-bold text-primary hover:underline"
                    >
                      সব দেখুন →
                    </button>
                  </div>
                  <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {homePlaylists.slice(0, 8).map((pl) => (
                      <button
                        key={pl.id}
                        onClick={() => {
                          setProfileOpen(false);
                          openPlaylist(pl.id, pl.title);
                        }}
                        className="group relative w-[160px] shrink-0 overflow-hidden rounded-2xl glass-card p-2 ring-1 ring-border/80 hover:ring-primary/40 text-left transition-all active:scale-95"
                      >
                        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/60">
                          <img src={pl.thumbnail} alt="" className="size-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" />
                          <div className="absolute inset-y-0 right-0 w-9 bg-black/75 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-0.5">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
                            </svg>
                            <span className="text-[9.5px] font-bold">{pl.count}</span>
                          </div>
                        </div>
                        <p className="mt-1.5 line-clamp-1 font-display text-[12px] font-bold text-foreground group-hover:text-primary transition-colors">{pl.title}</p>
                        {pl.author && <p className="truncate text-[10.5px] text-muted-foreground">{pl.author}</p>}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
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
        <div className="flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
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

        {/* slot the floating player docks into while the watch page is open with ambient backlight */}
        <div className="relative mx-4 mt-3">
          <div className="ambient-glow absolute -inset-2 bg-gradient-to-r from-primary/35 via-indigo-500/25 to-rose-500/35 rounded-3xl" />
          <div ref={slotRef} className="relative aspect-video overflow-hidden rounded-2xl bg-black/90 ring-1 ring-border shadow-2xl" />
        </div>

        {/* compact modern glass controls under the video */}
        <div className="mx-4 mt-2 glass-card rounded-2xl px-3 py-2 ring-1 ring-border/80 shadow-sm">
          <SeekBar time={time} duration={duration} loaded={player.loaded} onSeek={player.seek} />
          <div className="mt-1.5 flex items-center justify-between px-0.5">
            <button
              onClick={() => player.setRepeat(!player.repeat)}
              aria-label="রিপিট"
              title="রিপিট লুপ"
              className={`grid size-8 place-items-center rounded-xl transition-all ${player.repeat ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25" : "text-muted-foreground hover:bg-muted"}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <button
                onClick={() => player.seek(Math.max(0, time - 10))}
                aria-label="১০ সেকেন্ড পেছনে"
                title="১০ সেকেন্ড পেছনে"
                className="grid size-8 place-items-center rounded-xl text-foreground/80 hover:bg-muted font-display text-[11px] font-bold transition-all active:scale-90"
              >
                -10s
              </button>

              <button onClick={player.prev} aria-label="আগের ভিডিও" className="grid size-8 place-items-center rounded-full text-foreground/90 hover:bg-muted transition-all active:scale-90">
                <SkipIcon back />
              </button>

              <button
                onClick={player.toggle}
                aria-label={playing ? "পজ" : "প্লে"}
                className="grid size-10 place-items-center rounded-2xl bg-gradient-to-tr from-primary to-indigo-600 text-primary-foreground shadow-md shadow-primary/30 transition-all hover:scale-105 active:scale-95"
              >
                <PlayIcon playing={playing} className="size-4" />
              </button>

              <button onClick={player.next} aria-label="পরের ভিডিও" className="grid size-8 place-items-center rounded-full text-foreground/90 hover:bg-muted transition-all active:scale-90">
                <SkipIcon />
              </button>

              <button
                onClick={() => player.seek(Math.min(duration, time + 10))}
                aria-label="১০ সেকেন্ড সামনে"
                title="১০ সেকেন্ড সামনে"
                className="grid size-8 place-items-center rounded-xl text-foreground/80 hover:bg-muted font-display text-[11px] font-bold transition-all active:scale-90"
              >
                +10s
              </button>
            </div>

            <button onClick={() => void openDocPip()} aria-label="ভাসমান পপ-আপে চালান" title="ভাসমান পপ-আপ" className="grid size-8 place-items-center rounded-xl text-muted-foreground hover:bg-muted transition-all active:scale-90">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="4" width="19" height="16" rx="2.5" /><rect x="12" y="12" width="8" height="6" rx="1.4" fill="currentColor" /></svg>
            </button>
          </div>
        </div>


        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          <div className="px-4 pt-3">
            <h1 className="line-clamp-2 font-display text-[15px] font-semibold leading-snug">{current?.title ?? "কোনো ভিডিও বাছাই হয়নি"}</h1>
            
            <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11.5px] text-muted-foreground">
              {current && (meta?.views || meta?.published || meta?.publishedAgo) ? (
                <span>{[meta?.views, meta?.published ? `আপলোড: ${meta.published}` : "", meta?.publishedAgo].filter(Boolean).join(" · ")}</span>
              ) : <span />}
              <span className="inline-flex items-center gap-1 font-semibold text-primary/90 text-[10.5px]">
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                ব্যাকগ্রাউন্ড অডিও এক্টিভ
              </span>
            </div>

            {current?.author && (
              <div className="mt-2.5 flex items-center justify-between">
                <button onClick={() => openChannel(current.author, meta?.channelId)} className="inline-flex items-center gap-2 text-left group">
                  <Avatar src={meta?.channelThumb} name={current.author} size="size-7" text="text-[11px]" />
                  <div className="flex flex-col">
                    <span className="truncate font-display text-[13px] font-semibold group-hover:text-primary transition-colors">{current.author}</span>
                    {meta?.subs && <span className="text-[10.5px] text-muted-foreground">{meta.subs}</span>}
                  </div>
                </button>
                <button onClick={() => openChannel(current.author, meta?.channelId)} className="rounded-full bg-lilac/30 hover:bg-lilac/60 px-3 py-1 font-display text-[11.5px] font-semibold text-primary transition active:scale-95">
                  চ্যানেল দেখুন →
                </button>
              </div>
            )}

            {current && (
              <div className="mt-2.5 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  onClick={() => addToQueue(current)}
                  className="shrink-0 flex items-center gap-1.5 rounded-full glass-card px-3 py-1.5 text-[11.5px] font-semibold ring-1 ring-border/80 hover:bg-white transition-all active:scale-95"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  <span>প্লেলিস্ট</span>
                </button>
                <button
                  onClick={() => navigator.share?.({ url: `https://youtu.be/${current.id}`, title: current.title }).catch(() => {})}
                  className="shrink-0 flex items-center gap-1.5 rounded-full glass-card px-3 py-1.5 text-[11.5px] font-semibold ring-1 ring-border/80 hover:bg-white transition-all active:scale-95"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  <span>শেয়ার</span>
                </button>
                <a
                  href={`https://www.youtube.com/watch?v=${current.id}`}
                  target="_blank"
                  rel="noopener"
                  className="shrink-0 flex items-center gap-1.5 rounded-full glass-card px-3 py-1.5 text-center text-[11.5px] font-semibold ring-1 ring-border/80 hover:bg-white transition-all active:scale-95"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  <span>ইউটিউব</span>
                </a>
                {player.captionTracks.length > 0 && (
                  <button
                    onClick={() => player.setCaptions(!player.captionsOn)}
                    className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold ring-1 transition-all active:scale-95 ${player.captionsOn ? "bg-primary text-primary-foreground ring-primary" : "glass-card text-muted-foreground ring-border/80"}`}
                  >
                    CC
                    {player.captionsOn && <span className="text-[10px] font-normal">চালু</span>}
                  </button>
                )}
                {player.captionsOn && player.captionTracks.length > 1 && (
                  <select
                    value={player.captionLang ?? ""}
                    onChange={(e) => player.setCaptions(true, e.target.value)}
                    aria-label="সাবটাইটেল ভাষা"
                    className="shrink-0 rounded-full bg-background px-2 py-1 text-[11px] ring-1 ring-border outline-none font-semibold"
                  >
                    {player.captionTracks.map((t) => (
                      <option key={t.code} value={t.code}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Playlist Queue (only when a playlist is actively being played) */}
            {player.index !== null && upNext.length > 0 && (
              <div className="mt-4 rounded-2xl glass-card p-3 ring-1 ring-primary/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display text-[12.5px] font-bold text-primary flex items-center gap-1.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" /></svg>
                    <span>চলমান প্লেলিস্ট ({player.index + 1}/{queue.length})</span>
                  </span>
                </div>
                <ul className="space-y-2">
                  {upNext.slice(0, 3).map((t) => {
                    const i = queue.findIndex((x) => x.id === t.id);
                    return (
                      <li key={t.id} className="flex items-center gap-2.5 rounded-xl bg-background/60 p-1.5 ring-1 ring-border/60">
                        <button onClick={() => { player.playAt(i); openWatch(t.id); }} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                          <img src={t.thumbnail} alt="" className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-border" loading="lazy" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-semibold text-foreground">{t.title}</span>
                            <span className="block truncate text-[10.5px] text-muted-foreground">{t.author}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Direct Related Videos matching the current video - YouTube Style */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="font-display text-[15px] font-bold text-foreground">সম্পর্কিত ভিডিও</h3>
                <span className="text-[11px] font-medium text-muted-foreground">ইউটিউব রিকমেন্ডেশন</span>
              </div>
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
              <ul className="mt-2 space-y-3">
                {related.map((r) => (
                  <VideoRow key={r.id} r={r} active={current?.id === r.id} playing={playing} progress={progressOf(r.id)} onPlay={() => playTrack(r, savedPosOf(r.id))} onQueue={() => addToQueue(r)} onChannel={() => openChannel(r.author, r.channelId)} />
                ))}
              </ul>
            )}
            {relatedState === "ok" && (
              <div ref={relSentinelRef} className="py-4 text-center text-[11.5px] text-muted-foreground">
                {relatedMore ? "আরও ভিডিও আসছে…" : relQueriesRef.current.length === 0 ? "" : " "}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating player — one element, moved between big / watch slot / pop-up corner so playback never restarts */}
      <div
        ref={playerBoxRef}
        className={
          docPip
            ? "size-full overflow-hidden bg-foreground"
            : `fixed z-[45] overflow-hidden bg-foreground ${pipDragging ? "" : "transition-all duration-500 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]"} ${
                playerMode === "big" ? "grid place-items-center rounded-none" : playerMode === "pip" ? "rounded-2xl shadow-primary ring-1 ring-border" : playerMode === "watch" ? "rounded-3xl ring-1 ring-border" : "pointer-events-none opacity-0"
              }`
        }
        style={
          docPip
            ? { position: "static", width: "100%", height: "100%" }
            : playerMode === "big"
              ? { inset: 0 }
              : playerMode === "watch" && slotRect
                ? { top: slotRect.top, left: slotRect.left, width: slotRect.width, height: slotRect.height }
                : playerMode === "pip"
                  ? { left: pipPos?.left ?? 12, top: pipPos?.top ?? 12, width: pipW, height: pipH }
                  : { right: 12, bottom: 16, width: 1, height: 1 }
        }

      >
        <div id={PLAYER_ID} className={playerMode === "big" ? "aspect-video w-full max-w-[min(100vw,calc(100dvh*16/9))]" : "size-full"} />
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
        {playerMode === "pip" && !pipMin && (
          <>
            {/* drag handle — press and move to place the pop-up anywhere, tap to open the video page */}
            <div
              className="absolute inset-0 touch-none"
              onPointerDown={pipDragStart}
              onPointerMove={pipDragMove}
              onPointerUp={() => { if (!pipDragEnd() && current) openWatch(current.id); }}
              onPointerCancel={pipDragEnd}
            />

            {/* Dedicated Top-Right Close Button */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closePipVideo();
              }}
              aria-label="ভিডিও বন্ধ করুন"
              title="ভিডিও বন্ধ করুন"
              className="absolute top-1.5 right-1.5 z-30 grid size-7 place-items-center rounded-full bg-black/75 text-white shadow-md backdrop-blur hover:bg-black active:scale-90 transition-transform"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            {/* Top-Left Expand to Watch Page Button */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (current) openWatch(current.id);
              }}
              aria-label="ভিডিও খুলুন"
              title="ভিডিও খুলুন"
              className="absolute top-1.5 left-1.5 z-30 grid size-7 place-items-center rounded-full bg-black/75 text-white shadow-md backdrop-blur hover:bg-black active:scale-90 transition-transform"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>

            {/* Live Progress Bar on PiP */}
            {duration > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25 z-10 pointer-events-none">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (time / duration) * 100)}%` }} />
              </div>
            )}

            {/* Bottom Controls Bar */}
            <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between bg-gradient-to-t from-foreground/90 via-foreground/60 to-transparent px-2 pb-2 pt-5 text-background">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); player.toggle(); }}
                aria-label={playing ? "পজ" : "প্লে"}
                className="grid size-8 place-items-center rounded-xl bg-white/20 backdrop-blur hover:bg-white/30 transition-all active:scale-90"
              >
                <PlayIcon playing={playing} className="size-4" />
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); player.next(); }}
                aria-label="পরের"
                className="grid size-8 place-items-center rounded-xl bg-white/20 backdrop-blur hover:bg-white/30 transition-all active:scale-90"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setPipMin(true); }}
                aria-label="মিনিমাইজ"
                className="grid size-8 place-items-center rounded-xl bg-white/20 backdrop-blur hover:bg-white/30 transition-all active:scale-90"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /></svg>
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  closePipVideo();
                }}
                aria-label="বন্ধ"
                className="grid size-8 place-items-center rounded-xl bg-white/20 backdrop-blur hover:bg-white/30 transition-all active:scale-90"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </>
        )}
        {playerMode === "pip" && pipMin && (
          <div
            className="absolute inset-0 flex touch-none items-center justify-between bg-foreground px-1.5 text-background"
            onPointerDown={pipDragStart}
            onPointerMove={pipDragMove}
            onPointerUp={pipDragEnd}
            onPointerCancel={pipDragEnd}
          >
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); player.toggle(); }}
              aria-label={playing ? "পজ" : "প্লে"}
              className="grid size-8 place-items-center rounded-lg bg-background/20 active:scale-90"
            >
              <PlayIcon playing={playing} className="size-4" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setPipMin(false); }}
              aria-label="বড় করুন"
              className="grid size-8 place-items-center rounded-lg bg-background/20 active:scale-90"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closePipVideo();
              }}
              aria-label="বন্ধ"
              className="grid size-8 place-items-center rounded-lg bg-background/20 active:scale-90"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        )}
        {(playerMode === "big" || playerMode === "watch") && (
          <button
            onClick={toggleBigVideo}
            aria-label={bigVideo ? "ছোট করুন" : "বড় করুন"}
            className="absolute right-3 top-3 z-20 grid size-9 place-items-center rounded-xl bg-background/80 text-foreground shadow ring-1 ring-border backdrop-blur"
          >
            {bigVideo ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" /></svg>
            )}
          </button>
        )}
        {playerMode === "big" && (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-foreground/80 to-transparent px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-8 text-background">
            <SeekBar time={time} duration={duration} loaded={player.loaded} onSeek={player.seek} dark />
            <div className="pointer-events-auto mt-2 flex items-center justify-center gap-4">
              <button onClick={player.prev} aria-label="আগের" className="grid size-8 place-items-center rounded-full bg-background/20 active:scale-95"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg></button>
              <button onClick={player.toggle} aria-label={playing ? "পজ" : "প্লে"} className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-primary active:scale-95"><PlayIcon playing={playing} className="size-5" /></button>
              <button onClick={player.next} aria-label="পরের" className="grid size-8 place-items-center rounded-full bg-background/20 active:scale-95"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg></button>
            </div>
          </div>
        )}

      </div>

      {/* YouTube-style Save to Playlist Modal / Bottom Sheet */}
      {saveModalTrack && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-foreground/40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => { setSaveModalTrack(null); setShowNewPlaylistInput(false); }}
        >
          <div
            className="w-full max-w-[420px] rounded-t-[28px] sm:rounded-3xl bg-background/95 backdrop-blur-2xl p-5 shadow-2xl ring-1 ring-border border-t sm:border animate-in slide-in-from-bottom-6 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div className="min-w-0 flex-1 pr-3">
                <h3 className="font-display text-[16px] font-bold text-foreground">প্লেলিস্টে সংরক্ষণ করুন</h3>
                <p className="truncate text-[12px] text-muted-foreground mt-0.5">{saveModalTrack.title}</p>
              </div>
              <button
                onClick={() => { setSaveModalTrack(null); setShowNewPlaylistInput(false); }}
                className="grid size-8 shrink-0 place-items-center rounded-xl bg-glass ring-1 ring-border text-muted-foreground hover:text-foreground text-[13px] transition active:scale-95"
              >
                ✕
              </button>
            </div>

            {/* Checklist of user playlists */}
            <div className="max-h-[260px] overflow-y-auto py-3 space-y-1.5 [scrollbar-width:none]">
              {userPlaylists.length === 0 ? (
                <p className="text-center text-[12.5px] text-muted-foreground py-4">কোনো প্লেলিস্ট তৈরি করা নেই। নিচে নতুন তৈরি করুন।</p>
              ) : (
                userPlaylists.map((pl) => {
                  const hasTrack = pl.videos.some((v) => v.id === saveModalTrack.id);
                  return (
                    <button
                      key={pl.id}
                      onClick={() => handleToggleInPlaylist(pl.id)}
                      className={`w-full flex items-center justify-between gap-3 p-3 rounded-2xl text-left transition-all ${
                        hasTrack ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50 ring-1 ring-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${
                          hasTrack ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
                        }`}>
                          {hasTrack && (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <div className="min-w-0">
                          <span className="block font-display text-[13.5px] font-semibold truncate text-foreground">{pl.title}</span>
                          <span className="block text-[11px] text-muted-foreground">{pl.videos.length}টি ভিডিও</span>
                        </div>
                      </div>
                      {hasTrack && <span className="text-[11px] font-bold text-primary">✓ সেভ করা</span>}
                    </button>
                  );
                })
              )}
            </div>

            {/* New Playlist Action */}
            <div className="pt-3 border-t border-border/60">
              {!showNewPlaylistInput ? (
                <button
                  onClick={() => setShowNewPlaylistInput(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary/10 hover:bg-primary/15 py-2.5 font-display text-[13px] font-bold text-primary transition active:scale-95"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>+ নতুন প্লেলিস্ট তৈরি করুন</span>
                </button>
              ) : (
                <div className="space-y-2.5 animate-in fade-in duration-200">
                  <input
                    type="text"
                    autoFocus
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    placeholder="প্লেলিস্টের নাম লিখুন (যেমন: পছন্দের গান)..."
                    className="w-full rounded-xl bg-muted/70 px-3.5 py-2.5 text-[13px] outline-none ring-1 ring-border focus:ring-2 focus:ring-primary"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFromModal();
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowNewPlaylistInput(false); setNewPlaylistName(""); }}
                      className="flex-1 rounded-xl bg-muted py-2 text-center font-display text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                    >
                      বাতিল
                    </button>
                    <button
                      type="button"
                      disabled={!newPlaylistName.trim()}
                      onClick={handleCreateFromModal}
                      className="flex-1 rounded-xl bg-primary py-2 text-center font-display text-[12px] font-bold text-primary-foreground shadow-sm shadow-primary/25 disabled:opacity-50"
                    >
                      তৈরি করুন
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
          <span className="rounded-full bg-foreground px-4 py-2 text-[12px] font-semibold text-background shadow-primary">{toast}</span>
        </div>
      )}
    </div>
  );
}
