// R2.5 (docs/FEATURE_GAPS_2026-11.md): ITR-3 for a resident individual with business or professional income worked out from
// the books (not the presumptive schemes). Pure. The books arrive as plain figures (the API reads them from the ledger and the
// asset register); this turns them into the department's Part A (balance sheet, trading account, profit and loss, other
// information), Schedule BP with the depreciation schedules DPM / DOA / DEP, the set-off schedules and Part B, in the shape of
// the published JSON schema (schemas/itr3/AY2026-27.json).
//
// Every required field of every section starts from `itr3Skeleton.json`, generated from that schema, so none can be missed;
// the builder fills values by path. What it does not cover (house property, capital gains including the section 50 gain on a
// sold asset block, foreign assets, partners and directors, brought-forward and carried-forward losses, the seventh-proviso
// triggers, manufacturing account) is refused with a message to file those on the portal, never guessed.
//
// Checked three ways: eligibility and input checks here, the department's validation rules by number (itr3Rules.ts) and the
// schema (itr3Schema.ts, server only).

import type { BlockYear } from './depreciation.ts';
import type { FilingIssue } from './filing.ts';
import { itrRulesFor, type ItrYearRules } from './itrRules.ts';
import { gstinChecksumOk } from './gstin.ts';
import {
  ageAtFyEnd,
  computeItr4,
  itr4InputChecks,
  type Itr4Computation,
  type Itr4Input,
} from './itr4.ts';
import skeleton from './itr3Skeleton.json' with { type: 'json' };

const int = (v: unknown) => Math.round(Number(v) || 0);
const pos = (v: unknown) => Math.max(0, int(v));
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

const issue = (
  severity: FilingIssue['severity'],
  code: string,
  message: string,
  path?: string,
): FilingIssue => ({
  id: `${code}:${path ?? message}`,
  severity,
  code,
  message,
  ...(path ? { path } : {}),
});

// ---- input ----------------------------------------------------------------------------------------------------------------

export interface NamedAmount {
  name: string;
  amount: number;
}

/** What the ledger says, in the heads Part A asks for. Whole rupees; everything is net of GST. */
export interface Itr3Books {
  saleOfGoods: number;
  saleOfServices: number;
  openingStock: number;
  closingStock: number;
  purchases: number;
  carriageInward: number;
  powerAndFuel: number;
  otherDirectExpenses: NamedAmount[];
  /** Credited to the profit and loss account. Interest, dividend and rent are taxed under other sources, not here. */
  interestIncome: number;
  dividendIncome: number;
  rentIncome: number;
  commissionIncome: number;
  profitOnSaleOfFixedAssets: number;
  otherIncome: NamedAmount[];
  salariesAndWages: number;
  rentPaid: number;
  interestPaid: number;
  /** Depreciation charged in the books (Companies Act), from the asset register. */
  bookDepreciation: number;
  otherExpenses: NamedAmount[];
}

/** The balance sheet at 31 March, whole rupees. Capital is the closing figure (opening plus profit less drawings). */
export interface Itr3BalanceSheet {
  proprietorCapital: number;
  securedLoansFromBanks: number;
  securedLoansFromOthers: number;
  unsecuredLoansFromBanks: number;
  unsecuredLoansFromOthers: number;
  advancesFromSpecifiedPersons: number;
  advancesFromOthers: number;
  /** Cost and depreciation to date of the fixed assets (the asset register). */
  grossBlock: number;
  accumulatedDepreciation: number;
  capitalWorkInProgress: number;
  investments: number;
  inventories: number;
  sundryDebtors: number;
  cashInHand: number;
  bankBalances: number;
  otherCurrentAssets: number;
  loansAndAdvancesRecoverable: number;
  deposits: number;
  balanceWithRevenueAuthorities: number;
  sundryCreditors: number;
  otherCurrentLiabilities: number;
  provisions: number;
}

/**
 * Items of the profit and loss account the Income-tax Act treats differently, as the books cannot tell them apart. Each is
 * the part to add back (or, for the "now allowed" ones, to deduct); they feed Part A-OI and Schedule BP together.
 */
