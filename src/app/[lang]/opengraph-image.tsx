import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lang as rootLang } from "next/root-params";
import { ImageResponse } from "next/og";
import { Wordmark } from "@/components/site/wordmark";
import { isLang } from "@/i18n";
import { about } from "@/i18n/pages/about";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "thefastypist";

// The image renderer can't read woff2, so this is the same Red Hat Text as the page, unpacked to TrueType.
const font = await readFile(join(process.cwd(), "src/app/fonts/red-hat-text-400.ttf"));

// --ground, --text, --muted and --brand in the dark theme. The renderer has no stylesheet, so no var() can reach it.
const GROUND = "#0f0e0c";
const TEXT = "#f6f5f2";
const MUTED = "#8f8a84";
const BRAND = "#ff5e1f";

export default async function OpengraphImage() {
  const value = await rootLang();
  const lang = isLang(value) ? value : "en";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: GROUND, color: TEXT, fontFamily: "Red Hat Text" }}>
        <div style={{ display: "flex", height: 54 }}>{Wordmark({ ink: MUTED, brand: BRAND })}</div>
        <div style={{ display: "flex", maxWidth: 960, fontSize: 80, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{about[lang].statement}</div>
      </div>
    ),
    { ...size, fonts: [{ name: "Red Hat Text", data: font, weight: 400, style: "normal" }] },
  );
}

