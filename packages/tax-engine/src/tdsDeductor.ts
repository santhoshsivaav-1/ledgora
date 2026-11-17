// R3 (docs/FEATURE_GAPS_2026-11.md): the deductor's side of TDS: how much to deduct on a payment (threshold per payment and per year,
// the higher rate when PAN is missing), what a late statement costs, and the quarter's register. Pure, so the API and the browser
// agree. Rates and thresholds are those in force from 1 April 2025 (Finance Act 2025); they are data in DEDUCTOR_SECTIONS so a Budget
// change is one edit. The Income-tax Act 2025 renumbers the sections from 1 April 2026; the rates and limits here are unchanged.
// Check any figure with your CA before relying on it for a return.

import { tdsDueDate, tdsInterest } from './compliance.ts';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DeductorSection {
  code: string;
  label: string;
  /** Rate when the payee is an individual or HUF, and for everyone else. */
  rateIndividual: number;
  rateOther: number;
  /** TDS applies to a single payment at or above this (0 = none). */
  singleThreshold: number;
  /** ... or once the year's payments to the same payee pass this (0 = none). Deduction then covers the whole year to date. */
  annualThreshold: number;
}

export const DEDUCTOR_SECTIONS: readonly DeductorSection[] = [
  {
    code: '194C',
    label: '194C Contractor / sub-contractor',
    rateIndividual: 1,
    rateOther: 2,
    singleThreshold: 30000,
    annualThreshold: 100000,
  },
  {
    code: '194J',
    label: '194J Professional fees',
    rateIndividual: 10,
    rateOther: 10,
    singleThreshold: 0,
    annualThreshold: 50000,
  },
  {
    code: '194J-tech',
    label: '194J Technical services, call centre',
    rateIndividual: 2,
    rateOther: 2,
    singleThreshold: 0,
    annualThreshold: 50000,
  },
  {
    code: '194I-pm',
    label: '194I(a) Rent of plant and machinery',
    rateIndividual: 2,
    rateOther: 2,
    singleThreshold: 0,
    annualThreshold: 600000,
  },
  {
    code: '194I',
    label: '194I(b) Rent of land, building, furniture',
    rateIndividual: 10,
    rateOther: 10,
    singleThreshold: 0,
    annualThreshold: 600000,
  },
  {
    code: '194H',
    label: '194H Commission or brokerage',
    rateIndividual: 2,
    rateOther: 2,
    singleThreshold: 0,
    annualThreshold: 20000,
  },
  {
    code: '194A',
    label: '194A Interest other than on securities',
    rateIndividual: 10,
    rateOther: 10,
    singleThreshold: 0,
    annualThreshold: 10000,
  },
  {
    code: '194Q',
    label: '194Q Purchase of goods (above 50 lakh a year)',
    rateIndividual: 0.1,
    rateOther: 0.1,
    singleThreshold: 0,
    annualThreshold: 5000000,
  },
  {
    code: '194R',
    label: '194R Benefit or perquisite in business',
    rateIndividual: 10,
    rateOther: 10,
    singleThreshold: 0,
    annualThreshold: 20000,
  },
  {
    code: '194T',
    label: '194T Payments to partners (salary, interest, commission)',
    rateIndividual: 10,
    rateOther: 10,
    singleThreshold: 0,
    annualThreshold: 20000,
  },
];

export const sectionOf = (code: string) => DEDUCTOR_SECTIONS.find((s) => s.code === code);

/** A PAN is five letters, four digits and a letter; the fourth letter says what kind of holder it is (P = individual). */
export const validPan = (pan: string) =>
  /^[A-Z]{5}\d{4}[A-Z]$/.test(
    String(pan || '')
      .trim()
      .toUpperCase(),
  );
export const panHolderKind = (pan: string): 'individual' | 'other' | 'unknown' => {
  if (!validPan(pan)) return 'unknown';
  const c = pan.trim().toUpperCase()[3];
  return c === 'P' || c === 'H' ? 'individual' : 'other'; // P person, H Hindu undivided family
};

export interface DeductionAsk {
  section: string;
  /** What is being paid or credited now, before GST if shown separately on the invoice. */
  amount: number;
  /** What was paid to the same payee under this section earlier in the same financial year. */
  paidBefore: number;
  /** TDS already deducted from those earlier payments. */
  deductedBefore: number;
  pan: string;
  /** A lower-deduction certificate (section 197): its rate, used instead of the section's, if the PAN is valid. */
  lowerRate?: number | null;
}

export interface Deduction {
  deduct: boolean;
  rate: number;
  base: number;
  tds: number;
  reason: string;
  panMissing: boolean;
  /** Year-to-date payments including this one. */
  paidToDate: number;
}

/**
 * What to deduct on this payment. An annual limit means nothing is deducted until the year's payments pass it, and then TDS is
 * deducted on the whole year to date (less what was already deducted), as the law expects. A single-payment limit alone makes a
 * payment below it free of TDS unless the year's total passes the annual one (194C has both). Without a valid PAN the rate is the
 * higher of the section's and 20% (section 206AA).
 */