export interface Itr3Adjustments {
  /** Section 37: personal expenses, and other expenses not allowed (fines, penalties, capital items). */
  personalExpenses?: number;
  otherNotAllowedUs37?: number;
  /** Section 36 items not allowed (for example an employee's contribution paid late). */
  otherNotAllowedUs36?: number;
  /** Section 40(a)/(ib): for example tax or cess charged to the account, or tax not deducted at source. */
  notAllowedUs40?: number;
  /** Section 40A(3): payments in cash above ₹10,000 per person per day. */
  cashPaymentsUs40A3?: number;
  /** Section 43B: dues unpaid at the filing date (tax, PF/ESI, bonus, interest, leave encashment, MSE payments). */
  unpaid43B?: Partial<Record<Dues43B, number>>;
  /** Section 43B dues of earlier years paid this year (allowed now). */
  paid43BOfEarlierYears?: Partial<Record<Dues43B, number>>;
  /** Section 41: remission or cessation of a liability. */
  deemedIncomeUs41?: number;
}
export type Dues43B =
  | 'taxDutyCess'
  | 'pfEsiContribution'
  | 'bonusCommission'
  | 'interestToFinancialInstitution'
  | 'loanFromFinancialCompany'
  | 'interestToScheduledBank'
  | 'leaveEncashment'
  | 'msePayable';
export interface Itr3Audit {
  /** The books show a tax audit is needed (section 44AB); the engine also works this out and refuses a mismatch. */
  audited: boolean;
  /** The auditor's report: date, e-filing acknowledgement number and the auditor's firm. */
  reportDate?: string;
  ack?: string;
  auditorName?: string;
  auditorPan?: string;
  /** Share of the year's receipts and payments in cash, percent: decides whether the ₹10 crore limit applies. */
  cashReceiptsPct?: number;
  cashPaymentsPct?: number;
}

export interface Itr3Salary {
  gross: number;
  basicAndDa?: number;
  professionalTax?: number;
  tds?: { tan: string; name: string; income: number; tds: number }[];
  /** The employer, as Schedule S wants it. */
  employer?: {
    name: string;
    nature: Itr4Input['taxpayer']['employerCategory'];
    address: string;
    city: string;
    stateCode: string;
  };
}

export interface Itr3Input extends Omit<
  Itr4Input,
  'business' | 'salary' | 'declarations' | 'normalBusiness'
> {
  /** Business details (Part A General). */
  business: {
    name: string;
    /** Nature-of-business code of the schema (ITR3_BUSINESS_CODES). */
    code: string;
    description?: string;
    commencedOn?: string;
    /** Mercantile or cash system of accounting. */
    method: 'MERC' | 'CASH';
    /** GST turnover by registration (Schedule GST needs it). */
    gstTurnover?: { gstin: string; amount: number }[];
  };
  books: Itr3Books;
  balanceSheet: Itr3BalanceSheet;
  adjustments?: Itr3Adjustments;
  /** The year's depreciation blocks from the asset register (computeBlocks). */
  blocks: BlockYear[];
  audit?: Itr3Audit;
  salary?: Itr3Salary;
  /** Anything that sends the return to the portal's own forms; each true one is refused with a reason. */
  declarations: {
    houseProperty: boolean;
    capitalGains: boolean;
    foreignAssetsOrIncome: boolean;
    companyDirector: boolean;
    unlistedShares: boolean;
    partnerInFirm: boolean;
    carriedForwardLoss: boolean;
    agriculturalIncomeOver5000: boolean;
    cashDeposits1Crore: boolean;
    foreignTravel2Lakh: boolean;
    electricity1Lakh: boolean;
    manufacturingAccount: boolean;
    speculativeOrSpecifiedBusiness: boolean;
    nonResident: boolean;
  };
}

// ---- the figures ----------------------------------------------------------------------------------------------------------

export interface Itr3Calc {
  /** Part A trading account */
  revenue: number;
  tradingCredits: number;
  directExpenses: number;
  grossProfit: number;
  /** Part A profit and loss account */
  otherIncomeTotal: number;
  totalCredits: number;
  otherExpensesTotal: number;
  pbidta: number;
  profitBeforeTax: number;
  /** Schedule BP */
  creditedToOtherHeads: number;
  otherSourcesCredited: number;
  balancePl: number;
  taxDepreciation: number;
  bookDepreciation: number;
  adjustedForDepreciation: number;
  addbacks: number;
  deductions: number;
  businessIncome: number;
  /** The disallowances in Part A-OI order, for the schedule. */
  oi: {
    s36: number;
    s37: number;
    s40: number;
    s40A: number;
    s43B: number;
    s43BPrior: number;
    s41: number;
  };
  /** Balance sheet */
  fundsSource: number;
  fundsApplied: number;
  netBlock: number;
  /** Turnover figures for the audit rules. */
  turnover: number;
  auditLiable: boolean;
  auditReason: string;
  issues: FilingIssue[];
}

