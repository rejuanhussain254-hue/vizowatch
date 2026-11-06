import { useState, useEffect, useRef } from "react";
import {
  AUDIO_PRESETS,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  playAudioEffectTest,
  playLiveSliderPreview,
  type AudioPresetId,
  type AudioSettings,
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
      const next = { ...prev, [key]: value };
      saveAudioSettings(next);
      onApply?.(next);
      // Real-time live audio feedback
      if (key === "bassBoost") playLiveSliderPreview(next, "bass");
      else if (key === "vocalBoost") playLiveSliderPreview(next, "vocal");
      else if (key === "volumeBoost") playLiveSliderPreview(next, "volume");
      return next;
    });
  };

  const handleSelectPreset = (presetId: AudioPresetId) => {
    const p = AUDIO_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setSettings((prev) => {
      const next: AudioSettings = {
        ...prev,
        preset: presetId,
        bands: { ...p.bands },
        bassBoost: p.bassBoost,
        vocalBoost: p.vocalBoost,
        surround3D: p.surround3D,
      };
      saveAudioSettings(next);
      onApply?.(next);

      // Trigger instant audible preview matching the chosen preset
      if (presetId === "tilawat" || presetId === "haramain") {
        playAudioEffectTest(next, "tilawat");
      } else {
        playAudioEffectTest(next, "general");
      }

      return next;
    });
  };

  const handleBandChange = (freq: keyof AudioSettings["bands"], val: number) => {
    setSettings((prev) => {
      const next: AudioSettings = {
        ...prev,
        preset: "custom",
        bands: {
          ...prev.bands,
          [freq]: val,
        },
      };
      saveAudioSettings(next);
      onApply?.(next);
      // Real-time live EQ band audio feedback
      playLiveSliderPreview(next, freq);
      return next;
    });
  };

  const handleReset = () => {
    setSettings(DEFAULT_AUDIO_SETTINGS);
    saveAudioSettings(DEFAULT_AUDIO_SETTINGS);
    onApply?.(DEFAULT_AUDIO_SETTINGS);
    playAudioEffectTest(DEFAULT_AUDIO_SETTINGS, "general");
  };

  const handleTestSound = (mode: "general" | "tilawat") => {
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
        className="flex max-h-[90dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[32px] sm:rounded-3xl bg-background border border-border/80 shadow-2xl animate-in slide-in-from-bottom duration-300"
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
          {/* Live Indicator Banner */}
          <div className="flex items-center justify-between rounded-2xl bg-emerald-500/10 p-3 ring-1 ring-emerald-500/25 text-emerald-600 dark:text-emerald-400">
            <div className="flex items-center gap-2 text-[12px] font-bold">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>লাইভ সাউন্ড টিউনিং সক্রিয় — যেকোনো পরিবর্তনে শব্দ সরাসরি পরিবর্তন হবে</span>
            </div>
          </div>

          {/* Sound Test Live Bar with Dedicated Tilawat Test */}
          <div className="rounded-2xl bg-gradient-to-r from-primary/10 via-indigo-500/10 to-primary/5 p-3.5 ring-1 ring-primary/25 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔊</span>
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
                disabled={isPlayingTest !== null}
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
                disabled={isPlayingTest !== null}
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
                {AUDIO_PRESETS.find((p) => p.id === settings.preset)?.name ?? "কাস্টম"}
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

          {/* Quick Enhancers: Bass, Vocal, Volume */}
          <div className="space-y-3.5 rounded-2xl bg-muted/20 p-4 ring-1 ring-border/60">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-[13.5px] font-bold text-foreground">
                ⚡ লাইভ সাউন্ড এনহ্যান্সার টিউনিং
              </h3>
              <span className="text-[10px] text-muted-foreground">স্লাইডার নাড়ালেই লাইভ শুনবেন</span>
            </div>

            {/* Vocal Boost Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px] font-medium">
                <span className="flex items-center gap-1.5 text-foreground font-semibold">
                  <span>🎙️ ভোকাল ও মাখরাজ ক্লিয়ারিটি (কণ্ঠ ও তাজবীদ স্পষ্ট)</span>
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

            {/* Volume Booster Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px] font-medium">
                <span className="flex items-center gap-1.5 text-foreground font-semibold">
                  <span>📢 সুপার ভলিউম বুস্টার</span>
                </span>
                <span className="font-display font-bold text-primary">{settings.volumeBoost}%</span>
              </div>
              <input
                type="range"
                min="100"
                max="150"
                step="5"
                value={settings.volumeBoost}
                onChange={(e) => updateSetting("volumeBoost", Number(e.target.value))}
                className="w-full accent-primary cursor-pointer h-2 bg-muted rounded-lg"
              />
              <p className="text-[10px] text-muted-foreground">কম আওয়াজের তিলাওয়াত বা পুরোনো রেকর্ডিংয়ের জন্য ১৫০% পর্যন্ত ভলিউম</p>
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
                    3D স্প্যাশিয়াল সারাউন্ড ও মসজিদ রেজোন্যান্স
                  </span>
                  <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-indigo-500">
                    3D
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  হেডফোন বা স্পিকারে মসজিদের গম্বুজের মতো আধ্যাত্মিক ও প্রশস্ত সাউন্ড অনুভূতি
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.surround3D}
                onChange={(e) => updateSetting("surround3D", e.target.checked)}
                className="size-5 accent-primary cursor-pointer rounded shrink-0"
              />
            </label>

            {/* HQ 160kbps Stream Toggle */}
            <label className="flex items-center justify-between rounded-2xl bg-muted/30 p-3.5 ring-1 ring-border/70 cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="pr-3">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[13px] font-bold text-foreground">
                    হাই-ফিডেলিটি অডিও (Hi-Fi 160kbps Opus)
                  </span>
                  <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-600">
                    HD
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  ইউটিউব থেকে সর্বোচ্চ বিটরেটের ক্রিস্প ও স্টুডিও অডিও স্ট্রিম লোড করে
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

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-xl px-3 py-1.5 font-display text-[12px] font-bold text-muted-foreground hover:text-foreground transition-colors"
          >
            ডিফল্ট রিসেট
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
