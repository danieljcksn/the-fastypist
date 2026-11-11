import { resultRead } from "@/components/boards/data";
import { OG_SIZE, resultImage, siteImage } from "@/components/boards/og";
import { isLang } from "@/i18n";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "thefastypist";

export default async function Image({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { lang: value, id } = await params;
  const lang = isLang(value) ? value : "en";
  const read = await resultRead(id);
  const r = read.state === "ok" ? read.data : null;
  return r ? resultImage(lang, r) : siteImage(lang);
}
