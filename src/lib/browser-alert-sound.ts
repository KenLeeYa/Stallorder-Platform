export type AlertSoundPreset = "URGENT" | "BELL" | "CHIME" | "CUSTOM";

export type AlertSoundOptions = {
  preset?: AlertSoundPreset;
  volume?: number;
  repeatCount?: number;
  customUrl?: string | null;
};

type BrowserAudioContext = AudioContext & { state: AudioContextState };

let sharedContext: BrowserAudioContext | null = null;
const activeAudio = new Set<HTMLAudioElement>();

export function normalizeAlertSoundOptions(options: AlertSoundOptions = {}) {
  return {
    preset: options.preset ?? "URGENT",
    volume: Math.min(100, Math.max(10, Math.round(options.volume ?? 100))),
    repeatCount: Math.min(3, Math.max(1, Math.round(options.repeatCount ?? 2))),
    customUrl: options.customUrl?.trim() || null,
  };
}

export async function primeAlertSound() {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") await context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
}

export async function playAlertSound(options: AlertSoundOptions = {}) {
  const normalized = normalizeAlertSoundOptions(options);
  if (normalized.preset === "CUSTOM" && normalized.customUrl) {
    const customPlayed = await playCustomSound(
      normalized.customUrl,
      normalized.volume / 100,
      normalized.repeatCount,
    );
    if (customPlayed) return true;
  }
  return playPresetSound(
    normalized.preset === "CUSTOM" ? "URGENT" : normalized.preset,
    normalized.volume / 100,
    normalized.repeatCount,
  );
}

async function playCustomSound(url: string, volume: number, repeatCount: number) {
  if (typeof Audio === "undefined") return false;
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = volume;
  activeAudio.add(audio);
  let remaining = repeatCount;
  const release = () => activeAudio.delete(audio);
  audio.addEventListener("ended", () => {
    remaining -= 1;
    if (remaining <= 0) {
      release();
      return;
    }
    audio.currentTime = 0;
    void audio.play().catch(release);
  });
  audio.addEventListener("error", release, { once: true });
  try {
    await audio.play();
    return true;
  } catch {
    release();
    return false;
  }
}

async function playPresetSound(
  preset: Exclude<AlertSoundPreset, "CUSTOM">,
  volume: number,
  repeatCount: number,
) {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;
    const pattern = preset === "BELL"
      ? [[1046, 0.42, 0.2]]
      : preset === "CHIME"
        ? [[659, 0.15, 0.03], [784, 0.15, 0.03], [1046, 0.32, 0.18]]
        : [[880, 0.18, 0.07], [1175, 0.28, 0.2]];
    let startAt = context.currentTime + 0.02;
    for (let repeat = 0; repeat < repeatCount; repeat += 1) {
      for (const [frequency, duration, gap] of pattern) {
        scheduleTone(context, frequency, startAt, duration, volume);
        startAt += duration + gap;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function scheduleTone(
  context: BrowserAudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  volume: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.02, volume * 0.55), startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (sharedContext && sharedContext.state !== "closed") return sharedContext;
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  sharedContext = new AudioContextConstructor() as BrowserAudioContext;
  return sharedContext;
}
