"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CUSTOM_MAX_CHARS, parseCustomText } from "@/engine/custom";
import type { Tier } from "@/engine/packs";
import type { ModeSpec } from "@/engine/presets";
import type { SoundProfile } from "@/sound/types";
import { TIERS, TIME_CHOICES, WORD_CHOICES } from "@/typing/settings";
import type { HomeSnapshot, HomeStore, MenuId } from "@/typing/store";
import { SettingsPanel } from "./settings-panel";
import type { TypingStrings } from "./typing-home";

const TRIGGERS = "[data-menu-trigger],.tp-n";

const PROFILES: readonly SoundProfile[] = ["soft", "crisp", "pop"];

export interface PanelProps {
  store: HomeStore;
  snap: HomeSnapshot;
  t: TypingStrings;
}

function closeTo(store: HomeStore, id: MenuId, viaPointer: boolean) {
  store.closeMenu();
  if (viaPointer) store.session?.focusInput();
  else store.session?.focusTrigger(id);
}

export function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="tp-choice" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/** Both states shown, the current one underlined, as every other choice in the panel reads. */
export function Toggle({ on, onChange, t }: { on: boolean; onChange: (next: boolean) => void; t: TypingStrings }) {
  return (
    <>
      <Choice on={on} onClick={() => (on ? undefined : onChange(true))}>
        {t.on}
      </Choice>
      <Choice on={!on} onClick={() => (on ? onChange(false) : undefined)}>
        {t.off}
      </Choice>
    </>
  );
}

function Popover({ store, snap, label, children }: { store: HomeStore; snap: HomeSnapshot; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const menu = snap.menu;
  const id = menu?.id;
  const viaPointer = menu?.viaPointer ?? true;

  // Its width comes from its contents, so whether it fits under its word is only known once it exists.
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const over = el.getBoundingClientRect().right - parent.getBoundingClientRect().right;
    el.style.setProperty("--pull", over > 0 ? `${over}px` : "0px");
  }, [menu?.x]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !id) return;
    const start = el.querySelector<HTMLElement>('[aria-pressed="true"]') ?? el.querySelector<HTMLElement>("button,input");
    start?.focus({ preventScroll: true });
    // On click, not pointerdown: mousedown would take focus back off the input right after this returned it.
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      // A trigger's own click closes or switches. Closing here as well would make it reopen.
      if (el.contains(target) || target.closest?.(TRIGGERS)) return;
      closeTo(store, id, true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeTo(store, id, viaPointer);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [store, id, viaPointer]);

  return (
    <div
      ref={ref}
      className="tp-pop"
      role="dialog"
      aria-label={label}
      style={{ "--x": `${menu?.x ?? 0}px` } as React.CSSProperties}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        // Null is a click on nothing or the window losing focus, and the click handler owns the first.
        if (next && !ref.current?.contains(next) && !(next as Element).closest?.(TRIGGERS)) store.closeMenu();
      }}
    >
      {children}
    </div>
  );
}

function ModePopover({ store, snap, t }: PanelProps) {
  const { mode } = snap.settings;
  const pick = (next: ModeSpec) => {
    store.setSettings({ mode: next });
    store.closeMenu();
    store.session?.focusInput();
  };
  return (
    <Popover store={store} snap={snap} label={t.modeMenu}>
      <div className="tp-pop-row" role="group" aria-label={t.time}>
        <span className="tp-pop-label">{t.time}</span>
        {TIME_CHOICES.map((seconds) => (
          <Choice key={seconds} on={mode.kind === "time" && mode.seconds === seconds} onClick={() => pick({ kind: "time", seconds })}>
            {seconds}
          </Choice>
        ))}
      </div>
      <div className="tp-pop-row" role="group" aria-label={t.wordsMode}>
        <span className="tp-pop-label">{t.wordsMode}</span>
        {WORD_CHOICES.map((count) => (
          <Choice key={count} on={mode.kind === "words" && mode.count === count} onClick={() => pick({ kind: "words", count })}>
            {count}
          </Choice>
        ))}
      </div>
      <div className="tp-pop-row">
        <span className="tp-pop-label" />
        <Choice on={mode.kind === "quote"} onClick={() => pick({ kind: "quote" })}>
          {t.quote}
        </Choice>
        <Choice on={mode.kind === "custom"} onClick={() => store.openMenu("custom", 0, snap.menu?.viaPointer ?? true)}>
          {t.custom}
        </Choice>
      </div>
    </Popover>
  );
}

function LanguagePopover({ store, snap, t }: PanelProps) {
  const { settings } = snap;
  const fixedText = settings.mode.kind === "quote";
  return (
    <Popover store={store} snap={snap} label={t.wordsMenu}>
      <div className="tp-pop-row" role="group" aria-label={t.language}>
        <span className="tp-pop-label">{t.language}</span>
        <Choice on={settings.language === "en"} onClick={() => store.setSettings({ language: "en" })}>
          {t.english}
        </Choice>
        <Choice on={settings.language === "pt"} onClick={() => store.setSettings({ language: "pt" })}>
          {t.portuguese}
        </Choice>
      </div>
      {fixedText ? null : (
        <>
          <div className="tp-pop-row" role="group" aria-label={t.list}>
            <span className="tp-pop-label">{t.list}</span>
            {TIERS.map((tier: Tier) => (
              <Choice key={tier} on={settings.tier === tier} onClick={() => store.setSettings({ tier })}>
                {tier}
              </Choice>
            ))}
          </div>
          <div className="tp-pop-row">
            <span className="tp-pop-label" />
            {settings.language === "pt" ? (
              <Choice on={settings.accentFree} onClick={() => store.setSettings({ accentFree: !settings.accentFree })}>
                {t.accentFree}
              </Choice>
            ) : null}
            <Choice on={settings.punctuation} onClick={() => store.setSettings({ punctuation: !settings.punctuation })}>
              {t.punctuation}
            </Choice>
            <Choice on={settings.numbers} onClick={() => store.setSettings({ numbers: !settings.numbers })}>
              {t.numbers}
            </Choice>
          </div>
        </>
      )}
    </Popover>
  );
}

