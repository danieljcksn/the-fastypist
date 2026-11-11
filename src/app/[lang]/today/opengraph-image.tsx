import { todayRead } from "@/components/boards/data";
import { COUNT_MIN_PLAYERS } from "@/components/boards/model";
import { Caption, OG, OG_SIZE, boardImage } from "@/components/boards/og";
import { isLang } from "@/i18n";
import { ACCOUNTS } from "@/lib/accounts-flag";
import { boardStrings } from "@/i18n/boards";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "thefastypist";

/** The statement and, from 5 players, how many typed: never a word of the text, which is the whole game. */
export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: value } = await params;
  const lang = isLang(value) ? value : "en";
  const t = boardStrings(lang).today;
  const read = ACCOUNTS ? await todayRead(lang === "pt-br" ? "pt" : "en") : null;
  const total = read?.state === "ok" ? read.data.total : 0;
  return boardImage(
    <>
      <div style={{ display: "flex", maxWidth: 1000, fontSize: 72, lineHeight: 1.1, letterSpacing: "-0.01em", color: OG.text }}>{t.statement}</div>
      {total >= COUNT_MIN_PLAYERS ? <Caption>{t.count(total)}</Caption> : null}
    </>,
  );
}
