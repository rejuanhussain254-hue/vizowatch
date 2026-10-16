import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "সাইন-ইন — Echo" },
      { name: "description", content: "Echo-তে সাইন-ইন করুন, আপনার দেখা ভিডিওর ইতিহাস সব ডিভাইসে সিঙ্ক হবে।" },
      { property: "og:title", content: "সাইন-ইন — Echo" },
      { property: "og:description", content: "ইতিহাস সব ডিভাইসে সিঙ্ক করতে সাইন-ইন করুন।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  // already signed in → go home
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function google() {
    setBusy(true);
    setMsg(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
      extraParams: {
        prompt: "select_account",
      },
    });
    if (result.error) {
      setMsg({ kind: "error", text: "গুগল সাইন-ইন হয়নি, আবার চেষ্টা করুন।" });
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/", replace: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ kind: "error", text: "ইমেইল বা পাসওয়ার্ড ভুল।" });
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setMsg({ kind: "error", text: error.message.includes("already") ? "এই ইমেইলে আগেই অ্যাকাউন্ট আছে।" : "অ্যাকাউন্ট তৈরি হয়নি, আবার চেষ্টা করুন।" });
      else if (!data.session) setMsg({ kind: "ok", text: "ইমেইল চেক করুন — নিশ্চিত করার লিংক পাঠানো হয়েছে।" });
    }
    setBusy(false);
  }

  return (
    <div className="relative min-h-screen overflow-hidden font-body">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="animate-glow absolute -top-24 -left-16 size-72 rounded-full bg-sun/60 blur-3xl" />
        <div className="animate-glow absolute top-1/3 -right-20 size-80 rounded-full bg-mint/60 blur-3xl" style={{ animationDelay: "-6s" }} />
        <div className="animate-glow absolute -bottom-16 left-1/4 size-72 rounded-full bg-rose/50 blur-3xl" style={{ animationDelay: "-3s" }} />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full min-w-0 max-w-[420px] flex-col px-5 pb-[max(4rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
        <Link to="/" className="self-start rounded-full bg-glass px-3 py-1 text-[12px] font-medium ring-1 ring-border">← ফিরে যান</Link>

        <section className="glass mt-8 rounded-3xl p-5">
          <h1 className="font-display text-2xl font-bold tracking-tight">{mode === "in" ? "সাইন-ইন করুন" : "অ্যাকাউন্ট খুলুন"}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">আপনার দেখা ভিডিওর ইতিহাস ও রিজিউম পজিশন সব ডিভাইসে সিঙ্ক থাকবে।</p>

          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-background px-4 py-3 font-display text-[14px] font-semibold ring-1 ring-border transition hover:bg-primary-soft/60 disabled:opacity-60"
          >
            <GoogleMark />
            গুগল দিয়ে চালিয়ে যান
          </button>

          <div className="my-4 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />অথবা ইমেইল দিয়ে<span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={submit} className="space-y-2.5">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="ইমেইল"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-2xl bg-background px-4 py-3 text-base ring-1 ring-border outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              placeholder="পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl bg-background px-4 py-3 text-base ring-1 ring-border outline-none focus:ring-2 focus:ring-ring"
            />
            {msg && (
              <p role="status" className={`rounded-2xl px-4 py-2.5 text-[13px] ${msg.kind === "error" ? "bg-rose/40 text-foreground" : "bg-mint/50 text-foreground"}`}>{msg.text}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-primary px-4 py-3 font-display text-[14px] font-semibold text-primary-foreground shadow-primary transition disabled:opacity-60"
            >
              {busy ? "অপেক্ষা করুন…" : mode === "in" ? "সাইন-ইন" : "অ্যাকাউন্ট তৈরি করুন"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }}
            className="mt-4 w-full text-center text-[13px] text-muted-foreground"
          >
            {mode === "in" ? <>অ্যাকাউন্ট নেই? <b className="text-foreground">খুলে নিন</b></> : <>আগেই অ্যাকাউন্ট আছে? <b className="text-foreground">সাইন-ইন</b></>}
          </button>
        </section>
      </main>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-8-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l8-6.2z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.5-5.8c-2.1 1.4-4.8 2.3-8 2.3-6.2 0-11.5-4.1-13.4-9.8l-8 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
