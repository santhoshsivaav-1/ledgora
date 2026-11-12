import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';
import { createDb } from './client.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
/** P11-S2: statements that must not run in a transaction (CREATE INDEX CONCURRENTLY), applied after the migrations. */
export const CONCURRENT_DIR = join(MIGRATIONS_DIR, 'concurrent');

/** The statements of a concurrent file: comments dropped, split on ';' at the end of a line. */
export const statementsOf = (text: string) =>
  text
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ''))
    .filter(Boolean);

/**
 * Applies each file of migrations/concurrent once (recorded in __concurrent_migrations), statement by statement in
 * autocommit. An index an earlier interrupted run left INVALID is dropped concurrently and built again. Returns timings.
 */
export async function runConcurrent(sql: Sql, dir = CONCURRENT_DIR) {
  await sql`create table if not exists __concurrent_migrations (name text primary key, applied_at timestamptz not null default now(), ms integer not null)`;
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }
  const done = new Set(
    (await sql`select name from __concurrent_migrations`).map((r) => r.name as string),
  );
  const timings: { file: string; statement: string; ms: number }[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const started = Date.now();
    for (const stmt of statementsOf(readFileSync(join(dir, file), 'utf8'))) {
      const name = /INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(stmt)?.[1];
      if (name) {
        const [bad] =
          await sql`select 1 from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = ${name} and not i.indisvalid`;
        if (bad) await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
      }
      const t0 = Date.now();
      await sql.unsafe(stmt);
      timings.push({ file, statement: name ?? stmt.slice(0, 60), ms: Date.now() - t0 });
    }
    await sql`insert into __concurrent_migrations (name, ms) values (${file}, ${Date.now() - started})`;
  }
  return timings;
}

export async function runMigrations(url?: string) {
  const { db, sql, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return await runConcurrent(sql);
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMigrations();
  console.log('Migrations applied.');
}
