// Vyapar parity Phase 4 on the web: the helpers behind the Accounting screens (lib/data/accounting.js).
import { describe, expect, it } from 'vitest';
import { balanceText, drCrText, fyRange, journalState, refLink } from '../src/lib/data/accounting';
import { itcAtRisk, itc180ForPeriod } from '../src/features/purchases/purchaseExtras';

const fmt = (n) => `₹${n.toFixed(2)}`;

describe('reading balances the way the books write them', () => {
  it('Dr/Cr text from a Dr-positive figure', () => {
    expect(drCrText(236, fmt)).toBe('₹236.00 Dr');
    expect(drCrText(-42, fmt)).toBe('₹42.00 Cr');
    expect(drCrText(0, fmt)).toBe('₹0.00');
    expect(drCrText(0.004, fmt)).toBe('₹0.00');
  });
  it('an account balance is in its natural direction; the other side is flagged', () => {
    expect(balanceText({ kind: 'asset', balance: 200 }, fmt)).toBe('₹200.00 Dr');
    expect(balanceText({ kind: 'asset', balance: -50 }, fmt)).toBe('₹50.00 Cr'); // an overdrawn asset
    expect(balanceText({ kind: 'income', balance: 200 }, fmt)).toBe('₹200.00 Cr');
    expect(balanceText({ kind: 'liability', balance: -10 }, fmt)).toBe('₹10.00 Dr');
    expect(balanceText({ kind: 'expense', balance: 0 }, fmt)).toBe('₹0.00');
  });
  it('a ledger row links to the screen of its document; journals and openings have none', () => {
    expect(refLink('invoice')).toBe('/invoices');
    expect(refLink('payment')).toBe('/receipts');
    expect(refLink('journal')).toBeNull();
    expect(refLink('opening')).toBeNull();
  });
  it('financial years', () => {
    expect(fyRange('2026-27')).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });
});

describe('the journal form (P4-S7): Save only when the sides are equal', () => {
  const row = (accountId, debit = '', credit = '') => ({ accountId, debit, credit });
  it('balanced with two rows is ok', () => {
    expect(journalState([row('a', 2000), row('b', '', 2000)])).toMatchObject({
      ok: true,
      balanced: true,
      debit: 2000,
      credit: 2000,
      diff: 0,
    });
  });
  it('unequal shows the difference and is not ok', () => {
    expect(journalState([row('a', 2000), row('b', '', 1999)])).toMatchObject({
      ok: false,
      balanced: false,
      diff: 1,
    });
  });
  it('a row with both sides, or no account, or only one real row is not ok', () => {
    expect(journalState([row('a', 5, 5), row('b', '', 5)]).ok).toBe(false);
    expect(journalState([row('', 5), row('b', '', 5)])).toMatchObject({
      ok: false,
      rows: [{ accountId: 'b' }],
    });
    expect(journalState([row('a', 5)]).ok).toBe(false);
    expect(journalState([row('a'), row('b')])).toMatchObject({ ok: false, debit: 0 });
  });
  it('adds paise without float noise', () => {
    expect(journalState([row('a', 0.1), row('b', 0.2), row('c', '', 0.3)])).toMatchObject({
      ok: true,
      debit: 0.3,
      credit: 0.3,
    });
  });
});

describe('ITC at risk on the web (P10-S4), the same rule as the API', () => {
  const bill = (extra = {}) => ({
    id: 'b',
    docType: 'bill',
    supplierName: 'Om',
    invoiceNumber: 'P-9',
    date: '2026-01-01',
    totalAmount: 11800,
    tdsAmount: 0,
    items: [{ name: 'Pen', quantity: 100, rate: 100, taxPercent: 18 }],
    payments: [],
    ...extra,
  });
  it('days left from day 150; reversed past 180; partly paid reverses in proportion', () => {
    expect(itcAtRisk([bill()], '2026-05-20')).toEqual({ atRisk: [], dueForReversal: [] });
    expect(itcAtRisk([bill()], '2026-06-20').atRisk[0]).toMatchObject({
      daysLeft: 10,
      unpaid: 11800,
      itcAtRisk: 1800,
    });
    expect(itcAtRisk([bill()], '2026-07-01').dueForReversal[0]).toMatchObject({
      daysLate: 1,
      itcToReverse: 1800,
    });
    const half = bill({ payments: [{ amount: 5900, date: '2026-03-01' }] });
    expect(itcAtRisk([half], '2026-07-01').dueForReversal[0]).toMatchObject({
      unpaid: 5900,
      itcToReverse: 900,
    });
  });
  it('payable is the total less §194Q TDS, and purchase orders and debit notes are never bills', () => {
    expect(itcAtRisk([bill({ tdsAmount: 118 })], '2026-06-20').atRisk[0].unpaid).toBe(11682);
    expect(
      itcAtRisk(
        [bill({ docType: 'order' }), bill({ id: 'd', docType: 'debit-note' })],
        '2026-06-20',
      ),
    ).toEqual({ atRisk: [], dueForReversal: [] });
  });
  it('the return of a period gets the reversal in its month and the re-claim in the month of payment', () => {
    const b = bill({ payments: [{ amount: 11800, date: '2026-08-10' }] });
    const july = itc180ForPeriod([b], (d) => String(d).startsWith('2026-07'));
    expect(july.reversal).toEqual({ igst: 0, cgst: 900, sgst: 900, cess: 0 });
    expect(july.reclaim).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
    const aug = itc180ForPeriod([b], (d) => String(d).startsWith('2026-08'));
    expect(aug.reclaim).toEqual({ igst: 0, cgst: 900, sgst: 900, cess: 0 });
    expect(aug.reversals).toEqual([]);
  });
});
