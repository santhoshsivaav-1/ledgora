// Vyapar parity P5-S5: loan maths. Pure functions: the EMI, the repayment schedule, and what a payment does to it
// (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P5-S5). The API stores the schedule this returns and posts the payments
// (posting.ts postLoanPayment); nothing here touches a database.
//
// The schedule of a loan is always `scheduleFor(loan, payments)`: the original schedule with every payment applied in
// date order. Editing or deleting a payment is therefore just running it again.

import type { Numeric } from './types.ts';
import { r2 } from './money.ts';

export type InterestType = 'reducing' | 'flat';
/** emi, part and prepay pay the loan; topup is more money borrowed on it ("Increase Loan"). */
export type LoanPaymentKind = 'emi' | 'part' | 'prepay' | 'topup';
/** After a part payment, keep the EMI and finish sooner ('tenure'), or keep the end date and pay less ('emi'). */
export type Reschedule = 'tenure' | 'emi';

export interface LoanTerms {
  principal: Numeric;
  ratePct: Numeric;
  months: number;
  type?: InterestType;
  /** The instalment, when the lender's figure differs from the formula (the form lets the owner edit it). */
  emi?: Numeric;
  firstEmiDate: string;
}

export interface ScheduleRow {
  n: number;
  dueDate: string;
  emi: number;
  principalPart: number;
  interestPart: number;
  balanceAfter: number;
  status: 'due' | 'paid' | 'part';
  paidOn: string | null;
  paidPrincipal: number;
  paidInterest: number;
}

export interface LoanPaymentIn {
  date: string;
  kind: LoanPaymentKind;
  principal: Numeric;
  interest?: Numeric;
  /** How the rest is rescheduled after a part payment or prepayment. Default 'tenure'. */
  reschedule?: Reschedule;
}

export class LoanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoanError';
  }
}

const n = (v: Numeric) => Number(v) || 0;
const EPS = 0.005;
const MAX_MONTHS = 600;

/**
 * The monthly instalment. Reducing balance: P·r·(1+r)^n / ((1+r)^n − 1) with r = rate/12/100 (P/n at 0%). Flat:
 * (P + P·rate·years/100) / months. Rounded to the paisa.
 */
export function emi(o: {
  principal: Numeric;
  ratePct: Numeric;
  months: number;
  type?: InterestType;
}) {
  const p = n(o.principal);
  const months = Math.floor(o.months);
  if (!(p > 0) || !(months > 0)) return 0;
  const rate = n(o.ratePct);
  if (o.type === 'flat') return r2((p + (p * rate * (months / 12)) / 100) / months);
  const r = rate / 12 / 100;
  if (r === 0) return r2(p / months);
  const f = (1 + r) ** months;
  return r2((p * r * f) / (f - 1));
}

/** 'YYYY-MM-DD' plus `k` months, keeping the day of the month where it exists (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, k: number) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + k;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const row = (
  i: number,
  dueDate: string,
  principalPart: number,
  interestPart: number,
  balanceAfter: number,
): ScheduleRow => ({
  n: i,
  dueDate,
  emi: r2(principalPart + interestPart),
  principalPart: r2(principalPart),
  interestPart: r2(interestPart),
  balanceAfter: r2(balanceAfter),
  status: 'due',
  paidOn: null,
  paidPrincipal: 0,
  paidInterest: 0,
});

/**
 * Rows for `principal` repaid over `months` from `firstEmiDate`, numbered from `startN`. Every split is rounded to the
 * paisa and the last row absorbs the rounding, so Σ principal is exactly the principal. A reducing loan with an EMI
 * given (not the formula's) stops early when it is paid off, or ends with a bigger last row when the EMI is too small.
 */
