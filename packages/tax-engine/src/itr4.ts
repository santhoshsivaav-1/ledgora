// R2.3 (docs/FEATURE_GAPS_2026-11.md): ITR-4 (Sugam) for a resident individual with presumptive business or professional
// income (44AD / 44ADA), optional salary and other-source income, in the shape of the department's published JSON schema
// (schemas/itr4/AY2026-27.json). Pure. What it does not cover (house property, capital gains, 44AE, foreign assets,
// carried-forward losses, HUF and firms) is refused with a message to use ITR-3 or the portal, never guessed.
//
// The file is checked three ways: eligibility here, the department's cross-field rules (itr4Rules.ts) and the schema
// itself (itr4Schema.ts, server only).

import type { FilingIssue } from './filing.ts';
import { gstinChecksumOk } from './gstin.ts';
import {
  compute234AInterest,
  compute234BInterest,
  compute234CInterest,
  compute44AD,
  compute44ADA,
  computeAdvanceTaxSchedule,
  computeRebate87A,
  computeSlabTax,
  getOldRegimeSlabs,
} from './itr.ts';
import { fyBounds } from './fiscal.ts';
import { itrRulesFor, lateFee234F, type ItrYearRules } from './itrRules.ts';

/** What `computeAdvanceTaxSchedule` (itr.ts, loosely typed) takes and returns, stated once. */
export interface AdvanceTaxPlan {
  applies: boolean;
  netLiability: number;
  note?: string;
  totalPaid?: number;
  paidByYearEnd?: number;
  totalOutstanding?: number;
  schedule: {
    installment: number;
    dueDate: string;
    cumulativePct: number;
    label: string;
    installmentDue?: number;
    cumulativeDue?: number;
    totalPaidByDue?: number;
    shortfall?: number;
  }[];
  mode?: 'regular' | 'presumptive';
  fy: string;
}
export const advanceTaxSchedule = computeAdvanceTaxSchedule as unknown as (
  totalTax: number,
  tdsAlreadyDeducted: number,
  paid: { date: string; amount: number }[],
  mode: 'regular' | 'presumptive',
  fy: string,
) => AdvanceTaxPlan;

const int = (v: number) => Math.round(Number(v) || 0);
const pos = (v: unknown) => Math.max(0, int(Number(v) || 0));
/**
 * The presumptive minimum of each part, rounded up so it is never below the exact percentage: the department's rules 5, 6
 * and 14 compare the declared income with 6% / 8% / 50% of the receipts, and ₹1 under on any rounding is an error.
 * Whole rupees only, so `x * 6 / 100` is exact when the percentage is a whole number.
 */
export const minimum44AD = (digital: number, cash: number) => ({
  digital: Math.ceil((pos(digital) * 6) / 100),
  cash: Math.ceil((pos(cash) * 8) / 100),
});
export const minimum44ADA = (receipts: number) => Math.ceil(pos(receipts) / 2);
/** Section 288A / 288B: to the nearest multiple of ten, five rounding up. */
export const round10 = (v: number) => Math.round(v / 10) * 10;

const issue = (
  severity: FilingIssue['severity'],
  code: string,
  message: string,
  path = '',
): FilingIssue => ({ id: path ? `${code}:${path}` : code, severity, code, message, path });

// ---- input ---------------------------------------------------------------------------------------------------------

export type EmployerCategory =
  'CGOV' | 'SGOV' | 'PSU' | 'PE' | 'PESG' | 'PEPS' | 'PEO' | 'OTH' | 'NA';
export interface Itr4Taxpayer {
  pan: string;
  firstName?: string;
  middleName?: string;
  surname: string;
  fatherName: string;
  /** YYYY-MM-DD */
  dob: string;
  residenceNo: string;
  residenceName?: string;
  roadOrStreet?: string;
  locality: string;
  city: string;
  /** Two-digit state code of the schema ('33' Tamil Nadu, '99' outside India). */
  stateCode: string;
  pinCode: string;
  mobile: string;
  email: string;
  aadhaar?: string;
  /** Salaried people say who pays them; everyone else 'NA'. */
  employerCategory: EmployerCategory;
  bankAccounts: {
    ifsc: string;
    bankName: string;
    accountNo: string;
    accountType: 'SB' | 'CA' | 'CC' | 'OD' | 'NRO' | 'OTH';
    useForRefund: boolean;
  }[];
  /** Where the return is signed. */
  place: string;
}

export interface Itr4Business {
  section: '44AD' | '44ADA';
  /** Business code (44AD) or profession code (44ADA) of the schema. */
  code: string;
  name: string;
  description?: string;
  /** Receipts through account-payee cheque, bank draft, ECS or prescribed electronic modes. */
  digitalReceipts: number;
  cashReceipts: number;
  /** A higher income than the presumptive minimum, if the person wants to declare it. */
  declaredIncome?: number;
  /** GST turnover by registration (Schedule BP: gross receipts for each GSTIN). */
  gstTurnover?: { gstin: string; amount: number }[];
  /** Balance-sheet particulars (Schedule BP, financial particulars of the business). */
  particulars?: Partial<Record<(typeof PARTICULARS)[number], number>>;
}
export const PARTICULARS = [
  'partnerMemberOwnCapital',
  'securedLoans',
  'unsecuredLoans',
  'advances',
  'sundryCreditors',
  'othrCurrLiab',
  'fixedAssets',
  'investments',
  'inventories',
  'sundryDebtors',
  'balWithBanks',
  'cashInHand',
  'loansAndAdvances',
  'otherAssets',
] as const;

export interface Itr4Deductions {
  /** 80C payments, each with the policy or document number the schedule asks for. */
  sec80C?: { id: string; amount: number }[];
  sec80CCD1B?: number;
  /** Employer's NPS contribution (both regimes). */
  sec80CCD2?: number;
  /** 80D premiums by who they cover; each premium row names the insurer and the policy. */
  sec80D?: {
    selfSenior?: boolean;
    selfPremiums?: { insurer: string; policy: string; amount: number }[];
    selfCheckup?: number;
    selfMedical?: number;
    parentsSenior?: boolean;
    parentsPremiums?: { insurer: string; policy: string; amount: number }[];
    parentsCheckup?: number;
    parentsMedical?: number;
  };
  /** Claim 80TTA (under 60) or 80TTB (60 and over) on the interest in the other-sources income. Default true. */
  claimInterestDeduction?: boolean;
}