/** Section 44AB: books audit above ₹1 crore of turnover, ₹10 crore when cash receipts and payments are 5% or less. */
export function auditLiability(turnover: number, cashReceiptsPct = 100, cashPaymentsPct = 100) {
  const limit = cashReceiptsPct <= 5 && cashPaymentsPct <= 5 ? 100_000_000 : 10_000_000;
  return {
    liable: turnover > limit,
    limit,
    reason:
      turnover > limit
        ? `turnover ₹${turnover.toLocaleString('en-IN')} is above ₹${(limit / 10_000_000).toLocaleString('en-IN')} crore`
        : '',
  };
}

export function computeItr3Calc(input: Itr3Input): Itr3Calc {
  const b = input.books;
  const s = input.balanceSheet;
  const adj = input.adjustments ?? {};
  const issues: FilingIssue[] = [];

  const revenue = pos(b.saleOfGoods) + pos(b.saleOfServices);
  const tradingCredits = revenue + pos(b.closingStock);
  const directExpenses =
    pos(b.carriageInward) +
    pos(b.powerAndFuel) +
    sum(b.otherDirectExpenses.map((x) => pos(x.amount)));
  const grossProfit = tradingCredits - pos(b.openingStock) - pos(b.purchases) - directExpenses;

  const otherIncomeTotal =
    pos(b.interestIncome) +
    pos(b.dividendIncome) +
    pos(b.rentIncome) +
    pos(b.commissionIncome) +
    pos(b.profitOnSaleOfFixedAssets) +
    sum(b.otherIncome.map((x) => pos(x.amount)));
  const totalCredits = grossProfit + otherIncomeTotal;
  const otherExpensesTotal = sum(b.otherExpenses.map((x) => pos(x.amount)));
  const pbidta = totalCredits - pos(b.salariesAndWages) - pos(b.rentPaid) - otherExpensesTotal;
  const profitBeforeTax = pbidta - pos(b.interestPaid) - pos(b.bookDepreciation);

  // Schedule BP: income credited to the account but taxed under other sources comes out; the tax depreciation replaces the
  // books' depreciation; the items the Act does not allow go back; items allowed now come off.
  const otherSourcesCredited = pos(b.interestIncome) + pos(b.dividendIncome) + pos(b.rentIncome);
  const creditedToOtherHeads = otherSourcesCredited;
  const balancePl = profitBeforeTax - creditedToOtherHeads;
  const taxDepreciation = sum(input.blocks.map((x) => x.NetAggregateDepreciation));
  const bookDepreciation = pos(b.bookDepreciation);
  const adjustedForDepreciation = balancePl + bookDepreciation - taxDepreciation;

  const sumDues = (d?: Partial<Record<Dues43B, number>>) => sum(Object.values(d ?? {}).map(pos));
  const oi = {
    s36: pos(adj.otherNotAllowedUs36),
    s37: pos(adj.personalExpenses) + pos(adj.otherNotAllowedUs37),
    s40: pos(adj.notAllowedUs40),
    s40A: pos(adj.cashPaymentsUs40A3),
    s43B: sumDues(adj.unpaid43B),
    s43BPrior: sumDues(adj.paid43BOfEarlierYears),
    s41: pos(adj.deemedIncomeUs41),
  };
  const addbacks = oi.s36 + oi.s37 + oi.s40 + oi.s40A + oi.s43B + oi.s41;
  const deductions = oi.s43BPrior;
  const businessIncome = adjustedForDepreciation + addbacks - deductions;

  // Balance sheet.
  const netBlock = pos(s.grossBlock) - pos(s.accumulatedDepreciation);
  const loans =
    pos(s.securedLoansFromBanks) +
    pos(s.securedLoansFromOthers) +
    pos(s.unsecuredLoansFromBanks) +
    pos(s.unsecuredLoansFromOthers);
  const advances = pos(s.advancesFromSpecifiedPersons) + pos(s.advancesFromOthers);
  const fundsSource = int(s.proprietorCapital) + loans + advances;
  const currentAssets =
    pos(s.inventories) +
    pos(s.sundryDebtors) +
    pos(s.cashInHand) +
    pos(s.bankBalances) +
    pos(s.otherCurrentAssets);
  const loansAdv =
    pos(s.loansAndAdvancesRecoverable) + pos(s.deposits) + pos(s.balanceWithRevenueAuthorities);
  const currentLiab = pos(s.sundryCreditors) + pos(s.otherCurrentLiabilities) + pos(s.provisions);
  const fundsApplied =
    netBlock +
    pos(s.capitalWorkInProgress) +
    pos(s.investments) +
    currentAssets +
    loansAdv -
    currentLiab;

  const turnover = revenue;
  const aud = auditLiability(turnover, input.audit?.cashReceiptsPct, input.audit?.cashPaymentsPct);

  if (Math.abs(fundsSource - fundsApplied) > 1)
    issues.push(
      issue(
        'error',
        'ITR3_BS_UNBALANCED',
        `The balance sheet does not balance: sources of funds ₹${fundsSource.toLocaleString('en-IN')}, application ₹${fundsApplied.toLocaleString('en-IN')} (the portal refuses a return where they differ; run Verify My Data and post any missing entries)`,
        'balanceSheet',
      ),
    );
  return {
    revenue,
    tradingCredits,
    directExpenses,
    grossProfit,
    otherIncomeTotal,
    totalCredits,
    otherExpensesTotal,
    pbidta,
    profitBeforeTax,
    creditedToOtherHeads,
    otherSourcesCredited,
    balancePl,
    taxDepreciation,
    bookDepreciation,
    adjustedForDepreciation,
    addbacks,
    deductions,
    businessIncome,
    oi,
    fundsSource,
    fundsApplied,
    netBlock,
    turnover,
    auditLiable: aud.liable,
    auditReason: aud.reason,
    issues,
  };
}

