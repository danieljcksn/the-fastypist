import { todayRead } from "@/components/boards/data";
import { OG_SIZE, todayImage } from "@/components/boards/og";
import { isLang } from "@/i18n";
import { ACCOUNTS } from "@/lib/accounts-flag";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "thefastypist";

export default async function Image({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: value } = await params;
  const lang = isLang(value) ? value : "en";
  const read = ACCOUNTS ? await todayRead(lang === "pt-br" ? "pt" : "en") : null;
  return todayImage(lang, read?.state === "ok" ? read.data.total : 0);
}
