import { type LetterStatus, letterStatus, type Change, type State } from "@/engine/core";
import { layoutLines, type Line } from "@/engine/layout";

export interface ViewElements {
  viewport: HTMLElement;
  rows: HTMLElement;
  cursor: HTMLElement;
  ghost: HTMLElement;
  /** 100 characters on the surface's font and line-height, so one rect gives both cell sizes. */
  probe: HTMLElement;
}

export interface View {
  /** Same-frame swap: everything for the run's first rows is built before this returns. */
  setText(words: readonly string[], state: State): void;
  apply(change: Change): void;
  place(): void;
  pending(diacritic: string | null): void;
  dispose(): void;
}

const CLASS: Readonly<Record<LetterStatus, string>> = { pending: "", correct: "c", wrong: "w", extra: "x", missed: "m" };

// 5 rows, 326 spans held key-to-frame p95 at 18.9 ms. The whole 60 s text in the DOM reached 168 ms, on layerize alone.
const POOL = 5;

// Matches maxExtra in presets, so a word's extras can't reach past the row's edge.
const RESERVED_COLS = 4;

interface Row {
  el: HTMLDivElement;
  line: number;
}

function afterPaint(run: () => void): () => void {
  let cancelled = false;
  const frame = requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (!cancelled) run();
    };
    channel.port2.postMessage(0);
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

