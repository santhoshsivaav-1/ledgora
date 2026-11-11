// Vyapar parity Phase 4 (ledger foundation): the posting engine. Pure functions that turn a document into balanced
// ledger lines (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P4-S1 and P4-S2). The API writes what these return in the same
// transaction as the document (apps/api/src/modules/ledgerRules.ts, `repost`); nothing here touches a database.
//
// Accounts are named by chart code ('1300'). A voucher is one balanced set of lines; a document may make several (a
// sale and each payment taken with it). Amounts are rupees to the paisa. Every function derives one side of each
// voucher from the others, so it balances by construction; `voucher()` still checks and throws if it does not.

import type { Numeric, Rec } from './types.ts';
import { r2 } from './money.ts';

// ---- chart of accounts (P4-S1) -----------------------------------------------------------------------------------------

export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export const ACC = {
  CASH: '1000',
  BANK_UNASSIGNED: '1190',
  CHEQUES_IN_HAND: '1200',
  RECEIVABLE: '1300',
  STOCK: '1400',
  IN_CGST: '1500',
  IN_SGST: '1510',
  IN_IGST: '1520',
  IN_CESS: '1530',
  TDS_RECEIVABLE: '1600',
  TCS_RECEIVABLE: '1610',
  FIXED_ASSETS: '1700',
  PAYABLE: '2000',
  OUT_CGST: '2100',
  OUT_SGST: '2110',
  OUT_IGST: '2120',
  OUT_CESS: '2130',
  RCM_PAYABLE: '2140',
  TDS_PAYABLE: '2200',
  INTEREST_PAYABLE: '2420',
  TCS_PAYABLE: '2210',
  CHEQUES_ISSUED: '2400',
  CAPITAL: '3000',
  DRAWINGS: '3010',
  OPENING_EQUITY: '3100',
  SALES: '4000',
  SALES_RETURN: '4010',
  OTHER_INCOME: '4100',
  DISCOUNT_RECEIVED: '4110',
  CHARGES_INCOME: '4120',
  ROUND_GAIN: '4130',
  PURCHASES: '5000',
  PURCHASE_RETURN: '5010',
  EXPENSES: '5100',
  DISCOUNT_ALLOWED: '5200',
  BANK_CHARGES: '5210',
  LOAN_INTEREST: '5220',
  ROUND_LOSS: '5230',
  COMMISSION: '5240',
  INELIGIBLE_GST: '5250',
  FOREX: '5260',
  CASH_OVER_SHORT: '5270',
} as const;

export interface ChartAccount {
  code: string;
  name: string;
  group: string;
  kind: AccountKind;
  system: boolean;
}
const a = (
  code: string,
  name: string,
  group: string,
  kind: AccountKind,
  system = true,
): ChartAccount => ({ code, name, group, kind, system });

/**
 * What enabling the ledger seeds for a business. Matches the guide's table; 1190 is added so money taken by UPI, bank
 * transfer or card has somewhere to go before bank accounts exist (Phase 5 moves it onto the real account).
 * Per-bank (1100…), per-loan (2300…) and per-expense-category (5100…) accounts are created when those exist.
 */
