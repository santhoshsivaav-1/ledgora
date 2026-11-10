// Vyapar parity Phase 2: totals with additional charges and the pure sale rules (docs/VYAPAR_IMPLEMENTATION_PHASES.md,
// "Phase 2 test plan").
import { describe, it, expect } from 'vitest';
import {
  allocateReceipt,
  billLinesWithCharges,
  cashLimitCheck,
  chargeLines,
  commission,
  computeInvoiceTotals,
  creditCheck,
  inlinePaymentCheck,
  isPostDated,
  needsEwayBill,
  negativeStockCheck,
  overReturns,
  periodLocked,
  printedSubtotal,
  proportionalCharges,
  returnableQty,
  saleOrderProgress,
  salesmanPerformance,
  splitSettlement,
  syncInlinePayments,
} from '../src/index.ts';

const punjab = { country: 'India', state: 'Punjab' };
const goods = (rate = 1000, taxPercent = 18, extra = {}) => ({
  quantity: 1,
  rate,
  taxPercent,
  ...extra,
});
const totals = (o) =>
  computeInvoiceTotals({
    profile: punjab,
    client: { state: 'Punjab' },
    details: { placeOfSupply: 'Punjab' },
    showGST: true,
    ...o,
  });
const shipping = (amount = 100, gstRate = 18, extra = {}) => ({
  name: 'Shipping',
  amount,
  gstRate,
  hsn: '9965',
  ...extra,
});

describe('computeInvoiceTotals with additional charges (12 golden cases)', () => {
  it('1. mixed rates: 18% goods + 5% shipping, intra-state', () => {
    const t = totals({ items: [goods()], charges: [shipping(100, 5)] });
    expect([t.subtotal, t.taxableAmount, t.cgst, t.sgst, t.igst, t.total]).toEqual([
      1000, 1100, 92.5, 92.5, 0, 1285,
    ]);
    expect([t.chargesTotal, t.chargesTax]).toEqual([100, 5]);
    expect(t.charges[0]).toMatchObject({ name: 'Shipping', hsn: '9965', taxPct: 5, tax: 5 });
  });

  it('2. IGST when the place of supply is another state', () => {
    const t = totals({
      items: [goods()],
      charges: [shipping(100, 5)],
      details: { placeOfSupply: 'Haryana' },
    });
    expect([t.cgst, t.sgst, t.igst, t.total]).toEqual([0, 0, 185, 1285]);
  });

  it('3. zero-rated charge adds to taxable value only', () => {
    const t = totals({ items: [goods()], charges: [shipping(100, 0)] });
    expect([t.taxableAmount, t.totalTaxAmount, t.total]).toEqual([1100, 180, 1280]);
  });

  it('4. a charge marked not taxable carries no GST whatever its rate', () => {
    const t = totals({ items: [goods()], charges: [shipping(100, 18, { taxable: false })] });
    expect([t.totalTaxAmount, t.total]).toEqual([180, 1280]);
  });

  it('5. line discount and a charge', () => {
    const t = totals({ items: [goods(1000, 18, { discount: 100 })], charges: [shipping(50)] });
    expect([t.totalDiscount, t.taxableAmount, t.totalTaxAmount, t.total]).toEqual([
      100, 950, 171, 1121,
    ]);
  });

  it('6. invoice-level discount is taken after the charge', () => {
    const t = totals({
      items: [goods()],
      charges: [shipping(100)],
      invoiceOptions: { invoiceDiscountType: 'percent', invoiceDiscountValue: 10 },
    });
    expect([t.invoiceDiscountAmount, t.total]).toEqual([129.8, 1168.2]);
  });

  it('7. round-off up', () => {
    const t = totals({
      items: [goods(100)],
      charges: [shipping(10.4)],
      invoiceOptions: { showRoundOff: true, roundOffMode: 'up' },
    });
    expect([t.roundOff, t.total]).toEqual([0.73, 131]);
  });

  it('8. round-off down (and nearest, the default)', () => {
    const o = { items: [goods(100)], charges: [shipping(10.4)] };
    const down = totals({ ...o, invoiceOptions: { showRoundOff: true, roundOffMode: 'down' } });
    const near = totals({ ...o, invoiceOptions: { showRoundOff: true } });
    expect([down.roundOff, down.total]).toEqual([-0.27, 130]);
    expect([near.roundOff, near.total]).toEqual([-0.27, 130]);
  });

  it('9. tax-inclusive goods: the charge is still before tax, and the printed subtotal leaves it out', () => {
    const t = totals({ items: [goods(1180)], taxInclusive: true, charges: [shipping(100)] });
    expect([t.subtotal, t.taxableAmount, t.totalTaxAmount, t.total]).toEqual([
      1180, 1100, 198, 1298,
    ]);
    expect(printedSubtotal(t)).toBe(1000);
  });

  it('10. TCS 206C(1H) is on taxable value plus tax, charges included', () => {
    const t = totals({
      items: [goods()],
      charges: [shipping(100)],
      invoiceOptions: { showTCS: true, tcsRate: 1, tcsCumulativeThisYear: 6_000_000 },
    });
    expect([t.tcsAmount, t.total]).toEqual([12.98, 1310.98]);
  });

  it('11. reverse charge: the buyer pays tax on the charge too', () => {
    const t = totals({
      items: [goods()],
      charges: [shipping(100)],
      invoiceOptions: { reverseCharge: true },
    });
    expect([t.total, t.rcmTaxTotal, t.totalTaxAmount]).toEqual([1100, 198, 0]);
  });

  it('12. bill of supply: no GST on the charge; blank rows drop out', () => {
    const t = totals({
      items: [goods()],
      showGST: false,
      charges: [shipping(100), { name: 'Blank', amount: '' }],
    });
    expect([t.taxableAmount, t.totalTaxAmount, t.total, t.charges.length]).toEqual([
      1100, 0, 1100, 1,
    ]);
  });

  it('only blank rows = exactly the no-charge result', () => {
    const base = { items: [goods()] };
    expect(JSON.stringify(totals({ ...base, charges: [{ amount: 0 }] }))).toBe(
      JSON.stringify(totals(base)),
    );
  });

  it('intra-UT: the charge tax goes to UTGST', () => {
    const t = computeInvoiceTotals({
      items: [goods()],
      charges: [shipping(100)],
      profile: { country: 'India', state: 'Chandigarh' },
      client: { state: 'Chandigarh' },
      details: { placeOfSupply: 'Chandigarh' },
      showGST: true,
    });
    expect([t.cgst, t.sgst, t.utgst]).toEqual([99, 0, 99]);
  });
});

