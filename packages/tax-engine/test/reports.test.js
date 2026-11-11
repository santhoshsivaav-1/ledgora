// Vyapar parity Phase 6: the pure report maths (docs/VYAPAR_IMPLEMENTATION_PHASES.md, "Phase 6 test plan": stock
// valuation, profit & loss assembly, balance sheet assembly, plus cash flow and ageing).
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHART,
  ageing,
  ageingBucket,
  balanceSheet,
  cashFlow,
  cashFlowCategory,
  profitAndLoss,
  stockValuation,
  weightedAverageCost,
} from '../src/index.ts';

describe('weighted-average stock cost', () => {
  it('purchases at different prices average; sales go out at the average', () => {
    const moves = [
      { date: '2026-04-01', qty: 100, unitCost: 6 },
      { date: '2026-05-01', qty: 100, unitCost: 8 },
      { date: '2026-06-01', qty: -50 },
    ];
    expect(weightedAverageCost(moves, '2026-06-30')).toEqual({ qty: 150, avg: 7, value: 1050 });
  });
  it('as of a date only counts what happened by then (inclusive)', () => {
    const moves = [
      { date: '2026-04-01', qty: 10, unitCost: 5 },
      { date: '2026-05-01', qty: 10, unitCost: 15 },
    ];
    expect(weightedAverageCost(moves, '2026-04-30')).toEqual({ qty: 10, avg: 5, value: 50 });
    expect(weightedAverageCost(moves, '2026-05-01').value).toBe(200);
    expect(weightedAverageCost(moves, '2026-03-31')).toEqual({ qty: 0, avg: 0, value: 0 });
  });
  it('a price change between two sales: each sale takes the average of its day', () => {
    const moves = [
      { date: '2026-04-01', qty: 10, unitCost: 10 },
      { date: '2026-04-05', qty: -5 },
      { date: '2026-04-10', qty: 5, unitCost: 20 },
      { date: '2026-04-15', qty: -5 },
    ];
    // After the second purchase: 10 units at (5×10 + 5×20) / 10 = 15.
    expect(weightedAverageCost(moves, '2026-04-12').avg).toBe(15);
    expect(weightedAverageCost(moves, '2026-04-30')).toEqual({ qty: 5, avg: 15, value: 75 });
  });
  it('returns and adjustments without a cost come in at the running average', () => {
    const moves = [
      { date: '2026-04-01', qty: 10, unitCost: 12 },
      { date: '2026-04-02', qty: -4 },
      { date: '2026-04-03', qty: 2 },
    ];
    expect(weightedAverageCost(moves, '2026-04-30')).toEqual({ qty: 8, avg: 12, value: 96 });
  });
  it('stock that went below zero is valued at the next purchase’s cost, not a mixed one', () => {
    const moves = [
      { date: '2026-04-01', qty: -3 },
      { date: '2026-04-02', qty: 10, unitCost: 9 },
    ];
    expect(weightedAverageCost(moves, '2026-04-30')).toEqual({ qty: 7, avg: 9, value: 63 });
  });
  it('valuation adds up items', () => {
    const v = stockValuation(
      [
        { id: 'a', moves: [{ date: '2026-04-01', qty: 10, unitCost: 6 }] },
        {
          id: 'b',
          moves: [
            { date: '2026-04-01', qty: 3, unitCost: 100 },
            { date: '2026-04-02', qty: -1 },
          ],
        },
      ],
      '2026-04-30',
    );
    expect(v.total).toBe(260);
    expect(v.rows.map((r) => r.value)).toEqual([60, 200]);
  });
});

const acct = (code, debit, credit) => {
  const a = DEFAULT_CHART.find((x) => x.code === code);
  return { code, name: a.name, group: a.group, kind: a.kind, debit, credit };
};

describe('profit and loss', () => {
  it('gross profit = sales − (opening stock + purchases − closing stock); net adds indirect income and expenses', () => {
    const p = profitAndLoss({
      accounts: [
        acct('4000', 0, 1240000),
        acct('4010', 20000, 0),
        acct('5000', 720000, 0),
        acct('4100', 0, 8000),
        acct('5220', 40000, 0),
        acct('5210', 6000, 0),
        acct('1000', 99999, 0), // not income or expense: ignored
      ],
      openingStock: 100000,
      closingStock: 150000,
    });
    expect(p.totals).toMatchObject({
      directIncome: 1220000,
      directExpenses: 720000,
      costOfSales: 670000,
      grossProfit: 550000,
      indirectIncome: 8000,
      indirectExpenses: 46000,
      netProfit: 512000,
    });
    expect(p.directIncome.map((l) => l.code)).toEqual(['4000', '4010']);
    expect(p.directIncome[1].amount).toBe(-20000); // sales return reduces income
  });
  it('an empty period is all zero; a loss is negative', () => {
    expect(profitAndLoss({ accounts: [] }).totals.netProfit).toBe(0);
    expect(profitAndLoss({ accounts: [acct('5100', 500, 0)] }).totals.netProfit).toBe(-500);
  });
});

