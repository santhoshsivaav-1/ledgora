// Vyapar parity P4-S5: each Verify My Data check with a failing and a passing fixture.
import { describe, it, expect } from 'vitest';
import { numberParts, runVerify, verifySummary } from '../src/index.ts';

const base = { today: '2026-11-10', ledgerOn: true };
const one = (id, data) => runVerify({ ...base, ...data }).find((c) => c.id === id);
const inv = (o = {}) => ({
  id: 'i1',
  number: 'INV/2026-27/0001',
  invoiceType: 'tax-invoice',
  invoiceDate: '2026-11-01',
  total: 1180,
  status: 'unpaid',
  lineTotal: 1180,
  extras: 0,
  invoiceDiscount: 0,
  ...o,
});

describe('Verify My Data', () => {
  it('negative_stock', () => {
    expect(
      one('negative_stock', {
        items: [
          { id: 'a', name: 'Pen', stock: -2, trackStock: true },
          { id: 'b', name: 'Svc', stock: -5, trackStock: false },
        ],
      }).rows,
    ).toEqual([{ id: 'a', name: 'Pen', stock: -2 }]);
    expect(
      one('negative_stock', { items: [{ id: 'a', name: 'Pen', stock: 0, trackStock: true }] })
        .count,
    ).toBe(0);
  });
  it('invoice_total_mismatch: charges, TCS, round-off and bill discount are part of the expected total', () => {
    expect(one('invoice_total_mismatch', { invoices: [inv({ total: 1500 })] })).toMatchObject({
      count: 1,
      severity: 'error',
      rows: [{ stored: 1500, expected: 1180 }],
    });
    expect(
      one('invoice_total_mismatch', {
        invoices: [
          inv({ total: 1180.4, extras: 6.4, invoiceDiscount: 6 }),
          inv({ id: 'i2', total: 99, status: 'cancelled' }),
          inv({ id: 'i3', invoiceType: 'quotation', total: 7 }),
        ],
      }).count,
    ).toBe(0);
  });
  it('payment_over_allocated: more than the payment, or more than is due on an invoice; fixable by trimming', () => {
    const c = one('payment_over_allocated', {
      payments: [
        { id: 'p', number: 'R-1', settled: 100, allocated: 120 },
        { id: 'q', number: 'R-2', settled: 100, allocated: 100 },
      ],
      invoiceDue: [{ id: 'i', number: 'I-1', due: 50, allocated: 60 }],
    });
    expect(c.count).toBe(2);
    expect(c.fix).toBe('trim_allocations');
    expect(
      one('payment_over_allocated', {
        payments: [{ id: 'q', number: 'R', settled: 100, allocated: 100 }],
        invoiceDue: [{ id: 'i', number: 'I', due: 50, allocated: 50 }],
      }).count,
    ).toBe(0);
  });
  it('invoice_number_gap: inside a series and financial year only', () => {
    const c = one('invoice_number_gap', {
      invoices: [
        inv({ number: 'INV/2026-27/0001' }),
        inv({ id: 'b', number: 'INV/2026-27/0004' }),
        inv({ id: 'c', number: 'INV/2025-26/0009', invoiceDate: '2026-03-01' }),
      ],
    });
    expect(c.rows).toEqual([
      { series: 'tax-invoice INV/2026-27/', fy: '2026-27', missing: [2, 3], count: 2 },
    ]);
    expect(c.severity).toBe('info');
    expect(
      one('invoice_number_gap', { invoices: [inv(), inv({ id: 'b', number: 'INV/2026-27/0002' })] })
        .count,
    ).toBe(0);
  });
  it('invoice_number_duplicate', () => {
    expect(one('invoice_number_duplicate', { invoices: [inv(), inv({ id: 'b' })] }).rows).toEqual([
      { number: 'INV/2026-27/0001', ids: ['i1', 'b'] },
    ]);
    expect(
      one('invoice_number_duplicate', {
        invoices: [
          inv(),
          inv({ id: 'b', number: 'INV/2026-27/0002' }),
          inv({ id: 'c', invoiceType: 'credit-note' }),
        ],
      }).count,
    ).toBe(0);
  });
  it('gstin_invalid and duplicate_party', () => {
    const good = '29ABCDE1234F1Z5';
    expect(
      one('gstin_invalid', {
        parties: [
          { id: '1', name: 'Bad', gstin: '29ABCDE1234F1Z0' },
          { id: '2', name: 'None', gstin: '' },
        ],
      }).count,
    ).toBe(1);
    expect(
      one('duplicate_party', {
        parties: [
          { id: '1', name: 'A', gstin: good },
          { id: '2', name: 'B', gstin: good.toLowerCase() },
        ],
      }).rows[0].parties,
    ).toHaveLength(2);
    expect(
      one('duplicate_party', {
        parties: [
          { id: '1', name: 'A', gstin: good },
          { id: '2', name: 'B', gstin: '' },
          { id: '3', name: 'C', gstin: '' },
        ],
      }).count,
    ).toBe(0);
  });
  it('hsn_missing: only lines that carry tax', () => {
    expect(
      one('hsn_missing', {
        hsnLines: [
          { invoiceId: 'i', invoiceNumber: 'I-1', name: 'Pen', taxPercent: 18, hsn: ' ' },
          { invoiceId: 'i', invoiceNumber: 'I-1', name: 'Nil', taxPercent: 0, hsn: '' },
          { invoiceId: 'i', invoiceNumber: 'I-1', name: 'OK', taxPercent: 18, hsn: '4820' },
        ],
      }).rows,
    ).toEqual([{ invoiceId: 'i', invoice: 'I-1', item: 'Pen' }]);
  });
  it('ledger_unbalanced / ledger_missing / party_balance_mismatch: fixable by repost; silent while the ledger is off', () => {
    expect(
      one('ledger_unbalanced', {
        vouchers: [
          { voucherId: 'v', debit: 10, credit: 9 },
          { voucherId: 'w', debit: 5, credit: 5 },
        ],
      }),
    ).toMatchObject({ count: 1, fix: 'repost' });
    expect(
      one('ledger_missing', {
        documentsWithoutLedger: [{ kind: 'invoice', id: 'i', label: 'INV-1' }],
      }),
    ).toMatchObject({ count: 1, fix: 'repost' });
    expect(
      one('ledger_missing', {
        ledgerOn: false,
        documentsWithoutLedger: [{ kind: 'invoice', id: 'i', label: 'INV-1' }],
      }).count,
    ).toBe(0);
    expect(
      one('party_balance_mismatch', {
        partyMismatches: [
          { partyId: 'p', name: 'A', ledger: 100, documents: 120 },
          { partyId: 'q', name: 'B', ledger: 5, documents: 5 },
        ],
      }).count,
    ).toBe(1);
    expect(
      one('party_balance_mismatch', {
        ledgerOn: false,
        partyMismatches: [{ partyId: 'p', name: 'A', ledger: 1, documents: 2 }],
      }).count,
    ).toBe(0);
  });
  it('orphan_stock_movement and future_dated (30 days of grace)', () => {
    expect(
      one('orphan_stock_movement', {
        orphanMovements: [{ id: 'm', refType: 'invoice', refId: 'gone' }],
      }).count,
    ).toBe(1);
    expect(
      one('future_dated', {
        documentDates: [
          { kind: 'invoice', id: 'a', label: 'I-1', date: '2026-12-10' },
          { kind: 'invoice', id: 'b', label: 'I-2', date: '2026-12-11' },
        ],
      }).rows.map((r) => r.id),
    ).toEqual(['b']);
  });
  it('summarises a run, and a clean run passes everything', () => {
    const clean = runVerify(base);
    expect(clean).toHaveLength(13);
    expect(verifySummary(clean)).toEqual({ passed: 13, warnings: 0, errors: 0 });
    expect(
      verifySummary(
        runVerify({
          ...base,
          items: [{ id: 'a', name: 'P', stock: -1, trackStock: true }],
          vouchers: [{ voucherId: 'v', debit: 2, credit: 1 }],
        }),
      ),
    ).toEqual({ passed: 11, warnings: 1, errors: 1 });
    expect(numberParts('INV-12')).toEqual(['INV-', 12]);
    expect(numberParts('NOPE')).toBeNull();
  });
});
