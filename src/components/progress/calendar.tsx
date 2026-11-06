"use client";

import { useMemo, useState } from "react";
import type { ReportStrings } from "@/i18n/report";
import type { Calendar } from "./model";

const LABEL_EVERY_MONTHS = 2;

export function CalendarChart({ calendar, s, dayLabel, monthLabel }: { calendar: Calendar; s: ReportStrings; dayLabel(day: string): string; monthLabel(day: string): string }) {
  const [hover, setHover] = useState<number | null>(null);
  const grid = useMemo(() => calendar.cells.map((cell, i) => <i key={cell.day} className={cell.tier > 0 ? `d${cell.tier}` : undefined} data-i={i} />), [calendar]);
  const hovered = hover === null ? null : (calendar.cells[hover] ?? null);
  return (
    <div className="pg-cal-box">
      <div className="pg-cal-wrap">
        <div
          className="pg-cal"
          role="img"
          aria-label={s.progress.calendarLabel(calendar.daysInYear)}
          onPointerOver={(e) => {
            const index = (e.target as HTMLElement).dataset.i;
            setHover(index === undefined ? null : Number(index));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {grid}
        </div>
        <div className="pg-months" aria-hidden="true">
          {calendar.months
            .filter((_, i) => i % LABEL_EVERY_MONTHS === 1)
            .map((month) => (
              <span key={month.day} style={{ "--col": month.column } as React.CSSProperties}>
                {monthLabel(month.day)}
              </span>
            ))}
        </div>
        <div className="pg-cal-foot">
          <span className="pg-cal-read" aria-hidden="true">
            {hovered ? s.progress.dayRuns(dayLabel(hovered.day), hovered.runs) : ""}
          </span>
          <span className="pg-cal-legend" aria-hidden="true">
            {s.progress.less}
            <i />
            <i className="d1" />
            <i className="d2" />
            <i className="d3" />
            <i className="d4" />
            {s.progress.more}
          </span>
        </div>
      </div>
    </div>
  );
}