function rows(o: LoanTerms, startN = 1): ScheduleRow[] {
  const p = r2(n(o.principal));
  const months = Math.floor(o.months);
  if (!(p > 0)) return [];
  if (!(months > 0) || months > MAX_MONTHS)
    throw new LoanError(`Tenure must be 1 to ${MAX_MONTHS} months`);
  const rate = n(o.ratePct);
  if (rate < 0) throw new LoanError('The interest rate can not be negative');
  const out: ScheduleRow[] = [];
  if (o.type === 'flat') {
    const interest = r2((p * rate * (months / 12)) / 100);
    const pi = r2(interest / months);
    const pp = r2(p / months);
    let bal = p;
    for (let i = 0; i < months; i++) {
      const last = i === months - 1;
      const princ = last ? bal : pp;
      const int = last ? r2(interest - pi * (months - 1)) : pi;
      bal = r2(bal - princ);
      out.push(row(startN + i, addMonths(o.firstEmiDate, i), princ, int, bal));
    }
    return out;
  }
  const r = rate / 12 / 100;
  const inst = o.emi != null && n(o.emi) > 0 ? r2(n(o.emi)) : emi({ ...o, type: 'reducing' });
  if (inst <= r2(p * r))
    throw new LoanError('The EMI does not even cover the first month’s interest');
  let bal = p;
  for (let i = 0; i < months && bal > EPS; i++) {
    const int = r2(bal * r);
    const last = i === months - 1 || inst - int >= bal - EPS;
    const princ = last ? bal : r2(inst - int);
    bal = r2(bal - princ);
    out.push(row(startN + i, addMonths(o.firstEmiDate, i), princ, int, bal));
  }
  return out;
}

/** The repayment schedule of a new loan. */
export const buildSchedule = (loan: LoanTerms) => rows(loan);

/** Interest the whole schedule charges. */
export const totalInterest = (s: ScheduleRow[]) => r2(s.reduce((t, x) => t + x.interestPart, 0));

/** Principal still owed after the paid part of a schedule. */
export const outstandingOf = (principal: Numeric, s: ScheduleRow[], prepaid: Numeric = 0) =>
  r2(n(principal) - s.reduce((t, x) => t + x.paidPrincipal, 0) - n(prepaid));

/** The smallest number of months at which this balance's instalment is no more than `inst`. */
function monthsFor(balance: number, ratePct: number, inst: number, type: InterestType) {
  for (let m = 1; m <= MAX_MONTHS; m++)
    if (emi({ principal: balance, ratePct, months: m, type }) <= inst + EPS) return m;
  return MAX_MONTHS;
}

/**
 * Applies one payment to a schedule and returns the new schedule.
 * - `emi`: pays the first row not yet fully paid (status `paid`, or `part` when less than its principal came in).
 * - `part` / `prepay`: money off the principal outside the instalments.
 * - `topup`: more principal borrowed on the same loan (a negative prepayment).
 * Whenever the principal still owed no longer matches what the schedule expects, the unpaid rows are rebuilt from it:
 * same EMI and fewer months (`reschedule: 'tenure'`, the default) or the same months and a smaller EMI ('emi').
 * Paid rows never change. Σ principal over paid rows, prepayments and the rebuilt rows is always the loan's principal
 * plus its top-ups.
 */
export function applyPayment(
  loan: LoanTerms,
  schedule: ScheduleRow[],
  pay: LoanPaymentIn,
  prepaidBefore: Numeric = 0,
): { schedule: ScheduleRow[]; prepaid: number; outstanding: number; closed: boolean } {
  const principal = r2(n(pay.principal));
  const interest = r2(n(pay.interest));
  if (principal < 0 || interest < 0) throw new LoanError('Amounts can not be negative');
  let prepaid = r2(n(prepaidBefore));
  let s = schedule.map((x) => ({ ...x }));
  let expected: number;
  if (pay.kind === 'emi') {
    const i = s.findIndex((x) => x.status !== 'paid');
    if (i < 0) throw new LoanError('Every instalment is already paid');
    const x = s[i];
    x.paidPrincipal = r2(x.paidPrincipal + principal);
    x.paidInterest = r2(x.paidInterest + interest);
    x.paidOn = pay.date;
    x.status = x.paidPrincipal >= x.principalPart - EPS ? 'paid' : 'part';
    // What the schedule expected to be owed once this row is fully paid.
    expected =
      x.status === 'paid' ? x.balanceAfter : r2(x.balanceAfter + x.principalPart - x.paidPrincipal);
  } else {
    prepaid = r2(pay.kind === 'topup' ? prepaid - principal : prepaid + principal);
    const firstUnpaid = s.find((x) => x.status !== 'paid');
    expected = firstUnpaid
      ? r2(firstUnpaid.balanceAfter + firstUnpaid.principalPart - firstUnpaid.paidPrincipal)
      : 0;
  }
  const outstanding = outstandingOf(loan.principal, s, prepaid);
  if (outstanding < -EPS) throw new LoanError('This pays more than the principal still owed');
  const owed = Math.max(0, outstanding);
  if (Math.abs(owed - expected) > EPS || pay.kind !== 'emi') s = rebuild(loan, s, owed, pay);
  return { schedule: s, prepaid, outstanding: r2(owed), closed: owed <= EPS };
}

