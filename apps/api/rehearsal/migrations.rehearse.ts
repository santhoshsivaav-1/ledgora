// P11-S5 migration rehearsal (docs/VYAPAR_IMPLEMENTATION_PHASES.md). Writes docs/release/<version>-rehearsal.md.
//
// 1. A scratch database at the schema of the last release (migrations up to 0022) plus 0023 (this release's sign-up
//    writes its columns), seeded through a real sign-up with SEED documents of each kind (synthetic: no production
//    data was available to anonymise).
// 2. API timings before the indexes; snapshot of the database (CREATE DATABASE … TEMPLATE).
// 3. 0023 timed on the seeded data (reverted on a copy of the snapshot, then re-applied); the CONCURRENT indexes
//    applied on the seeded data, each statement timed.
// 4. Ledger backfill (dry run, then real), Verify My Data, the same API timings after.
// 5. Rollback: the snapshot is restored into a fresh database, the app boots on it, then the indexes re-apply.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { MIGRATIONS_DIR, runConcurrent, withTenant } from '@ledgora/db';

const SEED = Number(process.env.REHEARSAL_DOCS ?? 10_000);
const RUNS = 30;
const LAST_RELEASED = 22; // 0022_msme.sql is the last migration before this release
const VERSION = process.env.REHEARSAL_VERSION ?? '1.11.0';
const base = process.env.DATABASE_URL ?? 'postgres://ledgora:ledgora@localhost:5432/ledgora';
const urlOf = (db: string) => Object.assign(new URL(base), { pathname: `/${db}` }).toString();
const DB = 'ledgora_rehearsal';
const SNAP = 'ledgora_rehearsal_snapshot';
const RESTORED = 'ledgora_rehearsal_restored';
const PREV = 'ledgora_rehearsal_prev';

const log: string[] = [];
const out = (s = '') => {
  log.push(s);
  console.log(s);
};
const ms = (n: number) => `${n.toFixed(0)} ms`;
const pct = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;

async function admin<T>(fn: (s: postgres.Sql) => Promise<T>) {
  const s = postgres(base, { max: 1, onnotice: () => {} });
  try {
    return await fn(s);
  } finally {
    await s.end();
  }
}
const recreate = (name: string, template?: string) =>
  admin(async (s) => {
    await s.unsafe(`drop database if exists ${name} with (force)`);
    await s.unsafe(`create database ${name}${template ? ` template ${template}` : ''}`);
  });

/** A copy of the migrations folder whose journal stops at migration `upTo`. */
function migrationsUpTo(upTo: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledgora-mig-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const j = JSON.parse(readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'));
  j.entries = j.entries.filter((e: { idx: number }) => e.idx <= upTo);
  writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(j));
  return dir;
}

async function timedMigrate(db: string, folder: string) {
  const s = postgres(urlOf(db), { max: 1, onnotice: () => {} });
  const t0 = performance.now();
  await migrate(drizzle(s), { migrationsFolder: folder });
  const t = performance.now() - t0;
  await s.end();
  return t;
}