describe('charge lines for GST returns', () => {
  it('a charge becomes an isCharge line at its own rate and SAC', () => {
    expect(chargeLines([shipping(100, 5)])[0]).toMatchObject({
      name: 'Shipping',
      hsn: '9965',
      quantity: 1,
      rate: 100,
      taxPercent: 5,
      isCharge: true,
    });
  });
  it('on a tax-inclusive bill the line rate carries the tax', () => {
    expect(chargeLines([shipping(100, 18)], true)[0].rate).toBe(118);
  });
  it('billLinesWithCharges appends them; without charges returns the same items', () => {
    const items = [goods()];
    expect(billLinesWithCharges({ data: { items } })).toBe(items);
    expect(billLinesWithCharges({ data: { items, charges: [shipping()] } })).toHaveLength(2);
  });
  it('a credit note returns charges in proportion', () => {
    expect(proportionalCharges([shipping(100), shipping(30)], 0.5).map((c) => c.amount)).toEqual([
      50, 15,
    ]);
    expect(proportionalCharges([shipping(100)], 2)[0].amount).toBe(100);
  });
});

describe('allocateReceipt (10)', () => {
  const inv = [
    { id: 'B', date: '2026-10-20', pending: 3740 },
    { id: 'A', date: '2026-10-02', pending: 8260 },
  ];
  it('exact amount settles the oldest invoice', () => {
    const r = allocateReceipt({ amount: 8260, invoices: inv });
    expect(r.allocations).toEqual([{ invoiceId: 'A', amount: 8260 }]);
    expect(r.advance).toBe(0);
  });
  it('partial: the oldest gets what there is', () => {
    expect(allocateReceipt({ amount: 5000, invoices: inv }).allocations).toEqual([
      { invoiceId: 'A', amount: 5000 },
    ]);
  });
  it('spills over to the next invoice', () => {
    expect(allocateReceipt({ amount: 10000, invoices: inv }).allocations).toEqual([
      { invoiceId: 'A', amount: 8260 },
      { invoiceId: 'B', amount: 1740 },
    ]);
  });
  it('overpayment stays as advance', () => {
    const r = allocateReceipt({ amount: 13000, invoices: inv });
    expect([r.allocated, r.advance]).toEqual([12000, 1000]);
  });
  it('discount settles alongside the money', () => {
    const r = allocateReceipt({ amount: 5000, discount: 100, invoices: inv });
    expect([r.settled, r.allocations[0].amount]).toEqual([5100, 5100]);
  });
  it('TDS kept by the payer settles too', () => {
    const r = allocateReceipt({ amount: 8095, tds: 165.2, invoices: [inv[1]] });
    expect([r.settled, r.allocated, r.advance]).toEqual([8260.2, 8260, 0.2]);
  });
  it('many invoices, skipping ones already paid', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `I${i}`,
      date: `2026-01-0${i + 1}`,
      pending: i === 1 ? 0 : 100,
    }));
    const r = allocateReceipt({ amount: 350, invoices: many });
    expect(r.allocations.map((a) => a.invoiceId)).toEqual(['I0', 'I2', 'I3', 'I4']);
    expect(r.allocations.at(-1).amount).toBe(50);
  });
  it('manual takes the typed amounts', () => {
    const r = allocateReceipt({
      amount: 2000,
      invoices: inv,
      strategy: 'manual',
      manual: { B: 1500 },
    });
    expect([r.allocations, r.advance]).toEqual([[{ invoiceId: 'B', amount: 1500 }], 500]);
  });
  it('manual above pending is an error', () => {
    const r = allocateReceipt({
      amount: 9000,
      invoices: inv,
      strategy: 'manual',
      manual: { B: 4000 },
    });
    expect(r.ok).toBe(false);
  });
  it('manual above what is settled is an error', () => {
    const r = allocateReceipt({
      amount: 1000,
      invoices: inv,
      strategy: 'manual',
      manual: { A: 2000 },
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/more than/);
  });
  it('splitSettlement divides an allocation into money, discount and TDS', () => {
    expect(splitSettlement(5100, { amount: 5000, discount: 100 })).toEqual({
      money: 5000,
      discount: 100,
      tds: 0,
    });
  });
});

