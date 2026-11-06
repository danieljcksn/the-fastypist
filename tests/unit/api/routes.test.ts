import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { rowsOf } from '@/db/client';
import { reconcile } from '@/server/reconcile';
import { createTestDb, type TestDb } from '../server/helpers/db';
import { buildRun, rankedRequest } from '../server/helpers/submissions';
import { count, NOON, setSecrets, typist } from '../server/helpers/world';

const state = vi.hoisted(() => ({
  userId: null as string | null,
  role: undefined as string | undefined,
  db: null as unknown,
  dbError: null as Error | null,
  accounts: true,
  revalidated: [] as string[],
  deleted: [] as string[],
  webhook: null as unknown,
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: state.userId }),
  clerkClient: async () => ({
    users: {
      getUser: async () => ({ publicMetadata: { role: state.role } }),
      deleteUser: async (id: string) => {
        state.deleted.push(id);
      },
    },
  }),
}));
vi.mock('@clerk/nextjs/webhooks', () => ({
  verifyWebhook: async () => {
    if (state.webhook === null) throw new Error('bad signature');
    return state.webhook;
  },
}));
vi.mock('next/cache', () => ({ revalidateTag: (tag: string) => state.revalidated.push(tag) }));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));
vi.mock('@/lib/accounts-flag', () => ({
  get ACCOUNTS() {
    return state.accounts;
  },
}));
vi.mock('@/db/client', async (original) => {
  const real = await original<typeof import('@/db/client')>();
  return {
    ...real,
    getDb: () => {
      if (state.dbError) throw state.dbError;
      return state.db;
    },
  };
});

const { POST: postTicket } = await import('@/app/api/tickets/route');
const { POST: postStamp } = await import('@/app/api/stamps/route');
const { POST: postResult } = await import('@/app/api/results/route');
const { POST: postReveal } = await import('@/app/api/today/reveal/route');
const { GET: getYesterday } = await import('@/app/api/yesterday/route');
const { GET: getMe, DELETE: deleteMe } = await import('@/app/api/me/route');
const { GET: getExport } = await import('@/app/api/me/export/route');
const { POST: postImport } = await import('@/app/api/me/import/route');
const { POST: postConsent, DELETE: deleteConsent } = await import('@/app/api/me/consent/route');
const { POST: postListing } = await import('@/app/api/me/listing/route');
const { GET: getUsername, POST: postUsername } = await import('@/app/api/username/route');
const { POST: postReport } = await import('@/app/api/reports/route');
const { GET: getAdmin, POST: postAdmin } = await import('@/app/api/admin/route');
const { POST: postWebhook } = await import('@/app/api/webhooks/clerk/route');
const { GET: getCron } = await import('@/app/api/cron/daily/route');

const ctx = {} as never;
const URLBASE = 'http://test.local';

function jsonRequest(path: string, body: unknown, method = 'POST', headers: Record<string, string> = {}): Request {
  return new Request(`${URLBASE}${path}`, { method, body: JSON.stringify(body), headers });
}

function binaryRequest(body: Uint8Array): Request {
  return new Request(`${URLBASE}/api/results`, { method: 'POST', body: body as BodyInit });
}

let test: TestDb;
let restoreSecrets: () => void;

beforeAll(async () => {
  test = await createTestDb();
  state.db = test.db;
  restoreSecrets = setSecrets();
});

afterAll(async () => {
  restoreSecrets();
  await test.close();
});

beforeEach(async () => {
  state.userId = null;
  state.role = undefined;
  state.dbError = null;
  state.accounts = true;
  state.revalidated = [];
  state.deleted = [];
  state.webhook = null;
  await test.db.execute(sql`TRUNCATE profiles, username_holds RESTART IDENTITY CASCADE`);
});

