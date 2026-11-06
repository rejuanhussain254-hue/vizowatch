// Professional Audio Settings & Equalizer System for VizoWatch

export type AudioPresetId =
  | "flat"
  | "bass_boost"
  | "vocal_clarity"
  | "studio_surround"
  | "treble_boost"
  | "cinema"
  | "acoustic"
  | "custom";

export type EqBands = {
  "60": number; // Sub-bass
  "230": number; // Bass
  "910": number; // Midrange
  "3600": number; // Upper midrange / Vocals
  "14000": number; // Treble / Brilliance
};

export type AudioSettings = {
  preset: AudioPresetId;
  bands: EqBands;
  bassBoost: number; // 0 - 100
  vocalBoost: number; // 0 - 100
  surround3D: boolean;
  volumeBoost: number; // 100 - 150%
  hqAudio: boolean; // High-Fidelity 160kbps Opus stream
  loudnessNorm: boolean; // Auto-normalize loudness
  speed: number; // 0.75 - 2.0x
};

export type PresetDefinition = {
  id: AudioPresetId;
  name: string;
  enName: string;
  desc: string;
  icon: string;
  badge?: string;
  bands: EqBands;
  bassBoost: number;
  vocalBoost: number;
  surround3D: boolean;
};

export const AUDIO_PRESETS: PresetDefinition[] = [
  {
    id: "flat",
    name: "ফ্ল্যাট (স্টুডিও ব্যালেন্স)",
    enName: "Studio Flat",
    desc: "অরিজিনাল রেকর্ডিংয়ের নিখুঁত ভারসাম্যপূর্ণ সাউন্ড",
    icon: "🎚️",
    bands: { "60": 0, "230": 0, "910": 0, "3600": 0, "14000": 0 },
    bassBoost: 0,
    vocalBoost: 0,
    surround3D: false,
  },
  {
    id: "bass_boost",
    name: "ডিপ বেস বুস্ট (DJ & Beat)",
    enName: "Deep Bass Boost",
    desc: "ভারী পাঞ্চি বেস ও ড্রামস — গান ও ডিজে রিমিক্সের জন্য সেরা",
    icon: "🔊",
    badge: "জনপ্রিয়",
    bands: { "60": 9, "230": 6, "910": 1, "3600": -1, "14000": 2 },
    bassBoost: 80,
    vocalBoost: 10,
    surround3D: false,
  },
  {
    id: "vocal_clarity",
    name: "স্পষ্ট কণ্ঠ (ভোকাল ও নাটক)",
    enName: "Vocal Clarity",
    desc: "নাটক, মুভি ও আলোচনার কথাগুলো পরিষ্কার ও স্পষ্ট শোনাবে",
    icon: "🎙️",
    badge: "সুপার ক্লিয়ার",
    bands: { "60": -3, "230": 1, "910": 5, "3600": 8, "14000": 4 },
    bassBoost: 15,
    vocalBoost: 90,
    surround3D: false,
  },
  {
    id: "studio_surround",
    name: "থ্রিডি স্টুডিও সারাউন্ড (3D)",
    enName: "3D Spatial Surround",
    desc: "হেডফোনে চারপাশ থেকে লাইভ কনসার্টের মতো স্প্যাশিয়াল অনুভূতি",
    icon: "🎧",
    badge: "হেডফোন স্পেশাল",
    bands: { "60": 5, "230": 3, "910": 1, "3600": 4, "14000": 7 },
    bassBoost: 45,
    vocalBoost: 40,
    surround3D: true,
  },
  {
    id: "treble_boost",
    name: "ট্রেবল ও মেলোডি বুস্টার",
    enName: "Crisp Treble & Melody",
    desc: "বাঁশি, গিটার, ভায়োলিন ও হাই-ফ্রিকোয়েন্সি ক্রিস্প ডিটেইলস",
    icon: "🎸",
    bands: { "60": -2, "230": 0, "910": 3, "3600": 7, "14000": 10 },
    bassBoost: 10,
    vocalBoost: 50,
    surround3D: false,
  },
  {
    id: "cinema",
    name: "সিনেমা থিয়েটার (Dolby স্টাইল)",
    enName: "Cinema Theater",
    desc: "চলচ্চিত্রের সিনেমাটিক এফেক্ট ও ব্যাকগ্রাউন্ড মিউজিক ডাইনামিক্স",
    icon: "🎬",
    bands: { "60": 7, "230": 4, "910": 0, "3600": 5, "14000": 6 },
    bassBoost: 60,
    vocalBoost: 50,
    surround3D: true,
  },
  {
    id: "acoustic",
    name: "সফট ও রিলাক্সিং (নাইট মোড)",
    enName: "Soft Acoustic / Night",
    desc: "রাতে আরামদায়ক মৃদু সাউন্ড যাতে কানে কোনো চাপ না পড়ে",
    icon: "🌙",
    bands: { "60": 2, "230": 1, "910": 0, "3600": -2, "14000": -4 },
    bassBoost: 20,
    vocalBoost: 20,
    surround3D: false,
  },
];

