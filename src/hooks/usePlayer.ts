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

export function usePlayer(queue: Track[], containerId: string) {
  const playerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeat, setRepeat] = useState(false);
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([]);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [captionLang, setCaptionLang] = useState<string | null>(null);
  const indexRef = useRef<number | null>(null);
  const queueRef = useRef(queue);
  const repeatRef = useRef(repeat);
  queueRef.current = queue;
  repeatRef.current = repeat;
  indexRef.current = index;

  const current = index !== null ? queue[index] ?? null : null;

  const playAt = useCallback((i: number, startAt = 0) => {
    const q = queueRef.current;
    if (!q.length) return;
    const next = ((i % q.length) + q.length) % q.length;
    setIndex(next);
    indexRef.current = next;
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
      if (list.length === 0) { setCaptionsOn(false); setCaptionLang(null); }
      else if (track?.languageCode) { setCaptionsOn(true); setCaptionLang(track.languageCode); }
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
        setCaptionLang(lang ?? null);
        setCaptionsOn(true);
      } else {
        p.setOption?.("captions", "track", {});
        p.unloadModule?.("captions");
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
              else next();
            }
          },
        },
      });
    });
    const tick = setInterval(() => {
      const p = playerRef.current;
      if (p?.getCurrentTime) {
        setTime(p.getCurrentTime() || 0);
        const d = p.getDuration?.();
        if (d) setDuration(d);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [containerId, next, readTracks]);

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
    ms.setActionHandler("play", () => playerRef.current?.playVideo());
    ms.setActionHandler("pause", () => playerRef.current?.pauseVideo());
    ms.setActionHandler("nexttrack", next);
    ms.setActionHandler("previoustrack", prev);
    try {
      ms.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime));
    } catch {
      /* unsupported */
    }
  }, [current, playing, next, prev, seek]);

  // Keep playing when the tab goes to the background
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden" && playing) {
        setTimeout(() => {
          const p = playerRef.current;
          if (p && p.getPlayerState?.() === 2 && indexRef.current !== null) p.playVideo();
        }, 400);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [playing]);

  return { ready, current, index, playing, time, duration, repeat, setRepeat, playAt, next, prev, toggle, seek, setIndex, captionTracks, captionsOn, captionLang, setCaptions };
}