describe('signed out and accounts off', () => {
  const guarded: [string, () => Promise<Response>][] = [
    ['tickets', () => postTicket(jsonRequest('/api/tickets', {}), ctx)],
    ['results', () => postResult(binaryRequest(new Uint8Array(4)), ctx)],
    ['reveal', () => postReveal(jsonRequest('/api/today/reveal', { language: 'en' }), ctx)],
    ['me', () => getMe(new Request(`${URLBASE}/api/me`), ctx)],
    ['export', () => getExport(new Request(`${URLBASE}/api/me/export`), ctx)],
    ['import', () => postImport(jsonRequest('/api/me/import', { rows: [] }), ctx)],
    ['username', () => getUsername(new Request(`${URLBASE}/api/username?name=abc`), ctx)],
    ['report', () => postReport(jsonRequest('/api/reports', { target: 'username', username: 'abc' }), ctx)],
    ['admin', () => getAdmin(new Request(`${URLBASE}/api/admin`), ctx)],
  ];

  it.each(guarded)('%s answers 401 with a retry signal, never as a guest', async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'signed-out', retry: true });
    expect(await count(test.db, 'profiles')).toBe(0);
  });

  it.each(guarded)('%s answers 404 with accounts off', async (_name, call) => {
    state.accounts = false;
    expect((await call()).status).toBe(404);
  });

  it('the webhook answers 404 with accounts off', async () => {
    state.accounts = false;
    expect((await postWebhook(new Request(`${URLBASE}/x`, { method: 'POST', body: '{}' }), ctx)).status).toBe(404);
  });
});

describe('database down', () => {
  it('answers 503 with Retry-After on every database route', async () => {
    state.userId = 'user_down';
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    state.dbError = new Error('Failed query: select secret', { cause: refused });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const responses = await Promise.all([
      postResult(binaryRequest(buildRun({ iat: NOON }).body), ctx),
      postReveal(jsonRequest('/api/today/reveal', { language: 'en' }), ctx),
      getMe(new Request(`${URLBASE}/api/me`), ctx),
      getYesterday(new Request(`${URLBASE}/api/yesterday?language=en`), ctx),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('30');
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain('select secret');
    spy.mockRestore();
  });

  it('an unknown failure is a 500 that names no parameter', async () => {
    state.userId = 'user_bug';
    state.dbError = new Error('Failed query: params: user@example.com');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await getMe(new Request(`${URLBASE}/api/me`), ctx);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'failed' });
    spy.mockRestore();
  });

  it('tickets and stamps never touch the database', async () => {
    state.userId = 'user_nodb';
    state.dbError = new Error('must not be read');
    const ticket = await postTicket(jsonRequest('/api/tickets', { pack: 'en-1k@1', mode: 'time', amount: 60 }), ctx);
    expect(ticket.status).toBe(200);
    const { token } = (await ticket.json()) as { token: string };
    const stamp = await postStamp(jsonRequest('/api/stamps', { token, phase: 'start' }), ctx);
    expect(stamp.status).toBe(200);
    expect((await stamp.json()) as object).toHaveProperty('stamp');
  });
});

describe('tickets and stamps', () => {
  it('refuses a seed named by the client', async () => {
    state.userId = 'user_a';
    const response = await postTicket(jsonRequest('/api/tickets', { pack: 'en-1k@1', mode: 'time', amount: 60, seed: 'a'.repeat(32) }), ctx);
    expect(response.status).toBe(400);
  });

  it('refuses a stamp for a forged ticket', async () => {
    const response = await postStamp(jsonRequest('/api/stamps', { token: 'k1.e30.AAAA', phase: 'start' }), ctx);
    expect(response.status).toBe(400);
  });
});

