// Vyapar parity Phase 3 on the web: the purchase-document rules the screens use (features/purchases/purchaseExtras.js)
// and the Payment block reused on Add Purchase. Server-rendered, no DOM (Phase 0 decision 5).
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import PaymentBlock from '../src/features/invoices/editor/PaymentBlock';
import { purchaseDocType } from '../src/lib/data/purchases';
import { isIncome } from '../src/lib/data/expenses';
import { isPaymentOut } from '../src/lib/data/receipts';
import {
  advanceEntryFor,
  applyPaymentOut,
  billPrefillFromOrder,
  cashOutWarning,
  findDuplicateBill,
  gridToItems,
  itemsToGrid,
  mergePurchasePayments,
  overConversionOf,
  purchaseDue,
  purchaseFormTotals,
  purchasePending,
  purchaseStatus,
  releasePaymentOut,
  returnableOf,
  tdsSuggestion,
} from '../src/features/purchases/purchaseExtras';

const line = (rate, taxPercent = 18, extra = {}) => ({
  name: 'Pen',
  quantity: 1,
  rate,
  taxPercent,
  ...extra,
});

describe('documents sharing a collection are told apart, old ones read as before', () => {
  it('purchases: docType missing = bill; expenses: kind missing = expense; vouchers: direction missing = in', () => {
    expect(purchaseDocType({})).toBe('bill');
    expect(purchaseDocType({ docType: 'order' })).toBe('order');
    expect(purchaseDocType({ docType: 'nonsense' })).toBe('bill');
    expect(isIncome({})).toBe(false);
    expect(isIncome({ kind: 'income' })).toBe(true);
    expect(isPaymentOut({})).toBe(false);
    expect(isPaymentOut({ direction: 'out' })).toBe(true);
  });
});

describe('purchase bill totals (P3-S1)', () => {
  it('a bill with no charges or TDS totals exactly as the screen always did', () => {
    const items = [line(1000), line(333.33, 5, { cessPercent: 1 })];
    const was = items.reduce(
      (a, i) => {
        const amt = i.quantity * i.rate;
        const tax = (amt * i.taxPercent) / 100;
        const cess = (amt * (i.cessPercent || 0)) / 100;
        return {
          taxable: a.taxable + amt,
          tax: a.tax + tax,
          cess: a.cess + cess,
          total: a.total + amt + tax + cess,
        };
      },
      { taxable: 0, tax: 0, cess: 0, total: 0 },
    );
    const now = purchaseFormTotals(items, { applyRoundOff: true });
    expect({ taxable: now.taxable, tax: now.tax, cess: now.cess, total: now.total }).toEqual(was);
    expect(now.roundOff).toBe(Math.round((Math.round(was.total) - was.total) * 100) / 100);
    expect(now.tdsAmount).toBe(0);
  });
  it('charges add taxable value and GST; §194Q TDS is on the value before GST and lowers what we pay', () => {
    const t = purchaseFormTotals([line(100000)], {
      charges: [{ name: 'Freight', amount: 1000, gstRate: 18 }],
      tds194QPercent: 0.1,
    });
    expect(t).toMatchObject({
      taxable: 101000,
      tax: 18180,
      finalTotal: 119180,
      tdsAmount: 101,
      payable: 119079,
    });
  });
  it('the ITC dropdown maps to the grid tick and back without losing the finer status', () => {
    const grid = itemsToGrid([
      line(10, 18, { itcStatus: 'ineligible_17_5' }),
      line(10),
      line(10, 18, { itcStatus: 'capital_goods' }),
    ]);
    expect(grid.map((g) => g.itc)).toEqual([false, true, true]);
    expect(gridToItems(grid).map((i) => i.itcStatus)).toEqual([
      'ineligible_17_5',
      undefined,
      'capital_goods',
    ]);
    expect(
      gridToItems([{ item: 'Food', qty: 1, rate: 100, gst: 5, itc: false }])[0].itcStatus,
    ).toBe('blocked');
  });
  it('duplicate supplier bill number in the same FY is found; the bill being edited is not its own duplicate', () => {
    const bills = [
      { id: 'p1', supplierName: 'Om Supplies', invoiceNumber: 'OM/221', date: '2026-05-01' },
    ];
    expect(
      findDuplicateBill(bills, {
        supplierName: 'om supplies',
        invoiceNumber: 'OM-221',
        date: '2026-11-05',
      })?.id,
    ).toBe('p1');
    expect(
      findDuplicateBill(
        bills,
        { supplierName: 'Om Supplies', invoiceNumber: 'OM/221', date: '2026-11-05' },
        'p1',
      ),
    ).toBeNull();
  });
  it('inline rows replace themselves on save; voucher entries stay', () => {
    const saved = [
      { id: 'v', source: 'payment_out', amount: 100, voucherId: 'x' },
      { id: 'old', source: 'purchase_inline', amount: 50 },
    ];
    const merged = mergePurchasePayments(
      saved,
      [
        { mode: 'upi', amount: 70 },
        { mode: 'cash', amount: 0 },
      ],
      { date: '2026-11-05' },
    );
    expect(merged.map((p) => [p.source, p.amount])).toEqual([
      ['payment_out', 100],
      ['purchase_inline', 70],
    ]);
  });
});

