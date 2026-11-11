// Vyapar parity Phase 5 (Cash & Bank): the rules that are not loans, cheques or reconciliation. Bank account fields
// (P5-S1), cash adjustments and the day-end count (P5-S2), the transfer guard (P5-S3), the §269ST cash watch and the
// dashboard totals (P5-S7). Pure functions; the API and the web app both use them.

import type { Numeric } from './types.ts';
import { r2 } from './money.ts';
import { ACC, postAdjustment, type Posting } from './posting.ts';
import { tdsCalc } from './purchase.ts';

const n = (v: Numeric) => Number(v) || 0;

// ---- bank account fields (P5-S1) ---------------------------------------------------------------------------------------

export const BANK_ACCOUNT_TYPES = ['current', 'savings', 'od', 'cc'] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const validIfsc = (v: string) => IFSC_RE.test(String(v || '').toUpperCase());
/** 9 to 18 digits. */
export const validAccountNumber = (v: string) =>
  /^\d{9,18}$/.test(String(v || '').replace(/\s/g, ''));
export const validUpi = (v: string) =>
  /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/.test(String(v || ''));
/** How lists show an account number: the last four digits. */
export const maskAccount = (v: string) => {
  const d = String(v || '').replace(/\s/g, '');
  return d.length > 4 ? `••${d.slice(-4)}` : d;
};

/** The bank an IFSC belongs to, from its first four letters (the common ones; '' when not in the table). */
const IFSC_BANKS: Record<string, string> = {
  SBIN: 'State Bank of India',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  UTIB: 'Axis Bank',
  KKBK: 'Kotak Mahindra Bank',
  PUNB: 'Punjab National Bank',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
  BKID: 'Bank of India',
  IOBA: 'Indian Overseas Bank',
  IDIB: 'Indian Bank',
  CBIN: 'Central Bank of India',
  UCBA: 'UCO Bank',
  MAHB: 'Bank of Maharashtra',
  PSIB: 'Punjab & Sind Bank',
  INDB: 'IndusInd Bank',
  YESB: 'Yes Bank',
  IDFB: 'IDFC FIRST Bank',
  FDRL: 'Federal Bank',
  KVBL: 'Karur Vysya Bank',
  TMBL: 'Tamilnad Mercantile Bank',
  CIUB: 'City Union Bank',
  SIBL: 'South Indian Bank',
  KARB: 'Karnataka Bank',
  RATN: 'RBL Bank',
  DCBL: 'DCB Bank',
  AUBL: 'AU Small Finance Bank',
  ESFB: 'Equitas Small Finance Bank',
  BDBL: 'Bandhan Bank',
  DBSS: 'DBS Bank India',
  SCBL: 'Standard Chartered Bank',
  HSBC: 'HSBC',
  CITI: 'Citibank',
  PYTM: 'Paytm Payments Bank',
  AIRP: 'Airtel Payments Bank',
  IPOS: 'India Post Payments Bank',
  JAKA: 'Jammu & Kashmir Bank',
};
export const bankFromIfsc = (ifsc: string) =>
  validIfsc(ifsc) ? (IFSC_BANKS[ifsc.toUpperCase().slice(0, 4)] ?? '') : '';

// ---- cash and bank entries (P5-S1 deposit/withdraw, P5-S2 adjust cash and day-end count) -------------------------------

/**
 * What the other side of a cash or bank entry is:
 * - adjust (no reason): Opening Balance Equity;
 * - adjust counted as income / loss: Other Income for more money, Cash Over / Short for less;
 * - day-end count: Cash Over / Short either way;
 * - deposit: Owner's Capital (money the owner put in);
 * - withdraw: Owner's Drawings, Bank Charges, or an account the user picked.
 */
export type EntryKind = 'adjust' | 'count' | 'deposit' | 'withdraw';
export type WithdrawCategory = 'drawings' | 'bank_charges' | 'other';

export function counterAccount(o: {
  kind: EntryKind;
  direction: 'increase' | 'reduce';
  countAsIncome?: boolean;
  category?: WithdrawCategory;
  /** Chart code the user chose for 'other'. */
  account?: string | null;
}) {
  if (o.kind === 'count') return ACC.CASH_OVER_SHORT;
  if (o.kind === 'deposit') return o.account || ACC.CAPITAL;
  if (o.kind === 'withdraw') {
    if (o.category === 'bank_charges') return ACC.BANK_CHARGES;
    if (o.category === 'other' && o.account) return o.account;
    return ACC.DRAWINGS;
  }
  if (o.countAsIncome) return o.direction === 'increase' ? ACC.OTHER_INCOME : ACC.CASH_OVER_SHORT;
  return ACC.OPENING_EQUITY;
}

