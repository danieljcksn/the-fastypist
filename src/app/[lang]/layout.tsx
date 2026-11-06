import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { dictionary, isLang, LANGS } from "@/i18n";
import { mono, text } from "../fonts";
import "../globals.css";

// Runs before first paint so a saved theme never flashes the other one.
const THEME_SCRIPT = `try{var t=localStorage.getItem("fastypist:theme");if(t==="light"||(t==="system"&&matchMedia("(prefers-color-scheme: light)").matches))document.documentElement.dataset.theme="light"}catch(e){}`;

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#262524" },
    { media: "(prefers-color-scheme: light)", color: "#f8f8f6" },
  ],
};

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  return {
    title: { default: "thefastypist", template: "%s · thefastypist" },
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
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