describe('balance sheet', () => {
  it('balances, with closing stock as an asset and the opening stock as capital', () => {
    // Capital 1,00,000 into the bank; bought 50,000 on credit; sold 30,000 cash; opening stock 10,000 (not in the books);
    // closing stock 35,000.
    const accounts = [
      acct('1000', 30000, 0),
      acct('1190', 100000, 0),
      acct('2000', 0, 50000),
      acct('3000', 0, 100000),
      acct('4000', 0, 30000),
      acct('5000', 50000, 0),
    ];
    const pl = profitAndLoss({ accounts, openingStock: 10000, closingStock: 35000 });
    expect(pl.totals.netProfit).toBe(5000);
    const bs = balanceSheet({
      accounts,
      closingStock: 35000,
      openingStock: 10000,
      currentProfit: pl.totals.netProfit,
    });
    expect(bs.totals).toMatchObject({
      assets: 165000,
      liabilities: 165000,
      balanced: true,
      difference: 0,
    });
    expect(bs.profit).toEqual([{ name: 'Net profit (current year)', amount: 5000 }]);
    expect(bs.capital.map((c) => c.name)).toContain('Opening stock (capital introduced)');
  });
  it('profit of earlier years is retained earnings', () => {
    const accounts = [acct('1000', 1000, 0), acct('4000', 0, 1000)];
    const bs = balanceSheet({ accounts, currentProfit: 400 });
    expect(bs.profit).toEqual([
      { name: 'Retained earnings (earlier years)', amount: 600 },
      { name: 'Net profit (current year)', amount: 400 },
    ]);
    expect(bs.totals.balanced).toBe(true);
  });
  it('a ledger that does not balance shows the difference, never hides it', () => {
    const bs = balanceSheet({ accounts: [acct('1000', 500, 0)] });
    expect(bs.totals.balanced).toBe(false);
    expect(bs.suspense).toEqual([{ name: 'Difference in opening balances', amount: 500 }]);
    expect(bs.totals.assets).toBe(bs.totals.liabilities);
  });
  it('property: 200 random balanced ledgers always give a balanced sheet whose profit equals the P&L', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const codes = DEFAULT_CHART.map((a) => a.code);
    for (let i = 0; i < 200; i++) {
      const tot = new Map();
      for (let v = 0; v < 12; v++) {
        const amt = Math.round(rnd() * 100000) / 100;
        const dr = codes[Math.floor(rnd() * codes.length)];
        const cr = codes[Math.floor(rnd() * codes.length)];
        tot.set(dr, { d: (tot.get(dr)?.d ?? 0) + amt, c: tot.get(dr)?.c ?? 0 });
        tot.set(cr, { d: tot.get(cr)?.d ?? 0, c: (tot.get(cr)?.c ?? 0) + amt });
      }
      const accounts = [...tot.entries()].map(([code, t]) => acct(code, t.d, t.c));
      const opening = Math.round(rnd() * 5000);
      const closing = Math.round(rnd() * 8000);
      const pl = profitAndLoss({ accounts, openingStock: opening, closingStock: closing });
      const bs = balanceSheet({
        accounts,
        openingStock: opening,
        closingStock: closing,
        currentProfit: pl.totals.netProfit,
      });
      expect(bs.totals.balanced, `case ${i}: ${bs.totals.difference}`).toBe(true);
      expect(bs.profit.length).toBe(1);
    }
  });
});

describe('cash flow', () => {
  it('opening + in − out = closing; a transfer nets to its fee', () => {
    const f = cashFlow({
      opening: 300000,
      vouchers: [
        { refType: 'payment', net: 50000 },
        { refType: 'invoice', net: 8000 },
        { refType: 'purchase', net: -20000 },
        { refType: 'expense', net: -3600 },
        { refType: 'transfer', net: -15 },
        { refType: 'loan', net: 100000 },
        { refType: 'loan_payment', net: -10000 },
        { refType: 'journal', net: 0 },
      ],
    });
    expect(f.totalIn).toBe(158000);
    expect(f.totalOut).toBe(33615);
    expect(f.closing).toBe(424385);
    expect(f.moneyOut.find((x) => x.name === 'Bank charges on transfers').amount).toBe(15);
  });
  it('headings by what posted the money', () => {
    expect(cashFlowCategory('payment', 1)).toBe('Money from customers');
    expect(cashFlowCategory('payment', -1)).toBe('Payments to suppliers');
    expect(cashFlowCategory('adjustment', -1)).toBe('Drawings and adjustments out');
    expect(cashFlowCategory('mystery', 1)).toBe('Other money in');
  });
});

describe('ageing', () => {
  it('buckets by days since the document; nothing due or future-dated is left out', () => {
    expect(ageingBucket('2026-11-01', '2026-11-11')).toBe('0-30');
    expect(ageingBucket('2026-09-12', '2026-11-11')).toBe('31-60');
    expect(ageingBucket('2026-08-13', '2026-11-11')).toBe('61-90');
    expect(ageingBucket('2026-08-12', '2026-11-11')).toBe('90+');
    const rows = ageing(
      [
        { partyId: 's', partyName: 'Om', date: '2026-11-01', due: 100 },
        { partyId: 's', partyName: 'Om', date: '2026-07-01', due: 50 },
        { partyId: 't', partyName: 'Kiran', date: '2026-10-01', due: 0 },
        { partyId: 't', partyName: 'Kiran', date: '2026-12-01', due: 70 },
      ],
      '2026-11-11',
    );
    expect(rows).toEqual([
      { partyId: 's', partyName: 'Om', '0-30': 100, '31-60': 0, '61-90': 0, '90+': 50, total: 150 },
    ]);
  });
});
