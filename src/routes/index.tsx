import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { usePlayer } from "@/hooks/usePlayer";
import {
  extractVideoId,
  fetchTrack,
  formatTime,
  loadQueue,
  saveQueue,
  type Track,
} from "@/lib/youtube";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Echo — ইউটিউব ব্যাকগ্রাউন্ড প্লেয়ার" },
      { name: "description", content: "ইউটিউব লিংক পেস্ট করুন, সাইন-ইন ছাড়াই ব্যাকগ্রাউন্ডে গান শুনুন। কুই, লক-স্ক্রিন কন্ট্রোল ও রিপিট সহ।" },
      { property: "og:title", content: "Echo — ইউটিউব ব্যাকগ্রাউন্ড প্লেয়ার" },
      { property: "og:description", content: "সাইন-ইন ছাড়াই ইউটিউব গান ব্যাকগ্রাউন্ডে শুনুন।" },
    ],
  }),
  component: Index,
});

const PLAYER_ID = "echo-yt-player";

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

function Index() {
  const [queue, setQueue] = useState<Track[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const player = usePlayer(queue, PLAYER_ID);

  useEffect(() => {
    setQueue(loadQueue());
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveQueue(queue);
  }, [queue, hydrated]);

  async function addTrack(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const id = extractVideoId(input);
    if (!id) {
      if (input.trim()) {
        window.open(`https://m.youtube.com/results?search_query=${encodeURIComponent(input.trim())}`, "_blank");
        setError("ইউটিউবে সার্চ খুলেছে — পছন্দের ভিডিওর লিংক কপি করে এখানে পেস্ট করুন।");
      } else setError("একটি ইউটিউব লিংক দিন।");
      return;
    }
    if (queue.some((t) => t.id === id)) {
      setError("এই গানটি আগেই কুইতে আছে।");
      return;
    }
    setBusy(true);
    const track = await fetchTrack(id);
    setQueue((q) => [...q, track]);
    setInput("");
    setBusy(false);
    if (player.index === null) setTimeout(() => player.playAt(queue.length), 50);
  }

  function remove(i: number) {
    setQueue((q) => q.filter((_, k) => k !== i));
    if (player.index !== null && i < player.index) player.setIndex(player.index - 1);
    else if (player.index === i) player.setIndex(null);
  }

  const { current, playing, time, duration } = player;
  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div className="relative min-h-screen overflow-hidden font-body">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="animate-glow absolute -top-24 -left-16 size-72 rounded-full bg-sun/60 blur-3xl" />
        <div className="animate-glow absolute top-1/3 -right-20 size-80 rounded-full bg-mint/60 blur-3xl" style={{ animationDelay: "-6s" }} />
        <div className="animate-glow absolute bottom-24 left-1/4 size-72 rounded-full bg-rose/50 blur-3xl" style={{ animationDelay: "-3s" }} />
        <div className="animate-glow absolute -bottom-16 right-6 size-60 rounded-full bg-lilac/60 blur-3xl" style={{ animationDelay: "-9s" }} />
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-[420px] flex-col px-5 pb-32">
        <header className="flex items-center justify-between pt-6">
          <div className="flex items-center gap-2.5">
            <div className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-primary">
              <Eq className="bg-primary-foreground" />
            </div>
            <div className="leading-none">
              <h1 className="font-display text-lg font-bold tracking-tight">Echo</h1>
              <p className="text-[11px] text-muted-foreground">শোনো, বিরতি ছাড়া</p>
            </div>
          </div>
          <span className="rounded-full bg-glass px-3 py-1 text-[11px] font-medium ring-1 ring-border">সাইন-ইন লাগে না</span>
        </header>

        <section className="glass mt-5 rounded-3xl p-4">
          <label htmlFor="yt" className="font-display text-base font-semibold">নতুন গান যোগ করুন</label>
          <p className="text-[13px] text-muted-foreground">ইউটিউব লিংক পেস্ট করুন বা গানের নাম লিখুন</p>
          <form onSubmit={addTrack}>
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-background px-3 py-2.5 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
              <span className="block size-2.5 shrink-0 rounded-full ring-2 ring-lilac" aria-hidden />
              <input
                id="yt"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="https://youtu.be/…"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                inputMode="url"
                autoComplete="off"
              />
            </div>
            {error && <p className="mt-2 text-[12px] text-muted-foreground">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-3 w-full rounded-2xl bg-primary py-3 font-display text-[15px] font-semibold text-primary-foreground shadow-primary transition active:scale-[0.98] disabled:opacity-60"
            >
              {busy ? "যোগ হচ্ছে…" : "কুইতে যোগ করুন"}
            </button>
          </form>
        </section>

        <div className="mt-6 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">আজকের কুই</h2>
          <span className="rounded-full bg-mint/70 px-3 py-1 text-[12px] font-medium ring-1 ring-border">{queue.length} টি গান</span>
        </div>

        {hydrated && queue.length === 0 && (
          <p className="glass mt-3 rounded-3xl p-5 text-center text-[13px] text-muted-foreground">
            কুই খালি। উপরে একটি ইউটিউব লিংক পেস্ট করলেই গান শুরু হবে।
          </p>
        )}

        <ul className="mt-3 space-y-2.5">
          {queue.map((t, i) => {
            const active = player.index === i;
            return (
              <li
                key={t.id}
                className={`flex items-center gap-3 rounded-3xl p-2.5 ring-1 ${active ? "bg-primary-soft/80 ring-primary/25" : "glass ring-border"}`}
              >
                <button onClick={() => player.playAt(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <img src={t.thumbnail} alt="" className="size-14 shrink-0 rounded-[14px] object-cover ring-1 ring-border" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[15px] font-semibold">{t.title}</span>
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

        <section className="glass mt-8 rounded-3xl p-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <p className="font-display text-sm font-semibold text-foreground">ব্যাকগ্রাউন্ডে চালাতে</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>ব্রাউজারের মেনু থেকে <b className="text-foreground">Add to Home screen</b> করে অ্যাপের মতো খুলুন।</li>
            <li>প্লে চালু রেখে স্ক্রিন অফ করুন — লক-স্ক্রিন থেকেই প্লে/পজ, পরের গান করা যাবে।</li>
            <li>ইউটিউবে সাইন-ইন লাগবে না; শুধু লিংক পেস্ট করলেই চলবে।</li>
          </ul>
        </section>
      </main>

      {/* Player iframe: hidden inside the now-playing sheet's artwork */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[420px] flex-col bg-background/95 backdrop-blur-xl transition-transform duration-500 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] ${open ? "translate-y-0" : "translate-y-full"}`}
        style={{ height: "100dvh" }}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <button onClick={() => setOpen(false)} aria-label="বন্ধ" className="grid size-10 place-items-center rounded-2xl bg-glass ring-1 ring-border">
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
        <div className="mx-5 mt-6 aspect-video overflow-hidden rounded-3xl bg-lilac/40 ring-1 ring-border">
          <div id={PLAYER_ID} className="size-full" />
        </div>
        <div className="px-5 pt-6">
          <p className="truncate font-display text-xl font-bold">{current?.title ?? "কোনো গান বাছাই হয়নি"}</p>
          <p className="truncate text-sm text-muted-foreground">{current?.author ?? "কুই থেকে একটি গান বেছে নিন"}</p>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={Math.min(time, duration || 0)}
            onChange={(e) => player.seek(Number(e.target.value))}
            className="mt-5 w-full accent-primary"
            aria-label="সিক"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{formatTime(time)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <div className="mt-6 flex items-center justify-center gap-5">
            <button onClick={player.prev} aria-label="আগের গান" className="grid size-14 place-items-center rounded-2xl bg-glass ring-1 ring-border"><SkipIcon back /></button>
            <button onClick={player.toggle} aria-label={playing ? "পজ" : "প্লে"} className="grid size-[72px] place-items-center rounded-3xl bg-primary text-primary-foreground shadow-primary">
              <PlayIcon playing={playing} />
            </button>
            <button onClick={player.next} aria-label="পরের গান" className="grid size-14 place-items-center rounded-2xl bg-glass ring-1 ring-border"><SkipIcon /></button>
          </div>
        </div>
      </div>

      {/* Mini player */}
      {!open && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[420px] px-4 pb-4">
          <div className="glass relative overflow-hidden rounded-3xl p-2.5 pr-3">
            <div className="absolute inset-x-0 top-0 h-[3px] bg-primary/15"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
            <div className="flex items-center gap-3">
              <button onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                {current ? (
                  <img src={current.thumbnail} alt="" className="size-12 shrink-0 rounded-[12px] object-cover ring-1 ring-border" />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-rose ring-1 ring-border"><Eq className="bg-foreground/40" /></span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[14px] font-semibold">{current?.title ?? "Echo"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{current?.author ?? "গান বেছে নিন"}</span>
                </span>
              </button>
              <button onClick={player.toggle} aria-label={playing ? "পজ" : "প্লে"} className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-primary">
                <PlayIcon playing={playing} />
              </button>
              <button onClick={player.next} aria-label="পরের গান" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-background ring-1 ring-border"><SkipIcon /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
