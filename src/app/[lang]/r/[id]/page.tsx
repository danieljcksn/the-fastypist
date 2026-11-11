import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileLink } from "@/components/boards/board-table";
import { resultRead } from "@/components/boards/data";
import { accuracyText, wpmText } from "@/components/boards/model";
import { BoardFrame, ClosedPage, Unavailable, closedMeta } from "@/components/boards/page-frame";
import { ReportLine } from "@/components/boards/report-link";
import { dictionary, isLang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { ACCOUNTS } from "@/lib/accounts-flag";

export const ensureStatic = "navigation";

/** Not a uuid, so the build prerenders this route once without a query. */
export function generateStaticParams() {
  return [{ id: "_" }];
}

// One run is not a page for search results: next.config sends noindex for /r as well.
export async function generateMetadata({ params }: PageProps<"/[lang]/r/[id]">): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLang(lang)) return {};
  if (!ACCOUNTS) return closedMeta(lang);
  const read = await resultRead(id);
  if (read.state !== "ok" || !read.data) return { robots: { index: false } };
  const r = read.data;
  return {
    title: `${r.username}, ${Math.round(r.wpmCx / 100)} ${dictionary(lang).typing.wpm}`,
    description: boardStrings(lang).result.description(r.username, Math.round(r.wpmCx / 100)),
    robots: { index: false },
  };
}

export default async function ResultPage({ params }: PageProps<"/[lang]/r/[id]">) {
  const { lang, id } = await params;
  if (!isLang(lang)) notFound();
  const path = `/r/${id}` as const;
  if (!ACCOUNTS) return <ClosedPage lang={lang} path={path} />;
  const read = await resultRead(id);
  if (read.state === "ok" && read.data === null) notFound();
  if (read.state !== "ok" || !read.data)
    return (
      <BoardFrame lang={lang} path={path}>
        <Unavailable lang={lang} />
      </BoardFrame>
    );
  const s = boardStrings(lang);
  const t = s.result;
  const r = read.data;
  const wpm = Math.round(r.wpmCx / 100);
  return (
    <BoardFrame lang={lang} path={path}>
      <div className="bd-top">
        <p className="bd-who">
          <ProfileLink lang={lang} username={r.username} />
        </p>
        <h1 className="bd-hero" data-testid="result-wpm">
          <span className="bd-hero-n">{wpm}</span>
          <span className="bd-hero-unit">{dictionary(lang).typing.wpm}</span>
        </h1>
        <dl className="bd-stats">
          <dt>{t.accuracy}</dt>
          <dd>{accuracyText(r.accuracyBp)}</dd>
          <dt>{t.raw}</dt>
          <dd>{wpmText(r.rawCx)}</dd>
          {r.consistencyBp !== null ? (
            <>
              <dt>{t.consistency}</dt>
              <dd>{accuracyText(r.consistencyBp)}</dd>
            </>
          ) : null}
        </dl>
        <p className="bd-say bd-finding">
          {r.challengeDay ? `${t.today}, ${s.date(r.challengeDay)}` : `${t.free}, ${s.date(r.finishedOn)}`}
        </p>
      </div>
      <ReportLine lang={lang} resultId={r.id} label={t.report} />
    </BoardFrame>
  );
}