export function tdsToDeduct(a: DeductionAsk): Deduction {
  const s = sectionOf(a.section);
  if (!s)
    return {
      deduct: false,
      rate: 0,
      base: 0,
      tds: 0,
      reason: 'Unknown section',
      panMissing: false,
      paidToDate: r2(a.paidBefore + a.amount),
    };
  const paidToDate = r2(a.paidBefore + a.amount);
  const panOk = validPan(a.pan);
  const kind = panHolderKind(a.pan);
  const sectionRate = kind === 'individual' ? s.rateIndividual : s.rateOther;
  const rate = !panOk
    ? Math.max(sectionRate, 20)
    : a.lowerRate != null && a.lowerRate >= 0
      ? a.lowerRate
      : sectionRate;
  const single = s.singleThreshold > 0 && a.amount > s.singleThreshold;
  const annual = s.annualThreshold > 0 && paidToDate > s.annualThreshold;
  const panMissing = !panOk;
  if (!single && !annual) {
    const why = s.annualThreshold
      ? `Year to date ${paidToDate} is within the ${s.annualThreshold} limit${s.singleThreshold ? ` and this payment is within ${s.singleThreshold}` : ''}`
      : 'Below the limit';
    return { deduct: false, rate, base: 0, tds: 0, reason: why, panMissing, paidToDate };
  }
  // With a yearly limit, what is owed is the rate on the whole year to date, less what was already deducted (so the payment that
  // crosses the limit also catches the earlier ones). With only a single-payment limit it is the rate on this payment.
  const wholeYear = s.annualThreshold > 0 && annual;
  const tds = r2(
    Math.max(0, wholeYear ? (paidToDate * rate) / 100 - a.deductedBefore : (a.amount * rate) / 100),
  );
  const base = rate > 0 ? r2((tds * 100) / rate) : a.amount;
  const reason = panMissing
    ? `No valid PAN: deducted at ${rate}% (not less than 20%)`
    : wholeYear && a.paidBefore > 0 && a.deductedBefore <= 0
      ? `The year's payments passed ${s.annualThreshold}: deducted on the whole ${paidToDate}`
      : `${rate}% of ${base}`;
  return { deduct: tds > 0, rate, base, tds, reason, panMissing, paidToDate };
}

/** First and last day of a quarter of the financial year starting in `fyStart` (2026 = FY 2026-27). */
export function quarterBounds(fyStart: number, q: 'Q1' | 'Q2' | 'Q3' | 'Q4') {
  const y = q === 'Q4' ? fyStart + 1 : fyStart;
  const r = {
    Q1: ['04-01', '06-30'],
    Q2: ['07-01', '09-30'],
    Q3: ['10-01', '12-31'],
    Q4: ['01-01', '03-31'],
  }[q];
  return { from: `${y}-${r[0]}`, to: `${y}-${r[1]}` };
}

/** The last day to file a quarter's statement: 31 July, 31 October, 31 January and 31 May. */
export function statementDueDate(fy: string, q: 'Q1' | 'Q2' | 'Q3' | 'Q4') {
  const y = Number(fy.slice(0, 4));
  return { Q1: `${y}-07-31`, Q2: `${y}-10-31`, Q3: `${y + 1}-01-31`, Q4: `${y + 1}-05-31` }[q];
}

/** Section 234E: 200 rupees a day from the due date to the day filed, never more than the TDS in the statement. */
export function statementLateFee(o: {
  dueDate: string;
  filedOn: string | null;
  asOf: string;
  tdsTotal: number;
}) {
  const end = o.filedOn || o.asOf;
  if (end <= o.dueDate) return { days: 0, fee: 0, late: false };
  const days = Math.round((Date.parse(end) - Date.parse(o.dueDate)) / 86_400_000);
  return { days, fee: r2(Math.min(days * 200, Math.max(0, o.tdsTotal))), late: true };
}

export interface RegisterEntry {
  id: string;
  partyName: string;
  pan: string;
  section: string;
  baseAmount: number;
  rate: number;
  tdsAmount: number;
  /** The date tax was deducted. */
  date: string;
  status: 'accrued' | 'deposited';
  challanNo?: string | null;
  bsrCode?: string | null;
  challanDate?: string | null;
}

export interface QuarterRegister {
  fy: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  from: string;
  to: string;
  dueDate: string;
  rows: (RegisterEntry & { dueDate: string; interest: number; flags: string[] })[];
  /** One line per payee and section, the shape of the deductee records in a statement. */
  deductees: {
    partyName: string;
    pan: string;
    section: string;
    payments: number;
    base: number;
    tds: number;
  }[];
  /** One line per challan, with the deductions it covers. */
  challans: {
    challanNo: string;
    bsrCode: string;
    challanDate: string;
    tds: number;
    entries: number;
  }[];
  totals: { base: number; tds: number; deposited: number; undeposited: number; interest: number };
  lateFee: { days: number; fee: number; late: boolean };
  /** Things to fix before the statement is prepared. */
  issues: string[];
}