describe('creditCheck (6)', () => {
  it('mode none always passes', () => {
    expect(creditCheck({ limit: 100, mode: 'none', used: 500, newAmount: 500 }).ok).toBe(true);
  });
  it('no limit passes', () => {
    expect(creditCheck({ limit: null, mode: 'block', used: 500, newAmount: 500 }).ok).toBe(true);
  });
  it('within the limit passes', () => {
    expect(creditCheck({ limit: 50000, mode: 'warn', used: 30000, newAmount: 10000 }).ok).toBe(
      true,
    );
  });
  it('exactly at the limit passes', () => {
    expect(creditCheck({ limit: 50000, mode: 'block', used: 40000, newAmount: 10000 }).ok).toBe(
      true,
    );
  });
  it('warn: over by ₹10,000', () => {
    expect(
      creditCheck({ limit: 50000, mode: 'warn', used: 42000, newAmount: 18000 }),
    ).toMatchObject({
      ok: false,
      exceededBy: 10000,
      mode: 'warn',
      after: 60000,
    });
  });
  it('block: over', () => {
    expect(
      creditCheck({ limit: 50000, mode: 'block', used: 50000, newAmount: 0.01 }),
    ).toMatchObject({
      ok: false,
      mode: 'block',
    });
  });
});

describe('cashLimitCheck (4) — §269ST', () => {
  it('below ₹2 lakh is fine', () =>
    expect(cashLimitCheck({ newCash: 199999.99 }).breached).toBe(false));
  it('₹2 lakh exactly is a breach', () =>
    expect(cashLimitCheck({ newCash: 200000 }).breached).toBe(true));
  it('counts the day total for the party', () => {
    expect(cashLimitCheck({ dayCashTotal: 150000, newCash: 60000 })).toMatchObject({
      breached: true,
      over: 10000,
    });
  });
  it('no new cash, no banner', () =>
    expect(cashLimitCheck({ dayCashTotal: 300000, newCash: 0 }).breached).toBe(false));
});

