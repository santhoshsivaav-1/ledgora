// Vyapar parity Phase 2, web layer: the editor's payment rows, charges and save checks on invoice documents, the
// Salesman form helpers, GST returns with charges, and the PaymentBlock / ChargeRows / TotalsPanel markup.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  clientOutstanding,
  creditNoteOverReturns,
  dayCashFromBills,
  inlineRowsOf,
  mergeInlinePayments,
  orderProgressFromBills,
  paymentSummary,
  saveChecks,
  savedCharges,
  takesPayment,
} from '../src/features/invoices/editor/saleExtras';
import { monthRange, staffBody, staffFormErrors } from '../src/lib/data/staff';
import { withChargeLines } from '../src/features/gst-returns/gstReturnTables';
import PaymentBlock from '../src/features/invoices/editor/PaymentBlock';
import ChargeRows from '../src/features/invoices/editor/ChargeRows';
import TotalsPanel from '../src/features/print/TotalsPanel';
import { computeInvoiceTotals } from '../src/utils';

const bill = (over = {}) => ({
  id: over.id || 'INV-1',
  invoiceNumber: over.id || 'INV-1',
  invoiceType: 'tax-invoice',
  clientName: 'Ravi Traders',
  totalAmount: 1000,
  paidAmount: 0,
  status: 'unpaid',
  payments: [],
  data: { items: [], totals: {} },
  ...over,
});

describe('PaymentBlock math', () => {
  it('two rows that cover the total: paid, balance 0', () => {
    const s = paymentSummary([{ mode: 'cash', amount: 500 }, { mode: 'upi', amount: 400 }], { total: 900, payments: [] });
    expect(s).toMatchObject({ ok: true, paid: 900, balance: 0, status: 'paid' });
  });

  it('a receipt recorded earlier counts toward the cap; over-paying is an error', () => {
    const payments = [{ amount: 600, receiptNo: 'RCT-4' }];
    const s = paymentSummary([{ mode: 'cash', amount: 500 }], { total: 1000, payments });
    expect(s.ok).toBe(false);
    expect(s.errors[0].message).toBe('Received exceeds total by ₹100.00');
  });

  it('rows round-trip through the bill: other payments kept, inline ones replaced', () => {
    const earlier = { id: 'pay_1', amount: 100, receiptNo: 'RCT-1' };
    const first = mergeInlinePayments([earlier], [{ mode: 'cash', amount: 300 }, { mode: 'upi', amount: 0 }], {
      date: '2026-11-10',
      invoiceNumber: 'INV-9',
      now: () => 'T',
    });
    expect(first).toHaveLength(2);
    expect(first[1]).toMatchObject({ amount: 300, mode: 'cash', date: '2026-11-10', source: 'invoice_inline', note: 'Received with INV-9' });
    const rows = inlineRowsOf({ payments: first });
    expect(rows).toEqual([{ id: first[1].id, mode: 'cash', amount: 300, reference: '', chequeDate: '', accountId: null }]);
    const second = mergeInlinePayments(first, [{ ...rows[0], amount: 250 }], { date: '2026-11-10', invoiceNumber: 'INV-9' });
    expect(second.map((p) => p.amount)).toEqual([100, 250]);
    expect(second[1].id).toBe(first[1].id);
  });

  it('payments are taken on sales and sale orders only', () => {
    expect(['tax-invoice', 'bill-of-supply', 'composition', 'sales-order'].every(takesPayment)).toBe(true);
    expect(['quotation', 'proforma', 'delivery-challan', 'credit-note'].some(takesPayment)).toBe(false);
  });

  it('renders rows, the post-dated chip and the over-payment error', () => {
    const html = renderToStaticMarkup(
      h(PaymentBlock, {
        rows: [{ mode: 'cheque', amount: 1200, reference: '0042', chequeDate: '2999-01-01' }],
        onRowsChange: () => {},
        saleType: 'credit',
        onSaleTypeChange: () => {},
        total: 1000,
        payments: [],
        currency: 'INR',
      }),
    );
    expect(html).toContain('Post-dated');
    expect(html).toContain('Received exceeds total by ₹200.00');
    expect(html).toContain('Add payment mode');
  });
});