export const DEFAULT_CHART: readonly ChartAccount[] = [
  a('1000', 'Cash in Hand', 'Cash', 'asset'),
  a('1190', 'Bank (not assigned to an account)', 'Bank', 'asset'),
  a('1200', 'Cheques in Hand (received)', 'Current assets', 'asset'),
  a('1300', 'Accounts Receivable', 'Receivables', 'asset'),
  a('1400', 'Stock in Hand', 'Inventory', 'asset'),
  a('1500', 'Input CGST', 'Duties & taxes', 'asset'),
  a('1510', 'Input SGST', 'Duties & taxes', 'asset'),
  a('1520', 'Input IGST', 'Duties & taxes', 'asset'),
  a('1530', 'Input Cess', 'Duties & taxes', 'asset'),
  a('1600', 'TDS Receivable', 'Duties & taxes', 'asset'),
  a('1610', 'TCS Receivable', 'Duties & taxes', 'asset'),
  a('1700', 'Fixed Assets', 'Fixed assets', 'asset', false),
  a('2000', 'Accounts Payable', 'Payables', 'liability'),
  a('2100', 'Output CGST', 'Duties & taxes', 'liability'),
  a('2110', 'Output SGST', 'Duties & taxes', 'liability'),
  a('2120', 'Output IGST', 'Duties & taxes', 'liability'),
  a('2130', 'Output Cess', 'Duties & taxes', 'liability'),
  a('2140', 'RCM Payable', 'Duties & taxes', 'liability'),
  a('2200', 'TDS Payable', 'Duties & taxes', 'liability'),
  a('2210', 'TCS Payable', 'Duties & taxes', 'liability'),
  a('2400', 'Cheques Issued (uncleared)', 'Current liabilities', 'liability'),
  a('2420', 'Interest Payable', 'Current liabilities', 'liability'),
  a('3000', "Owner's Capital", 'Equity', 'equity'),
  a('3010', "Owner's Drawings", 'Equity', 'equity'),
  a('3100', 'Retained Earnings / Opening Balance Equity', 'Equity', 'equity'),
  a('4000', 'Sales', 'Direct income', 'income'),
  a('4010', 'Sales Return', 'Direct income', 'income'),
  a('4100', 'Other Income', 'Indirect income', 'income'),
  a('4110', 'Discount Received', 'Indirect income', 'income'),
  a('4120', 'Additional Charges Income', 'Direct income', 'income'),
  a('4130', 'Round-off Gain', 'Indirect income', 'income'),
  a('5000', 'Purchases', 'Direct expense', 'expense'),
  a('5010', 'Purchase Return', 'Direct expense', 'expense'),
  a('5100', 'Expenses', 'Indirect expense', 'expense'),
  a('5200', 'Discount Allowed', 'Indirect expense', 'expense'),
  a('5210', 'Bank Charges', 'Indirect expense', 'expense'),
  a('5220', 'Loan Interest', 'Indirect expense', 'expense'),
  a('5230', 'Round-off Loss', 'Indirect expense', 'expense'),
  a('5240', 'Salesman Commission', 'Indirect expense', 'expense'),
  a('5250', 'Ineligible GST expensed', 'Indirect expense', 'expense'),
  a('5260', 'Forex Gain/Loss', 'Indirect expense', 'expense'),
  a('5270', 'Cash Over / Short', 'Indirect expense', 'expense'),
];

/**
 * Groups an account can be added under, and the kind each implies (Add Account in P4-S1). "Duties & taxes" holds both
 * Input GST (asset) and Output GST (liability), so it is not here: Add Account asks for the kind in that group.
 */
export const ACCOUNT_GROUPS: Record<string, AccountKind> = {
  Cash: 'asset',
  Bank: 'asset',
  'Current assets': 'asset',
  Receivables: 'asset',
  Inventory: 'asset',
  'Fixed assets': 'asset',
  Payables: 'liability',
  'Current liabilities': 'liability',
  Loans: 'liability',
  Equity: 'equity',
  'Direct income': 'income',
  'Indirect income': 'income',
  'Direct expense': 'expense',
  'Indirect expense': 'expense',
};

/** The kind an account in `group` has; `kind` decides for the one ambiguous group. null = not a known group/kind. */
export const kindForGroup = (group: string, kind?: string): AccountKind | null => {
  if (group === 'Duties & taxes') return kind === 'asset' || kind === 'liability' ? kind : null;
  return ACCOUNT_GROUPS[group] ?? null;
};

// ---- lines and vouchers -----------------------------------------------------------------------------------------------

export interface PostLine {
  account: string;
  debit?: number;
  credit?: number;
  partyId?: string | null;
  narration?: string;
}
export interface Posting {
  date: string;
  refType: string;
  refId: string;
  lines: PostLine[];
}
/** What a posting needs that is not on the document: which account a bank id is, and an expense category's account. */
export interface PostCtx {
  bankAccount?: (accountId?: string | null) => string | null | undefined;
  expenseAccount?: (categoryId?: string | null) => string | null | undefined;
}

export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingError';
  }
}

const n = (v: Numeric) => Number(v) || 0;
const EPS = 0.005;
type Raw = {
  account: string;
  dr?: number;
  cr?: number;
  partyId?: string | null;
  narration?: string;
};

/** Σ debit and Σ credit of a posting. */
export const postingTotals = (p: Pick<Posting, 'lines'>) => ({
  debit: r2(p.lines.reduce((s, l) => s + n(l.debit), 0)),
  credit: r2(p.lines.reduce((s, l) => s + n(l.credit), 0)),
});
export const isBalanced = (p: Pick<Posting, 'lines'>) => {
  const t = postingTotals(p);
  return Math.abs(t.debit - t.credit) < EPS;
};

/**
 * One voucher from raw lines. A negative amount flips its side; zero lines drop out; no lines at all gives null (a
 * zero-value document posts nothing). Throws PostingError if the result does not balance, so a bad rule can never
 * reach the ledger.
 */
