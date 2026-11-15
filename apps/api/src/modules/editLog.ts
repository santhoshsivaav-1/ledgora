// R1.5 Companies Act edit log (docs/FEATURE_GAPS_2026-11.md). The database writes it (trigger edit_log_capture on every
// book table, migration 0030); these routes only read it: a list for the screen and a CSV for the auditor. Nothing
// here, or anywhere in the app, can change, delete or switch off the log.
import { and, desc, eq, gte, inArray, lt, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Database, type Tx } from '@ledgora/db';
import type { Registrar } from '../http.ts';
import { csvCell } from '../reports/shared.ts';

const { editLog, user } = schema;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  table: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
  rowId: z.string().uuid().optional(),
  action: z.enum(['INSERT', 'UPDATE', 'DELETE']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Rows older than this id (the previous page's last id). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
type Query = z.infer<typeof query>;

/** Plain-language names for the logged tables. */
export const EDIT_LOG_TABLES: Record<string, string> = {
  invoices: 'Sale document',
  invoice_lines: 'Sale line',
  purchases: 'Purchase bill',
  purchase_lines: 'Purchase line',
  purchase_orders: 'Purchase order',
  purchase_order_lines: 'Purchase order line',
  payments: 'Payment',
  payment_allocations: 'Payment allocation',
  expenses: 'Expense',
  ledger_entries: 'Ledger entry',
  tds_entries: 'TDS entry',
  accounts: 'Account',
  financial_years: 'Financial year',
  cash_entries: 'Cash entry',
  cheques: 'Cheque',
  transfers: 'Transfer',
  loans: 'Loan',
  loan_payments: 'Loan payment',
  loan_interest_credits: 'Loan interest',
  bank_recon: 'Bank reconciliation',
  stock_movements: 'Stock movement',
  items: 'Item',
  parties: 'Party',
  documents: 'Document (billing screens)',
  eway_bills: 'E-way bill',
  filing_packs: 'Filing pack',
  fy_closes: 'Year close',
  business_settings: 'Business settings',
  setting_values: 'Setting',
};

/** IST day bounds as instants. */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayEnd = (d: string) => new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86_400_000);

async function rows(tx: Tx, db: Database, q: Query, limit: number) {
  const where: SQL[] = [];
  if (q.table) where.push(eq(editLog.tableName, q.table));
  if (q.rowId) where.push(eq(editLog.rowId, q.rowId));
  if (q.action) where.push(eq(editLog.action, q.action));
  if (q.from) where.push(gte(editLog.at, dayStart(q.from)));
  if (q.to) where.push(lt(editLog.at, dayEnd(q.to)));
  if (q.before) where.push(lte(editLog.id, q.before - 1));
  const list = await tx
    .select()
    .from(editLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(editLog.id))
    .limit(limit);
  // Who: names of the people who made the changes. The user table is outside the tenant (the app role can not read
  // it), so the names are read on the server's own connection, only for the ids this page shows.
  const ids = [...new Set(list.map((r) => r.actorId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const people = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(inArray(user.id, ids));
    for (const p of people) names.set(p.id, p.name || p.email);
  }
  return list.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    table: r.tableName,
    what: EDIT_LOG_TABLES[r.tableName] ?? r.tableName,
    rowId: r.rowId,
    action: r.action,
    changed: r.changed ?? [],
    before: r.oldRow,
    after: r.newRow,
    actorId: r.actorId,
    actorName: r.actorId ? (names.get(r.actorId) ?? null) : 'System',
    ip: r.ip,
  }));
}

/** The changed columns of an update as "field: old → new", for the CSV. */
function changesText(r: Awaited<ReturnType<typeof rows>>[number]) {
  if (r.action !== 'UPDATE') return '';
  const b = (r.before ?? {}) as Record<string, unknown>;
  const a = (r.after ?? {}) as Record<string, unknown>;
  const show = (v: unknown) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
  return r.changed
    .map((k) => `${k}: ${show(b[k]).slice(0, 200)} → ${show(a[k]).slice(0, 200)}`)
    .join('; ');
}

export function editLogModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/edit-log',
    tag: 'Account',
    summary:
      'The edit log: every insert, change and delete of the books with who, when and the values before and after (newest first)',
    permission: 'audit:read',
    query,
    handler: async ({ tx, deps, query: q }) => {
      const data = await rows(tx, deps.db, q, q.limit);
      return {
        data,
        tables: EDIT_LOG_TABLES,
        nextBefore: data.length === q.limit ? data[data.length - 1]!.id : null,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/edit-log/export',
    tag: 'Account',
    summary: "The edit log for a date range as CSV, for the company's auditor (up to 100,000 rows)",
    permission: 'audit:read',
    query: query.omit({ before: true, limit: true }),
    handler: async ({ tx, deps, query: q, c }) => {
      const list = await rows(tx, deps.db, { ...q, limit: 100_000 }, 100_000);
      const head = ['When (IST)', 'Record', 'Record id', 'Action', 'By', 'IP', 'Changes'];
      const lines = list.map((r) =>
        [
          new Date(r.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          r.what,
          r.rowId,
          r.action,
          r.actorName ?? r.actorId ?? '',
          r.ip ?? '',
          changesText(r),
        ]
          .map(csvCell)
          .join(','),
      );
      const name = `edit-log_${q.from ?? 'start'}_${q.to ?? 'today'}.csv`;
      return c.body(`\uFEFF${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
      });
    },
  });
}
