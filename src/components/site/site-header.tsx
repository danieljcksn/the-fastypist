import Link from "next/link";
import { dictionary, href, type Lang } from "@/i18n";
import { accountStrings } from "@/i18n/account";
import { AccountLink } from "./account-link";
import { NotFoundSync } from "./not-found-sync";
import { Telemetry } from "./telemetry";
import { Wordmark } from "./wordmark";

export function SiteHeader({ lang, current, notFoundTitle }: { lang: Lang; current?: "today" | "progress"; notFoundTitle?: string }) {
  const t = dictionary(lang).nav;
  return (
    <header data-chrome className="column flex items-center justify-between py-10">
      <Link href={href(lang, "/")} aria-label={t.home} className="hit text-muted">
        <Wordmark className="block h-[1.31rem] w-auto" />
      </Link>
      <nav className="flex gap-6 text-c" aria-label={t.label}>
        {/* With accounts off nobody can rank, so the boards stay unlinked. Inlined for the same reason as below. */}
        {process.env.NEXT_PUBLIC_ACCOUNTS === "1" ? (
          <Link className="hit link-quiet" href={href(lang, "/today")} aria-current={current === "today" ? "page" : undefined}>
            {t.today}
          </Link>
        ) : null}
        {/* A prefetch would bring the page's 18 KB of client code and CSS into the first load of the test. */}
        <Link className="hit link-quiet" prefetch={false} href={href(lang, "/progress")} aria-current={current === "progress" ? "page" : undefined}>
          {t.progress}
        </Link>
        {/* The inlined variable, not ACCOUNTS: through an import the compiler can't see the branch is dead, and the link's
            client code would ship to every guest. */}
        {process.env.NEXT_PUBLIC_ACCOUNTS === "1" ? (
          <AccountLink signIn={t.signIn} account={accountStrings(lang).account} signInHref={href(lang, "/sign-in")} accountHref={href(lang, "/settings")} />
        ) : null}
      </nav>
      {/* Here, not in the root layout, which would make it a script request of its own on every first load. Production only:
          anywhere else the two scripts don't exist, and asking for them is a 404 on every page. */}
      {process.env.VERCEL_ENV === "production" ? <Telemetry /> : null}
      {/* Every page's payload carries the 404 beside it, and a client component of the 404's own made every page load the
          404's chunk. Rendered from here, it is in the chunk the page already loads. */}
      {notFoundTitle ? <NotFoundSync title={notFoundTitle} /> : null}
    </header>
  );
}
