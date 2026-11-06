#!/usr/bin/env node
// Runs before next build on Vercel, and by hand locally with `npm run db:migrate`.
//
// Where it runs: VERCEL_ENV=production, or with VERCEL_ENV unset, which is a person running it locally. Preview and
// development builds on Vercel exit 0 untouched, because they may hold production's URL.
//
// Which URL: DATABASE_URL_UNPOOLED, because PgBouncer's transaction mode drops session advisory locks. A pooled URL is
// never used. With no URL, a production build exits 0 so the site can ship without a database, and a local run fails.
//
// Database unusable (unreachable, out of quota, read only, or only a pooled URL to reach it by): a deploy must not depend on
// a database that may stay suspended until the next billing period, but new code must not ship ahead of its schema. A build
// cannot ask a dead database what it has applied, so the answer is committed: drizzle/production-watermark.txt names the
// last migration known to be live in production. Every journal entry after it counts as new. No new migrations: print and
// exit 0. Any new one: exit 1. Forgetting to bump the file after a deploy fails safe, since the worst case is a blocked deploy
// during an outage, fixed by committing the bump.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOLDER = process.env.MIGRATIONS_FOLDER ?? join(ROOT, "drizzle");
const WATERMARK_FILE = "production-watermark.txt";
// Any constant both builds agree on. It only has to differ from other advisory locks in this database.
const LOCK_ID = 727001;

function pendingMigrations() {
  const { entries } = JSON.parse(readFileSync(join(FOLDER, "meta", "_journal.json"), "utf8"));
  const path = join(FOLDER, WATERMARK_FILE);
  const watermark = existsSync(path) ? readFileSync(path, "utf8").trim() : "none";
  const at = entries.findIndex((entry) => entry.tag === watermark);
  return entries.slice(at + 1).map((entry) => entry.tag);
}

function exitWithoutMigrating(reason) {
  const pending = pendingMigrations();
  console.warn(`db-migrate: ${reason}`);
  if (pending.length === 0) {
    console.warn("db-migrate: no new migrations since the watermark, continuing without the database");
    process.exit(0);
  }
  console.error(`db-migrate: cannot apply new migrations: ${pending.join(", ")}`);
  process.exit(1);
}

const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv && vercelEnv !== "production") {
  console.log(`db-migrate: skipped on ${vercelEnv}, migrations run only in production`);
  process.exit(0);
}

const isPooled = (url) => url.includes("-pooler.") || url.includes("pgbouncer=true");
const candidate = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const url = candidate && !isPooled(candidate) ? candidate : undefined;
if (!url) {
  const message = candidate ? "only a pooled database URL is set" : "no database URL is set";
  if (vercelEnv !== "production") {
    console.error(`db-migrate: ${message}, set DATABASE_URL_UNPOOLED`);
    process.exit(1);
  }
  if (candidate) exitWithoutMigrating(message);
  console.warn(`db-migrate: ${message}, nothing migrated`);
  process.exit(0);
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
try {
  await client.connect();
} catch (error) {
  exitWithoutMigrating(`database unreachable: ${error.message}`);
}

try {
  await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
  await migrate(drizzle({ client }), { migrationsFolder: FOLDER });
  console.log("db-migrate: migrations applied");
  const pending = pendingMigrations();
  if (vercelEnv === "production" && pending.length > 0) {
    console.log(`db-migrate: name the newest of ${pending.join(", ")} in drizzle/${WATERMARK_FILE} and commit it`);
  }
} catch (error) {
  // Ending the session also releases the advisory lock.
  await client.end().catch(() => {});
  if (vercelEnv === "production") exitWithoutMigrating(`migrating failed: ${error.message}`);
  console.error(`db-migrate: ${error.message}`);
  process.exit(1);
}
await client.end();