/** Keeps the paid and part-paid rows and replaces the rest with a schedule for what is still owed. */
function rebuild(loan: LoanTerms, s: ScheduleRow[], owed: number, pay: LoanPaymentIn) {
  const keepIdx = s.findIndex((x) => x.status === 'due');
  const kept = keepIdx < 0 ? s : s.slice(0, keepIdx);
  const rest = keepIdx < 0 ? [] : s.slice(keepIdx);
  // Kept rows now say what was actually paid (an over-paid EMI, a part-paid row whose rest the rebuilt rows take over),
  // so Σ principal over the schedule plus prepayments stays the loan's principal.
  const partRow = kept.find((x) => x.status === 'part');
  for (const x of kept) {
    x.principalPart = x.paidPrincipal;
    x.interestPart = x.paidInterest;
    x.emi = r2(x.paidPrincipal + x.paidInterest);
    x.status = 'paid';
  }
  const last = kept.at(-1);
  if (last) last.balanceAfter = r2(owed);
  const topup = pay.kind === 'topup';
  if (owed <= EPS || (!rest.length && !partRow && !topup)) return kept;
  const type = loan.type ?? 'reducing';
  const rate = n(loan.ratePct);
  const remaining = Math.max(1, rest.length);
  const oldInst = rest[0]?.emi ?? emi({ ...loan, type });
  // Keep the EMI (finish sooner, or later for a top-up) unless asked to keep the end date and there is one to keep.
  const keepEmi = (pay.reschedule ?? 'tenure') !== 'emi' || !rest.length;
  const fit = monthsFor(owed, rate, oldInst, type);
  const months = keepEmi ? (topup ? fit : Math.min(remaining, fit)) : remaining;
  const startN = (last?.n ?? 0) + 1;
  const firstDate = rest[0]?.dueDate ?? addMonths(last?.dueDate ?? loan.firstEmiDate, 1);
  return [
    ...kept,
    ...rows({ principal: owed, ratePct: rate, months, type, firstEmiDate: firstDate }, startN),
  ];
}

/** The schedule after every payment of a loan, oldest first, and what is still owed. */
export function scheduleFor(loan: LoanTerms, payments: LoanPaymentIn[]) {
  let s = buildSchedule(loan);
  let prepaid = 0;
  let outstanding = r2(n(loan.principal));
  let closed = outstanding <= EPS;
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  for (const p of sorted) {
    const r = applyPayment(loan, s, p, prepaid);
    s = r.schedule;
    prepaid = r.prepaid;
    outstanding = r.outstanding;
    closed = r.closed;
  }
  return { schedule: s, prepaid, outstanding, closed };
}

/** The next instalment still due (what "Make Payment → EMI" prefills), or null when the loan is paid off. */
export function nextDue(s: ScheduleRow[]) {
  const x = s.find((r) => r.status !== 'paid');
  if (!x) return null;
  return {
    n: x.n,
    dueDate: x.dueDate,
    principal: r2(x.principalPart - x.paidPrincipal),
    interest: r2(Math.max(0, x.interestPart - x.paidInterest)),
  };
}

/** Instalments due on or before `today + days` and not yet paid. */
export const emisDueWithin = (s: ScheduleRow[], today: string, days: number) => {
  const until = new Date(`${today}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + days);
  const limit = until.toISOString().slice(0, 10);
  return s.filter((r) => r.status !== 'paid' && r.dueDate <= limit);
};
