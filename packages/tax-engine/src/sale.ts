// Vyapar parity Phase 2 (sale enhancements): the pure rules behind salesman commission, inline payments, additional
// charges, the save-time guards, receipts with discount/TDS, returns and sale orders. Shared by the API and the web
// screens so both decide the same way.

import type { Numeric, Rec } from './types.ts';
import { finiteNonNeg, r2, sum } from './money.ts';
import { allocatePayment, type OpenDoc } from './payments.ts';

const n = (v: Numeric) => Number(v) || 0;
const EPS = 0.005;

// ---- P2-S1 salesman --------------------------------------------------------------------------------------------------

export type CommissionBasis = 'sale' | 'collection';

/**
 * Commission for a salesman. On `sale` (the default) it is earned on sales net of GST and returns; on `collection`, on
 * the money collected. Never negative: a month with more returns than sales earns nothing rather than a debt.
 */
export function commission(o: {
  sales: Numeric;
  returns?: Numeric;
  collected?: Numeric;
  basis?: CommissionBasis;
  pct: Numeric;
}) {
  const base = o.basis === 'collection' ? n(o.collected) : n(o.sales) - n(o.returns);
  return r2((Math.max(0, base) * Math.min(Math.max(0, n(o.pct)), 100)) / 100);
}

/**
 * What the Salesman screen shows for one person over a period. `invoices` are that salesman's documents in the period
 * (credit notes included, cancelled ones skipped). Sales are net of GST (taxable value), the same figure the Sale
 * Report shows, so the two agree.
 */
export function salesmanPerformance(
  invoices: Rec[],
  o: { pct?: Numeric; basis?: CommissionBasis; monthlyTarget?: Numeric } = {},
) {
  let sales = 0;
  let returns = 0;
  let billed = 0;
  let collected = 0;
  for (const inv of invoices || []) {
    if (!inv || inv.status === 'cancelled') continue;
    if (inv.invoiceType === 'credit-note') {
      returns += n(inv.taxableAmount);
      billed -= n(inv.total);
      continue;
    }
    if (!['tax-invoice', 'bill-of-supply', 'composition'].includes(inv.invoiceType)) continue;
    sales += n(inv.taxableAmount);
    billed += n(inv.total);
    collected += n(inv.paidAmount);
  }
  const target = n(o.monthlyTarget);
  const netSales = r2(sales - returns);
  return {
    sales: r2(sales),
    returns: r2(returns),
    netSales,
    collected: r2(collected),
    outstanding: r2(Math.max(0, billed - collected)),
    commission: commission({ sales, returns, collected, basis: o.basis, pct: o.pct ?? 0 }),
    targetPct: target > 0 ? Math.round((netSales / target) * 1000) / 10 : null,
  };
}

// ---- P2-S2 inline payments ----------------------------------------------------------------------------------------------

export const INLINE_PAYMENT_MODES = ['cash', 'upi', 'bank', 'cheque', 'card', 'other'] as const;

export interface InlinePaymentRow {
  mode?: string;
  accountId?: string | null;
  amount?: Numeric;
  reference?: string;
  chequeDate?: string | null;
}

/** A cheque dated after today: the row shows a "post-dated" chip. */
export const isPostDated = (chequeDate: string | null | undefined, today: string) =>
  !!chequeDate && chequeDate > today;

/**
 * Checks the payment rows of an invoice and sums them. `earlier` is money already applied through separate receipts
 * (read-only on the invoice). Errors carry a code the API answers with and the row they belong to (-1 = the block).
 * `requireAccount` is on once bank accounts exist (P5): then UPI and bank rows must name one.
 */
export function inlinePaymentCheck(o: {
  payments: InlinePaymentRow[];
  total: Numeric;
  earlier?: Numeric;
  requireAccount?: boolean;
}) {
  const errors: { row: number; code: string; message: string }[] = [];
  const rows = o.payments || [];
  rows.forEach((p, i) => {
    if (!(n(p.amount) > 0))
      errors.push({ row: i, code: 'AMOUNT', message: 'Enter an amount above zero' });
    if (p.mode === 'cheque' && !p.chequeDate)
      errors.push({ row: i, code: 'CHEQUE_DATE', message: 'A cheque needs its date' });
    if (o.requireAccount && (p.mode === 'bank' || p.mode === 'upi') && !p.accountId)
      errors.push({ row: i, code: 'ACCOUNT', message: 'Pick the bank account it went to' });
  });
  const total = r2(n(o.total));
  const earlier = r2(n(o.earlier));
  const received = r2(sum(rows.map((p) => finiteNonNeg(p.amount))));
  const paid = r2(received + earlier);
  const overBy = r2(Math.max(0, paid - total));
  if (overBy > EPS)
    errors.push({
      row: -1,
      code: 'OVER_ALLOCATED',
      message: `Received exceeds total by ₹${overBy.toFixed(2)}`,
    });
  const balance = r2(Math.max(0, total - paid));
  const status = total > 0 && paid >= total - EPS ? 'paid' : paid > EPS ? 'partial' : 'unpaid';
  return { ok: errors.length === 0, errors, received, earlier, paid, balance, overBy, status };
}