export function voucher(date: string, refType: string, refId: string, raw: Raw[]): Posting | null {
  const lines: PostLine[] = [];
  for (const l of raw) {
    const net = r2(n(l.dr) - n(l.cr));
    if (Math.abs(net) < EPS) continue;
    lines.push({
      account: l.account,
      ...(net > 0 ? { debit: net } : { credit: -net }),
      ...(l.partyId ? { partyId: l.partyId } : {}),
      ...(l.narration ? { narration: l.narration } : {}),
    });
  }
  if (!lines.length) return null;
  const p = { date, refType, refId, lines };
  if (!isBalanced(p)) {
    const t = postingTotals(p);
    throw new PostingError(`${refType} ${refId}: debit ${t.debit} ≠ credit ${t.credit}`);
  }
  return p;
}
const keep = (...v: (Posting | null)[]) => v.filter((x): x is Posting => !!x);

// ---- shared pieces ------------------------------------------------------------------------------------------------------

interface Heads {
  cgst?: Numeric;
  sgst?: Numeric;
  igst?: Numeric;
  cess?: Numeric;
}
const OUT = {
  cgst: ACC.OUT_CGST,
  sgst: ACC.OUT_SGST,
  igst: ACC.OUT_IGST,
  cess: ACC.OUT_CESS,
} as const;
const IN = { cgst: ACC.IN_CGST, sgst: ACC.IN_SGST, igst: ACC.IN_IGST, cess: ACC.IN_CESS } as const;
const HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;
const headSum = (h: Heads | null | undefined) => r2(HEADS.reduce((s, k) => s + n(h?.[k]), 0));
/** A line per tax head. `side` is the side the tax is booked on. */
const taxRaw = (
  map: typeof OUT | typeof IN,
  h: Heads | null | undefined,
  side: 'dr' | 'cr',
): Raw[] => HEADS.map((k) => ({ account: map[k], [side]: r2(n(h?.[k])) }) as Raw);

/** Where money taken or paid by `mode` lands: cash, a bank account, or the cheque clearing accounts. */
export function moneyAccount(
  ctx: PostCtx | undefined,
  mode: string | null | undefined,
  accountId: string | null | undefined,
  dir: 'in' | 'out',
) {
  const m = String(mode || 'cash').toLowerCase();
  if (m === 'cheque') return dir === 'in' ? ACC.CHEQUES_IN_HAND : ACC.CHEQUES_ISSUED;
  if (m === 'cash') return ACC.CASH;
  return ctx?.bankAccount?.(accountId) || ACC.BANK_UNASSIGNED;
}

/** Round-off of a document: positive = the total was rounded up. */
const roundOffOf = (ro: Numeric) => r2(n(ro));

interface InlinePay {
  amount?: Numeric;
  mode?: string | null;
  accountId?: string | null;
  date?: string | null;
}

// ---- sales -------------------------------------------------------------------------------------------------------------

export const SALE_TYPES = ['tax-invoice', 'bill-of-supply', 'composition'] as const;

/**
 * A sale. Dr Receivable for the total; Cr tax by head, TCS and round-off; Cr Additional Charges Income for charges;
 * Cr Sales for the rest (taxable value after discounts, and any discount given on the whole bill). Each payment taken
 * with it is its own voucher. Quotations, orders, proformas and challans post nothing; a cancelled one is reversed by
 * the caller posting an empty list.
 */
export function postInvoice(inv: Rec, ctx?: PostCtx): Posting[] {
  const type = String(inv.invoiceType || 'tax-invoice');
  if (type === 'credit-note') return postCreditNote(inv, ctx);
  if (!(SALE_TYPES as readonly string[]).includes(type) || inv.status === 'cancelled') return [];
  const total = r2(n(inv.total));
  if (total <= 0) return [];
  const date = String(inv.invoiceDate);
  const party = inv.partyId ?? null;
  const tax = headSum(inv);
  const tcs = r2(n(inv.tcsAmount));
  const ro = roundOffOf(inv.roundOff);
  const charges = r2(n(inv.chargesTaxable));
  const main = voucher(date, 'invoice', String(inv.id), [
    {
      account: ACC.RECEIVABLE,
      dr: total,
      partyId: party,
      narration: inv.number ? `Invoice ${inv.number}` : undefined,
    },
    ...taxRaw(OUT, inv, 'cr'),
    { account: ACC.TCS_PAYABLE, cr: tcs },
    { account: ro >= 0 ? ACC.ROUND_GAIN : ACC.ROUND_LOSS, cr: ro },
    { account: ACC.CHARGES_INCOME, cr: charges },
    { account: ACC.SALES, cr: r2(total - tax - tcs - ro - charges) },
  ]);
  const paid = ((inv.payments as InlinePay[] | undefined) ?? []).map((p, i) =>
    voucher(String(p.date || date), 'invoice', String(inv.id), [
      {
        account: moneyAccount(ctx, p.mode, p.accountId, 'in'),
        dr: r2(n(p.amount)),
        narration: `Payment ${i + 1} with sale`,
      },
      { account: ACC.RECEIVABLE, cr: r2(n(p.amount)), partyId: party },
    ]),
  );
  return keep(main, ...paid);
}