/** The quarter's register from the TDS ledger rows: what to report, what is still unpaid, interest to date and the 234E exposure. */
export function quarterRegister(
  entries: RegisterEntry[],
  o: { fy: string; quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4'; asOf: string; filedOn?: string | null },
): QuarterRegister {
  const { from, to } = quarterBounds(Number(o.fy.slice(0, 4)), o.quarter);
  const inQ = entries.filter((e) => e.date >= from && e.date <= to);
  const rows = inQ.map((e) => {
    const dueDate = tdsDueDate(e.date);
    const i = tdsInterest({
      tds: e.tdsAmount,
      deductedOn: e.date,
      dueDate,
      depositedOn: e.status === 'deposited' ? e.challanDate : null,
      asOf: o.asOf,
    });
    const flags: string[] = [];
    if (!validPan(e.pan)) flags.push('PAN missing or invalid');
    if (e.status !== 'deposited')
      flags.push(i.overdue ? 'Not deposited, overdue' : 'Not deposited yet');
    else if (i.overdue) flags.push('Deposited late');
    return { ...e, dueDate, interest: i.interest, flags };
  });
  const byDeductee = new Map<string, QuarterRegister['deductees'][number]>();
  for (const r of rows) {
    const key = `${r.pan || r.partyName}|${r.section}`;
    const d = byDeductee.get(key) ?? {
      partyName: r.partyName,
      pan: r.pan,
      section: r.section,
      payments: 0,
      base: 0,
      tds: 0,
    };
    d.payments++;
    d.base = r2(d.base + r.baseAmount);
    d.tds = r2(d.tds + r.tdsAmount);
    byDeductee.set(key, d);
  }
  const byChallan = new Map<string, QuarterRegister['challans'][number]>();
  for (const r of rows) {
    if (r.status !== 'deposited' || !r.challanNo) continue;
    const key = `${r.bsrCode}|${r.challanNo}|${r.challanDate}`;
    const c = byChallan.get(key) ?? {
      challanNo: r.challanNo,
      bsrCode: r.bsrCode ?? '',
      challanDate: r.challanDate ?? '',
      tds: 0,
      entries: 0,
    };
    c.tds = r2(c.tds + r.tdsAmount);
    c.entries++;
    byChallan.set(key, c);
  }
  const sum = (
    f: (r: (typeof rows)[number]) => number,
    p: (r: (typeof rows)[number]) => boolean = () => true,
  ) => r2(rows.filter(p).reduce((s, r) => s + f(r), 0));
  const totals = {
    base: sum((r) => r.baseAmount),
    tds: sum((r) => r.tdsAmount),
    deposited: sum(
      (r) => r.tdsAmount,
      (r) => r.status === 'deposited',
    ),
    undeposited: sum(
      (r) => r.tdsAmount,
      (r) => r.status !== 'deposited',
    ),
    interest: sum((r) => r.interest),
  };
  const dueDate = statementDueDate(o.fy, o.quarter);
  const lateFee = statementLateFee({
    dueDate,
    filedOn: o.filedOn ?? null,
    asOf: o.asOf,
    tdsTotal: totals.tds,
  });
  const issues: string[] = [];
  const noPan = rows.filter((r) => !validPan(r.pan)).length;
  if (noPan)
    issues.push(
      `${noPan} deduction${noPan === 1 ? '' : 's'} without a valid PAN: the statement is rejected or corrected later; collect the PAN first.`,
    );
  if (totals.undeposited > 0)
    issues.push(
      `₹${totals.undeposited} of TDS is not deposited: a statement can only report what a challan covers.`,
    );
  if (lateFee.late)
    issues.push(
      `The statement is ${lateFee.days} days past ${dueDate}: late fee under section 234E is ₹${lateFee.fee}.`,
    );
  return {
    fy: o.fy,
    quarter: o.quarter,
    from,
    to,
    dueDate,
    rows,
    deductees: [...byDeductee.values()],
    challans: [...byChallan.values()],
    totals,
    lateFee,
    issues,
  };
}

/** The register as CSV (deductee-wise, then challan-wise), for the person who prepares the statement in the department's utility. */
export function registerCsv(r: QuarterRegister) {
  const q = (v: unknown) =>
    typeof v === 'number' ? String(v) : `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(['Deductee', 'PAN', 'Section', 'Payments', 'Amount paid', 'TDS'].map(q).join(','));
  for (const d of r.deductees)
    lines.push([d.partyName, d.pan, d.section, d.payments, d.base, d.tds].map(q).join(','));
  lines.push('');
  lines.push(['Challan no.', 'BSR code', 'Deposited on', 'TDS', 'Deductions'].map(q).join(','));
  for (const c of r.challans)
    lines.push([c.challanNo, c.bsrCode, c.challanDate, c.tds, c.entries].map(q).join(','));
  return lines.join('\n');
}