/** Eligibility and the checks only the builder can make. Errors stop the file. */
export function itr3Eligibility(
  input: Itr3Input,
  calc: Itr3Calc = computeItr3Calc(input),
): FilingIssue[] {
  const out: FilingIssue[] = [...calc.issues];
  const d = input.declarations;
  const refuse = (flag: boolean, code: string, what: string) => {
    if (flag)
      out.push(
        issue(
          'error',
          code,
          `${what}: this return needs schedules this builder does not file yet. Enter it on the e-filing portal (or the department's ITR-3 utility)`,
          code,
        ),
      );
  };
  refuse(d.houseProperty, 'ITR3_HP', 'Income from house property');
  refuse(d.capitalGains, 'ITR3_CG', 'Capital gains');
  refuse(d.foreignAssetsOrIncome, 'ITR3_FA', 'Foreign assets or foreign income');
  refuse(d.companyDirector, 'ITR3_DIRECTOR', 'A directorship');
  refuse(d.unlistedShares, 'ITR3_UNLISTED', 'Unlisted equity shares');
  refuse(d.partnerInFirm, 'ITR3_PARTNER', 'A partnership interest');
  refuse(d.carriedForwardLoss, 'ITR3_CFL', 'Losses brought forward from earlier years');
  refuse(d.agriculturalIncomeOver5000, 'ITR3_AGRI', 'Agricultural income above ₹5,000');
  refuse(
    d.cashDeposits1Crore,
    'ITR3_7P_DEPOSIT',
    'Cash deposits of ₹1 crore or more in a current account (seventh proviso to 139(1))',
  );
  refuse(
    d.foreignTravel2Lakh,
    'ITR3_7P_TRAVEL',
    'Foreign travel expenditure above ₹2 lakh (seventh proviso)',
  );
  refuse(d.electricity1Lakh, 'ITR3_7P_POWER', 'Electricity bill above ₹1 lakh (seventh proviso)');
  refuse(d.manufacturingAccount, 'ITR3_MA', 'A manufacturing account');
  refuse(d.speculativeOrSpecifiedBusiness, 'ITR3_SPEC', 'Speculative or specified business income');
  refuse(d.nonResident, 'ITR3_NRI', 'A non-resident or not-ordinarily-resident return');

  // A sold block creates a section 50 capital gain or loss, which belongs in Schedule CG.
  for (const blk of input.blocks)
    if (blk.CapGainUs50 !== 0)
      out.push(
        issue(
          'error',
          'ITR3_S50',
          `Block ${blk.block} has a short-term capital ${blk.CapGainUs50 > 0 ? 'gain' : 'loss'} of ₹${Math.abs(blk.CapGainUs50).toLocaleString('en-IN')} under section 50 (the sale is bigger than the block, or ends it): it belongs in Schedule CG, which this builder does not file yet`,
          `block:${blk.block}`,
        ),
      );
  for (const blk of input.blocks)
    for (const n of blk.notes)
      out.push(issue('warning', 'ITR3_BLOCK_NOTE', `${blk.block}: ${n}`, `block:${blk.block}`));

  const tp = input.taxpayer;
  if (!input.business.code || !/^\d{5}$/.test(input.business.code))
    out.push(
      issue(
        'error',
        'ITR3_NATURE',
        'Choose the nature of business (a five-digit code)',
        'business.code',
      ),
    );
  if (!input.business.name.trim())
    out.push(issue('error', 'ITR3_BUSINESS_NAME', 'Enter the business name', 'business.name'));
  if (!tp.pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(tp.pan.toUpperCase()))
    out.push(issue('error', 'ITR3_PAN', 'The PAN is not in the right form', 'taxpayer.pan'));
  if (!/^[6-9]\d{9}$/.test(tp.mobile))
    out.push(issue('error', 'ITR3_MOBILE', 'Enter a ten-digit mobile number', 'taxpayer.mobile'));

  // Tax audit: a business above the limit must have audited accounts, with the report's details.
  if (calc.auditLiable) {
    const a = input.audit;
    if (!a?.audited)
      out.push(
        issue(
          'error',
          'ITR3_AUDIT_REQUIRED',
          `A tax audit under section 44AB is required (${calc.auditReason}). Have the accounts audited and enter the report's details`,
          'audit',
        ),
      );
    else {
      if (!a.reportDate)
        out.push(
          issue(
            'error',
            'ITR3_AUDIT_DATE',
            'Enter the date of the audit report',
            'audit.reportDate',
          ),
        );
      if (!a.ack || !/^\d{15}$/.test(a.ack))
        out.push(
          issue(
            'error',
            'ITR3_AUDIT_ACK',
            'Enter the 15-digit acknowledgement number of the audit report',
            'audit.ack',
          ),
        );
      if (!a.auditorName)
        out.push(
          issue('error', 'ITR3_AUDITOR', "Enter the auditor's firm name", 'audit.auditorName'),
        );
      if (!a.auditorPan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(a.auditorPan))
        out.push(issue('error', 'ITR3_AUDITOR_PAN', "Enter the auditor's PAN", 'audit.auditorPan'));
      if (a.reportDate && a.reportDate > input.filedOn)
        out.push(
          issue(
            'error',
            'ITR3_AUDIT_FUTURE',
            'The audit report is dated after the filing date',
            'audit.reportDate',
          ),
        );
    }
  } else if (input.audit?.audited)
    out.push(
      issue(
        'warning',
        'ITR3_AUDIT_VOLUNTARY',
        'The accounts are audited although the turnover is below the limit; the audit details are filed as given',
      ),
    );

  if (input.salary && int(input.salary.gross) > 0 && !input.salary.employer)
    out.push(
      issue(
        'error',
        'ITR3_EMPLOYER',
        "Schedule S needs the employer's name, nature of employment and address",
        'salary.employer',
      ),
    );
  if (input.regime === 'old' && !input.form10IEA)
    out.push(
      issue(
        'warning',
        'ITR3_10IEA',
        'The old regime is chosen: a person with business income can leave the new regime once, by Form 10-IEA filed on or before the due date. Enter its acknowledgement number',
        'form10IEA',
      ),
    );
  if (tp.dob && ageAtFyEnd(tp.dob, input.fy) < 18)
    out.push(
      issue(
        'warning',
        'ITR3_MINOR',
        'The taxpayer is under 18: the return is signed by a guardian',
        'taxpayer.dob',
      ),
    );
  return out;
}