describe('submit', () => {
  it('ranks a clean run for a consenting typist and revalidates', async () => {
    const userId = await typist(test.db, 'ana');
    state.userId = userId;
    const built = buildRun({ iat: Date.now() - 70_000, startAfter: 1000, endAfter: 61_000 });
    const response = await postResult(binaryRequest(built.body), ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { verdict: unknown; wpmCx: number };
    expect(body.verdict).toEqual({ state: 'ranked' });
    expect(state.revalidated).toEqual(['boards', 'profiles']);
  });

  it('answers a retry from the stored row, and the verdict stands', async () => {
    state.userId = await typist(test.db, 'bia');
    const built = buildRun({ iat: Date.now() - 70_000 });
    await postResult(binaryRequest(built.body), ctx);
    const response = await postResult(binaryRequest(built.body), ctx);
    const body = (await response.json()) as { retried: boolean; verdict: unknown };
    expect(body.retried).toBe(true);
    expect(body.verdict).toEqual({ state: 'ranked' });
    expect(await count(test.db, 'results')).toBe(1);
  });

  it('says why a run with no consent did not rank', async () => {
    state.userId = 'user_noconsent';
    const built = buildRun({ iat: Date.now() - 70_000 });
    const response = await postResult(binaryRequest(built.body), ctx);
    const body = (await response.json()) as { verdict: unknown };
    expect(body.verdict).toEqual({ state: 'unranked', why: 'no-username' });
  });

  it('says why a 30 second run did not rank', async () => {
    state.userId = await typist(test.db, 'caio');
    const built = buildRun({ iat: Date.now() - 40_000, request: { ...rankedRequest(), amount: 30 }, endAfter: 31_000 });
    const body = (await (await postResult(binaryRequest(built.body), ctx)).json()) as { verdict: unknown };
    expect(body.verdict).toEqual({ state: 'unranked', why: 'not-sixty-seconds' });
  });

  it('refuses a forged body and a reused ticket', async () => {
    state.userId = await typist(test.db, 'dani');
    const forged = buildRun({ iat: Date.now() - 70_000 }).body.slice();
    forged[forged.length - 1] = 0xff;
    forged[10] = (forged[10] ?? 0) ^ 1;
    expect((await postResult(binaryRequest(forged), ctx)).status).toBe(400);

    const built = buildRun({ iat: Date.now() - 70_000, seed: 2 });
    expect((await postResult(binaryRequest(built.body), ctx)).status).toBe(200);
    const again = buildRun({ iat: built.ticket.iat, issued: { token: built.token, ticket: built.ticket }, seed: 3 });
    const response = await postResult(binaryRequest(again.body), ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'nonce-used' });
  });

  it('cuts off an oversized body as it streams', async () => {
    state.userId = 'user_big';
    const huge = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const response = await postResult(new Request(`${URLBASE}/api/results`, { method: 'POST', body: huge, duplex: 'half' } as RequestInit), ctx);
    expect(response.status).toBe(413);
  });
});

describe('today', () => {
  it('spends the attempt on the first reveal and refuses the second', async () => {
    state.userId = await typist(test.db, 'edu');
    const first = await postReveal(jsonRequest('/api/today/reveal', { language: 'en' }), ctx);
    expect(first.status).toBe(200);
    const second = await postReveal(jsonRequest('/api/today/reveal', { language: 'en' }), ctx);
    expect(second.status).toBe(409);
  });

  it('reveals nothing to someone without consent', async () => {
    state.userId = 'user_new';
    const response = await postReveal(jsonRequest('/api/today/reveal', { language: 'en' }), ctx);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { missing: string[] }).missing).toEqual(['username', 'consent']);
    expect(await count(test.db, 'daily_entries')).toBe(0);
  });

  it('gives anyone yesterday, cached, and it is not today', async () => {
    const response = await getYesterday(new Request(`${URLBASE}/api/yesterday?language=en`), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage');
    const body = (await response.json()) as { seed: string; pack: string };
    expect(body.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(body.pack).toBe('en-1k@1');
  });
});

