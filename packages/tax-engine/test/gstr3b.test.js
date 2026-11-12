// Vyapar parity P10-S3: GSTR-3B cells that were missing or misplaced. Fixtures state each cell's expected value.
import { describe, expect, it } from 'vitest';
import { exemptInward, interStateUnregistered, moveSezToZeroRated } from '../src/index.ts';

describe('3.1(a) / 3.1(b): supplies to an SEZ are zero-rated', () => {
  const a = { taxable: 150000, igst: 9000, cgst: 4500, sgst: 4500, cess: 0, total: 177000 };
  const exp = { taxable: 20000, igst: 0, cess: 0 };
  it('moves SEZ taxable value and IGST out of 3.1(a) into 3.1(b)', () => {
    const r = moveSezToZeroRated(a, exp, { taxable: 50000, igst: 9000, cess: 0 });
    expect(r.a).toEqual({ taxable: 100000, igst: 0, cgst: 4500, sgst: 4500, cess: 0, total: 177000 });
    expect(r.b).toEqual({ taxable: 70000, igst: 9000, cess: 0 });
  });
  it('changes nothing without SEZ supplies (same objects back)', () => {
    const r = moveSezToZeroRated(a, exp, { taxable: 0, igst: 0, cess: 0 });
    expect(r.a).toBe(a);
    expect(r.b).toBe(exp);
  });
  it('never takes 3.1(a) below zero', () => {
    expect(moveSezToZeroRated({ ...a, taxable: 100, igst: 10 }, exp, { taxable: 500, igst: 90, cess: 0 }).a).toMatchObject({ taxable: 0, igst: 0 });
  });
});

describe('3.2: inter-state supplies to unregistered persons, by place of supply', () => {
  it('adds invoices per state and nets credit notes', () => {
    const rows = [
      { pos: '29', txval: 10000, iamt: 1800 },
      { pos: '29', txval: 5000, iamt: 900 },
      { pos: '27', txval: 2000, iamt: 240 },
      { pos: '29', txval: -1000, iamt: -180 },
    ];
    expect(interStateUnregistered(rows)).toEqual([
      { pos: '27', txval: 2000, iamt: 240 },
      { pos: '29', txval: 14000, iamt: 2520 },
    ]);
  });
  it('drops a state that nets to nothing, and is empty without such sales', () => {
    expect(interStateUnregistered([{ pos: '29', txval: 100, iamt: 18 }, { pos: '29', txval: -100, iamt: -18 }])).toEqual([]);
    expect(interStateUnregistered([])).toEqual([]);
  });
});

describe('5: exempt, nil-rated and non-GST inward supplies', () => {
  it('adds 0% purchase lines by inter / intra; taxed lines and RCM bills are not exempt', () => {
    const r = exemptInward([
      { interstate: false, items: [{ quantity: 2, rate: 500, taxPercent: 0 }, { quantity: 1, rate: 1000, taxPercent: 18 }] },
      { interstate: true, items: [{ quantity: 1, rate: 3000, taxPercent: 0 }] },
      { interstate: false, items: [{ quantity: 1, rate: 700, taxPercent: 0, nonGst: true }] },
    ]);
    expect(r).toEqual({ gst: { inter: 3000, intra: 1000 }, nongst: { inter: 0, intra: 700 } });
  });
  it('is all zero without such purchases', () => {
    expect(exemptInward([])).toEqual({ gst: { inter: 0, intra: 0 }, nongst: { inter: 0, intra: 0 } });
  });
});
