// Vyapar parity P10-S2: reverse charge end to end. D-13: the supplier is owed the bill without the RCM tax; the tax goes
// to the government (3B 3.1(d), paid in cash) and becomes credit (4(A)(3)) in the month it is paid.
import { describe, expect, it } from 'vitest';
import { rcmItcForPeriod, rcmSupplierDue } from '../src/index.ts';

describe('rcmSupplierDue (D-13)', () => {
  it('a reverse-charge bill owes the supplier the total less the RCM tax', () => {
    expect(rcmSupplierDue({ total: 10500, reverseCharge: true, tax: 500, cess: 0 })).toBe(10000);
  });
  it('an ordinary bill owes the total', () => {
    expect(rcmSupplierDue({ total: 11800, reverseCharge: false, tax: 1800, cess: 0 })).toBe(11800);
  });
  it('takes cess off too, and §194Q TDS and adjusted debit notes as before', () => {
    expect(rcmSupplierDue({ total: 11000, reverseCharge: true, tax: 800, cess: 200, tds: 10, adjusted: 90 })).toBe(9900);
  });
  it('never goes below zero', () => {
    expect(rcmSupplierDue({ total: 100, reverseCharge: true, tax: 500, cess: 0 })).toBe(0);
  });
});

describe('rcmItcForPeriod (4(A)(3) in the month the RCM tax is paid)', () => {
  const NOV = { from: '2026-11-01', to: '2026-11-30' };
  const DEC = { from: '2026-12-01', to: '2026-12-31' };
  const heads = { igst: 0, cgst: 250, sgst: 250, cess: 0 };
  const bill = (o) => ({ id: 'P17', date: '2026-11-08', reverseCharge: true, heads, rcmPayment: null, ...o });

  it('unpaid: liable in 3.1(d) for the bill month, no credit, listed as unpaid', () => {
    const r = rcmItcForPeriod([bill()], NOV);
    expect(r.liability).toEqual(heads);
    expect(r.claim).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(r.unpaid.map((b) => b.id)).toEqual(['P17']);
  });
  it('paid in the same month: liability and credit in the same return', () => {
    const r = rcmItcForPeriod([bill({ rcmPayment: { date: '2026-11-20', amount: 500 } })], NOV);
    expect(r.liability).toEqual(heads);
    expect(r.claim).toEqual(heads);
    expect(r.unpaid).toEqual([]);
  });
  it('paid next month: liability in November, credit in December only', () => {
    const b = bill({ rcmPayment: { date: '2026-12-03', amount: 500 } });
    expect(rcmItcForPeriod([b], NOV)).toMatchObject({ liability: heads, claim: { cgst: 0, sgst: 0 } });
    expect(rcmItcForPeriod([b], DEC)).toMatchObject({ liability: { cgst: 0, sgst: 0 }, claim: heads });
  });
  it('ignores ordinary bills, so there is no double count with normal credit', () => {
    const r = rcmItcForPeriod([bill({ reverseCharge: false, rcmPayment: { date: '2026-11-20' } })], NOV);
    expect(r.liability).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(r.claim).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });
});
