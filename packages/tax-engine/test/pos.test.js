// Vyapar parity P12 (Point of Sale): the counter cart, its totals and the tender.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POS_SETTINGS,
  PosError,
  cartAdd,
  cartUpdate,
  cashSuggestions,
  computeInvoiceTotals,
  counterRate,
  maxRedeemable,
  parseQtyPrefix,
  pointsEarned,
  posInvoiceLines,
  posSettings,
  posTotals,
  settleTender,
  spreadDiscount,
} from '../src/index.ts';

const S = (o = {}) => posSettings({ ...DEFAULT_POS_SETTINGS, ...o });
const soap = { id: 'i1', name: 'Soap', sku: 'S1', unit: 'PCS', salePrice: 100, taxPercent: 18 };
const rice = { id: 'i2', name: 'Rice', sku: 'R1', unit: 'KG', salePrice: 50, taxPercent: 5 };
const KA = { businessState: 'Karnataka' };

describe('posSettings', () => {
  it('fills defaults and always keeps cash', () => {
    const s = posSettings({ paymentModes: ['upi', 'bogus', 'upi'], roundOff: 'weird' });
    expect(s.paymentModes).toEqual(['cash', 'upi']);
    expect(s.roundOff).toBe('nearest');
    expect(s.loyalty.maxRedeemPercent).toBe(50);
  });
  it('caps redeem % at 100 and ignores unknown mode accounts', () => {
    const s = posSettings({ loyalty: { maxRedeemPercent: 400 }, modeAccounts: { upi: 'a', x: 'b' } });
    expect(s.loyalty.maxRedeemPercent).toBe(100);
    expect(s.modeAccounts).toEqual({ upi: 'a' });
  });
});

describe('cart', () => {
  it('a repeat scan adds to the same line', () => {
    let c = cartAdd([], soap, S());
    c = cartAdd(c, soap, S());
    c = cartAdd(c, rice, S(), 2.5);
    expect(c).toHaveLength(2);
    expect(c[0].quantity).toBe(2);
    expect(c[1].quantity).toBe(2.5);
  });
  it('converts the item price to the counter pricing', () => {
    expect(counterRate(soap, 'with-tax')).toBe(118);
    expect(counterRate(soap, 'without-tax')).toBe(100);
    expect(counterRate({ ...soap, salePrice: 118, priceInclTax: true }, 'without-tax')).toBe(100);
  });
  it('quantity 0 removes the line', () => {
    const c = cartAdd([], soap, S());
    expect(cartUpdate(c, c[0].key, { quantity: 0 })).toEqual([]);
  });
  it('parses a direct quantity prefix', () => {
    expect(parseQtyPrefix('3*soap')).toEqual({ qty: 3, rest: 'soap' });
    expect(parseQtyPrefix('1.5 * 890123')).toEqual({ qty: 1.5, rest: '890123' });
    expect(parseQtyPrefix('soap')).toEqual({ qty: null, rest: 'soap' });
  });
});

describe('spreadDiscount', () => {
  it('adds up exactly and never exceeds a line', () => {
    const parts = spreadDiscount([33.33, 33.33, 33.34], 10);
    expect(parts.reduce((s, v) => s + v, 0)).toBeCloseTo(10, 6);
    expect(spreadDiscount([5, 5], 50)).toEqual([5, 5]);
    expect(spreadDiscount([5, 5], 0)).toEqual([0, 0]);
  });
  it('random carts: Σ parts = min(discount, Σ values), each part ≤ its value', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300; k++) {
      const vals = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => Math.round(rnd() * 50000) / 100);
      const d = Math.round(rnd() * 30000) / 100;
      const parts = spreadDiscount(vals, d);
      const want = Math.min(d, vals.reduce((s, v) => s + v, 0));
      expect(Math.round(parts.reduce((s, v) => s + v, 0) * 100)).toBe(Math.round(want * 100));
      parts.forEach((p, i) => expect(p).toBeLessThanOrEqual(vals[i] + 1e-9));
    }
  });
});

