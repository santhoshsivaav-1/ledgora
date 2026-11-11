/**
 * Vyapar parity P4-S4: the backfill from the command line.
 *
 *   pnpm --filter @ledgora/api backfill:ledger -- --business <id> [--dry-run] [--from 2024-04-01] [--org <id>]
 *
 * --org is only needed when DATABASE_URL's role is subject to row-level security (not a superuser), so the business's
 * organization cannot be looked up without it.
 *
 * Same code as `POST /v1/accounting/backfill`, run as the app role inside the business's tenant (so row-level security and
 * the append-only grant on ledger_entries apply). There is deliberately no --force: when the trial balance does not
 * balance, a document cannot be posted, or a party's ledger balance differs from its documents, nothing is kept, the
 * diff table is printed and the command exits 1. Fix the data (Verify My Data) and run it again.
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDb, schema, withTenant } from '@ledgora/db';
import { audit } from './audit.ts';
import { backfillLedger, type BackfillResult } from './modules/ledgerBackfill.ts';

const money = (n: number) => n.toFixed(2);

/** Plain-text table, numbers right-aligned. */
export function table(head: string[], rows: string[][], numeric: boolean[]) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) =>
    r.map((c, i) => (numeric[i] ? c.padStart(w[i]) : c.padEnd(w[i]))).join(' │ ');
  return [line(head), w.map((n) => '─'.repeat(n)).join('─┼─'), ...rows.map(line)].join('\n');
}

export function report(r: BackfillResult) {
  const out = [
    `${r.dryRun ? 'Check (dry run, nothing written)' : 'Backfill'}: ${r.documents} documents · ${r.vouchers} vouchers`,
    r.trialBalance
      ? `Trial balance: Dr ${money(r.trialBalance.debit)} · Cr ${money(r.trialBalance.credit)} · ${r.trialBalance.balanced ? 'balanced' : 'NOT BALANCED'}`
      : 'Trial balance: not computed',
  ];
  if (r.problems.length)
    out.push(
      '',
      `Documents that could not be posted (${r.problems.length}):`,
      table(
        ['Kind', 'Document', 'Id', 'Problem'],
        r.problems.map((p) => [p.kind, p.label, p.id, p.message]),
        [false, false, false, false],
      ),
    );
  if (r.diffs.length)
    out.push(
      '',
      `Party balances that differ, ledger vs documents (${r.diffs.length}):`,
      table(
        ['Party', 'Party id', 'Ledger', 'Documents', 'Difference'],
        r.diffs.map((d) => [
          d.name,
          d.partyId,
          money(d.ledger),
          money(d.documents),
          money(d.ledger - d.documents),
        ]),
        [false, false, true, true, true],
      ),
    );
  else out.push('Party balances: every party matches its documents');
  return out.join('\n');
}

export const clean = (r: BackfillResult) =>
  r.problems.length === 0 && r.diffs.length === 0 && !!r.trialBalance?.balanced;

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    options: {
      business: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      from: { type: 'string' },
      org: { type: 'string' },
    },
  });
  if (!values.business) {
    console.error(
      'usage: backfill:ledger -- --business <id> [--dry-run] [--from YYYY-MM-DD] [--org <id>]\n(there is no --force)',
    );
    process.exit(2);
  }
  if (values.from && !/^\d{4}-\d{2}-\d{2}$/.test(values.from)) {
    console.error('--from must be a date, YYYY-MM-DD');
    process.exit(2);
  }
  const { db, close } = createDb(undefined, { max: 1 });
  try {
    // Only the org id is looked up outside a tenant (or given): everything else runs as the app role.
    const find = (tx: Pick<typeof db, 'select'>) =>
      tx
        .select({ orgId: schema.businesses.orgId, name: schema.businesses.name })
        .from(schema.businesses)
        .where(eq(schema.businesses.id, values.business!));
    const [biz] = values.org ? await withTenant(db, values.org, (tx) => find(tx)) : await find(db);
    if (!biz) {
      console.error(
        `No business ${values.business}${values.org ? ` in organization ${values.org}` : ' (pass --org <id> if the database role is not a superuser)'}`,
      );
      process.exitCode = 2;
      return;
    }
    const dryRun = values['dry-run'];
    const r = await withTenant(
      db,
      biz.orgId,
      async (tx) => {
        const res = await backfillLedger(tx, biz.orgId, {
          businessId: values.business!,
          dryRun,
          force: false,
          from: values.from,
        });
        await audit(
          tx,
          biz.orgId,
          dryRun ? 'ledger.backfill_check' : 'ledger.backfill',
          'business',
          values.business!,
          {
            after: {
              documents: res.documents,
              problems: res.problems.length,
              diffs: res.diffs.length,
              enabled: res.enabled,
              force: false,
              via: 'cli',
            },
          },
        );
        return res;
      },
      { businessIds: [values.business!] },
    );
    console.log(`Business: ${biz.name} (${values.business})\n${report(r)}`);
    if (!clean(r)) {
      console.log(
        `\nStopped: the ledger was ${dryRun ? 'not checked clean' : 'NOT turned on and nothing was written'}. ` +
          'Fix the rows above (Utilities › Verify My Data) and run again.',
      );
      process.exitCode = 1;
    } else if (dryRun)
      console.log('\nClean. Run again without --dry-run to post history and turn the ledger on.');
    else console.log('\nDone: history posted and the ledger is on.');
  } finally {
    await close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
