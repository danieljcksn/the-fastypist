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
    // Drizzle's own message lists the bound parameters, which are personal data. Its cause is what actually went wrong.
    const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    console.error('database read failed', reason instanceof Error ? reason.message : 'unknown');
    return { state: 'unavailable' };
  }
}