describe('save checks on invoice documents', () => {
  const bills = [
    bill({ id: 'INV-1', totalAmount: 42000 }),
    bill({ id: 'INV-2', totalAmount: 5000, paidAmount: 5000, status: 'paid' }),
    bill({ id: 'CN-1', invoiceType: 'credit-note', totalAmount: 2000 }),
    bill({ id: 'INV-X', totalAmount: 9999, status: 'cancelled' }),
    bill({ id: 'INV-O', clientName: 'Someone Else', totalAmount: 9999 }),
  ];
  it('outstanding: unpaid sales less credit notes, skipping cancelled and other clients', () => {
    expect(clientOutstanding(bills, ' ravi traders ')).toBe(40000);
    expect(clientOutstanding(bills, 'Ravi Traders', 'INV-1')).toBe(-2000);
  });

  it('credit limit warn and block, net of money received with the sale', () => {
    const client = { name: 'Ravi Traders', creditLimit: 50000, creditMode: 'warn' };
    const base = { client, bills, invoiceType: 'tax-invoice', payments: [], invoiceDate: '2026-11-10' };
    expect(saveChecks({ ...base, total: 10000, rows: [] })).toEqual([]);
    const [c] = saveChecks({ ...base, total: 20000, rows: [] });
    expect(c).toMatchObject({ kind: 'credit', mode: 'warn', used: 40000, after: 60000, exceededBy: 10000 });
    expect(saveChecks({ ...base, total: 20000, rows: [{ mode: 'upi', amount: 10000 }] })).toEqual([]);
    expect(saveChecks({ ...base, client: { ...client, creditMode: 'block' }, total: 20000, rows: [] })[0].mode).toBe('block');
    expect(saveChecks({ ...base, invoiceType: 'quotation', total: 99999, rows: [] })).toEqual([]);
  });

  it('§269ST: cash already paid that day plus this sale', () => {
    const withCash = [bill({ id: 'INV-7', payments: [{ mode: 'cash', amount: 150000, date: '2026-11-10' }] })];
    expect(dayCashFromBills(withCash, 'Ravi Traders', '2026-11-10')).toBe(150000);
    const [c] = saveChecks({
      client: { name: 'Ravi Traders' },
      bills: withCash,
      invoiceType: 'tax-invoice',
      total: 60000,
      rows: [{ mode: 'cash', amount: 60000 }],
      payments: [],
      invoiceDate: '2026-11-10',
    });
    expect(c).toMatchObject({ kind: 'cash', breached: true, total: 210000 });
  });
});

describe('credit notes and sale orders on documents', () => {
  const inv = bill({ id: 'INV-5', data: { items: [{ productId: 'pen', name: 'Pen', quantity: 10 }] } });
  const cn = (id, qty, status = 'unpaid') =>
    bill({ id, invoiceType: 'credit-note', status, data: { details: { originalInvoiceRef: 'INV-5' }, items: [{ productId: 'pen', name: 'Pen', quantity: qty }] } });
  it('cannot return more than is left; the credit note being edited does not count', () => {
    const bills = [inv, cn('CN-1', 4), cn('CN-2', 5, 'cancelled')];
    const over = (q, editingId) =>
      creditNoteOverReturns({ bills, againstNumber: 'INV-5', items: [{ productId: 'pen', name: 'Pen', quantity: q }], editingId });
    expect(over(6)).toEqual([]);
    expect(over(7)).toHaveLength(1);
    expect(over(10, 'CN-1')).toEqual([]);
    expect(creditNoteOverReturns({ bills, againstNumber: 'NOPE', items: [] })).toEqual([]);
  });

  it('a sale order shows what its invoices have taken', () => {
    const order = bill({ id: 'SO-1', invoiceType: 'sales-order', data: { items: [{ productId: 'pen', name: 'Pen Blue', quantity: 100 }] } });
    const made = bill({ id: 'INV-8', data: { sourceDoc: { number: 'SO-1' }, items: [{ productId: 'pen', name: 'Pen Blue', quantity: 40 }] } });
    const p = orderProgressFromBills(order, [order, made]);
    expect(p.status).toBe('partially-invoiced');
    expect(p.lines[0]).toMatchObject({ ordered: 100, invoiced: 40, pending: 60 });
  });
});

