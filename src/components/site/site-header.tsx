import Link from "next/link";
import { dictionary, href, type Lang } from "@/i18n";
import { Wordmark } from "./wordmark";

export function SiteHeader({ lang, current }: { lang: Lang; current?: "today" | "progress" }) {
  const t = dictionary(lang).nav;
  return (
    <header data-chrome className="column flex items-center justify-between py-10">
      <Link href={href(lang, "/")} aria-label={t.home} className="hit text-muted">
        <Wordmark className="block h-[1.31rem] w-auto" />
      </Link>
      <nav className="flex gap-6 text-c">
        <Link className="hit link-quiet" href={href(lang, "/today")} aria-current={current === "today" ? "page" : undefined}>
          {t.today}
        </Link>
        <Link className="hit link-quiet" href={href(lang, "/progress")} aria-current={current === "progress" ? "page" : undefined}>
          {t.progress}
        </Link>
        {/* Clerk's UI chunk only exists after a full load of its own route. */}
        <a className="hit link-quiet" href={href(lang, "/sign-in")}>
          {t.signIn}
        </a>
      </nav>
    </header>
  );
}