export interface Itr4TdsRow {
  tan: string;
  name: string;
  /** TDS section code of the schema ('94C', '4H', '94J-B'). */
  section: string;
  /** What the deductor paid or credited. */
  gross: number;
  tdsDeducted: number;
  /** The part of it claimed this year. */
  tdsClaimed: number;
  headOfIncome: 'BP' | 'HP' | 'OS' | 'EI' | 'NA';
}

export interface Itr4Input {
  /** Financial year of the income, '2025-26'. */
  fy: string;
  /** The day the return will be filed (decides the late fee, 234A and the filing section). */
  filedOn: string;
  regime: 'new' | 'old';
  taxpayer: Itr4Taxpayer;
  business?: Itr4Business;
  salary?: {
    gross: number;
    basicAndDa?: number;
    professionalTax?: number;
    tds?: { tan: string; name: string; income: number; tds: number }[];
  };
  otherSources?: {
    savingsInterest?: number;
    depositInterest?: number;
    refundInterest?: number;
    /** Dividend by advance-tax period: up to 15 Jun, 15 Sep, 15 Dec, 15 Mar, 31 Mar. */
    dividend?: [number, number, number, number, number];
    other?: { description: string; amount: number }[];
  };
  deductions?: Itr4Deductions;
  tds?: Itr4TdsRow[];
  tcs?: { tan: string; name: string; tcs: number; claimed: number }[];
  /** Tax paid on challans (advance tax before 1 April after the year, self-assessment tax after). */
  challans?: { bsr: string; date: string; serial: number; amount: number }[];
  /** Old regime only: the Form 10-IEA the person filed to leave the new regime. */
  form10IEA?: { ack: string; filedOn: string };
  /**
   * What disqualifies ITR-4: any of these true and the return must be ITR-3 or entered on the portal. The screen asks
   * every one of them.
   */
  declarations: {
    houseProperty: boolean;
    capitalGains: boolean;
    foreignAssetsOrIncome: boolean;
    companyDirector: boolean;
    unlistedShares: boolean;
    carriedForwardLoss: boolean;
    agriculturalIncomeOver5000: boolean;
    section44AE: boolean;
  };
  /** Software id the department assigned (SW + 8 digits). */
  swCode?: string;
  /** The city of the intermediary shown in CreationInfo. */
  createdOn?: string;
}

// ---- computation ---------------------------------------------------------------------------------------------------

export interface Itr4Computation {
  fy: string;
  ay: string;
  regime: 'new' | 'old';
  age: number;
  senior: boolean;
  businessIncome: number;
  grossSalary: number;
  salaryDeduction16: number;
  standardDeduction: number;
  professionalTax: number;
  incomeFromSalary: number;
  incomeOtherSources: number;
  interestSavings: number;
  interestDeposits: number;
  grossTotalIncome: number;
  claimed: Record<string, number>;
  allowed: Record<string, number>;
  totalDeductions: number;
  totalIncome: number;
  taxOnTotalIncome: number;
  rebate87A: number;
  taxAfterRebate: number;
  cess: number;
  grossTaxLiability: number;
  netTaxLiability: number;
  interest234A: number;
  interest234B: number;
  interest234C: number;
  fee234F: number;
  totalTaxAndInterest: number;
  advanceTaxPaid: number;
  selfAssessmentTaxPaid: number;
  tdsTotal: number;
  tcsTotal: number;
  totalTaxesPaid: number;
  balanceTaxPayable: number;
  refundDue: number;
  returnFileSection: number;
  late: boolean;
  /** Advance tax instalments with what was paid by each date (presumptive: the single 15 March instalment). */
  advanceTaxPlan: AdvanceTaxPlan;
}

