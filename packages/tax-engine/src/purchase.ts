// Vyapar parity Phase 3 (purchase side): the pure rules behind purchase bills, Payment Out, purchase orders, debit
// notes, expenses and other income. Shared by the API and the web screens so both decide the same way. The allocation
// of payments is not here: both sides use allocatePayment in payments.ts.

import type { Numeric, Rec } from './types.ts';
import { finiteNonNeg, r2, sum } from './money.ts';
import { cleanCharges, orderProgress, overReturns, returnableQty, type Charge } from './sale.ts';
import { getFinancialYearLabel, parseLocalDate } from './dates.ts';

const n = (v: Numeric) => Number(v) || 0;

// ---- P3-S1 input tax credit -------------------------------------------------------------------------------------------

/**
 * How much of a purchase line's GST may be claimed as input tax credit.
 * - `eligible` (the default, and what every purchase saved before Phase 3 is read as): claimed in GSTR-3B 4(A).
 * - `capital_goods`: claimed like eligible (4(A)(5)), tracked apart for the fixed-asset register.
 * - `ineligible_17_5`: blocked by section 17(5) (motor vehicles, food, club fees, works contract for immovable
 *   property ...). Reported in 4(A) and reversed in 4(B)(1), per CBIC Circular 170/02/2022; the tax goes into cost.
 * - `blocked`: credit not available for another reason (for example rule 36(4) or a supplier who has not filed).
 *   Reversed in 4(B)(1) like 17(5).
 * - `exempt_supply_use`: goods used only for exempt supplies (section 17(2)). Reversed in 4(B)(1) too.
 */
export const ITC_STATUSES = [
  'eligible',
  'capital_goods',
  'ineligible_17_5',
  'blocked',
  'exempt_supply_use',
] as const;
export type ItcStatus = (typeof ITC_STATUSES)[number];

export const ITC_STATUS_LABELS: Record<ItcStatus, string> = {
  eligible: 'Eligible',
  capital_goods: 'Capital goods',
  ineligible_17_5: 'Ineligible §17(5)',
  blocked: 'Blocked',
  exempt_supply_use: 'Used for exempt supply',
};

/** A missing or unknown status reads as eligible, so old purchases keep their credit. */
export const itcStatusOf = (l: Rec | null | undefined): ItcStatus =>
  (ITC_STATUSES as readonly string[]).includes(l?.itcStatus) ? l!.itcStatus : 'eligible';

/** True when the line's GST is credit we keep (eligible or capital goods). */
export const itcClaimable = (l: Rec | null | undefined) => {
  const s = itcStatusOf(l);
  return s === 'eligible' || s === 'capital_goods';
};

export interface TaxHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

/** Taxable value, tax and cess of one purchase line (quantity × rate, less a percentage discount if any). */
export function purchaseLineTax(l: Rec) {
  const gross = finiteNonNeg(l.quantity) * finiteNonNeg(l.rate);
  const taxable = gross * (1 - Math.min(finiteNonNeg(l.discountPercent), 100) / 100);
  return {
    taxable,
    tax: (taxable * finiteNonNeg(l.taxPercent)) / 100,
    cess: (taxable * finiteNonNeg(l.cessPercent)) / 100,
  };
}

/**
 * Splits GST into heads the way the purchase screens always have: all IGST across states, otherwise CGST is half the
 * tax rounded to paise and SGST the rest. Rounding once per bucket (not per line) keeps the totals of a purchase whose
 * lines are all eligible exactly what GSTR-3B showed before Phase 3.
 */
export function splitHeads(tax: Numeric, cess: Numeric, interstate: boolean): TaxHeads {
  if (interstate) return { igst: n(tax), cgst: 0, sgst: 0, cess: n(cess) };
  const half = r2(n(tax) / 2);
  return { igst: 0, cgst: half, sgst: n(tax) - half, cess: n(cess) };
}

/**
 * GST of a purchase's lines (and its additional charges, which are always eligible) by ITC bucket and tax head.
 * `eligible` includes capital goods; `capitalGoods` repeats that part on its own; `ineligible` is 17(5), blocked and
 * exempt-use credit. `total` is all of it. Amounts are not rounded here: callers round where they report.
 */
