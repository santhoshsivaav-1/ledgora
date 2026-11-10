// Vyapar parity Phase 3: the pure purchase-side rules (docs/VYAPAR_IMPLEMENTATION_PHASES.md, "Phase 3 test plan").
import { describe, it, expect } from 'vitest';
import {
  allocatePayment,
  allocateReceipt,
  cashPaymentCheck,
  debitNoteItcReversal,
  debitNoteMovesStock,
  duplicateBill,
  expenseTotals,
  itcClaimable,
  itcSplit,
  landedCost,
  overConversion,
  partyStatement,
  paymentBalanceEffect,
  purchaseOrderProgress,
  purchaseTotals,
  returnableQtyPurchase,
  overReturns,
  saleOrderProgress,
  splitHeads,
  tdsCalc,
} from '../src/index.ts';

const line = (rate, taxPercent = 18, extra = {}) => ({
  name: 'Pen',
  quantity: 1,
  rate,
  taxPercent,
  ...extra,
});
const r2 = (n) => Math.round(n * 100) / 100;
const round = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, r2(v)]));

describe('itcSplit (8)', () => {
  it('B2B intra-state 18%: all eligible, CGST 9 + SGST 9 (use case 1)', () => {
    const s = itcSplit([line(1000)]);
    expect(round(s.eligible)).toEqual({ igst: 0, cgst: 90, sgst: 90, cess: 0 });
    expect(round(s.ineligible)).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });
  it('inter-state puts everything in IGST', () => {
    expect(round(itcSplit([line(1000)], { interstate: true }).eligible)).toEqual({
      igst: 180,
      cgst: 0,
      sgst: 0,
      cess: 0,
    });
  });
  it('a line without a status is eligible (old purchases keep their credit)', () => {
    expect(itcClaimable({})).toBe(true);
    expect(itcClaimable({ itcStatus: 'nonsense' })).toBe(true);
    expect(round(itcSplit([line(500, 18, { itcStatus: undefined })]).eligible).cgst).toBe(45);
  });
  it('passenger car under §17(5) is ineligible (use case 2)', () => {
    const s = itcSplit([line(800000, 28, { itcStatus: 'ineligible_17_5', cessPercent: 15 })], {
      interstate: true,
    });
    expect(round(s.eligible)).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(round(s.ineligible)).toEqual({ igst: 224000, cgst: 0, sgst: 0, cess: 120000 });
  });
  it('capital goods count as eligible and are also reported on their own', () => {
    const s = itcSplit([line(10000, 18, { itcStatus: 'capital_goods' }), line(1000)]);
    expect(round(s.eligible)).toEqual({ igst: 0, cgst: 990, sgst: 990, cess: 0 });
    expect(round(s.capitalGoods)).toEqual({ igst: 0, cgst: 900, sgst: 900, cess: 0 });
  });
  it('mixed lines: blocked and exempt-use go to ineligible, the rest stays', () => {
    const s = itcSplit([
      line(1000),
      line(200, 18, { itcStatus: 'blocked' }),
      line(300, 12, { itcStatus: 'exempt_supply_use' }),
    ]);
    expect(round(s.eligible)).toEqual({ igst: 0, cgst: 90, sgst: 90, cess: 0 });
    expect(round(s.ineligible)).toEqual({ igst: 0, cgst: 36, sgst: 36, cess: 0 });
    expect(round(s.total)).toEqual({ igst: 0, cgst: 126, sgst: 126, cess: 0 });
  });
  it('additional charges are eligible credit at their own rate', () => {
    const s = itcSplit([line(1000, 18, { itcStatus: 'blocked' })], {
      charges: [{ name: 'Freight', amount: 100, gstRate: 5 }],
    });
    expect(round(s.eligible)).toEqual({ igst: 0, cgst: 2.5, sgst: 2.5, cess: 0 });
  });
  it('odd paise split like the screens always did: CGST rounded, SGST the rest', () => {
    const h = splitHeads(0.05, 0, false);
    expect(h.cgst).toBe(0.03);
    expect(h.sgst).toBeCloseTo(0.02, 10); // tax − half, unrounded, exactly as GSTReturns has always computed it
  });
});

