// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Rec } from './types.ts';
import { finiteNonNeg } from './money.ts';

// v1.10.22 → v1.10.25 — Resolve a line's effective discount amount from
// the (discountType, discountBase) matrix.
//
//   discountType  ∈ { 'fixed' (default), 'percent' }
//   discountBase  ∈ { 'net' (default), 'unit', 'with-tax' }
//
// The RETURN VALUE is always the discount deducted from the line's net
// value (qty × rate) before tax, so the existing downstream tax /
// GSTR-1 / e-Way Bill code paths need no changes.
//
// Percent mode is base-agnostic (percent of net = percent of tax-inclusive
// pro-rated back to net = percent of unit-price × qty). Only fixed mode
// actually branches on base:
//
//   fixed + net       → raw amount as entered
//   fixed + unit      → raw × qty (₹X off each unit)
//   fixed + with-tax  → raw / (1 + taxRate/100)  (back out tax so the
//                       consumer's total-inclusive drops by exactly raw)
//
// Every branch is clamped to the line's net value so a discount can't
// exceed the line (which would produce a negative taxable value the
// GST portal rejects).
//
// Backward-compat: items without `discountBase` fall through to 'net',
// so pre-v1.10.25 bills render byte-identically.
//
// `taxIncluded`: the line's qty × rate already includes tax ("Prices include
// tax") or no tax is charged at all (bill of supply). A with-tax discount is
// then taken off as entered - backing tax out of it again under-discounted
// the line (₹118 off an inclusive ₹1,180 line took only ₹100 off).
export const resolveLineDiscount = (item: Rec = {}, taxIncluded = false) => {
  const qty = finiteNonNeg(item.quantity);
  const rate = finiteNonNeg(item.rate);
  const net = qty * rate;
  const raw = finiteNonNeg(item.discount);
  if (raw <= 0 || net <= 0) return 0;

  if (item.discountType === 'percent') {
    return Math.min(net, (net * Math.min(raw, 100)) / 100);
  }

  // Fixed-mode routing based on discountBase.
  const base = item.discountBase || 'net';
  if (base === 'unit') {
    return Math.min(net, qty * raw);
  }
  if (base === 'with-tax') {
    // v1.10.80: on a price that already includes tax (or carries no tax) the
    // with-tax amount comes off as entered. Only lines set since then carry
    // withTaxRule 2: older saved lines keep the old maths (tax backed out),
    // so their GSTR-1 figures and reprints still match the saved totals.
    if (taxIncluded && item.withTaxRule === 2) return Math.min(net, raw);
    const taxRate = finiteNonNeg(item.taxPercent);
    const divisor = 1 + taxRate / 100;
    return Math.min(net, divisor > 0 ? raw / divisor : raw);
  }
  // default: net-amount base
  return Math.min(net, raw);
};

export const calculateLineItemTax = (item: Rec = {}, taxInclusive = false) => {
  const qty = finiteNonNeg(item.quantity);
  const rate = finiteNonNeg(item.rate);
  const discount = resolveLineDiscount(item, taxInclusive);
  const taxRate = finiteNonNeg(item.taxPercent);
  const amount = qty * rate;
  const grossAfterDiscount = Math.max(0, amount - discount); // discount can't exceed line value
  if (taxInclusive && taxRate > 0) {
    const afterDiscount = grossAfterDiscount / (1 + taxRate / 100);
    const taxAmount = grossAfterDiscount - afterDiscount;
    return { amount, discount, afterDiscount, taxAmount, total: grossAfterDiscount };
  }
  const afterDiscount = grossAfterDiscount;
  const taxAmount = (afterDiscount * taxRate) / 100;
  return { amount, discount, afterDiscount, taxAmount, total: afterDiscount + taxAmount };
};

// One invoice line's tax for the GST returns: taxable value, CGST, SGST or
// UTGST, IGST and cess.
// v1.10.77 (#89) - the line tax is rounded to the paisa, as on the invoice
// (computeInvoiceTotals), and CGST and SGST are each exactly half of it, NOT
// rounded here: every return table adds lines up and rounds once (round2 at
// output), so CGST = SGST = round(total / 2), as the invoice prints them. It used to give CGST the half rounded DOWN and SGST
// the half rounded UP per line, so every odd-paisa line put a paisa more in
// SGST; over a few dozen lines the HSN summary showed CGST 6,778.56 against
// SGST 6,782.56 for a 5% item. Rounding each half per line instead drifts
// from the invoice total by a paisa per line.
// v1.10.31 - cess and UTGST flow through here too.
export const splitLineTax = (
  item: Rec,
  isInterState: boolean,
  taxInclusive = false,
  isIntraUT = false,
) => {
  const { afterDiscount, taxAmount: rawTax } = calculateLineItemTax(item, taxInclusive);
  const paise = Math.round(rawTax * 100);
  const taxAmount = paise / 100;
  const cess = Math.round(afterDiscount * (Number(item.cessPercent) || 0)) / 100;
  if (isInterState)
    return { taxable: afterDiscount, cgst: 0, sgst: 0, utgst: 0, igst: taxAmount, cess };
  // An odd paisa leaves exactly half a paisa. Added up in floating point,
  // x.xx5 lands a hair either side, so screen, CSV and JSON rounded the same
  // half paisa differently. A 0.0000001 nudge makes every total of these
  // halves round it UP, everywhere, without moving anything else.
  const half = paise / 200 + (paise % 2 ? 1e-7 : 0);
  // 5 UTs without a legislature: CGST + UTGST; the SGST bucket stays zero.
  return {
    taxable: afterDiscount,
    cgst: half,
    sgst: isIntraUT ? 0 : half,
    utgst: isIntraUT ? half : 0,
    igst: 0,
    cess,
  };
};