/** Age in whole years on 31 March of the financial year's end. */
export const ageAtFyEnd = (dob: string, fy: string) => {
  const end = fyBounds(fy).end;
  let age = Number(end.slice(0, 4)) - Number(dob.slice(0, 4));
  if (dob.slice(5) > end.slice(5)) age -= 1;
  return age;
};

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function computeItr4(
  input: Itr4Input,
  rules: ItrYearRules = itrRulesFor(input.fy),
): Itr4Computation {
  const { regime } = input;
  const age = ageAtFyEnd(input.taxpayer.dob, input.fy);
  const senior = age >= 60;
  const os = input.otherSources ?? {};

  // Business: presumptive income at the rules' rates; a higher declared income wins.
  let businessIncome = 0;
  if (input.business) {
    const calc = (input.business.section === '44AD' ? compute44AD : compute44ADA)({
      digitalReceipts: input.business.digitalReceipts,
      cashReceipts: input.business.cashReceipts,
      declaredIncome: input.business.declaredIncome,
    });
    // At least the sum of the parts' minimums (each rounded up), which can exceed the rounded total by a rupee.
    const floor =
      input.business.section === '44AD'
        ? minimum44AD(input.business.digitalReceipts, input.business.cashReceipts).digital +
          minimum44AD(input.business.digitalReceipts, input.business.cashReceipts).cash
        : minimum44ADA(pos(input.business.digitalReceipts) + pos(input.business.cashReceipts));
    businessIncome = Math.max(pos(calc.presumptiveIncome), floor);
  }
  // Salary: standard deduction by regime; professional tax only in the old regime (rule 195).
  const grossSalary = pos(input.salary?.gross);
  const stdCap = regime === 'new' ? rules.standardDeduction.new : rules.standardDeduction.old;
  const standardDeduction = grossSalary > 0 ? Math.min(grossSalary, stdCap) : 0;
  const professionalTax =
    regime === 'old'
      ? Math.min(pos(input.salary?.professionalTax), 5000, grossSalary - standardDeduction)
      : 0;
  const salaryDeduction16 = standardDeduction + professionalTax;
  const incomeFromSalary = Math.max(0, grossSalary - salaryDeduction16);

  const interestSavings = pos(os.savingsInterest);
  const interestDeposits = pos(os.depositInterest);
  const dividend = sum((os.dividend ?? [0, 0, 0, 0, 0]).map(pos));
  const otherOther = sum((os.other ?? []).map((o) => pos(o.amount)));
  const incomeOtherSources =
    interestSavings + interestDeposits + pos(os.refundInterest) + dividend + otherOther;

  const grossTotalIncome = businessIncome + incomeFromSalary + incomeOtherSources;

  // Chapter VI-A: both regimes allow only 80CCD(2); the old regime the claims this builder supports.
  const d = input.deductions ?? {};
  const salaryBase = pos(input.salary?.basicAndDa) || grossSalary;
  const ccd2Rate =
    regime === 'new' ||
    input.taxpayer.employerCategory === 'CGOV' ||
    input.taxpayer.employerCategory === 'SGOV'
      ? 0.14
      : 0.1;
  const claimed: Record<string, number> = {};
  const allowed: Record<string, number> = {};
  claimed['80CCD2'] = pos(d.sec80CCD2);
  allowed['80CCD2'] = grossSalary > 0 ? Math.min(claimed['80CCD2'], int(salaryBase * ccd2Rate)) : 0;
  if (regime === 'old') {
    claimed['80C'] = sum((d.sec80C ?? []).map((r) => pos(r.amount)));
    allowed['80C'] = Math.min(claimed['80C'], 150_000);
    claimed['80CCD1B'] = pos(d.sec80CCD1B);
    allowed['80CCD1B'] = Math.min(claimed['80CCD1B'], 50_000);
    const h = allow80D(d.sec80D);
    claimed['80D'] = h.claimed;
    allowed['80D'] = h.allowed;
    const wantsInterest = d.claimInterestDeduction !== false;
    claimed['80TTA'] = !senior && wantsInterest ? interestSavings : 0;
    allowed['80TTA'] = Math.min(claimed['80TTA'], 10_000);
    claimed['80TTB'] = senior && wantsInterest ? interestSavings + interestDeposits : 0;
    allowed['80TTB'] = Math.min(claimed['80TTB'], 50_000);
  }
  const totalDeductions = sum(Object.values(allowed));
  // Section 288A: total income to the nearest ten rupees.
  const totalIncome = round10(Math.max(0, grossTotalIncome - totalDeductions));

  const slabs = regime === 'new' ? rules.newRegimeSlabs : getOldRegimeSlabs(age);
  const taxOnTotalIncome = int(computeSlabTax(totalIncome, slabs));
  const rebate87A = int(computeRebate87A(totalIncome, taxOnTotalIncome, regime, input.fy));
  const taxAfterRebate = taxOnTotalIncome - rebate87A;
  const cess = int(taxAfterRebate * 0.04);
  const grossTaxLiability = taxAfterRebate + cess;
  const netTaxLiability = grossTaxLiability;

  // Taxes paid. By the department's rules 133/134 a challan dated in the year is advance tax, after 31 March self-assessment.
  const fy = { from: fyBounds(input.fy).start, to: fyBounds(input.fy).end };
  const challans = input.challans ?? [];
  const advanceTaxPaid = sum(challans.filter((c) => c.date <= fy.to).map((c) => pos(c.amount)));
  const selfAssessmentTaxPaid = sum(
    challans.filter((c) => c.date > fy.to).map((c) => pos(c.amount)),
  );
  const tdsSalary = sum((input.salary?.tds ?? []).map((t) => pos(t.tds)));
  const tdsOther = sum((input.tds ?? []).map((t) => pos(t.tdsClaimed)));
  const tdsTotal = tdsSalary + tdsOther;
  const tcsTotal = sum((input.tcs ?? []).map((t) => pos(t.claimed)));

  // Interest and fee. Presumptive taxpayers pay all advance tax by 15 March.
  const mode = input.business ? 'presumptive' : 'regular';
  const plan = advanceTaxSchedule(
    netTaxLiability,
    tdsTotal + tcsTotal,
    challans.filter((c) => c.date <= fy.to).map((c) => ({ date: c.date, amount: c.amount })),
    mode,
    input.fy,
  );
  const lastPayment = challans.length
    ? challans
        .map((c) => c.date)
        .sort()
        .at(-1)!
    : input.filedOn;
  const interest234B = int(
    compute234BInterest(plan, lastPayment > input.filedOn ? input.filedOn : lastPayment, input.fy),
  );
  const interest234C = int(compute234CInterest(plan));
  const paidBeforeFiling =
    advanceTaxPaid +
    sum(
      challans.filter((c) => c.date > fy.to && c.date <= input.filedOn).map((c) => pos(c.amount)),
    );
  const interest234A = int(
    compute234AInterest(
      netTaxLiability,
      paidBeforeFiling + tdsTotal + tcsTotal,
      input.filedOn,
      rules.itr4DueDate,
      input.fy,
    ),
  );
  const fee234F = lateFee234F(rules, input.filedOn, totalIncome);
  const totalTaxAndInterest =
    netTaxLiability + interest234A + interest234B + interest234C + fee234F;
  const totalTaxesPaid = advanceTaxPaid + tdsTotal + tcsTotal + selfAssessmentTaxPaid;
  // Section 288B: what is payable or refundable, to the nearest ten rupees.
  const difference = totalTaxAndInterest - totalTaxesPaid;
  const balanceTaxPayable = difference > 0 ? round10(difference) : 0;
  const refundDue = difference < 0 ? round10(-difference) : 0;

  const late = input.filedOn > rules.itr4DueDate;
  return {
    fy: input.fy,
    ay: rules.ay,
    regime,
    age,
    senior,
    businessIncome,
    grossSalary,
    salaryDeduction16,
    standardDeduction,
    professionalTax,
    incomeFromSalary,
    incomeOtherSources,
    interestSavings,
    interestDeposits,
    grossTotalIncome,
    claimed,
    allowed,
    totalDeductions,
    totalIncome,
    taxOnTotalIncome,
    rebate87A,
    taxAfterRebate,
    cess,
    grossTaxLiability,
    netTaxLiability,
    interest234A,
    interest234B,
    interest234C,
    fee234F,
    totalTaxAndInterest,
    advanceTaxPaid,
    selfAssessmentTaxPaid,
    tdsTotal,
    tcsTotal,
    totalTaxesPaid,
    balanceTaxPayable,
    refundDue,
    // 11: on or before the due date, 12: after it (section 139(4)), the schema's ReturnFileSec.
    returnFileSection: late ? 12 : 11,
    late,
    advanceTaxPlan: plan,
  };
}