describe('tdsCalc (10)', () => {
  it('194C individual: one payment over ₹30,000 → 1%', () => {
    expect(tdsCalc({ section: '194C', base: 40000, deducteeType: 'individual' })).toMatchObject({
      applies: true,
      rate: 1,
      tds: 400,
      reason: 'over_single',
    });
  });
  it('194C company: under both thresholds → nothing', () => {
    expect(tdsCalc({ section: '194C', base: 20000, ytdToDeductee: 50000 })).toMatchObject({
      applies: false,
      tds: 0,
    });
  });
  it('194C: the payment that crosses ₹1,00,000 a year catches up the earlier ones (2%)', () => {
    expect(tdsCalc({ section: '194C', base: 25000, ytdToDeductee: 90000 })).toMatchObject({
      applies: true,
      rate: 2,
      taxableBase: 115000,
      tds: 2300,
      reason: 'crosses_aggregate',
    });
  });
  it('194C: after the threshold was crossed, only the new payment', () => {
    expect(
      tdsCalc({ section: '194C', base: 5000, ytdToDeductee: 120000, ytdDeducted: true }),
    ).toMatchObject({ taxableBase: 5000, tds: 100 });
  });
  it('194J professional 10%, technical 2%', () => {
    expect(tdsCalc({ section: '194J', base: 60000 }).tds).toBe(6000);
    expect(tdsCalc({ section: '194J', base: 60000, alt: true }).tds).toBe(1200);
  });
  it('194H commission at 2% over ₹20,000', () => {
    expect(tdsCalc({ section: '194H', base: 25000 })).toMatchObject({ rate: 2, tds: 500 });
    expect(tdsCalc({ section: '194H', base: 15000 }).applies).toBe(false);
  });
  it('194I rent: land 10%, plant 2%, over ₹50,000 a month', () => {
    expect(tdsCalc({ section: '194I', base: 60000 }).tds).toBe(6000);
    expect(tdsCalc({ section: '194I', base: 60000, alt: true }).tds).toBe(1200);
    expect(tdsCalc({ section: '194I', base: 40000 }).applies).toBe(false);
  });
  it('194Q: 0.1% only on the part above ₹50 lakh', () => {
    expect(tdsCalc({ section: '194Q', base: 1000000, ytdToDeductee: 4500000 })).toMatchObject({
      taxableBase: 500000,
      tds: 500,
    });
    expect(tdsCalc({ section: '194Q', base: 1000000, ytdToDeductee: 6000000 }).taxableBase).toBe(
      1000000,
    );
  });
  it('no PAN: 20% (206AA), 5% for 194Q', () => {
    expect(tdsCalc({ section: '194J', base: 60000, panAvailable: false }).rate).toBe(20);
    expect(
      tdsCalc({ section: '194Q', base: 100, ytdToDeductee: 5000000, panAvailable: false }).rate,
    ).toBe(5);
  });
  it('thresholds can be overridden; an unknown section deducts nothing', () => {
    expect(tdsCalc({ section: '194H', base: 15000, thresholds: { aggregate: 10000 } }).tds).toBe(
      300,
    );
    expect(tdsCalc({ section: '999X', base: 1e6 })).toMatchObject({
      applies: false,
      reason: 'unknown_section',
    });
  });
});

