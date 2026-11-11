"use client";

import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { DistributionStrip } from "@/components/charts/distribution-strip";
import { msUntilNextDay } from "@/engine/day";
import type { Language } from "@/engine/packs";
import { dictionary, href, type Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { ACCOUNTS } from "@/lib/accounts-flag";
import { addTicket, type HeldTicket } from "@/typing/ranked/pool";
import { defaultSettings, saveSettings } from "@/typing/settings";
import type { YourPlace } from "@/server/ranking";
import { COUNT_MIN_PLAYERS, accuracyText, shareText, untilNext, wpmText } from "./model";
import { authedFetch, useSignedIn } from "./report-link";

export interface BoardSummary {
  day: string;
  total: number;
  speeds: number[];
}

type Mine = { username: string; place: YourPlace } | null;

function Countdown({ lang }: { lang: Lang }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const t = boardStrings(lang).today;
    const tick = () => {
      const { h, m } = untilNext(msUntilNextDay(Date.now()));
      setText(t.newText(h, m));
    };
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [lang]);
  return (
    <p className="bd-next" data-testid="new-text-in">
      {text}
    </p>
  );
}

const subscribeNothing = () => () => {};
const isTouch = () => matchMedia("(pointer: coarse)").matches;

type RevealState = "idle" | "warning" | "busy" | "spent" | "needs-account" | "failed";

/** The attempt is spent by the request itself, so everything that could change someone's mind is said before it. */
function Reveal({ lang, language }: { lang: Lang; language: Language }) {
  const t = boardStrings(lang).today;
  const [state, setState] = useState<RevealState>("idle");
  const touch = useSyncExternalStore(subscribeNothing, isTouch, () => false);

  async function reveal() {
    setState("busy");
    try {
      const response = await authedFetch("/api/today/reveal", { method: "POST", body: { language } });
      if (!response) return setState("failed");
      if (response.status === 409) return setState("spent");
      if (response.status === 403) return setState("needs-account");
      if (!response.ok) return setState("failed");
      const ticket = (await response.json()) as HeldTicket;
      addTicket(ticket, true);
      // Against the home page's own default, which follows the interface: saved only where it differs from that.
      saveSettings({ ...defaultSettings(language), mode: { kind: "time", seconds: 60 }, language, tier: "1k" }, lang === "pt-br" ? "pt" : "en");
      window.location.assign(href(lang, "/"));
    } catch {
      setState("failed");
    }
  }

  if (state === "spent") return <p className="bd-note">{t.spent}</p>;
  if (state === "needs-account")
    return (
      <p className="bd-note">
        {t.needsAccount}{" "}
        <a className="bd-text-action" href={href(lang, "/settings")}>
          {t.account}
        </a>
      </p>
    );
  if (state === "idle" || state === "failed")
    return (
      <>
        {state === "failed" ? <p className="bd-note">{t.failed}</p> : null}
        <button type="button" className="bd-primary" onClick={() => setState("warning")}>
          {t.start}
        </button>
      </>
    );
  return (
    <div className="bd-warn" role="group" aria-label={t.start}>
      <p>{t.spentNote}</p>
      {touch ? <p>{t.touchNote}</p> : null}
      <p>{t.hiddenNote}</p>
      <div className="bd-warn-actions">
        <button type="button" className="bd-primary" disabled={state === "busy"} onClick={() => void reveal()}>
          {t.confirm}
        </button>
        <button type="button" className="hit link-quiet" onClick={() => setState("idle")}>
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

function Share({ lang, day, place }: { lang: Lang; day: string; place: YourPlace }) {
  const s = boardStrings(lang);
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="bd-text-action hit"
      onClick={() => {
        const text = shareText({
          day,
          wpmCx: place.wpmCx,
          accuracyBp: place.accuracyBp,
          rank: place.onBoard ? place.rank : null,
          total: place.total,
          url: `${window.location.origin}${href(lang, "/today")}`,
          lang,
          ordinal: s.ordinal,
        });
        void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined);
      }}
    >
      {copied ? s.today.copied : s.today.share}
    </button>
  );
}

