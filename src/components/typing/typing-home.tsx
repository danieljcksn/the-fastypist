"use client";

import { Component, lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Pack } from "@/engine/packs";
import type { RunOutcome } from "@/typing/contract";
import type { Dictionary, Lang } from "@/i18n";
import { createSession } from "@/typing/session";
import { createHomeStore, type HomeSnapshot, type HomeStore, type MenuId } from "@/typing/store";
import { prefetchLists, seedPack } from "@/typing/text";
import { ResultFallback } from "./result-fallback";

export type TypingStrings = Dictionary["typing"];

const loadPanels = () => import("./panels");
const Panels = lazy(loadPanels);

const loadResults = () => import("@/components/results/results-screen");
const ResultsScreen = lazy(loadResults);

/** A chunk that won't load after a deploy or offline still leaves the number on screen and a way to go again. */
class ResultBoundary extends Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Whatever the saved settings say, the static HTML says this, and session.ts takes the number over after hydration.
const SERVER_NUMBER = "60";

function wordsLabel(snap: HomeSnapshot, t: TypingStrings): string {
  const { settings } = snap;
  const name = settings.language === "en" ? t.english : t.portuguese;
  if (settings.mode.kind === "quote") return name;
  let label = name;
  if (settings.tier !== "1k") label += ` ${settings.tier}`;
  if (settings.language === "pt" && settings.accentFree) label += ` ${t.accentFreeWords}`;
  const extras = [settings.punctuation ? t.punctuation : null, settings.numbers ? t.numbers : null].filter(Boolean);
  if (extras.length > 0) label += ` ${t.withWord} ${extras.join(` ${t.and} `)}`;
  return label;
}

function unitLabel(snap: HomeSnapshot, t: TypingStrings): string {
  const { mode } = snap.settings;
  if (mode.kind === "time") return t.seconds;
  if (mode.kind === "words") return t.words;
  if (mode.kind === "quote") return t.quoteUnit;
  return snap.count === 1 ? t.customUnitOne : t.customUnit;
}

function modeNumber(snap: HomeSnapshot): number {
  const { mode } = snap.settings;
  if (mode.kind === "time") return mode.seconds;
  if (mode.kind === "words") return mode.count;
  return snap.count;
}

interface SentenceProps {
  store: HomeStore;
  snap: HomeSnapshot;
  t: TypingStrings;
  slot: React.RefObject<HTMLDivElement | null>;
}

function Sentence({ store, snap, t, slot }: SentenceProps) {
  const { mode } = snap.settings;
  const open = snap.menu?.id ?? null;

  const toggle = (id: MenuId) => (e: React.MouseEvent<HTMLElement>) => {
    if (open === id) {
      store.closeMenu();
      store.session?.focusInput();
      return;
    }
    const left = slot.current?.getBoundingClientRect().left ?? 0;
    // The mode popover belongs to the number too, so it starts on the column's edge, under the 60.
    const x = id === "mode" ? 0 : e.currentTarget.getBoundingClientRect().left - left;
    store.openMenu(id, x, e.detail > 0);
  };

  const trigger = (id: MenuId) => ({
    "data-menu-trigger": id,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": open === id,
    onClick: toggle(id),
    className: "tp-ctl",
    type: "button" as const,
  });

  const unit = snap.drill ? t.words : unitLabel(snap, t);
  const words = wordsLabel(snap, t);
  const profileName = t[snap.sound.profile];
  const connector = mode.kind === "quote" ? t.in : mode.kind === "custom" ? null : t.of;

  const drillPairs = snap.drill?.pairs;
  return (
    <p data-chrome className="tp-sentence">
      {drillPairs ? (
        <>
          {`${unit} ${t.drilling} `}
          <span translate="no" data-testid="drill-pairs" className="tp-drilled">
            {drillPairs.length > 1 ? `${drillPairs.slice(0, -1).join(", ")} ${t.and} ${drillPairs.at(-1)}` : drillPairs[0]}
          </span>
          {", "}
          <button type="button" className="tp-ctl" data-first-control onClick={() => store.session?.leaveDrill()}>
            {t.stopDrill}
          </button>
        </>
      ) : (
        <button
          {...trigger("mode")}
          data-first-control
          aria-label={t.changeTest.replace("{n}", String(modeNumber(snap))).replace("{unit}", unit)}
        >
          {unit}
        </button>
      )}
      {!drillPairs && connector ? (
        <>
          {` ${connector} `}
          <button {...trigger("language")} aria-label={t.changeWords.replace("{label}", words)}>
            {words}
          </button>
        </>
      ) : null}
      {", "}
      <span className="tp-sound">
        <button
          type="button"
          className="tp-ctl"
          aria-pressed={snap.sound.enabled}
          onClick={(e) => {
            store.session?.toggleSound();
            // A mouse click must not leave focus where the next Space would press this again.
            if (e.detail > 0) store.session?.focusInput();
          }}
        >
          {snap.sound.enabled ? t.soundOn : t.soundOff}
        </button>
        {snap.sound.enabled ? (
          <>
            {", "}
            <button {...trigger("sound")} aria-label={t.soundProfileLabel.replace("{profile}", profileName)}>
              {profileName}
            </button>
          </>
        ) : null}
      </span>
    </p>
  );
}

interface TypingHomeProps {
  lang: Lang;
  t: TypingStrings;
  pack: Pack;
  otherLanguageHref: string;
  otherLanguageName: string;
}