// ---- computation ----------------------------------------------------------------------------------------------------------

export interface Itr3Computation extends Itr4Computation {
  calc: Itr3Calc;
}

/**
 * Other-sources income: what the books credit as interest, dividend and rent (taxed under this head, not as business income)
 * joined with `otherSources`, which holds only income NOT in the books (for example interest from the AIS that was never
 * booked). The books carry no dates, so their dividend is shown as received in the last quarter.
 */
export function mergedOtherSources(input: Itr3Input) {
  const os = input.otherSources ?? {};
  const b = input.books;
  const quarters = (os.dividend ?? [0, 0, 0, 0, 0]).map(pos) as [
    number,
    number,
    number,
    number,
    number,
  ];
  quarters[4] += pos(b.dividendIncome);
  return {
    savings: pos(os.savingsInterest),
    deposits: pos(os.depositInterest),
    refund: pos(os.refundInterest),
    interestFromBooks: pos(b.interestIncome),
    rentFromBooks: pos(b.rentIncome),
    quarters,
    dividend: sum(quarters),
    other: (os.other ?? [])
      .map((o) => ({ description: o.description, amount: pos(o.amount) }))
      .filter((o) => o.amount > 0),
  };
}

/** The input in the shape the ITR-4 computation and input checks take (the books' business income in place of a scheme). */
export function itr3AsItr4(
  input: Itr3Input,
  calc: Itr3Calc,
  rules: ItrYearRules = itrRulesFor(input.fy),
): Itr4Input {
  const {
    business: _b,
    books: _bk,
    balanceSheet: _bs,
    adjustments: _a,
    blocks: _bl,
    audit: _au,
    declarations: _d,
    salary,
    ...rest
  } = input;
  return {
    ...rest,
    taxpayer: salary?.employer
      ? { ...input.taxpayer, employerCategory: salary.employer.nature }
      : input.taxpayer,
    ...(salary ? { salary } : {}),
    normalBusiness: { income: calc.businessIncome },
    otherSources: (() => {
      const m = mergedOtherSources(input);
      return {
        savingsInterest: m.savings,
        depositInterest: m.deposits + m.interestFromBooks,
        refundInterest: m.refund,
        dividend: m.quarters,
        other: [
          ...m.other,
          ...(m.rentFromBooks > 0
            ? [{ description: 'Rent from machinery, plant or building', amount: m.rentFromBooks }]
            : []),
        ],
      };
    })(),
    // A tax-audit return is due later (31 October of the assessment year).
    ...(calc.auditLiable ? { dueDate: auditDueDate(rules) } : {}),
    declarations: {
      houseProperty: false,
      capitalGains: false,
      foreignAssetsOrIncome: false,
      companyDirector: false,
      unlistedShares: false,
      carriedForwardLoss: false,
      agriculturalIncomeOver5000: false,
      section44AE: false,
    },
  };
}

