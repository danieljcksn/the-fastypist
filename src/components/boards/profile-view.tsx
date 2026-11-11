import type { Language } from "@/engine/packs";
import { percentileOf } from "@/engine/analysis";
import type { Lang } from "@/i18n";
import { boardStrings } from "@/i18n/boards";
import type { ProfileData } from "./data";
import { accuracyText, wpmText } from "./model";
import { PaceSparkline } from "@/components/charts/sparkline";
import { ReportLine } from "./report-link";

const languageOf = (pack: string): Language => (pack.startsWith("pt") ? "pt" : "en");

/** The list with a listed Pace and the most runs leads; the other language, if any, is one line under it. */
export function leadPace(paces: ProfileData["paces"]) {
  return [...paces].sort((a, b) => Number(b.listed) - Number(a.listed) || b.runs - a.runs);
}

export function ProfileView({ lang, profile }: { lang: Lang; profile: ProfileData }) {
  const s = boardStrings(lang);
  const t = s.profile;
  const [lead, ...others] = leadPace(profile.paces);
  const language = lead ? languageOf(lead.pack) : "en";
  const best = profile.bests.find((b) => b.mode === "time" && b.amount === 60 && languageOf(b.pack) === language);
  const history = profile.history[language] ?? [];
  const pace = lead?.listed ? lead.paceCx / 100 : null;
  const low = history.reduce((m, p) => Math.min(m, p.pace), Infinity);
  const high = history.reduce((m, p) => Math.max(m, p.pace), -Infinity);
  return (
    <>
      <div className="bd-top">
        <h1 className="bd-who">{profile.username}</h1>
        <div>
          {pace !== null ? (
            <p className="bd-hero" data-testid="profile-pace">
              <span className="bd-hero-n">{pace.toFixed(1)}</span>
              <span className="bd-hero-unit">{t.paceUnit}</span>
            </p>
          ) : (
            <p className="bd-line">{t.runsToPace(lead?.runs ?? 0)}</p>
          )}
        </div>
        <dl className="bd-stats">
          <dt>{t.rankedRuns}</dt>
          <dd>{profile.rankedRuns}</dd>
          {best ? (
            <>
              <dt>{t.best}</dt>
              <dd>{wpmText(best.wpmCx)}</dd>
            </>
          ) : null}
          <dt>{t.joined}</dt>
          <dd>{s.date(profile.joinedOn)}</dd>
        </dl>
        <div className="bd-say">
          {pace !== null ? <p className="bd-line">{t.fasterThan(percentileOf(pace))}</p> : null}
          {others
            .filter((p) => p.listed)
            .map((p) => (
              <p key={p.pack} className="bd-finding">
                {t.otherPace(languageOf(p.pack) === "pt" ? s.today.portuguese : s.today.english, wpmText(p.paceCx))}
              </p>
            ))}
          <p className="bd-note">{t.paceDefinition}</p>
        </div>
        {history.length >= 2 ? (
          <div className="bd-spark">
            <PaceSparkline values={history} label={t.sparkline(low.toFixed(1), high.toFixed(1))} revealKey={`u-${profile.username}`} />
          </div>
        ) : null}
      </div>

      <section className="bd-last" aria-labelledby="last-days">
        <div className="bd-head">
          <h2 className="bd-title" id="last-days">
            {t.lastDays}
          </h2>
          {profile.lastDays.length === 0 ? <p className="bd-finding">{t.noDays}</p> : null}
        </div>
        {profile.lastDays.length > 0 ? (
          <table className="bd-table bd-measure" data-testid="last-days">
            <thead>
              <tr>
                <th>{t.columns.date}</th>
                <th className="bd-wpm bd-n">{t.columns.wpm}</th>
                <th className="bd-acc bd-n">{t.columns.accuracy}</th>
                <th className="bd-acc bd-n">{t.columns.place}</th>
              </tr>
            </thead>
            <tbody>
              {profile.lastDays.map((d) => (
                <tr key={`${d.day}-${d.pack}`}>
                  <td>{s.date(d.day)}</td>
                  <td className="bd-wpm bd-n">{wpmText(d.wpmCx)}</td>
                  <td className="bd-acc bd-n">{accuracyText(d.accuracyBp)}</td>
                  <td className="bd-acc bd-n">{d.place === null ? "" : s.ordinal(d.place)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <ReportLine lang={lang} username={profile.username} label={t.report} />
    </>
  );
}