describe('returnableQtyPurchase (5)', () => {
  const bill = [
    { itemId: 'pen', name: 'Pen', quantity: 100 },
    { name: 'Ink', quantity: 10 },
  ];
  it('nothing returned yet: everything is returnable', () => {
    expect(returnableQtyPurchase(bill, [])).toEqual({ 'id:pen': 100, 'nm:ink': 10 });
  });
  it('earlier debit notes reduce it', () => {
    expect(
      returnableQtyPurchase(bill, [{ items: [{ itemId: 'pen', quantity: 30 }] }])['id:pen'],
    ).toBe(70);
  });
  it('a cancelled debit note does not count', () => {
    expect(
      returnableQtyPurchase(bill, [
        { status: 'cancelled', items: [{ itemId: 'pen', quantity: 30 }] },
      ])['id:pen'],
    ).toBe(100);
  });
  it('free-typed lines match by name, ignoring case', () => {
    expect(
      returnableQtyPurchase(bill, [{ items: [{ name: ' INK ', quantity: 4 }] }])['nm:ink'],
    ).toBe(6);
  });
  it('cannot return more than purchased minus prior returns (acceptance 2)', () => {
    const left = returnableQtyPurchase(bill, [{ items: [{ itemId: 'pen', quantity: 95 }] }]);
    expect(overReturns([{ itemId: 'pen', name: 'Pen', quantity: 10 }], left)).toEqual([
      { key: 'id:pen', name: 'Pen', wanted: 10, returnable: 5 },
    ]);
  });
});

describe('landedCost (6)', () => {
  it('no charges: cost is the rate', () => {
    expect(landedCost([line(50, 18, { quantity: 10 })])[0]).toEqual({
      chargeShare: 0,
      value: 500,
      unitCost: 50,
    });
  });
  it('charges spread by value (use case 5)', () => {
    const r = landedCost(
      [line(100, 18, { quantity: 10 }), line(300, 18, { quantity: 10 })],
      [{ name: 'Freight', amount: 400, gstRate: 18 }],
    );
    expect(r.map((x) => x.chargeShare)).toEqual([100, 300]);
    expect(r.map((x) => x.unitCost)).toEqual([110, 330]);
  });
  it('shares always add up to the charges exactly (remainder on the last line)', () => {
    const r = landedCost(
      [line(1, 0, { quantity: 1 }), line(1, 0, { quantity: 1 }), line(1, 0, { quantity: 1 })],
      [{ amount: 100 }],
    );
    expect(r.map((x) => x.chargeShare)).toEqual([33.33, 33.33, 33.34]);
  });
  it('credit we cannot claim goes into cost', () => {
    expect(landedCost([line(1000, 28, { itcStatus: 'ineligible_17_5' })])[0].value).toBe(1280);
  });
  it('credit we claim stays out of cost, and so does the GST on charges', () => {
    expect(landedCost([line(1000, 18)], [{ amount: 100, gstRate: 18 }])[0].value).toBe(1100);
  });
  it('a zero-quantity line costs nothing and does not divide by zero', () => {
    expect(landedCost([line(10, 18, { quantity: 0 })], [{ amount: 50 }])[0].unitCost).toBe(0);
  });
});

describe('the shared allocation engine', () => {
  const docs = [
    { id: 'b2', date: '2026-11-02', pending: 300 },
    { id: 'b1', date: '2026-11-01', pending: 500 },
  ];
  it('Payment Out allocates exactly as Payment In does, with the balance sign mirrored (P3-S2 acceptance 1)', () => {
    const out = allocatePayment({ direction: 'out', amount: 600, tds: 6, docs });
    const inn = allocatePayment({ direction: 'in', amount: 600, tds: 6, docs });
    expect(out.allocations).toEqual(inn.allocations);
    expect(out.allocations).toEqual([
      { docId: 'b1', amount: 500 },
      { docId: 'b2', amount: 106 },
    ]);
    expect(out.balanceEffect).toBe(606);
    expect(inn.balanceEffect).toBe(-606);
    expect(paymentBalanceEffect('out', 10)).toBe(-paymentBalanceEffect('in', 10));
  });
  it('allocateReceipt is the sale side of the same engine', () => {
    expect(allocateReceipt({ amount: 600, invoices: docs }).allocations).toEqual([
      { invoiceId: 'b1', amount: 500 },
      { invoiceId: 'b2', amount: 100 },
    ]);
  });
  it('manual amounts over what is pending are refused', () => {
    expect(
      allocatePayment({
        direction: 'out',
        amount: 1000,
        docs,
        strategy: 'manual',
        manual: { b2: 400 },
      }).ok,
    ).toBe(false);
  });
  it('supplier statement = bills − payments − returns (phase acceptance 3)', () => {
    expect(
      partyStatement({
        documents: [{ total: 4500 }, { total: 1000, cancelled: true }, { total: 2000 }],
        payments: [{ amount: 4455, tds: 45 }],
        returns: [{ total: 70.8 }],
      }),
    ).toEqual({ documents: 6500, settled: 4500, returns: 70.8, balance: 1929.2 });
  });
});

