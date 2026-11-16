// R2.1 (docs/FEATURE_GAPS_2026-11.md): income-tax rules by year. The Income-tax Act 1961 governs returns for AY 2026-27
// (income of FY 2025-26); the Income-tax Act 2025 governs Tax Year 2026-27 onward. One pack per year says which slabs,
// rebate, deductions, due dates and ITR schema apply, so a screen or a file never mixes two years' rules.
//
// Every fact carries how sure we are of it: `official` (read from the department's published schema, rules or notified
// form), `multi-source` (several independent secondary sources agree), `single-source` (one secondary source: check it).

import {
  getAdvanceTaxSchedule,
  getCapitalGainsConfig,
  getNewRegimeSlabs,
  get87AConfig,
  standardDeduction,
} from './itr.ts';

export type ItrAct = '1961' | '2025';
export type Confidence = 'official' | 'multi-source' | 'single-source';

export interface ItrYearRules {
  /** Financial year of the income, '2025-26'. */
  fy: string;
  /** Assessment year, '2026-27' (for Tax Year 2026-27 under the 2025 Act this is the same period, no longer used). */
  ay: string;
  act: ItrAct;
  /** How the year is named on the portal: "AY 2026-27" or "Tax Year 2026-27". */
  label: string;
  newRegimeSlabs: { upto: number; rate: number }[];
  rebate87A: { new: { threshold: number; cap: number }; old: { threshold: number; cap: number } };
  standardDeduction: { new: number; old: number };
  capitalGains: ReturnType<typeof getCapitalGainsConfig>;
  /** The four advance-tax instalments (cumulative share of the year's tax). */
  advanceTax: { installment: number; dueDate: string; cumulativePct: number; label: string }[];
  /** Advance tax is due only when the tax after TDS is at least this much (section 208 of the 1961 Act). */
  advanceTaxMinimum: number;
  /** Last date for the ITR-4 (individual, no audit) without a late fee; the department may extend it. */
  itr4DueDate: string;
  /** Last date for a belated or revised return, when known. */
  belatedDueDate: string | null;
  /** Late fee for a return filed after the due date (section 234F of the 1961 Act). */
  lateFee: { amount: number; reducedAmount: number; reducedUpToIncome: number };
  /** The schema folder entry the ITR-4 file is checked against (schemas/itr4/AY<ay>.json), null while unpublished. */
  itr4SchemaAy: string | null;
  /** Presumptive schemes (44AD, 44ADA): ceilings and rates. */
  presumptive: {
    ad: { limit: number; limitMostlyDigital: number; digitalRate: number; otherRate: number };
    ada: { limit: number; limitMostlyDigital: number; rate: number };
    /** Cash may be at most this share of receipts for the higher ceilings. */
    cashShare: number;
  };
  /** ITR-4 is for total income up to this (excluding long-term gains under 112A, up to ₹1.25 lakh, taxed separately). */
  itr4IncomeLimit: number;
  confidence: Record<string, Confidence>;
  notes: string[];
}

const LATE_FEE = { amount: 5000, reducedAmount: 1000, reducedUpToIncome: 500_000 };
const PRESUMPTIVE = {
  ad: { limit: 20_000_000, limitMostlyDigital: 30_000_000, digitalRate: 0.06, otherRate: 0.08 },
  ada: { limit: 5_000_000, limitMostlyDigital: 7_500_000, rate: 0.5 },
  cashShare: 0.05,
};

const base = (fy: string) => ({
  newRegimeSlabs: getNewRegimeSlabs(fy),
  rebate87A: { new: get87AConfig('new', fy), old: get87AConfig('old', fy) },
  standardDeduction: { new: standardDeduction('new'), old: standardDeduction('old') },
  capitalGains: getCapitalGainsConfig(fy),
  advanceTax: getAdvanceTaxSchedule(fy),
  advanceTaxMinimum: 10_000,
  lateFee: LATE_FEE,
  presumptive: PRESUMPTIVE,
  itr4IncomeLimit: 5_000_000,
});

