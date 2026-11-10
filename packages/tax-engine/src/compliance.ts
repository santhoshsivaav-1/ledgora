// Vyapar parity Phase 10 (compliance), the pure rules: P10-S4 the 180-day ITC rule and P10-S5 TDS due dates and
// interest. Shared by the API and the web screens (docs/VYAPAR_IMPLEMENTATION_PHASES.md).

import type { Numeric } from './types.ts';
import { r2 } from './money.ts';

const n = (v: Numeric) => Number(v) || 0;
const DAY = 86_400_000;
const utc = (iso: string) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);
export const addDays = (d: string, k: number) => iso(utc(d) + k * DAY);

// ---- P10-S4 ITC 180-day rule -------------------------------------------------------------------------------------------

/** Days a supplier has to be paid, counted from the date of the supplier's invoice (§16(2), rule 37). */
export const ITC_DAYS = 180;
/** From this many days the app warns that credit is at risk. */
export const ITC_WARN_DAYS = 150;

export interface ItcBill {
  id: string;
  supplier?: string;
  number?: string;
  /** Date of the supplier's invoice. */
  date: string;
  /** What the supplier is owed (total less any TDS we keep): the amount that has to be paid. */
  payable: Numeric;
  /** Input tax credit claimed on the bill. */
  itc: Numeric;
}
export interface ItcPayment {
  billId: string;
  amount: Numeric;
  /** The payment date. A cheque counts on its date; Phase 5 may switch this to clearance (decision D-12). */
  date: string;
}

/** The last day the supplier can be paid with the credit staying safe: invoice date + 180 days. */
export const itcDeadline = (billDate: string) => addDays(billDate, ITC_DAYS);

/** Paid on or before `by`, capped at what is payable. */
const paidBy = (b: ItcBill, payments: ItcPayment[], by: string) =>
  Math.min(
    n(b.payable),
    payments.filter((p) => p.billId === b.id && p.date <= by).reduce((s, p) => s + n(p.amount), 0),
  );
/** Credit that goes with an amount of the bill's payable, in proportion. */
const share = (b: ItcBill, amount: number) =>
  n(b.payable) > 0 ? r2((n(b.itc) * amount) / n(b.payable)) : 0;

/**
 * Where each bill stands on `asOf`. `daysLeft` is days until the deadline (0 on the deadline day itself, negative
 * after). Credit is reversed from the day after the deadline, for the part of the bill still unpaid at the deadline
 * (partial payment gives a proportional reversal). Bills with nothing unpaid, or no credit, are left out.
 */
export function itcAging(bills: ItcBill[], payments: ItcPayment[], asOf: string) {
  const atRisk: (ItcBill & { daysLeft: number; unpaid: number; itcAtRisk: number })[] = [];
  const dueForReversal: (ItcBill & {
    daysLate: number;
    unpaid: number;
    itcToReverse: number;
    deadline: string;
  })[] = [];
  for (const b of bills || []) {
    if (n(b.itc) <= 0 || n(b.payable) <= 0) continue;
    const age = daysBetween(b.date, asOf);
    const deadline = itcDeadline(b.date);
    if (age > ITC_DAYS) {
      const unpaid = r2(n(b.payable) - paidBy(b, payments, deadline));
      if (unpaid > 0.005)
        dueForReversal.push({
          ...b,
          daysLate: age - ITC_DAYS,
          unpaid,
          itcToReverse: share(b, unpaid),
          deadline,
        });
    } else if (age >= ITC_WARN_DAYS) {
      const unpaid = r2(n(b.payable) - paidBy(b, payments, asOf));
      if (unpaid > 0.005)
        atRisk.push({ ...b, daysLeft: ITC_DAYS - age, unpaid, itcAtRisk: share(b, unpaid) });
    }
  }
  atRisk.sort((a, c) => a.daysLeft - c.daysLeft);
  dueForReversal.sort((a, c) => c.daysLate - a.daysLate);
  return { atRisk, dueForReversal };
}

/**
 * What a GST return period [from, to] shows for the rule. Reversal (GSTR-3B 4(B)(2)): bills whose first day past the
 * deadline falls in the period, for the credit on what was unpaid at the deadline. Re-claim (4(A)(5), labelled
 * "Re-claimed ITC"): payments made in the period after the deadline of a bill that was reversed, in proportion, never
 * more than was reversed.
 */