/** Section 80D with the schedule's caps: ₹25,000 (₹50,000 senior) for self and family and the same for parents. */
function allow80D(d: Itr4Deductions['sec80D']) {
  if (!d) return { claimed: 0, allowed: 0, self: 0, parents: 0 };
  const bucket = (
    senior: boolean,
    premiums: { amount: number }[] = [],
    checkup = 0,
    medical = 0,
  ) => {
    const cap = senior ? 50_000 : 25_000;
    const premium = sum(premiums.map((p) => pos(p.amount)));
    const claim = premium + Math.min(pos(checkup), 5000) + (senior ? pos(medical) : 0);
    return { claimed: claim, allowed: Math.min(claim, cap) };
  };
  const s = bucket(!!d.selfSenior, d.selfPremiums, d.selfCheckup, d.selfMedical);
  const p = bucket(!!d.parentsSenior, d.parentsPremiums, d.parentsCheckup, d.parentsMedical);
  return {
    claimed: s.claimed + p.claimed,
    allowed: Math.min(s.allowed + p.allowed, 100_000),
    self: s.allowed,
    parents: p.allowed,
  };
}

// ---- eligibility ---------------------------------------------------------------------------------------------------

const NOT_ITR4: Record<keyof Itr4Input['declarations'], string> = {
  houseProperty:
    'Income from house property is not covered by this builder yet. Enter this return on the portal, or use ITR-3',
  capitalGains: 'Capital gains are not covered by this builder yet. Use ITR-3 or the portal',
  foreignAssetsOrIncome: 'Foreign assets or foreign income need ITR-2 or ITR-3, not ITR-4',
  companyDirector: 'A director of a company can not file ITR-4',
  unlistedShares: 'Holding unlisted equity shares means ITR-4 can not be used',
  carriedForwardLoss:
    'Brought-forward or carried-forward losses can not be reported in ITR-4: use ITR-3',
  agriculturalIncomeOver5000: 'Agricultural income above ₹5,000 can not be reported in ITR-4',
  section44AE:
    'Goods-carriage income under 44AE is not covered by this builder yet. Use the portal',
};

/** Why this return can not be built as an ITR-4 (empty when it can). */
export function itr4Eligibility(
  input: Itr4Input,
  rules: ItrYearRules = itrRulesFor(input.fy),
): FilingIssue[] {
  const out: FilingIssue[] = [];
  if (!rules.itr4SchemaAy)
    out.push(
      issue(
        'error',
        'ITR4_NO_SCHEMA',
        `The ITR-4 file format for ${rules.label} is not published yet, so no return file can be built.`,
      ),
    );
  for (const [k, text] of Object.entries(NOT_ITR4))
    if (input.declarations?.[k as keyof Itr4Input['declarations']])
      out.push(issue('error', 'ITR4_NOT_ELIGIBLE', text, k));
  if (!input.business && !input.salary && !input.otherSources)
    out.push(issue('error', 'NO_INCOME', 'There is no income to report'));
  if (!input.business)
    out.push(
      issue(
        'error',
        'ITR4_NO_BUSINESS',
        'ITR-4 is for presumptive business or professional income (44AD / 44ADA). With none, use ITR-1 or ITR-3',
      ),
    );
  const b = input.business;
  if (b) {
    const calc = (b.section === '44AD' ? compute44AD : compute44ADA)({
      digitalReceipts: b.digitalReceipts,
      cashReceipts: b.cashReceipts,
      declaredIncome: b.declaredIncome,
    });
    if (!calc.isEligible)
      out.push(
        issue(
          'error',
          'PRESUMPTIVE_LIMIT',
          `Receipts of ₹${calc.turnover} are above the ${b.section} limit of ₹${calc.threshold}: books, a tax audit and ITR-3 apply`,
          b.section,
        ),
      );
    if (b.declaredIncome !== undefined && b.declaredIncome < calc.deemedIncome)
      out.push(
        issue(
          'error',
          'BELOW_PRESUMPTIVE',
          `Income below the presumptive minimum of ₹${calc.deemedIncome}: books and ITR-3 apply`,
          b.section,
        ),
      );
    // The department compares the receipts declared with the turnover in the GST returns of the same PAN.
    const gstTotal = (b.gstTurnover ?? []).reduce((t, g) => t + pos(g.amount), 0);
    const declared = pos(b.digitalReceipts) + pos(b.cashReceipts);
    if (gstTotal > 0 && declared < gstTotal - Math.max(100, 0.01 * gstTotal))
      out.push(
        issue(
          'warning',
          'GST_TURNOVER_MISMATCH',
          `Receipts declared (₹${declared}) are below the turnover in your GST returns (₹${gstTotal}): the department compares them`,
          'business.gstTurnover',
        ),
      );
    if (
      b.section === '44ADA' &&
      b.digitalReceipts + b.cashReceipts > 0 &&
      !/^(1[4-9]|20)\d{3}/.test(b.code)
    )
      out.push(
        issue(
          'warning',
          'CODE_PROFESSION',
          'A professional code is expected for 44ADA',
          'business.code',
        ),
      );
  }
  return out;
}

