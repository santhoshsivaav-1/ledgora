import { resolveLineDiscount } from '../../utils';

// v1.10.73 - one per-line calculation for every design, the item table and
// the HSN/SAC summary, so they can never disagree with each other.
// v1.10.29 - resolveLineDiscount respects discountType + discountBase, as
// computeInvoiceTotals does for the totals.
//
// Moved out of InvoicePreview.jsx as pure functions so the thermal
// receipt, the sheet layouts and the tests all share one definition.
//
// The line math depends only on the tax-inclusive flag and whether GST
// applies, so the factory binds those once per render:
export function makeLineCalc(totals, showGST) {
  return (item) => {
    const inclusive = totals.taxInclusive && showGST;
    const discount = resolveLineDiscount(item, inclusive || !showGST);
    const grossAfterDiscount = Math.max(0, (Number(item.quantity) || 0) * (Number(item.rate) || 0) - discount);
    const rate = Number(item.taxPercent) || 0;
    const taxable = inclusive ? grossAfterDiscount / (1 + rate / 100) : grossAfterDiscount;
    const tax = !showGST ? 0 : (inclusive ? grossAfterDiscount - taxable : taxable * rate / 100);
    return { discount, taxable, tax, rate };
  };
}

// HSN/SAC-wise tax summary (Tally's table under the items). A line counts
// if it has an HSN/SAC or carries tax; untaxed reimbursements without a
// code (fuel, courier) are left out, as Tally does.
export function buildHsnRows(items, totals, lineCalc) {
  const map = new Map();
  for (const item of items) {
    const l = lineCalc(item);
    if (!item.hsn && !(l.tax > 0)) continue;
    const k = `${item.hsn || ''}|${l.rate}`;
    const r = map.get(k) || { hsn: item.hsn || '', rate: l.rate, taxable: 0, tax: 0 };
    r.taxable += l.taxable; r.tax += l.tax;
    map.set(k, r);
  }
  // P2-S3: additional charges are supplies at their own rate and SAC; they join the summary like any line.
  for (const c of totals?.charges || []) {
    if (!c.hsn && !(c.tax > 0)) continue;
    const k = `${c.hsn || ''}|${c.taxPct}`;
    const r = map.get(k) || { hsn: c.hsn || '', rate: c.taxPct, taxable: 0, tax: 0 };
    r.taxable += c.taxable; r.tax += c.tax;
    map.set(k, r);
  }
  return [...map.values()];
}
