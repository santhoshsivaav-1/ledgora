// R4.1: the asset register's arithmetic. Expected figures are worked out by hand from s.32 and Appendix I, not from the code.
import { describe, expect, it } from 'vitest';
import { bookDepreciation, computeBlockYear, computeBlocks, daysUsedInYear } from '../src/depreciation.ts';

const asset = (over) => ({ id: 'a', name: 'x', block: 'PM15', cost: 100000, putToUse: '2025-05-01', ...over });

describe('180-day count', () => {
  it('counts both ends: 2 Oct to 31 Mar is 181 days, 3 Oct is 180, 4 Oct is 179', () => {
    expect(daysUsedInYear('2025-10-02', '2025-26')).toBe(181);
    expect(daysUsedInYear('2025-10-03', '2025-26')).toBe(180);
    expect(daysUsedInYear('2025-10-04', '2025-26')).toBe(179);
  });
});

describe('tax depreciation by block', () => {
  it('full rate on opening WDV plus additions of 180+ days; half rate on the rest', () => {
    // Opening 1,00,000; machine of 40,000 used from 1 May (full); machine of 20,000 used from 1 Jan (half). Rate 15%.
    const r = computeBlockYear('PM15', '2025-26', 100000, [
      asset({ id: 'm1', cost: 40000, putToUse: '2025-05-01' }),
      asset({ id: 'm2', cost: 20000, putToUse: '2026-01-01' }),
    ]);
    expect(r.FullRateDeprAmt).toBe(140000);
    expect(r.HalfRateDeprAmt).toBe(20000);
    expect(r.DepreciationAtFullRate).toBe(21000); // 15% of 1,40,000
    expect(r.DepreciationAtHalfRate).toBe(1500); // 7.5% of 20,000
    expect(r.TotalDepreciation).toBe(22500);
    expect(r.WDVLastDay).toBe(137500); // 1,60,000 - 22,500
  });

  it('computers at 40%: a laptop put to use on 3 Oct (180 days) takes the full rate, on 4 Oct half', () => {
    const full = computeBlockYear('PM40', '2025-26', 0, [asset({ block: 'PM40', cost: 50000, putToUse: '2025-10-03' })]);
    expect(full.TotalDepreciation).toBe(20000);
    const half = computeBlockYear('PM40', '2025-26', 0, [asset({ block: 'PM40', cost: 50000, putToUse: '2025-10-04' })]);
    expect(half.TotalDepreciation).toBe(10000);
    expect(half.WDVLastDay).toBe(40000);
  });

  it('a sale reduces the full-rate pool first; the block carries on while an asset is left', () => {
    // Opening 3,00,000 (an old machine, not listed), plus a 1,00,000 machine in July; a 60,000 machine sold in Dec.
    const r = computeBlockYear(
      'PM15',
      '2025-26',
      300000,
      [
        asset({ id: 'new', cost: 100000, putToUse: '2025-07-01' }),
        asset({ id: 'old', cost: 90000, putToUse: '2020-01-01', disposal: { date: '2025-12-15', proceeds: 60000 } }),
      ],
    );
    expect(r.RealizationTotalPeriod).toBe(60000);
    expect(r.FullRateDeprAmt).toBe(340000); // 3,00,000 + 1,00,000 - 60,000
    expect(r.TotalDepreciation).toBe(51000);
    expect(r.WDVLastDay).toBe(289000);
    expect(r.CapGainUs50).toBe(0);
  });

  it('sale proceeds above the whole block are a short-term capital gain and the block is nil', () => {
    const r = computeBlockYear('PM15', '2025-26', 50000, [
      asset({ id: 'o', cost: 80000, putToUse: '2019-04-01', disposal: { date: '2025-09-01', proceeds: 70000, expenses: 2000 } }),
    ]);
    expect(r.CapGainUs50).toBe(18000); // (70,000 - 50,000) - 2,000
    expect(r.TotalDepreciation).toBe(0);
    expect(r.WDVLastDay).toBe(0);
  });

  it('a block with every asset sold and a balance left is a short-term capital loss', () => {
    const r = computeBlockYear(
      'PM15',
      '2025-26',
      80000,
      [asset({ id: 'o', cost: 200000, putToUse: '2019-04-01', disposal: { date: '2025-09-01', proceeds: 30000 } })],
      { trackedAll: true },
    );
    expect(r.CapGainUs50).toBe(-50000);
    expect(r.TotalDepreciation).toBe(0);
    expect(r.WDVLastDay).toBe(0);
  });

  it('the same sale is not "the block ended" when part of the opening balance is unlisted', () => {
    const r = computeBlockYear('PM15', '2025-26', 80000, [
      asset({ id: 'o', cost: 200000, putToUse: '2019-04-01', disposal: { date: '2025-09-01', proceeds: 30000 } }),
    ]);
    expect(r.CapGainUs50).toBe(0);
    expect(r.TotalDepreciation).toBe(7500); // 15% of 50,000
  });

  it('land is never depreciated', () => {
    const r = computeBlockYear('LAND', '2025-26', 500000, [asset({ id: 'l', block: 'LAND', cost: 100000, putToUse: '2025-06-01' })]);
    expect(r.TotalDepreciation).toBe(0);
    expect(r.WDVLastDay).toBe(600000);
  });

  it('rolls the written-down value forward year by year (deemed allowed whether claimed or not)', () => {
    const assets = [asset({ id: 'p', block: 'FF10', cost: 100000, putToUse: '2024-06-01' })];
    // 2024-25: 10% of 1,00,000 = 10,000 -> 90,000; 2025-26: 10% of 90,000 = 9,000 -> 81,000.
    const [y1] = computeBlocks('2024-25', assets);
    expect(y1.WDVLastDay).toBe(90000);
    const [y2] = computeBlocks('2025-26', assets);
    expect(y2.WDVFirstDay).toBe(90000);
    expect(y2.TotalDepreciation).toBe(9000);
    expect(y2.WDVLastDay).toBe(81000);
  });

  it('starts from the person\'s own opening balance for a block brought forward', () => {
    const [r] = computeBlocks('2025-26', [], [{ block: 'BLD10', fy: '2025-26', wdv: 2000000 }]);
    expect(r.TotalDepreciation).toBe(200000);
    expect(r.WDVLastDay).toBe(1800000);
  });

  it('refuses an unknown block', () => {
    expect(() => computeBlockYear('XX', '2025-26', 0, [])).toThrow(/Unknown asset block/);
  });
});