describe('Payment Out on the web (P3-S2) uses the shared engine', () => {
  const bills = [
    { id: 'b2', supplierName: 'Om', date: '2026-11-04', totalAmount: 1500 },
    { id: 'b1', supplierName: 'Om', date: '2026-11-01', totalAmount: 3000 },
    { id: 'x', supplierName: 'Other', date: '2026-10-01', totalAmount: 999 },
  ];
  it('oldest bill first, TDS settles like money, the rest is an advance; release undoes it', () => {
    const r = applyPaymentOut({
      bills,
      voucher: {
        id: 'v1',
        voucherNo: 'PAY-1',
        supplierName: 'om',
        amount: 4455,
        tds: 45,
        date: '2026-11-06',
      },
    });
    expect(r.allocations).toEqual([
      { docId: 'b1', amount: 3000 },
      { docId: 'b2', amount: 1500 },
    ]);
    expect(r.updated.map((b) => b.paymentStatus)).toEqual(['Paid', 'Paid']);
    expect(r.balanceEffect).toBe(4500);
    const after = bills.map((b) => r.updated.find((u) => u.id === b.id) || b);
    expect(releasePaymentOut(after, 'v1').map((b) => b.paymentStatus)).toEqual([
      'Unpaid',
      'Unpaid',
    ]);
  });
  it('a voucher not saved yet (no id) keeps the advance and inline payments already on the bill (found in E2E)', () => {
    const paid = [
      {
        id: 'b',
        supplierName: 'Om',
        date: '2026-11-01',
        totalAmount: 708,
        payments: [{ source: 'po_advance', amount: 300 }],
      },
    ];
    const r = applyPaymentOut({ bills: paid, voucher: { supplierName: 'Om', amount: 1000 } });
    expect(r.allocations).toEqual([{ docId: 'b', amount: 408 }]);
    expect(r.updated[0].payments.map((p) => p.amount)).toEqual([300, 408]);
  });
  it('manual amounts above what is pending are refused', () => {
    expect(
      applyPaymentOut({
        bills,
        voucher: { id: 'v', supplierName: 'Om', amount: 5000 },
        manual: { b1: 3001 },
      }).ok,
    ).toBe(false);
  });
  it('a debit note settled by adjustment lowers what is due; TDS withheld does too', () => {
    const bill = { id: 'b', totalAmount: 708, tdsAmount: 1, payments: [{ amount: 100 }] };
    const dn = [
      { againstPurchaseId: 'b', totalAmount: 70.8, refundMode: 'adjust' },
      { againstPurchaseId: 'b', totalAmount: 50, refundMode: 'cash' },
    ];
    expect(purchaseDue(bill, dn)).toBe(636.2);
    expect(purchasePending(bill, dn)).toBe(536.2);
    expect(purchaseStatus({ ...bill, payments: [{ amount: 636.2 }] }, dn)).toBe('Paid');
    expect(purchaseStatus({ paymentStatus: 'Partial' })).toBe('Partial'); // no payments recorded: the user's choice stands
  });
  it('suggests TDS from the year so far, and flags cash over ₹10,000 a day (§40A(3))', () => {
    const vouchers = [
      {
        id: 'a',
        supplierName: 'Om',
        tdsSection: '194C',
        amount: 90000,
        tds: 0,
        date: '2026-06-01',
      },
    ];
    const s = tdsSuggestion({
      vouchers,
      voucher: { supplierName: 'Om', tdsSection: '194C', amount: 25000, date: '2026-11-06' },
    });
    expect(s).toMatchObject({ applies: true, taxableBase: 115000, tds: 2300 });
    expect(tdsSuggestion({ vouchers, voucher: { supplierName: 'Om', amount: 5 } })).toBeNull();
    const w = cashOutWarning({
      vouchers: [{ id: 'c', supplierName: 'Om', date: '2026-11-06', mode: 'Cash', amount: 6000 }],
      voucher: { supplierName: 'Om', date: '2026-11-06', mode: 'Cash', amount: 5000 },
    });
    expect(w).toMatchObject({ breached: true, total: 11000 });
  });
});

