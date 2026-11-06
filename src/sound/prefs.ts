import { DEFAULT_SOUND_PREFS, type SoundPrefs } from "./types";

const STORAGE_KEY = "thefastypist.sound";

const pickBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

export function parseSoundPrefs(raw: unknown): SoundPrefs {
  const defaults = DEFAULT_SOUND_PREFS;
  if (typeof raw !== "object" || raw === null) return { ...defaults };
  const { enabled, volume, profile, errorSound, release, spread } = raw as Record<string, unknown>;
  return {
    enabled: pickBoolean(enabled, defaults.enabled),
    volume:
      typeof volume === "number" && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : defaults.volume,
    profile: profile === "soft" || profile === "crisp" || profile === "pop" ? profile : defaults.profile,
    errorSound: pickBoolean(errorSound, defaults.errorSound),
    release: pickBoolean(release, defaults.release),
    spread: pickBoolean(spread, defaults.spread),
  };
}

export function loadSoundPrefs(): SoundPrefs {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return parseSoundPrefs(stored === null ? null : JSON.parse(stored));
  } catch {
    return { ...DEFAULT_SOUND_PREFS };
  }
}

export function saveSoundPrefs(prefs: SoundPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parseSoundPrefs(prefs)));
  } catch {
    // Storage blocked in a private window: the choice lasts for this page only.
  }
}