describe('account', () => {
  it('reads an empty account without creating a row', async () => {
    state.userId = 'user_fresh';
    const response = await getMe(new Request(`${URLBASE}/api/me`), ctx);
    expect(await response.json()).toEqual({ username: null, consent: false, listed: false, banned: false });
    expect(await count(test.db, 'profiles')).toBe(0);
  });

  it('checks availability live and answers for one own name', async () => {
    state.userId = await typist(test.db, 'fabi');
    const free = await getUsername(new Request(`${URLBASE}/api/username?name=somebody`), ctx);
    expect(await free.json()).toEqual({ available: true, username: 'somebody' });
    const own = await getUsername(new Request(`${URLBASE}/api/username?name=fabi`), ctx);
    expect(await own.json()).toEqual({ available: true, username: 'fabi' });
    state.userId = 'user_other';
    const taken = await getUsername(new Request(`${URLBASE}/api/username?name=FABI`), ctx);
    expect(await taken.json()).toEqual({ available: false, problem: 'taken' });
    const reserved = await getUsername(new Request(`${URLBASE}/api/username?name=admin`), ctx);
    expect(await reserved.json()).toEqual({ available: false, problem: 'reserved' });
    const bad = await getUsername(new Request(`${URLBASE}/api/username?name=a`), ctx);
    expect(await bad.json()).toEqual({ available: false, problem: 'format' });
  });

  it('holds a renamed name away from others in the preview too', async () => {
    state.userId = await typist(test.db, 'gabi');
    expect((await postUsername(jsonRequest('/api/username', { username: 'gabriela' }), ctx)).status).toBe(200);
    state.userId = 'user_other';
    const response = await getUsername(new Request(`${URLBASE}/api/username?name=gabi`), ctx);
    expect(await response.json()).toEqual({ available: false, problem: 'held' });
  });

  it('keeps ranking off until consent, and listing off until asked', async () => {
    state.userId = 'user_helena';
    expect((await postUsername(jsonRequest('/api/username', { username: 'helena' }), ctx)).status).toBe(200);
    expect(await (await getMe(new Request(`${URLBASE}/api/me`), ctx)).json()).toMatchObject({ username: 'helena', consent: false, listed: false });
    expect((await postListing(jsonRequest('/api/me/listing', { listed: true }), ctx)).status).toBe(409);

    expect((await postConsent(jsonRequest('/api/me/consent', { username: 'helena', listed: false }), ctx)).status).toBe(400);
    expect((await postConsent(jsonRequest('/api/me/consent', { consent: true, username: 'helena', listed: false }), ctx)).status).toBe(200);
    expect(await (await getMe(new Request(`${URLBASE}/api/me`), ctx)).json()).toMatchObject({ consent: true, listed: false });
    expect((await postListing(jsonRequest('/api/me/listing', { listed: true }), ctx)).status).toBe(200);
    expect(await (await getMe(new Request(`${URLBASE}/api/me`), ctx)).json()).toMatchObject({ consent: true, listed: true });

    expect((await deleteConsent(new Request(`${URLBASE}/api/me/consent`, { method: 'DELETE' }), ctx)).status).toBe(200);
    expect(await (await getMe(new Request(`${URLBASE}/api/me`), ctx)).json()).toMatchObject({ consent: false, listed: false, username: 'helena' });
  });

  it('answers a claim that loses with why', async () => {
    await typist(test.db, 'iris');
    state.userId = 'user_other';
    const response = await postUsername(jsonRequest('/api/username', { username: 'iris' }), ctx);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'taken' });
  });

  it('imports local history as private, repeatably', async () => {
    state.userId = 'user_import';
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      pack: 'en-1k@1',
      mode: 'time',
      amount: 60,
      wpmCx: 8000,
      rawCx: 8200,
      accuracyBp: 9700,
      consistencyBp: null,
      elapsedMs: 60_000,
      finishedAt: new Date(NOON).toISOString(),
      localDay: '2026-11-06',
    };
    const first = await postImport(jsonRequest('/api/me/import', { rows: [row, { bad: true }] }), ctx);
    expect(await first.json()).toEqual({ imported: 1, skipped: 1 });
    const second = await postImport(jsonRequest('/api/me/import', { rows: [row] }), ctx);
    expect(await second.json()).toEqual({ imported: 0, skipped: 1 });
    const rows = await rowsOf<{ ranked: boolean }>(test.db, sql`SELECT ranked FROM results`);
    expect(rows).toEqual([{ ranked: false }]);
  });

  it('exports as an attachment and leaves out Clerk ids', async () => {
    state.userId = await typist(test.db, 'jade');
    const response = await getExport(new Request(`${URLBASE}/api/me/export`), ctx);
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
    const text = await response.text();
    expect(text).toContain('jade');
    expect(text).not.toContain('user_jade');
  });

  it('deletes the row and the Clerk user, only with the confirmation, and repeats safely', async () => {
    state.userId = await typist(test.db, 'kaua');
    expect((await deleteMe(jsonRequest('/api/me', {}, 'DELETE'), ctx)).status).toBe(400);
    expect(await count(test.db, 'profiles')).toBe(1);
    expect((await deleteMe(jsonRequest('/api/me', { confirm: 'delete' }, 'DELETE'), ctx)).status).toBe(200);
    expect(await count(test.db, 'profiles')).toBe(0);
    expect(state.deleted).toEqual(['user_kaua']);
    expect((await deleteMe(jsonRequest('/api/me', { confirm: 'delete' }, 'DELETE'), ctx)).status).toBe(200);
  });
});