// ---- the JSON ------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const zeroVia = () => ({
  Section80C: 0,
  Section80CCC: 0,
  Section80CCDEmployeeOrSE: 0,
  Section80CCD1B: 0,
  Section80CCDEmployer: 0,
  Section80D: 0,
  Section80DD: 0,
  Section80DDB: 0,
  Section80E: 0,
  Section80G: 0,
  Section80GG: 0,
  Section80GGC: 0,
  Section80U: 0,
  Section80TTA: 0,
  Section80TTB: 0,
  AnyOthSec80CCH: 0,
  TotalChapVIADeductions: 0,
});
const SW_DEFAULT = 'SW00000000';

/** The ITR-4 file for the schema of the year, from the input and its computation. */
export function itr4Json(
  input: Itr4Input,
  c: Itr4Computation,
  rules: ItrYearRules = itrRulesFor(input.fy),
): Json {
  const t = input.taxpayer;
  const sw = input.swCode && /^SW\d{8}$/.test(input.swCode) ? input.swCode : SW_DEFAULT;
  const accounts = t.bankAccounts.map((a) => ({
    IFSCCode: a.ifsc,
    BankName: a.bankName,
    BankAccountNo: a.accountNo,
    AccountType: a.accountType,
    UseForRefund: String(a.useForRefund),
  }));

  const via = zeroVia();
  const usr = zeroVia();
  const setVia = (key: keyof ReturnType<typeof zeroVia>, claimed: number, allowedAmt: number) => {
    usr[key] = claimed;
    via[key] = allowedAmt;
  };
  setVia('Section80CCDEmployer', c.claimed['80CCD2'] ?? 0, c.allowed['80CCD2'] ?? 0);
  setVia('Section80C', c.claimed['80C'] ?? 0, c.allowed['80C'] ?? 0);
  setVia('Section80CCD1B', c.claimed['80CCD1B'] ?? 0, c.allowed['80CCD1B'] ?? 0);
  setVia('Section80D', c.claimed['80D'] ?? 0, c.allowed['80D'] ?? 0);
  setVia('Section80TTA', c.claimed['80TTA'] ?? 0, c.allowed['80TTA'] ?? 0);
  setVia('Section80TTB', c.claimed['80TTB'] ?? 0, c.allowed['80TTB'] ?? 0);
  usr.TotalChapVIADeductions = Object.entries(usr).reduce(
    (s, [k, v]) => (k === 'TotalChapVIADeductions' ? s : s + v),
    0,
  );
  via.TotalChapVIADeductions = c.totalDeductions;

  // Other sources, one row per nature.
  const os = input.otherSources ?? {};
  const othRows: Json[] = [];
  const addOs = (nature: string, amount: number, extra: Json = {}) => {
    if (amount > 0) othRows.push({ OthSrcNatureDesc: nature, OthSrcOthAmount: amount, ...extra });
  };
  addOs('SAV', pos(os.savingsInterest));
  addOs('IFD', pos(os.depositInterest));
  addOs('TAX', pos(os.refundInterest));
  const q = (os.dividend ?? [0, 0, 0, 0, 0]).map(pos);
  addOs('DIV', sum(q), {
    DividendInc: {
      DateRange: {
        Upto15Of6: q[0],
        Upto15Of9: q[1],
        Up16Of9To15Of12: q[2],
        Up16Of12To15Of3: q[3],
        Up16Of3To31Of3: q[4],
      },
    },
  });
  for (const o of os.other ?? [])
    addOs('OTH', pos(o.amount), { OthSrcOthNatOfInc: o.description.slice(0, 125) });

  const incomeDeductions: Json = {
    IncomeFromBusinessProf: c.businessIncome,
    GrossSalary: c.grossSalary,
    ...(c.grossSalary > 0 ? { Salary: c.grossSalary } : {}),
    AllwncExemptUs10: { TotalAllwncExemptUs10: 0 },
    NetSalary: c.grossSalary,
    DeductionUs16: c.salaryDeduction16,
    ...(c.standardDeduction > 0 ? { DeductionUs16ia: c.standardDeduction } : {}),
    ...(c.professionalTax > 0 ? { ProfessionalTaxUs16iii: c.professionalTax } : {}),
    IncomeFromSal: c.incomeFromSalary,
    TotalIncomeChargeableUnHP: 0,
    IncomeOthSrc: c.incomeOtherSources,
    ...(othRows.length ? { OthersInc: { OthersIncDtlsOthSrc: othRows } } : {}),
    GrossTotIncome: c.grossTotalIncome,
    GrossTotIncomeIncLTCG112A: c.grossTotalIncome,
    UsrDeductUndChapVIA: usr,
    DeductUndChapVIA: via,
    TotalIncome: c.totalIncome,
  };

  // Schedule BP.
  const b = input.business;
  const bp: Json = {};
  if (b) {
    const digital = pos(b.digitalReceipts);
    const cash = pos(b.cashReceipts);
    const turnover = digital + cash;
    const nat = [
      {
        NameOfBusiness: b.name.slice(0, 75),
        [b.section === '44AD' ? 'CodeAD' : 'CodeADA']: b.code,
        ...(b.description ? { Description: b.description.slice(0, 75) } : {}),
      },
    ];
    if (b.section === '44AD') {
      const { digital: six, cash: eight } = minimum44AD(digital, cash);
      // A higher declared income is shown on the 6% / 8% lines in proportion to the minimums, the total being the income.
      const minimum = six + eight;
      const extra = Math.max(0, c.businessIncome - minimum);
      const sixShown = six + (minimum > 0 ? int((extra * six) / minimum) : 0);
      bp.NatOfBus44AD = nat;
      bp.PersumptiveInc44AD = {
        GrsTotalTrnOver: turnover,
        GrsTrnOverBank: digital,
        GrsTotalTrnOverInCash: cash,
        GrsTrnOverAnyOthMode: 0,
        PersumptiveInc44AD6Per: sixShown,
        PersumptiveInc44AD8Per: c.businessIncome - sixShown,
        TotPersumptiveInc44AD: c.businessIncome,
      };
    } else {
      bp.NatOfBus44ADA = nat;
      bp.PersumptiveInc44ADA = {
        GrsReceipt: turnover,
        GrsTrnOverBank44ADA: digital,
        GrsTotalTrnOverInCash44ADA: cash,
        GrsTrnOverAnyOthMode44ADA: 0,
        TotPersumptiveInc44ADA: c.businessIncome,
      };
    }
    if (b.gstTurnover?.length) {
      bp.TurnoverGrsRcptForGSTIN = b.gstTurnover.map((g) => ({
        GSTINNo: g.gstin.toUpperCase(),
        AmtTurnGrossRcptGSTIN: pos(g.amount),
      }));
      bp.TotalTurnoverGrsRcptGSTIN = sum(b.gstTurnover.map((g) => pos(g.amount)));
    }
    const p = b.particulars ?? {};
    const v = (k: (typeof PARTICULARS)[number]) => pos(p[k]);
    const liabilities =
      v('partnerMemberOwnCapital') +
      v('securedLoans') +
      v('unsecuredLoans') +
      v('advances') +
      v('sundryCreditors') +
      v('othrCurrLiab');
    const assets =
      v('fixedAssets') +
      v('investments') +
      v('inventories') +
      v('sundryDebtors') +
      v('balWithBanks') +
      v('cashInHand') +
      v('loansAndAdvances') +
      v('otherAssets');
    bp.FinanclPartclrOfBusiness = {
      PartnerMemberOwnCapital: v('partnerMemberOwnCapital'),
      SecuredLoans: v('securedLoans'),
      UnSecuredLoans: v('unsecuredLoans'),
      Advances: v('advances'),
      SundryCreditors: v('sundryCreditors'),
      OthrCurrLiab: v('othrCurrLiab'),
      TotCapLiabilities: liabilities,
      FixedAssets: v('fixedAssets'),
      Investments: v('investments'),
      Inventories: v('inventories'),
      SundryDebtors: v('sundryDebtors'),
      BalWithBanks: v('balWithBanks'),
      CashInHand: v('cashInHand'),
      LoansAndAdvances: v('loansAndAdvances'),
      OtherAssets: v('otherAssets'),
      TotalAssets: assets,
    };
  }

  const out: Json = {
    CreationInfo: {
      SWVersionNo: '1.0',
      SWCreatedBy: sw,
      JSONCreatedBy: sw,
      JSONCreationDate: input.createdOn ?? input.filedOn,
      IntermediaryCity: t.city.slice(0, 25),
      Digest: '-',
    },
    Form_ITR4: {
      FormName: 'ITR-4',
      Description: 'For presumptive business or professional income of a resident individual',
      AssessmentYear: rules.ay.slice(0, 4),
      SchemaVer: 'Ver1.0',
      FormVer: 'Ver1.0',
    },
    PersonalInfo: {
      AssesseeName: {
        ...(t.firstName ? { FirstName: t.firstName } : {}),
        ...(t.middleName ? { MiddleName: t.middleName } : {}),
        SurNameOrOrgName: t.surname,
      },
      PAN: t.pan.toUpperCase(),
      Address: {
        ResidenceNo: t.residenceNo,
        ...(t.residenceName ? { ResidenceName: t.residenceName } : {}),
        ...(t.roadOrStreet ? { RoadOrStreet: t.roadOrStreet } : {}),
        LocalityOrArea: t.locality,
        CityOrTownOrDistrict: t.city,
        StateCode: t.stateCode,
        CountryCode: '91',
        PinCode: Number(t.pinCode),
        CountryCodeMobile: 91,
        MobileNo: Number(t.mobile),
        EmailAddress: t.email,
      },
      SecondaryAdd: 'N',
      DOB: t.dob,
      EmployerCategory: t.employerCategory,
      Status: 'I',
      ...(t.aadhaar ? { AadhaarCardNo: t.aadhaar } : {}),
    },
    FilingStatus: {
      ReturnFileSec: c.returnFileSection,
      // The new regime is the default; leaving it takes Form 10-IEA (a person with business income can do so once).
      Form10IEAEarlierAYOldRegime: 'NA',
      F10IEACurrAYOldRegime: input.regime === 'old' ? 'Y' : 'N',
      ...(input.regime === 'old' && input.form10IEA
        ? {
            F10IEADateCurrAYOldTax: input.form10IEA.filedOn,
            F10IEAAckNoCurrAYOldTax: Number(input.form10IEA.ack),
          }
        : {}),
      AsseseeRepFlg: 'N',
      ItrFilingDueDate: rules.itr4DueDate,
    },
    IncomeDeductions: incomeDeductions,
    TaxComputation: {
      TotalTaxPayable: c.taxOnTotalIncome,
      Rebate87A: c.rebate87A,
      TaxPayableOnRebate: c.taxAfterRebate,
      EducationCess: c.cess,
      GrossTaxLiability: c.grossTaxLiability,
      NetTaxLiability: c.netTaxLiability,
      IntrstPay: {
        IntrstPayUs234A: c.interest234A,
        IntrstPayUs234B: c.interest234B,
        IntrstPayUs234C: c.interest234C,
        LateFilingFee234F: c.fee234F,
      },
      TotTaxPlusIntrstPay: c.totalTaxAndInterest,
    },
    TaxPaid: {
      TaxesPaid: {
        AdvanceTax: c.advanceTaxPaid,
        TDS: c.tdsTotal,
        TCS: c.tcsTotal,
        SelfAssessmentTax: c.selfAssessmentTaxPaid,
        TotalTaxesPaid: c.totalTaxesPaid,
      },
      BalTaxPayable: c.balanceTaxPayable,
    },
    Refund: { RefundDue: c.refundDue, BankAccountDtls: { AddtnlBankDetails: accounts } },
    Verification: {
      Declaration: {
        AssesseeVerName: [t.firstName, t.middleName, t.surname]
          .filter(Boolean)
          .join(' ')
          .slice(0, 125),
        FatherName: t.fatherName,
        AssesseeVerPAN: t.pan.toUpperCase(),
      },
      Capacity: 'S',
      Place: t.place,
    },
  };
  if (b) out.ScheduleBP = bp;
  if (c.claimed['80C'] && input.deductions?.sec80C?.length)
    out.Schedule80C = {
      Schedule80CDtls: input.deductions.sec80C.map((r) => ({
        IdentificationNo: r.id.slice(0, 50),
        Amount: pos(r.amount),
      })),
      TotalAmt: c.claimed['80C'],
    };
  const d80 = input.deductions?.sec80D;
  if (d80 && c.claimed['80D']) out.Schedule80D = schedule80D(d80);
  const challans = input.challans ?? [];
  if (challans.length)
    out.ScheduleIT = {
      TaxPayment: challans.map((x) => ({
        BSRCode: x.bsr,
        DateDep: x.date,
        SrlNoOfChaln: x.serial,
        Amt: pos(x.amount),
      })),
      TotalTaxPayments: sum(challans.map((x) => pos(x.amount))),
    };
  const sal = input.salary?.tds ?? [];
  if (sal.length)
    out.TDSonSalaries = {
      TDSonSalary: sal.map((s) => ({
        EmployerOrDeductorOrCollectDetl: { TAN: s.tan, EmployerOrDeductorOrCollecterName: s.name },
        IncChrgSal: pos(s.income),
        TotalTDSSal: pos(s.tds),
      })),
      TotalTDSonSalaries: sum(sal.map((s) => pos(s.tds))),
    };
  const oth = input.tds ?? [];
  if (oth.length)
    out.TDSonOthThanSals = {
      TDSonOthThanSalDtls: oth.map((r) => ({
        TANOfDeductor: r.tan,
        TDSSection: r.section,
        TDSDeducted: pos(r.tdsDeducted),
        TDSClaimed: pos(r.tdsClaimed),
        GrossAmount: pos(r.gross),
        HeadOfIncome: r.headOfIncome,
        TDSCreditCarriedFwd: Math.max(0, pos(r.tdsDeducted) - pos(r.tdsClaimed)),
      })),
      TotalTDSonOthThanSals: sum(oth.map((r) => pos(r.tdsClaimed))),
    };
  const tcs = input.tcs ?? [];
  if (tcs.length)
    out.ScheduleTCS = {
      TCS: tcs.map((x) => ({
        EmployerOrDeductorOrCollectDetl: { TAN: x.tan, EmployerOrDeductorOrCollecterName: x.name },
        Amtfrom26AS: pos(x.tcs),
        TotalTCS: pos(x.tcs),
        AmtTCSClaimedThisYear: pos(x.claimed),
      })),
      TotalSchTCS: sum(tcs.map((x) => pos(x.claimed))),
    };
  return { ITR: { ITR4: out } };
}

