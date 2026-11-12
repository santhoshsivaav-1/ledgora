import { describe, expect, it } from 'vitest';
import { ACC, billOwnPayments, isBalanced, workspacePostings } from '../src/index.ts';

// The screens' documents post the same vouchers as the typed ones; every voucher balances.
const lines = (ps) => ps.flatMap((p) => p.lines);
const acct = (ps, code) => lines(ps).filter((l) => l.account === code).reduce((n, l) => n + (l.debit || 0) - (l.credit || 0), 0);

describe('workspace bills', () => {
  const bill = {
    id: 'INV-1', invoiceType: 'tax-invoice', invoiceNumber: 'INV-1', invoiceDate: '2026-10-05', status: 'paid', totalAmount: 118,
    payments: [
      { amount: 50, mode: 'cash', date: '2026-10-05' },
      { amount: 30, mode: 'upi', receiptNo: 'RCP-1' }, // posted by its receipt
      { amount: 20, mode: 'credit-applied' }, // credit moved between bills: not money
      { amount: 18, mode: 'other', id: 'r1:adj1' }, // from an advance: posted by the receipt
    ],
    data: { totals: { total: 118, cgst: 9, sgst: 9, igst: 0, cess: 0, roundOff: 0 } },
  };
  it('sale with its own payment only', () => {
    const ps = workspacePostings('bills', bill, '00000000-0000-0000-0000-000000000001');
    expect(ps.every(isBalanced)).toBe(true);
    expect(acct(ps, ACC.SALES)).toBe(-100);
    expect(acct(ps, ACC.OUT_CGST)).toBe(-9);
    expect(acct(ps, ACC.CASH)).toBe(50);
    expect(acct(ps, ACC.RECEIVABLE)).toBe(68);
    expect(billOwnPayments(bill)).toHaveLength(1);
  });
  it('quotations, cancelled bills and nothing post nothing; credit notes reverse', () => {
    expect(workspacePostings('bills', { ...bill, invoiceType: 'quotation' }, 'x')).toEqual([]);
    expect(workspacePostings('bills', { ...bill, status: 'cancelled' }, 'x')).toEqual([]);
    expect(workspacePostings('bills', null, 'x')).toEqual([]);
    const cn = workspacePostings('bills', { ...bill, invoiceType: 'credit-note', payments: [] }, 'x');
    expect(acct(cn, ACC.SALES_RETURN)).toBe(100);
    expect(acct(cn, ACC.RECEIVABLE)).toBe(-118);
  });
});

describe('workspace purchases, receipts and expenses', () => {
  it('purchase with ineligible credit and an inline payment; vouchers paying it are not repeated', () => {
    const p = {
      docType: 'bill', date: '2026-10-02', invoiceNumber: 'S-9', taxableAmount: 1000, totalTax: 180, totalAmount: 1180, interstate: false,
      items: [{ name: 'A', quantity: 1, rate: 500, taxPercent: 18 }, { name: 'B', quantity: 1, rate: 500, taxPercent: 18, itcStatus: 'ineligible_17_5' }],
      payments: [{ amount: 100, mode: 'cash', source: 'purchase_inline' }, { amount: 200, mode: 'bank', source: 'voucher' }],
    };
    const ps = workspacePostings('purchases', p, 'x');
    expect(ps.every(isBalanced)).toBe(true);
    expect(acct(ps, ACC.PURCHASES)).toBe(1000);
    expect(acct(ps, ACC.IN_CGST)).toBe(45);
    expect(acct(ps, ACC.INELIGIBLE_GST)).toBe(90);
    expect(acct(ps, ACC.CASH)).toBe(-100);
    expect(acct(ps, ACC.PAYABLE)).toBe(-1080);
  });
  it('receipt in, payment out with TDS, expense with GST, income', () => {
    const rin = workspacePostings('receipts', { date: '2026-10-07', amount: 900, tds: 100, mode: 'UPI', receiptNo: 'R1' }, 'x');
    expect(acct(rin, ACC.BANK_UNASSIGNED)).toBe(900);
    expect(acct(rin, ACC.TDS_RECEIVABLE)).toBe(100);
    expect(acct(rin, ACC.RECEIVABLE)).toBe(-1000);
    const rout = workspacePostings('receipts', { direction: 'out', date: '2026-10-07', amount: 980, tds: 20, mode: 'cash' }, 'x');
    expect(acct(rout, ACC.PAYABLE)).toBe(1000);
    expect(acct(rout, ACC.TDS_PAYABLE)).toBe(-20);
    const ex = workspacePostings('expenses', { date: '2026-10-08', amount: 1180, gstAmount: 180, paymentMode: 'cash' }, 'x');
    expect(acct(ex, ACC.EXPENSES)).toBe(1000);
    expect(acct(ex, ACC.CASH)).toBe(-1180);
    const inc = workspacePostings('expenses', { kind: 'income', date: '2026-10-08', amount: 500, gstAmount: 0, exempt: true, paymentMode: 'cash' }, 'x');
    expect(acct(inc, ACC.OTHER_INCOME)).toBe(-500);
    for (const ps of [rin, rout, ex, inc]) expect(ps.every(isBalanced)).toBe(true);
  });
});
