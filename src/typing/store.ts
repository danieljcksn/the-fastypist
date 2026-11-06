import type { Language } from "@/engine/packs";
import { loadSoundPrefs, saveSoundPrefs } from "@/sound/prefs";
import { DEFAULT_SOUND_PREFS, type SoundPrefs, type SoundProfile } from "@/sound/types";
import type { RunOutcome } from "./contract";
import {
  applyDisplay,
  applyQuery,
  applyTheme,
  DEFAULT_DISPLAY,
  defaultSettings,
  type DisplayPrefs,
  loadDisplay,
  loadSettings,
  loadTheme,
  saveDisplay,
  saveSettings,
  saveTheme,
  type TestSettings,
  type ThemeChoice,
} from "./settings";

export type Phase = "idle" | "running" | "finished";
export type MenuId = "mode" | "language" | "sound" | "settings" | "custom";

export interface OpenMenu {
  id: MenuId;
  /** From the slot's left edge, so a popover sits under its word. */
  x: number;
  viaPointer: boolean;
}

export interface HomeSnapshot {
  hydrated: boolean;
  phase: Phase;
  settings: TestSettings;
  display: DisplayPrefs;
  theme: ThemeChoice;
  sound: SoundPrefs;
  menu: OpenMenu | null;
  outcome: RunOutcome | null;
  /** Words in this run's text. The sentence only uses it where the mode doesn't fix it. */
  count: number;
  note: string | null;
}

export interface SessionApi {
  newWords(): void;
  toggleSound(): void;
  previewSound(profile: SoundProfile): void;
  focusInput(): void;
  focusTrigger(id: MenuId): void;
}

/** Keystrokes never pass through here. Only phase and preference changes do. */
export interface HomeStore {
  readonly language: Language;
  get(): HomeSnapshot;
  getServer(): HomeSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): void;
  reset(): void;
  setPhase(phase: Phase): void;
  finish(outcome: RunOutcome): void;
  setCount(count: number): void;
  setNote(note: string | null): void;
  setSettings(patch: Partial<TestSettings>): void;
  setDisplay(patch: Partial<DisplayPrefs>): void;
  setTheme(theme: ThemeChoice): void;
  setSound(patch: Partial<SoundPrefs>): void;
  openMenu(id: MenuId, x: number, viaPointer: boolean): void;
  closeMenu(): void;
  attach(api: SessionApi | null): void;
  readonly session: SessionApi | null;
  /** What Enter does on the result, owned by whichever screen is showing. */
  setPrimary(action: (() => void) | null): void;
  runPrimary(): boolean;
}

export function createHomeStore(language: Language): HomeStore {
  const initial: HomeSnapshot = {
    hydrated: false,
    phase: "idle",
    settings: defaultSettings(language),
    display: DEFAULT_DISPLAY,
    theme: "dark",
    sound: DEFAULT_SOUND_PREFS,
    menu: null,
    outcome: null,
    count: 0,
    note: null,
  };
  let snapshot = initial;
  let session: SessionApi | null = null;
  let primary: (() => void) | null = null;
  const listeners = new Set<() => void>();

  function set(patch: Partial<HomeSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  return {
    language,
    get: () => snapshot,
    getServer: () => initial,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate() {
      const display = loadDisplay();
      // The pre-paint script only runs on a document load. Arriving through a Link, this is the first anyone applies them.
      applyDisplay(display, document.documentElement);
      set({
        hydrated: true,
        settings: applyQuery(location.search, loadSettings(language)),
        display,
        theme: loadTheme(),
        sound: loadSoundPrefs(),
      });
    },
    reset() {
      set({ phase: "idle", menu: null, outcome: null, note: null });
    },
    setPhase(phase) {
      if (snapshot.phase !== phase) set({ phase, outcome: phase === "finished" ? snapshot.outcome : null });
    },
    finish(outcome) {
      set({ phase: "finished", outcome });
    },
    setCount(count) {
      if (snapshot.count !== count) set({ count });
    },
    setNote(note) {
      if (snapshot.note !== note) set({ note });
    },
    setSettings(patch) {
      const settings = { ...snapshot.settings, ...patch };
      saveSettings(settings, language);
      set({ settings, note: null });
    },
    setDisplay(patch) {
      const display = { ...snapshot.display, ...patch };
      saveDisplay(display);
      applyDisplay(display, document.documentElement);
      set({ display });
    },
    setTheme(theme) {
      saveTheme(theme);
      applyTheme(theme, document.documentElement);
      set({ theme });
    },
    setSound(patch) {
      const sound = { ...snapshot.sound, ...patch };
      saveSoundPrefs(sound);
      set({ sound });
    },
    openMenu(id, x, viaPointer) {
      set({ menu: { id, x, viaPointer } });
    },
    closeMenu() {
      if (snapshot.menu) set({ menu: null });
    },
    attach(api) {
      session = api;
    },
    get session() {
      return session;
    },
    setPrimary(action) {
      primary = action;
    },
    runPrimary() {
      primary?.();
      return primary !== null;
    },
  };
}
