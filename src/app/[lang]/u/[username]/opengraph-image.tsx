import { profileRead } from "@/components/boards/data";
import { Caption, Figure, OG, OG_SIZE, boardImage } from "@/components/boards/og";
import { leadPace } from "@/components/boards/profile-view";
import { dictionary, isLang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "thefastypist";

export default async function Image({ params }: { params: Promise<{ lang: string; username: string }> }) {
  const { lang: value, username } = await params;
  const lang = isLang(value) ? value : "en";
  const read = await profileRead(username);
  const profile = read.state === "ok" ? read.data : null;
  const t = boardStrings(lang);
  if (!profile) return boardImage(<Caption>{dictionary(lang).site.description}</Caption>);
  const [lead] = leadPace(profile.paces);
  return boardImage(
    <>
      <div style={{ display: "flex", fontSize: 56, color: OG.text }}>{profile.username}</div>
      {lead?.listed ? <Figure value={(lead.paceCx / 100).toFixed(1)} unit={t.profile.paceUnit} /> : null}
      <Caption>{`${profile.rankedRuns} ${t.profile.rankedRuns}`}</Caption>
      {lead?.listed ? null : <div style={{ display: "flex", fontSize: 32, color: OG.muted }}>{dictionary(lang).site.description}</div>}
    </>,
  );
}
