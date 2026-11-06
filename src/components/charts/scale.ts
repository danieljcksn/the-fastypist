const STEPS: readonly number[] = [1, 2, 5, 10, 20, 25, 50, 100, 200];

/** Rules on round values covering min..max, with the smallest step that needs at most `most` intervals. */
export function rulesFor(min: number, max: number, most = 3, fixedStep?: number): number[] {
  // Math.min of nothing is Infinity, and the loop below would then push until the array itself gives out.
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  let step = fixedStep ?? STEPS.at(-1) ?? 1;
  if (fixedStep === undefined) {
    for (const candidate of STEPS) {
      if (Math.ceil(high / candidate) - Math.floor(low / candidate) <= most) {
        step = candidate;
        break;
      }
    }
  }
  const from = Math.floor(low / step);
  let to = Math.ceil(high / step);
  // A flat line sitting exactly on a rule still needs a second rule to have a scale at all.
  if (to === from) to = from + 1;
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i * step);
  return out;
}
