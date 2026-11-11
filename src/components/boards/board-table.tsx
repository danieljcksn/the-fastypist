import Link from "next/link";
import { href, type Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import type { BoardRow, StandingRow } from "@/server/ranking";
import { type Benchmark, accuracyText, boardLines, wpmText } from "./model";
import { ReportLink } from "./report-link";

function benchmarkName(lang: Lang, benchmark: Benchmark): string {
  const t = boardStrings(lang).today;
  return benchmark.kind === "average" ? t.average : t.fasterThan(benchmark.percent);
}

export function ProfileLink({ lang, username }: { lang: Lang; username: string }) {
  return (
    <Link href={href(lang, `/u/${username}`)} prefetch={false}>
      {username}
    </Link>
  );
}

export function TodayTable({ lang, rows, total }: { lang: Lang; rows: readonly BoardRow[]; total: number }) {
  const t = boardStrings(lang).today;
  return (
    <table className="bd-table" data-testid="today-board">
      <thead>
        <tr>
          <th className="bd-rank">
            <span className="sr-only">{t.columns.rank}</span>
          </th>
          <th>
            <span className="sr-only">{t.columns.name}</span>
          </th>
          <th className="bd-wpm bd-n">{t.columns.wpm}</th>
          <th className="bd-acc bd-n">{t.columns.accuracy}</th>
        </tr>
      </thead>
      <tbody>
        {boardLines(rows, total).map((line) =>
          line.kind === "row" ? (
            <tr key={`r-${line.row.username}`} data-name={line.row.username}>
              <td className="bd-rank">{line.row.rank}</td>
              <td className="bd-name">
                <ProfileLink lang={lang} username={line.row.username} />
                <ReportLink lang={lang} username={line.row.username} />
              </td>
              <td className="bd-wpm bd-n">{wpmText(line.row.wpmCx)}</td>
              <td className="bd-acc bd-n">{accuracyText(line.row.accuracyBp)}</td>
            </tr>
          ) : (
            <tr key={`b-${line.wpm}`} className="bd-bench">
              <td className="bd-rank" />
              <td className="bd-name">{benchmarkName(lang, line.benchmark)}</td>
              <td className="bd-wpm bd-n">
                {line.wpm}
                <span className="bd-ghost" aria-hidden="true">
                  .0
                </span>
              </td>
              <td className="bd-acc bd-n" />
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

export function StandingsTable({ lang, rows }: { lang: Lang; rows: readonly StandingRow[] }) {
  const t = boardStrings(lang).standings;
  return (
    <table className="bd-table" data-testid="standings">
      <thead>
        <tr>
          <th className="bd-rank">
            <span className="sr-only">{t.columns.rank}</span>
          </th>
          <th>
            <span className="sr-only">{t.columns.name}</span>
          </th>
          <th className="bd-wpm bd-n">{t.columns.pace}</th>
          <th className="bd-acc bd-n">{t.columns.best}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.username} data-name={row.username}>
            <td className="bd-rank">{row.rank}</td>
            <td className="bd-name">
              <ProfileLink lang={lang} username={row.username} />
              <ReportLink lang={lang} username={row.username} />
            </td>
            <td className="bd-wpm bd-n">{wpmText(row.paceCx)}</td>
            <td className="bd-acc bd-n">{wpmText(row.bestCx)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