export function TypingHome({ lang, t, pack, otherLanguageHref, otherLanguageName }: TypingHomeProps) {
  const [store] = useState(() => {
    seedPack(pack);
    return createHomeStore(pack.language);
  });
  const snap = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  const helpId = useId();
  const upcomingId = useId();

  const root = useRef<HTMLElement>(null);
  const block = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLSpanElement>(null);
  const pace = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const number = useRef<HTMLSpanElement>(null);
  const live = useRef<HTMLSpanElement>(null);
  const upcoming = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const els = {
      root: root.current,
      block: block.current,
      viewport: viewport.current,
      rows: rows.current,
      cursor: cursor.current,
      ghost: ghost.current,
      pace: pace.current,
      probe: probe.current,
      input: input.current,
      number: number.current,
      live: live.current,
      upcoming: upcoming.current,
      status: status.current,
    };
    if (Object.values(els).some((el) => el === null)) return;
    store.hydrate();
    const session = createSession(els as Parameters<typeof createSession>[0], store, {
      secondsLeft: t.secondsLeft,
      stoppedHidden: t.stoppedHidden,
      stoppedIdle: t.stoppedIdle,
      finished: t.finished,
      soundOn: t.soundIsOn,
      soundOff: t.soundIsOff,
      listFailed: t.listFailed,
      wpm: t.wpm,
    });
    return () => session.dispose();
  }, [store, t]);

  // In the commit that carries the saved settings, so the sentence is never painted saying the defaults.
  useLayoutEffect(() => {
    if (snap.hydrated) delete document.documentElement.dataset.pending;
  }, [snap.hydrated]);

  // Once a run has started: never in the first load, and it is here before the shortest run ends so the number has no wait.
  const started = snap.phase === "running";
  useEffect(() => {
    if (!started) return;
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => void loadResults(), { timeout: 1_000 });
    else setTimeout(() => void loadResults(), 32);
  }, [started]);

  // On intent, then on idle: 35 KB of lists nobody asked for would spend a fifth of the page's budget on every typist.
  const prefetchPanels = () => {
    void loadPanels();
    const language = store.get().settings.language;
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => prefetchLists(language));
    else setTimeout(() => prefetchLists(language), 32);
  };

  const fallback = (outcome: RunOutcome) => <ResultFallback outcome={outcome} t={t} onNewWords={() => store.session?.newWords()} />;

  return (
    <section ref={root} className="tp" data-phase="idle" translate="no" data-gramm="false">
      {/* Ahead of the input in the DOM: Tab there means new words, so Shift Tab is how a keyboard reaches these controls. */}
      {snap.outcome ? (
        <ResultBoundary key={snap.outcome.id} fallback={fallback(snap.outcome)}>
          <Suspense fallback={fallback(snap.outcome)}>
            <ResultsScreen outcome={snap.outcome} lang={lang} store={store} />
          </Suspense>
        </ResultBoundary>
      ) : null}
      <div ref={block} className="tp-block">
        <div ref={slot} className="tp-slot">
          <div className="tp-line" onPointerEnter={prefetchPanels} onFocusCapture={prefetchPanels}>
            <span
              ref={number}
              className="tp-n"
              role="timer"
              aria-live="off"
              onClick={() => {
                if (document.documentElement.dataset.typing !== undefined || snap.drill) return;
                if (snap.menu?.id === "mode") store.closeMenu();
                else store.openMenu("mode", 0, true);
              }}
            >
              {SERVER_NUMBER}
            </span>
            <Sentence store={store} snap={snap} t={t} slot={slot} />
            <span className="tp-caps">{t.caps}</span>
            <span className="tp-blurred">{t.pressAnyKey}</span>
            <div data-chrome className="tp-settings">
              <button
                type="button"
                className="tp-ctl"
                data-menu-trigger="settings"
                aria-haspopup="dialog"
                aria-expanded={snap.menu?.id === "settings"}
                onClick={(e) => store.openMenu("settings", 0, e.detail > 0)}
              >
                {t.settings}
              </button>
            </div>
            <span ref={live} className="tp-live" />
          </div>
          {snap.menu ? (
            <Suspense fallback={null}>
              <Panels store={store} snap={snap} t={t} otherLanguageHref={otherLanguageHref} otherLanguageName={otherLanguageName} />
            </Suspense>
          ) : null}
        </div>

        <div ref={viewport} className="tp-viewport">
          <div ref={rows} className="tp-rows" aria-hidden="true" />
          <span ref={pace} className="tp-pace" aria-hidden="true" hidden />
          <div ref={cursor} className="tp-cursor">
            <span className="tp-caret" aria-hidden="true" />
            <span ref={ghost} className="tp-ghost" aria-hidden="true" hidden />
            <input
              ref={input}
              className="tp-input"
              type="text"
              name="typing"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
              data-1p-ignore=""
              data-lpignore="true"
              data-bwignore="true"
              aria-label={t.inputLabel}
              aria-describedby={`${helpId} ${upcomingId}`}
              {...{ writingsuggestions: "false" }}
            />
          </div>
          <span ref={probe} className="tp-probe" aria-hidden="true">
            {"0".repeat(100)}
          </span>
        </div>

        <p data-chrome className="tp-hint">
          <span className="tp-hint-keys">{t.hint}</span>
          <span className="tp-hint-touch">{t.hintTouch}</span>
          {snap.note ? <span className="tp-note"> {snap.note}</span> : null}
        </p>
        <noscript>
          <p className="tp-noscript">{t.noscript}</p>
        </noscript>
      </div>

      <div id={helpId} hidden>
        {t.inputHelp}
      </div>
      <div ref={upcoming} id={upcomingId} hidden />
      <p ref={status} className="sr-only" aria-live="polite" />
    </section>
  );
}
