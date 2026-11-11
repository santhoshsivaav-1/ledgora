// Vyapar parity P12 (Point of Sale): the counter bill. Pure functions only. The POS screen and the API both build the
// sale with `posInvoiceInput`, so what the cashier sees totalled is what the server saves: the same lines, the same
// discount spread, the same rounding, all through `computeInvoiceTotals`.
//
// A bill discount is taken off the taxable value line by line (before GST, as Section 15(3)(a) of the CGST Act allows
// for a discount shown on the invoice), not off the grand total. Loyalty points redeemed are a bill discount too.
import { computeInvoiceTotals } from './totals.ts';
import type { Rec } from './types.ts';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000;
const pos0 = (n: unknown) => Math.max(0, Number(n) || 0);

export const POS_PAYMENT_MODES = ['cash', 'upi', 'card', 'bank', 'cheque', 'other'] as const;
export type PosPaymentMode = (typeof POS_PAYMENT_MODES)[number];

export interface PosLoyaltyRule {
  enabled: boolean;
  /** Points earned for each ₹100 of the bill total. */
  earnPer100: number;
  /** Rupees one point is worth when redeemed. */
  pointValue: number;
  /** A bill below this earns nothing. */
  minBill: number;
  /** At most this % of a bill can be paid with points. */
  maxRedeemPercent: number;
}

export interface PosSettings {
  billDiscount: boolean;
  /** One GST rate for every line of the bill (Vyapar "Bill Tax"). */
  billTax: boolean;
  freeQty: boolean;
  loyalty: PosLoyaltyRule;
  roundOff: 'nearest' | 'up' | 'down' | 'none';
  /** Typing a number in the search box and pressing * sets the selected line's quantity; a repeat scan adds one. */
  directQtyChange: boolean;
  primaryAction: 'save-print' | 'save-new';
  /** Are item prices typed and shown with GST in them? */
  pricing: 'without-tax' | 'with-tax';
  /** Payment modes shown on the counter. Cash is always one of them. */
  paymentModes: PosPaymentMode[];
  /** Account each mode is received into (payment_accounts id); unset = the default for the mode. */
  modeAccounts: Partial<Record<PosPaymentMode, string>>;
  /** A bill without a customer is a cash sale to the walk-in "Cash Sale" party. */
  cashSaleDefault: boolean;
  /** Receipt paper: thermal 80 mm or 58 mm, or A4/A5 through the invoice print. */
  paper: '80mm' | '58mm' | 'a4';
  receiptFooter: string;
  /** Stock is checked at save; this lets a counter sell into negative without the confirm step. */
  allowNegativeStock: boolean;
}

export const DEFAULT_POS_SETTINGS: PosSettings = {
  billDiscount: true,
  billTax: false,
  freeQty: false,
  loyalty: { enabled: false, earnPer100: 1, pointValue: 1, minBill: 0, maxRedeemPercent: 50 },
  roundOff: 'nearest',
  directQtyChange: true,
  primaryAction: 'save-print',
  pricing: 'with-tax',
  paymentModes: ['cash', 'upi', 'card'],
  modeAccounts: {},
  cashSaleDefault: true,
  paper: '80mm',
  receiptFooter: 'Thank you! Visit again.',
  allowNegativeStock: false,
};

const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  allowed.includes(v as T) ? (v as T) : dflt;

/** Settings as stored (any shape, partial, older) made whole. Unknown modes are dropped; cash is always there. */
export function posSettings(raw: Rec | null | undefined): PosSettings {
  const s = (raw ?? {}) as Rec;
  const d = DEFAULT_POS_SETTINGS;
  const l = (s.loyalty ?? {}) as Rec;
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  const modes = Array.isArray(s.paymentModes)
    ? s.paymentModes.filter((m: unknown) => POS_PAYMENT_MODES.includes(m as PosPaymentMode))
    : d.paymentModes;
  return {
    billDiscount: bool(s.billDiscount, d.billDiscount),
    billTax: bool(s.billTax, d.billTax),
    freeQty: bool(s.freeQty, d.freeQty),
    loyalty: {
      enabled: bool(l.enabled, d.loyalty.enabled),
      earnPer100: pos0(l.earnPer100 ?? d.loyalty.earnPer100),
      pointValue: pos0(l.pointValue ?? d.loyalty.pointValue),
      minBill: pos0(l.minBill ?? d.loyalty.minBill),
      maxRedeemPercent: Math.min(100, pos0(l.maxRedeemPercent ?? d.loyalty.maxRedeemPercent)),
    },
    roundOff: pick(s.roundOff, ['nearest', 'up', 'down', 'none'] as const, d.roundOff),
    directQtyChange: bool(s.directQtyChange, d.directQtyChange),
    primaryAction: pick(s.primaryAction, ['save-print', 'save-new'] as const, d.primaryAction),
    pricing: pick(s.pricing, ['without-tax', 'with-tax'] as const, d.pricing),
    paymentModes: [
      'cash',
      ...new Set(modes.filter((m: string) => m !== 'cash')),
    ] as PosPaymentMode[],
    modeAccounts: Object.fromEntries(
      Object.entries((s.modeAccounts ?? {}) as Rec).filter(
        ([k, v]) => POS_PAYMENT_MODES.includes(k as PosPaymentMode) && typeof v === 'string' && v,
      ),
    ) as PosSettings['modeAccounts'],
    cashSaleDefault: bool(s.cashSaleDefault, d.cashSaleDefault),
    paper: pick(s.paper, ['80mm', '58mm', 'a4'] as const, d.paper),
    receiptFooter: String(s.receiptFooter ?? d.receiptFooter).slice(0, 300),
    allowNegativeStock: bool(s.allowNegativeStock, d.allowNegativeStock),
  };
}

