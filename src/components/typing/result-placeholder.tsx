import type { RunOutcome } from "@/typing/contract";
import type { TypingStrings } from "./typing-home";

/** Enough to test the run loop end to end. The results stage replaces this file. */
export function ResultPlaceholder({ outcome, t, onNewWords }: { outcome: RunOutcome; t: TypingStrings; onNewWords: () => void }) {
  return (
    <div className="tp-result" data-testid="result" data-wpm-cx={outcome.score.wpmCx} data-device={outcome.deviceClass}>
      <p>
        <span className="tp-result-n">{Math.round(outcome.score.wpm)}</span> <span className="tp-result-unit">{t.wpm}</span>
      </p>
      <p className="tp-result-sub">
        {Math.round(outcome.score.accuracy)}% {t.accuracy}
      </p>
      <button type="button" className="tp-ctl" onClick={onNewWords}>
        {t.newWords} <kbd>{t.tabKey}</kbd>
      </button>
    </div>
  );
}