const YEARS: Record<string, ItrYearRules> = {
  '2025-26': {
    fy: '2025-26',
    ay: '2026-27',
    act: '1961',
    label: 'AY 2026-27 (income of FY 2025-26)',
    ...base('2025-26'),
    // The ITR-4 JSON schema of the year pins the due date: ItrFilingDueDate = 2026-08-31 (extended from 31 July).
    itr4DueDate: '2026-08-31',
    belatedDueDate: '2026-12-31',
    itr4SchemaAy: '2026-27',
    confidence: {
      slabs: 'official',
      rebate: 'official',
      standardDeduction: 'official',
      itr4DueDate: 'official',
      belatedDueDate: 'multi-source',
      lateFee: 'multi-source',
      presumptive: 'official',
    },
    notes: [
      'Returns for this year still use the Income-tax Act, 1961 sections and the 1961-Act ITR forms.',
      'Slabs, rebate and standard deduction are those in the department’s ITR-4 validation rules for AY 2026-27 (new regime: rebate up to ₹60,000 for income up to ₹12 lakh, standard deduction ₹75,000; old regime: ₹12,500 up to ₹5 lakh, ₹50,000).',
    ],
  },
  '2026-27': {
    fy: '2026-27',
    ay: '2027-28',
    act: '2025',
    label: 'Tax Year 2026-27',
    ...base('2026-27'),
    // Statutory default; the department often extends it, and the Act's own text decides the belated window.
    itr4DueDate: '2027-07-31',
    belatedDueDate: null,
    itr4SchemaAy: null,
    confidence: {
      slabs: 'single-source',
      rebate: 'single-source',
      standardDeduction: 'single-source',
      itr4DueDate: 'single-source',
      belatedDueDate: 'single-source',
      lateFee: 'single-source',
      presumptive: 'multi-source',
    },
    notes: [
      'Tax Year 2026-27 is governed by the Income-tax Act, 2025 (in force from 1 April 2026), which renumbers the sections; see `sectionRef`.',
      'The slabs, rebate and standard deduction are the same as for FY 2025-26 according to coverage of Budget 2026; confirm against the Budget document and the Act before relying on them.',
      'The ITR-4 JSON schema for this year is not published yet, so no return file can be built; income and advance tax can be planned.',
    ],
  },
};

/** The years the rules cover. */
export const ITR_RULE_YEARS = Object.keys(YEARS);

/** Rules for a financial year ('2025-26'); throws for a year the app has no rules for. */
export function itrRulesFor(fy: string): ItrYearRules {
  const r = YEARS[fy];
  if (!r)
    throw new Error(`No income-tax rules for FY ${fy}. Supported: ${ITR_RULE_YEARS.join(', ')}`);
  return r;
}

/** Late fee under section 234F for a return filed on `filedOn` (0 when filed in time). */
export function lateFee234F(rules: ItrYearRules, filedOn: string, totalIncome: number) {
  if (filedOn <= rules.itr4DueDate) return 0;
  return totalIncome <= rules.lateFee.reducedUpToIncome
    ? rules.lateFee.reducedAmount
    : rules.lateFee.amount;
}

/** Section numbers: the 1961 Act section, the 2025 Act section, and how sure we are of the mapping. */
export const SECTION_MAP: readonly {
  old: string;
  new: string;
  what: string;
  confidence: Confidence;
}[] = [
  { old: '87A', new: '156', what: 'Rebate for small taxpayers', confidence: 'multi-source' },
  { old: '115BAC', new: '202', what: 'Default (new) tax regime', confidence: 'multi-source' },
  { old: '44AB', new: '63', what: 'Tax audit', confidence: 'multi-source' },
  { old: '44AD/44ADA/44AE', new: '58', what: 'Presumptive taxation', confidence: 'single-source' },
  { old: '234A', new: '423', what: 'Interest for late filing', confidence: 'single-source' },
  { old: '234B', new: '424', what: 'Interest for short advance tax', confidence: 'single-source' },
  {
    old: '234C',
    new: '425',
    what: 'Interest for deferred advance tax',
    confidence: 'single-source',
  },
  { old: '234F', new: '428', what: 'Fee for a late return', confidence: 'single-source' },
];

/** "87A" → "Section 87A (Income-tax Act 2025: section 156)" for the year's act. Unknown sections come back unchanged. */
export function sectionRef(oldSection: string, rules: ItrYearRules) {
  const row = SECTION_MAP.find((s) => s.old === oldSection);
  if (rules.act === '1961' || !row) return `Section ${oldSection}`;
  return `Section ${oldSection} of the 1961 Act (section ${row.new} of the 2025 Act${row.confidence === 'single-source' ? ', unconfirmed' : ''})`;
}