export function itcSplit(lines: Rec[], o: { interstate?: boolean; charges?: Charge[] } = {}) {
  const buckets = { eligible: [0, 0], capitalGoods: [0, 0], ineligible: [0, 0] };
  const add = (b: number[], tax: number, cess: number) => {
    b[0] += tax;
    b[1] += cess;
  };
  for (const l of lines || []) {
    const { tax, cess } = purchaseLineTax(l);
    const s = itcStatusOf(l);
    if (s === 'eligible' || s === 'capital_goods') add(buckets.eligible, tax, cess);
    if (s === 'capital_goods') add(buckets.capitalGoods, tax, cess);
    if (!itcClaimable(l)) add(buckets.ineligible, tax, cess);
  }
  for (const c of cleanCharges(o.charges))
    if (c.taxable) add(buckets.eligible, (c.amount * c.gstRate) / 100, 0);
  const inter = !!o.interstate;
  const eligible = splitHeads(buckets.eligible[0], buckets.eligible[1], inter);
  const ineligible = splitHeads(buckets.ineligible[0], buckets.ineligible[1], inter);
  return {
    eligible,
    capitalGoods: splitHeads(buckets.capitalGoods[0], buckets.capitalGoods[1], inter),
    ineligible,
    total: {
      igst: eligible.igst + ineligible.igst,
      cgst: eligible.cgst + ineligible.cgst,
      sgst: eligible.sgst + ineligible.sgst,
      cess: eligible.cess + ineligible.cess,
    },
  };
}

// ---- P3-S1 totals, landed cost, duplicate bills -----------------------------------------------------------------------

/**
 * A purchase bill's figures. `charges` are before tax; `tds194Q` is the percentage we withhold under §194Q (it reduces
 * what we pay the supplier, not the bill total); `roundOff` applies to the grand total only, so the ITC stays the
 * supplier's exact tax.
 */
export function purchaseTotals(o: {
  lines: Rec[];
  charges?: Charge[];
  interstate?: boolean;
  roundOff?: boolean;
  tds194QPercent?: Numeric;
}) {
  const lineFigures = (o.lines || []).map((l) => purchaseLineTax(l));
  const charges = cleanCharges(o.charges);
  const goodsTaxable = sum(lineFigures.map((f) => f.taxable));
  const chargesTaxable = sum(charges.map((c) => c.amount));
  const chargesTax = sum(charges.map((c) => (c.taxable ? (c.amount * c.gstRate) / 100 : 0)));
  const tax = sum(lineFigures.map((f) => f.tax)) + chargesTax;
  const cess = sum(lineFigures.map((f) => f.cess));
  const raw = goodsTaxable + chargesTaxable + tax + cess;
  const roundOff = o.roundOff ? r2(Math.round(raw) - raw) : 0;
  const total = r2(raw + roundOff);
  const taxable = r2(goodsTaxable + chargesTaxable);
  const tdsPct = Math.min(finiteNonNeg(o.tds194QPercent), 100);
  // §194Q TDS is on the value before GST (CBDT Circular 13/2021).
  const tdsAmount = tdsPct > 0 ? Math.round((taxable * tdsPct) / 100) : 0;
  const heads = splitHeads(tax, cess, !!o.interstate);
  return {
    taxable,
    goodsTaxable: r2(goodsTaxable),
    chargesTaxable: r2(chargesTaxable),
    tax: r2(tax),
    cess: r2(cess),
    igst: r2(heads.igst),
    cgst: r2(heads.cgst),
    sgst: r2(heads.sgst),
    roundOff,
    total,
    tdsAmount,
    payable: r2(total - tdsAmount),
  };
}

/**
 * Cost per unit of each line once the bill's charges are spread over the goods by value (stock-in at landed cost).
 * Credit we can not claim (17(5), blocked, exempt use) is part of the cost; credit we claim is not. Charge GST is
 * claimable and stays out. Rounding: unit costs to 4 decimals; each line's share of the charges is rounded to paise
 * and the last line takes the remainder, so the shares add up to the charges exactly.
 */
export function landedCost(lines: Rec[], charges?: Charge[]) {
  const figures = (lines || []).map((l) => purchaseLineTax(l));
  const goods = sum(figures.map((f) => f.taxable));
  const chargeTotal = r2(sum(cleanCharges(charges).map((c) => c.amount)));
  let given = 0;
  return (lines || []).map((l, i) => {
    const f = figures[i];
    const last = i === figures.length - 1;
    const share =
      goods > 0 ? (last ? r2(chargeTotal - given) : r2((chargeTotal * f.taxable) / goods)) : 0;
    given = r2(given + share);
    const lostCredit = itcClaimable(l) ? 0 : f.tax + f.cess;
    const value = f.taxable + share + lostCredit;
    const qty = finiteNonNeg(l.quantity);
    return {
      chargeShare: share,
      value: r2(value),
      unitCost: qty > 0 ? Math.round((value / qty) * 10000) / 10000 : 0,
    };
  });
}

