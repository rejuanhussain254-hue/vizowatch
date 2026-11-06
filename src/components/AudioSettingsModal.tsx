import { useState, useEffect } from "react";
import {
  AUDIO_PRESETS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_CUSTOM_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  playAudioEffectTest,
  playLiveSliderPreview,
  type AudioPresetId,
  type AudioSettings,
  type CustomSettings,
} from "@/lib/audio-settings";

type AudioSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onApply?: (settings: AudioSettings) => void;
};

export function AudioSettingsModal({ open, onClose, onApply }: AudioSettingsModalProps) {
  const [settings, setSettings] = useState<AudioSettings>(loadAudioSettings);
  const [showAdvancedEq, setShowAdvancedEq] = useState(false);
  const [isPlayingTest, setIsPlayingTest] = useState<"general" | "tilawat" | null>(null);

  useEffect(() => {
    if (open) {
      setSettings(loadAudioSettings());
    }
  }, [open]);

  if (!open) return null;

  const updateSetting = <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    setSettings((prev) => {
      // If user adjusts sound effects (bass, vocal, surround), preserve into lastCustom and switch to 'custom'
      let nextPreset = prev.preset;
      let nextLastCustom = prev.lastCustom ? { ...prev.lastCustom } : { ...DEFAULT_CUSTOM_SETTINGS };

      if (key === "bassBoost" || key === "vocalBoost" || key === "surround3D") {
        nextPreset = "custom";
        nextLastCustom = {
          ...nextLastCustom,
          [key]: value as any,
        };
      } else if (key === "volumeBoost") {
        nextLastCustom.volumeBoost = value as number;
      } else if (key === "speed") {
        nextLastCustom.speed = value as number;
      }

      const next: AudioSettings = {
        ...prev,
        [key]: value,
        preset: nextPreset,
        lastCustom: nextLastCustom,
      };

      saveAudioSettings(next);
      onApply?.(next);

      // Real-time live audio feedback if enabled
      if (next.enabled) {
        if (key === "bassBoost") playLiveSliderPreview(next, "bass");
        else if (key === "vocalBoost") playLiveSliderPreview(next, "vocal");
        else if (key === "volumeBoost") playLiveSliderPreview(next, "volume");
      }
      return next;
    });
  };

  const handleSelectPreset = (presetId: AudioPresetId) => {
    setSettings((prev) => {
      let next: AudioSettings;

      if (presetId === "custom") {
        // Restore user's last custom settings
        const c = prev.lastCustom || DEFAULT_CUSTOM_SETTINGS;
        next = {
          ...prev,
          preset: "custom",
          bands: { ...c.bands },
          bassBoost: c.bassBoost,
          vocalBoost: c.vocalBoost,
          surround3D: c.surround3D,
          volumeBoost: typeof c.volumeBoost === "number" ? c.volumeBoost : prev.volumeBoost,
          speed: typeof c.speed === "number" ? c.speed : prev.speed,
        };
      } else {
        const p = AUDIO_PRESETS.find((x) => x.id === presetId);
        if (!p) return prev;
        next = {
          ...prev,
          preset: presetId,
          bands: { ...p.bands },
          bassBoost: p.bassBoost,
          vocalBoost: p.vocalBoost,
          surround3D: p.surround3D,
          // Preset switch keeps lastCustom intact!
        };
      }

      saveAudioSettings(next);
      onApply?.(next);

      // Trigger audible test preview matching preset if enabled
      if (next.enabled) {
        if (presetId === "tilawat" || presetId === "haramain") {
          playAudioEffectTest(next, "tilawat");
        } else {
          playAudioEffectTest(next, "general");
        }
      }

      return next;
    });
  };

  const handleBandChange = (freq: keyof AudioSettings["bands"], val: number) => {
    setSettings((prev) => {
      const nextBands = {
        ...prev.bands,
        [freq]: val,
      };
      const nextLastCustom: CustomSettings = {
        bands: nextBands,
        bassBoost: prev.bassBoost,
        vocalBoost: prev.vocalBoost,
        surround3D: prev.surround3D,
        volumeBoost: prev.volumeBoost,
        speed: prev.speed,
      };

      const next: AudioSettings = {
        ...prev,
        preset: "custom",
        bands: nextBands,
        lastCustom: nextLastCustom,
      };

      saveAudioSettings(next);
      onApply?.(next);

      // Real-time live EQ band audio feedback
      if (next.enabled) {
        playLiveSliderPreview(next, freq);
      }
      return next;
    });
  };

  const handleReset = () => {
    setSettings(DEFAULT_AUDIO_SETTINGS);
    saveAudioSettings(DEFAULT_AUDIO_SETTINGS);
    onApply?.(DEFAULT_AUDIO_SETTINGS);
    if (DEFAULT_AUDIO_SETTINGS.enabled) {
      playAudioEffectTest(DEFAULT_AUDIO_SETTINGS, "general");
    }
  };

  const handleTestSound = (mode: "general" | "tilawat") => {
    if (!settings.enabled) return;
    setIsPlayingTest(mode);
    playAudioEffectTest(settings, mode);
    setTimeout(() => setIsPlayingTest(null), mode === "tilawat" ? 1800 : 1400);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-settings-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[32px] sm:rounded-3xl bg-background border border-border/80 shadow-2xl animate-in slide-in-from-bottom duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-tr from-primary to-indigo-600 text-white shadow-md shadow-primary/25">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
              </svg>
            </div>
            <div>
              <h2 id="audio-settings-title" className="font-display text-[16px] font-bold text-foreground">
                সাউন্ড ও অডিও সেটিংস
              </h2>
              <p className="text-[11.5px] text-muted-foreground font-medium">কুরআন তিলাওয়াত, ইকুয়ালাইজার ও লাইভ টিউনিং</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="বন্ধ করুন"
            className="grid size-8 place-items-center rounded-full bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-90"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

          {/* MASTER ON / OFF SWITCH */}
          <div
            className={`p-4 rounded-2xl flex items-center justify-between border transition-all ${
              settings.enabled
                ? "bg-gradient-to-r from-primary/10 via-emerald-500/10 to-primary/5 border-primary/30 shadow-sm"
                : "bg-muted/40 border-border/70"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`grid size-10 place-items-center rounded-xl text-lg transition-transform ${
                  settings.enabled
                    ? "bg-primary text-white shadow-md shadow-primary/30 scale-105"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {settings.enabled ? "🔊" : "🔇"}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-[14.5px] font-bold text-foreground">
                    সাউন্ড সেটিং ও ইকুয়ালাইজার
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                      settings.enabled
                        ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {settings.enabled ? "অন (ON)" : "বন্ধ (OFF)"}
                  </span>
                </div>
                <p className="text-[11.5px] text-muted-foreground mt-0.5">
                  {settings.enabled
                    ? "সাউন্ড এফেক্ট সক্রিয় — প্রিসেট, বেস ও ইকুয়ালাইজার কাজ করছে"
                    : "সাউন্ড এফেক্ট সম্পূর্ণ বন্ধ — অরিজিনাল সাউন্ডে চলবে"}
                </p>
              </div>
            </div>

            {/* Switch Toggle Button */}
            <button
              type="button"
              role="switch"
              aria-checked={settings.enabled}
              onClick={() => updateSetting("enabled", !settings.enabled)}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                settings.enabled ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  settings.enabled ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Warning / Notice when disabled */}
          {!settings.enabled && (
            <div className="rounded-2xl bg-amber-500/10 p-3 ring-1 ring-amber-500/25 text-amber-700 dark:text-amber-400 text-[11.5px] font-medium flex items-center gap-2">
              <span>⚠️</span>
              <span>সাউন্ড এফেক্ট বন্ধ রয়েছে। সব অপশন ব্যবহার করতে উপরের সুইচটি অন করুন।</span>
            </div>
          )}

          {/* Section Container with Disabled Opacity if OFF */}
          <div className={`space-y-4 transition-opacity duration-200 ${settings.enabled ? "opacity-100" : "opacity-45 pointer-events-none"}`}>

            {/* Sound Test Live Bar with Dedicated Tilawat Test */}
            <div className="rounded-2xl bg-gradient-to-r from-primary/10 via-indigo-500/10 to-primary/5 p-3.5 ring-1 ring-primary/25 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎵</span>
                  <div>
                    <p className="font-display text-[13px] font-bold text-foreground">
                      লাইভ সাউন্ড টেস্ট শুনুন
                    </p>
                    <p className="text-[11px] text-muted-foreground">বর্তমান সেটিংসে শব্দ কীভাবে শোনাবে যাচাই করুন</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleTestSound("tilawat")}
                  disabled={isPlayingTest !== null || !settings.enabled}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-2 font-display text-[12px] font-bold text-white shadow-sm shadow-emerald-600/25 transition-all hover:opacity-90 active:scale-95 disabled:opacity-75"
                >
                  {isPlayingTest === "tilawat" ? (
                    <>
                      <span className="inline-block size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>তিলাওয়াত বাজছে…</span>
                    </>
                  ) : (
                    <>
                      <span>📖 তিলাওয়াত টেস্ট</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleTestSound("general")}
                  disabled={isPlayingTest !== null || !settings.enabled}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2 font-display text-[12px] font-bold text-primary-foreground shadow-sm shadow-primary/25 transition-all hover:opacity-90 active:scale-95 disabled:opacity-75"
                >
                  {isPlayingTest === "general" ? (
                    <>
                      <span className="inline-block size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>সাউন্ড বাজছে…</span>
                    </>
                  ) : (
                    <>
                      <span>🎵 সাধারণ টেস্ট</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Professional Presets Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-[13.5px] font-bold text-foreground flex items-center gap-1.5">
                  <span>🎚️ সাউন্ড প্রোফাইল ও প্রিসেট</span>
                </h3>
                <span className="text-[11px] font-semibold text-primary">
                  {settings.preset === "custom"
                    ? "🎨 কাস্টম টিউনিং"
                    : AUDIO_PRESETS.find((p) => p.id === settings.preset)?.name ?? "প্রিসেট"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {AUDIO_PRESETS.map((p) => {
                  const active = settings.preset === p.id;
                  const isIslamic = p.id === "tilawat" || p.id === "haramain";
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPreset(p.id)}
                      className={`flex items-center justify-between rounded-2xl p-3 text-left transition-all active:scale-[0.99] ring-1 ${
                        active
                          ? isIslamic
                            ? "bg-emerald-500/15 ring-emerald-500 shadow-md shadow-emerald-500/10"
                            : "bg-primary/10 ring-primary shadow-sm"
                          : "bg-muted/30 ring-border/70 hover:bg-muted/50 hover:ring-border"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl shrink-0">{p.icon}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`font-display text-[13.5px] font-bold leading-tight ${active ? (isIslamic ? "text-emerald-600 dark:text-emerald-400" : "text-primary") : "text-foreground"}`}>
                              {p.name}
                            </p>
                            {p.badge && (
                              <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-extrabold ${isIslamic ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-primary/20 text-primary"}`}>
                                {p.badge}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{p.desc}</p>
                        </div>
                      </div>
                      <div
                        className={`grid size-5 shrink-0 place-items-center rounded-full border transition-all ${
                          active
                            ? isIslamic
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-primary bg-primary text-white"
                            : "border-muted-foreground/30"
                        }`}
                      >
                        {active && <span className="size-1.5 rounded-full bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Enhancers: Bass, Vocal, Volume, Speed */}
            <div className="space-y-3.5 rounded-2xl bg-muted/20 p-4 ring-1 ring-border/60">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-[13.5px] font-bold text-foreground">
                  ⚡ লাইভ সাউন্ড এনহ্যান্সার টিউনিং
                </h3>
                {settings.preset === "custom" && (
                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    🎨 কাস্টমে সংরক্ষিত
                  </span>
                )}
              </div>

              {/* Vocal Boost Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px] font-medium">
                  <span className="flex items-center gap-1.5 text-foreground font-semibold">
                    <span>🎙️ ভোকাল ও মাখরাজ ক্লিয়ারিটি (কণ্ঠ স্পষ্ট)</span>
                  </span>
                  <span className="font-display font-bold text-primary">{settings.vocalBoost}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={settings.vocalBoost}
                  onChange={(e) => updateSetting("vocalBoost", Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer h-2 bg-muted rounded-lg"
                />
                <p className="text-[10px] text-muted-foreground">কুরআন তিলাওয়াত ও আলোচনার কণ্ঠ স্ফটিকের মতো পরিষ্কার করে</p>
              </div>

              {/* Bass Boost Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px] font-medium">
                  <span className="flex items-center gap-1.5 text-foreground font-semibold">
                    <span>🔊 বুক-অনুরণন ও ডিপ বেস বুস্ট</span>
                  </span>
                  <span className="font-display font-bold text-primary">{settings.bassBoost}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={settings.bassBoost}
                  onChange={(e) => updateSetting("bassBoost", Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer h-2 bg-muted rounded-lg"
                />
                <p className="text-[10px] text-muted-foreground">গম্ভীর ক্বারিয়ানা ভয়েস ও ভারী বিটের জন্য</p>
              </div>

              {/* Player Volume Slider (0 - 100%) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px] font-medium">
                  <span className="flex items-center gap-1.5 text-foreground font-semibold">
                    <span>📢 ভিডিও প্লেয়ার ভলিউম</span>
                  </span>
                  <span className="font-display font-bold text-primary">{settings.volumeBoost}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={settings.volumeBoost}
                  onChange={(e) => updateSetting("volumeBoost", Number(e.target.value))}
                  className="w-full accent-primary cursor-pointer h-2 bg-muted rounded-lg"
                />
                <p className="text-[10px] text-muted-foreground">ভিডিও প্লেয়ারের মূল সাউন্ড সরাসরি কম বা বেশি হবে</p>
              </div>

              {/* Playback Speed Selector */}
              <div className="space-y-1.5 pt-1 border-t border-border/40">
                <div className="flex items-center justify-between text-[12px] font-medium">
                  <span className="flex items-center gap-1.5 text-foreground font-semibold">
                    <span>⏱️ প্লেব্যাক স্পিড ও তিলাওয়াত পেস</span>
                  </span>
                  <span className="font-display font-bold text-primary">{settings.speed}x</span>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  {[0.75, 0.85, 1.0, 1.25, 1.5].map((s) => {
                    const active = (settings.speed || 1.0) === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => updateSetting("speed", s)}
                        className={`flex-1 py-1.5 rounded-xl font-display text-[11.5px] font-bold transition-all active:scale-95 ${
                          active
                            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                            : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {s === 1.0 ? "১.০x (স্বাভাবিক)" : s === 0.85 ? "০.৮৫x (তিলাওয়াত)" : `${s}x`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Professional Audio Stream Toggles */}
            <div className="space-y-2.5">
              <h3 className="font-display text-[13.5px] font-bold text-foreground">
                💎 হাই-কোয়ালিটি অডিও স্ট্রিমিং ও ইকো
              </h3>

              {/* 3D Spatial Surround / Mosque Echo Toggle */}
              <label className="flex items-center justify-between rounded-2xl bg-muted/30 p-3.5 ring-1 ring-border/70 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[13px] font-bold text-foreground">
                      🕌 হারামাইন মসজিদ ইকো ও ৩D সারাউন্ড
                    </span>
                    <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-indigo-500">
                      3D Audio
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    মসজিদের গম্বুজের মতো মন জুড়ানো প্রশস্ত অনুরণন ও হেডফোন সারাউন্ড
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.surround3D}
                  onChange={(e) => updateSetting("surround3D", e.target.checked)}
                  className="size-5 accent-primary cursor-pointer rounded shrink-0"
                />
              </label>

              {/* High Fidelity Audio Stream Toggle */}
              <label className="flex items-center justify-between rounded-2xl bg-muted/30 p-3.5 ring-1 ring-border/70 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[13px] font-bold text-foreground">
                      হাই-ফাই স্টুডিও অডিও (160kbps Opus)
                    </span>
                    <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-600">
                      Hi-Res
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    ইউটিউবের সর্বোচ্চ মানের ক্রিস্টাল ক্লিয়ার অডিও স্ট্রিম এনফোর্স করে
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.hqAudio}
                  onChange={(e) => updateSetting("hqAudio", e.target.checked)}
                  className="size-5 accent-primary cursor-pointer rounded shrink-0"
                />
              </label>

              {/* Loudness Normalizer Toggle */}
              <label className="flex items-center justify-between rounded-2xl bg-muted/30 p-3.5 ring-1 ring-border/70 cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="pr-3">
                  <span className="font-display text-[13px] font-bold text-foreground">
                    স্মার্ট লাউডনেস নরমালাইজার
                  </span>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    সব অডিওর আওয়াজ একই লেভেলে রাখবে, হঠাৎ বেশি বা কম হবে না
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.loudnessNorm}
                  onChange={(e) => updateSetting("loudnessNorm", e.target.checked)}
                  className="size-5 accent-primary cursor-pointer rounded shrink-0"
                />
              </label>
            </div>

            {/* 5-Band Studio Equalizer (Expandable) */}
            <div className="rounded-2xl border border-border/80 bg-muted/15 p-3.5">
              <button
                type="button"
                onClick={() => setShowAdvancedEq((v) => !v)}
                className="flex w-full items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">🎛️</span>
                  <div>
                    <p className="font-display text-[13px] font-bold text-foreground">৫-ব্যান্ড স্টুডিও ইকুয়ালাইজার (Advanced)</p>
                    <p className="text-[10.5px] text-muted-foreground">60Hz থেকে 14kHz পর্যন্ত লাইভ ফ্রিকোয়েন্সি টিউনিং</p>
                  </div>
                </div>
                <span className="text-primary font-bold text-xs">{showAdvancedEq ? "সংক্ষেপ ▲" : "খুলুন ▼"}</span>
              </button>

              {showAdvancedEq && (
                <div className="mt-4 pt-3 border-t border-border/50 space-y-3 animate-in fade-in duration-200">
                  {(
                    [
                      { freq: "60", label: "60Hz (সাব-বেস / রাম্বল)" },
                      { freq: "230", label: "230Hz (বুক-অনুরণন ও পাঞ্চ)" },
                      { freq: "910", label: "910Hz (কণ্ঠের বডি / মিডরেঞ্জ)" },
                      { freq: "3600", label: "3.6kHz (তাজবীদ ও মাখরাজ ক্লিয়ারিটি)" },
                      { freq: "14000", label: "14kHz (সিল্কি এয়ার ও ট্রেবল)" },
                    ] as const
                  ).map(({ freq, label }) => {
                    const val = settings.bands[freq];
                    return (
                      <div key={freq} className="space-y-1">
                        <div className="flex justify-between text-[11px] font-semibold">
                          <span className="text-foreground">{label}</span>
                          <span className="text-primary">{val > 0 ? `+${val} dB` : `${val} dB`}</span>
                        </div>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="1"
                          value={val}
                          onChange={(e) => handleBandChange(freq, Number(e.target.value))}
                          className="w-full accent-primary h-1.5 bg-muted rounded-lg"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-xl px-3 py-1.5 font-display text-[12px] font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            🔄 ডিফল্ট রিসেট
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gradient-to-tr from-primary to-indigo-600 px-5 py-2 font-display text-[13px] font-bold text-primary-foreground shadow-md shadow-primary/25 hover:opacity-95 active:scale-95 transition-all"
          >
            সম্পন্ন
          </button>
        </div>
      </div>
    </div>
  );
}