/** Your row: highlighted where it sits on the board, and pinned to the bottom of the screen while that spot is out of view. */
function YourRow({ lang, mine, scope }: { lang: Lang; mine: NonNullable<Mine>; scope: HTMLElement | null }) {
  const t = boardStrings(lang).today;
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!scope || !mine.place.onBoard) return;
    const row = scope.querySelector<HTMLTableRowElement>(`tr[data-name="${CSS.escape(mine.username)}"]`);
    if (!row) return;
    row.classList.add("bd-you");
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false));
    observer.observe(row);
    return () => {
      observer.disconnect();
      row.classList.remove("bd-you");
    };
  }, [scope, mine]);
  if (inView) return null;
  const { place } = mine;
  return (
    <table className="bd-table bd-pinned" data-testid="your-row">
      <tbody>
        <tr className="bd-gap" aria-hidden="true">
          <td colSpan={4} />
        </tr>
        <tr className="bd-you">
          <td className="bd-rank">{place.onBoard ? place.rank : ""}</td>
          <td className="bd-name">
            {mine.username}
            <span className="bd-you-tag">{t.you}</span>
          </td>
          <td className="bd-wpm bd-n">{wpmText(place.wpmCx)}</td>
          <td className="bd-acc bd-n">{accuracyText(place.accuracyBp)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function TodayIsland({
  lang,
  initial,
  boards,
  children,
}: {
  lang: Lang;
  initial: Language;
  boards: Record<Language, BoardSummary | null>;
  children: ReactNode;
}) {
  const t = boardStrings(lang).today;
  const [list, setList] = useState<Language>(initial);
  const [mine, setMine] = useState<Partial<Record<Language, Mine>>>({});
  const signedIn = useSignedIn();
  const [scope, setScope] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!ACCOUNTS || !signedIn || mine[list] !== undefined) return;
    let stale = false;
    void authedFetch(`/api/today/me?language=${list}`)
      .then(async (response) => {
        if (!response?.ok || stale) return;
        const answer = (await response.json()) as { username: string | null; place: YourPlace | null };
        if (!stale) setMine((was) => ({ ...was, [list]: answer.username && answer.place ? { username: answer.username, place: answer.place } : null }));
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [list, signedIn, mine]);

  const board = boards[list];
  const yours = mine[list] ?? null;
  const players = board?.total ?? 0;
  return (
    <div className="bd-grid" data-list={list}>
      <div className="bd-main" ref={setScope}>
        {children}
        {yours ? <YourRow key={list} lang={lang} mine={yours} scope={scope} /> : null}
      </div>
      <aside className="bd-side">
        <Countdown lang={lang} />
        <div className="bd-switch" role="group" aria-label={t.boardLanguage}>
          {(["en", "pt"] as const).map((language) => (
            <button key={language} type="button" className="hit link-quiet" aria-pressed={list === language} onClick={() => setList(language)}>
              {language === "en" ? t.english : t.portuguese}
            </button>
          ))}
        </div>
        {players >= COUNT_MIN_PLAYERS ? <p data-testid="today-count">{t.count(players)}</p> : null}
        {board && board.speeds.length >= COUNT_MIN_PLAYERS ? (
          <DistributionStrip
            key={list}
            values={board.speeds}
            mine={yours ? yours.place.wpmCx / 100 : null}
            label={yours ? t.stripMine(players, wpmText(yours.place.wpmCx)) : t.strip(players)}
            revealKey={`today-${list}`}
          />
        ) : null}
        {ACCOUNTS && board ? (
          yours ? (
            <>
              {yours.place.onBoard ? <p>{t.yourPlace(yours.place.rank, yours.place.total)}</p> : <p>{t.offBoard}</p>}
              <Share lang={lang} day={board.day} place={yours.place} />
            </>
          ) : signedIn ? (
            <Reveal key={list} lang={lang} language={list} />
          ) : (
            <p>
              {t.guestLine}{" "}
              <a className="bd-text-action" href={href(lang, "/sign-in")}>
                {dictionary(lang).nav.signIn}
              </a>
            </p>
          )
        ) : null}
        <p>{t.source}</p>
      </aside>
    </div>
  );
}
