import { isTypableUnit, type LogEntry } from "@/engine/core";
import { type KeyAction, type KeyFocus, type KeyLike, type KeyScope, resolveKey } from "./keymap";

export interface CaptureSink {
  op(op: LogEntry): void;
  action(action: KeyAction): void;
  caps(on: boolean): void;
  /** A dead key waiting for its letter, for the ghost mark at the caret. */
  pending(diacritic: string | null): void;
  focus(on: boolean): void;
  /** Whole-word inserts carry one timestamp, so any such path makes the run casual. */
  virtual(): void;
}

export interface CaptureHooks {
  /** Runs first in the capture-phase keydown, before any state update, so a click can't wait on render. */
  press(e: KeyboardEvent): void;
  release(e: KeyboardEvent): void;
  scope(): KeyScope;
  /** A popover or dialog is open, so keys belong to it. */
  overlayOpen(): boolean;
}

export interface CaptureRoots {
  win: EventTarget;
  doc: EventTarget & { activeElement: unknown };
}

export interface Capture {
  /** Forgets the time origin and the field's contents, for a new run. */
  reset(): void;
  /** keydown.timeStamp of the op at t=0, on the performance.now timebase. */
  origin(): number | null;
  setFoldCAcute(on: boolean): void;
  dispose(): void;
}

// Keeps the field non-empty: Android sends no reliable delete event from an empty input.
export const SENTINEL = "​";

// What a keyboard with smart punctuation sends in place of the plain characters every text is written in.
const SMART: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "ʼ": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
};

const BLOCKED_INPUT =
  /^(insertFromPaste|insertFromPasteAsQuotation|insertFromDrop|insertFromYank|insertTranspose|insertLineBreak|insertParagraph|deleteByCut|deleteByDrag|historyUndo|historyRedo|format)/;
const WORD_DELETE = /^(deleteWord|deleteSoftLine|deleteHardLine)/;
const LONE_DIACRITIC = new Set(["~", "˜", "´", "`", "^", "ˆ", "¨", "'", '"', "ˇ", "¯"]);
const FORMAT_CHAR = /\p{Cf}/u;

// Windows reports Dead with no composition, so the mark itself is unknown until the letter lands. A neutral dot never lies.
const UNKNOWN_DIACRITIC = "˙";

// A field this long is a keyboard that never commits. Android's composing buffer is short, so this stays out of its way.
const MAX_FIELD = 48;

/** NFC first, so a keyboard's decomposed ã is one letter. Everything the engine's log can't hold drops here, emoji included. */
export function normalizeTyped(text: string, foldCAcute: boolean): string {
  let out = "";
  for (const raw of text.normalize("NFC")) {
    const mapped = SMART[raw] ?? raw;
    if (foldCAcute && mapped === "ć") out += "ç";
    else if (foldCAcute && mapped === "Ć") out += "Ç";
    else out += mapped;
  }
  return out;
}

function modifierOn(e: KeyboardEvent, name: string): boolean {
  return typeof e.getModifierState === "function" && e.getModifierState(name);
}

function isChord(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey || e.altKey) && !modifierOn(e, "AltGraph");
}

/** Would this key type into the surface if it had focus? Tab, Enter, Esc and function keys would not. */
function typesText(e: KeyboardEvent): boolean {
  return e.key.length === 1 || e.key === "Dead" || e.key === "Process" || e.key === "Unidentified" || e.key === "Backspace" || e.keyCode === 229;
}

interface FieldLike {
  value: string;
  selectionStart: number | null;
  focus(options?: FocusOptions): void;
  setSelectionRange(start: number, end: number): void;
}