describe('purchase orders and debit notes (P3-S3, P3-S4)', () => {
  const order = {
    id: 'po',
    number: 'PO-1',
    supplierName: 'Om',
    date: '2026-11-01',
    advance: 300,
    items: [{ name: 'Pen', quantity: 100, rate: 10 }],
  };
  it('receive goods: the bill opens with what is pending; over-receiving is refused', () => {
    const bills = [{ id: 'b1', poId: 'po', items: [{ name: 'Pen', quantity: 60 }] }];
    const pre = billPrefillFromOrder(order, bills);
    expect(pre).toMatchObject({ poId: 'po', poNumber: 'PO-1', supplierName: 'Om' });
    expect(pre.items).toEqual([
      expect.objectContaining({ name: 'Pen', quantity: 40, itcStatus: 'eligible' }),
    ]);
    expect(overConversionOf(order, bills, [{ name: 'Pen', quantity: 40 }])).toEqual([]);
    expect(overConversionOf(order, bills, [{ name: 'Pen', quantity: 41 }])).toHaveLength(1);
    // Editing the first bill: its own quantity is not counted against itself.
    expect(overConversionOf(order, bills, [{ name: 'Pen', quantity: 100 }], 'b1')).toEqual([]);
  });
  it('the order advance is applied once, to the first bill, up to what it asks', () => {
    expect(advanceEntryFor(order, [], 250, 'b1')).toMatchObject({
      amount: 250,
      source: 'po_advance',
    });
    const used = [{ id: 'b1', poId: 'po', payments: [{ source: 'po_advance', amount: 250 }] }];
    expect(advanceEntryFor(order, used, 1000, 'b2').amount).toBe(50);
    expect(advanceEntryFor({ ...order, advance: 0 }, [], 1000)).toBeNull();
  });
  it('returnable = bought less earlier debit notes against the bill', () => {
    const bill = { id: 'b', items: [{ itemId: 'pen', name: 'Pen', quantity: 100 }] };
    const notes = [
      { againstPurchaseId: 'b', items: [{ itemId: 'pen', quantity: 30 }] },
      { againstPurchaseId: 'other', items: [{ itemId: 'pen', quantity: 5 }] },
    ];
    expect(returnableOf(bill, notes)).toEqual({ 'id:pen': 70 });
  });
});

describe('Payment block on Add Purchase', () => {
  it('reads as money paid when direction is out, and is unchanged for sales', () => {
    const props = {
      rows: [{ mode: 'cash', amount: 100 }],
      onRowsChange: () => {},
      saleType: 'credit',
      onSaleTypeChange: () => {},
      total: 500,
      payments: [],
      currency: 'INR',
    };
    const out = renderToStaticMarkup(h(PaymentBlock, { ...props, direction: 'out' }));
    const sale = renderToStaticMarkup(h(PaymentBlock, props));
    expect(out).toContain('Paid');
    expect(out).toContain('aria-label="Purchase type"');
    expect(sale).toContain('Received');
    expect(sale).toContain('aria-label="Sale type"');
  });
});

// ---- the gaps closed after the first Phase 3 pass ------------------------------------------------------------------------
import {
  panFromGstin,
  supplierStatementOf,
  tdsRegister,
} from '../src/features/purchases/purchaseExtras';
import {
  addCategory,
  categoryOptions,
  categoryRollup,
  fillFromExpenseItem,
  removeCategory,
} from '../src/features/expenses/expenseSetup';

