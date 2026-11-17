// Phase 3: every migration chain is tested the way production meets it — the whole folder applied to an empty
// database, re-run over a populated one, and each journal file applied statement by statement on a second scratch
// database, with the resulting shape compared against the ordinary full apply.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONCURRENT_DIR, MIGRATIONS_DIR, runMigrations, statementsOf } from '../src/migrate.ts';

const base = process.env.DATABASE_URL ?? 'postgres://ledgora:ledgora@localhost:5432/ledgora';
const FULL_DB = 'ledgora_mig_full';
const STEP_DB = 'ledgora_mig_step';
const urlOf = (db: string) => {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
};

let admin: postgres.Sql;

/** What shape the migrated database has: table names, index names, row-level-security facts. */
async function shape(url: string) {
  const q = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const tables = (
      await q`select table_name from information_schema.tables where table_schema = 'public'`
    ).map((r) => r.table_name as string);
    const indexes = (await q`select indexname from pg_indexes where schemaname = 'public'`).map(
      (r) => r.indexname as string,
    );
    const rls = (
      await q`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity`
    ).map((r) => ({
      name: r.relname as string,
      forced: (r.relforcerowsecurity as boolean) === true,
    }));
    const policies = (
      await q`select tablename, policyname from pg_policies where schemaname = 'public'`
    ).map((r) => `${r.tablename}.${r.policyname}`);
    const invalid = (
      await q`select c.relname from pg_index i join pg_class c on c.oid = i.indexrelid where not i.indisvalid`
    ).map((r) => r.relname as string);
    return { tables, indexes, rls, policies, invalid };
  } finally {
    await q.end();
  }
}

beforeAll(async () => {
  admin = postgres(base, { max: 1, onnotice: () => {} });
  for (const db of [FULL_DB, STEP_DB]) {
    await admin.unsafe(`drop database if exists ${db}`);
    await admin.unsafe(`create database ${db}`);
  }
});

afterAll(async () => {
  for (const db of [FULL_DB, STEP_DB]) await admin.unsafe(`drop database if exists ${db}`);
  await admin.end();
});

describe('migrations', () => {
  it('the whole chain applies to an empty database, RLS and Phase 3 indexes included', async () => {
    await runMigrations(urlOf(FULL_DB));
    const s = await shape(urlOf(FULL_DB));
    // The store every screen reads, the Phase 3 godown tables, the typed tables and the ledger.
    for (const table of [
      'documents',
      'user',
      'organizations',
      'godowns',
      'stock_transfers',
      'stock_transfer_lines',
      'bom_components',
      'manufacture_runs',
      'stock_movements',
      'ledger_entries',
    ])
      expect(s.tables, table).toContain(table);
    // Tenant data is fenced in: forced row-level security on the godown tables like every other tenant table.
    for (const name of [
      'godowns',
      'stock_transfers',
      'stock_transfer_lines',
      'bom_components',
      'manufacture_runs',
    ])
      expect(s.rls.find((r) => r.name === name)).toEqual({ name, forced: true });
    expect(s.policies).toContain('godowns.tenant_isolation');
    // The list indexes the paged reads walk (Phase 3 S6), and none of them failed to build.
    for (const index of [
      'documents_bills_date_idx',
      'documents_txn_date_idx',
      'documents_list_name_idx',
      'documents_list_client_idx',
      'documents_list_status_idx',
    ])
      expect(s.indexes, index).toContain(index);
    expect(s.invalid).toEqual([]);
  });

  it('re-running over a populated database changes nothing and keeps the data', async () => {
    const url = urlOf(FULL_DB);
    const q = postgres(url, { max: 1, onnotice: () => {} });
    try {
      // One tenant with one document, so the second run meets data, not an empty schema.
      await q.begin(async (tx) => {
        const [org] =
          await tx`insert into organizations (name) values ('Migration Check Ltd') returning id`;
        await tx.unsafe(`set local app.org_id = '${org.id}'`);
        await tx`insert into documents (org_id, collection, key, data) values (${org.id}, 'bills', 'MIG-1', ${q.json({ id: 'MIG-1', invoiceNumber: 'MIG-1', invoiceDate: '2026-11-01', totalAmount: 118 })})`;
      });
      const [count] = await q.begin(async (tx) => {
        const [org] = await tx`select id from organizations where name = 'Migration Check Ltd'`;
        await tx.unsafe(`set local app.org_id = '${org.id}'`);
        return await tx`select count(*)::int as n from documents`;
      });
      expect(count.n).toBe(1);
    } finally {
      await q.end();
    }
    const before = await shape(url);
    const again = await runMigrations(url);
    expect(await shape(url)).toEqual(before);
    // The concurrent folder is recorded, so the re-run also skips its statements.
    expect(again).toEqual([]);
  });

  it('every journal file applies on its own, statement by statement, to the same shape', async () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: { tag: string; breakpoints: boolean }[];
    };
    expect(journal.entries.length).toBeGreaterThan(30);
    const q = postgres(urlOf(STEP_DB), { max: 1, onnotice: () => {} });
    try {
      for (const entry of journal.entries) {
        const text = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
        const statements = entry.breakpoints
          ? text.split('--> statement-breakpoint').map((s) => s.trim())
          : [text.trim()];
        for (const statement of statements) if (statement) await q.unsafe(statement);
      }
      // The concurrent folder rides along, one statement at a time like src/migrate.ts applies it.
      await q.unsafe(
        'create table if not exists __concurrent_migrations (name text primary key, applied_at timestamptz not null default now(), ms integer not null)',
      );
      for (const file of readdirSync(CONCURRENT_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort())
        for (const statement of statementsOf(readFileSync(join(CONCURRENT_DIR, file), 'utf8')))
          await q.unsafe(statement);
    } finally {
      await q.end();
    }
    // Same tables, same indexes, same policies — the step apply and the library apply agree.
    const step = await shape(urlOf(STEP_DB));
    const full = await shape(urlOf(FULL_DB));
    expect(step.tables.toSorted()).toEqual(full.tables.toSorted());
    expect(step.indexes.toSorted()).toEqual(full.indexes.toSorted());
    expect(step.policies.toSorted()).toEqual(full.policies.toSorted());
  });
});
