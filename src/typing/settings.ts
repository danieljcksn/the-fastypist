import type { Language, PackId, Tier } from "@/engine/packs";
import type { ModeSpec } from "@/engine/presets";

export const TIME_CHOICES = [15, 30, 60, 120] as const;
export const WORD_CHOICES = [10, 25, 50, 100] as const;
export const TIERS: readonly Tier[] = ["200", "1k", "5k"];

export interface TestSettings {
  mode: ModeSpec;
  language: Language;
  tier: Tier;
  accentFree: boolean;
  punctuation: boolean;
  numbers: boolean;
  /** Only read when mode is custom. */
  customWords: readonly string[];
}

export const TEST_KEY = "fastypist:test";
export const PREFS_KEY = "fastypist:prefs";
export const THEME_KEY = "fastypist:theme";

export function defaultSettings(language: Language): TestSettings {
  return {
    mode: { kind: "time", seconds: 60 },
    language,
    tier: "1k",
    accentFree: false,
    punctuation: false,
    numbers: false,
    customWords: [],
  };
}

export function packIdFor(settings: Pick<TestSettings, "language" | "tier">): PackId {
  return `${settings.language}-${settings.tier}@1`;
}

function parseMode(raw: unknown, words: readonly string[]): ModeSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { kind, seconds, count } = raw as Record<string, unknown>;
  if (kind === "time" && (TIME_CHOICES as readonly unknown[]).includes(seconds)) return { kind, seconds: seconds as number };
  if (kind === "words" && (WORD_CHOICES as readonly unknown[]).includes(count)) return { kind, count: count as number };
  if (kind === "quote") return { kind };
  if (kind === "custom" && words.length > 0) return { kind };
  return null;
}

export function parseSettings(raw: unknown, base: TestSettings): TestSettings {
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const customWords = Array.isArray(r.customWords) && r.customWords.every((w) => typeof w === "string") ? (r.customWords as string[]) : [];
  return {
    mode: parseMode(r.mode, customWords) ?? base.mode,
    language: r.language === "en" || r.language === "pt" ? r.language : base.language,
    tier: r.tier === "200" || r.tier === "1k" || r.tier === "5k" ? r.tier : base.tier,
    accentFree: r.accentFree === true,
    punctuation: r.punctuation === true,
    numbers: r.numbers === true,
    customWords,
  };
}

/** The shareable read-only query: mode, t, n, lang, tier. Anything it can't parse is ignored. */
export function applyQuery(search: string, base: TestSettings): TestSettings {
  const q = new URLSearchParams(search);
  const next: TestSettings = { ...base };
  const seconds = Number(q.get("t"));
  const count = Number(q.get("n"));
  const mode = q.get("mode");
  if (mode === "quote") next.mode = { kind: "quote" };
  else if (mode === "words" || (mode === null && q.has("n"))) {
    next.mode = { kind: "words", count: (WORD_CHOICES as readonly number[]).includes(count) ? count : 25 };
  } else if (mode === "time" || (mode === null && q.has("t"))) {
    next.mode = { kind: "time", seconds: (TIME_CHOICES as readonly number[]).includes(seconds) ? seconds : 60 };
  }
  const lang = q.get("lang");
  if (lang === "en" || lang === "pt") next.language = lang;
  const tier = q.get("tier");
  if (tier === "200" || tier === "1k" || tier === "5k") next.tier = tier;
  return next;
}

export function isDefault(settings: TestSettings, language: Language): boolean {
  const d = defaultSettings(language);
  return (
    settings.mode.kind === "time" &&
    settings.mode.seconds === 60 &&
    settings.language === d.language &&
    settings.tier === d.tier &&
    !settings.accentFree &&
    !settings.punctuation &&
    !settings.numbers
  );
}

export function loadSettings(language: Language): TestSettings {
  const base = defaultSettings(language);
  try {
    const stored = localStorage.getItem(TEST_KEY);
    return stored === null ? base : parseSettings(JSON.parse(stored), base);
  } catch {
    return base;
  }
}

/** Only non-defaults are stored, so the pre-paint script can tell a first paint will be right without parsing anything. */
export function saveSettings(settings: TestSettings, language: Language): void {
  try {
    if (isDefault(settings, language)) localStorage.removeItem(TEST_KEY);
    else localStorage.setItem(TEST_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked in a private window: the choice lasts for this page only.
  }
}

export type CaretShape = "bar" | "block" | "underline";
export type TypeSize = "s" | "m" | "l" | "xl";
export type ThemeChoice = "dark" | "light" | "system";

export interface DisplayPrefs {
  caret: CaretShape;
  size: TypeSize;
  liveSpeed: boolean;
  /** A stub: the results stage owns the best run this races. */
  paceCaret: boolean;
}

export const DEFAULT_DISPLAY: DisplayPrefs = { caret: "bar", size: "m", liveSpeed: false, paceCaret: false };

export function parseDisplay(raw: unknown): DisplayPrefs {
  if (typeof raw !== "object" || raw === null) return DEFAULT_DISPLAY;
  const r = raw as Record<string, unknown>;
  return {
    caret: r.caret === "block" || r.caret === "underline" ? r.caret : "bar",
    size: r.size === "s" || r.size === "l" || r.size === "xl" ? r.size : "m",
    liveSpeed: r.liveSpeed === true,
    paceCaret: r.paceCaret === true,
  };
}

export function loadDisplay(): DisplayPrefs {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    return stored === null ? DEFAULT_DISPLAY : parseDisplay(JSON.parse(stored));
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function saveDisplay(prefs: DisplayPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked in a private window: the choice lasts for this page only.
  }
}

export function loadTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "system" ? stored : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked in a private window: the choice lasts for this page only.
  }
}

/** Dark is the page's default state, so only light ever sets the attribute. Matches the layout's pre-paint script. */
export function applyTheme(theme: ThemeChoice, root: HTMLElement): void {
  const light = theme === "light" || (theme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
  if (light) root.dataset.theme = "light";
  else delete root.dataset.theme;
}

export function applyDisplay(prefs: DisplayPrefs, root: HTMLElement): void {
  root.dataset.caret = prefs.caret;
  root.dataset.size = prefs.size;
}

// Before first paint, inside the page: a saved type size changes the cell, so it can't wait for hydration. data-pending hides
// only the sentence, so a saved config never shows the default first and nothing else waits.
export const PREPAINT_SCRIPT = `try{var d=document.documentElement,p=JSON.parse(localStorage.getItem("${PREFS_KEY}")||"{}");if(p.caret)d.dataset.caret=p.caret;if(p.size)d.dataset.size=p.size;var s=JSON.parse(localStorage.getItem("thefastypist.sound")||"{}");if(localStorage.getItem("${TEST_KEY}")||s.enabled||/[?&](mode|t|n|lang|tier|drill)=/.test(location.search))d.dataset.pending=""}catch(e){}`;
