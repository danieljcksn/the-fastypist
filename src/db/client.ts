import { attachDatabasePool } from '@vercel/functions';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

/** A connection, a PGlite instance in tests, or an open transaction. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export class DatabaseNotConfigured extends Error {
  constructor() {
    super('DATABASE_URL is not set');
    this.name = 'DatabaseNotConfigured';
  }
}

let instance: Db | undefined;

/** Pooled URL at runtime: migrations alone use the unpooled one. Built on first use so that importing this never connects. */
export function getDb(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfigured();
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 5_000 });
  // Without a listener, an idle client's connection error takes the whole process down.
  pool.on('error', (error) => console.error('database pool error', error.message));
  attachDatabasePool(pool);
  instance = drizzle({ client: pool, schema });
  return instance;
}

/** Raw results come back as strings or numbers depending on the driver, so every query casts in SQL and callers convert. */
export async function rowsOf<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