// ---- the cart ------------------------------------------------------------------------------------------------------

export interface PosLine {
  key: string;
  itemId?: string | null;
  code?: string;
  name: string;
  hsn?: string;
  unit: string;
  quantity: number;
  /** Given free with the line (Free Item Quantity): goes out of stock, is not charged. */
  freeQty?: number;
  /** Price per unit as the counter prices it: with GST when settings.pricing is 'with-tax'. */
  rate: number;
  discount?: number;
  discountType?: 'amount' | 'percent';
  taxPercent: number;
  cessPercent?: number;
}

export interface PosBill {
  lines: PosLine[];
  billDiscount?: { type: 'amount' | 'percent'; value: number };
  /** One GST rate for the whole bill, used when settings.billTax is on. */
  billTaxPercent?: number | null;
  charges?: { name: string; amount: number; gstRate?: number }[];
  redeemPoints?: number;
}

export interface PosItem {
  id: string;
  name: string;
  sku?: string | null;
  hsn?: string;
  unit: string;
  salePrice: number;
  taxPercent: number;
  cessPercent?: number;
  /** Is items.salePrice stored with GST in it? (items.extra.salePriceInclTax) */
  priceInclTax?: boolean;
}

const lineKey = (itemId: string | null | undefined, unit: string, rate: number) =>
  `${itemId ?? 'free'}|${unit}|${r2(rate)}`;

/** The item's price as the counter shows it: converted to or from GST-inclusive to match settings.pricing. */
export function counterRate(item: PosItem, pricing: PosSettings['pricing']) {
  const t = 1 + pos0(item.taxPercent) / 100;
  const price = pos0(item.salePrice);
  const incl = !!item.priceInclTax;
  if (pricing === 'with-tax') return r2(incl ? price : price * t);
  return r2(incl ? price / t : price);
}

/** Adds an item (a scan or a pick). The same item at the same unit and price adds to its line instead of a new one. */
export function cartAdd(
  lines: PosLine[],
  item: PosItem,
  settings: PosSettings,
  qty = 1,
): PosLine[] {
  const rate = counterRate(item, settings.pricing);
  const key = lineKey(item.id, item.unit, rate);
  const at = lines.findIndex((l) => l.key === key);
  if (at >= 0)
    return lines.map((l, i) => (i === at ? { ...l, quantity: r3(l.quantity + qty) } : l));
  return [
    ...lines,
    {
      key,
      itemId: item.id,
      code: item.sku ?? '',
      name: item.name,
      hsn: item.hsn ?? '',
      unit: item.unit || 'PCS',
      quantity: r3(qty),
      freeQty: 0,
      rate,
      discount: 0,
      discountType: 'amount',
      taxPercent: pos0(item.taxPercent),
      cessPercent: pos0(item.cessPercent),
    },
  ];
}

/** Changes one line. A quantity of 0 or less removes it. */
export function cartUpdate(lines: PosLine[], key: string, patch: Partial<PosLine>): PosLine[] {
  return lines.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.quantity > 0);
}

/** The amount the line's own discount takes off, in counter money (with tax when pricing is with-tax). */
const ownDiscount = (l: PosLine) => {
  const gross = l.quantity * l.rate;
  const d = pos0(l.discount);
  return Math.min(gross, l.discountType === 'percent' ? (gross * Math.min(d, 100)) / 100 : d);
};

