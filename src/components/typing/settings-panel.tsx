"use client";

import { useId } from "react";
import Link from "next/link";
import type { CaretShape, ThemeChoice, TypeSize } from "@/typing/settings";
import { Choice, Modal, type PanelProps, ProfileChoices, Toggle, VolumeSlider } from "./panels";

const SIZES: readonly TypeSize[] = ["s", "m", "l", "xl"];
const SHAPES: readonly CaretShape[] = ["bar", "block", "underline"];
const THEMES: readonly ThemeChoice[] = ["dark", "light", "system"];

function SettingRow({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="tp-setting" role="group" aria-label={label}>
      <div className="tp-setting-name">
        <span>{label}</span>
        {note ? <small>{note}</small> : null}
      </div>
      <div className="tp-setting-value">{children}</div>
    </div>
  );
}

export function SettingsPanel(props: PanelProps & { otherLanguageHref: string; otherLanguageName: string }) {
  const { store, snap, t, otherLanguageHref, otherLanguageName } = props;
  const titleId = useId();
  const { display, sound } = snap;
  const sizeLabel: Record<TypeSize, string> = { s: t.small, m: t.medium, l: t.large, xl: t.larger };
  return (
    <Modal store={store} snap={snap} className="tp-panel" labelledBy={titleId}>
      <div className="tp-panel-body">
        <div className="tp-panel-head">
          <h2 id={titleId}>{t.settingsTitle}</h2>
          <form method="dialog">
            <button className="tp-ctl">{t.close}</button>
          </form>
        </div>
        <SettingRow label={t.theme}>
          {THEMES.map((theme) => (
            <Choice key={theme} on={snap.theme === theme} onClick={() => store.setTheme(theme)}>
              {t[theme]}
            </Choice>
          ))}
        </SettingRow>
        <SettingRow label={t.caret}>
          {SHAPES.map((caret) => (
            <Choice key={caret} on={display.caret === caret} onClick={() => store.setDisplay({ caret })}>
              {t[caret]}
            </Choice>
          ))}
        </SettingRow>
        <SettingRow label={t.typeSize}>
          {SIZES.map((size) => (
            <Choice key={size} on={display.size === size} onClick={() => store.setDisplay({ size })}>
              {sizeLabel[size]}
            </Choice>
          ))}
        </SettingRow>
        <SettingRow label={t.liveSpeed}>
          <Toggle on={display.liveSpeed} label={t.liveSpeed} t={t} onClick={() => store.setDisplay({ liveSpeed: !display.liveSpeed })} />
        </SettingRow>
        <SettingRow label={t.paceCaret} note={t.paceCaretNote}>
          <Toggle on={false} label={t.paceCaret} t={t} disabled onClick={() => undefined} />
        </SettingRow>
        <SettingRow label={t.sound}>
          <Toggle on={sound.enabled} label={t.sound} t={t} onClick={() => store.session?.toggleSound()} />
        </SettingRow>
        <SettingRow label={t.volume}>
          <VolumeSlider store={store} snap={snap} t={t} />
        </SettingRow>
        <SettingRow label={t.profile}>
          <ProfileChoices store={store} snap={snap} t={t} />
        </SettingRow>
        <SettingRow label={t.errorSound}>
          <Toggle on={sound.errorSound} label={t.errorSound} t={t} onClick={() => store.setSound({ errorSound: !sound.errorSound })} />
        </SettingRow>
        <SettingRow label={t.releaseSound}>
          <Toggle on={sound.release} label={t.releaseSound} t={t} onClick={() => store.setSound({ release: !sound.release })} />
        </SettingRow>
        <SettingRow label={t.stereoSpread}>
          <Toggle on={sound.spread} label={t.stereoSpread} t={t} onClick={() => store.setSound({ spread: !sound.spread })} />
        </SettingRow>
        <SettingRow label={t.interfaceLanguage}>
          <Link className="tp-choice" href={otherLanguageHref}>
            {otherLanguageName}
          </Link>
        </SettingRow>
      </div>
    </Modal>
  );
}