/** A supplier's bill number as compared for duplicates: case, spaces, slashes and dashes ignored. */
export const normBillNo = (v: unknown) =>
  String(v ?? '')
    .toUpperCase()
    .replace(/[\s/\\\-_.]/g, '');

/**
 * Another bill from the same supplier with the same bill number in the same financial year, or null. The supplier is
 * matched on GSTIN when both have one, else on name. Bills of other years may repeat a number (suppliers restart their
 * series each April). The user may still save: this only feeds the warning.
 */
export function duplicateBill(
  bills: Rec[],
  o: {
    supplierGstin?: string;
    supplierName?: string;
    billNo?: string;
    date?: string;
    excludeId?: string | null;
  },
) {
  const no = normBillNo(o.billNo);
  if (!no) return null;
  const fy = o.date ? getFinancialYearLabel(parseLocalDate(o.date)) : null;
  const gstin = String(o.supplierGstin || '').toUpperCase();
  const name = String(o.supplierName || '')
    .trim()
    .toLowerCase();
  return (
    (bills || []).find((b) => {
      if (!b || b.id === o.excludeId || (b.docType && b.docType !== 'bill')) return false;
      if (normBillNo(b.invoiceNumber ?? b.billNo) !== no) return false;
      const bGstin = String(b.supplierGstin || '').toUpperCase();
      const same =
        gstin && bGstin
          ? gstin === bGstin
          : String(b.supplierName || '')
              .trim()
              .toLowerCase() === name;
      if (!same) return false;
      const bDate = b.date || b.purchaseDate;
      return !fy || !bDate || getFinancialYearLabel(parseLocalDate(bDate)) === fy;
    }) ?? null
  );
}

// ---- P3-S2 TDS deducted by us -----------------------------------------------------------------------------------------

export interface TdsDeductionSection {
  label: string;
  /** Rate in %, by deductee kind where the law differs. */
  rate: number;
  rateIndividual?: number;
  rateAlt?: number;
  rateAltLabel?: string;
  /** One payment above this attracts TDS (194C, 194I per month). */
  single?: number;
  /** Payments in the financial year above this attract TDS. */
  aggregate?: number;
  /** `whole`: once over the threshold TDS is on the whole amount; `excess`: only on the part above it (194Q). */
  basis: 'whole' | 'excess';
  /** Rate when the deductee has no PAN (206AA): 20%, but 5% for 194Q. */
  noPanRate: number;
  /** Where the deduction sits in the Income-tax Act, 2025 (tax year 2026-27 onwards). */
  newAct: string;
}

/**
 * Default sections, rates and thresholds. Keyed by the Income-tax Act, 1961 section the app and its users know; from
 * tax year 2026-27 the same deductions sit in the table of section 393(1) of the Income-tax Act, 2025 with the same
 * rates and thresholds (contractors 1% / 2% over ₹30,000 or ₹1,00,000 a year; professional fees 10%, technical 2%, over
 * ₹50,000; commission 2% over ₹20,000; rent 10% / 2% over ₹50,000 a month). 194H is 2% since 1 October 2024. They are
 * defaults: Settings > Taxes (P8) will make them editable, and callers can pass their own `thresholds`.
 */
export const TDS_DEDUCTION_SECTIONS: Record<string, TdsDeductionSection> = {
  '194C': {
    label: 'Contractors',
    rate: 2,
    rateIndividual: 1,
    single: 30_000,
    aggregate: 100_000,
    basis: 'whole',
    noPanRate: 20,
    newAct: '393(1)',
  },
  '194J': {
    label: 'Professional / technical fees',
    rate: 10,
    rateAlt: 2,
    rateAltLabel: 'Technical services',
    aggregate: 50_000,
    basis: 'whole',
    noPanRate: 20,
    newAct: '393(1)',
  },
  '194H': {
    label: 'Commission / brokerage',
    rate: 2,
    aggregate: 20_000,
    basis: 'whole',
    noPanRate: 20,
    newAct: '393(1)',
  },
  '194I': {
    label: 'Rent',
    rate: 10,
    rateAlt: 2,
    rateAltLabel: 'Plant & machinery',
    single: 50_000,
    basis: 'whole',
    noPanRate: 20,
    newAct: '393(1)',
  },
  '194Q': {
    label: 'Purchase of goods',
    rate: 0.1,
    aggregate: 5_000_000,
    basis: 'excess',
    noPanRate: 5,
    newAct: '393(1)',
  },
  '194A': {
    label: 'Interest (other than securities)',
    rate: 10,
    aggregate: 10_000,
    basis: 'whole',
    noPanRate: 20,
    newAct: '393(1)',
  },
};

