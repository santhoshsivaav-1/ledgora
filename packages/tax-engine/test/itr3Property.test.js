// 300 random returns: each must pass the schema, the department rules and the input checks, and its tax must match an
// independent calculation of the new-regime slabs written here.
import { describe, expect, it } from 'vitest';
import { computeBlocks, computeItr3, itr3InputChecks, itr3Json, validateItr3Rules } from '../src/index.ts';
import { validateItr3Schema } from '../src/itr3Schema.ts';
import { balanceSheet, books, itr3Input } from './fixtures/itr3Fixture.js';

let seed = 20260620;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (a, b) => Math.round(a + rnd() * (b - a));
const BLOCKS = ['PM15', 'PM40', 'FF10', 'BLD10', 'INT25'];

/** New regime FY 2025-26: nil to 4L, 5% to 8L, 10% to 12L, 15% to 16L, 20% to 20L, 25% to 24L, 30% above; rebate to 12L; cess 4%. */
const newRegimeTax = (income) => {
  const slabs = [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]];
  let tax = 0;
  let lower = 0;
  for (const [upto, rate] of slabs) {
    if (income > lower) tax += (Math.min(income, upto) - lower) * rate;
    lower = upto;
  }
  if (income <= 1200000) tax = 0;
  return Math.round(tax + Math.round(tax * 0.04));
};

describe('300 random returns', () => {
  for (let i = 0; i < 300; i += 1) {
    it(`#${i}`, () => {
      const goods = between(500_000, 9_000_000);
      const purchases = Math.round(goods * (0.4 + rnd() * 0.4));
      const assetList = Array.from({ length: between(0, 4) }, (_, n) => ({
        id: `a${n}`,
        name: `Asset ${n}`,
        block: BLOCKS[between(0, BLOCKS.length - 1)],
        cost: between(10_000, 400_000),
        putToUse: `${between(2022, 2025)}-${String(between(4, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`,
      })).filter((a) => a.putToUse <= '2026-03-31');
      const blocks = computeBlocks('2025-26', assetList, []);
      const bookDep = between(0, 60_000);
      const input = itr3Input({
        books: books({
          saleOfGoods: goods,
          purchases,
          openingStock: between(0, 500_000),
          closingStock: between(0, 500_000),
          interestIncome: between(0, 50_000),
          dividendIncome: between(0, 20_000),
          bookDepreciation: bookDep,
          salariesAndWages: between(0, 600_000),
          rentPaid: between(0, 300_000),
          interestPaid: between(0, 100_000),
          otherExpenses: [{ name: 'Sundry', amount: between(0, 200_000) }],
        }),
        balanceSheet: balanceSheet({ proprietorCapital: 0, grossBlock: assetList.reduce((s, a) => s + a.cost, 0), accumulatedDepreciation: 0 }),
        blocks,
        adjustments: { unpaid43B: { pfEsiContribution: between(0, 20_000) }, cashPaymentsUs40A3: between(0, 40_000) },
      });
      const c = computeItr3(input);
      const file = itr3Json(input, c);
      expect(validateItr3Schema(file).map((x) => x.message)).toEqual([]);
      expect(validateItr3Rules(file).map((x) => x.message)).toEqual([]);
      const blocking = itr3InputChecks(input, c).filter((x) => x.severity === 'error').map((x) => x.code);
      // A random loss larger than the other income can not be filed here: that is the one allowed refusal.
      expect(blocking.filter((x) => x !== 'ITR3_LOSS_CF')).toEqual([]);
      if (blocking.length === 0) {
        // Independent tax check: new regime, total income rounded to ten rupees (section 288A).
        // Other sources here is the books' interest and dividend; a business loss comes off it before anything else.
        const os = input.books.interestIncome + input.books.dividendIncome;
        const biz = c.calc.businessIncome;
        const gti = Math.max(0, biz) + Math.max(0, os - Math.max(0, -biz));
        const ti = Math.round(Math.max(0, gti) / 10) * 10;
        expect(c.totalIncome).toBe(ti);
        // Marginal relief on the 87A rebate (about 12 to 12.71 lakh) is not modelled here.
        if (ti > 1_280_000 || ti < 1_100_000) expect(c.netTaxLiability).toBe(newRegimeTax(ti));
      }
    });
  }
});