/** The posting of a cash or bank entry: Dr/Cr `account` by the amount against its counter account. */
export const postCashBankEntry = (e: {
  id: string;
  date: string;
  account: string;
  amount: Numeric;
  direction: 'increase' | 'reduce';
  kind: EntryKind;
  countAsIncome?: boolean;
  category?: WithdrawCategory;
  counter?: string | null;
  narration?: string;
}): Posting[] =>
  postAdjustment({
    id: e.id,
    date: e.date,
    account: e.account,
    amount: e.amount,
    direction: e.direction,
    narration: e.narration,
    counter: counterAccount({ ...e, account: e.counter }),
  });

/**
 * Day-end count: what was counted against what the books say. A shortage reduces cash, an excess adds to it, both
 * against Cash Over / Short; an equal count is no entry at all.
 */
export function dayEndCount(system: Numeric, counted: Numeric) {
  const difference = r2(n(counted) - n(system));
  return {
    difference,
    direction: difference > 0 ? ('increase' as const) : difference < 0 ? ('reduce' as const) : null,
    amount: Math.abs(difference),
  };
}

// ---- transfers (P5-S3) -------------------------------------------------------------------------------------------------

/**
 * Why a transfer can not be made, or null. Cash in hand can never go below zero; a bank may when the business allows
 * overdrafts (an OD or CC account always may).
 */
export function transferProblem(o: {
  fromAccount: string;
  toAccount: string;
  amount: Numeric;
  fee?: Numeric;
  fromBalance: Numeric;
  fromIsCash: boolean;
  allowOverdraft?: boolean;
}) {
  if (o.fromAccount === o.toAccount) return 'From and To must be different accounts';
  const amt = r2(n(o.amount));
  if (!(amt > 0)) return 'The amount must be more than zero';
  if (n(o.fee) < 0) return 'Charges can not be negative';
  const need = r2(amt + n(o.fee));
  if ((o.fromIsCash || !o.allowOverdraft) && need > r2(n(o.fromBalance)) + 0.005)
    return `Only ₹${r2(n(o.fromBalance))} is available in the account money is going from`;
  return null;
}

// ---- §269ST cash watch (P5-S2) -----------------------------------------------------------------------------------------