describe('supplier statement (Phase 3 acceptance 3)', () => {
  it('bills − payments − returns, with the balance after each entry; a refunded debit note nets to nothing', () => {
    const st = supplierStatementOf({
      supplierName: 'Om',
      bills: [
        {
          supplierName: 'Om',
          date: '2026-11-05',
          invoiceNumber: 'OM-221',
          totalAmount: 708,
          tdsAmount: 0,
          payments: [
            { source: 'po_advance', amount: 300 },
            { source: 'payment_out', amount: 290, voucherId: 'v' },
          ],
        },
      ],
      orders: [{ supplierName: 'Om', date: '2026-11-01', number: 'PO-1', advance: 300 }],
      vouchers: [
        { supplierName: 'om', date: '2026-11-07', voucherNo: 'PAY-1', amount: 280, tds: 10 },
      ],
      debitNotes: [
        { supplierName: 'Om', date: '2026-11-06', number: 'DN-1', totalAmount: 118 },
        {
          supplierName: 'Om',
          date: '2026-11-06',
          number: 'DN-2',
          totalAmount: 50,
          refundMode: 'cash',
        },
      ],
    });
    expect(st.rows.map((r) => [r.type, r.payable, r.balance])).toEqual([
      ['Order advance', -300, -300],
      ['Bill', 708, 408],
      ['Debit note', -118, 290],
      ['Debit note', -50, 240],
      ['Refund received', 50, 290],
      ['Payment Out', -290, 0],
    ]);
    expect(st.balance).toBe(0);
    expect(st).toMatchObject({ documents: 708 });
  });
});

describe('TDS register (P3-S2 acceptance 2)', () => {
  const vouchers = [
    {
      supplierName: 'Om',
      date: '2026-10-05',
      voucherNo: 'PAY-1',
      amount: 9800,
      tds: 200,
      tdsSection: '194C',
    },
    {
      supplierName: 'Om',
      date: '2026-11-05',
      voucherNo: 'PAY-2',
      amount: 4900,
      tds: 100,
      tdsSection: '194C',
    },
    {
      supplierName: 'CA Firm',
      date: '2026-12-01',
      voucherNo: 'PAY-3',
      amount: 54000,
      tds: 6000,
      tdsSection: '194J',
    },
    { supplierName: 'Om', date: '2026-09-30', amount: 100, tds: 1, tdsSection: '194C' },
    { supplierName: 'No TDS', date: '2026-11-01', amount: 100 },
  ];
  it('per deductee and section for the quarter, gross paid, PAN from the GSTIN', () => {
    const r = tdsRegister(vouchers, {
      from: '2026-10-01',
      to: '2026-12-31',
      bills: [{ supplierName: 'Om', supplierGstin: '33ABCDE1234F1Z5' }],
    });
    expect(r.summary).toEqual([
      {
        deductee: 'Om',
        pan: 'ABCDE1234F',
        section: '194C',
        nature: 'Contractors',
        paid: 15000,
        tds: 300,
        count: 2,
      },
      {
        deductee: 'CA Firm',
        pan: '',
        section: '194J',
        nature: 'Professional / technical fees',
        paid: 60000,
        tds: 6000,
        count: 1,
      },
    ]);
    expect(r.total).toBe(6300);
    expect(panFromGstin('bad')).toBe('');
  });
});

describe('expense categories and items (P3-S5)', () => {
  const builtins = ['Office Rent', 'Raw Materials', 'Other'];
  it('built-ins keep their place; own categories sit under a parent with a P&L kind', () => {
    let custom = [];
    let opts = categoryOptions(builtins, custom);
    expect(opts.find((o) => o.name === 'Raw Materials').kind).toBe('direct');
    custom = addCategory(custom, opts, {
      name: 'Electricity',
      parent: 'Office Rent',
      kind: 'indirect',
    }).categories;
    opts = categoryOptions(builtins, custom);
    expect(opts.find((o) => o.name === 'Electricity')).toMatchObject({
      label: 'Office Rent › Electricity',
      kind: 'indirect',
      custom: true,
    });
    expect(addCategory(custom, opts, { name: 'electricity', kind: 'indirect' }).error).toMatch(
      /exists/,
    );
    expect(
      addCategory(custom, opts, { name: 'Late fee', parent: 'Nope', kind: 'indirect' }).error,
    ).toMatch(/parent/);
    // An income category is not offered on expenses, and can not sit under an expense one.
    expect(
      addCategory(custom, opts, { name: 'Interest', parent: 'Office Rent', kind: 'income' }).error,
    ).toMatch(/same kind/);
    expect(
      categoryOptions(builtins, [...custom, { name: 'Tips', kind: 'income' }]).some(
        (o) => o.name === 'Tips',
      ),
    ).toBe(false);
  });
  it('removing a parent moves its children up; totals roll children into parents', () => {
    const custom = [
      { name: 'Utilities', parent: '', kind: 'indirect' },
      { name: 'Power', parent: 'Utilities', kind: 'indirect' },
      { name: 'Water', parent: 'Utilities', kind: 'indirect' },
    ];
    expect(removeCategory(custom, 'Utilities')).toEqual([
      { name: 'Power', parent: '', kind: 'indirect' },
      { name: 'Water', parent: '', kind: 'indirect' },
    ]);
    const roll = categoryRollup(
      [
        { category: 'Power', amount: 1000 },
        { category: 'Water', amount: 200 },
        { category: 'Utilities', amount: 50 },
        { amount: 5 },
      ],
      custom,
    );
    expect(roll.find((r) => r.category === 'Utilities')).toMatchObject({ own: 50, total: 1250 });
    expect(roll.find((r) => r.category === 'Power')).toMatchObject({
      own: 1000,
      total: 1000,
      parent: 'Utilities',
    });
    expect(roll.find((r) => r.category === 'Other').total).toBe(5);
  });
  it('naming a saved expense item fills its SAC, rate and GST %', () => {
    const items = [
      { name: 'Office rent', sac: '9972', defaultRate: 25000, gstRate: 18 },
      { name: 'Diesel', sac: '', defaultRate: 0, gstRate: 0 },
    ];
    expect(
      fillFromExpenseItem({ item: 'office rent', hsn: '', rate: '', gst: 18 }, items),
    ).toMatchObject({ hsn: '9972', rate: 25000, gst: 18 });
    expect(
      fillFromExpenseItem({ item: 'Diesel', hsn: '', rate: 90, gst: 18 }, items),
    ).toMatchObject({ rate: 90, gst: 0 });
    expect(fillFromExpenseItem({ item: 'Unknown', gst: 12 }, items)).toEqual({
      item: 'Unknown',
      gst: 12,
    });
  });
});