/** A credit note: Dr Sales Return and Output tax, Cr Receivable; a refund by cash or bank is its own voucher. */
export function postCreditNote(cn: Rec, ctx?: PostCtx): Posting[] {
  if (cn.status === 'cancelled') return [];
  const total = r2(n(cn.total));
  if (total <= 0) return [];
  const date = String(cn.invoiceDate);
  const party = cn.partyId ?? null;
  const ro = roundOffOf(cn.roundOff);
  const main = voucher(date, 'invoice', String(cn.id), [
    {
      account: ACC.RECEIVABLE,
      cr: total,
      partyId: party,
      narration: cn.number ? `Credit note ${cn.number}` : undefined,
    },
    ...taxRaw(OUT, cn, 'dr'),
    { account: ro >= 0 ? ACC.ROUND_LOSS : ACC.ROUND_GAIN, dr: ro },
    { account: ACC.SALES_RETURN, dr: r2(total - headSum(cn) - ro) },
  ]);
  const refunds = ((cn.refunds as InlinePay[] | undefined) ?? []).map((p) =>
    voucher(String(p.date || date), 'invoice', String(cn.id), [
      { account: ACC.RECEIVABLE, dr: r2(n(p.amount)), partyId: party, narration: 'Refund' },
      { account: moneyAccount(ctx, p.mode, p.accountId, 'out'), cr: r2(n(p.amount)) },
    ]),
  );
  return keep(main, ...refunds);
}

// ---- purchases ---------------------------------------------------------------------------------------------------------

/** How a purchase's GST splits between credit we claim and GST that becomes cost (tax-engine itcSplit). */
interface ItcBuckets {
  eligible?: Heads;
  ineligible?: Heads;
}
const itcOf = (p: Rec): { eligible: Heads; ineligible: Heads } => {
  const b = p.itc as ItcBuckets | undefined;
  return b?.eligible || b?.ineligible
    ? { eligible: b.eligible ?? {}, ineligible: b.ineligible ?? {} }
    : { eligible: { cgst: p.cgst, sgst: p.sgst, igst: p.igst, cess: p.cess }, ineligible: {} };
};

/**
 * A purchase bill. Dr Purchases (taxable value with charges); Dr Input GST for the credit we claim and Ineligible GST
 * expensed for the rest; Cr Payable for what the supplier is owed, Cr TDS Payable for §194Q TDS we keep. Reverse
 * charge: the supplier is owed the value without the tax, the tax is Cr RCM Payable and the credit is still claimed.
 * Payments made with the bill are their own vouchers. A debit note goes to postDebitNote.
 */
export function postPurchase(p: Rec, ctx?: PostCtx): Posting[] {
  if (p.docType === 'debit-note') return postDebitNote(p, ctx);
  if (p.docType === 'order') return [];
  const total = r2(n(p.total));
  if (total <= 0) return [];
  const date = String(p.purchaseDate);
  const party = p.supplierId ?? null;
  const { eligible } = itcOf(p);
  const taxAndCess = headSum(p);
  const ro = r2(total - n(p.taxableAmount) - taxAndCess);
  const tds = r2(n(p.tdsAmount));
  const rcm = p.reverseCharge ? taxAndCess : 0;
  const main = voucher(date, 'purchase', String(p.id), [
    {
      account: ACC.PURCHASES,
      dr: r2(n(p.taxableAmount)),
      narration: p.invoiceNumber ? `Bill ${p.invoiceNumber}` : undefined,
    },
    ...taxRaw(IN, eligible, 'dr'),
    // Whatever GST is not claimed becomes cost. It is the balancing figure against the bill's stored tax, so a paisa of
    // rounding between the per-head credit split and the stored heads can never unbalance the voucher.
    { account: ACC.INELIGIBLE_GST, dr: r2(taxAndCess - headSum(eligible)) },
    { account: ro >= 0 ? ACC.ROUND_LOSS : ACC.ROUND_GAIN, dr: ro },
    { account: ACC.PAYABLE, cr: r2(total - tds - rcm), partyId: party },
    { account: ACC.TDS_PAYABLE, cr: tds },
    { account: ACC.RCM_PAYABLE, cr: rcm },
  ]);
  const paid = ((p.payments as InlinePay[] | undefined) ?? []).map((x, i) =>
    voucher(String(x.date || date), 'purchase', String(p.id), [
      {
        account: ACC.PAYABLE,
        dr: r2(n(x.amount)),
        partyId: party,
        narration: `Payment ${i + 1} with purchase`,
      },
      { account: moneyAccount(ctx, x.mode, x.accountId, 'out'), cr: r2(n(x.amount)) },
    ]),
  );
  return keep(main, ...paid);
}