/**
 * TDS we deduct from a payment. `ytdToDeductee` is what this deductee was paid or credited under the section earlier in
 * the financial year; `ytdDeducted` says whether TDS was already being deducted (so the threshold was crossed before).
 * When this payment is the one that crosses an aggregate threshold on a `whole` section, TDS covers the earlier
 * payments too (the catch-up the law requires). Rounded to the rupee (section 288B).
 */
export function tdsCalc(o: {
  section: string;
  base: Numeric;
  ytdToDeductee?: Numeric;
  ytdDeducted?: boolean;
  deducteeType?: 'individual' | 'other';
  alt?: boolean;
  panAvailable?: boolean;
  thresholds?: Partial<TdsDeductionSection>;
}) {
  const def = TDS_DEDUCTION_SECTIONS[o.section];
  if (!def) return { applies: false, rate: 0, taxableBase: 0, tds: 0, reason: 'unknown_section' };
  const s = { ...def, ...(o.thresholds || {}) };
  const base = finiteNonNeg(o.base);
  const ytd = finiteNonNeg(o.ytdToDeductee);
  let rate =
    o.alt && s.rateAlt != null
      ? s.rateAlt
      : o.deducteeType === 'individual' && s.rateIndividual != null
        ? s.rateIndividual
        : s.rate;
  if (o.panAvailable === false) rate = Math.max(rate, s.noPanRate);
  const none = (reason: string) => ({ applies: false, rate, taxableBase: 0, tds: 0, reason });
  if (base <= 0) return none('no_amount');
  let taxableBase = 0;
  let reason = '';
  if (s.basis === 'excess') {
    const limit = s.aggregate ?? 0;
    taxableBase = Math.max(0, ytd + base - limit) - Math.max(0, ytd - limit);
    reason = taxableBase > 0 ? 'over_aggregate' : 'under_threshold';
  } else {
    const overSingle = s.single != null && base > s.single;
    const wasOver = o.ytdDeducted || (s.aggregate != null && ytd > s.aggregate);
    const crossesNow = s.aggregate != null && !wasOver && ytd + base > s.aggregate;
    if (wasOver) {
      taxableBase = base;
      reason = 'over_aggregate';
    } else if (crossesNow) {
      taxableBase = base + ytd;
      reason = 'crosses_aggregate';
    } else if (overSingle) {
      taxableBase = base;
      reason = 'over_single';
    } else reason = 'under_threshold';
  }
  if (taxableBase <= 0) return none(reason);
  return {
    applies: true,
    rate,
    taxableBase: r2(taxableBase),
    tds: Math.round((taxableBase * rate) / 100),
    reason,
  };
}

/** §40A(3): an expense paid in cash above ₹10,000 to one person in a day is not deductible. */
export const CASH_LIMIT_40A3 = 10_000;
export function cashPaymentCheck(o: { dayCashTotal?: Numeric; newCash: Numeric; limit?: Numeric }) {
  const limit = n(o.limit) > 0 ? n(o.limit) : CASH_LIMIT_40A3;
  const total = r2(n(o.dayCashTotal) + finiteNonNeg(o.newCash));
  const breached = finiteNonNeg(o.newCash) > 0 && total > limit;
  return { breached, total, limit, over: breached ? r2(total - limit) : 0 };
}

// ---- P3-S3 purchase orders --------------------------------------------------------------------------------------------

/**
 * A purchase order's progress: per line ordered, received (on the purchase bills converted from it) and pending;
 * status `open` (nothing received), `partial`, `received` or `cancelled`. Same counting as sale orders.
 */
export function purchaseOrderProgress(orderLines: Rec[], bills: Rec[], cancelled = false) {
  const p = orderProgress(orderLines, bills, cancelled);
  const status = { none: 'open', some: 'partial', all: 'received', cancelled: 'cancelled' }[
    p.state
  ];
  return { lines: p.lines.map(({ fulfilled, ...l }) => ({ ...l, received: fulfilled })), status };
}

