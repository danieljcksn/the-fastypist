import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { dictionary, isLang, LANGS } from "@/i18n";
import { Telemetry } from "@/components/site/telemetry";
import { SITE_NAME, siteUrl } from "@/i18n/seo";
import { CHUNK_SCRIPT } from "../chunk-script";
import { mono, text } from "../fonts";
import "../globals.css";

// Runs before first paint so a saved theme never flashes the other one.
const THEME_SCRIPT = `try{var t=localStorage.getItem("fastypist:theme");if(t==="light"||(t==="system"&&matchMedia("(prefers-color-scheme: light)").matches))document.documentElement.dataset.theme="light"}catch(e){}`;

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f0e0c" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  return {
    metadataBase: siteUrl(),
    applicationName: SITE_NAME,
    title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
    description: isLang(lang) ? dictionary(lang).site.description : undefined,
  };
}

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <html lang={dictionary(lang).htmlLang} className={`${mono.variable} ${text.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + CHUNK_SCRIPT }} />
      </head>
      <body>
        {children}
        {/* Production only: anywhere else the two scripts don't exist, and asking for them is a 404 on every page. */}
        {process.env.VERCEL_ENV === "production" ? <Telemetry /> : null}
      </body>
    </html>
  );
}
