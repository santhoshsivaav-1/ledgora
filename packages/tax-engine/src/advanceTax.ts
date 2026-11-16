// R2.4 (docs/FEATURE_GAPS_2026-11.md): advance tax for the year in progress. Projects the year's tax from the books so far,
// lays out the four instalments (one on 15 March for 44AD / 44ADA filers), says what each date needed and how much has
// been paid on challans, and what to pay now. The interest rules (234B, 234C) are itr.ts's; this adds the dating of
// challans and the view of the year.

import { fyBounds } from './fiscal.ts';
import { compute234CInterest, compute44AD, compute44ADA, computeTax } from './itr.ts';
import { advanceTaxSchedule, ageAtFyEnd, type AdvanceTaxPlan } from './itr4.ts';
import { itrRulesFor } from './itrRules.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: unknown) => Number(v) || 0;

export interface Challan {
  /** BSR code of the bank branch (7 characters) and the serial number on the challan. */
  bsr: string;
  serial: number;
  /** Date of deposit, YYYY-MM-DD. */
  date: string;
  amount: number;
}

/**
 * What a challan is for, from its date (the department's rules 133 and 134): tax paid by 31 March of the year is advance
 * tax, after it self-assessment tax, and a challan dated before the year began belongs to an earlier year.
 */
export function challanKind(
  date: string,
  fy: string,
): 'advance' | 'self_assessment' | 'earlier_year' {
  const { start, end } = fyBounds(fy);
  if (date < start) return 'earlier_year';
  return date <= end ? 'advance' : 'self_assessment';
}

export interface AdvanceTaxInput {
  fy: string;
  regime: 'new' | 'old';
  /** For the senior-citizen slabs of the old regime. */
  dob: string;
  /** The business's receipts for the whole year (projected from the books so far), and the scheme. */
  business?: { section: '44AD' | '44ADA'; digitalReceipts: number; cashReceipts: number };
  salary?: number;
  otherIncome?: number;
  /** TDS and TCS the year is expected to bring (deducted by customers, employers, banks). */
  tdsExpected: number;
  challans: Challan[];
  /** Today. */
  asOf: string;
}

export interface AdvanceTaxRow {
  installment: number;
  dueDate: string;
  label: string;
  /** Cumulative share of the year's tax due by this date. */
  cumulativePct: number;
  /** What this instalment adds, and what must have been paid by then in all. */
  installmentDue: number;
  cumulativeDue: number;
  paidByDate: number;
  shortfall: number;
  status: 'paid' | 'upcoming' | 'overdue';
}

export interface AdvanceTaxView {
  fy: string;
  applies: boolean;
  /** Tax liability of the year (with cess) from the projection, and after TDS and TCS. */
  projectedTax: number;
  netLiability: number;
  note: string | null;
  mode: 'regular' | 'presumptive';
  paidAdvance: number;
  paidAfterYear: number;
  rows: AdvanceTaxRow[];
  /** The amount that brings the payments up to everything due by today. */
  payNow: number;
  /** The next instalment not yet reached, with what is due by then in all. */
  next: { dueDate: string; label: string; cumulativeDue: number; topUp: number } | null;
  /** Interest if nothing more is paid: 234C on the missed instalments, and 234B per month when under 90% by 31 March. */
  interest234C: number;
  interest234B: { applies: boolean; shortfall: number; perMonth: number };
  /** Challans dated before the year began (they are not advance tax for this year). */
  ignored: Challan[];
}

/** Tax of the year on the projected income, both regimes' slabs through itr.ts's computeTax. */
export function projectTax(
  input: Pick<AdvanceTaxInput, 'fy' | 'regime' | 'dob' | 'business' | 'salary' | 'otherIncome'>,
) {
  let businessIncome = 0;
  if (input.business) {
    const calc = (input.business.section === '44AD' ? compute44AD : compute44ADA)({
      digitalReceipts: input.business.digitalReceipts,
      cashReceipts: input.business.cashReceipts,
      declaredIncome: undefined,
    });
    businessIncome = n(calc.presumptiveIncome);
  }
  const t = computeTax({
    salary: n(input.salary),
    businessIncome,
    otherSources: n(input.otherIncome),
    regime: input.regime,
    fy: input.fy,
    age: ageAtFyEnd(input.dob, input.fy),
  }) as { totalTax: number; taxableIncome: number };
  return { totalTax: r2(t.totalTax), taxableIncome: r2(t.taxableIncome), businessIncome };
}