describe('posTotals', () => {
  it('with-tax pricing: ₹118 soap totals ₹118 and shows ₹100 before tax', () => {
    const t = posTotals({ lines: cartAdd([], soap, S()) }, S(), KA);
    expect(t.total).toBe(118);
    expect(t.taxable).toBe(100);
    expect(t.cgst).toBe(9);
    expect(t.lines[0].priceExTax).toBe(100);
    expect(t.items).toBe(1);
  });
  it('a bill discount comes off the taxable value, so GST falls with it', () => {
    const lines = cartAdd(cartAdd([], soap, S({ pricing: 'without-tax' })), rice, S({ pricing: 'without-tax' }), 2);
    const s = S({ pricing: 'without-tax', roundOff: 'none' });
    const t = posTotals({ lines, billDiscount: { type: 'percent', value: 10 } }, s, KA);
    // 200 worth before; 10% = 20 spread 100:100 → soap 90 @18% + rice 90 @5%
    expect(t.billDiscount).toBe(20);
    expect(t.taxable).toBe(180);
    expect(t.tax).toBe(r(90 * 0.18 + 90 * 0.05));
    expect(t.total).toBe(r(180 + 16.2 + 4.5));
  });
  it('matches computeInvoiceTotals on the lines it hands the server', () => {
    const s = S({ freeQty: true, roundOff: 'up' });
    const lines = cartAdd([], soap, s, 3).map((l) => ({ ...l, freeQty: 1, discount: 5 }));
    const bill = { lines, billDiscount: { type: 'amount', value: 7 }, charges: [{ name: 'Bag', amount: 10, gstRate: 18 }] };
    const t = posTotals(bill, s, KA);
    const server = computeInvoiceTotals({
      items: posInvoiceLines(bill, s),
      profile: { country: 'India', state: 'Karnataka' },
      client: { state: 'Karnataka' },
      taxInclusive: true,
      invoiceOptions: { showRoundOff: true, roundOffMode: 'up' },
      charges: [{ name: 'Bag', amount: 10, gstRate: 18, taxable: true }],
    });
    expect(t.total).toBe(server.total);
    expect(Number.isInteger(t.total)).toBe(true);
  });
  it('free quantity leaves stock but is not charged', () => {
    const s = S({ freeQty: true });
    const lines = cartAdd([], soap, s, 2).map((l) => ({ ...l, freeQty: 1 }));
    const [inv] = posInvoiceLines({ lines }, s);
    expect(inv.quantity).toBe(3);
    expect(inv.discount).toBe(118);
    expect(posTotals({ lines }, s, KA).total).toBe(236);
  });
  it('bill tax sets one rate on every line', () => {
    const s = S({ billTax: true, pricing: 'without-tax', roundOff: 'none' });
    const lines = cartAdd(cartAdd([], soap, s), rice, s);
    expect(posInvoiceLines({ lines, billTaxPercent: 12 }, s).map((l) => l.taxPercent)).toEqual([12, 12]);
    expect(posTotals({ lines, billTaxPercent: 12 }, s, KA).total).toBe(168);
  });
  it('an interstate customer is charged IGST', () => {
    const t = posTotals({ lines: cartAdd([], soap, S()) }, S(), { ...KA, partyState: 'Tamil Nadu' });
    expect(t.igst).toBe(18);
    expect(t.cgst).toBe(0);
  });
});

describe('loyalty', () => {
  const rule = { enabled: true, earnPer100: 2, pointValue: 0.5, minBill: 100, maxRedeemPercent: 20 };
  it('earns whole points per ₹100 above the minimum', () => {
    expect(pointsEarned(250, rule)).toBe(5);
    expect(pointsEarned(99, rule)).toBe(0);
    expect(pointsEarned(1000, { ...rule, enabled: false })).toBe(0);
  });
  it('redeems up to the balance and the bill cap', () => {
    expect(maxRedeemable(1000, 500, rule)).toBe(200); // 20% of 500 = ₹100 = 200 points
    expect(maxRedeemable(30, 500, rule)).toBe(30);
  });
  it('points redeemed are a discount before GST', () => {
    const s = S({ loyalty: rule, pricing: 'without-tax', roundOff: 'none' });
    const t = posTotals({ lines: cartAdd([], soap, s), redeemPoints: 20 }, s, KA);
    expect(t.pointsValue).toBe(10);
    expect(t.taxable).toBe(90);
    expect(t.total).toBe(106.2);
  });
});

describe('settleTender', () => {
  it('cash over the bill is change', () => {
    const r = settleTender(486, [{ mode: 'cash', amount: 500 }], false);
    expect(r).toMatchObject({ change: 14, paid: 486, credit: 0 });
    expect(r.payments).toEqual([{ mode: 'cash', amount: 486 }]);
  });
  it('splits UPI and cash', () => {
    const r = settleTender(1000, [
      { mode: 'upi', amount: 600 },
      { mode: 'cash', amount: 500 },
    ], false);
    expect(r.change).toBe(100);
    expect(r.payments).toEqual([
      { mode: 'upi', amount: 600 },
      { mode: 'cash', amount: 400 },
    ]);
  });
  it('refuses UPI over the bill', () => {
    expect(() => settleTender(100, [{ mode: 'upi', amount: 120 }], true)).toThrow(PosError);
  });
  it('credit needs a customer', () => {
    expect(() => settleTender(100, [{ mode: 'cash', amount: 40 }], false)).toThrow(/customer/);
    expect(settleTender(100, [{ mode: 'cash', amount: 40 }], true).credit).toBe(60);
  });
  it('suggests round notes', () => {
    expect(cashSuggestions(486)).toEqual([486, 490, 500, 2000]);
  });
});

function r(n) {
  return Math.round(n * 100) / 100;
}