/**
 * Spreads a bill-level discount over the lines in proportion to what each line is worth after its own discount, in
 * paise, the last line taking the remainder so the parts add up to the whole. Never more than a line is worth.
 */
export function spreadDiscount(values: number[], discount: number): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  const want = Math.min(r2(pos0(discount)), r2(total));
  if (want <= 0 || total <= 0) return values.map(() => 0);
  const out = values.map((v) => Math.floor((Math.max(0, v) / total) * want * 100) / 100);
  let left = r2(want - out.reduce((s, v) => s + v, 0));
  for (let i = values.length - 1; i >= 0 && left > 0; i--) {
    const room = r2(Math.max(0, values[i]) - out[i]);
    const add = Math.min(room, left);
    out[i] = r2(out[i] + add);
    left = r2(left - add);
  }
  return out;
}

/** The rupee value of a bill discount typed as amount or percent, on what the lines are worth after their own discounts. */
export function billDiscountAmount(bill: PosBill, settings: PosSettings) {
  if (!settings.billDiscount || !bill.billDiscount) return 0;
  const base = bill.lines.reduce((s, l) => s + l.quantity * l.rate - ownDiscount(l), 0);
  const v = pos0(bill.billDiscount.value);
  return r2(
    Math.min(base, bill.billDiscount.type === 'percent' ? (base * Math.min(v, 100)) / 100 : v),
  );
}

/** Rupees the given points are worth. */
export const pointsValue = (points: number, rule: PosLoyaltyRule) =>
  r2(pos0(points) * rule.pointValue);

/** Points the bill earns: whole points per ₹100 of the total; nothing below the minimum bill or with loyalty off. */
export function pointsEarned(total: number, rule: PosLoyaltyRule) {
  if (!rule.enabled || total <= 0 || total < rule.minBill) return 0;
  return Math.floor((total / 100) * rule.earnPer100);
}

/** Most points a bill can take: no more than the customer has, nor than max % of the bill is worth. */
export function maxRedeemable(balance: number, billBeforePoints: number, rule: PosLoyaltyRule) {
  if (!rule.enabled || rule.pointValue <= 0) return 0;
  const cap = (pos0(billBeforePoints) * rule.maxRedeemPercent) / 100;
  return Math.max(0, Math.min(Math.floor(pos0(balance)), Math.floor(cap / rule.pointValue + 1e-9)));
}

export interface PosInvoiceLine {
  itemId: string | null;
  name: string;
  hsn: string;
  unit: string;
  quantity: number;
  rate: number;
  discount: number;
  discountType: 'amount';
  taxPercent: number;
  cessPercent: number;
  description: string;
}

/**
 * The cart as invoice lines. Each line's discount = its own discount + free quantity at its rate + its share of the
 * bill discount and the points redeemed. Free quantity goes on the line's quantity so it leaves stock.
 */
export function posInvoiceLines(bill: PosBill, settings: PosSettings): PosInvoiceLine[] {
  const lines = bill.lines.filter((l) => l.quantity > 0);
  const taxOverride =
    settings.billTax && bill.billTaxPercent != null ? pos0(bill.billTaxPercent) : null;
  const worth = lines.map((l) => r2(l.quantity * l.rate - ownDiscount(l)));
  const points = settings.loyalty.enabled
    ? pointsValue(bill.redeemPoints ?? 0, settings.loyalty)
    : 0;
  const share = spreadDiscount(worth, billDiscountAmount({ ...bill, lines }, settings) + points);
  return lines.map((l, i) => {
    const free = settings.freeQty ? pos0(l.freeQty) : 0;
    return {
      itemId: l.itemId ?? null,
      name: l.name,
      hsn: l.hsn ?? '',
      unit: l.unit || 'PCS',
      quantity: r3(l.quantity + free),
      rate: l.rate,
      discount: r2(ownDiscount(l) + free * l.rate + share[i]),
      discountType: 'amount',
      taxPercent: taxOverride ?? pos0(l.taxPercent),
      cessPercent: pos0(l.cessPercent),
      description: free ? `Includes ${r3(free)} free` : '',
    };
  });
}

const optionsFor = (settings: PosSettings) =>
  settings.roundOff === 'none'
    ? { showRoundOff: false }
    : { showRoundOff: true, roundOffMode: settings.roundOff };

const chargesOf = (bill: PosBill) =>
  (bill.charges ?? [])
    .filter((c) => c.name && pos0(c.amount) > 0)
    .map((c) => ({ name: c.name, amount: r2(c.amount), gstRate: pos0(c.gstRate), taxable: true }));

