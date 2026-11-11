import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { isTypableUnit, type LogEntry } from "@/engine/core";
import { attachCapture, type Capture, normalizeTyped, SENTINEL } from "@/typing/capture";
import type { KeyAction, KeyScope } from "@/typing/keymap";

type Listener = (e: never) => void;

class FakeTarget {
  private listeners = new Map<string, { fn: Listener; capture: boolean; signal?: AbortSignal }[]>();
  addEventListener(type: string, fn: Listener, options?: { capture?: boolean; signal?: AbortSignal }) {
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture: options?.capture ?? false, signal: options?.signal });
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  fire(type: string, event: object) {
    const e = "isTrusted" in event ? event : Object.assign(event, { isTrusted: true });
    for (const entry of this.listeners.get(type) ?? []) {
      if (!entry.signal?.aborted) entry.fn(e as never);
    }
  }
}

class FakeInput extends FakeTarget {
  value = "";
  selectionStart: number | null = 0;
  focused = 0;
  focus() {
    this.focused++;
  }
  setSelectionRange(start: number) {
    this.selectionStart = start;
  }
}

interface Rig {
  input: FakeInput;
  win: FakeTarget;
  doc: FakeTarget & { activeElement: unknown };
  capture: Capture;
  ops: LogEntry[];
  actions: KeyAction[];
  pending: (string | null)[];
  caps: boolean[];
  log: string[];
  virtual: { count: number };
  setScope(scope: KeyScope): void;
  setOverlay(open: boolean): void;
}

function rig(): Rig {
  const input = new FakeInput();
  const win = new FakeTarget();
  const doc = Object.assign(new FakeTarget(), { activeElement: input as unknown });
  const ops: LogEntry[] = [];
  const actions: KeyAction[] = [];
  const pending: (string | null)[] = [];
  const caps: boolean[] = [];
  const log: string[] = [];
  const virtual = { count: 0 };
  let scope: KeyScope = "idle";
  let overlay = false;
  const capture = attachCapture(
    input as unknown as HTMLInputElement,
    {
      op: (op) => {
        log.push("op");
        ops.push(op);
      },
      action: (a) => actions.push(a),
      caps: (on) => {
        log.push("caps");
        caps.push(on);
      },
      pending: (d) => pending.push(d),
      focus: () => undefined,
      virtual: () => {
        virtual.count++;
      },
    },
    {
      press: () => log.push("press"),
      release: () => log.push("release"),
      scope: () => scope,
      overlayOpen: () => overlay,
    },
    { win: win as unknown as EventTarget, doc: doc as unknown as EventTarget & { activeElement: unknown } },
  );
  return { input, win, doc, capture, ops, actions, pending, caps, log, virtual, setScope: (s) => (scope = s), setOverlay: (o) => (overlay = o) };
}

interface KeyOpts {
  key: string;
  code?: string;
  ts?: number;
  repeat?: boolean;
  keyCode?: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  capsOn?: boolean;
  isTrusted?: boolean;
}

