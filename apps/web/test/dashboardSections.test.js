// Audit Phase 3 / S6 — unit tests for the logic extracted out of the old
// 1,700-line Dashboard.jsx and for the paged-bills query builder. Pure logic
// only: rendering is covered elsewhere, and anything that touches the network
// runs against a mocked lib/data.

import { describe, expect, it, vi, beforeEach } from 'vitest';

// useBillsLoader / reconcilePayments write through lib/data; mock the whole
// module so no test ever hits the network. Everything the dashboard's loader
// imports must appear here.
vi.mock('../src/lib/data/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
  API: '/v1/workspace',
}));
vi.mock('../src/lib/data', () => ({
  saveBill: vi.fn().mockResolvedValue({}),
  getAllBills: vi.fn().mockResolvedValue([]),
  listBillsPage: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
  getAllReceipts: vi.fn().mockResolvedValue([]),
  deleteReceipt: vi.fn().mockResolvedValue({}),
  saveReceipt: vi.fn().mockResolvedValue({}),
}));

import { billsPageQuery, listBillsPage } from '../src/lib/data/bills';
import { saveBill, getAllReceipts } from '../src/lib/data';
import { markOverdue, reconcilePayments } from '../src/features/dashboard/useBillsLoader';
import { buildShareMessage, reminderMessage } from '../src/features/dashboard/shareMessages';
import { formatCurrency } from '../src/utils';

beforeEach(() => {
  vi.clearAllMocks();
  getAllReceipts.mockResolvedValue([]);
});

describe('billsPageQuery (S6 paged-bill list URL builder)', () => {
  it('builds the full query with every filter, in a stable order', () => {
    const qs = billsPageQuery({ limit: 50, cursor: 'cur_1', q: 'ravi', status: 'overdue', from: '2025-04-01', to: '2026-03-31' });
    expect(qs).toBe('?limit=50&cursor=cur_1&q=ravi&status=overdue&from=2025-04-01&to=2026-03-31');
  });

  it('defaults to a first page of 50', () => {
    expect(billsPageQuery()).toBe('?limit=50');
    expect(billsPageQuery({})).toBe('?limit=50');
  });

  it('omits empty and absent filters so the URL stays as short as the request needs', () => {
    expect(billsPageQuery({ q: '', status: undefined, from: null, to: '', cursor: undefined })).toBe('?limit=50');
    expect(billsPageQuery({ limit: null })).toBe('');
  });

  it('passes a cursor through for "Load more"', () => {
    expect(billsPageQuery({ cursor: 'c2', status: 'paid' })).toBe('?limit=50&cursor=c2&status=paid');
  });

  it('is what listBillsPage appends to the bills endpoint', async () => {
    await listBillsPage({ limit: 50, cursor: 'c1', q: 'inv-9' });
    await listBillsPage({ q: 'x' });
    const { apiFetch } = await import('../src/lib/data/api');
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/v1/workspace/collections/bills?limit=50&cursor=c1&q=inv-9');
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/v1/workspace/collections/bills?limit=50&q=x');
  });
});

describe('markOverdue (extracted from Dashboard loadBills)', () => {
  const salesBill = (over) => ({
    id: 'b1', invoiceNumber: 'INV-1', invoiceType: 'tax-invoice', status: 'unpaid',
    totalAmount: 1000,
    data: { details: { dueDate: over ? '2026-01-01' : '2099-01-01' } },
  });
  const today = '2026-06-01';

  it('marks a sales invoice past its due date as overdue and saves it', async () => {
    const bill = salesBill(true);
    const dirty = await markOverdue([bill], today);
    expect(dirty).toHaveLength(1);
    expect(bill.status).toBe('overdue');
    expect(saveBill).toHaveBeenCalledTimes(1);
    expect(saveBill.mock.calls[0][1]).toEqual({ overwrite: true });
  });

  it('leaves paid, cancelled, already-overdue and future-due invoices alone', async () => {
    const paid = { ...salesBill(true), status: 'paid' };
    const cancelled = { ...salesBill(true), status: 'cancelled' };
    const already = { ...salesBill(true), status: 'overdue' };
    const future = salesBill(false);
    const noDue = { id: 'b2', invoiceType: 'tax-invoice', status: 'unpaid', data: {} };
    const dirty = await markOverdue([paid, cancelled, already, future, noDue], today);
    expect(dirty).toHaveLength(0);
    expect(saveBill).not.toHaveBeenCalled();
    expect(paid.status).toBe('paid');
    expect(future.status).toBe('unpaid');
  });

  it('never marks a quotation / challan / credit note (they are not money owed)', async () => {
    const quotation = { ...salesBill(true), invoiceType: 'quotation' };
    const challan = { ...salesBill(true), invoiceType: 'delivery-challan' };
    const credit = { ...salesBill(true), invoiceType: 'credit-note' };
    const dirty = await markOverdue([quotation, challan, credit], today);
    expect(dirty).toHaveLength(0);
    expect(quotation.status).toBe('unpaid');
  });
});