/** Totals as the server will save them (pass the same placeOfSupply/party state and the business state). */
export function posTotals(
  bill: PosBill,
  settings: PosSettings,
  ctx: { businessState?: string; partyState?: string; partyGstin?: string } = {},
) {
  const lines = posInvoiceLines(bill, settings);
  const t = computeInvoiceTotals({
    items: lines,
    profile: { country: 'India', state: ctx.businessState ?? '' },
    client: { state: ctx.partyState || ctx.businessState || '', gstin: ctx.partyGstin ?? '' },
    taxInclusive: settings.pricing === 'with-tax',
    invoiceOptions: optionsFor(settings),
    charges: chargesOf(bill),
  }) as Rec;
  const quantity = r3(bill.lines.reduce((s, l) => s + l.quantity, 0));
  const lineView = lines.map((l, i) => {
    const c = (t.lines as Rec[])[i];
    return {
      key: bill.lines.filter((x) => x.quantity > 0)[i].key,
      /** Price per unit without tax, as the screen's column shows it. */
      priceExTax:
        settings.pricing === 'with-tax' ? r2(l.rate / (1 + l.taxPercent / 100)) : r2(l.rate),
      discount: r2(l.discount),
      tax: r2(c.tax + c.cess),
      total: r2(c.taxable + c.tax + c.cess),
    };
  });
  return {
    lines: lineView,
    items: bill.lines.filter((l) => l.quantity > 0).length,
    quantity,
    subtotal: r2(t.subtotal),
    discount: r2(t.totalDiscount),
    billDiscount: billDiscountAmount(bill, settings),
    pointsValue: settings.loyalty.enabled
      ? pointsValue(bill.redeemPoints ?? 0, settings.loyalty)
      : 0,
    taxable: r2(t.taxableAmount),
    cgst: r2(t.cgst),
    sgst: r2((t.sgst ?? 0) + (t.utgst ?? 0)),
    igst: r2(t.igst),
    cess: r2(t.cess),
    tax: r2(t.totalTaxAmount),
    charges: r2(chargesOf(bill).reduce((s, c) => s + c.amount, 0)),
    roundOff: r2(t.roundOff),
    total: r2(t.total),
  };
}

// ---- tender ------------------------------------------------------------------------------------------------------

export interface Tender {
  mode: PosPaymentMode;
  amount: number;
  accountId?: string | null;
  reference?: string;
}

export class PosError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * What was handed over, turned into the payments to record and the change to give back. Only cash can be more than
 * the bill (the excess is change); UPI, card, bank or cheque over the bill is refused. What is not paid is credit,
 * which needs a named customer.
 */
export function settleTender(total: number, tenders: Tender[], hasCustomer: boolean) {
  const rows = tenders.filter((t) => pos0(t.amount) > 0);
  const nonCash = r2(rows.filter((t) => t.mode !== 'cash').reduce((s, t) => s + t.amount, 0));
  const cash = r2(rows.filter((t) => t.mode === 'cash').reduce((s, t) => s + t.amount, 0));
  if (nonCash > r2(total) + 0.001)
    throw new PosError('over_tender', 'UPI, card, bank and cheque can not be more than the bill');
  const cashKept = r2(Math.min(cash, Math.max(0, total - nonCash)));
  const change = r2(cash - cashKept);
  const paid = r2(nonCash + cashKept);
  const credit = r2(Math.max(0, total - paid));
  if (credit > 0.004 && !hasCustomer)
    throw new PosError(
      'needs_customer',
      `₹${credit.toFixed(2)} is unpaid: pick a customer to sell on credit`,
    );
  let cashLeft = cashKept;
  const payments = rows
    .map((t) => {
      if (t.mode !== 'cash') return { ...t, amount: r2(t.amount) };
      const take = r2(Math.min(t.amount, cashLeft));
      cashLeft = r2(cashLeft - take);
      return { ...t, amount: take };
    })
    .filter((t) => t.amount > 0);
  return { payments, change, paid, credit };
}

/** Quick cash buttons: the exact amount and the next round notes above it (₹10, ₹50, ₹100, ₹500, ₹2000). */
export function cashSuggestions(total: number) {
  const t = Math.ceil(r2(total));
  const out = new Set<number>([r2(total)]);
  for (const step of [10, 50, 100, 500, 2000]) {
    const v = Math.ceil(t / step) * step;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

/** Parses the search box: "3*" or "3 *" sets quantity 3 for the next item (direct quantity change). */
export function parseQtyPrefix(text: string) {
  const m = /^\s*(\d+(?:\.\d{1,3})?)\s*\*\s*(.*)$/.exec(text);
  return m ? { qty: Number(m[1]), rest: m[2] } : { qty: null as number | null, rest: text };
}
