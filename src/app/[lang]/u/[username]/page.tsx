import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { profileRead } from "@/components/boards/data";
import { BoardFrame, ClosedPage, Unavailable, closedMeta } from "@/components/boards/page-frame";
import { ProfileView } from "@/components/boards/profile-view";
import { isLang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { pageMeta } from "@/i18n/seo";
import { ACCOUNTS } from "@/lib/accounts-flag";
import { PACE_LISTED_RUNS } from "@/server/standing";

// Static, with no auth() anywhere: the first visit to a name renders it, and the profiles tag refreshes it.
export const ensureStatic = "navigation";

/** Not a valid username, so the build prerenders this route once without asking the database about anyone. */
export function generateStaticParams() {
  return [{ username: "_" }];
}

export async function generateMetadata({ params }: PageProps<"/[lang]/u/[username]">): Promise<Metadata> {
  const { lang, username } = await params;
  if (!isLang(lang)) return {};
  if (!ACCOUNTS) return closedMeta(lang);
  const read = await profileRead(username);
  if (read.state !== "ok" || !read.data) return { robots: { index: false } };
  const profile = read.data;
  return {
    ...pageMeta(lang, `/u/${profile.username}`, { title: profile.username, description: boardStrings(lang).profile.description(profile.username) }),
    // A handful of runs is not yet a profile worth a search result.
    ...(profile.rankedRuns < PACE_LISTED_RUNS ? { robots: { index: false } } : {}),
  };
}

export default async function ProfilePage({ params }: PageProps<"/[lang]/u/[username]">) {
  const { lang, username } = await params;
  if (!isLang(lang)) notFound();
  const path = `/u/${username}` as const;
  // Inline, not ACCOUNTS: the compiler then sees the rest is dead, and a guest build ships none of its client code.
  if (process.env.NEXT_PUBLIC_ACCOUNTS !== "1") return <ClosedPage lang={lang} path={path} />;
  const read = await profileRead(username);
  if (read.state === "ok" && read.data === null) notFound();
  return (
    <BoardFrame lang={lang} path={path}>
      {read.state === "ok" && read.data ? <ProfileView lang={lang} profile={read.data} /> : <Unavailable lang={lang} />}
    </BoardFrame>
  );
}
