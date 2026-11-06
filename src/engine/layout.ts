export interface Line {
  first: number;
  last: number;
  cols: number;
}

/** Greedy and character-count only, so fonts never reach the engine and a resize just recomputes it. */
export function layoutLines(words: readonly string[], maxCols: number, from = 0, maxLines = Infinity): Line[] {
  const lines: Line[] = [];
  let first = from;
  let cols = 0;
  for (let i = from; i < words.length; i++) {
    const len = words[i]?.length ?? 0;
    const add = cols === 0 ? len : len + 1;
    if (cols > 0 && cols + add > maxCols) {
      lines.push({ first, last: i - 1, cols });
      if (lines.length >= maxLines) return lines;
      first = i;
      cols = len;
    } else {
      cols += add;
    }
  }
  if (cols > 0) lines.push({ first, last: words.length - 1, cols });
  return lines;
}