/**
 * The rows the block starts with. A cash sale opens with one Cash row for the whole total; a credit sale with none.
 * With "Auto-fill received" on, a single row follows the total as it changes.
 */
export function syncInlinePayments(
  rows: InlinePaymentRow[],
  o: { saleType: 'cash' | 'credit'; total: Numeric; earlier?: Numeric; autofill?: boolean },
): InlinePaymentRow[] {
  const due = r2(Math.max(0, n(o.total) - n(o.earlier)));
  if (o.saleType === 'cash' && !rows.length)
    return [{ mode: 'cash', amount: due, reference: '', accountId: null, chequeDate: null }];
  if (o.autofill && rows.length === 1 && n(rows[0].amount) !== due)
    return [{ ...rows[0], amount: due }];
  return rows;
}

// ---- P2-S3 additional charges -------------------------------------------------------------------------------------------

export interface Charge {
  id?: string;
  name?: string;
  amount?: Numeric;
  gstRate?: Numeric;
  hsn?: string;
  taxable?: boolean;
}

/** Presets offered in Settings > Transaction. SAC codes from the GST services classification. */
export const DEFAULT_CHARGE_PRESETS: Required<Pick<Charge, 'name' | 'gstRate' | 'hsn'>>[] = [
  { name: 'Shipping', gstRate: 18, hsn: '9965' },
  { name: 'Packaging', gstRate: 18, hsn: '9985' },
  { name: 'Installation', gstRate: 18, hsn: '9987' },
  { name: 'Loading & unloading', gstRate: 18, hsn: '9967' },
];

/** Charges with a positive amount, numbers cleaned. Rows a user left blank drop out. */
export const cleanCharges = (charges: Charge[] | null | undefined) =>
  (charges || [])
    .map((c) => ({
      id: c.id,
      name: String(c.name || 'Charge').trim() || 'Charge',
      amount: r2(finiteNonNeg(c.amount)),
      gstRate: Math.min(finiteNonNeg(c.gstRate), 100),
      hsn: String(c.hsn || '').trim(),
      taxable: c.taxable !== false,
    }))
    .filter((c) => c.amount > 0);

/**
 * Charges as invoice lines, for the GST returns, HSN summary and reports, which work line by line. `isCharge` keeps
 * them out of stock and product sales (the rule delivery-charge lines already follow). On a tax-inclusive invoice the
 * line rate carries the tax, because there a line's rate is read as tax-inclusive; the charge amount itself is always
 * before tax.
 */
export const chargeLines = (charges: Charge[] | null | undefined, taxInclusive = false) =>
  cleanCharges(charges).map((c) => {
    const rate = c.taxable ? c.gstRate : 0;
    return {
      name: c.name,
      hsn: c.hsn,
      quantity: 1,
      unit: 'OTH',
      rate: taxInclusive && rate > 0 ? r2(c.amount * (1 + rate / 100)) : c.amount,
      discount: 0,
      taxPercent: rate,
      cessPercent: 0,
      isCharge: true,
      chargeId: c.id,
    };
  });

/** A bill's lines with its additional charges appended (what GST returns and reports should iterate). */
export const billLinesWithCharges = (bill: Rec | null | undefined) => {
  const data = bill?.data || {};
  const items = data.items || [];
  const extra = chargeLines(data.charges, !!data.taxInclusive);
  return extra.length ? [...items, ...extra] : items;
};

/**
 * A credit note's share of an invoice's charges: each charge scaled by the part of the goods returned. `ratio` is
 * returned taxable value / invoiced taxable value of the goods.
 */
export const proportionalCharges = (charges: Charge[] | null | undefined, ratio: Numeric) => {
  const k = Math.min(Math.max(0, n(ratio)), 1);
  return cleanCharges(charges)
    .map((c) => ({ ...c, amount: r2(c.amount * k) }))
    .filter((c) => c.amount > 0);
};

// ---- P2-S4 guards -------------------------------------------------------------------------------------------------------

export const CASH_LIMIT_269ST = 200_000;

