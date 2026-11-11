// P7-S6: a member limited to a date range (a CA given one year) sees only that range, on every screen, not only on
// reports. Two rules, applied by the route registrar to every GET after sign-in:
//  1. a date in the query (from, to, asOf) outside the range is refused;
//  2. what comes back is cut to the range: rows of a list whose own date is outside it are dropped, and a single record
//     dated outside it is refused. The date fields are the ones the API uses (invoiceDate, purchaseDate, expenseDate,
//     paymentDate, txnDate, date).
// Totals the server works out across all rows (a party's balance, a dashboard figure) are not recomputed for the range.
import { AppError } from '../errors.ts';

export interface Range {
  dataFrom: string | null;
  dataTo: string | null;
}
const DATE_FIELDS = [
  'invoiceDate',
  'purchaseDate',
  'expenseDate',
  'paymentDate',
  'txnDate',
  'date',
];
const ISO = /^\d{4}-\d{2}-\d{2}/;

export const hasRange = (r: Range) => !!(r.dataFrom || r.dataTo);
const refuse = (r: Range) =>
  new AppError(
    'forbidden',
    `You can see records from ${r.dataFrom ?? 'the start'} to ${r.dataTo ?? 'today'} only`,
    { from: r.dataFrom, to: r.dataTo },
  );

/** Refuses a query that asks for dates outside the range. */
export function checkQuery(r: Range, query: unknown) {
  if (!query || typeof query !== 'object') return;
  const q = query as Record<string, unknown>;
  for (const k of ['from', 'dateFrom']) {
    const v = q[k];
    if (typeof v === 'string' && ISO.test(v) && r.dataFrom && v.slice(0, 10) < r.dataFrom)
      throw refuse(r);
  }
  for (const k of ['to', 'dateTo', 'asOf']) {
    const v = q[k];
    if (typeof v === 'string' && ISO.test(v) && r.dataTo && v.slice(0, 10) > r.dataTo)
      throw refuse(r);
  }
}

const dateOf = (row: unknown): string | null => {
  if (!row || typeof row !== 'object') return null;
  for (const f of DATE_FIELDS) {
    const v = (row as Record<string, unknown>)[f];
    if (typeof v === 'string' && ISO.test(v)) return v.slice(0, 10);
  }
  return null;
};
const inside = (r: Range, d: string) =>
  (!r.dataFrom || d >= r.dataFrom) && (!r.dataTo || d <= r.dataTo);

/** Cuts a response to the range. Responses with no date to judge by pass through. */
export function clampResult(r: Range, result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const out = result as Record<string, unknown>;
  const rows = out.data;
  if (Array.isArray(rows)) {
    const kept = rows.filter((x) => {
      const d = dateOf(x);
      return d === null || inside(r, d);
    });
    return kept.length === rows.length ? result : { ...out, data: kept };
  }
  const d = dateOf(out);
  if (d !== null && !inside(r, d)) throw refuse(r);
  return result;
}
