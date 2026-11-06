import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { isLang } from "@/i18n";
import { notFound } from "next/navigation";

export const ensureStatic = "navigation";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <>
      <SiteHeader lang={lang} />
      <main className="column" />
      <SiteFooter lang={lang} />
    </>
  );
}