/**
 * Section 269ST: no one may receive ₹2,00,000 or more in cash from one person in a day (or for one transaction or
 * event). Save is still allowed with a typed acknowledgement; the result says by how much.
 */
export function cashLimitCheck(o: { dayCashTotal?: Numeric; newCash: Numeric; limit?: Numeric }) {
  const limit = n(o.limit) > 0 ? n(o.limit) : CASH_LIMIT_269ST;
  const total = r2(n(o.dayCashTotal) + finiteNonNeg(o.newCash));
  const breached = finiteNonNeg(o.newCash) > 0 && total >= limit;
  return { breached, total, limit, over: breached ? r2(total - limit) : 0 };
}

/**
 * Whether a document dated `date` falls in a closed period: on or before the lock date, inside a closed financial year,
 * or in a month whose GST return is marked filed (`filedMonths` as 'YYYY-MM'). The owner may override; the API records
 * the override in the audit log.
 */
export function periodLocked(o: {
  date: string;
  lockDate?: string | null;
  filedMonths?: string[] | null;
  closedRanges?: { start: string; end: string }[] | null;
  role?: string;
}) {
  const reason =
    o.lockDate && o.date <= o.lockDate
      ? 'lock_date'
      : (o.closedRanges || []).some((r) => o.date >= r.start && o.date <= r.end)
        ? 'closed_year'
        : (o.filedMonths || []).includes(String(o.date).slice(0, 7))
          ? 'filed_month'
          : null;
  return { locked: !!reason, reason, canOverride: !!reason && o.role === 'owner' };
}

/** Lines that sell more of a tracked item than is in stock. `mode` comes from Settings > Transaction. */
export function negativeStockCheck(
  lines: { itemId?: string | null; name?: string; quantity?: Numeric }[],
  stock: Record<string, Numeric>,
  mode: 'allow' | 'warn' | 'block' = 'warn',
) {
  const want: Record<string, { name: string; qty: number }> = {};
  for (const l of lines || []) {
    if (!l.itemId || !(l.itemId in stock)) continue;
    const w = (want[l.itemId] ??= { name: l.name || '', qty: 0 });
    w.qty += finiteNonNeg(l.quantity);
  }
  const short = Object.entries(want)
    .map(([itemId, w]) => ({
      itemId,
      name: w.name,
      wanted: w.qty,
      inStock: n(stock[itemId]),
      short: Math.round((w.qty - n(stock[itemId])) * 1000) / 1000,
    }))
    .filter((s) => s.short > 0);
  return { short, action: mode === 'allow' || !short.length ? 'none' : mode };
}

/** Goods worth more than the threshold (₹50,000 by default) need an e-way bill: the editor offers to make one. */
export const needsEwayBill = (goodsValue: Numeric, threshold: Numeric = 50_000) =>
  n(goodsValue) > n(threshold);

// ---- P2-S5 receipts -------------------------------------------------------------------------------------------------------

/**
 * Applies a receipt to open invoices: the sale side of the shared allocation engine (payments.ts `allocatePayment`).
 * What it settles is the money plus any discount allowed and TDS the payer kept (`settled = amount + discount + tds`);
 * whatever is not applied stays as the party's advance. `oldest_first` fills invoices by date; `manual` takes the
 * user's `manual` amounts (by invoice id), each capped at what is pending.
 */
export function allocateReceipt(o: {
  amount: Numeric;
  discount?: Numeric;
  tds?: Numeric;
  invoices: OpenDoc[];
  strategy?: 'oldest_first' | 'manual';
  manual?: Record<string, Numeric>;
}) {
  const { allocations, ...rest } = allocatePayment({ ...o, direction: 'in', docs: o.invoices });
  return {
    ...rest,
    allocations: allocations.map((a) => ({ invoiceId: a.docId, amount: a.amount })),
  };
}

// ---- P2-S6 returns and sale orders ----------------------------------------------------------------------------------------

/** A line identity that survives edits: the item id when there is one, else the name. */
const lineKey = (l: Rec) =>
  l.itemId || l.productId
    ? `id:${l.itemId || l.productId}`
    : `nm:${String(l.name || '')
        .trim()
        .toLowerCase()}`;
const nameKey = (l: Rec) =>
  `nm:${String(l.name || '')
    .trim()
    .toLowerCase()}`;
const idOf = (l: Rec) => (l.itemId || l.productId || null) as string | null;

/**
 * Which of `base` lines a line refers to: the one with the same item id, else the one with the same name. A line saved
 * with an item id (the screens attach one once the product exists) still matches a line typed by name, and the
 * reverse, so a return or delivery is never refused just because one side carries the id.
 */