describe('purchase totals, duplicates, orders, debit notes, expenses', () => {
  it('purchaseTotals: charges, round-off and §194Q TDS on the value before GST', () => {
    const t = purchaseTotals({
      lines: [line(1000), line(333.33, 5)],
      charges: [{ amount: 50, gstRate: 18 }],
      roundOff: true,
      tds194QPercent: 0.1,
    });
    expect(t).toMatchObject({
      taxable: 1383.33,
      tax: 205.67,
      total: 1589,
      roundOff: 0,
      tdsAmount: 1,
      payable: 1588,
    });
  });
  it('duplicateBill: same supplier and number in the same FY; other years and other suppliers are fine (use case 4)', () => {
    const bills = [
      { id: 'p1', supplierGstin: '29BBBBB1111B1Z5', invoiceNumber: 'OM/221', date: '2026-05-01' },
    ];
    expect(
      duplicateBill(bills, {
        supplierGstin: '29bbbbb1111b1z5',
        billNo: 'om-221',
        date: '2026-11-05',
      })?.id,
    ).toBe('p1');
    expect(
      duplicateBill(bills, {
        supplierGstin: '29BBBBB1111B1Z5',
        billNo: 'OM/221',
        date: '2027-04-02',
      }),
    ).toBeNull();
    expect(
      duplicateBill(bills, {
        supplierGstin: '27CCCCC2222C1Z5',
        billNo: 'OM/221',
        date: '2026-11-05',
      }),
    ).toBeNull();
    expect(
      duplicateBill(bills, {
        supplierGstin: '29BBBBB1111B1Z5',
        billNo: 'OM/221',
        date: '2026-11-05',
        excludeId: 'p1',
      }),
    ).toBeNull();
  });
  it('purchase order: partial receipt keeps the rest convertible; over-conversion is refused (P3-S3)', () => {
    const order = [{ itemId: 'pen', name: 'Pen', quantity: 100 }];
    const p = purchaseOrderProgress(order, [{ items: [{ itemId: 'pen', quantity: 60 }] }]);
    expect(p.status).toBe('partial');
    expect(p.lines[0]).toMatchObject({ received: 60, pending: 40 });
    expect(overConversion(p.lines, [{ itemId: 'pen', name: 'Pen', quantity: 40 }])).toEqual([]);
    expect(
      overConversion(p.lines, [{ itemId: 'pen', name: 'Pen', quantity: 41 }])[0],
    ).toMatchObject({ wanted: 41, returnable: 40 });
    expect(purchaseOrderProgress(order, []).status).toBe('open');
    expect(
      purchaseOrderProgress(order, [{ items: [{ itemId: 'pen', quantity: 100 }] }]).status,
    ).toBe('received');
    expect(purchaseOrderProgress(order, [], true).status).toBe('cancelled');
  });
  it('a bill line that carries a product id still matches an order line typed by name, and the reverse (found in E2E)', () => {
    const byName = [{ name: 'Pen', quantity: 100 }];
    const p = purchaseOrderProgress(byName, [
      { items: [{ productId: 'prod_1', name: 'pen', quantity: 60 }] },
    ]);
    expect(p.status).toBe('partial');
    expect(p.lines[0]).toMatchObject({ received: 60, pending: 40 });
    expect(
      overConversion(p.lines, [{ productId: 'prod_1', name: 'Pen', quantity: 41 }]),
    ).toHaveLength(1);
    expect(overConversion(p.lines, [{ productId: 'prod_1', name: 'Pen', quantity: 40 }])).toEqual(
      [],
    );
    const byId = purchaseOrderProgress(
      [{ itemId: 'i1', name: 'Pen', quantity: 10 }],
      [{ items: [{ name: 'Pen', quantity: 4 }] }],
    );
    expect(byId.lines[0].received).toBe(4);
    // One delivery is never counted for two order lines.
    const two = purchaseOrderProgress(
      [
        { name: 'Pen', quantity: 5 },
        { name: 'Pen', quantity: 5 },
      ],
      [{ items: [{ productId: 'x', name: 'Pen', quantity: 6 }] }],
    );
    expect(two.lines.map((l) => l.received)).toEqual([5, 1]);
    expect(
      returnableQtyPurchase(
        [{ name: 'Pen', quantity: 10 }],
        [{ items: [{ productId: 'x', name: 'PEN', quantity: 3 }] }],
      ),
    ).toEqual({ 'nm:pen': 7 });
  });

  it('sale orders still read the way Phase 2 shipped them', () => {
    expect(
      saleOrderProgress([{ name: 'A', quantity: 2 }], [{ items: [{ name: 'a', quantity: 1 }] }]),
    ).toEqual({
      lines: [{ key: 'nm:a', name: 'A', ordered: 2, invoiced: 1, pending: 1 }],
      status: 'partially-invoiced',
    });
  });
  it('debit note reverses the claimed credit of what goes back, by the bill line status', () => {
    const bill = [
      { itemId: 'pen', name: 'Pen', quantity: 100, rate: 6, taxPercent: 18 },
      {
        itemId: 'car',
        name: 'Car',
        quantity: 1,
        rate: 1000,
        taxPercent: 28,
        itcStatus: 'ineligible_17_5',
      },
    ];
    const r = debitNoteItcReversal(
      [
        { itemId: 'pen', quantity: 10, rate: 6, taxPercent: 18 },
        { itemId: 'car', quantity: 1, rate: 1000, taxPercent: 28 },
      ],
      { billLines: bill },
    );
    expect(round(r.reversal)).toEqual({ igst: 0, cgst: 5.4, sgst: 5.4, cess: 0 });
    expect(r.value).toBe(1060);
    expect(debitNoteMovesStock('purchase-return')).toBe(true);
    expect(debitNoteMovesStock('rate-difference')).toBe(false);
  });
  it('expenseTotals: itemised or single amount; ITC off keeps GST out of credit; old expenses count as eligible', () => {
    expect(expenseTotals({ items: [{ quantity: 1, rate: 25000, gstRate: 18 }] })).toMatchObject({
      taxable: 25000,
      gst: 4500,
      total: 29500,
      itc: { cgst: 2250, sgst: 2250, igst: 0 },
    });
    expect(expenseTotals({ amount: 1000, gstPercent: 18, interstate: true }).itc).toEqual({
      igst: 180,
      cgst: 0,
      sgst: 0,
    });
    expect(expenseTotals({ amount: 1000, gstAmount: 180, itcEligible: false }).itc).toEqual({
      igst: 0,
      cgst: 0,
      sgst: 0,
    });
  });
  it('§40A(3): cash to one person above ₹10,000 in a day', () => {
    expect(cashPaymentCheck({ dayCashTotal: 6000, newCash: 5000 })).toMatchObject({
      breached: true,
      over: 1000,
    });
    expect(cashPaymentCheck({ newCash: 10000 }).breached).toBe(false);
  });
});
