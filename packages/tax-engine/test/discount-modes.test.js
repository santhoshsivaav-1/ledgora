// Ported from scripts/discount-modes-test.mjs (Phase 0, change 0.10): the 4-mode discount matrix.
import { describe, it, expect } from 'vitest';
import { computeInvoiceTotals, resolveLineDiscount } from '../src/index.ts';

const runTotals = (item, invoiceOptions = {}) =>
  computeInvoiceTotals({
    items: [{ id: '1', ...item }],
    profile: { country: 'India', state: 'Karnataka', gstin: '29ABCDE1234F1Z5' },
    client: { state: 'Karnataka' },
    details: {},
    showGST: true,
    taxInclusive: false,
    invoiceOptions,
  });

const scenarios = [
  // Net Amount base
  {
    name: 'Fixed ₹10 off Net (₹200 @ 18%)',
    item: { quantity: 2, rate: 100, discount: 10, discountType: 'fixed', discountBase: 'net', taxPercent: 18 },
    exp: { lineDisc: 10, total: 224.2 },
  },
  {
    name: 'Percent 10% off (base-agnostic, ₹200 @ 18%)',
    item: { quantity: 2, rate: 100, discount: 10, discountType: 'percent', taxPercent: 18 },
    exp: { lineDisc: 20, total: 212.4 },
  },
  // Unit Price base: discount = 4 x 5 = 20; taxable = 380; tax = 68.4; total = 448.4
  {
    name: 'Fixed ₹5 off Unit × 4 qty (₹400 @ 18%)',
    item: { quantity: 4, rate: 100, discount: 5, discountType: 'fixed', discountBase: 'unit', taxPercent: 18 },
    exp: { lineDisc: 20, total: 448.4 },
  },
  // Price With Tax base: 11.80 gross -> back out tax -> 10 off net -> taxable 90 -> tax 16.2 -> total 106.2
  {
    name: 'Fixed ₹11.80 off Price-With-Tax (₹100 @ 18% → gross ₹118)',
    item: { quantity: 1, rate: 100, discount: 11.8, discountType: 'fixed', discountBase: 'with-tax', taxPercent: 18 },
    exp: { lineDisc: 10, total: 106.2 },
  },
  // Clamps
  {
    name: 'Percent > 100% caps at line value',
    item: { quantity: 1, rate: 100, discount: 200, discountType: 'percent', taxPercent: 18 },
    exp: { lineDisc: 100, total: 0 },
  },
  {
    name: 'Fixed > line value caps',
    item: { quantity: 1, rate: 100, discount: 500, discountType: 'fixed', discountBase: 'net', taxPercent: 18 },
    exp: { lineDisc: 100, total: 0 },
  },
  {
    name: 'Unit × qty > line caps',
    item: { quantity: 2, rate: 100, discount: 200, discountType: 'fixed', discountBase: 'unit', taxPercent: 18 },
    exp: { lineDisc: 200, total: 0 },
  },
  // Backward compatibility
  {
    name: 'Legacy item (no discountBase / no discountType) treats as fixed net',
    item: { quantity: 1, rate: 100, discount: 10, taxPercent: 18 },
    exp: { lineDisc: 10, total: 106.2 },
  },
];

describe('4-mode discount matrix', () => {
  it.each(scenarios)('$name', ({ item, exp }) => {
    const t = runTotals(item);
    expect(t.totalDiscount).toBeCloseTo(exp.lineDisc, 1);
    expect(t.total).toBeCloseTo(exp.total, 1);
  });

  it('zero-tax with-tax base returns the raw amount (no division by zero)', () => {
    const zt = resolveLineDiscount({
      quantity: 1, rate: 100, discount: 11.8, discountType: 'fixed', discountBase: 'with-tax', taxPercent: 0,
    });
    expect(zt).toBeCloseTo(11.8, 1);
  });
});