/** Schedule 80D: the premium rows and the eligible amounts, with the flags the schema asks for. */
function schedule80D(d: NonNullable<Itr4Deductions['sec80D']>): Json {
  const rows = (list: { insurer: string; policy: string; amount: number }[] = []) => ({
    Sch80DInsDtls: list.map((r) => ({
      InsurerName: r.insurer.slice(0, 125),
      PolicyNo: r.policy.slice(0, 75),
      HealthInsAmt: pos(r.amount),
    })),
    TotalPayments: sum(list.map((r) => pos(r.amount))),
  });
  const a = allow80D(d);
  const self: Json = { SeniorCitizenFlag: d.selfSenior ? 'Y' : 'N' };
  const premS = sum((d.selfPremiums ?? []).map((r) => pos(r.amount)));
  if (d.selfSenior) {
    Object.assign(self, {
      SelfAndFamilySeniorCitizen: Math.min(a.self, 50_000),
      HlthInsPremSlfFamSrCtzn: premS,
      ...(premS ? { Sec80DSelfFamSrCtznHIDtls: rows(d.selfPremiums) } : {}),
      PrevHlthChckUpSlfFamSrCtzn: Math.min(pos(d.selfCheckup), 5000),
      MedicalExpSlfFamSrCtzn: pos(d.selfMedical),
    });
  } else {
    Object.assign(self, {
      SelfAndFamily: Math.min(a.self, 25_000),
      HealthInsPremSlfFam: premS,
      ...(premS ? { Sec80DSelfFamHIDtls: rows(d.selfPremiums) } : {}),
      PrevHlthChckUpSlfFam: Math.min(pos(d.selfCheckup), 5000),
    });
  }
  const premP = sum((d.parentsPremiums ?? []).map((r) => pos(r.amount)));
  const parents: Json = { ParentsSeniorCitizenFlag: d.parentsSenior ? 'Y' : 'N' };
  if (d.parentsSenior) {
    Object.assign(parents, {
      ParentsSeniorCitizen: Math.min(a.parents, 50_000),
      HlthInsPremParentsSrCtzn: premP,
      ...(premP ? { Sec80DParentsSrCtznHIDtls: rows(d.parentsPremiums) } : {}),
      PrevHlthChckUpParentsSrCtzn: Math.min(pos(d.parentsCheckup), 5000),
      MedicalExpParentsSrCtzn: pos(d.parentsMedical),
    });
  } else {
    Object.assign(parents, {
      Parents: Math.min(a.parents, 25_000),
      HlthInsPremParents: premP,
      ...(premP ? { Sec80DParentsHIDtls: rows(d.parentsPremiums) } : {}),
      PrevHlthChckUpParents: Math.min(pos(d.parentsCheckup), 5000),
    });
  }
  return { Sec80DSelfFamSrCtznHealth: { ...self, ...parents, EligibleAmountOfDedn: a.allowed } };
}

