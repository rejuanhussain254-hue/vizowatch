import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "@/lib/youtube";

export type CaptionTrack = { code: string; name: string };

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return apiPromise;
}

const SILENT_AUDIO_URI = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export function usePlayer(queue: Track[], containerId: string, onEnded?: () => boolean) {
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const playerRef = useRef<any>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [repeat, setRepeat] = useState(false);
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([]);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const wantCaptionsRef = useRef(false);
  const indexRef = useRef<number | null>(null);
  const queueRef = useRef(queue);
  const repeatRef = useRef(repeat);
  queueRef.current = queue;
  repeatRef.current = repeat;
  indexRef.current = index;
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);

  const current = currentTrack ?? (index !== null ? queue[index] ?? null : null);

  const playDirect = useCallback((track: Track, startAt = 0) => {
    setCurrentTrack(track);
    const q = queueRef.current;
    const idx = q.findIndex((t) => t.id === track.id);
    setIndex(idx !== -1 ? idx : null);
    indexRef.current = idx !== -1 ? idx : null;
    playerRef.current?.loadVideoById({ videoId: track.id, startSeconds: startAt });
    setCaptionTracks([]);
    setPlaying(true);
  }, []);

  const playAt = useCallback((i: number, startAt = 0) => {
    const q = queueRef.current;
    if (!q.length) return;
    const next = ((i % q.length) + q.length) % q.length;
    setIndex(next);
    indexRef.current = next;
    setCurrentTrack(q[next] ?? null);
    playerRef.current?.loadVideoById({ videoId: q[next]!.id, startSeconds: startAt });
    setCaptionTracks([]);
    setPlaying(true);
  }, []);

  const next = useCallback(() => {
    if (indexRef.current === null) return;
    playAt(indexRef.current + 1);
  }, [playAt]);

  const prev = useCallback(() => {
    if (indexRef.current === null) return;
    const p = playerRef.current;
    if (p && p.getCurrentTime?.() > 4) {
      p.seekTo(0, true);
      return;
    }
    playAt(indexRef.current - 1);
  }, [playAt]);

  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (indexRef.current === null) {
      playAt(0);
      return;
    }
    if (p.getPlayerState?.() === 1) p.pauseVideo();
    else p.playVideo();
  }, [playAt]);

  const pause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.pauseVideo?.();
    } catch {}
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    const p = playerRef.current;
    try {
      p?.stopVideo?.();
      p?.pauseVideo?.();
    } catch {}
    setPlaying(false);
    setCurrentTrack(null);
    setIndex(null);
    indexRef.current = null;
    setTime(0);
  }, []);

  const seek = useCallback((t: number) => {
    playerRef.current?.seekTo(t, true);
    setTime(t);
  }, []);

  // ---- captions (only offered when the video actually has tracks) ----

  const readTracks = useCallback(() => {
    const p = playerRef.current;
    try {
      const list = (p?.getOption?.("captions", "tracklist") ?? []) as { languageCode: string; displayName: string }[];
      setCaptionTracks(list.map((t) => ({ code: t.languageCode, name: t.displayName })));
      const track = p?.getOption?.("captions", "track") as { languageCode?: string } | undefined;
      if (list.length === 0) { setCaptionsOn(false); setCaptionLang(null); return; }
      // Loading the module auto-enables a track; keep captions off unless the user turned them on.
      if (!wantCaptionsRef.current && track?.languageCode) p.setOption("captions", "track", {});
      if (wantCaptionsRef.current && track?.languageCode) setCaptionLang(track.languageCode);
    } catch {
      setCaptionTracks([]);
    }
  }, []);

  const setCaptions = useCallback((on: boolean, code?: string) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (on) {
        p.loadModule?.("captions");
        const lang = code ?? captionTracks[0]?.code;
        if (lang) p.setOption("captions", "track", { languageCode: lang });
        wantCaptionsRef.current = true;
        setCaptionLang(lang ?? null);
        setCaptionsOn(true);
      } else {
        p.setOption?.("captions", "track", {});
        wantCaptionsRef.current = false;
        setCaptionsOn(false);
        setCaptionLang(null);
      }
    } catch {
      /* captions module unavailable */
    }
  }, [captionTracks]);


  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      playerRef.current = new YT.Player(containerId, {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0 },
        events: {
          onReady: () => setReady(true),
          onApiChange: () => readTracks(),
          onStateChange: (e: any) => {
            const st = e.data;
            setPlaying(st === 1);
            if (st === 1) {
              setDuration(e.target.getDuration());
              // Ask the player to load the captions module so it reports available tracks.
              try { e.target.loadModule?.("captions"); } catch { /* noop */ }
              setTimeout(readTracks, 800);
            }
            if (st === 0) {
              if (repeatRef.current) e.target.seekTo(0, true);
              else if (!onEndedRef.current?.()) next();
            }
          },
        },
      });
    });
    const tick = setInterval(() => {
      // Skip UI updates when hidden or paused — saves battery and heat.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const p = playerRef.current;
      if (p?.getCurrentTime && p.getPlayerState?.() === 1) {
        setTime(p.getCurrentTime() || 0);
        const d = p.getDuration?.();
        if (d) setDuration(d);
        const lf = p.getVideoLoadedFraction?.();
        if (typeof lf === "number") setLoaded(lf);
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [containerId, next, readTracks]);

  // Keep mobile OS audio session alive in background
  useEffect(() => {
    if (typeof Audio === "undefined") return;
    if (!silentAudioRef.current) {
      try {
        const a = new Audio(SILENT_AUDIO_URI);
        a.loop = true;
        silentAudioRef.current = a;
      } catch {
        /* audio unsupported */
      }
    }
    const a = silentAudioRef.current;
    if (playing) {
      a?.play().catch(() => {});
    } else {
      a?.pause();
    }
  }, [playing]);

  // Lock-screen / notification controls
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (current) {
      ms.metadata = new MediaMetadata({
        title: current.title,
        artist: current.author,
        album: "Echo",
        artwork: [{ src: current.thumbnail, sizes: "480x360", type: "image/jpeg" }],
      });
    }
    ms.playbackState = playing ? "playing" : "paused";
    ms.setActionHandler("play", () => {
      silentAudioRef.current?.play().catch(() => {});
      playerRef.current?.playVideo();
    });
    ms.setActionHandler("pause", () => {
      silentAudioRef.current?.pause();
      playerRef.current?.pauseVideo();
    });
    ms.setActionHandler("nexttrack", next);
    ms.setActionHandler("previoustrack", prev);
    try {
      ms.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime));
    } catch {
      /* unsupported */
    }
  }, [current, playing, next, prev, seek]);

  // Keep playing when the tab goes to the background (screen off / app switch)
  useEffect(() => {
    if (!playing) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const resume = () => {
      const p = playerRef.current;
      if (!p || indexRef.current === null) return;
      const st = p.getPlayerState?.();
      if (st === 2 || st === -1) p.playVideo?.();
    };
    // Hidden = audio only for the user, so drop to the lowest video quality:
    // far less decoding work, which keeps the phone cooler and saves battery.
    const quality = (q: string) => {
      try {
        playerRef.current?.setPlaybackQuality?.(q);
      } catch {
        /* unsupported */
      }
    };
    const start = () => {
      quality("tiny");
      if (timer) return;
      resume();
      timer = setInterval(resume, 10000);
    };
    const stop = () => {
      quality("default");
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.visibilityState === "hidden" ? start() : stop());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", start);
    if (document.visibilityState === "hidden") start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", start);
    };
  }, [playing]);



  return { ready, current, index, playing, time, duration, loaded, repeat, setRepeat, playAt, playDirect, next, prev, toggle, pause, stop, seek, setIndex, captionTracks, captionsOn, captionLang, setCaptions };
}