/**
 * A debit note: Dr Payable for the total; Cr Purchase Return for the value; the credit claimed on what goes back is
 * reversed (Cr Input GST) and GST that was expensed comes back out (Cr Ineligible GST expensed). A refund by cash or
 * bank is its own voucher: money coming back from the supplier.
 */
export function postDebitNote(dn: Rec, ctx?: PostCtx): Posting[] {
  const total = r2(n(dn.total));
  if (total <= 0) return [];
  const date = String(dn.purchaseDate);
  const party = dn.supplierId ?? null;
  const { eligible } = itcOf(dn);
  const ro = r2(total - n(dn.taxableAmount) - headSum(dn));
  const main = voucher(date, 'purchase', String(dn.id), [
    {
      account: ACC.PAYABLE,
      dr: total,
      partyId: party,
      narration: dn.number ? `Debit note ${dn.number}` : undefined,
    },
    ...taxRaw(IN, eligible, 'cr'),
    { account: ACC.INELIGIBLE_GST, cr: r2(headSum(dn) - headSum(eligible)) },
    { account: ro >= 0 ? ACC.ROUND_GAIN : ACC.ROUND_LOSS, cr: ro },
    { account: ACC.PURCHASE_RETURN, cr: r2(n(dn.taxableAmount)) },
  ]);
  const refund =
    dn.refundMode === 'cash' || dn.refundMode === 'bank'
      ? voucher(date, 'purchase', String(dn.id), [
          {
            account: moneyAccount(ctx, dn.refundMode, dn.refundAccountId, 'in'),
            dr: total,
            narration: 'Refund from supplier',
          },
          { account: ACC.PAYABLE, cr: total, partyId: party },
        ])
      : null;
  return keep(main, refund);
}

// ---- payments ----------------------------------------------------------------------------------------------------------

/** Sources whose money is posted with their own document (an invoice, purchase, credit or debit note). */
const POSTED_WITH_DOCUMENT = [
  'invoice_inline',
  'purchase_inline',
  'credit_note_refund',
  'debit_note_refund',
];

/**
 * Payment In: Dr Cash/Bank (Cheques in Hand for a cheque), TDS Receivable for TDS the customer kept, Discount Allowed;
 * Cr Receivable for all three. Payment Out mirrors it: Dr Payable; Cr Cash/Bank (Cheques Issued), TDS Payable for TDS we
 * deduct, Discount Received. The part not allocated to a document is the party's advance and nets in the party ledger.
 */
export function postPayment(pay: Rec, ctx?: PostCtx): Posting[] {
  if (POSTED_WITH_DOCUMENT.includes(String(pay.source || ''))) return [];
  const amount = r2(n(pay.amount));
  const tds = r2(n(pay.tdsAmount));
  const disc = r2(n(pay.discountAmount));
  const settled = r2(amount + tds + disc);
  if (settled <= 0) return [];
  const date = String(pay.paymentDate);
  const party = pay.partyId ?? null;
  const note = pay.number ? `Payment ${pay.number}` : undefined;
  if (pay.direction === 'out')
    return keep(
      voucher(date, 'payment', String(pay.id), [
        { account: ACC.PAYABLE, dr: settled, partyId: party, narration: note },
        { account: moneyAccount(ctx, pay.mode, pay.accountId, 'out'), cr: amount },
        { account: ACC.TDS_PAYABLE, cr: tds },
        { account: ACC.DISCOUNT_RECEIVED, cr: disc },
      ]),
    );
  return keep(
    voucher(date, 'payment', String(pay.id), [
      { account: moneyAccount(ctx, pay.mode, pay.accountId, 'in'), dr: amount, narration: note },
      { account: ACC.TDS_RECEIVABLE, dr: tds },
      { account: ACC.DISCOUNT_ALLOWED, dr: disc },
      { account: ACC.RECEIVABLE, cr: settled, partyId: party },
    ]),
  );
}

// ---- expenses and other income -------------------------------------------------------------------------------------------