describe('TDS payable (P10-S5): due dates, interest, PAN flag, challans, §194Q rows', () => {
  const vouchers = [
    {
      id: 'v1',
      supplierName: 'Landlord',
      date: '2026-10-15',
      voucherNo: 'PAY-1',
      amount: 4950,
      tds: 50,
      tdsSection: '194C',
    },
    {
      id: 'v2',
      supplierName: 'Om',
      date: '2026-10-20',
      voucherNo: 'PAY-2',
      amount: 9900,
      tds: 100,
      tdsSection: '194C',
      tdsChallan: { no: '12', bsr: '0510308', date: '2026-11-05' },
    },
    { id: 'v3', supplierName: 'No tds', date: '2026-10-21', amount: 5 },
  ];
  const bills = [
    {
      id: 'b1',
      supplierName: 'Om',
      supplierGstin: '29ABCDE1234F1Z5',
      date: '2026-11-20',
      invoiceNumber: 'OM-1',
      taxableAmount: 100000,
      tdsAmount: 100,
    },
    { id: 'b2', docType: 'order', tdsAmount: 5, date: '2026-11-20' },
  ];
  it('lists TDS from vouchers and §194Q bills with due dates, interest and status', async () => {
    const { tdsPayableRows } = await import('../src/features/purchases/purchaseExtras');
    const r = tdsPayableRows(vouchers, bills, {
      from: '2026-10-01',
      to: '2026-12-31',
      asOf: '2026-12-20',
    });
    expect(r.rows.map((x) => [x.key, x.dueDate, x.status, x.overdue])).toEqual([
      ['voucher:v1', '2026-11-07', 'accrued', true],
      ['voucher:v2', '2026-11-07', 'deposited', false],
      ['bill:b1', '2026-12-07', 'accrued', true],
    ]);
    expect(r.rows[0]).toMatchObject({ panMissing: true, paid: 5000, interest: 2.25 }); // 15 Oct to 20 Dec is two months and part of a third: 50 × 1.5% × 3
    expect(r.rows[2]).toMatchObject({
      section: '194Q',
      pan: 'ABCDE1234F',
      panMissing: false,
      paid: 100000,
      tds: 100,
      interest: 1.5,
    }); // 20 Nov to 20 Dec is exactly one month
    expect(r).toMatchObject({ total: 250, deposited: 100, pending: 150 });
    expect(r.interest).toBe(3.75);
  });
  it('a challan paid on time carries no interest', async () => {
    const { tdsPayableRows } = await import('../src/features/purchases/purchaseExtras');
    const r = tdsPayableRows(
      [
        {
          id: 'v',
          supplierName: 'X',
          date: '2026-10-15',
          amount: 900,
          tds: 100,
          tdsSection: '194C',
          tdsChallan: { no: '1', bsr: '0510308', date: '2026-11-07' },
        },
      ],
      [],
      { asOf: '2027-01-01' },
    );
    expect(r.rows[0]).toMatchObject({ status: 'deposited', overdue: false, interest: 0 });
    expect(r.interest).toBe(0);
  });
});
