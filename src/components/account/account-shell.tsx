import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import type { Lang } from "@/i18n";
import "./account.css";

export function AccountShell({ lang, otherPath, children }: { lang: Lang; otherPath: `/${string}`; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader lang={lang} />
      <main className="column ac-main">{children}</main>
      <SiteFooter lang={lang} otherPath={otherPath} />
    </>
  );
}
