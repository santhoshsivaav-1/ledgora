import { describe, expect, it } from 'vitest';
import { offerFor } from '../src/features/invoices/editor/offers';

describe('offer codes', () => {
  const coupons = [
    { code: 'DIWALI10', percent: 10, amount: 0, minBill: 500, from: '2026-10-20', to: '2026-11-15' },
    { code: 'flat50', percent: 0, amount: 50, minBill: 0, from: '', to: '' },
    { code: 'EMPTY', percent: 0, amount: 0, minBill: 0, from: '', to: '' },
  ];
  it('percent within dates and over the minimum', () => {
    expect(offerFor('diwali10', coupons, { date: '2026-11-01', total: 1000 })).toEqual({ ok: true, code: 'DIWALI10', type: 'percent', value: 10 });
  });
  it('refuses outside the dates, under the minimum, unknown, blank, or empty', () => {
    expect(offerFor('DIWALI10', coupons, { date: '2026-10-01', total: 1000 }).message).toMatch(/starts on/);
    expect(offerFor('DIWALI10', coupons, { date: '2026-12-01', total: 1000 }).message).toMatch(/ended on/);
    expect(offerFor('DIWALI10', coupons, { date: '2026-11-01', total: 100 }).message).toMatch(/at least/);
    expect(offerFor('NOPE', coupons, { date: '2026-11-01', total: 100 }).ok).toBe(false);
    expect(offerFor(' ', coupons, { date: '2026-11-01', total: 100 }).ok).toBe(false);
    expect(offerFor('EMPTY', coupons, { date: '2026-11-01', total: 100 }).ok).toBe(false);
  });
  it('a rupee offer is never more than the bill', () => {
    expect(offerFor('FLAT50', coupons, { date: '2026-11-01', total: 30 })).toMatchObject({ type: 'fixed', value: 30 });
  });
});
