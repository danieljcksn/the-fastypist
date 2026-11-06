import { charProgress, offsetAt } from "@/engine/analysis";
import { decodeLog } from "@/engine/log";
import { packIdFor, type TestSettings } from "../settings";
import type { PaceGeometry } from "../view";
import { bestKey } from "./rows";
import { getRaw } from "./raw";
import { loadHistory } from "./summaries";

function scopeOf(settings: TestSettings): Parameters<typeof bestKey>[0] {
  const { mode } = settings;
  const listed = mode.kind === "time" || mode.kind === "words";
  const mods = listed ? `${settings.punctuation ? "p" : ""}${settings.numbers ? "n" : ""}${settings.accentFree && settings.language === "pt" ? "a" : ""}` : "";
  const amount = mode.kind === "time" ? mode.seconds : mode.kind === "words" ? mode.count : 0;
  return { mode: mode.kind, amount, language: settings.language, pack: listed ? packIdFor(settings) : null, mods };
}

/** Where the best run on this exact test had got to, by seconds in. Null when there is none: no best yet, or its log is gone. */
export async function bestPace(settings: TestSettings): Promise<((seconds: number) => number) | null> {
  const key = bestKey(scopeOf(settings));
  const best = key === null ? undefined : loadHistory().bests[key];
  if (!best) return null;
  const raw = await getRaw(best.id);
  const entries = raw && decodeLog(raw.log);
  if (!raw || !entries) return null;
  const progress = charProgress(raw.cfg, raw.words, entries);
  return progress.length === 0 ? null : (seconds) => offsetAt(progress, seconds);
}

export interface PaceCaret {
  /** At most once a frame, from a clock. Never on a keystroke, and it reads no layout. */
  draw(seconds: number): void;
  hide(): void;
}

/** A character offset into the current text, as a cell. Word starts are worked out once per text, not per frame. */
export function paceCaret(el: HTMLElement, geometry: () => PaceGeometry, at: (seconds: number) => number): PaceCaret {
  let shown = "";
  let startsFor: readonly string[] | null = null;
  let starts: number[] = [];

  function hide() {
    if (shown === "") return;
    shown = "";
    el.hidden = true;
  }

  return {
    hide,
    draw(seconds) {
      const g = geometry();
      if (g.words !== startsFor) {
        startsFor = g.words;
        starts = [];
        let chars = 0;
        for (const word of g.words) {
          starts.push(chars);
          chars += word.length + 1;
        }
      }
      if (starts.length === 0) return hide();
      const whole = Math.max(0, Math.floor(at(seconds)));
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if ((starts[middle] ?? 0) <= whole) low = middle;
        else high = middle - 1;
      }
      const lineIndex = g.lineOf[low] ?? 0;
      const line = g.lines[lineIndex];
      const row = lineIndex - g.first;
      if (!line || row < 0 || row > 2) return hide();
      let col = (g.colOf[low] ?? 0) + Math.min(whole - (starts[low] ?? 0), g.words[low]?.length ?? 0);
      // The rows carry the typist's extras, so anything on this line before the word has moved along with them.
      for (let j = line.first; j < low; j++) {
        const over = (g.typed[j]?.length ?? 0) - (g.words[j]?.length ?? 0);
        if (over > 0) col += over;
      }
      if (lineIndex === g.shiftLine) col -= g.shift;
      const transform = `translate3d(${col * g.ch}px,${row * g.lh}px,0)`;
      if (transform !== shown) {
        if (shown === "") el.hidden = false;
        shown = transform;
        el.style.transform = transform;
      }
    },
  };
}