/** The ITR-4 computation, run on the books' business income (a loss set off against other sources, surcharge above ₹50 lakh). */
export function computeItr3(
  input: Itr3Input,
  rules: ItrYearRules = itrRulesFor(input.fy),
): Itr3Computation {
  const calc = computeItr3Calc(input);
  return { ...computeItr4(itr3AsItr4(input, calc, rules), rules), calc };
}

/**
 * Every problem that stops the file: the builder's eligibility, the identity, bank, TDS and challan checks shared with ITR-4,
 * and the ones that need the computation (a loss left to carry forward, a total income that needs Schedule AL).
 */
export function itr3InputChecks(
  input: Itr3Input,
  c: Itr3Computation = computeItr3(input),
): FilingIssue[] {
  const rules = itrRulesFor(input.fy);
  const out = [
    ...itr3Eligibility(input, c.calc),
    ...itr4InputChecks(itr3AsItr4(input, c.calc, rules)),
  ];
  // The shared checks ask a salaried person for an employer category; ITR-3 asks for the employer instead (checked above).
  const seen = new Set<string>();
  const unique = out.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const extra: FilingIssue[] = [];
  if (c.lossCarriedForward > 0)
    extra.push(
      issue(
        'error',
        'ITR3_LOSS_CF',
        `The business made a loss of ₹${(c.lossCarriedForward + c.businessLossSetOff).toLocaleString('en-IN')} and only ₹${c.businessLossSetOff.toLocaleString('en-IN')} can be set off this year; the rest (₹${c.lossCarriedForward.toLocaleString('en-IN')}) must be carried forward in Schedule CFL, which this builder does not file yet. File it on the portal`,
        'books',
      ),
    );
  if (c.totalIncome > 5_000_000)
    extra.push(
      issue(
        'error',
        'ITR3_SCHEDULE_AL',
        'Total income above ₹50 lakh needs Schedule AL (assets and liabilities at the year end), which this builder does not file yet. File it on the portal',
        'totalIncome',
      ),
    );
  for (const [i, g] of (input.business.gstTurnover ?? []).entries())
    if (!gstinChecksumOk(g.gstin))
      extra.push(
        issue(
          'error',
          'GSTIN_INVALID',
          `GSTIN ${g.gstin} is not valid`,
          `business.gstTurnover.${i}`,
        ),
      );
  return [...unique.filter((i) => i.code !== 'EMPLOYER_CATEGORY'), ...extra];
}

/** 31 October of the assessment year, the date the schema pins for returns that need a tax audit. */
export const auditDueDate = (rules: ItrYearRules) => `${rules.ay.slice(0, 4)}-10-31`;
export { skeleton as ITR3_SKELETON };