// ---- field checks the schema can not do ----------------------------------------------------------------------------

/** The input's own mistakes (formats and required details), before any file is built. */
export function itr4InputChecks(input: Itr4Input): FilingIssue[] {
  const out: FilingIssue[] = [];
  const t = input.taxpayer;
  const need = (ok: boolean, code: string, message: string, path: string) => {
    if (!ok) out.push(issue('error', code, message, path));
  };
  need(
    /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(t.pan?.toUpperCase() ?? ''),
    'PAN_INVALID',
    'PAN must be 5 letters, 4 digits and a letter',
    'taxpayer.pan',
  );
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(t.pan?.toUpperCase() ?? '') && t.pan[3].toUpperCase() !== 'P')
    out.push(
      issue(
        'error',
        'PAN_NOT_INDIVIDUAL',
        'The fourth letter of an individual’s PAN is P; this PAN belongs to another kind of taxpayer (ITR-4 here is for individuals)',
        'taxpayer.pan',
      ),
    );
  need(
    !!t.surname?.trim(),
    'NAME_MISSING',
    'The surname (or full name) is needed',
    'taxpayer.surname',
  );
  need(
    !!t.fatherName?.trim(),
    'FATHER_MISSING',
    'The father’s name is needed for the verification',
    'taxpayer.fatherName',
  );
  need(
    /^\d{4}-\d{2}-\d{2}$/.test(t.dob ?? ''),
    'DOB_INVALID',
    'Date of birth as YYYY-MM-DD',
    'taxpayer.dob',
  );
  need(
    /^[1-9][0-9]{5}$/.test(t.pinCode ?? ''),
    'PIN_INVALID',
    'A six-digit PIN code',
    'taxpayer.pinCode',
  );
  need(
    /^[1-9][0-9]{9}$/.test(t.mobile ?? ''),
    'MOBILE_INVALID',
    'A ten-digit mobile number',
    'taxpayer.mobile',
  );
  need(
    /^[.a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+([a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+)+$/.test(t.email ?? ''),
    'EMAIL_INVALID',
    'A valid e-mail address',
    'taxpayer.email',
  );
  need(
    !!t.residenceNo?.trim() && !!t.locality?.trim() && !!t.city?.trim(),
    'ADDRESS_INCOMPLETE',
    'Flat/door number, locality and city are needed',
    'taxpayer.address',
  );
  need(
    /^(0[1-9]|[1-2][0-9]|3[0-7]|99)$/.test(t.stateCode ?? ''),
    'STATE_INVALID',
    'Choose the state',
    'taxpayer.stateCode',
  );
  need(
    !t.aadhaar || /^[0-9]{12}$/.test(t.aadhaar),
    'AADHAAR_INVALID',
    'Aadhaar is 12 digits',
    'taxpayer.aadhaar',
  );
  need(
    !!t.place?.trim(),
    'PLACE_MISSING',
    'The place where the return is signed',
    'taxpayer.place',
  );
  need(
    (t.bankAccounts ?? []).length > 0,
    'BANK_MISSING',
    'At least one bank account is needed (refunds are paid to it)',
    'taxpayer.bankAccounts',
  );
  for (const [i, a] of (t.bankAccounts ?? []).entries()) {
    need(
      /^[A-Z]{4}0[A-Z0-9]{6}$/.test(a.ifsc ?? ''),
      'IFSC_INVALID',
      'IFSC is 4 letters, a zero and 6 letters or digits',
      `taxpayer.bankAccounts.${i}`,
    );
    need(
      !!a.accountNo?.trim() && a.accountNo.length <= 20,
      'ACCOUNT_INVALID',
      'The account number (up to 20 characters)',
      `taxpayer.bankAccounts.${i}`,
    );
  }
  if ((t.bankAccounts ?? []).length && !t.bankAccounts.some((a) => a.useForRefund))
    out.push(
      issue(
        'error',
        'REFUND_ACCOUNT',
        'Mark one bank account for refunds',
        'taxpayer.bankAccounts',
      ),
    );
  if (input.salary && input.salary.gross > 0 && t.employerCategory === 'NA')
    out.push(
      issue(
        'error',
        'EMPLOYER_CATEGORY',
        'With salary income say who the employer is (rule 255)',
        'taxpayer.employerCategory',
      ),
    );
  if (input.regime === 'old') {
    const f = input.form10IEA;
    if (!f || !/^[0-9]{15}$/.test(f.ack ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(f.filedOn ?? ''))
      out.push(
        issue(
          'error',
          'FORM_10IEA',
          'The old regime needs Form 10-IEA: its 15-digit acknowledgement number and the date it was filed',
          'form10IEA',
        ),
      );
  }
  const b = input.business;
  if (b) {
    need(!!b.name?.trim(), 'BUSINESS_NAME', 'Name of the business or profession', 'business.name');
    need(
      !!b.code,
      'BUSINESS_CODE',
      `Choose the ${b.section === '44AD' ? 'business' : 'profession'} code`,
      'business.code',
    );
    for (const [i, g] of (b.gstTurnover ?? []).entries())
      need(
        gstinChecksumOk(g.gstin),
        'GSTIN_INVALID',
        `GSTIN ${g.gstin} is not valid`,
        `business.gstTurnover.${i}`,
      );
  }
  for (const [i, r] of (input.tds ?? []).entries()) {
    need(
      /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(r.tan ?? ''),
      'TAN_INVALID',
      'TAN is 4 letters, 5 digits and a letter',
      `tds.${i}`,
    );
    need(
      r.tdsClaimed <= r.tdsDeducted,
      'TDS_CLAIM_ABOVE',
      'More TDS claimed than was deducted',
      `tds.${i}`,
    );
    need(
      r.tdsClaimed === 0 || (r.gross > 0 && r.headOfIncome !== 'NA'),
      'TDS_NO_INCOME',
      'TDS claimed needs the income it relates to and its head (rules 121, 122)',
      `tds.${i}`,
    );
  }
  for (const [i, c] of (input.challans ?? []).entries()) {
    need(
      /^[0-9]{3}[0-9A-Z]{4}$/.test(c.bsr ?? ''),
      'BSR_INVALID',
      'BSR code is 7 characters',
      `challans.${i}`,
    );
    need(
      /^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '') && c.date >= fyBounds(input.fy).start,
      'CHALLAN_DATE',
      'The challan date is before the year began or not a date',
      `challans.${i}`,
    );
    need(
      Number.isInteger(c.serial) && c.serial >= 0 && c.serial <= 99999,
      'CHALLAN_SERIAL',
      'Challan serial number (up to 5 digits)',
      `challans.${i}`,
    );
  }
  return out;
}