/**
 * An expense: Dr its category account (the GST too when it is not claimed as credit) and Input GST for the credit; Cr
 * Cash/Bank for what was paid and Cr Payable (the payee) for the rest. Other income mirrors it: Dr Cash/Bank and
 * Receivable, Cr Other Income and Output GST. `amount` is before GST, as the API stores it.
 */
export function postExpense(e: Rec, ctx?: PostCtx): Posting[] {
  const amount = r2(n(e.amount));
  const tax = r2(n(e.taxAmount));
  const total = r2(amount + tax);
  if (total <= 0) return [];
  const date = String(e.expenseDate);
  const party = e.payeePartyId ?? null;
  const paid = e.paidAmount == null ? total : Math.min(total, r2(n(e.paidAmount)));
  const rest = r2(total - paid);
  const cgst = e.interstate ? 0 : r2(tax / 2);
  const heads: Heads = e.interstate ? { igst: tax } : { cgst, sgst: r2(tax - cgst) };
  const label = e.number || e.description || undefined;
  if (e.kind === 'income') {
    const out = e.exempt ? {} : heads;
    return keep(
      voucher(date, 'expense', String(e.id), [
        {
          account: moneyAccount(ctx, e.paymentMode, e.accountId, 'in'),
          dr: paid,
          narration: label,
        },
        { account: ACC.RECEIVABLE, dr: rest, partyId: party },
        ...taxRaw(OUT, out, 'cr'),
        { account: ACC.OTHER_INCOME, cr: r2(total - (e.exempt ? 0 : tax)) },
      ]),
    );
  }
  const claim = e.itcEligible !== false;
  return keep(
    voucher(date, 'expense', String(e.id), [
      {
        account: ctx?.expenseAccount?.(e.categoryId) || ACC.EXPENSES,
        dr: claim ? amount : total,
        narration: label,
      },
      ...(claim ? taxRaw(IN, heads, 'dr') : []),
      { account: moneyAccount(ctx, e.paymentMode, e.accountId, 'out'), cr: paid },
      { account: ACC.PAYABLE, cr: rest, partyId: party },
    ]),
  );
}
/** Other income is an expense record with `kind: 'income'`. */
export const postIncome = (i: Rec, ctx?: PostCtx) => postExpense({ ...i, kind: 'income' }, ctx);

// ---- cash and bank, loans, cheques, adjustments, openings (Phase 5 documents; the rules are fixed here) ---------------------

/** Money moved between cash and banks (P5-S3): Dr destination, Cr source; a fee is Dr Bank Charges, Cr source too. */
export const postTransfer = (t: {
  id: string;
  date: string;
  from: string;
  to: string;
  amount: Numeric;
  fee?: Numeric;
  narration?: string;
  refType?: string;
}): Posting[] =>
  keep(
    voucher(t.date, t.refType ?? 'transfer', t.id, [
      { account: t.to, dr: r2(n(t.amount)), narration: t.narration },
      {
        account: ACC.BANK_CHARGES,
        dr: r2(n(t.fee)),
        narration: t.fee ? 'Transfer charges' : undefined,
      },
      { account: t.from, cr: r2(n(t.amount) + n(t.fee)) },
    ]),
  );

/** Loan received: Dr Bank, Cr the loan account; a processing fee the lender keeps is Dr Bank Charges instead of Bank. */
export const postLoanDisbursal = (l: {
  id: string;
  date: string;
  loanAccount: string;
  bankAccount: string;
  amount: Numeric;
  fee?: Numeric;
  /** 'loan' for the loan itself; 'loan_payment' for a top-up recorded with the loan's payments. */
  refType?: string;
  narration?: string;
}): Posting[] =>
  keep(
    voucher(l.date, l.refType ?? 'loan', l.id, [
      {
        account: l.bankAccount,
        dr: r2(n(l.amount) - n(l.fee)),
        narration: l.narration ?? 'Loan received',
      },
      {
        account: ACC.BANK_CHARGES,
        dr: r2(n(l.fee)),
        narration: n(l.fee) ? 'Loan processing fee' : undefined,
      },
      { account: l.loanAccount, cr: r2(n(l.amount)) },
    ]),
  );