describe('periodLocked and other guards', () => {
  it('on or before the lock date', () => {
    expect(periodLocked({ date: '2026-09-30', lockDate: '2026-09-30' })).toMatchObject({
      locked: true,
      reason: 'lock_date',
    });
    expect(periodLocked({ date: '2026-10-01', lockDate: '2026-09-30' }).locked).toBe(false);
  });
  it('in a filed month; only the owner may override', () => {
    const o = { date: '2026-08-14', filedMonths: ['2026-08'] };
    expect(periodLocked({ ...o, role: 'admin' })).toMatchObject({
      locked: true,
      reason: 'filed_month',
      canOverride: false,
    });
    expect(periodLocked({ ...o, role: 'owner' }).canOverride).toBe(true);
  });
  it('negative stock: warn or block per setting, only for tracked items', () => {
    const lines = [
      { itemId: 'p', name: 'Pen', quantity: 6 },
      { itemId: 'p', quantity: 6 },
      { itemId: 'svc', quantity: 1 },
    ];
    expect(negativeStockCheck(lines, { p: 10 }, 'block')).toMatchObject({
      action: 'block',
      short: [{ itemId: 'p', short: 2 }],
    });
    expect(negativeStockCheck(lines, { p: 10 }, 'allow').action).toBe('none');
    expect(negativeStockCheck(lines, { p: 20 }, 'warn').action).toBe('none');
  });
  it('e-way bill threshold', () => {
    expect(needsEwayBill(50000)).toBe(false);
    expect(needsEwayBill(50000.01)).toBe(true);
  });
});

describe('commission (4)', () => {
  it('on sale, net of returns', () =>
    expect(commission({ sales: 320000, returns: 20000, pct: 2 })).toBe(6000));
  it('on collection', () =>
    expect(commission({ sales: 320000, collected: 210000, basis: 'collection', pct: 2 })).toBe(
      4200,
    ));
  it('more returns than sales earns nothing', () =>
    expect(commission({ sales: 100, returns: 500, pct: 5 })).toBe(0));
  it('percent is clamped to 0..100', () => expect(commission({ sales: 100, pct: 150 })).toBe(100));
  it('salesmanPerformance agrees with the per-invoice figures', () => {
    const p = salesmanPerformance(
      [
        {
          invoiceType: 'tax-invoice',
          taxableAmount: 100000,
          total: 118000,
          paidAmount: 50000,
          status: 'partial',
        },
        {
          invoiceType: 'tax-invoice',
          taxableAmount: 200000,
          total: 236000,
          paidAmount: 0,
          status: 'cancelled',
        },
        {
          invoiceType: 'credit-note',
          taxableAmount: 10000,
          total: 11800,
          paidAmount: 0,
          status: 'unpaid',
        },
        { invoiceType: 'quotation', taxableAmount: 999, total: 999, status: 'unpaid' },
      ],
      { pct: 2, monthlyTarget: 180000 },
    );
    expect(p).toEqual({
      sales: 100000,
      returns: 10000,
      netSales: 90000,
      collected: 50000,
      outstanding: 56200,
      commission: 1800,
      targetPct: 50,
    });
  });
});