const STORAGE_KEY = "echo.audio_settings_v1";

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  preset: "bass_boost",
  bands: { "60": 9, "230": 6, "910": 1, "3600": -1, "14000": 2 },
  bassBoost: 80,
  vocalBoost: 10,
  surround3D: false,
  volumeBoost: 100,
  hqAudio: true,
  loudnessNorm: true,
  speed: 1.0,
};

export function loadAudioSettings(): AudioSettings {
  if (typeof window === "undefined") return DEFAULT_AUDIO_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUDIO_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      preset: parsed.preset ?? DEFAULT_AUDIO_SETTINGS.preset,
      bands: { ...DEFAULT_AUDIO_SETTINGS.bands, ...(parsed.bands ?? {}) },
      bassBoost: typeof parsed.bassBoost === "number" ? parsed.bassBoost : DEFAULT_AUDIO_SETTINGS.bassBoost,
      vocalBoost: typeof parsed.vocalBoost === "number" ? parsed.vocalBoost : DEFAULT_AUDIO_SETTINGS.vocalBoost,
      surround3D: typeof parsed.surround3D === "boolean" ? parsed.surround3D : DEFAULT_AUDIO_SETTINGS.surround3D,
      volumeBoost: typeof parsed.volumeBoost === "number" ? parsed.volumeBoost : DEFAULT_AUDIO_SETTINGS.volumeBoost,
      hqAudio: typeof parsed.hqAudio === "boolean" ? parsed.hqAudio : DEFAULT_AUDIO_SETTINGS.hqAudio,
      loudnessNorm: typeof parsed.loudnessNorm === "boolean" ? parsed.loudnessNorm : DEFAULT_AUDIO_SETTINGS.loudnessNorm,
      speed: typeof parsed.speed === "number" ? parsed.speed : DEFAULT_AUDIO_SETTINGS.speed,
    };
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function saveAudioSettings(settings: AudioSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("echo:audio-settings-change", { detail: settings }));
  } catch {}
}

// Live Sound Effect Preview via Web Audio API
let previewAudioContext: AudioContext | null = null;
export function playAudioEffectTest(settings: AudioSettings) {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    if (!previewAudioContext || previewAudioContext.state === "closed") {
      previewAudioContext = new AudioCtx();
    }
    const ctx = previewAudioContext;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    const gainValue = (settings.volumeBoost / 100) * 0.28;
    masterGain.gain.setValueAtTime(gainValue, now);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

    // 5-Band Biquad Filter Chain
    const filter60 = ctx.createBiquadFilter();
    filter60.type = "lowshelf";
    filter60.frequency.value = 60;
    filter60.gain.value = settings.bands["60"] + (settings.bassBoost / 100) * 8;

    const filter230 = ctx.createBiquadFilter();
    filter230.type = "peaking";
    filter230.frequency.value = 230;
    filter230.gain.value = settings.bands["230"] + (settings.bassBoost / 100) * 4;

    const filter910 = ctx.createBiquadFilter();
    filter910.type = "peaking";
    filter910.frequency.value = 910;
    filter910.gain.value = settings.bands["910"] + (settings.vocalBoost / 100) * 3;

    const filter3600 = ctx.createBiquadFilter();
    filter3600.type = "peaking";
    filter3600.frequency.value = 3600;
    filter3600.gain.value = settings.bands["3600"] + (settings.vocalBoost / 100) * 6;

    const filter14000 = ctx.createBiquadFilter();
    filter14000.type = "highshelf";
    filter14000.frequency.value = 14000;
    filter14000.gain.value = settings.bands["14000"];

    // Connect Filter Chain
    filter60.connect(filter230);
    filter230.connect(filter910);
    filter910.connect(filter3600);
    filter3600.connect(filter14000);
    filter14000.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Synthesize rich harmonic chord (Sub-bass, Root, Fifth, Octave, High chime)
    const freqs = [65.41, 130.81, 261.63, 392.0, 523.25, 1046.5];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = idx === 0 ? "sine" : idx < 3 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, now);

      const amp = 0.3 / freqs.length;
      oscGain.gain.setValueAtTime(amp, now);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, now + (idx === 0 ? 1.4 : 1.1));

      osc.connect(oscGain);
      oscGain.connect(filter60);

      osc.start(now);
      osc.stop(now + 1.45);
    });
  } catch (e) {
    console.error("playAudioEffectTest error", e);
  }
}