export function createView(els: ViewElements): View {
  const { viewport, rows: rowsEl, cursor, ghost, probe } = els;
  const rows: Row[] = [];
  for (let i = 0; i < POOL; i++) {
    const el = document.createElement("div");
    el.className = "tp-row";
    rowsEl.append(el);
    rows.push({ el, line: -1 });
  }

  let ch = 0;
  let lh = 0;
  let width = 0;
  let fullCols = 1;

  let words: readonly string[] = [];
  let state: State | null = null;
  let lines: Line[] = [];
  let lineOf = new Int32Array(0);
  let colOf = new Int32Array(0);

  // Words whose row is currently in the pool. A patch for any other word is dropped: rebuilding derives it from the state.
  const letters = new Map<number, HTMLSpanElement[]>();
  const wordEls = new Map<number, HTMLSpanElement>();

  let first = 0;
  let shiftLine = -1;
  let shift = 0;
  let cursorTransform = "";
  let cancelSync: (() => void) | null = null;
  let cancelSnap: (() => void) | null = null;

  function makeLetter(text: string, className: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.textContent = text;
    if (className) span.className = className;
    return span;
  }

  function clearRow(row: Row) {
    if (row.line < 0) return;
    const line = lines[row.line];
    if (line) {
      for (let w = line.first; w <= line.last; w++) {
        letters.delete(w);
        wordEls.delete(w);
      }
    }
    row.el.replaceChildren();
    row.line = -1;
  }

  function buildRow(row: Row, index: number) {
    const line = lines[index];
    const s = state;
    if (!line || !s) return;
    const fragment = document.createDocumentFragment();
    for (let w = line.first; w <= line.last; w++) {
      const target = words[w] ?? "";
      const typed = s.typed[w] ?? "";
      const word = document.createElement("span");
      word.className = "tp-word";
      const spans: HTMLSpanElement[] = [];
      for (let i = 0; i < target.length; i++) {
        const span = makeLetter(target.charAt(i), w > s.w ? "" : CLASS[letterStatus(words, s, w, i)]);
        word.append(span);
        spans.push(span);
      }
      for (let i = target.length; i < typed.length; i++) {
        const span = makeLetter(typed.charAt(i), "x");
        word.append(span);
        spans.push(span);
      }
      letters.set(w, spans);
      wordEls.set(w, word);
      fragment.append(word);
      if (w < line.last) fragment.append(" ");
    }
    row.el.replaceChildren(fragment);
    row.el.style.transform = `translate3d(0,${index * lh}px,0)`;
    row.line = index;
  }

  /** Holds the row above the window too: it is what a backspace across lines needs, and what is sliding out right now. */
  function syncPool() {
    if (lines.length === 0) return;
    const from = Math.max(0, first - 1);
    const to = from + POOL - 1;
    const free: Row[] = [];
    for (const row of rows) {
      if (row.line < from || row.line > to) {
        clearRow(row);
        free.push(row);
      }
    }
    for (let index = from; index <= to && index < lines.length; index++) {
      if (rows.some((row) => row.line === index)) continue;
      const row = free.shift();
      if (row) buildRow(row, index);
    }
  }

  function snap() {
    viewport.dataset.snap = "";
    cancelSnap?.();
    cancelSnap = afterPaint(() => {
      delete viewport.dataset.snap;
      cancelSnap = null;
    });
  }

  function layout() {
    if (ch <= 0 || width <= 0) return;
    lines = layoutLines(words, Math.max(1, Math.floor(width / ch) - RESERVED_COLS));
    lineOf = new Int32Array(words.length);
    colOf = new Int32Array(words.length);
    lines.forEach((line, index) => {
      let col = 0;
      for (let w = line.first; w <= line.last; w++) {
        lineOf[w] = index;
        colOf[w] = col;
        col += (words[w]?.length ?? 0) + 1;
      }
    });
  }

  function rebuild() {
    for (const row of rows) {
      row.el.replaceChildren();
      row.line = -1;
    }
    letters.clear();
    wordEls.clear();
    cancelSync?.();
    cancelSync = null;
    shift = 0;
    shiftLine = -1;
    first = Math.max(0, (lineOf[state?.w ?? 0] ?? 0) - 1);
    rowsEl.style.transform = `translate3d(0,${-first * lh}px,0)`;
    syncPool();
    cursorTransform = "";
    place();
  }

  function repaintWord(w: number) {
    const spans = letters.get(w);
    const word = wordEls.get(w);
    const s = state;
    if (!spans || !word || !s) return;
    const target = words[w]?.length ?? 0;
    const typed = s.typed[w]?.length ?? 0;
    const wanted = Math.max(target, typed);
    while (spans.length > wanted) spans.pop()?.remove();
    while (spans.length < wanted) {
      const span = makeLetter(s.typed[w]?.charAt(spans.length) ?? "", "x");
      word.append(span);
      spans.push(span);
    }
    for (let i = 0; i < wanted; i++) {
      const span = spans[i];
      if (span) span.className = CLASS[letterStatus(words, s, w, i)];
    }
  }

  function place() {
    const s = state;
    if (!s || lines.length === 0) return;
    const w = s.w;
    const lineIndex = lineOf[w] ?? 0;
    const line = lines[lineIndex];
    if (!line) return;

    const nextFirst = Math.max(0, lineIndex - 1);
    if (nextFirst !== first) {
      first = nextFirst;
      rowsEl.style.transform = `translate3d(0,${-first * lh}px,0)`;
      // After paint: the rebuild took handler p99 from 5.6 to 11 ms at 6x when it shared the keystroke's task.
      if (cancelSync === null) {
        cancelSync = afterPaint(() => {
          cancelSync = null;
          syncPool();
        });
      }
    }

    // Extras on this row's earlier words push everything after them right, and layout counted characters without them.
    let col = (colOf[w] ?? 0) + (s.typed[w]?.length ?? 0);
    for (let j = line.first; j < w; j++) {
      const over = (s.typed[j]?.length ?? 0) - (words[j]?.length ?? 0);
      if (over > 0) col += over;
    }

    // Past the row's reserve the row slides left, so a typist piling up extras never loses the caret.
    const over = Math.max(0, col + 1 - fullCols);
    if (over !== shift || lineIndex !== shiftLine) {
      if (shift !== 0 && shiftLine !== lineIndex) {
        const old = rows.find((row) => row.line === shiftLine);
        if (old) old.el.style.transform = `translate3d(0,${shiftLine * lh}px,0)`;
      }
      if (over !== 0 || shiftLine === lineIndex) {
        const row = rows.find((candidate) => candidate.line === lineIndex);
        if (row) row.el.style.transform = `translate3d(${-over * ch}px,${lineIndex * lh}px,0)`;
      }
      shift = over;
      shiftLine = lineIndex;
    }

    const transform = `translate3d(${(col - over) * ch}px,${(lineIndex - first) * lh}px,0)`;
    if (transform !== cursorTransform) {
      cursorTransform = transform;
      cursor.style.transform = transform;
    }
  }

  function measure() {
    const box = probe.getBoundingClientRect();
    const style = getComputedStyle(viewport);
    const outer = viewport.getBoundingClientRect().width;
    const nextWidth = outer - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const nextCh = box.width / 100;
    const nextLh = box.height;
    if (nextCh === ch && nextLh === lh && nextWidth === width) return;
    ch = nextCh;
    lh = nextLh;
    width = nextWidth;
    fullCols = Math.max(1, Math.floor(width / ch));
    if (!state) return;
    layout();
    snap();
    rebuild();
  }

  const observer = new ResizeObserver(measure);
  observer.observe(viewport);
  observer.observe(probe);
  measure();
  let alive = true;
  void document.fonts?.ready.then(() => {
    if (alive) measure();
  });

  return {
    setText(nextWords, nextState) {
      words = nextWords;
      state = nextState;
      layout();
      snap();
      rebuild();
    },

    apply(change) {
      const s = state;
      if (!s) return;
      switch (change.c) {
        case "none":
          return;
        case "letter": {
          const spans = letters.get(change.w);
          if (!spans) return;
          if (change.extra) {
            const span = makeLetter(s.typed[change.w]?.charAt(change.i) ?? "", "x");
            wordEls.get(change.w)?.append(span);
            spans.push(span);
          } else {
            const span = spans[change.i];
            if (span) span.className = CLASS[letterStatus(words, s, change.w, change.i)];
          }
          return;
        }
        case "erase": {
          const spans = letters.get(change.w);
          if (!spans) return;
          if (change.extra) spans.pop()?.remove();
          else {
            const span = spans[change.i];
            if (span) span.className = CLASS[letterStatus(words, s, change.w, change.i)];
          }
          return;
        }
        case "commit":
          if (change.missed > 0) repaintWord(change.w);
          return;
        case "eraseWord":
        case "back":
          repaintWord(change.w);
          return;
      }
    },

    place,

    pending(diacritic) {
      ghost.textContent = diacritic ?? "";
      ghost.hidden = diacritic === null;
    },

    dispose() {
      alive = false;
      observer.disconnect();
      cancelSync?.();
      cancelSnap?.();
      delete viewport.dataset.snap;
      rowsEl.replaceChildren();
      rowsEl.style.transform = "";
      cursor.style.transform = "";
      ghost.textContent = "";
      ghost.hidden = true;
      letters.clear();
      wordEls.clear();
      state = null;
    },
  };
}
