// Vyapar parity P10-S1: GST on advances received for services (D-14) and GSTR-1 Table 11.
// Fixtures first: each test states the table values a return of that period must show.
import { describe, expect, it } from 'vitest';
import { advanceBalance, advanceTax, table11, table11Json } from '../src/index.ts';

const TN = '33';
const KA = '29';
const NOV = { from: '2026-11-01', to: '2026-11-30' };
const DEC = { from: '2026-12-01', to: '2026-12-31' };
const adv = (o) => ({ id: 'r1', date: '2026-11-10', amount: 11800, rate: 18, pos: TN, adjustments: [], ...o });

describe('advanceTax (receipt amount includes GST)', () => {
  it('splits an intra-state advance into CGST and SGST', () => {
    expect(advanceTax({ amount: 11800, rate: 18, pos: TN, bizState: TN })).toEqual({
      inter: false, taxable: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0,
    });
  });
  it('charges IGST when the place of supply is another state', () => {
    expect(advanceTax({ amount: 11800, rate: 18, pos: KA, bizState: TN })).toEqual({
      inter: true, taxable: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0,
    });
  });
  it('never loses a paisa: taxable + tax = amount', () => {
    for (const amount of [1, 99.99, 1000, 12345.67]) {
      for (const rate of [5, 12, 18, 28]) {
        const t = advanceTax({ amount, rate, pos: TN, bizState: TN });
        expect(Math.round((t.taxable + t.cgst + t.sgst) * 100) / 100).toBe(amount);
      }
    }
  });
  it('is all taxable at 0%', () => {
    expect(advanceTax({ amount: 500, rate: 0, pos: TN, bizState: TN })).toMatchObject({ taxable: 500, cgst: 0, sgst: 0 });
  });
});

describe('advanceBalance', () => {
  it('is the amount less every adjustment and refund, never below zero', () => {
    expect(advanceBalance(adv({ adjustments: [{ date: '2026-11-20', amount: 5900 }] }))).toBe(5900);
    expect(advanceBalance(adv({ adjustments: [{ date: '2026-11-20', amount: 20000 }] }))).toBe(0);
  });
});

describe('GSTR-1 Table 11 fixtures', () => {
  it('advance received this month, nothing adjusted: 11A only', () => {
    const t = table11({ receipts: [adv()], ...NOV, bizState: TN });
    expect(t.at).toEqual([{ pos: TN, rate: 18, inter: false, gross: 11800, taxable: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 }]);
    expect(t.txpd).toEqual([]);
    expect(t.net).toEqual({ taxable: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 });
  });

  it('advance and invoice in the same month: nothing is reported (net zero)', () => {
    const t = table11({ receipts: [adv({ adjustments: [{ date: '2026-11-25', amount: 11800, kind: 'invoice' }] })], ...NOV, bizState: TN });
    expect(t.at).toEqual([]);
    expect(t.txpd).toEqual([]);
    expect(t.net).toEqual({ taxable: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
  });

  it('advance this month, invoice next month: 11A in November, 11B in December', () => {
    const r = adv({ adjustments: [{ date: '2026-12-05', amount: 11800, kind: 'invoice' }] });
    expect(table11({ receipts: [r], ...NOV, bizState: TN }).at[0]).toMatchObject({ gross: 11800, taxable: 10000, camt: 900 });
    const dec = table11({ receipts: [r], ...DEC, bizState: TN });
    expect(dec.at).toEqual([]);
    expect(dec.txpd).toEqual([{ pos: TN, rate: 18, inter: false, gross: 11800, taxable: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 }]);
    expect(dec.net).toEqual({ taxable: -10000, iamt: 0, camt: -900, samt: -900, csamt: 0 });
  });

  it('partial adjustment: half adjusted in the same month leaves half in 11A; the rest adjusted later goes to 11B', () => {
    const r = adv({ adjustments: [{ date: '2026-11-20', amount: 5900, kind: 'invoice' }, { date: '2026-12-02', amount: 5900, kind: 'invoice' }] });
    expect(table11({ receipts: [r], ...NOV, bizState: TN }).at[0]).toMatchObject({ gross: 5900, taxable: 5000, camt: 450, samt: 450 });
    expect(table11({ receipts: [r], ...DEC, bizState: TN }).txpd[0]).toMatchObject({ gross: 5900, taxable: 5000, camt: 450, samt: 450 });
  });

  it('refund of an earlier advance reduces the liability in 11B (negative in the net)', () => {
    const r = adv({ adjustments: [{ date: '2026-12-10', amount: 2360, kind: 'refund' }] });
    const dec = table11({ receipts: [r], ...DEC, bizState: TN });
    expect(dec.txpd[0]).toMatchObject({ gross: 2360, taxable: 2000, camt: 180, samt: 180 });
    expect(dec.net.camt).toBe(-180);
  });

  it('groups by place of supply and rate, inter-state as IGST', () => {
    const t = table11({
      receipts: [adv({ id: 'a' }), adv({ id: 'b', amount: 5900 }), adv({ id: 'c', pos: KA, amount: 1120, rate: 12 })],
      ...NOV, bizState: TN,
    });
    expect(t.at).toEqual([
      { pos: KA, rate: 12, inter: true, gross: 1120, taxable: 1000, iamt: 120, camt: 0, samt: 0, csamt: 0 },
      { pos: TN, rate: 18, inter: false, gross: 17700, taxable: 15000, iamt: 0, camt: 1350, samt: 1350, csamt: 0 },
    ]);
  });

  it('ignores receipts outside the period and adjustments of a later period', () => {
    const t = table11({ receipts: [adv({ date: '2026-10-31' }), adv({ date: '2026-12-01' })], ...NOV, bizState: TN });
    expect(t).toMatchObject({ at: [], txpd: [] });
  });
});

describe('GSTR-1 JSON for Table 11', () => {
  it('writes at and txpd in the portal shape, ad_amt excluding tax', () => {
    const t = table11({ receipts: [adv()], ...NOV, bizState: TN });
    expect(table11Json(t)).toEqual({
      at: [{ pos: TN, sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 }] }],
    });
  });
  it('adds nothing at all when there are no advances, so the JSON stays as before', () => {
    expect(table11Json(table11({ receipts: [], ...NOV, bizState: TN }))).toEqual({});
  });
});
