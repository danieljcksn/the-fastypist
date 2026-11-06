const DAY_MS = 86_400_000;
const BOUNDARY_MS = 21_600_000;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** The Today board's day, which turns over at 06:00 UTC. Civil-date arithmetic after Hinnant's civil_from_days. */
export function challengeDay(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new RangeError('time must be a finite number');
  const z = Math.floor((epochMs - BOUNDARY_MS) / DAY_MS) + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  // This string is a primary key and a URL, so anything that is not YYYY-MM-DD is a bug to surface.
  if (year < 0 || year > 9999) throw new RangeError('day is outside years 0 to 9999');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function msUntilNextDay(epochMs: number): number {
  if (!Number.isFinite(epochMs)) throw new RangeError('time must be a finite number');
  const shifted = epochMs - BOUNDARY_MS;
  return DAY_MS - (shifted - Math.floor(shifted / DAY_MS) * DAY_MS);
}
