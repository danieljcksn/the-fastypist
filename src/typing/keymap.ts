export type KeyScope = "idle" | "running" | "finished";

/** Where keyboard focus sits: the typing input, nothing at all, or some other control. */
export type KeyFocus = "input" | "body" | "control";

export type KeyAction =
  | "new-words"
  | "abort"
  | "focus-chrome"
  | "focus-input"
  | "toggle-sound"
  | "primary"
  | "swallow";

export interface KeyLike {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

interface Binding {
  key?: string;
  code?: string;
  shift?: boolean;
  chord?: boolean;
  alt?: boolean;
  scopes: readonly KeyScope[];
  focus: readonly KeyFocus[];
  action: KeyAction;
}

const ALL_SCOPES: readonly KeyScope[] = ["idle", "running", "finished"];
const ALL_FOCUS: readonly KeyFocus[] = ["input", "body", "control"];
const IN_INPUT: readonly KeyFocus[] = ["input"];
const ON_PAGE: readonly KeyFocus[] = ["input", "body"];

const swallow = (key: string, extra: Partial<Binding> = {}): Binding => ({
  key,
  scopes: ALL_SCOPES,
  focus: IN_INPUT,
  action: "swallow",
  ...extra,
});

// Shift+Tab has no binding on purpose: it must move out natively, or the input is a keyboard trap.
const KEYMAP: readonly Binding[] = [
  { key: "Tab", shift: false, scopes: ALL_SCOPES, focus: IN_INPUT, action: "new-words" },
  { key: "Escape", scopes: ["running"], focus: ALL_FOCUS, action: "abort" },
  { key: "Escape", scopes: ["idle"], focus: ON_PAGE, action: "focus-chrome" },
  { key: "Escape", scopes: ["idle"], focus: ["control"], action: "focus-input" },
  { key: "Escape", scopes: ["finished"], focus: ON_PAGE, action: "new-words" },
  // By code, with the default prevented: Option+M types µ on a Mac, so the key value is useless and the letter must not land.
  { code: "KeyM", alt: true, scopes: ALL_SCOPES, focus: ALL_FOCUS, action: "toggle-sound" },
  { key: "Enter", shift: false, scopes: ["finished"], focus: ON_PAGE, action: "primary" },
  ...["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].map((key) => swallow(key)),
  ...["a", "z", "y", "x", "v"].map((key) => swallow(key, { chord: true })),
];

function matches(binding: Binding, e: KeyLike, key: string): boolean {
  if (binding.code !== undefined && binding.code !== e.code) return false;
  if (binding.key !== undefined && binding.key !== key) return false;
  if (binding.shift !== undefined && binding.shift !== e.shiftKey) return false;
  if ((binding.chord ?? false) !== (e.ctrlKey || e.metaKey)) return false;
  // AltGr reports ctrl+alt on Windows and types a character, and Alt+Left is the browser's back: neither is ours.
  return (binding.alt ?? false) === e.altKey;
}

/** The one owner of every shortcut. Called on every keydown, so a bare letter leaves on the first line. */
export function resolveKey(e: KeyLike, scope: KeyScope, focus: KeyFocus): KeyAction | null {
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const binding of KEYMAP) {
    if (!binding.scopes.includes(scope) || !binding.focus.includes(focus)) continue;
    if (matches(binding, e, key)) return binding.action;
  }
  return null;
}