describe('moderation', () => {
  it('files a report and refuses one on yourself', async () => {
    await typist(test.db, 'lara');
    state.userId = await typist(test.db, 'theo');
    expect((await postReport(jsonRequest('/api/reports', { target: 'username', username: 'theo' }), ctx)).status).toBe(422);
    expect((await postReport(jsonRequest('/api/reports', { target: 'username', username: 'lara', note: 'name' }), ctx)).status).toBe(201);
    expect((await postReport(jsonRequest('/api/reports', { target: 'username', username: 'lara' }), ctx)).status).toBe(409);
    expect((await postReport(jsonRequest('/api/reports', { target: 'nonsense' }), ctx)).status).toBe(400);
  });

  it('checks the role in every admin handler', async () => {
    state.userId = 'user_plain';
    expect((await getAdmin(new Request(`${URLBASE}/api/admin`), ctx)).status).toBe(403);
    expect((await postAdmin(jsonRequest('/api/admin', { action: 'ban', profileId: 1 }), ctx)).status).toBe(403);
    expect(await count(test.db, 'admin_audit')).toBe(0);
  });

  it('runs an admin action with an audit row', async () => {
    const lara = await typist(test.db, 'lara');
    state.userId = 'user_admin';
    state.role = 'admin';
    expect((await postAdmin(jsonRequest('/api/admin', { action: 'nonsense' }), ctx)).status).toBe(400);
    const [row] = await rowsOf<{ id: number }>(test.db, sql`SELECT id::int FROM profiles WHERE clerk_user_id = ${lara}`);
    expect((await postAdmin(jsonRequest('/api/admin', { action: 'ban', profileId: row?.id, note: 'spam' }), ctx)).status).toBe(200);
    expect(await count(test.db, 'admin_audit')).toBe(1);
    expect((await postAdmin(jsonRequest('/api/admin', { action: 'ban', profileId: 999 }), ctx)).status).toBe(404);
    const queue = (await (await getAdmin(new Request(`${URLBASE}/api/admin`), ctx)).json()) as { reports: unknown[]; held: unknown[] };
    expect(queue).toEqual({ reports: [], held: [] });
  });
});

describe('webhook', () => {
  it('refuses a bad signature', async () => {
    expect((await postWebhook(new Request(`${URLBASE}/x`, { method: 'POST', body: '{}' }), ctx)).status).toBe(400);
  });

  it('hard deletes on user.deleted, and a replay is harmless', async () => {
    const userId = await typist(test.db, 'mila');
    state.webhook = { type: 'user.deleted', data: { id: userId, deleted: true } };
    for (let i = 0; i < 2; i++) expect((await postWebhook(new Request(`${URLBASE}/x`, { method: 'POST', body: '{}' }), ctx)).status).toBe(200);
    expect(await count(test.db, 'profiles')).toBe(0);
  });

  it('never inserts on user.updated', async () => {
    state.webhook = { type: 'user.updated', data: { id: 'user_ghost' } };
    expect((await postWebhook(new Request(`${URLBASE}/x`, { method: 'POST', body: '{}' }), ctx)).status).toBe(200);
    expect(await count(test.db, 'profiles')).toBe(0);
  });
});

describe('cron', () => {
  const cron = (auth?: string) => getCron(new Request(`${URLBASE}/api/cron/daily`, auth ? { headers: { authorization: auth } } : {}), ctx);

  it('refuses without the secret, and with no secret configured', async () => {
    delete process.env.CRON_SECRET;
    expect((await cron('Bearer anything')).status).toBe(401);
    process.env.CRON_SECRET = 'cron-secret';
    expect((await cron()).status).toBe(401);
    expect((await cron('Bearer wrong-secret')).status).toBe(401);
  });

  it('runs with the secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 10, 6, 6, 5) });
    try {
      const response = await cron('Bearer cron-secret');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, removed: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('reconcile', () => {
  const gone = Object.assign(new Error('not found'), { status: 404 });

  it('deletes only what Clerk confirms is gone', async () => {
    const keep = await typist(test.db, 'nina');
    const lost = await typist(test.db, 'otto');
    const shaky = await typist(test.db, 'paula');
    const client = {
      users: {
        getUserList: async () => ({ data: [{ id: keep }] }),
        getUser: async (id: string) => {
          if (id === lost) throw gone;
          throw Object.assign(new Error('clerk is down'), { status: 500 });
        },
      },
    };
    expect(await reconcile(test.db, client, new Date(NOON))).toBe(1);
    const left = await rowsOf<{ clerk_user_id: string }>(test.db, sql`SELECT clerk_user_id FROM profiles ORDER BY id`);
    expect(left.map((row) => row.clerk_user_id)).toEqual([keep, shaky]);
  });

  it('stops without deleting when the list call fails', async () => {
    await typist(test.db, 'quim');
    const client = {
      users: {
        getUserList: async () => {
          throw new Error('rate limited');
        },
        getUser: async () => ({}),
      },
    };
    await expect(reconcile(test.db, client, new Date(NOON))).rejects.toThrow();
    expect(await count(test.db, 'profiles')).toBe(1);
  });
});