describe('reconcilePayments (orphaned-payment repair, extracted from loadBills)', () => {
  it('merges an orphaned receipt back into the bill and re-saves it', async () => {
    const bill = {
      id: 'b1', invoiceNumber: 'INV-1', invoiceType: 'tax-invoice', status: 'unpaid',
      totalAmount: 1000, paidAmount: 0, payments: [],
      data: { profile: { gstin: 'G1', businessName: 'Acme' } },
    };
    getAllReceipts.mockResolvedValue([{
      id: 'pay_abc', receiptNo: 'RCPT-ABC', amount: 1000, date: '2026-05-01',
      paymentMode: 'Cash', billId: 'b1', ownerGstin: 'G1', ownerName: 'Acme',
    }]);
    const reconciled = await reconcilePayments([bill]);
    expect(reconciled).toBe(1);
    expect(bill.payments).toHaveLength(1);
    expect(bill.payments[0].amount).toBe(1000);
    expect(bill.payments[0].mode).toBe('cash'); // "Cash" label normalised
    expect(bill.paidAmount).toBe(1000);
    expect(saveBill).toHaveBeenCalledTimes(1);
    expect(saveBill.mock.calls[0][0]).toBe(bill);
  });

  it('does not duplicate a payment the bill already has', async () => {
    const bill = {
      id: 'b1', invoiceNumber: 'INV-1', status: 'paid', totalAmount: 1000, paidAmount: 1000,
      payments: [{ id: 'pay_abc', amount: 1000, date: '2026-05-01', mode: 'cash' }],
      data: { profile: { gstin: 'G1' } },
    };
    getAllReceipts.mockResolvedValue([{
      id: 'pay_abc', amount: 1000, date: '2026-05-01', paymentMode: 'cash', billId: 'b1', ownerGstin: 'G1',
    }]);
    const reconciled = await reconcilePayments([bill]);
    expect(reconciled).toBe(0);
    expect(saveBill).not.toHaveBeenCalled();
  });

  it('ignores receipts from another business (v1.10.66 #64)', async () => {
    const bill = { id: 'b1', invoiceNumber: 'INV-1', totalAmount: 1000, payments: [], data: { profile: { gstin: 'G1' } } };
    getAllReceipts.mockResolvedValue([{ amount: 1000, date: '2026-05-01', paymentMode: 'cash', billId: 'b1', ownerGstin: 'OTHER' }]);
    expect(await reconcilePayments([bill])).toBe(0);
    expect(bill.payments).toHaveLength(0);
    expect(saveBill).not.toHaveBeenCalled();
  });
});

describe('buildShareMessage (WhatsApp / Email caption)', () => {
  const bill = {
    invoiceNumber: 'INV-9', clientName: 'Ravi', totalAmount: 1000, currency: 'INR',
    invoiceDate: '2026-04-05', status: 'unpaid', payments: [], paidAmount: 0,
    data: { invoiceOptions: { currency: 'INR' }, details: { dueDate: '2026-05-05' } },
  };

  it('shows the amount due for an unpaid invoice, with the business signature', () => {
    const msg = buildShareMessage(bill, { businessName: 'Acme' });
    expect(msg).toContain('*Invoice: INV-9*');
    expect(msg).toContain('*Amount Due: ' + formatCurrency(1000, 'INR') + '*');
    expect(msg).toContain('Status: UNPAID');
    expect(msg).toContain('Due: ' + new Date('2026-05-05').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
    expect(msg).toContain('— Acme');
  });

  it('announces FULLY PAID when the payments cover the invoice', () => {
    const paid = { ...bill, status: 'paid', payments: [{ amount: 1000 }], paidAmount: 1000 };
    expect(buildShareMessage(paid, null)).toContain('FULLY PAID');
  });

  it('surfaces an overpayment instead of clamping it away (v1.10.22)', () => {
    const over = { ...bill, payments: [{ amount: 1200 }], paidAmount: 1200 };
    expect(buildShareMessage(over, null)).toContain('(Overpaid by ' + formatCurrency(200, 'INR') + ')');
  });

  it('shows the outstanding balance for a partial payment', () => {
    const partial = { ...bill, payments: [{ amount: 400 }], paidAmount: 400 };
    expect(buildShareMessage(partial, null)).toContain('*Outstanding: ' + formatCurrency(600, 'INR') + '*');
  });
});

describe('reminderMessage (payment reminder text, v1.10.12)', () => {
  const bill = {
    invoiceNumber: 'INV-9', clientName: 'Ravi', totalAmount: 1000, currency: 'INR',
    paidAmount: 0, data: { details: { dueDate: '2099-01-01' } },
  };

  it('words an overdue invoice around the due date', () => {
    const overdue = { ...bill, data: { details: { dueDate: '2026-01-01' } } };
    const msg = reminderMessage(overdue, 'Acme');
    expect(msg).toContain('was due on ' + new Date('2026-01-01').toLocaleDateString('en-IN'));
    expect(msg).toContain('- Acme');
  });

  it('words a partially paid invoice around the balance, not the due date', () => {
    const partial = { ...bill, paidAmount: 400 };
    const msg = reminderMessage(partial, 'Acme');
    expect(msg).toContain('a balance of ' + formatCurrency(600, 'INR') + ' is pending on Invoice INV-9');
    expect(msg).not.toContain('was due on');
  });
});
