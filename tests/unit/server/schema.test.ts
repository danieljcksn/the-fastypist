import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LIST_IDS } from '@/db/lists';
import { rowsOf } from '@/db/client';
import { PACKS, PACK_IDS, RANKED_PACK } from '@/engine/packs';
import { type TestDb, createTestDb } from './helpers/db';

describe('migrations', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it('seeds word_lists to match every pack', async () => {
    const rows = await rowsOf<{ id: number; pack_id: string; language: string; sha256: string; ranked: boolean }>(
      t.db,
      sql`SELECT id::int, pack_id, language, sha256, ranked FROM word_lists ORDER BY id`,
    );
    expect(rows).toHaveLength(PACK_IDS.length);
    for (const id of PACK_IDS) {
      const row = rows.find((r) => r.pack_id === id);
      expect(row).toEqual({
        id: LIST_IDS[id],
        pack_id: id,
        language: PACKS[id].language,
        sha256: PACKS[id].sha256,
        ranked: RANKED_PACK[PACKS[id].language] === id,
      });
    }
  });

  it('has no foreign key on any result_id', async () => {
    const rows = await rowsOf<{ name: string }>(
      t.db,
      sql`SELECT a.attname AS name FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND a.attname = 'result_id'`,
    );
    expect(rows).toEqual([]);
  });

  it('names a journal entry, or none, in the watermark', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const watermark = readFileSync('drizzle/production-watermark.txt', 'utf8').trim();
    expect(['none', ...journal.entries.map((e) => e.tag)]).toContain(watermark);
  });
});

describe('db-migrate script', () => {
  const REFUSED = 'postgres://nobody:x@127.0.0.1:1/none';
  const run = (env: Record<string, string>) => {
    const out = spawnSync(process.execPath, ['scripts/db-migrate.mjs'], {
      env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { code: out.status, output: out.stdout + out.stderr };
  };
  const folderAtWatermark = (watermark: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'fastypist-migrate-'));
    mkdirSync(join(dir, 'meta'));
    copyFileSync('drizzle/meta/_journal.json', join(dir, 'meta/_journal.json'));
    writeFileSync(join(dir, 'production-watermark.txt'), `${watermark}\n`);
    return dir;
  };

  it('exits 0 on a preview build with no URL', () => {
    const { code, output } = run({ VERCEL_ENV: 'preview' });
    expect(code).toBe(0);
    expect(output).toContain('skipped');
  });

  it('never touches a database from a preview build', () => {
    const { code, output } = run({ VERCEL_ENV: 'preview', DATABASE_URL_UNPOOLED: REFUSED });
    expect(code).toBe(0);
    expect(output).not.toContain('unreachable');
  });

  it('exits 0 on a production build with no URL, and fails a local run with none', () => {
    expect(run({ VERCEL_ENV: 'production' }).code).toBe(0);
    expect(run({}).code).toBe(1);
  });

  it('refuses a pooled URL because the advisory lock would not hold', () => {
    const { code, output } = run({ DATABASE_URL: 'postgres://u:p@ep-x-pooler.neon.tech/db' });
    expect(code).toBe(1);
    expect(output).toContain('pooled');
  });

  it('fails a production build with only a pooled URL and migrations to apply, so code can\'t ship ahead of its schema', () => {
    const pooled = 'postgres://u:p@ep-x-pooler.neon.tech/db';
    const stuck = run({ VERCEL_ENV: 'production', DATABASE_URL: pooled, MIGRATIONS_FOLDER: folderAtWatermark('none') });
    expect(stuck.code).toBe(1);
    expect(stuck.output).toContain('pooled');
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const current = run({ VERCEL_ENV: 'production', DATABASE_URL: pooled, MIGRATIONS_FOLDER: folderAtWatermark(journal.entries.at(-1)?.tag ?? '') });
    expect(current.code).toBe(0);
  });

  it('exits 0 when unreachable with nothing new since the watermark', () => {
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    const latest = journal.entries.at(-1)?.tag ?? '';
    const { code, output } = run({ VERCEL_ENV: 'production', DATABASE_URL_UNPOOLED: REFUSED, MIGRATIONS_FOLDER: folderAtWatermark(latest) });
    expect(output).toContain('unreachable');
    expect(code).toBe(0);
  });

  it('exits 1 when unreachable with new migrations to apply', () => {
    const { code, output } = run({ VERCEL_ENV: 'production', DATABASE_URL_UNPOOLED: REFUSED, MIGRATIONS_FOLDER: folderAtWatermark('none') });
    expect(code).toBe(1);
    expect(output).toContain('0000_initial');
  });
});

describe('db client', () => {
  const saved = process.env.DATABASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('imports without DATABASE_URL and neither throws nor connects', async () => {
    delete process.env.DATABASE_URL;
    const { getDb, DatabaseNotConfigured } = await import('@/db/client');
    expect(() => getDb()).toThrow(DatabaseNotConfigured);
  });

  it('reports unavailable when no database is configured', async () => {
    delete process.env.DATABASE_URL;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { read } = await import('@/db/read');
    expect(await read(async () => 1)).toEqual({ state: 'unavailable' });
  });

  it('reports unavailable when the database refuses the connection', async () => {
    process.env.DATABASE_URL = 'postgres://nobody:x@127.0.0.1:1/none';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { read } = await import('@/db/read');
    const outcome = await read((db) => db.execute(sql`select 1`));
    expect(outcome).toEqual({ state: 'unavailable' });
  });

  it('passes the data through when the query succeeds', async () => {
    process.env.DATABASE_URL = 'postgres://nobody:x@127.0.0.1:1/none';
    const { read } = await import('@/db/read');
    expect(await read(async () => 'rows')).toEqual({ state: 'ok', data: 'rows' });
  });

  it('logs why a read failed and never its parameters, which hold a username or a Clerk id', async () => {
    process.env.DATABASE_URL = 'postgres://nobody:x@127.0.0.1:1/none';
    const { read } = await import('@/db/read');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await read(() => {
      throw new Error('Failed query: select 1\nparams: user_private', { cause: new Error('connection terminated') });
    });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).toContain('connection terminated');
    expect(logged).not.toContain('user_private');
  });
});
