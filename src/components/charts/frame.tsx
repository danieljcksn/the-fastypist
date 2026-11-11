"use client";

import { type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { nearest } from "./scale";

export interface Size {
  w: number;
  h: number;
}

const widths = new Map<string, number>();

export type Measure = (text: string, weight?: number) => number;

/**
 * Text width as the chart will set it. A canvas can't: it has no tabular figures, and every label here uses them, so
 * "15 s" measured there comes out narrower than it draws. A hidden span in the frame takes the frame's own font.
 */
function measurer(el: HTMLElement, font: string): Measure {
  return (text, weight = 400) => {
    const key = `${weight} ${font}|${text}`;
    const hit = widths.get(key);
    if (hit !== undefined) return hit;
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-weight:${weight}`;
    probe.textContent = text;
    el.append(probe);
    const w = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    widths.set(key, w);
    return w;
  };
}

export interface Frame extends Size {
  /** The label size in px. */
  px: number;
  font: string;
  fonts: FontFaceSetLoadStatus;
  measure: Measure;
}

const seen = new Set<string>();

/**
 * The frame's size from one ResizeObserver, never read per frame, and the reveal: once per chart and page visit, only when it
 * scrolls into view, never under reduced motion. Pages stay hidden-mounted, and showing one again would restart a CSS
 * animation, so the attribute goes as soon as the animation ends.
 */
export function useFrame<T extends HTMLElement>(revealKey: string | null) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Frame | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The font follows the root size steps at 1920 and 2400, so it is read with the size rather than once.
    const read = (w: number, h: number) => {
      const style = getComputedStyle(el);
      const font = `${style.fontSize} ${style.fontFamily}`;
      const fonts = document.fonts.status;
      const px = parseFloat(style.fontSize);
      const measure = measurer(el, font);
      setSize((old) => (old && old.w === w && old.h === h && old.font === font && old.fonts === fonts ? old : { w, h, px, font, fonts, measure }));
    };
    const observer = new ResizeObserver(([entry]) => {
      if (entry) read(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height));
    });
    observer.observe(el);
    // Labels are measured in the real font. If it arrives after the first draw, measure again once.
    let live = true;
    if (document.fonts.status !== "loaded") {
      void document.fonts.ready.then(() => {
        if (live) read(Math.floor(el.getBoundingClientRect().width), Math.floor(el.getBoundingClientRect().height));
      });
    }
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);

  const ready = size !== null && size.w > 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready || revealKey === null || seen.has(revealKey)) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.reveal = "armed";
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        seen.add(revealKey);
        el.dataset.reveal = "run";
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    const done = (e: AnimationEvent) => {
      if (e.animationName === "cx-reveal") delete el.dataset.reveal;
    };
    el.addEventListener("animationend", done);
    return () => {
      io.disconnect();
      el.removeEventListener("animationend", done);
      delete el.dataset.reveal;
    };
  }, [ready, revealKey]);

  return { ref, frame: ready ? size : null };
}

/** One controller for pointer, touch and keyboard. x positions are in the element's own pixels, sorted. */
export function useScrub(xs: readonly number[]) {
  const [at, setAt] = useState<number | null>(null);
  const left = useRef(0);
  const count = xs.length;
  const pick = (e: PointerEvent<HTMLElement>) => setAt(nearest(xs, e.clientX - left.current));

  // A new series under the pointer keeps the index honest.
  const shown = at !== null && at < count ? at : null;

  return {
    at: shown,
    set: setAt,
    props: {
      tabIndex: count > 0 ? 0 : -1,
      onPointerEnter(e: PointerEvent<HTMLElement>) {
        left.current = e.currentTarget.getBoundingClientRect().left;
      },
      onPointerDown(e: PointerEvent<HTMLElement>) {
        left.current = e.currentTarget.getBoundingClientRect().left;
        pick(e);
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        if (e.pointerType === "mouse" || e.buttons > 0) pick(e);
      },
      onPointerLeave(e: PointerEvent<HTMLElement>) {
        // A tap's read-out stays until the next tap, or the finger would have to stay on the chart to read it.
        if (e.pointerType === "mouse") setAt(null);
      },
      onFocus(e: FocusEvent<HTMLElement>) {
        if (e.currentTarget.matches(":focus-visible")) setAt((old) => old ?? count - 1);
      },
      onBlur() {
        setAt(null);
      },
      onKeyDown(e: KeyboardEvent<HTMLElement>) {
        const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
        if (e.key === "Escape" && shown !== null) {
          e.stopPropagation();
          setAt(null);
          return;
        }
        if (step === 0 && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        e.stopPropagation();
        if (count === 0) return;
        if (e.key === "Home") setAt(0);
        else if (e.key === "End") setAt(count - 1);
        else setAt((old) => Math.max(0, Math.min(count - 1, (old ?? count - 1) + step)));
      },
    },
  };
}

/**
 * The dark read-out, inverted against the ground in each theme. It sits beside x, to the right before the middle and to the
 * left past it, takes the other side when its own has no room, and when neither has it stays inside the frame.
 */
export function Readout({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Its width is only known once laid out, so it is placed before paint, every render, as the text changes with x.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = "0px";
    const own = el.offsetWidth;
    // 0.75rem from the hairline, so it follows the root size steps at 1920 and 2400.
    const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.75;
    const right = x + gap;
    const left = x - gap - own;
    const fitsRight = right + own <= width;
    const fitsLeft = left >= 0;
    const preferLeft = x > width / 2;
    const at = preferLeft ? (fitsLeft ? left : fitsRight ? right : left) : fitsRight ? right : fitsLeft ? left : right;
    el.style.left = `${Math.round(Math.max(0, Math.min(width - own, at)))}px`;
  });
  return (
    <div ref={ref} className="cx-read" aria-hidden="true">
      {children}
    </div>
  );
}

/** The surface that takes the pointer and the keyboard, over the plot. What it reads out goes to a polite live region. */
export function Hit({ label, scrub, live }: { label: string; scrub: { props: object }; live: string }) {
  return (
    <div className="cx-hit" role="group" aria-label={label} {...scrub.props}>
      <span className="sr-only" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

/** What a screen reader gets instead of the picture. On a wrapper, because a table ignores the size that hides an element. */
export function ChartTable({ caption, head, rows }: { caption: string; head: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={j}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Title, a computed finding, and where the marks aren't obvious one line on how to read them. */
export function ChartHead({ title, finding, note, legend, findingId }: { title: string; finding?: string | null; note?: string | null; legend?: ReactNode; findingId?: string }) {
  return (
    <header className="cx-head">
      <div className="cx-title">
        <h2 className="rs-title">{title}</h2>
        {legend ? (
          <div className="cx-legend" aria-hidden="true">
            {legend}
          </div>
        ) : null}
      </div>
      {finding ? (
        <p className="cx-finding" data-testid={findingId}>
          {finding}
        </p>
      ) : null}
      {note ? <p className="cx-note">{note}</p> : null}
    </header>
  );
}