describe('migration rehearsal', () => {
  it('runs end to end and writes the log', async () => {
    const started = new Date();
    out(`# Release ${VERSION}: migration and data rehearsal`);
    out();
    out(
      `Run ${started.toISOString()} on ${process.platform} ${process.arch}, Node ${process.version}, ` +
        `PostgreSQL ${(await admin((s) => s`show server_version`))[0]!.server_version}. Seed: ${SEED.toLocaleString('en-IN')} documents of each kind. Timings are single runs on this machine; repeat on staging.`,
    );
    out();
    out('## 1. Schema of the last release, seeded');
    await recreate(DB);
    const tOld = await timedMigrate(DB, migrationsUpTo(LAST_RELEASED));
    out(`- Migrations 0000–00${LAST_RELEASED} on an empty database: ${ms(tOld)}`);
    const t23empty = await timedMigrate(DB, migrationsUpTo(LAST_RELEASED + 1));
    out(
      `- 0023 on the empty database (needed before seeding: sign-up in this release writes its columns): ${ms(t23empty)}`,
    );

    process.env.TEST_DATABASE_URL = urlOf(DB);
    const { makeHarness } = await import('../test/helpers.ts');
    const h = makeHarness();
    const t = await h.newTenant();
    const seedStart = performance.now();
    await withTenant(h.db, t.orgId, async (tx) => {
      await tx.execute(
        sql`insert into parties (org_id, name, state) select ${t.orgId}::uuid, 'Party ' || g, 'Tamil Nadu' from generate_series(1, ${Math.max(100, SEED / 5)}) g`,
      );
      await tx.execute(
        sql`insert into items (org_id, name, hsn, sale_price, tax_percent) select ${t.orgId}::uuid, 'Item ' || g, '8471', 1000, 18 from generate_series(1, ${Math.max(50, SEED / 10)}) g`,
      );
      await tx.execute(sql`
        with p as (select id, row_number() over () rn from parties where org_id = ${t.orgId}::uuid)
        insert into invoices (org_id, business_id, party_id, invoice_type, number, invoice_date, status, place_of_supply,
                              subtotal, taxable_amount, cgst, sgst, total_tax, total)
        select ${t.orgId}::uuid, ${t.businessId}::uuid, p.id, 'tax-invoice', 'R-' || g, date '2026-04-01' + (g % 220),
               'unpaid', 'Tamil Nadu', 1000, 1000, 90, 90, 180, 1180
        from generate_series(1, ${SEED}) g join p on p.rn = 1 + (g % (select count(*) from p))`);
      await tx.execute(sql`
        insert into invoice_lines (org_id, invoice_id, name, quantity, rate, tax_percent)
        select org_id, id, 'Item 1', 1, 1000, 18 from invoices where org_id = ${t.orgId}::uuid`);
      await tx.execute(sql`
        with p as (select id, row_number() over () rn from parties where org_id = ${t.orgId}::uuid)
        insert into payments (org_id, business_id, party_id, amount, mode, payment_date, direction)
        select ${t.orgId}::uuid, ${t.businessId}::uuid, p.id, 500, 'cash', date '2026-04-01' + (g % 220), 'in'
        from generate_series(1, ${SEED}) g join p on p.rn = 1 + (g % (select count(*) from p))`);
      await tx.execute(sql`
        insert into documents (org_id, collection, key, data)
        select ${t.orgId}::uuid, 'bills', 'W-' || g, jsonb_build_object('id', 'W-' || g, 'invoiceNumber', 'W-' || g, 'invoiceDate', '2026-06-01')
        from generate_series(1, ${SEED}) g`);
      await tx.execute(sql`
        insert into stock_movements (org_id, item_id, quantity, reason)
        select ${t.orgId}::uuid, (select id from items where org_id = ${t.orgId}::uuid order by name limit 1), -1, 'sale'
        from generate_series(1, ${SEED}) g`);
    });
    out(
      `- Seed (parties ${Math.max(100, SEED / 5)}, items ${Math.max(50, SEED / 10)}, invoices with a line each ${SEED}, payments ${SEED}, workspace bills ${SEED}, stock movements ${SEED}): ${ms(performance.now() - seedStart)}`,
    );
    const party = (await withTenant(h.db, t.orgId, (tx) =>
      tx.execute(sql`select id from parties order by name limit 1`),
    )) as unknown as { id: string }[];

    const endpoints: [string, string][] = [
      ['Invoices list (first page)', `/v1/invoices?businessId=${t.businessId}&limit=50`],
      ['Payments of one party', `/v1/payments?partyId=${party[0]!.id}`],
      [
        'Sale report, financial year',
        `/v1/reports/sale?businessId=${t.businessId}&from=2026-04-01&to=2027-03-31`,
      ],
      [
        'Party statement report',
        `/v1/reports/party-statement?businessId=${t.businessId}&partyId=${party[0]!.id}&from=2026-04-01&to=2027-03-31`,
      ],
    ];
    // Each budget counts only when every request answered 200; anything else is reported as not met.
    type Call = typeof t.call;
    const measure = async (label: string, call: Call, list: [string, string][]) => {
      out();
      out(`### API timings ${label} (${RUNS} requests each, in process, no network)`);
      out('| Endpoint | Status | p50 | p95 | max |');
      out('|---|---|---|---|---|');
      const res: Record<string, { p95: number; ok: boolean }> = {};
      for (const [name, p] of list) {
        const times: number[] = [];
        const statuses = new Set<number>();
        for (let i = 0; i < RUNS; i++) {
          const t0 = performance.now();
          statuses.add((await call('GET', p)).status);
          times.push(performance.now() - t0);
        }
        res[name] = { p95: pct(times, 95), ok: statuses.size === 1 && statuses.has(200) };
        out(
          `| ${name} | ${[...statuses].join(', ')} | ${ms(pct(times, 50))} | ${ms(pct(times, 95))} | ${ms(Math.max(...times))} |`,
        );
      }
      return res;
    };
    const before = await measure('before the indexes', t.call, endpoints);
    out();
    out(
      'Party Statement is a ledger report: 409 until the ledger is switched on by the backfill in step 4.',
    );

    out();
    out('## 2. Snapshot');
    await h.close();
    const tSnap = performance.now();
    await recreate(SNAP, DB);
    out(`- \`CREATE DATABASE ${SNAP} TEMPLATE ${DB}\`: ${ms(performance.now() - tSnap)}`);

    out();
    out('## 3. New migrations on the seeded data');
    // 0023 on seeded data: a copy of the snapshot is put back to the last release's schema, then migrated.
    await recreate(PREV, SNAP);
    const p1 = postgres(urlOf(PREV), { max: 1, onnotice: () => {} });
    await p1.unsafe(
      'alter table subscriptions drop column provider, drop column provider_subscription_id, drop column billing_interval',
    );
    await p1.unsafe(
      'delete from drizzle.__drizzle_migrations where created_at = (select max(created_at) from drizzle.__drizzle_migrations)',
    );
    await p1.end();
    const t23 = await timedMigrate(PREV, MIGRATIONS_DIR);
    const p2 = postgres(urlOf(PREV), { max: 1, onnotice: () => {} });
    const cols =
      await p2`select count(*)::int n from information_schema.columns where table_name = 'subscriptions' and column_name in ('provider', 'provider_subscription_id', 'billing_interval')`;
    await p2.end();
    out(
      `- 0023_billing (three nullable columns on subscriptions, metadata only) on a copy of the seeded snapshot put back to 00${LAST_RELEASED}: ${ms(t23)}; columns present after: ${cols[0]!.n} of 3`,
    );
    const tNew = await timedMigrate(DB, MIGRATIONS_DIR);
    out(
      `- Ordinary migrations on the seeded database (nothing pending, journal check only): ${ms(tNew)}`,
    );
    const s = postgres(urlOf(DB), { max: 1, onnotice: () => {} });
    const conc = await runConcurrent(s);
    await s.end();
    out('- CONCURRENT indexes (no write lock; each statement timed):');
    out();
    out('| Statement | Time |');
    out('|---|---|');
    for (const c of conc) out(`| ${c.statement} | ${ms(c.ms)} |`);
    out(`| **Total** | **${ms(conc.reduce((a, c) => a + c.ms, 0))}** |`);

    const h2 = makeHarness();
    const t2 = { ...t, call: h2.client(t.cookie) };
    out();
    out('## 4. Backfill, Verify, timings after');
    const tDry = performance.now();
    const dry = await t2.call('POST', '/v1/accounting/backfill', {
      businessId: t.businessId,
      dryRun: true,
    });
    out(
      `- Backfill dry run: HTTP ${dry.status}, ${ms(performance.now() - tDry)}${dry.body?.documents !== undefined ? `, ${JSON.stringify(dry.body.documents)}` : ''}`,
    );
    const tReal = performance.now();
    const real = await t2.call('POST', '/v1/accounting/backfill', {
      businessId: t.businessId,
      dryRun: false,
      force: true,
    });
    const backfillMs = performance.now() - tReal;
    out(
      `- Backfill real run (force: synthetic parties have no opening balances to reconcile): HTTP ${real.status}, ${ms(backfillMs)}, ledger on: ${real.body?.enabled ?? 'n/a'}${real.status >= 400 ? ` — ${real.text.slice(0, 200)}` : ''}`,
    );
    const ver = await t2.call('GET', `/v1/verify?businessId=${t.businessId}`);
    const issues = Array.isArray(ver.body?.checks)
      ? ver.body.checks
          .filter((c: { ok?: boolean }) => c.ok === false)
          .map((c: { id?: string }) => c.id)
      : null;
    out(
      `- Verify My Data: HTTP ${ver.status}${issues ? `, failing checks: ${issues.length ? issues.join(', ') : 'none'}` : ` — ${ver.text.slice(0, 200)}`}`,
    );
    const after = await measure('after', t2.call, [
      ...endpoints,
      [
        'Day Book, financial year',
        `/v1/reports/day-book?businessId=${t.businessId}&from=2026-04-01&to=2027-03-31`,
      ],
    ]);
    await h2.close();

    out();
    out('## 5. Rollback rehearsal');
    const tRestore = performance.now();
    await recreate(RESTORED, SNAP);
    out(
      `- Restore the pre-index snapshot into \`${RESTORED}\`: ${ms(performance.now() - tRestore)}`,
    );
    process.env.TEST_DATABASE_URL = urlOf(RESTORED);
    const h3 = makeHarness();
    const healthRes = await h3.client('')('GET', '/health');
    const listRes = await h3.client(t.cookie)(
      'GET',
      `/v1/invoices?businessId=${t.businessId}&limit=50`,
    );
    await h3.close();
    out(
      `- App boots on the restored copy: /health HTTP ${healthRes.status}, invoices list HTTP ${listRes.status} (${listRes.body?.data?.length ?? 0} rows on the first page)`,
    );
    const tReapply = await timedMigrate(RESTORED, MIGRATIONS_DIR);
    const s3 = postgres(urlOf(RESTORED), { max: 1, onnotice: () => {} });
    await runConcurrent(s3);
    // invoices is under RLS: count inside the tenant, as the app does.
    const [cnt] = await s3.begin(async (q) => {
      await q`select set_config('app.org_id', ${t.orgId}, true)`;
      return q`select count(*)::int n from invoices`;
    });
    await s3.end();
    out(
      `- Re-apply this release's migrations on the restored copy: ${ms(tReapply)} + indexes; invoices present: ${cnt!.n}`,
    );
    out(
      "- The restored copy is the last release's schema plus its data: the previous release runs on it unchanged (every migration in this release is additive).",
    );

    out();
    out('## Budgets (P11-S2) measured here');
    out('| Budget | Target | Measured | Met? |');
    out('|---|---|---|---|');
    const met = (names: string[], limit: number) =>
      names.every((n) => after[n]!.ok && after[n]!.p95 < limit) ? 'yes' : 'no';
    const show = (n: string, label: string) =>
      `${ms(after[n]!.p95)} (${label}${after[n]!.ok ? '' : ', NOT 200'})`;
    const lists = ['Invoices list (first page)', 'Payments of one party'];
    const reps = [
      'Sale report, financial year',
      'Party statement report',
      'Day Book, financial year',
    ];
    out(
      `| API p95 list endpoints at ${SEED.toLocaleString('en-IN')} docs | < 300 ms | ${show(lists[0]!, 'invoices')}, ${show(lists[1]!, 'payments')} | ${met(lists, 300)} |`,
    );
    out(
      `| API p95 reports at ${SEED.toLocaleString('en-IN')} docs | < 2 s | ${show(reps[0]!, 'sale')}, ${show(reps[1]!, 'party statement')}, ${show(reps[2]!, 'day book')} | ${met(reps, 2000)} |`,
    );
    out(
      `| Backfill ${SEED.toLocaleString('en-IN')} docs | < 3 min | ${ms(backfillMs)} | ${real.status < 400 && backfillMs < 180_000 ? 'yes' : 'no'} |`,
    );
    out();
    out(
      'Before → after index p95 (200 responses only): ' +
        Object.keys(before)
          .filter((k) => before[k]!.ok && after[k]!.ok)
          .map((k) => `${k} ${ms(before[k]!.p95)} → ${ms(after[k]!.p95)}`)
          .join('; ') +
        '.',
    );
    out();
    out(
      'Not measured here (need a browser or CI): initial JS size is in the build log, LCP, table render, editor typing latency, and the ×50 / 100k-document report budget.',
    );

    await admin(async (a) => {
      for (const d of [DB, SNAP, RESTORED, PREV])
        await a.unsafe(`drop database if exists ${d} with (force)`);
    });
    const dir = path.resolve(import.meta.dirname, '../../../docs/release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${VERSION}-rehearsal.md`), log.join('\n') + '\n');
  });
});