/** An EMI: Dr Loan (principal), Dr Loan Interest, Dr Bank Charges (fees); Cr Bank for the whole instalment. */
export const postLoanPayment = (l: {
  id: string;
  date: string;
  loanAccount: string;
  bankAccount: string;
  principal: Numeric;
  interest: Numeric;
  fees?: Numeric;
  /** TDS kept from the interest (§194A): Cr TDS Payable, and the bank pays that much less. */
  tds?: Numeric;
  /**
   * The part of `interest` (gross) that was credited to the lender earlier (postLoanInterestCredit) and is now paid:
   * it clears Interest Payable instead of being an expense again, and the TDS kept on it at credit (`accruedTds`) is
   * not paid to the lender.
   */
  accrued?: Numeric;
  accruedTds?: Numeric;
  refType?: string;
}): Posting[] => {
  const accrued = r2(Math.min(n(l.interest), n(l.accrued)));
  const accruedTds = r2(n(l.accruedTds));
  return keep(
    voucher(l.date, l.refType ?? 'loan', l.id, [
      { account: l.loanAccount, dr: r2(n(l.principal)), narration: 'EMI principal' },
      {
        account: ACC.INTEREST_PAYABLE,
        dr: r2(accrued - accruedTds),
        narration: accrued ? 'Interest credited earlier, now paid' : undefined,
      },
      { account: ACC.LOAN_INTEREST, dr: r2(n(l.interest) - accrued) },
      { account: ACC.BANK_CHARGES, dr: r2(n(l.fees)) },
      {
        account: ACC.TDS_PAYABLE,
        cr: r2(n(l.tds)),
        narration: n(l.tds) ? 'TDS u/s 194A' : undefined,
      },
      {
        account: l.bankAccount,
        cr: r2(n(l.principal) + n(l.interest) + n(l.fees) - n(l.tds) - accruedTds),
      },
    ]),
  );
};

/**
 * Interest credited to a lender's account but not paid yet (an EMI fallen due, or the year-end accrual): §194A makes TDS
 * due at credit or payment, whichever is first. Dr Loan Interest (the gross) / Cr Interest Payable (what the lender will
 * get) / Cr TDS Payable (kept now). The payment that later pays it clears Interest Payable (postLoanPayment `accrued`).
 */
export const postLoanInterestCredit = (c: {
  id: string;
  date: string;
  amount: Numeric;
  tds?: Numeric;
  narration?: string;
}): Posting[] =>
  keep(
    voucher(c.date, 'loan_interest', c.id, [
      {
        account: ACC.LOAN_INTEREST,
        dr: r2(n(c.amount)),
        narration: c.narration ?? 'Interest credited',
      },
      { account: ACC.INTEREST_PAYABLE, cr: r2(n(c.amount) - n(c.tds)) },
      {
        account: ACC.TDS_PAYABLE,
        cr: r2(n(c.tds)),
        narration: n(c.tds) ? 'TDS u/s 194A' : undefined,
      },
    ]),
  );

export type ChequeEvent = 'created' | 'deposited' | 'cleared' | 'bounced';
/**
 * Cheques (P5-S4). Received: created Dr Cheques in Hand / Cr Receivable; deposited only changes status; cleared Dr Bank /
 * Cr Cheques in Hand; bounced Dr Receivable / Cr Cheques in Hand (bounce charges either to the party, Dr Receivable / Cr
 * Other Income, or to us, Dr Bank Charges / Cr Bank). Issued cheques mirror it with Payable and Cheques Issued.
 */
export function postChequeEvent(c: {
  id: string;
  date: string;
  direction: 'received' | 'issued';
  event: ChequeEvent;
  amount: Numeric;
  partyId?: string | null;
  bankAccount: string;
  bounceCharges?: Numeric;
  chargeTo?: 'party' | 'bank';
}): Posting[] {
  const amt = r2(n(c.amount));
  const recv = c.direction === 'received';
  const clearing = recv ? ACC.CHEQUES_IN_HAND : ACC.CHEQUES_ISSUED;
  const control = recv ? ACC.RECEIVABLE : ACC.PAYABLE;
  const p = c.partyId ?? null;
  const v = (raw: Raw[]) => keep(voucher(c.date, 'cheque', c.id, raw));
  if (c.event === 'deposited') return [];
  if (c.event === 'created')
    return v(
      recv
        ? [
            { account: clearing, dr: amt },
            { account: control, cr: amt, partyId: p },
          ]
        : [
            { account: control, dr: amt, partyId: p },
            { account: clearing, cr: amt },
          ],
    );
  if (c.event === 'cleared')
    return v(
      recv
        ? [
            { account: c.bankAccount, dr: amt },
            { account: clearing, cr: amt },
          ]
        : [
            { account: clearing, dr: amt },
            { account: c.bankAccount, cr: amt },
          ],
    );
  const fee = r2(n(c.bounceCharges));
  const bounce: Raw[] = recv
    ? [
        { account: control, dr: amt, partyId: p },
        { account: clearing, cr: amt },
      ]
    : [
        { account: clearing, dr: amt },
        { account: control, cr: amt, partyId: p },
      ];
  const charges: Raw[] =
    c.chargeTo === 'party'
      ? [
          { account: ACC.RECEIVABLE, dr: fee, partyId: p },
          { account: ACC.OTHER_INCOME, cr: fee },
        ]
      : [
          { account: ACC.BANK_CHARGES, dr: fee },
          { account: c.bankAccount, cr: fee },
        ];
  return v([...bounce, ...charges]);
}