/** Cash received from one party on one day that reaches the §269ST limit (₹2,00,000 by default). */
export function cashWatch(
  receipts: {
    partyId: string;
    date: string;
    amount: Numeric;
    mode?: string | null;
    direction?: string | null;
  }[],
  limit = 200000,
) {
  const sums = new Map<string, { partyId: string; date: string; total: number }>();
  for (const r of receipts) {
    if ((r.mode ?? 'cash') !== 'cash' || (r.direction ?? 'in') !== 'in') continue;
    const k = `${r.partyId}|${r.date}`;
    const s = sums.get(k) ?? { partyId: r.partyId, date: r.date, total: 0 };
    s.total = r2(s.total + n(r.amount));
    sums.set(k, s);
  }
  return [...sums.values()]
    .filter((s) => s.total >= limit)
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---- dashboard (P5-S7) -------------------------------------------------------------------------------------------------

/** Cash + bank totals and the overdraft warning, from account balances (Dr positive). */
export function cashBankTotals(
  accounts: { kind: 'cash' | 'bank'; name: string; balance: Numeric }[],
) {
  const cash = r2(accounts.filter((a) => a.kind === 'cash').reduce((s, a) => s + n(a.balance), 0));
  const bank = r2(accounts.filter((a) => a.kind === 'bank').reduce((s, a) => s + n(a.balance), 0));
  return {
    cash,
    bank,
    total: r2(cash + bank),
    overdrawn: accounts
      .filter((a) => n(a.balance) < -0.005)
      .map((a) => ({ name: a.name, balance: r2(n(a.balance)) })),
  };
}

// ---- India: cash limits of the Income-tax Act ---------------------------------------------------------------------------

/**
 * §40A(3): a business expense paid in cash to one person on one day above ₹10,000 is disallowed (₹35,000 for paying a
 * transporter for plying, hiring or leasing goods carriages). Returns each party / day at or over the limit.
 */
export function cashOutWatch(
  payments: {
    partyId: string;
    date: string;
    amount: Numeric;
    mode?: string | null;
    direction?: string | null;
  }[],
  limit = 10000,
) {
  const sums = new Map<string, { partyId: string; date: string; total: number }>();
  for (const p of payments) {
    if ((p.mode ?? 'cash') !== 'cash' || p.direction !== 'out') continue;
    const k = `${p.partyId}|${p.date}`;
    const s = sums.get(k) ?? { partyId: p.partyId, date: p.date, total: 0 };
    s.total = r2(s.total + n(p.amount));
    sums.set(k, s);
  }
  return [...sums.values()]
    .filter((s) => s.total > limit)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * §269SS / §269T: a loan of ₹20,000 or more may not be taken, nor repaid (with its interest), in cash. Banks, co-operative
 * banks and the Government are exempt lenders, so the check applies when the money moves in cash. Returns the
 * section and a message, or null.
 */
export function loanCashProblem(o: {
  direction: 'take' | 'repay';
  amount: Numeric;
  inCash: boolean;
  limit?: number;
}) {
  const limit = o.limit ?? 20000;
  if (!o.inCash || n(o.amount) < limit) return null;
  return o.direction === 'take'
    ? {
        section: '269SS',
        message: `A loan of ₹${r2(n(o.amount))} taken in cash breaks section 269SS (₹${limit} or more must come by cheque, draft or bank transfer). The penalty under section 271D equals the amount.`,
      }
    : {
        section: '269T',
        message: `Repaying ₹${r2(n(o.amount))} of a loan in cash breaks section 269T (₹${limit} or more must go by cheque, draft or bank transfer). The penalty under section 271E equals the amount.`,
      };
}

/**
 * What the Regime Calculator can take from loan accounts for one financial year (old regime only): home-loan interest
 * under §24(b) (₹2,00,000 for a self-occupied house), home-loan principal towards §80C (the ₹1,50,000 cap is shared with
 * the other 80C items, so it is suggested, not capped here) and education-loan interest under §80E (no cap). Business
 * loans are left out: their interest is already a business expense in the books.
 */
export function loanTaxSuggestions(
  loans: { purpose: string; interest: Numeric; principal: Numeric }[],
) {
  const sum = (purpose: string, key: 'interest' | 'principal') =>
    r2(loans.filter((l) => l.purpose === purpose).reduce((s, l) => s + n(l[key]), 0));
  const housingInterest = sum('housing', 'interest');
  return {
    '24b': Math.min(200000, housingInterest),
    housingInterest,
    '80C': sum('housing', 'principal'),
    '80E': sum('education', 'interest'),
  };
}

// ---- India: TDS on loan interest (§194A) ---------------------------------------------------------------------------------

/**
 * Who lent the money. Interest paid to a bank (including a co-operative bank), LIC, an insurer, UTI or a public
 * financial institution is outside §194A (sub-section (3)(iii)); interest to an NBFC, a company, a firm or a person is
 * not, so TDS applies once the year's interest to that lender passes the threshold.
 */
export const LENDER_TYPES = ['bank', 'nbfc', 'company', 'individual', 'other'] as const;
export type LenderType = (typeof LENDER_TYPES)[number];

/**
 * TDS to deduct from the interest of one loan payment under §194A: 10% (20% without the lender's PAN, §206AA) once the
 * interest paid to the lender in the financial year passes ₹10,000; the payment that crosses it also covers the earlier
 * interest of the year (catch-up). Nothing for an exempt lender, or when the owner marked the loan exempt (a Form
 * 15G / 15H on file, or a deductor not required to deduct: an individual or HUF not liable to tax audit).
 */
export function loanInterestTds(o: {
  lenderType: LenderType | string;
  exempt?: boolean;
  interest: Numeric;
  ytdInterest?: Numeric;
  ytdDeducted?: boolean;
  panAvailable: boolean;
}) {
  if (o.lenderType === 'bank' || o.exempt)
    return { applies: false, rate: 0, taxableBase: 0, tds: 0, reason: 'exempt' };
  return tdsCalc({
    section: '194A',
    base: o.interest,
    ytdToDeductee: o.ytdInterest,
    ytdDeducted: o.ytdDeducted,
    panAvailable: o.panAvailable,
  });
}

/**
 * How much of a payment's interest pays interest credited earlier (first credited, first paid), and the TDS already kept
 * on that part at credit. `credits` are the loan's interest credits (gross amount and TDS), oldest first; `settledBefore`
 * is the gross already paid off by earlier payments.
 */
export function accruedSettlement(
  credits: { amount: Numeric; tds: Numeric }[],
  settledBefore: Numeric,
  interest: Numeric,
) {
  let skip = Math.max(0, n(settledBefore));
  let want = Math.max(0, n(interest));
  let settled = 0;
  let tds = 0;
  for (const c of credits) {
    const amount = n(c.amount);
    if (amount <= 0) continue;
    const used = Math.min(skip, amount);
    skip -= used;
    const take = Math.min(want, amount - used);
    if (take > 0) {
      settled += take;
      tds += (n(c.tds) * take) / amount;
      want -= take;
    }
    if (want <= 0) break;
  }
  return { settled: r2(settled), tds: r2(tds) };
}
