const MARGIN = 12;

/**
 * How far up to move the test so its rows clear an on-screen keyboard. The keyboard shrinks only the visual viewport, so the
 * layout never moves on its own. Negative or zero. Never pushes the top of the box above the visible area.
 */
export function keyboardOffset(boxTop: number, boxBottom: number, visibleTop: number, visibleHeight: number): number {
  const visibleBottom = visibleTop + visibleHeight;
  const needed = visibleBottom - MARGIN - boxBottom;
  if (needed >= 0) return 0;
  const limit = visibleTop + MARGIN - boxTop;
  return Math.min(0, Math.max(needed, limit));
}
