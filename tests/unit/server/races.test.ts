import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Db, rowsOf } from '@/db/client';
import * as schema from '@/db/schema';
import { IMPORT_CAP, claimUsername, importHistory } from '@/server/accounts';
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

  it('holds the import cap across two imports at once', async () => {
    const rows = () =>
      Array.from({ length: IMPORT_CAP }, () => ({
        id: crypto.randomUUID(),
        pack: 'en-1k@1',
        mode: 'time',
        amount: 60,
        wpmCx: 5000,
        rawCx: 5000,
        accuracyBp: 9000,
        consistencyBp: null,
        elapsedMs: 60_000,
        finishedAt: '2026-01-01T00:00:00.000Z',
        localDay: '2026-01-01',
      }));
    const clerkUserId = 'user_two_imports';
    await Promise.all([importHistory(db, { clerkUserId, rows: rows(), now }), importHistory(db, { clerkUserId, rows: rows(), now })]);
    const [row] = await rowsOf<{ n: number }>(
      db,
      sql`SELECT count(*)::int AS n FROM results r JOIN profiles p ON p.id = r.profile_id WHERE p.clerk_user_id = ${clerkUserId}`,
    );
    expect(row?.n).toBe(IMPORT_CAP);
  });

  describe('the migrate script against a database that takes no writes', () => {
    const readOnly = `${url}${url?.includes('?') ? '&' : '?'}options=-c%20default_transaction_read_only%3Don`;
    const run = (watermark: string) => {
      const folder = mkdtempSync(join(tmpdir(), 'fastypist-migrate-'));
      cpSync('drizzle', folder, { recursive: true });
      writeFileSync(join(folder, 'production-watermark.txt'), `${watermark}\n`);
      return spawnSync(process.execPath, ['scripts/db-migrate.mjs'], {
        env: { PATH: process.env.PATH, VERCEL_ENV: 'production', DATABASE_URL_UNPOOLED: readOnly, MIGRATIONS_FOLDER: folder } as unknown as NodeJS.ProcessEnv,
        encoding: 'utf8',
      }).status;
    };

    it('lets a deploy through with nothing new, as with a database that is down', () => {
      const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
      expect(run(journal.entries.at(-1)?.tag ?? '')).toBe(0);
    });

    it('stops a deploy with something new to apply', () => {
      expect(run('none')).toBe(1);
    });
  });
});
