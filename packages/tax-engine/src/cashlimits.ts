// Vyapar parity P10-S6: the cash-limit watch beyond §269ST (which is cashWatch in cashbank.ts). These only report:
// nothing here blocks a posting.

import type { Numeric } from './types.ts';
import { CASH_LIMIT_40A3 } from './purchase.ts';
import { addDays, daysBetween } from './compliance.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;

/**
 * §40A(3): cash paid to one person in one day above ₹10,000 is not deductible (the whole of that day's cash to them).
 * Rows are payments out and expenses; only cash counts.
 */
export function cashPaymentWatch(
  rows: { payee: string; date: string; amount: Numeric; mode?: string | null }[],
  limit: number = CASH_LIMIT_40A3,
) {
  const by = new Map<string, { payee: string; date: string; total: number }>();
  for (const r of rows) {
    if ((r.mode ?? 'cash') !== 'cash' || !r.payee?.trim()) continue;
    const k = `${r.payee.trim().toLowerCase()}|${r.date}`;
    const cur = by.get(k) ?? { payee: r.payee.trim(), date: r.date, total: 0 };
    cur.total = r2(cur.total + n(r.amount));
    by.set(k, cur);
  }
  return [...by.values()]
    .filter((x) => x.total > limit)
    .map((x) => ({ ...x, disallowed: x.total }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.payee.localeCompare(b.payee));
}

/** §269SS: a loan or deposit of ₹20,000 or more accepted in cash. */
export const CASH_LIMIT_269SS = 20_000;
export function cashLoanWatch(
  loans: { id: string; lender: string; date: string; amount: Numeric; cash: boolean }[],
  limit = CASH_LIMIT_269SS,
) {
  return loans
    .filter((l) => l.cash && n(l.amount) >= limit)
    .map((l) => ({ id: l.id, lender: l.lender, date: l.date, amount: r2(n(l.amount)) }));
}

/**
 * §43B(h): what is owed to a micro or small enterprise is deductible only when paid within the MSMED Act period: the
 * agreed days, never more than 45 (15 when there is no written agreement; pass agreedDays: 15). Day 45 is in time.
 */
export const MSME_MAX_DAYS = 45;
export function msmeOverdue(
  bills: {
    id: string;
    supplier: string;
    date: string;
    pending: Numeric;
    msme?: boolean;
    agreedDays?: number;
  }[],
  asOf: string,
) {
  const out: {
    id: string;
    supplier: string;
    date: string;
    pending: number;
    daysOld: number;
    dueBy: string;
  }[] = [];
  for (const b of bills) {
    if (!b.msme || n(b.pending) <= 0.005) continue;
    const days = Math.min(
      MSME_MAX_DAYS,
      b.agreedDays && b.agreedDays > 0 ? b.agreedDays : MSME_MAX_DAYS,
    );
    const daysOld = daysBetween(b.date, asOf);
    if (daysOld > days)
      out.push({
        id: b.id,
        supplier: b.supplier,
        date: b.date,
        pending: r2(n(b.pending)),
        daysOld,
        dueBy: addDays(b.date, days),
      });
  }
  return out.sort((a, b) => b.daysOld - a.daysOld);
}