export function itcReversalsFor(
  bills: ItcBill[],
  payments: ItcPayment[],
  from: string,
  to: string,
) {
  const reversals: {
    billId: string;
    supplier?: string;
    number?: string;
    itc: number;
    unpaid: number;
    /** The first day past the deadline: the period whose return carries the reversal. */
    date: string;
  }[] = [];
  const reclaims: {
    billId: string;
    supplier?: string;
    number?: string;
    itc: number;
    paidOn: string;
  }[] = [];
  for (const b of bills || []) {
    if (n(b.itc) <= 0 || n(b.payable) <= 0) continue;
    const deadline = itcDeadline(b.date);
    const first = addDays(deadline, 1);
    const unpaid = r2(n(b.payable) - paidBy(b, payments, deadline));
    const reversed = unpaid > 0.005 ? share(b, unpaid) : 0;
    if (first >= from && first <= to && reversed > 0)
      reversals.push({
        billId: b.id,
        supplier: b.supplier,
        number: b.number,
        itc: reversed,
        unpaid,
        date: first,
      });
    if (reversed > 0) {
      let left = reversed;
      const late = payments
        .filter((p) => p.billId === b.id && p.date > deadline)
        .sort((x, y) => x.date.localeCompare(y.date));
      let remaining = unpaid;
      for (const p of late) {
        const take = Math.min(n(p.amount), remaining);
        remaining = r2(remaining - take);
        const credit = Math.min(left, share(b, take));
        left = r2(left - credit);
        if (p.date >= from && p.date <= to && credit > 0)
          reclaims.push({
            billId: b.id,
            supplier: b.supplier,
            number: b.number,
            itc: credit,
            paidOn: p.date,
          });
      }
    }
  }
  const sum = (a: { itc: number }[]) => r2(a.reduce((s, x) => s + x.itc, 0));
  return { reversals, reclaims, reversed: sum(reversals), reclaimed: sum(reclaims) };
}

// ---- P10-S5 TDS ------------------------------------------------------------------------------------------------------------

/**
 * When TDS deducted on `date` has to be deposited: the 7th of the next month; for tax deducted in March, 30 April.
 * (Government deductors and some special cases differ; this is the general rule.)
 */
export function tdsDueDate(date: string) {
  const [y, m] = String(date).slice(0, 10).split('-').map(Number);
  if (m === 3) return `${y}-04-30`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-07`;
}

/**
 * Interest under §201(1A) on TDS: 1% a month for tax not deducted in time, 1.5% a month for tax deducted but not
 * deposited in time. A month or part of a month counts as a whole month. For a late deposit it runs from the date of
 * deduction to the date of deposit (or `asOf` while still unpaid) and only applies when that is after the due date.
 */
export function tdsInterest(o: {
  tds: Numeric;
  deductedOn: string;
  dueDate?: string;
  depositedOn?: string | null;
  asOf: string;
  kind?: 'late_deposit' | 'late_deduction';
}) {
  const kind = o.kind ?? 'late_deposit';
  const end = o.depositedOn || o.asOf;
  const due = o.dueDate || tdsDueDate(o.deductedOn);
  if (kind === 'late_deposit' && end <= due)
    return { months: 0, rate: 1.5, interest: 0, overdue: false };
  const [y1, m1, d1] = o.deductedOn.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = end.slice(0, 10).split('-').map(Number);
  const whole = (y2 - y1) * 12 + (m2 - m1);
  const months = Math.max(1, whole + (d2 > d1 ? 1 : 0));
  const rate = kind === 'late_deposit' ? 1.5 : 1;
  return { months, rate, interest: r2((n(o.tds) * rate * months) / 100), overdue: true };
}

/** The quarter of a financial year a date falls in ('2026-27', 'Q3'), and its start and end dates. */
export function tdsQuarter(date: string) {
  const [y, m] = String(date).slice(0, 10).split('-').map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const q = m >= 4 && m <= 6 ? 'Q1' : m >= 7 && m <= 9 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4';
  const ranges = {
    Q1: ['04-01', '06-30'],
    Q2: ['07-01', '09-30'],
    Q3: ['10-01', '12-31'],
    Q4: ['01-01', '03-31'],
  } as const;
  const year = q === 'Q4' ? fyStart + 1 : fyStart;
  return {
    fy: `${fyStart}-${String(fyStart + 1).slice(-2)}`,
    q,
    from: `${year}-${ranges[q][0]}`,
    to: `${year}-${ranges[q][1]}`,
  };
}