export function planAdvanceTax(input: AdvanceTaxInput): AdvanceTaxView {
  itrRulesFor(input.fy); // refuses a year with no rules
  const projected = projectTax(input);
  const advance = input.challans.filter((c) => challanKind(c.date, input.fy) === 'advance');
  const after = input.challans.filter((c) => challanKind(c.date, input.fy) === 'self_assessment');
  const ignored = input.challans.filter((c) => challanKind(c.date, input.fy) === 'earlier_year');
  const mode = input.business ? 'presumptive' : 'regular';
  const plan: AdvanceTaxPlan = advanceTaxSchedule(
    projected.totalTax,
    n(input.tdsExpected),
    advance.map((c) => ({ date: c.date, amount: n(c.amount) })),
    mode,
    input.fy,
  );
  const paidAdvance = r2(advance.reduce((s, c) => s + n(c.amount), 0));
  const paidAfterYear = r2(after.reduce((s, c) => s + n(c.amount), 0));
  const base = {
    fy: input.fy,
    projectedTax: projected.totalTax,
    mode,
    paidAdvance,
    paidAfterYear,
    ignored,
  } as const;
  if (!plan.applies) {
    return {
      ...base,
      applies: false,
      netLiability: plan.netLiability,
      note: plan.note ?? null,
      rows: [],
      payNow: 0,
      next: null,
      interest234C: 0,
      interest234B: { applies: false, shortfall: 0, perMonth: 0 },
    };
  }
  const rows: AdvanceTaxRow[] = plan.schedule.map((s) => {
    const paidByDate = n(s.totalPaidByDue);
    const shortfall = Math.max(0, n(s.cumulativeDue) - paidByDate);
    return {
      installment: s.installment,
      dueDate: s.dueDate,
      label: s.label,
      cumulativePct: s.cumulativePct,
      installmentDue: n(s.installmentDue),
      cumulativeDue: n(s.cumulativeDue),
      paidByDate: r2(paidByDate),
      shortfall: r2(shortfall),
      status: shortfall <= 0 ? 'paid' : input.asOf > s.dueDate ? 'overdue' : 'upcoming',
    };
  });
  // What is due by today: the cumulative figure of the last instalment whose date has passed.
  const passed = rows.filter((r) => r.dueDate <= input.asOf);
  const dueToday = passed.length ? passed[passed.length - 1]!.cumulativeDue : 0;
  const payNow = r2(Math.max(0, dueToday - paidAdvance));
  const upcoming = rows.find((r) => r.dueDate > input.asOf);
  const next = upcoming
    ? {
        dueDate: upcoming.dueDate,
        label: upcoming.label,
        cumulativeDue: upcoming.cumulativeDue,
        topUp: r2(Math.max(0, upcoming.cumulativeDue - paidAdvance)),
      }
    : null;
  // 234B: under 90% of the assessed tax by 31 March; interest is 1% a month on the shortfall, in ₹100s (rule 119A).
  const assessed = plan.netLiability;
  const shortfallB =
    assessed > 0 && paidAdvance < 0.9 * assessed
      ? Math.floor((assessed - paidAdvance) / 100) * 100
      : 0;
  return {
    ...base,
    applies: true,
    netLiability: plan.netLiability,
    note: null,
    rows,
    payNow,
    next,
    interest234C: r2(
      compute234CInterest({
        ...plan,
        schedule: plan.schedule.filter((s) => s.dueDate <= input.asOf),
      } as AdvanceTaxPlan),
    ),
    interest234B: {
      applies: shortfallB > 0,
      shortfall: shortfallB,
      perMonth: r2(shortfallB * 0.01),
    },
  };
}

/** The year's four dates with what they are for, to show in the register before any projection exists. */
export const advanceTaxDates = (fy: string) =>
  itrRulesFor(fy).advanceTax.map((a) => ({
    installment: a.installment,
    dueDate: a.dueDate,
    label: a.label,
    cumulativePct: a.cumulativePct,
  }));
