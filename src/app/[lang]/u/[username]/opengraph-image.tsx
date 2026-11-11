import { profileRead } from "@/components/boards/data";
import { OG_SIZE, profileImage, siteImage } from "@/components/boards/og";
import { leadPace } from "@/components/boards/profile-view";
import { isLang } from "@/i18n";
import { ACCOUNTS } from "@/lib/accounts-flag";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "thefastypist";

export default async function Image({ params }: { params: Promise<{ lang: string; username: string }> }) {
  const { lang: value, username } = await params;
  const lang = isLang(value) ? value : "en";
  const read = ACCOUNTS ? await profileRead(username) : null;
  const profile = read?.state === "ok" ? read.data : null;
  if (!profile) return siteImage(lang);
  const [lead] = leadPace(profile.paces);
  return profileImage(lang, { username: profile.username, rankedRuns: profile.rankedRuns, paceCx: lead?.listed ? lead.paceCx : null });
}