function sameLine<T extends { id: string | null; name: string }>(l: Rec, base: T[]) {
  const id = idOf(l);
  const byId = id ? base.filter((b) => b.id === id) : [];
  return byId.length ? byId : base.filter((b) => b.name === nameKey(l));
}

/**
 * How much of each invoice line can still be returned: sold less what earlier credit notes against the invoice took
 * back. Cancelled credit notes do not count. Keyed by item id (or name for free-typed lines).
 */
export function returnableQty(invoiceLines: Rec[], priorCreditNotes: Rec[]) {
  const left: Record<string, number> = {};
  const base: { key: string; id: string | null; name: string }[] = [];
  for (const l of invoiceLines || []) {
    left[lineKey(l)] = (left[lineKey(l)] || 0) + finiteNonNeg(l.quantity);
    base.push({ key: lineKey(l), id: idOf(l), name: nameKey(l) });
  }
  for (const cn of priorCreditNotes || []) {
    if (!cn || cn.status === 'cancelled') continue;
    for (const l of cn.lines || cn.items || []) {
      const target = sameLine(l, base)[0];
      if (target) left[target.key] -= finiteNonNeg(l.quantity);
    }
  }
  for (const k of Object.keys(left)) left[k] = Math.max(0, Math.round(left[k] * 1000) / 1000);
  return left;
}

/** Lines of a credit note that return more than is left. Empty = fine. */
export function overReturns(returnLines: Rec[], returnable: Record<string, number>) {
  const want: Record<string, { name: string; qty: number }> = {};
  for (const l of returnLines || []) {
    // Keyed like `returnable`: by id, else by name when only the name is there.
    const k = lineKey(l) in returnable || !(nameKey(l) in returnable) ? lineKey(l) : nameKey(l);
    const w = (want[k] ??= { name: String(l.name || ''), qty: 0 });
    w.qty += finiteNonNeg(l.quantity);
  }
  return Object.entries(want)
    .filter(([k, w]) => w.qty > (returnable[k] ?? 0) + 1e-9)
    .map(([k, w]) => ({ key: k, name: w.name, wanted: w.qty, returnable: returnable[k] ?? 0 }));
}

export const RETURN_REASONS = [
  'sales-return',
  'post-sale-discount',
  'deficiency-in-service',
  'correction',
  'others',
] as const;

/**
 * Per line of an order: ordered, fulfilled so far by the documents converted from it (cancelled ones skipped) and
 * pending. Shared by sale orders (fulfilled = invoiced) and purchase orders (fulfilled = received on a purchase bill).
 * `state` is none / some / all fulfilled, or cancelled; each side names those states its own way.
 */
export function orderProgress(orderLines: Rec[], docs: Rec[], cancelled = false) {
  // Every delivered line is a pool; each order line draws on the pools of its item (by id, else by name), so a
  // quantity is never counted for two order lines.
  const pool: { id: string | null; name: string; left: number }[] = [];
  for (const d of docs || []) {
    if (!d || d.status === 'cancelled') continue;
    for (const l of d.lines || d.items || [])
      pool.push({ id: idOf(l), name: nameKey(l), left: finiteNonNeg(l.quantity) });
  }
  const lines = (orderLines || []).map((l) => {
    const ordered = finiteNonNeg(l.quantity);
    let fulfilled = 0;
    for (const p of sameLine(l, pool)) {
      const take = Math.min(p.left, ordered - fulfilled);
      if (take <= 0) continue;
      p.left -= take;
      fulfilled += take;
    }
    return {
      key: lineKey(l),
      name: l.name,
      ordered,
      fulfilled: Math.round(fulfilled * 1000) / 1000,
      pending: Math.round((ordered - fulfilled) * 1000) / 1000,
    };
  });
  const ordered = sum(lines.map((l) => l.ordered));
  const fulfilled = sum(lines.map((l) => l.fulfilled));
  const state = cancelled
    ? 'cancelled'
    : fulfilled <= 0
      ? 'none'
      : fulfilled >= ordered - 1e-9
        ? 'all'
        : 'some';
  return { lines, state };
}

/**
 * A sale order's progress: per line ordered, invoiced and pending; status Open (nothing invoiced), Partially invoiced,
 * Closed (all invoiced) or Cancelled.
 */
export function saleOrderProgress(orderLines: Rec[], invoices: Rec[], cancelled = false) {
  const p = orderProgress(orderLines, invoices, cancelled);
  const status = {
    none: 'open',
    some: 'partially-invoiced',
    all: 'closed',
    cancelled: 'cancelled',
  }[p.state];
  return {
    lines: p.lines.map(({ fulfilled, ...l }) => ({ ...l, invoiced: fulfilled })),
    status,
  };
}