/** Lines of a conversion that take more than is pending on the order. Empty = fine (partial conversions are). */
export function overConversion(
  progressLines: { key: string; pending: number }[],
  convertLines: Rec[],
) {
  const pending: Record<string, number> = {};
  for (const l of progressLines || []) {
    pending[l.key] = l.pending;
    // Also by name, for a bill line that carries a product id the order line does not (or the reverse).
    const byName = `nm:${String((l as { name?: string }).name || '')
      .trim()
      .toLowerCase()}`;
    if (!(byName in pending)) pending[byName] = l.pending;
  }
  return overReturns(convertLines, pending);
}

// ---- P3-S4 debit notes ------------------------------------------------------------------------------------------------

export const DEBIT_NOTE_REASONS = [
  'purchase-return',
  'rate-difference',
  'quality',
  'other',
] as const;
export type DebitNoteReason = (typeof DEBIT_NOTE_REASONS)[number];

/** Goods go back to the supplier (stock out) for a return or a quality rejection; a rate difference moves no goods. */
export const debitNoteMovesStock = (reason: string | null | undefined) =>
  reason !== 'rate-difference' && reason !== 'other';

/** How much of each bill line can still be returned: bought less earlier debit notes against the bill. */
export const returnableQtyPurchase = (billLines: Rec[], priorDebitNotes: Rec[]) =>
  returnableQty(billLines, priorDebitNotes);

/**
 * The ITC a debit note takes back (GSTR-3B 4(B)(2)): the credit claimed on what is returned, line by line, using the
 * ITC status of the matching bill line. Credit never claimed (17(5), blocked) has nothing to reverse. A note not
 * linked to a bill uses its own lines' status (eligible by default).
 */
export function debitNoteItcReversal(
  returnLines: Rec[],
  o: { billLines?: Rec[]; interstate?: boolean } = {},
) {
  const key = (l: Rec) =>
    l.itemId || l.productId
      ? `id:${l.itemId || l.productId}`
      : `nm:${String(l.name || '')
          .trim()
          .toLowerCase()}`;
  const statusOf = new Map((o.billLines || []).map((l) => [key(l), itcStatusOf(l)]));
  const lines = (returnLines || []).map((l) => ({
    ...l,
    itcStatus: statusOf.get(key(l)) ?? itcStatusOf(l),
  }));
  const split = itcSplit(lines, { interstate: o.interstate });
  return { reversal: split.eligible, value: r2(sum(lines.map((l) => purchaseLineTax(l).taxable))) };
}

// ---- P3-S5 / P3-S6 expenses and other income ------------------------------------------------------------------------

/**
 * An expense's or other income's figures. Itemised: lines of qty × rate at their own GST rate. Single amount: the
 * amount is before GST and `gstAmount` (or `gstPercent` of it) is the GST. `itcEligible` false keeps the GST out of
 * input tax credit; left out it is true, which is how every expense saved before Phase 3 was counted.
 */
export function expenseTotals(o: {
  items?: Rec[] | null;
  amount?: Numeric;
  gstAmount?: Numeric;
  gstPercent?: Numeric;
  interstate?: boolean;
  itcEligible?: boolean;
}) {
  const items = (o.items || []).filter((i) => finiteNonNeg(i.quantity) * finiteNonNeg(i.rate) > 0);
  let taxable: number;
  let gst: number;
  if (items.length) {
    const lines = items.map((i) =>
      purchaseLineTax({ ...i, taxPercent: i.gstRate ?? i.taxPercent }),
    );
    taxable = sum(lines.map((l) => l.taxable));
    gst = sum(lines.map((l) => l.tax));
  } else {
    taxable = finiteNonNeg(o.amount);
    gst =
      n(o.gstAmount) > 0 ? finiteNonNeg(o.gstAmount) : (taxable * finiteNonNeg(o.gstPercent)) / 100;
  }
  const heads = splitHeads(r2(gst), 0, !!o.interstate);
  const eligible = o.itcEligible !== false;
  return {
    taxable: r2(taxable),
    gst: r2(gst),
    total: r2(taxable + gst),
    igst: heads.igst,
    cgst: heads.cgst,
    sgst: heads.sgst,
    itc: eligible
      ? { igst: heads.igst, cgst: heads.cgst, sgst: heads.sgst }
      : { igst: 0, cgst: 0, sgst: 0 },
  };
}

/** Categories every business starts with for Other Income (P3-S6). `itrHead` feeds the Income Tax screen. */
export const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Interest received', itrHead: 'otherSources' },
  { name: 'Commission', itrHead: 'business' },
  { name: 'Rent received', itrHead: 'houseProperty' },
  { name: 'Discount received', itrHead: 'business' },
  { name: 'Misc', itrHead: 'business' },
] as const;
