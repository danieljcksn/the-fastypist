import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StandingsTable, TodayTable } from "@/components/boards/board-table";
import { todayRead, type TodayBoard } from "@/components/boards/data";
import { BoardFrame, ClosedPage, Unavailable, closedMeta } from "@/components/boards/page-frame";
import { TodayIsland } from "@/components/boards/today-island";
import type { Language } from "@/engine/packs";
import { isLang, type Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import { pageMeta } from "@/i18n/seo";
import { ACCOUNTS } from "@/lib/accounts-flag";

export const ensureStatic = "navigation";

export async function generateMetadata({ params }: PageProps<"/[lang]/today">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  if (!ACCOUNTS) return closedMeta(lang);
  const t = boardStrings(lang).today;
  return pageMeta(lang, "/today", { title: t.title, description: t.description });
}

function Board({ lang, language, board }: { lang: Lang; language: Language; board: TodayBoard }) {
  const s = boardStrings(lang);
  return (
    <div data-board={language}>
      <section className="bd-section">
        {board.total === 0 ? <p className="bd-note bd-head">{s.today.empty}</p> : null}
        <TodayTable lang={lang} rows={board.rows} total={board.total} />
      </section>
      <section className="bd-section" aria-labelledby={`standings-${language}`}>
        <div className="bd-head">
          <h2 className="bd-title" id={`standings-${language}`}>
            {s.standings.title}
          </h2>
          <p className="bd-finding">{board.standings.shown ? s.standings.finding : s.standings.hidden}</p>
        </div>
        {board.standings.shown ? <StandingsTable lang={lang} rows={board.standings.rows} /> : null}
      </section>
    </div>
  );
}

export default async function TodayPage({ params }: PageProps<"/[lang]/today">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  // Inline, not ACCOUNTS: the compiler then sees the rest is dead, and a guest build ships none of its client code.
  if (process.env.NEXT_PUBLIC_ACCOUNTS !== "1") return <ClosedPage lang={lang} path="/today" />;
  const t = boardStrings(lang).today;
  const [en, pt] = await Promise.all([todayRead("en"), todayRead("pt")]);
  const initial: Language = lang === "pt-br" ? "pt" : "en";
  const summary = (read: typeof en) => (read.state === "ok" ? { day: read.data.day, total: read.data.total, speeds: read.data.speeds } : null);
  return (
    <BoardFrame lang={lang} path="/today" current="today">
      <h1 className="bd-statement">{t.statement}</h1>
      <TodayIsland lang={lang} initial={initial} boards={{ en: summary(en), pt: summary(pt) }}>
        {en.state === "ok" ? <Board lang={lang} language="en" board={en.data} /> : <div data-board="en"><Unavailable lang={lang} /></div>}
        {pt.state === "ok" ? <Board lang={lang} language="pt" board={pt.data} /> : <div data-board="pt"><Unavailable lang={lang} /></div>}
      </TodayIsland>
    </BoardFrame>
  );
}
