import Link from "next/link";
import { dictionary, href, type Lang } from "@/i18n";
import { accountStrings } from "@/i18n/account";
import { AccountLink } from "./account-link";
import { Telemetry } from "./telemetry";
import { Wordmark } from "./wordmark";

export function SiteHeader({ lang, current }: { lang: Lang; current?: "today" | "progress" }) {
  const t = dictionary(lang).nav;
  return (
    <header data-chrome className="column flex items-center justify-between py-10">
      <Link href={href(lang, "/")} aria-label={t.home} className="hit text-muted">
        <Wordmark className="block h-[1.31rem] w-auto" />
      </Link>
      <nav className="flex gap-6 text-c">
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
    </header>
  );
}
