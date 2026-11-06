import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, rowsOf } from '@/db/client';
import * as schema from '@/db/schema';
import { claimUsername } from '@/server/accounts';
import { NOON, setSecrets } from './helpers/world';

// PGlite has one connection, so nothing can race on it. These need TEST_DATABASE_URL, a scratch database this erases, and
// --no-file-parallelism if other files run against the same URL.
const url = process.env.TEST_DATABASE_URL;
const now = new Date(NOON);

describe.runIf(url)('races on real connections', () => {
  let pool: Pool;
  let db: Db;
  let restore: () => void;

  beforeAll(async () => {
    restore = setSecrets();
    pool = new Pool({ connectionString: url, max: 15 });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public');
    const client = drizzle({ client: pool, schema });
    await migrate(client, { migrationsFolder: 'drizzle' });
    db = client;
  });
  afterAll(async () => {
    restore();
    await pool.end();
  });

  it('lets nobody step into a name in the moment it leaves its owner', async () => {
    let stolen = 0;
    for (let round = 0; round < 40; round++) {
      const owner = `user_owner${round}`;
      const name = `prized${round}`;
      await claimUsername(db, { clerkUserId: owner, username: name, now });
      const claims = Array.from({ length: 6 }, (_, i) => claimUsername(db, { clerkUserId: `user_thief${round}_${i}`, username: name, now }));
      const [, ...tries] = await Promise.all([claimUsername(db, { clerkUserId: owner, username: `moved${round}`, now }), ...claims]);
      if (tries.some((outcome) => outcome.ok)) stolen++;
      const [row] = await rowsOf<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM username_holds WHERE username = ${name}`);
      if (row?.n !== 1) stolen++;
    }
    expect(stolen).toBe(0);
  });
});
