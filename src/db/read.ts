import { type Db, getDb } from './client';

export type Read<T> = { state: 'ok'; data: T } | { state: 'unavailable' };

/**
 * For every reader a page or a build depends on, so a deploy succeeds and the site still renders with the database down.
 * A caller that caches should not cache 'unavailable': it would outlive the outage.
 */
export async function read<T>(query: (db: Db) => Promise<T>): Promise<Read<T>> {
  try {
    return { state: 'ok', data: await query(getDb()) };
  } catch (error) {
    console.error('database read failed', error instanceof Error ? error.message : error);
    return { state: 'unavailable' };
  }
}
