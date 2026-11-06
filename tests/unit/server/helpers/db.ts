import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
}

/** PGlite on the real migrations. TEST_DATABASE_URL swaps in the pg driver on a scratch database, whose schema this erases. */
export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url, max: 1 });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public');
    const db = drizzlePg({ client: pool, schema });
    await migratePg(db, { migrationsFolder: 'drizzle' });
    return { db, close: () => pool.end() };
  }
  const client = new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: 'drizzle' });
  return { db, close: () => client.close() };
}