export function VolumeSlider({ store, snap, t }: PanelProps) {
  return (
    <input
      className="tp-range"
      type="range"
      min={0}
      max={1}
      step={0.05}
      aria-label={t.volume}
      value={snap.sound.volume}
      onChange={(e) => store.setSound({ volume: Number(e.target.value) })}
      onPointerUp={() => store.session?.previewSound(snap.sound.profile)}
      onKeyUp={() => store.session?.previewSound(snap.sound.profile)}
    />
  );
}

export function ProfileChoices({ store, snap, t }: PanelProps) {
  return PROFILES.map((profile) => (
    <Choice
      key={profile}
      on={snap.sound.profile === profile}
      onClick={() => {
        store.setSound({ profile });
        store.session?.previewSound(profile);
      }}
    >
      {t[profile]}
    </Choice>
  ));
}

function SoundPopover(props: PanelProps) {
  const { store, snap, t } = props;
  return (
    <Popover store={store} snap={snap} label={t.soundMenu}>
      <div className="tp-pop-row">
        <span className="tp-pop-label">{t.volume}</span>
        <VolumeSlider {...props} />
      </div>
      <div className="tp-pop-row" role="group" aria-label={t.profile}>
        <span className="tp-pop-label">{t.profile}</span>
        <ProfileChoices {...props} />
      </div>
    </Popover>
  );
}

interface ModalProps {
  store: HomeStore;
  snap: HomeSnapshot;
  className: string;
  labelledBy: string;
  /** Set before closing to go straight back to typing, wherever the dialog was opened from. */
  backToTyping?: React.RefObject<boolean>;
  children: React.ReactNode;
}

export function Modal({ store, snap, className, labelledBy, backToTyping, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = snap.menu?.id;
  const viaPointer = snap.menu?.viaPointer ?? true;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !id) return;
    if (!dialog.open) dialog.showModal();
    // After the close event, never before it: a modal dialog keeps everything else inert, so focus can't leave until it shuts.
    const onClose = () => closeTo(store, id, viaPointer || backToTyping?.current === true);
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
    };
  }, [store, id, viaPointer, backToTyping]);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      {children}
    </dialog>
  );
}

function CustomDialog({ store, snap, t }: PanelProps) {
  const titleId = useId();
  const textId = useId();
  const errorId = useId();
  const [value, setValue] = useState(() => snap.settings.customWords.join(" "));
  const [error, setError] = useState<string | null>(null);
  const backToTyping = useRef(false);
  const max = CUSTOM_MAX_CHARS.toLocaleString(store.language === "pt" ? "pt-BR" : "en");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseCustomText(value);
    if (parsed.ok) {
      backToTyping.current = true;
      store.setSettings({ mode: { kind: "custom" }, customWords: parsed.words });
      (e.currentTarget as HTMLFormElement).closest("dialog")?.close();
      return;
    }
    if (parsed.reason === "empty") setError(t.customEmpty);
    else if (parsed.reason === "too-long") setError(t.customTooLong.replace("{n}", parsed.chars.toLocaleString(store.language === "pt" ? "pt-BR" : "en")).replace("{max}", max));
    else setError(t.customUntypable.replace("{c}", parsed.char));
  };

  return (
    <Modal store={store} snap={snap} className="tp-custom" labelledBy={titleId} backToTyping={backToTyping}>
      <form className="tp-custom-body" onSubmit={submit} noValidate>
        <h2 id={titleId}>{t.customTitle}</h2>
        <p className="tp-custom-help">{t.customHelp.replace("{max}", max)}</p>
        <label className="sr-only" htmlFor={textId}>
          {t.customLabel}
        </label>
        <textarea
          id={textId}
          className="tp-textarea"
          value={value}
          autoFocus
          rows={7}
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
        />
        <p id={errorId} className="tp-custom-error" role="alert">
          {error}
        </p>
        <div className="tp-custom-actions">
          <button type="submit" className="tp-primary">
            {t.customUse}
          </button>
          <button type="button" className="tp-ctl" onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
            {t.customCancel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Panels(props: PanelProps & { otherLanguageHref: string; otherLanguageName: string }) {
  switch (props.snap.menu?.id) {
    case "mode":
      return <ModePopover {...props} />;
    case "language":
      return <LanguagePopover {...props} />;
    case "sound":
      return <SoundPopover {...props} />;
    case "settings":
      return <SettingsPanel {...props} />;
    case "custom":
      return <CustomDialog {...props} />;
    default:
      return null;
  }
}
