"use client";

import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import type { Calendar } from "@/components/progress/model";
import type { ReportStrings } from "@/i18n/report";
import { type Frame, useFrame } from "./frame";
import { cellEdges } from "./geometry";
import { axisLabels } from "./labels";
import "./charts.css";

const GAP = 2;
/** Below this width 53 weeks would need cells under 8 px, so the map shows the last 26. The CSS height mirrors it. */
export const CALENDAR_NARROW_PX = 528;

export interface CalendarDates {
  /** "Tue 4 Nov" from a day string. */
  day(day: string): string;
  month(day: string): string;
}

export function calendarGeometry(width: number, weeks: number) {
  const cell = Math.floor((width - (weeks - 1) * GAP) / weeks);
  return { cell, edges: cellEdges(weeks, cell, width), height: 7 * cell + 6 * GAP };
}

function DayMap({ calendar, frame, s, dates, label }: { calendar: Calendar; frame: Frame; s: ReportStrings; dates: CalendarDates; label: string }) {
  const p = s.progress;
  const { w, measure } = frame;
  const allWeeks = Math.ceil(calendar.cells.length / 7);
  const weeks = w < CALENDAR_NARROW_PX ? Math.min(26, allWeeks) : allWeeks;
  const skip = (allWeeks - weeks) * 7;
  const cells = calendar.cells.slice(skip);
  const { cell, edges, height } = calendarGeometry(w, weeks);
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<DOMRect | null>(null);
  const today = cells.length - 1;

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const rect = box.current ?? e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let column = 0;
    edges.forEach((left, i) => {
      if (left - GAP / 2 <= px) column = i;
    });
    const row = Math.min(6, Math.max(0, Math.floor((py + GAP / 2) / (cell + GAP))));
    const i = column * 7 + row;
    setAt(py > height + GAP || i > today ? null : i);
  };

  const read = at === null ? null : cells[at];
  const months = axisLabels(
    calendar.months
      .map((m) => ({ ...m, column: m.column - skip / 7 }))
      .filter((m) => m.column >= 0)
      .map((m) => ({ x: edges[m.column] ?? 0, text: dates.month(m.day) })),
    (t) => measure(t),
    w,
    12,
    false,
  );

  return (
    <>
      <svg className="cx-data" width={w} height={height + frame.px * 2} aria-hidden="true">
        {cells.map((c, i) => {
          const x = edges[Math.floor(i / 7)] ?? 0;
          const y = (i % 7) * (cell + GAP);
          return <rect key={c.day} className={`cx-day d${c.tier}`} x={x} y={y} width={cell} height={cell} rx={2} />;
        })}
        {cells[today] ? (
          <rect className="cx-today" x={(edges[Math.floor(today / 7)] ?? 0) + 0.5} y={(today % 7) * (cell + GAP) + 0.5} width={cell - 1} height={cell - 1} rx={1.5} />
        ) : null}
        {read && at !== null ? <rect className="cx-day-on" x={(edges[Math.floor(at / 7)] ?? 0) - 1} y={(at % 7) * (cell + GAP) - 1} width={cell + 2} height={cell + 2} rx={3} /> : null}
        {months.map((m) => (
          <text key={m.text + m.x} x={Math.round(m.left)} y={height + Math.round(frame.px * 1.5) + 2}>
            {m.text}
          </text>
        ))}
      </svg>
      <div
        className="cx-hit"
        role="group"
        tabIndex={0}
        aria-label={label}
        onPointerEnter={(e) => {
          box.current = e.currentTarget.getBoundingClientRect();
        }}
        onPointerDown={(e) => {
          box.current = e.currentTarget.getBoundingClientRect();
          pick(e);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse") pick(e);
        }}
        onPointerLeave={(e) => {
          box.current = null;
          if (e.pointerType === "mouse") setAt(null);
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setAt((old) => old ?? today);
        }}
        onBlur={() => setAt(null)}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
          if (e.key === "Escape" && at !== null) {
            e.stopPropagation();
            setAt(null);
            return;
          }
          if (step === undefined && e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Home") setAt(0);
          else if (e.key === "End") setAt(today);
          else setAt((old) => Math.max(0, Math.min(today, (old ?? today) + (step ?? 0))));
        }}
      >
        <span className="sr-only" aria-live="polite">
          {read ? p.dayRead(dates.day(read.day), read.runs, read.ms) : ""}
        </span>
      </div>
      <p className="cx-cal-foot">
        <span className="cx-cal-read" aria-hidden="true" data-testid="calendar-read">
          {read ? p.dayRead(dates.day(read.day), read.runs, read.ms) : ""}
        </span>
        <span className="cx-cal-legend" aria-hidden="true">
          {p.less}
          <i className="d0" />
          <i className="d1" />
          <i className="d2" />
          <i className="d3" />
          <i className="d4" />
          {p.more}
        </span>
      </p>
    </>
  );
}

export function CalendarChart({ calendar, s, dates, revealKey }: { calendar: Calendar; s: ReportStrings; dates: CalendarDates; revealKey: string }) {
  const { ref, frame } = useFrame<HTMLDivElement>(revealKey);
  const label = s.progress.calendarLabel(calendar.daysInYear);
  return (
    <div className="cx-cal-box">
      <div ref={ref} className="cx cx-cal">
        {frame ? <DayMap calendar={calendar} frame={frame} s={s} dates={dates} label={label} /> : null}
      </div>
    </div>
  );
}
