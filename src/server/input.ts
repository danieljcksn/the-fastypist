import { z } from 'zod';

const MAX_PAGE = 1_000_000;

export const isUuid = (value: string): boolean => z.uuid().safeParse(value).success;

/** A real calendar date Postgres can hold, in the only spelling a board's day is ever written in. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function pageNumber(page: number | undefined): number {
  const whole = Math.floor(page ?? 0);
  return whole > 0 && whole <= MAX_PAGE ? whole : 0;
}
