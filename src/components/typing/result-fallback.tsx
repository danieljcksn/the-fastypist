import type { RunOutcome } from "@/typing/contract";
import type { TypingStrings } from "./typing-home";

// Left side bearing of each digit in Red Hat Text 400, in em, from the font's hmtx table, plus 0.005 em on the round digits, or
// they look indented next to straight text. At 20 rem a 0.05 em bearing is 16 px off the column's edge.
const BEARING: readonly number[] = [0.062, 0.041, 0.065, 0.046, 0.039, 0.05, 0.052, 0.051, 0.056, 0.056];

export function heroBearing(text: string): string | undefined {
  const bearing = BEARING[text.charCodeAt(0) - 48];
  return bearing === undefined ? undefined : `${-bearing}em`;
}

export function ResultHero({ wpm, unit }: { wpm: number; unit: string }) {
  const text = String(Math.round(wpm));
  return (
    <h1 className="rs-hero">
      <span className="rs-n" data-digits={text.length} style={{ marginLeft: heroBearing(text) }}>
        {text}
      </span>
      <span className="rs-unit">{unit}</span>
    </h1>
  );
}

/** The number, the moment a run ends, for a typist who beat the full screen's chunk there or whose connection dropped it. */
export function ResultFallback({ outcome, t, onNewWords }: { outcome: RunOutcome; t: TypingStrings; onNewWords: () => void }) {
  return (
    <section className="rs" data-testid="result" data-wpm-cx={outcome.score.wpmCx} data-device={outcome.deviceClass}>
      <div className="rs-top">
        <ResultHero wpm={outcome.score.wpm} unit={t.wpm} />
      </div>
      <button type="button" className="tp-ctl rs-fallback-new" onClick={onNewWords}>
        {t.newWords} <kbd>{t.tabKey}</kbd>
      </button>
    </section>
  );
}
