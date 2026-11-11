import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { Wordmark } from "@/components/site/wordmark";
import { dictionary, type Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { COUNT_MIN_PLAYERS, accuracyText, wpmText } from "./model";

export const OG_SIZE = { width: 1200, height: 630 };

// The image renderer can't read woff2, so this is the page's Red Hat Text unpacked to TrueType, read once per instance.
const font = readFile(join(process.cwd(), "src/app/fonts/red-hat-text-400.ttf"));

// --ground, --text, --secondary, --muted and --brand in the dark theme. The renderer has no stylesheet for var() to reach.
const OG = { ground: "#0f0e0c", text: "#f6f5f2", secondary: "#c9c5be", muted: "#8f8a84", brand: "#ff5e1f" } as const;

// The wordmark's viewBox is 6079 by 1048. The renderer sizes an svg only from width and height, never from its box.
const MARK_HEIGHT = 54;
const MARK_WIDTH = Math.round((MARK_HEIGHT * 6079) / 1048);

async function boardImage(body: ReactNode): Promise<ImageResponse> {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: OG.ground,
          color: OG.text,
          fontFamily: "Red Hat Text",
        }}
      >
        <div style={{ display: "flex" }}>
          <Wordmark ink={OG.muted} brand={OG.brand} width={MARK_WIDTH} height={MARK_HEIGHT} />
        </div>
        {body}
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Red Hat Text", data: await font, weight: 400, style: "normal" }] },
  );
}

// The renderer lays out a fragment's children in a row, whatever its parent says, so a body is always this element.
function Body({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>{children}</div>;
}

function Name({ children }: { children: string }) {
  return <div style={{ display: "flex", fontSize: 48, lineHeight: 1.2, color: OG.secondary }}>{children}</div>;
}

/** A big figure with its unit beside it, as on the results screen. */
function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", marginTop: 8 }}>
      <div style={{ display: "flex", fontSize: 200, lineHeight: 1, letterSpacing: "-0.035em" }}>{value}</div>
      <div style={{ display: "flex", marginLeft: 24, fontSize: 52, color: OG.muted }}>{unit}</div>
    </div>
  );
}

function Caption({ children }: { children: string }) {
  return <div style={{ display: "flex", marginTop: 24, fontSize: 40, lineHeight: 1.25, color: OG.secondary }}>{children}</div>;
}

function Statement({ children, fontSize = 72 }: { children: string; fontSize?: number }) {
  return <div style={{ display: "flex", maxWidth: 960, fontSize, lineHeight: 1.15, letterSpacing: "-0.01em" }}>{children}</div>;
}

/** For a closed board, a name nobody has or a database that can't answer: what the site is, and nothing about anyone. */
export function siteImage(lang: Lang): Promise<ImageResponse> {
  return boardImage(
    <Body>
      <Statement fontSize={56}>{dictionary(lang).site.description}</Statement>
    </Body>,
  );
}

/** The statement and, from 5 players, how many typed: never a word of the text, which is the whole game. */
export function todayImage(lang: Lang, total: number): Promise<ImageResponse> {
  const t = boardStrings(lang).today;
  return boardImage(
    <Body>
      <Statement>{t.statement}</Statement>
      {total >= COUNT_MIN_PLAYERS ? <Caption>{t.count(total)}</Caption> : null}
    </Body>,
  );
}

export function profileImage(lang: Lang, profile: { username: string; rankedRuns: number; paceCx: number | null }): Promise<ImageResponse> {
  const t = boardStrings(lang).profile;
  return boardImage(
    <Body>
      <Name>{profile.username}</Name>
      {profile.paceCx !== null ? <Figure value={wpmText(profile.paceCx)} unit={t.paceUnit} /> : null}
      <Caption>{`${profile.rankedRuns} ${t.rankedRuns}`}</Caption>
    </Body>,
  );
}

export function resultImage(
  lang: Lang,
  r: { username: string; wpmCx: number; accuracyBp: number; challengeDay: string | null; finishedOn: string },
): Promise<ImageResponse> {
  const s = boardStrings(lang);
  const when = r.challengeDay ? `${s.result.today}, ${s.date(r.challengeDay)}` : `${s.result.free}, ${s.date(r.finishedOn)}`;
  return boardImage(
    <Body>
      <Name>{r.username}</Name>
      <Figure value={wpmText(r.wpmCx)} unit={dictionary(lang).typing.wpm} />
      <Caption>{`${accuracyText(r.accuracyBp)} ${s.result.accuracy}. ${when}`}</Caption>
    </Body>,
  );
}