function keyEvent(o: KeyOpts) {
  let prevented = false;
  return {
    key: o.key,
    code: o.code ?? (o.key.length === 1 ? `Key${o.key.toUpperCase()}` : o.key),
    timeStamp: o.ts ?? 0,
    repeat: o.repeat ?? false,
    keyCode: o.keyCode ?? 0,
    isComposing: o.isComposing ?? false,
    ctrlKey: o.ctrlKey ?? false,
    metaKey: o.metaKey ?? false,
    altKey: o.altKey ?? false,
    shiftKey: o.shiftKey ?? false,
    isTrusted: o.isTrusted ?? true,
    getModifierState: (name: string) => name === "CapsLock" && (o.capsOn ?? false),
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
}

function inputEvent(inputType: string, data: string | null, ts = 0, cancelable = true, isComposing = false) {
  let prevented = false;
  return {
    inputType,
    data,
    cancelable,
    isComposing,
    isTrusted: true,
    timeStamp: ts,
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
}

/** A physical key press the way a browser delivers it: keydown, cancellable beforeinput, nothing lands in the field. */
function typeKey(r: Rig, ch: string, ts: number) {
  const code = ch === " " ? "Space" : `Key${ch.toUpperCase()}`;
  r.win.fire("keydown", keyEvent({ key: ch, code, ts }));
  r.input.fire("beforeinput", inputEvent("insertText", ch, ts + 3));
}

/** Chromium: Process/229, then composition, input before compositionend. */
function chromiumDead(r: Rig, diacritic: string, letter: string, composed: string, ts: number) {
  r.win.fire("keydown", keyEvent({ key: "Process", code: "Quote", keyCode: 229, ts }));
  r.input.fire("compositionstart", {});
  r.input.fire("compositionupdate", { data: diacritic });
  r.input.value = SENTINEL + diacritic;
  r.input.fire("input", { timeStamp: ts + 200 });
  r.win.fire("keydown", keyEvent({ key: "Process", code: `Key${letter.toUpperCase()}`, keyCode: 229, ts: ts + 50 }));
  r.input.fire("compositionupdate", { data: composed });
  r.input.value = SENTINEL + composed;
  r.input.fire("input", { timeStamp: ts + 240 });
  r.input.fire("compositionend", { timeStamp: ts + 241 });
}

/** Firefox: Dead/0, and compositionend fires before the last input. */
function firefoxDead(r: Rig, diacritic: string, letter: string, composed: string, ts: number) {
  r.win.fire("keydown", keyEvent({ key: "Dead", code: "Quote", ts }));
  r.input.fire("compositionstart", {});
  r.input.fire("compositionupdate", { data: diacritic });
  r.input.value = SENTINEL + diacritic;
  r.input.fire("input", { timeStamp: ts + 200 });
  r.win.fire("keydown", keyEvent({ key: letter, code: `Key${letter.toUpperCase()}`, isComposing: true, ts: ts + 50 }));
  r.input.fire("compositionupdate", { data: composed });
  r.input.value = SENTINEL + composed;
  r.input.fire("compositionend", { timeStamp: ts + 240 });
  r.input.fire("input", { timeStamp: ts + 241 });
}

const sum = (ops: LogEntry[]) => ops.map((o) => (o.k === "c" ? o.ch : o.k)).join("");

describe("fast path on real keys", () => {
  let r: Rig;
  beforeEach(() => {
    r = rig();
  });

  it("cancels the edit, keeps the sentinel and times from keydown", () => {
    const event = inputEvent("insertText", "a", 900);
    r.win.fire("keydown", keyEvent({ key: "a", ts: 100 }));
    r.input.fire("beforeinput", event);
    expect(event.defaultPrevented).toBe(true);
    expect(r.input.value).toBe(SENTINEL);
    expect(r.ops).toEqual([{ k: "c", ch: "a", t: 0 }]);
    typeKey(r, "b", 150);
    expect(r.ops[1]).toEqual({ k: "c", ch: "b", t: 50 });
  });

  it("calls press before any state update", () => {
    r.win.fire("keydown", keyEvent({ key: "a", ts: 10, capsOn: true }));
    expect(r.log[0]).toBe("press");
    expect(r.log[1]).toBe("caps");
  });

  it("maps space, backspace and word delete", () => {
    typeKey(r, "a", 0);
    r.win.fire("keydown", keyEvent({ key: "Backspace", ts: 10 }));
    r.input.fire("beforeinput", inputEvent("deleteContentBackward", null));
    r.win.fire("keydown", keyEvent({ key: "Backspace", ctrlKey: true, ts: 20 }));
    r.input.fire("beforeinput", inputEvent("deleteWordBackward", null));
    typeKey(r, " ", 30);
    expect(r.ops.map((o) => o.k)).toEqual(["c", "b", "w", "s"]);
  });

  it("swallows repeats of printable keys but lets Backspace repeat", () => {
    typeKey(r, "a", 0);
    const repeat = keyEvent({ key: "a", ts: 30, repeat: true });
    r.win.fire("keydown", repeat);
    expect(repeat.defaultPrevented).toBe(true);
    const back = keyEvent({ key: "Backspace", ts: 40, repeat: true });
    r.win.fire("keydown", back);
    expect(back.defaultPrevented).toBe(false);
  });

  it("writes keyup holds back onto the entry by physical code, through rollover", () => {
    r.win.fire("keydown", keyEvent({ key: "a", code: "KeyA", ts: 100 }));
    r.input.fire("beforeinput", inputEvent("insertText", "a"));
    r.win.fire("keydown", keyEvent({ key: "b", code: "KeyB", ts: 130 }));
    r.input.fire("beforeinput", inputEvent("insertText", "b"));
    r.win.fire("keyup", keyEvent({ key: "a", code: "KeyA", ts: 190 }));
    r.win.fire("keyup", keyEvent({ key: "b", code: "KeyB", ts: 210 }));
    expect(r.ops[0]?.h).toBe(90);
    expect(r.ops[1]?.h).toBe(80);
  });

  it("drops what the engine's log could not hold", () => {
    r.win.fire("keydown", keyEvent({ key: "😀", ts: 0 }));
    r.input.fire("beforeinput", inputEvent("insertText", "😀"));
    r.win.fire("keydown", keyEvent({ key: "x", ts: 10 }));
    r.input.fire("beforeinput", inputEvent("insertText", "‍"));
    expect(r.ops).toEqual([]);
  });
});

describe("Caps Lock", () => {
  it("reads every other key and CapsLock keyup, never CapsLock keydown", () => {
    const r = rig();
    r.win.fire("keydown", keyEvent({ key: "CapsLock", code: "CapsLock", capsOn: true }));
    expect(r.caps).toEqual([]);
    r.win.fire("keyup", keyEvent({ key: "CapsLock", code: "CapsLock", capsOn: true }));
    expect(r.caps).toEqual([true]);
    r.win.fire("keydown", keyEvent({ key: "A", code: "KeyA", capsOn: false }));
    expect(r.caps).toEqual([true, false]);
  });
});

describe("composition and dead keys", () => {
  for (const [name, dead] of [["Chromium", chromiumDead], ["Firefox", firefoxDead]] as const) {
    it(`${name}: dead key then letter gives one d and one composed letter`, () => {
      const r = rig();
      dead(r, "~", "a", "ã", 1000);
      expect(r.ops.map((o) => o.k)).toEqual(["d", "c"]);
      expect(r.ops[1]).toMatchObject({ k: "c", ch: "ã", t: 50 });
      expect(r.input.value).toBe(SENTINEL);
      expect(r.pending).toContain("~");
      expect(r.pending.at(-1)).toBe(null);
    });
  }

  /** Chromium on blur: the mark commits through an untrusted compositionend, with no key after the dead key. */
  function cutDead(r: Rig, diacritic: string, ts: number) {
    r.win.fire("keydown", keyEvent({ key: "Dead", code: "Quote", keyCode: 229, ts }));
    r.input.fire("compositionstart", {});
    r.input.fire("compositionupdate", { data: diacritic });
    r.input.value = SENTINEL + diacritic;
    r.input.fire("input", { timeStamp: ts + 5 });
    r.input.fire("compositionend", { data: diacritic, isTrusted: false, timeStamp: ts + 6 });
  }

  it("drops a dead key's mark when a blur cuts the composition off", () => {
    const r = rig();
    typeKey(r, "n", 0);
    cutDead(r, "~", 100);
    expect(r.input.value).toBe(SENTINEL);
    expect(r.pending.at(-1)).toBe(null);
    chromiumDead(r, "~", "a", "ã", 1000);
    typeKey(r, "o", 1100);
    expect(r.ops.filter((o) => o.k === "c").map((o) => (o.k === "c" ? o.ch : ""))).toEqual(["n", "ã", "o"]);
  });

  it("keeps a mark typed on purpose with Space after the dead key", () => {
    const r = rig();
    r.win.fire("keydown", keyEvent({ key: "Dead", code: "Quote", keyCode: 229, ts: 0 }));
    r.input.fire("compositionstart", {});
    r.input.fire("compositionupdate", { data: "~" });
    r.input.value = SENTINEL + "~";
    r.input.fire("input", { timeStamp: 5 });
    r.win.fire("keydown", keyEvent({ key: "Process", code: "Space", keyCode: 229, isComposing: true, ts: 40 }));
    r.input.fire("compositionend", { data: "~", timeStamp: 45 });
    expect(r.ops.filter((o) => o.k === "c")).toMatchObject([{ ch: "~" }]);
  });

  it("folds ć to ç for Portuguese only", () => {
    const pt = rig();
    pt.capture.setFoldCAcute(true);
    chromiumDead(pt, "´", "c", "ć", 0);
    expect(pt.ops[1]).toMatchObject({ ch: "ç" });
    const en = rig();
    chromiumDead(en, "´", "c", "ć", 0);
    expect(en.ops[1]).toMatchObject({ ch: "ć" });
  });

  it("maps smart punctuation from a virtual keyboard", () => {
    expect(normalizeTyped("don’t “a” – b…", false)).toBe(`don't "a" - b...`);
  });

  it("composes a decomposed letter that arrives in two inputs", () => {
    const r = rig();
    r.input.value = SENTINEL + "a";
    r.input.fire("input", { timeStamp: 10 });
    r.input.value = SENTINEL + "ã";
    r.input.fire("input", { timeStamp: 20 });
    expect(sum(r.ops)).toBe("abã");
  });

  it("treats Android's growing composition, autocorrect and whole words through the diff", () => {
    const r = rig();
    r.win.fire("keydown", keyEvent({ key: "Unidentified", code: "", keyCode: 229, ts: 0 }));
    r.input.fire("compositionstart", {});
    for (const text of ["t", "te", "teh"]) {
      r.input.fire("compositionupdate", { data: text });
      r.input.value = SENTINEL + text;
      r.input.fire("input", { timeStamp: 5 });
    }
    r.input.fire("compositionupdate", { data: "the" });
    r.input.value = SENTINEL + "the";
    r.input.fire("input", { timeStamp: 9 });
    r.input.fire("compositionend", { timeStamp: 9 });
    expect(sum(r.ops)).toBe("tehbbhe");
    expect(r.virtual.count).toBeGreaterThan(0);
  });

  it("emits a word delete once when a keyboard removes many characters", () => {
    const r = rig();
    r.input.value = SENTINEL + "abc";
    r.input.fire("input", { timeStamp: 1 });
    r.input.fire("beforeinput", inputEvent("deleteWordBackward", null, 2, false));
    r.input.value = SENTINEL;
    r.input.fire("input", { timeStamp: 2 });
    expect(r.ops.filter((o) => o.k === "w").length).toBe(1);
    expect(r.ops.filter((o) => o.k === "b").length).toBe(0);
  });
});

describe("what never reaches the engine", () => {
  it("cancels paste, drop, history and untrusted input", () => {
    const r = rig();
    for (const type of ["insertFromPaste", "insertFromDrop", "historyUndo", "deleteByCut", "insertLineBreak"]) {
      const event = inputEvent(type, "x");
      r.input.fire("beforeinput", event);
      expect(event.defaultPrevented).toBe(true);
    }
    const forged = { ...inputEvent("insertText", "x"), isTrusted: false, preventDefault() {} };
    r.input.fire("beforeinput", forged);
    expect(r.ops).toEqual([]);
  });

  it("ignores a value set by script and announced with a forged input event", () => {
    const r = rig();
    r.input.value = SENTINEL + "não você ";
    r.input.fire("input", { isTrusted: false, timeStamp: 10 });
    expect(r.ops).toEqual([]);
    expect(r.input.value).toBe(SENTINEL);
    typeKey(r, "n", 20);
    expect(sum(r.ops)).toBe("n");
  });

  it("ignores forged keydowns", () => {
    const r = rig();
    r.win.fire("keydown", keyEvent({ key: "a", isTrusted: false }));
    r.input.fire("beforeinput", inputEvent("insertText", "a"));
    expect(r.ops).toEqual([]);
  });
});

describe("focus ownership", () => {
  const control = { tagName: "BUTTON", closest: () => null };
  const inDialog = { tagName: "BUTTON", closest: () => ({}) };

  it("takes a letter from a control and keeps it", () => {
    const r = rig();
    r.doc.activeElement = control;
    r.win.fire("keydown", keyEvent({ key: "a", ts: 0 }));
    expect(r.input.focused).toBe(1);
  });

  it("leaves chords, Tab and Enter with the control, and Space while idle", () => {
    const r = rig();
    r.doc.activeElement = control;
    for (const event of [
      keyEvent({ key: "c", ctrlKey: true }),
      keyEvent({ key: "Tab" }),
      keyEvent({ key: "Enter" }),
      keyEvent({ key: " ", code: "Space" }),
    ]) {
      r.win.fire("keydown", event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(r.input.focused).toBe(0);
  });

  it("takes Space during a run", () => {
    const r = rig();
    r.setScope("running");
    r.doc.activeElement = control;
    r.win.fire("keydown", keyEvent({ key: " ", code: "Space" }));
    expect(r.input.focused).toBe(1);
  });

  it("takes any typing key from an empty focus", () => {
    const r = rig();
    r.doc.activeElement = { tagName: "BODY" };
    r.win.fire("keydown", keyEvent({ key: " ", code: "Space" }));
    expect(r.input.focused).toBe(1);
  });

  it("never steals from a dialog or an open popover", () => {
    const r = rig();
    r.doc.activeElement = inDialog;
    r.win.fire("keydown", keyEvent({ key: "a" }));
    expect(r.input.focused).toBe(0);
    r.doc.activeElement = { tagName: "BODY" };
    r.setOverlay(true);
    r.win.fire("keydown", keyEvent({ key: "a" }));
    expect(r.input.focused).toBe(0);
  });
});

describe("keymap through capture", () => {
  it("Tab gives new words, Shift+Tab moves natively", () => {
    const r = rig();
    const tab = keyEvent({ key: "Tab" });
    r.win.fire("keydown", tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(r.actions).toEqual(["new-words"]);
    const shiftTab = keyEvent({ key: "Tab", shiftKey: true });
    r.win.fire("keydown", shiftTab);
    expect(shiftTab.defaultPrevented).toBe(false);
    expect(r.actions).toEqual(["new-words"]);
  });

  it("Esc depends on the phase", () => {
    const r = rig();
    r.win.fire("keydown", keyEvent({ key: "Escape" }));
    r.setScope("running");
    r.win.fire("keydown", keyEvent({ key: "Escape" }));
    expect(r.actions).toEqual(["focus-chrome", "abort"]);
  });

  it("Alt+M matches the physical key and stops µ landing", () => {
    const r = rig();
    const mac = keyEvent({ key: "µ", code: "KeyM", altKey: true });
    r.win.fire("keydown", mac);
    expect(mac.defaultPrevented).toBe(true);
    expect(r.actions).toEqual(["toggle-sound"]);
  });

  it("does not let AltGr pretend to be a Ctrl chord", () => {
    const r = rig();
    const altGr = keyEvent({ key: "a", ctrlKey: true, altKey: true });
    r.win.fire("keydown", altGr);
    expect(altGr.defaultPrevented).toBe(false);
  });

  it("swallows Ctrl+A and arrows", () => {
    const r = rig();
    for (const event of [keyEvent({ key: "a", ctrlKey: true }), keyEvent({ key: "ArrowLeft" }), keyEvent({ key: "v", metaKey: true })]) {
      r.win.fire("keydown", event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(r.actions).toEqual([]);
  });

  it("on results, Enter is the primary action and Tab new words", () => {
    const r = rig();
    r.setScope("finished");
    r.win.fire("keydown", keyEvent({ key: "Enter" }));
    r.win.fire("keydown", keyEvent({ key: "Tab" }));
    expect(r.actions).toEqual(["primary", "new-words"]);
  });
});

describe("reset", () => {
  it("restarts the timebase for a new run", () => {
    const r = rig();
    typeKey(r, "a", 1000);
    typeKey(r, "b", 1100);
    r.capture.reset();
    typeKey(r, "c", 5000);
    expect(r.ops[2]).toMatchObject({ t: 0 });
    expect(r.capture.origin()).toBe(5000);
  });
});

describe("properties", () => {
  it("sync is idempotent: replaying input and compositionend never emits twice", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: fc.constantFrom("a", "b", "ã", "ç", " ", "é") , minLength: 0, maxLength: 6 }), { minLength: 1, maxLength: 12 }),
        (values) => {
          const r = rig();
          r.input.fire("compositionstart", {});
          let t = 0;
          for (const text of values) {
            r.input.fire("compositionupdate", { data: text });
            r.input.value = SENTINEL + text;
            r.input.fire("input", { timeStamp: (t += 5) });
            const before = r.ops.length;
            r.input.fire("input", { timeStamp: (t += 5) });
            r.input.fire("input", { timeStamp: (t += 5) });
            expect(r.ops.length).toBe(before);
          }
          r.input.fire("compositionend", { timeStamp: (t += 5) });
          const after = r.ops.length;
          r.input.fire("input", { timeStamp: (t += 5) });
          r.input.fire("compositionend", { timeStamp: (t += 5) });
          expect(r.ops.length).toBe(after);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("input and compositionend in either order produce the same ops", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(["~", "a", "ã"], ["~", "o", "õ"], ["´", "e", "é"], ["^", "o", "ô"], ["´", "c", "ç"]),
        ([d, l, c]) => {
          const a = rig();
          const b = rig();
          chromiumDead(a, d as string, l as string, c as string, 100);
          firefoxDead(b, d as string, l as string, c as string, 100);
          expect(sum(a.ops)).toBe(sum(b.ops));
          expect(a.ops.map((o) => o.t)).toEqual(b.ops.map((o) => o.t));
        },
      ),
      { numRuns: 100 },
    );
  });

  const arbText = fc.string({ unit: fc.constantFrom("a", "ã", "ç", " ", "😀", "​", "’", "—", "…", "\n", "̃", "é", "🇧🇷", " "), maxLength: 5 });
  const arbEvent = fc.oneof(
    fc.record({ kind: fc.constant("key" as const), ch: fc.constantFrom("a", " ", "Backspace", "Dead", "Process", "Unidentified", "Shift", "Tab", "CapsLock"), dt: fc.integer({ min: -30, max: 200 }), repeat: fc.boolean() }),
    fc.record({ kind: fc.constant("before" as const), type: fc.constantFrom("insertText", "deleteContentBackward", "deleteWordBackward", "insertFromPaste", "insertCompositionText"), data: arbText, cancelable: fc.boolean() }),
    fc.record({ kind: fc.constant("value" as const), value: arbText, keepSentinel: fc.boolean() }),
    fc.record({ kind: fc.constant("compStart" as const) }),
    fc.record({ kind: fc.constant("compUpdate" as const), data: arbText }),
    fc.record({ kind: fc.constant("compEnd" as const) }),
    fc.record({ kind: fc.constant("keyup" as const), ch: fc.constantFrom("a", " ", "Backspace") }),
  );

  it("a fuzzed event stream never emits a multi-unit ch, an untypable unit or a non-monotonic t", () => {
    fc.assert(
      fc.property(fc.array(arbEvent, { maxLength: 80 }), (events) => {
        const r = rig();
        let ts = 1000;
        for (const event of events) {
          ts += 1;
          switch (event.kind) {
            case "key":
              ts += event.dt;
              r.win.fire("keydown", keyEvent({
                key: event.ch,
                code: event.ch === "Unidentified" ? "" : event.ch === " " ? "Space" : event.ch,
                keyCode: event.ch === "Process" || event.ch === "Unidentified" ? 229 : 0,
                ts,
                repeat: event.repeat,
              }));
              break;
            case "before":
              r.input.fire("beforeinput", inputEvent(event.type, event.data, ts, event.cancelable));
              break;
            case "value":
              r.input.value = (event.keepSentinel ? SENTINEL : "") + event.value;
              r.input.fire("input", { timeStamp: ts });
              break;
            case "compStart":
              r.input.fire("compositionstart", {});
              break;
            case "compUpdate":
              r.input.fire("compositionupdate", { data: event.data });
              break;
            case "compEnd":
              r.input.fire("compositionend", { timeStamp: ts });
              break;
            case "keyup":
              r.win.fire("keyup", keyEvent({ key: event.ch, code: event.ch === " " ? "Space" : event.ch, ts }));
              break;
          }
        }
        let prev = 0;
        for (const op of r.ops) {
          expect(Number.isSafeInteger(op.t)).toBe(true);
          expect(op.t).toBeGreaterThanOrEqual(prev);
          prev = op.t;
          if (op.k === "c") {
            expect(op.ch.length).toBe(1);
            expect(isTypableUnit(op.ch.charCodeAt(0))).toBe(true);
          }
          if (op.h !== undefined) expect(op.h).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