/**
 * Adjust bank/cash: an increase is Dr the account / Cr Opening Balance Equity, a reduction the reverse. `counter` names
 * another account for the other side (Owner's Capital for a deposit, Drawings or Bank Charges for a withdrawal, Other
 * Income or Cash Over / Short for an adjustment counted as income or loss).
 */
export const postAdjustment = (x: {
  id: string;
  date: string;
  account: string;
  amount: Numeric;
  direction: 'increase' | 'reduce';
  narration?: string;
  counter?: string;
}): Posting[] =>
  keep(
    voucher(x.date, 'adjustment', x.id, [
      {
        account: x.account,
        [x.direction === 'increase' ? 'dr' : 'cr']: r2(n(x.amount)),
        narration: x.narration,
      },
      {
        account: x.counter ?? ACC.OPENING_EQUITY,
        [x.direction === 'increase' ? 'cr' : 'dr']: r2(n(x.amount)),
      },
    ]),
  );

/** An opening balance of an account or a party, against Opening Balance Equity. */
export const postOpening = (o: {
  id: string;
  date: string;
  account: string;
  amount: Numeric;
  side: 'Dr' | 'Cr';
  partyId?: string | null;
}): Posting[] =>
  keep(
    voucher(o.date, 'opening', o.id, [
      {
        account: o.account,
        [o.side === 'Dr' ? 'dr' : 'cr']: r2(n(o.amount)),
        partyId: o.partyId,
        narration: 'Opening balance',
      },
      { account: ACC.OPENING_EQUITY, [o.side === 'Dr' ? 'cr' : 'dr']: r2(n(o.amount)) },
    ]),
  );

/** A manual journal (P4-S7). Must balance; throws PostingError otherwise. */
export function postJournal(j: {
  id: string;
  date: string;
  narration?: string;
  rows: {
    account: string;
    debit?: Numeric;
    credit?: Numeric;
    partyId?: string | null;
    narration?: string;
  }[];
}): Posting[] {
  return keep(
    voucher(
      j.date,
      'journal',
      j.id,
      j.rows.map((r) => ({
        account: r.account,
        dr: r2(n(r.debit)),
        cr: r2(n(r.credit)),
        partyId: r.partyId,
        narration: r.narration || j.narration,
      })),
    ),
  );
}

// ---- reading the ledger back -------------------------------------------------------------------------------------------

/** The side an account's balance normally sits on. */
export const naturalSide = (kind: AccountKind): 'debit' | 'credit' =>
  kind === 'asset' || kind === 'expense' ? 'debit' : 'credit';

/** A balance in the account's natural direction: positive when it sits where it normally does. */
export const balanceOf = (kind: AccountKind, debit: Numeric, credit: Numeric) =>
  r2(naturalSide(kind) === 'debit' ? n(debit) - n(credit) : n(credit) - n(debit));

/** `{ amount, side }` for display ("₹48,300 Dr"). */
export const drCr = (debit: Numeric, credit: Numeric) => {
  const net = r2(n(debit) - n(credit));
  return { amount: Math.abs(net), side: net >= 0 ? ('Dr' as const) : ('Cr' as const) };
};

/**
 * Trial balance from per-account totals. `balanced` is the check P4 stands on: Σ debit = Σ credit over the whole ledger.
 */
export function trialBalance(
  rows: { code: string; name: string; kind: AccountKind; debit: Numeric; credit: Numeric }[],
) {
  const lines = rows
    .map((r) => {
      const net = r2(n(r.debit) - n(r.credit));
      return {
        code: r.code,
        name: r.name,
        kind: r.kind,
        debit: net > 0 ? net : 0,
        credit: net < 0 ? -net : 0,
      };
    })
    .filter((l) => l.debit || l.credit)
    .sort((x, y) => x.code.localeCompare(y.code));
  const debit = r2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = r2(lines.reduce((s, l) => s + l.credit, 0));
  return { lines, debit, credit, balanced: Math.abs(debit - credit) < EPS };
}

/** Running balance down a list of entries, in Dr/Cr terms, oldest first. */
export function runningBalance(
  entries: { debit: Numeric; credit: Numeric }[],
  opening: Numeric = 0,
) {
  let run = r2(opening);
  return entries.map((e) => {
    run = r2(run + n(e.debit) - n(e.credit));
    return run;
  });
}
