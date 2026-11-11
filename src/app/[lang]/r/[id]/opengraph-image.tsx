import { resultRead } from "@/components/boards/data";
import { accuracyText } from "@/components/boards/model";
import { Caption, Figure, OG, OG_SIZE, boardImage } from "@/components/boards/og";
import { dictionary, isLang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "thefastypist";

export default async function Image({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang: value, id } = await params;
  const lang = isLang(value) ? value : "en";
  const read = await resultRead(id);
  const r = read.state === "ok" ? read.data : null;
  const s = boardStrings(lang);
  if (!r) return boardImage(<Caption>{dictionary(lang).site.description}</Caption>);
  return boardImage(
    <>
      <div style={{ display: "flex", fontSize: 56, color: OG.text }}>{r.username}</div>
      <Figure value={String(Math.round(r.wpmCx / 100))} unit={dictionary(lang).typing.wpm} />
      <Caption>
        {`${accuracyText(r.accuracyBp)} ${s.result.accuracy}, ${r.challengeDay ? `${s.result.today.toLowerCase()} ${s.date(r.challengeDay)}` : s.date(r.finishedOn)}`}
      </Caption>
    </>,
  );
}
