// Vyapar parity P10-S8: the ledger's Profit & Loss mapped to ITR-3 Part A-P&L rows, and the profit projected for advance tax.
import { describe, expect, it } from 'vitest';
import { itr3Map, projectAnnualProfit } from '../src/index.ts';

const pl = {
  rows: [
    { id: 'Income:4000', section: 'Income', particulars: 'Sales', code: '4000', amount: 1240000 },
    { id: 'directIncome', section: 'Income', particulars: 'Total income', code: '', amount: 1240000 },
    { id: 'openingStock', section: 'Cost of sales', particulars: 'Opening stock', code: '', amount: 100000 },
    { id: 'Cost of sales:5000', section: 'Cost of sales', particulars: 'Purchases', code: '5000', amount: 720000 },
    { id: 'Cost of sales:5010', section: 'Cost of sales', particulars: 'Freight inward', code: '5010', amount: 20000 },
    { id: 'closingStock', section: 'Cost of sales', particulars: 'Less: closing stock', code: '', amount: -150000 },
    { id: 'costOfSales', section: 'Cost of sales', particulars: 'Cost of sales', code: '', amount: 690000 },
    { id: 'grossProfit', section: '', particulars: 'Gross profit', code: '', amount: 550000 },
    { id: 'Other income:4100', section: 'Other income', particulars: 'Interest received', code: '4100', amount: 10000 },
    { id: 'Indirect expenses:5200', section: 'Indirect expenses', particulars: 'Rent', code: '5200', amount: 120000 },
    { id: 'Indirect expenses:5300', section: 'Indirect expenses', particulars: 'Depreciation', code: '5300', amount: 30000 },
    { id: 'Indirect expenses:5400', section: 'Indirect expenses', particulars: 'Interest on loan', code: '5400', amount: 20000 },
    { id: 'Indirect expenses:5500', section: 'Indirect expenses', particulars: 'Salaries', code: '5500', amount: 110000 },
    { id: 'indirectExpenses', section: 'Indirect expenses', particulars: 'Total indirect expenses', code: '', amount: 280000 },
    { id: 'netProfit', section: '', particulars: 'Net profit', code: '', amount: 280000 },
  ],
  totals: { directIncome: 1240000, openingStock: 100000, closingStock: 150000, netProfit: 280000 },
};

describe('itr3Map', () => {
  it('maps each P&L line to its Part A-P&L row and reconciles to the net profit', () => {
    const m = itr3Map(pl);
    const v = Object.fromEntries(m.rows.map((r) => [r.key, r.amount]));
    expect(v).toEqual({
      turnover: 1240000, otherIncome: 10000, openingStock: 100000, purchases: 720000, directExpenses: 20000,
      closingStock: 150000, depreciation: 30000, interest: 20000, otherExpenses: 230000, netProfit: 280000,
    });
    expect(m.reconciled).toBe(true);
    expect(m.diff).toBe(0);
  });
  it('says so when the lines do not add up to the net profit', () => {
    const broken = { ...pl, rows: pl.rows.map((r) => (r.id === 'netProfit' ? { ...r, amount: 290000 } : r)), totals: { ...pl.totals, netProfit: 290000 } };
    expect(itr3Map(broken)).toMatchObject({ reconciled: false, diff: 10000 });
  });
});

describe('projectAnnualProfit', () => {
  it('annualises the profit to date over the days of the year gone', () => {
    // 1 Apr to 6 Nov 2026 is 220 days.
    expect(projectAnnualProfit(280000, '2026-04-01', '2026-11-06')).toBe(464545.45);
  });
  it('is the profit itself once the year is over, and zero before it starts', () => {
    expect(projectAnnualProfit(500000, '2026-04-01', '2027-04-30')).toBe(500000);
    expect(projectAnnualProfit(500000, '2026-04-01', '2026-03-31')).toBe(0);
  });
});