describe('books depreciation (Schedule II, straight line, 5% residual)', () => {
  it('charges from the day put to use, daily', () => {
    // Laptop 60,000, 3 years, put to use 1 Oct 2025: (60,000 x 95%) / (3 x 365) x 182 days (1 Oct to 31 Mar).
    const b = bookDepreciation(asset({ block: 'PM40', cost: 60000, putToUse: '2025-10-01' }), '2025-26');
    expect(b.depreciation).toBeCloseTo((57000 / 1095) * 182, 1);
    expect(b.netBlock).toBeCloseTo(60000 - b.depreciation, 2);
  });
  it('stops at the residual value', () => {
    const b = bookDepreciation(asset({ block: 'PM40', cost: 60000, putToUse: '2020-04-01' }), '2025-26');
    expect(b.accumulated).toBeCloseTo(57000, 2);
    expect(b.depreciation).toBe(0);
  });
  it('shows profit or loss on a sale against the book value', () => {
    const b = bookDepreciation(
      asset({ block: 'PM15', cost: 150000, putToUse: '2024-04-01', disposal: { date: '2025-03-31', proceeds: 140000 } }),
      '2024-25',
    );
    const dep = (150000 * 0.95 / (15 * 365)) * 365;
    expect(b.accumulated).toBeCloseTo(dep, 1);
    expect(b.saleProfit).toBeCloseTo(140000 - (150000 - dep), 1);
    expect(b.netBlock).toBe(0);
  });
  it('does not depreciate land', () => {
    expect(bookDepreciation(asset({ block: 'LAND', cost: 900000, putToUse: '2020-04-01' }), '2025-26').depreciation).toBe(0);
  });
});