export function attachCapture(input: HTMLInputElement, sink: CaptureSink, hooks: CaptureHooks, roots: CaptureRoots): Capture {
  const field: FieldLike = input;
  const { win, doc } = roots;
  const abort = new AbortController();
  const on = <E>(target: EventTarget, type: string, handler: (e: E) => void, capture = false) =>
    target.addEventListener(type, handler as EventListener, { capture, signal: abort.signal });

  let shadow = SENTINEL;
  let composing = false;
  let compositionText = "";
  let foldCAcute = false;
  let wordDelete = false;

  let lastKeyTs = 0;
  let keySinceInput = false;
  let realKey = false;
  let currentCode = "";
  let deadPending = false;

  let originTs: number | null = null;
  let lastT = 0;
  const downs = new Map<string, { ts: number; entry: LogEntry | null }>();

  function resetField() {
    if (field.value !== SENTINEL) field.value = SENTINEL;
    shadow = SENTINEL;
    field.setSelectionRange(1, 1);
  }

  function stamp(ts: number): number {
    if (originTs === null) originTs = ts;
    const t = Math.round(ts - originTs);
    if (t > lastT) lastT = t;
    return lastT;
  }

  function send(entry: LogEntry) {
    const down = downs.get(currentCode);
    if (down) down.entry = entry;
    sink.op(entry);
  }

  function settleDead() {
    if (!deadPending) return;
    deadPending = false;
    sink.pending(null);
  }

  function emitDead(ts: number, diacritic: string) {
    if (!deadPending) {
      deadPending = true;
      send({ k: "d", t: stamp(ts) });
    }
    sink.pending(diacritic);
  }

  function emitText(text: string, ts: number): boolean {
    let sawSpace = false;
    for (const unit of normalizeTyped(text, foldCAcute)) {
      if (unit === SENTINEL) continue;
      if (unit === " ") {
        sawSpace = true;
        settleDead();
        send({ k: "s", t: stamp(ts) });
        continue;
      }
      const code = unit.charCodeAt(0);
      if (unit.length !== 1 || !isTypableUnit(code) || (code >= 0x80 && FORMAT_CHAR.test(unit))) continue;
      settleDead();
      send({ k: "c", ch: unit, t: stamp(ts) });
    }
    return sawSpace;
  }

  function inputTime(e: Event): number {
    return keySinceInput ? lastKeyTs : e.timeStamp;
  }

  /** Idempotent by diffing against the shadow: input and compositionend fire in either order and only the first sees a change. */
  function sync(e: Event) {
    const value = field.value.normalize("NFC");
    const ts = inputTime(e);
    if (composing && compositionText.length === 1 && LONE_DIACRITIC.has(compositionText)) {
      emitDead(ts, compositionText);
      return;
    }
    let prefix = 0;
    const shortest = Math.min(value.length, shadow.length);
    while (prefix < shortest && value.charCodeAt(prefix) === shadow.charCodeAt(prefix)) prefix++;
    const removed = shadow.length - prefix;
    if (removed > 0) {
      if (wordDelete) send({ k: "w", t: stamp(ts) });
      else for (let i = 0; i < removed; i++) send({ k: "b", t: stamp(ts) });
    }
    if (removed > 0 || value.length > prefix) wordDelete = false;
    const sawSpace = emitText(value.slice(prefix), ts);
    shadow = value;
    if (!composing && (sawSpace || !value.startsWith(SENTINEL) || value.length > MAX_FIELD)) resetField();
  }

  function focusKind(active: unknown): KeyFocus {
    if (active === input) return "input";
    if (active === null || active === undefined) return "body";
    const tag = (active as { tagName?: string }).tagName;
    return tag === "BODY" || tag === "HTML" ? "body" : "control";
  }

  function onKeyDown(e: KeyboardEvent) {
    hooks.press(e);

    // Before the trust gate: a forged event can only show or hide a warning, and Caps Lock can't be set any other way in a test.
    const imeKey = e.isComposing || e.keyCode === 229;
    if (e.key !== "CapsLock" && !imeKey) sink.caps(modifierOn(e, "CapsLock"));
    if (!e.isTrusted) return;

    const active = doc.activeElement;
    const focus = focusKind(active);
    if (focus === "control") {
      if (hooks.overlayOpen()) return;
      const owner = active as { closest?: (selector: string) => unknown };
      if (owner.closest?.('dialog,[role="dialog"]')) return;
    } else if (hooks.overlayOpen()) {
      return;
    }

    const action = imeKey ? null : resolveKey(e as KeyLike, hooks.scope(), focus);
    if (action !== null) {
      e.preventDefault();
      if (action !== "swallow") sink.action(action);
      return;
    }

    if (focus !== "input") {
      if (isChord(e) || !typesText(e)) return;
      // A deliberately focused button still answers Space while idle, and a hidden one can't hold focus during a run.
      if (focus === "control" && e.key === " " && hooks.scope() !== "running") return;
      field.focus({ preventScroll: true });
    }

    lastKeyTs = e.timeStamp;
    keySinceInput = true;
    currentCode = e.code;
    if (!e.repeat && !downs.has(e.code)) downs.set(e.code, { ts: e.timeStamp, entry: null });

    if (imeKey || e.key === "Unidentified") {
      realKey = false;
      if (e.code === "") sink.virtual();
      return;
    }
    // A touch keyboard fires keydown with a key value but no physical code, and cancelling its edit desyncs its buffer.
    realKey = e.code !== "";
    if (!realKey && typesText(e)) sink.virtual();

    if (e.key.length === 1 && e.repeat) {
      e.preventDefault();
      return;
    }
    if (e.key === "Dead" && !e.repeat) emitDead(e.timeStamp, UNKNOWN_DIACRITIC);
  }

  function onKeyUp(e: KeyboardEvent) {
    hooks.release(e);
    if (e.key === "CapsLock") sink.caps(modifierOn(e, "CapsLock"));
    const down = downs.get(e.code);
    if (!down) return;
    downs.delete(e.code);
    if (down.entry) down.entry.h = Math.max(0, Math.round(e.timeStamp - down.ts));
  }

  function onBeforeInput(e: InputEvent) {
    if (!e.isTrusted || BLOCKED_INPUT.test(e.inputType)) {
      e.preventDefault();
      return;
    }
    const isWordDelete = WORD_DELETE.test(e.inputType);
    if (realKey && e.cancelable && !e.isComposing && !composing) {
      realKey = false;
      if (e.inputType === "insertText" && e.data) {
        e.preventDefault();
        emitText(e.data, lastKeyTs);
        return;
      }
      if (e.inputType === "deleteContentBackward") {
        e.preventDefault();
        settleDead();
        send({ k: "b", t: stamp(lastKeyTs) });
        return;
      }
      if (isWordDelete) {
        e.preventDefault();
        settleDead();
        send({ k: "w", t: stamp(lastKeyTs) });
        return;
      }
    }
    if (isWordDelete) wordDelete = true;
  }

  function onInput(e: Event) {
    if (!keySinceInput) sink.virtual();
    sync(e);
    keySinceInput = false;
  }

  function onCompositionEnd(e: Event) {
    composing = false;
    compositionText = "";
    sync(e);
    settleDead();
    resetField();
  }

  function refuse(e: Event) {
    e.preventDefault();
  }

  on<KeyboardEvent>(win, "keydown", onKeyDown, true);
  on<KeyboardEvent>(win, "keyup", onKeyUp, true);
  on<InputEvent>(input, "beforeinput", onBeforeInput);
  on<Event>(input, "input", onInput);
  on<Event>(input, "compositionstart", () => {
    composing = true;
    compositionText = "";
  });
  on<CompositionEvent>(input, "compositionupdate", (e) => {
    compositionText = e.data ?? "";
  });
  on<Event>(input, "compositionend", onCompositionEnd);
  for (const type of ["paste", "drop", "cut", "dragover", "dragstart"]) on<Event>(input, type, refuse);
  on<Event>(doc, "selectionchange", () => {
    if (doc.activeElement === input && !composing && field.selectionStart !== field.value.length) {
      field.setSelectionRange(field.value.length, field.value.length);
    }
  });
  on<Event>(input, "focus", () => sink.focus(true));
  on<Event>(input, "blur", () => {
    downs.clear();
    sink.focus(false);
  });

  resetField();

  return {
    reset() {
      originTs = null;
      lastT = 0;
      deadPending = false;
      wordDelete = false;
      sink.pending(null);
      if (!composing) resetField();
    },
    origin: () => originTs,
    setFoldCAcute(next) {
      foldCAcute = next;
    },
    dispose() {
      abort.abort();
    },
  };
}
