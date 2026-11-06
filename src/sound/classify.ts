import type { KeyClass } from "./types";

export interface KeyLike {
  key?: string;
  code?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

// UI Events named key values. A printable key is anything else, including the
// two-code-point "ã" some engines report for a composed ã.
const NAMED_KEY = /^[A-Z][a-zA-Z0-9]+$/;

// An IME can report these as Process too. Anything else composing counts as a key, per
// the plan, so an unknown code clicks rather than goes silent.
const SILENT_CODE = /^(?:Shift|Control|Alt|Meta|OS|CapsLock|Escape|Tab|Arrow|Home|End|Page|Insert|Delete|F\d)/;

function ownClass(name: string): KeyClass | null {
  switch (name) {
    case " ":
    case "Space":
      return "space";
    case "Enter":
    case "NumpadEnter":
      return "enter";
    case "Backspace":
      return "backspace";
    default:
      return null;
  }
}

/** `repeat` is the caller's to ignore: this answers for the key, not the event. */
export function keyClass(event: KeyLike): KeyClass | null {
  // Word delete is typing, whichever modifier the platform spells it with.
  if (!event.metaKey && (event.key === "Backspace" || event.code === "Backspace")) return "backspace";
  // AltGr on Windows reports ctrl+alt and types a character (ABNT2 AltGr+Q is "/").
  if (event.metaKey || (event.ctrlKey && !event.altKey)) return null;

  // Chrome's autofill dispatches keydown events with no `key` at all.
  const key = event.key ?? "";
  const code = event.code ?? "";
  const opaque = key === "" || key === "Dead" || key === "Unidentified" || key === "Process";

  // AltGr and Option change the character, so an unchanged one under Alt typed nothing.
  if (event.altKey && /^[a-zA-Z0-9]$/.test(key)) return null;

  // Composing hides the key but not the switch, so the physical code picks the class.
  const own = ownClass(key) ?? (opaque ? ownClass(code) : null);
  if (own) return own;
  if (opaque && SILENT_CODE.test(code)) return null;

  if (key === "") return event.keyCode === 229 ? "key" : null;
  if (opaque) return "key";
  return NAMED_KEY.test(key) ? null : "key";
}
