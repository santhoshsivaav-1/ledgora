import { describe, expect, it } from 'vitest';
import { buildAnalytics, currenciesIn, deltaPct } from '../src/features/dashboard/analytics.js';

const inv = (over) => ({ id: over.invoiceNumber, invoiceType: 'tax-invoice', status: 'unpaid', totalAmount: 1000, totalTaxAmount: 150, payments: [], ...over });
const TODAY = '2026-06-30';

describe('analytics dashboard numbers', () => {
  const bills = [
    inv({ invoiceNumber: 'A1', invoiceDate: '2026-06-20', clientName: 'Acme', totalAmount: 5000, totalTaxAmount: 750, status: 'paid', paidAmount: 5000, payments: [{ date: '2026-06-22', amount: 5000 }] }),
    inv({ invoiceNumber: 'A2', invoiceDate: '2026-06-10', clientName: 'Beta', totalAmount: 2000, data: { details: { dueDate: '2026-06-15' } } }),
    inv({ invoiceNumber: 'A3', invoiceDate: '2026-05-20', clientName: 'Acme', totalAmount: 2500 }),
    inv({ invoiceNumber: 'Q1', invoiceType: 'quotation', invoiceDate: '2026-06-25', totalAmount: 99999 }),
    inv({ invoiceNumber: 'X1', invoiceDate: '2026-06-26', status: 'cancelled', totalAmount: 7777 }),
    inv({ invoiceNumber: 'U1', invoiceDate: '2026-06-12', currency: 'USD', totalAmount: 100 }),
  ];
  const a = buildAnalytics(bills, { period: '30d', currency: 'INR', today: TODAY });

  it('counts only live INR sales in the period', () => {
    expect(a.now.revenue).toBe(7000);
    expect(a.now.count).toBe(2);
    expect(a.now.tax).toBe(900);
  });
  it('compares against the equally long period before', () => {
    expect(a.before.revenue).toBe(2500);
    expect(a.revenueDelta).toBeCloseTo(180);
  });
  it('counts money on the day it was received', () => {
    expect(a.now.collected).toBe(5000);
  });
  it('ages unpaid invoices by days past due', () => {
    const d30 = a.aging.find((g) => g.id === 'd30');
    expect(d30.amount).toBe(2000);
    expect(a.overdueCount).toBeGreaterThan(0);
  });
  it('ranks customers by sales', () => {
    expect(a.topClients.map((c) => c.name)).toEqual(['Acme', 'Beta']);
  });
  it('series sums back to the total', () => {
    expect(a.series.revenue.reduce((t, p) => t + p.value, 0)).toBe(7000);
  });
  it('lists currencies, most used first', () => {
    expect(currenciesIn(bills)).toEqual(['INR', 'USD']);
  });
  it('has no delta without a prior value', () => {
    expect(deltaPct(10, 0)).toBeNull();
  });
});