describe('inline payments', () => {
  it('two rows that cover the total = paid', () => {
    const r = inlinePaymentCheck({
      payments: [
        { mode: 'cash', amount: 500 },
        { mode: 'upi', amount: 400 },
      ],
      total: 900,
    });
    expect(r).toMatchObject({ ok: true, received: 900, balance: 0, status: 'paid' });
  });
  it('overpay is OVER_ALLOCATED, counting earlier receipts', () => {
    const r = inlinePaymentCheck({
      payments: [{ mode: 'cash', amount: 600 }],
      total: 1000,
      earlier: 500,
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({
      code: 'OVER_ALLOCATED',
      message: 'Received exceeds total by ₹100.00',
    });
  });
  it('a cheque needs a date; bank needs an account once P5 is on', () => {
    const r = inlinePaymentCheck({
      payments: [
        { mode: 'cheque', amount: 1 },
        { mode: 'bank', amount: 1 },
      ],
      total: 10,
      requireAccount: true,
    });
    expect(r.errors.map((e) => e.code)).toEqual(['CHEQUE_DATE', 'ACCOUNT']);
    expect(r.status).toBe('partial');
  });
  it('post-dated cheque chip', () => {
    expect(isPostDated('2026-11-20', '2026-11-10')).toBe(true);
    expect(isPostDated('2026-11-10', '2026-11-10')).toBe(false);
  });
  it('cash sale starts with one Cash row for the balance; autofill follows the total', () => {
    expect(syncInlinePayments([], { saleType: 'cash', total: 118 })[0]).toMatchObject({
      mode: 'cash',
      amount: 118,
    });
    expect(syncInlinePayments([], { saleType: 'credit', total: 118 })).toEqual([]);
    const one = [{ mode: 'upi', amount: 100 }];
    expect(
      syncInlinePayments(one, { saleType: 'credit', total: 150, autofill: true })[0].amount,
    ).toBe(150);
    expect(syncInlinePayments(one, { saleType: 'credit', total: 150 })).toBe(one);
  });
});

describe('returnableQty (5) and sale orders', () => {
  const sold = [
    { itemId: 'pen', name: 'Pen', quantity: 100 },
    { name: 'Gift wrap', quantity: 2 },
  ];
  it('nothing returned yet: everything', () => {
    expect(returnableQty(sold, [])).toEqual({ 'id:pen': 100, 'nm:gift wrap': 2 });
  });
  it('earlier credit notes reduce it', () => {
    expect(returnableQty(sold, [{ lines: [{ itemId: 'pen', quantity: 30 }] }])['id:pen']).toBe(70);
  });
  it('a cancelled credit note does not count', () => {
    expect(
      returnableQty(sold, [{ status: 'cancelled', lines: [{ itemId: 'pen', quantity: 30 }] }])[
        'id:pen'
      ],
    ).toBe(100);
  });
  it('free-typed lines match by name', () => {
    expect(
      returnableQty(sold, [{ items: [{ name: ' gift WRAP ', quantity: 1 }] }])['nm:gift wrap'],
    ).toBe(1);
  });
  it('over-return is reported, never below zero', () => {
    const left = returnableQty(sold, [{ lines: [{ itemId: 'pen', quantity: 120 }] }]);
    expect(left['id:pen']).toBe(0);
    expect(overReturns([{ itemId: 'pen', name: 'Pen', quantity: 1 }], left)).toHaveLength(1);
    expect(overReturns([{ name: 'Gift wrap', quantity: 2 }], left)).toEqual([]);
  });
  it('sale order: open → partially invoiced → closed; cancelled', () => {
    const order = [{ itemId: 'pen', name: 'Pen Blue', quantity: 100 }];
    expect(saleOrderProgress(order, []).status).toBe('open');
    const part = saleOrderProgress(order, [{ lines: [{ itemId: 'pen', quantity: 40 }] }]);
    expect(part.status).toBe('partially-invoiced');
    expect(part.lines[0]).toMatchObject({ ordered: 100, invoiced: 40, pending: 60 });
    expect(
      saleOrderProgress(order, [
        { lines: [{ itemId: 'pen', quantity: 40 }] },
        { lines: [{ itemId: 'pen', quantity: 60 }] },
      ]).status,
    ).toBe('closed');
    expect(
      saleOrderProgress(order, [{ status: 'cancelled', lines: [{ itemId: 'pen', quantity: 100 }] }])
        .status,
    ).toBe('open');
    expect(saleOrderProgress(order, [], true).status).toBe('cancelled');
  });
});