describe('additional charges on documents', () => {
  it('blank rows drop out and each saved charge gets an id', () => {
    expect(savedCharges([{ name: 'Shipping', amount: 100, gstRate: 5, hsn: '9965' }, { name: 'x', amount: null }])).toEqual([
      { id: 'chg_1', name: 'Shipping', amount: 100, gstRate: 5, hsn: '9965', taxable: true },
    ]);
  });

  it('GST returns see charges as isCharge lines; bills without charges are untouched', () => {
    const plain = bill();
    expect(withChargeLines(plain)).toBe(plain);
    const b = withChargeLines(bill({ data: { items: [{ name: 'Pen', quantity: 1, rate: 1000, taxPercent: 18 }], charges: [{ name: 'Shipping', amount: 100, gstRate: 5, hsn: '9965' }] } }));
    expect(b.data.items).toHaveLength(2);
    expect(b.data.items[1]).toMatchObject({ hsn: '9965', rate: 100, taxPercent: 5, isCharge: true });
  });

  it('ChargeRows and the printed totals show each charge', () => {
    const totals = computeInvoiceTotals({
      items: [{ quantity: 1, rate: 1000, taxPercent: 18 }],
      profile: { country: 'India', state: 'Punjab' },
      client: { state: 'Punjab' },
      details: { placeOfSupply: 'Punjab' },
      showGST: true,
      charges: [{ name: 'Shipping', amount: 100, gstRate: 5, hsn: '9965' }],
    });
    const rows = renderToStaticMarkup(h(ChargeRows, { charges: [{ name: 'Shipping', amount: 100, gstRate: 5, hsn: '9965' }], onChange: () => {}, totals, currency: 'INR', showGST: true }));
    expect(rows).toContain('Additional charges');
    expect(rows).toContain('Add charge');
    const fmt = (n) => Number(n).toFixed(2);
    const props = { _ps_labels: {}, accent: '#000', fmt, invoiceType: 'tax-invoice', isIndia: true, isInterstate: false, pdfStyle: 'classic', showGST: true, showSubtotal: true, taxLabel: 'GST', totalDueLabel: 'Total', totals };
    const each = renderToStaticMarkup(h(TotalsPanel, { ...props, options: {} }));
    expect(each).toContain('Shipping (GST 5%)');
    expect(each).toContain('1285.00');
    const one = renderToStaticMarkup(h(TotalsPanel, { ...props, options: { showChargeRows: false } }));
    expect(one).toContain('Additional charges');
    expect(one).not.toContain('Shipping');
  });
});

describe('Salesman form', () => {
  it('validates like the API', () => {
    expect(staffFormErrors({ name: '', phone: '123', commissionPct: 120, monthlyTarget: -1 })).toEqual({
      name: 'Enter a name',
      phone: 'Use 10 digits',
      commissionPct: 'Between 0 and 100',
      monthlyTarget: 'Cannot be negative',
    });
    expect(staffFormErrors({ name: 'Kumar', phone: '98765 43210' })).toEqual({});
  });
  it('builds the API body', () => {
    expect(staffBody({ name: ' Kumar ', phone: '98765-43210', userId: '', commissionPct: '2.5', monthlyTarget: '500000' })).toEqual({
      name: 'Kumar',
      phone: '9876543210',
      userId: null,
      commissionPct: 2.5,
      monthlyTarget: 500000,
      active: true,
    });
  });
  it('this month, including leap years', () => {
    expect(monthRange('2028-02-14')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-11-10')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
});
