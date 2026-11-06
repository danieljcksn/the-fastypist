import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "thefastypist",
  description: "A typing test that opens ready to type.",
};

export function generateStaticParams() {
  return [{ lang: "en" }, { lang: "pt-br" }];
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  return (
    <html lang={lang === "pt-br" ? "pt-BR" : "en"}>
      <body>{children}</body>
    </html>
  );
}
