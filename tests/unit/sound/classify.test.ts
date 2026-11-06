import { describe, expect, it } from "vitest";
import { keyClass, type KeyLike } from "@/sound/classify";
import type { KeyClass } from "@/sound/types";

const table: [string, KeyLike, KeyClass | null][] = [
  ["letter", { key: "a", code: "KeyA", keyCode: 65 }, "key"],
  ["capital", { key: "A", code: "KeyA" }, "key"],
  ["digit", { key: "7", code: "Digit7" }, "key"],
  ["punctuation", { key: ";", code: "Semicolon" }, "key"],
  ["composed letter", { key: "ã", code: "KeyA" }, "key"],
  ["two code point composed letter", { key: "ã", code: "KeyA" }, "key"],
  ["cedilla on ABNT2", { key: "ç", code: "Semicolon" }, "key"],
  ["ABNT2 IntlRo", { key: "/", code: "IntlRo" }, "key"],
  ["AltGr reported as ctrl+alt", { key: "/", code: "KeyQ", ctrlKey: true, altKey: true }, "key"],
  ["Option character on Mac", { key: "µ", code: "KeyM", altKey: true }, "key"],

  ["dead key", { key: "Dead", code: "Quote" }, "key"],
  ["Unidentified", { key: "Unidentified", code: "" }, "key"],
  ["Process", { key: "Process", code: "KeyA", keyCode: 229 }, "key"],
  ["Android 229 with Unidentified", { key: "Unidentified", code: "", keyCode: 229 }, "key"],
  ["229 with empty key", { key: "", code: "", keyCode: 229 }, "key"],
  ["229 with a printable key", { key: "a", code: "KeyA", keyCode: 229 }, "key"],

  ["space", { key: " ", code: "Space" }, "space"],
  ["enter", { key: "Enter", code: "Enter" }, "enter"],
  ["numpad enter", { key: "Enter", code: "NumpadEnter" }, "enter"],
  ["backspace", { key: "Backspace", code: "Backspace" }, "backspace"],
  ["composing backspace keeps its class", { key: "Process", code: "Backspace", keyCode: 229 }, "backspace"],
  ["composing space keeps its class", { key: "Process", code: "Space", keyCode: 229 }, "space"],

  ["Shift", { key: "Shift", code: "ShiftLeft" }, null],
  ["Control", { key: "Control", code: "ControlLeft", ctrlKey: true }, null],
  ["Alt", { key: "Alt", code: "AltLeft", altKey: true }, null],
  ["AltGraph", { key: "AltGraph", code: "AltRight" }, null],
  ["Meta", { key: "Meta", code: "MetaLeft", metaKey: true }, null],
  ["CapsLock", { key: "CapsLock", code: "CapsLock" }, null],
  ["Escape", { key: "Escape", code: "Escape" }, null],
  ["Tab", { key: "Tab", code: "Tab" }, null],
  ["F1", { key: "F1", code: "F1" }, null],
  ["F12", { key: "F12", code: "F12" }, null],
  ["arrow", { key: "ArrowLeft", code: "ArrowLeft" }, null],
  ["Ctrl chord", { key: "c", code: "KeyC", ctrlKey: true }, null],
  ["Ctrl+Backspace word delete", { key: "Backspace", code: "Backspace", ctrlKey: true }, "backspace"],
  ["Meta chord", { key: "v", code: "KeyV", metaKey: true }, null],
  ["Shift during composition stays a modifier", { key: "Shift", code: "ShiftLeft", keyCode: 229 }, null],
  ["autofill keydown without a key", { code: "" }, null],

  // An IME takes these keys too, so the physical code is all that says they type nothing.
  ["composing Shift", { key: "Process", code: "ShiftLeft", keyCode: 229 }, null],
  ["composing Control", { key: "Process", code: "ControlRight", keyCode: 229 }, null],
  ["composing Alt", { key: "Process", code: "AltRight", keyCode: 229 }, null],
  ["composing Meta", { key: "Process", code: "MetaLeft", keyCode: 229 }, null],
  ["composing CapsLock", { key: "Process", code: "CapsLock", keyCode: 229 }, null],
  ["composing Escape", { key: "Process", code: "Escape", keyCode: 229 }, null],
  ["composing Tab", { key: "Process", code: "Tab", keyCode: 229 }, null],
  ["composing arrow", { key: "Process", code: "ArrowLeft", keyCode: 229 }, null],
  ["composing F5", { key: "Process", code: "F5", keyCode: 229 }, null],
  ["composing Delete", { key: "Process", code: "Delete", keyCode: 229 }, null],
  ["Unidentified Shift", { key: "Unidentified", code: "ShiftLeft", keyCode: 229 }, null],
  ["empty key Shift", { key: "", code: "ShiftLeft", keyCode: 229 }, null],
  ["composing letter still counts", { key: "Process", code: "KeyF", keyCode: 229 }, "key"],
  ["composing Equal still counts", { key: "Process", code: "Equal", keyCode: 229 }, "key"],
  ["composing IntlRo still counts", { key: "Process", code: "IntlRo", keyCode: 229 }, "key"],
  ["composing numpad digit still counts", { key: "Process", code: "Numpad5", keyCode: 229 }, "key"],
  ["composing unknown code still counts", { key: "Process", code: "Lang1", keyCode: 229 }, "key"],

  ["Alt chord with a letter", { key: "d", code: "KeyD", altKey: true }, null],
  ["Alt chord with a capital", { key: "M", code: "KeyM", altKey: true }, null],
  ["Alt chord with a digit", { key: "1", code: "Digit1", altKey: true }, null],
  ["Ctrl+Alt chord with a letter", { key: "t", code: "KeyT", ctrlKey: true, altKey: true }, null],
  ["AltGr symbol on ABNT2", { key: "°", code: "KeyE", ctrlKey: true, altKey: true }, "key"],
  ["Option dead key on Mac", { key: "Dead", code: "KeyE", altKey: true }, "key"],
  ["Option word delete on Mac", { key: "Backspace", code: "Backspace", altKey: true }, "backspace"],
];

describe("keyClass", () => {
  it.each(table)("%s", (_name, event, expected) => {
    expect(keyClass(event)).toBe(expected);
  });

  it("sounds both presses of a dead-key composition", () => {
    const first = keyClass({ key: "Dead", code: "BracketLeft", keyCode: 229 });
    const second = keyClass({ key: "ã", code: "KeyA", keyCode: 229 });
    expect([first, second]).toEqual(["key", "key"]);
  });
});
