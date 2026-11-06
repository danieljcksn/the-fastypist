export type KeyClass = "key" | "space" | "enter" | "backspace";
export type SoundProfile = "soft" | "crisp" | "pop";

export interface SoundPrefs {
  enabled: boolean;
  /** 0..1, gain = volume² */
  volume: number;
  profile: SoundProfile;
  errorSound: boolean;
  release: boolean;
  spread: boolean;
}

export interface KeySound {
  /** Synchronous, never throws. Call before any state update. */
  press(cls: KeyClass, code: string, isError?: boolean): void;
  release(code: string): void;
  /** Call from any trusted activating event. */
  unlock(): void;
  setPrefs(next: Partial<SoundPrefs>): void;
  /** Only from an explicit click. */
  preview(profile?: SoundProfile): void;
  sleep(): void;
  readonly status: "warming" | "ready" | "suspended" | "failed";
  latency(): { baseMs: number; outputMs: number; underruns: number | null };
  dispose(): void;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  enabled: false,
  volume: 0.5,
  profile: "soft",
  errorSound: false,
  release: true,
  spread: true,
};
