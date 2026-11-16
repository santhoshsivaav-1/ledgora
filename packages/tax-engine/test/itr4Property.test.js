// R2.3, randomised: hundreds of generated returns, each of which must pass the builder's checks, the department's
// cross-field rules and the official schema; and the tax on each is compared with an independent calculation written
// here from the slabs of the law (FY 2025-26), not taken from the code under test. A seeded generator keeps failures
// reproducible: the failing seed is in the test name.
import { describe, expect, it } from 'vitest';
import {
  GSTIN_CHARS,
  computeItr4,
  itr4Eligibility,
  itr4InputChecks,
  itr4Json,
  itrRulesFor,
  validateItr4Rules,
} from '../src/index.ts';
import { validateItr4Schema } from '../src/itr4Schema.ts';

const rng = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (r, lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
const pick = (r, list) => list[between(r, 0, list.length - 1)];
const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};

// ---- the independent oracle: tax on total income, FY 2025-26, written out from the law ----------------------------------
const slabTax = (income, bands) => {
  let tax = 0;
  let lower = 0;
  for (const [upto, rate] of bands) {
    if (income > lower) tax += (Math.min(income, upto) - lower) * rate;
    lower = upto;
  }
  return tax;
};
const NEW = [
  [400_000, 0],
  [800_000, 0.05],
  [1_200_000, 0.1],
  [1_600_000, 0.15],
  [2_000_000, 0.2],
  [2_400_000, 0.25],
  [Infinity, 0.3],
];
const OLD = {
  under60: [
    [250_000, 0],
    [500_000, 0.05],
    [1_000_000, 0.2],
    [Infinity, 0.3],
  ],
  senior: [
    [300_000, 0],
    [500_000, 0.05],
    [1_000_000, 0.2],
    [Infinity, 0.3],
  ],
  super: [
    [500_000, 0],
    [1_000_000, 0.2],
    [Infinity, 0.3],
  ],
};
function oracle(totalIncome, regime, age) {
  const tax = Math.round(
    slabTax(
      totalIncome,
      regime === 'new' ? NEW : age >= 80 ? OLD.super : age >= 60 ? OLD.senior : OLD.under60,
    ),
  );
  let rebate = 0;
  if (regime === 'new') {
    if (totalIncome <= 1_200_000) rebate = Math.min(tax, 60_000);
    else if (tax > totalIncome - 1_200_000) rebate = tax - (totalIncome - 1_200_000); // marginal relief
  } else if (totalIncome <= 500_000) rebate = Math.min(tax, 12_500);
  const afterRebate = tax - rebate;
  const cess = Math.round(afterRebate * 0.04);
  return { tax, rebate, afterRebate, cess, total: afterRebate + cess };
}

const particulars = {
  sundryCreditors: 100000,
  inventories: 400000,
  sundryDebtors: 200000,
  balWithBanks: 100000,
  cashInHand: 20000,
  partnerMemberOwnCapital: 520000,
};

function randomReturn(seed) {
  const r = rng(seed);
  const regime = r() < 0.65 ? 'new' : 'old';
  const section = r() < 0.5 ? '44AD' : '44ADA';
  let digital;
  let cash;
  if (section === '44AD') {
    const total = between(r, 100_000, r() < 0.5 ? 20_000_000 : 30_000_000);
    const cashShare = total > 20_000_000 ? r() * 0.05 : r() * 0.5;
    cash = Math.round(total * cashShare);
    digital = total - cash;
  } else {
    const total = between(r, 100_000, r() < 0.5 ? 5_000_000 : 7_500_000);
    const cashShare = total > 5_000_000 ? r() * 0.05 : r() * 0.5;
    cash = Math.round(total * cashShare);
    digital = total - cash;
  }
  const salaried = r() < 0.35;
  const senior = r() < 0.15;
  const input = {
    fy: '2025-26',
    filedOn: r() < 0.5 ? '2026-08-10' : '2026-11-16',
    regime,
    taxpayer: {
      pan: 'ABCPK1234F',
      firstName: 'Test',
      surname: 'Person',
      fatherName: 'Father Person',
      dob: senior
        ? '1960-01-01'
        : `19${between(r, 62, 99)}-0${between(r, 1, 9)}-1${between(r, 0, 9)}`,
      residenceNo: '1',
      locality: 'Locality',
      city: 'Chennai',
      stateCode: '33',
      pinCode: '600001',
      mobile: '9876543210',
      email: 'a@b.co',
      employerCategory: salaried ? 'OTH' : 'NA',
      bankAccounts: [
        {
          ifsc: 'HDFC0000123',
          bankName: 'HDFC Bank',
          accountNo: '123456789',
          accountType: 'SB',
          useForRefund: true,
        },
      ],
      place: 'Chennai',
    },
    business: {
      section,
      code: section === '44AD' ? '09002' : '16001',
      name: 'Business',
      digitalReceipts: digital,
      cashReceipts: cash,
      particulars,
      gstTurnover:
        r() < 0.5 ? [{ gstin: gstin('33ABCPK1234F1Z'), amount: digital + cash }] : undefined,
    },
    salary: salaried
      ? {
          gross: between(r, 100_000, 500_000),
          basicAndDa: 100_000,
          tds: [
            { tan: 'CHEA12345B', name: 'Employer', income: 100_000, tds: between(r, 0, 9_000) },
          ],
        }
      : undefined,
    otherSources: {
      savingsInterest: between(r, 0, 60_000),
      depositInterest: between(r, 0, 150_000),
      dividend: [0, between(r, 0, 5000), 0, 0, 0],
    },
    declarations: {
      houseProperty: false,
      capitalGains: false,
      foreignAssetsOrIncome: false,
      companyDirector: false,
      unlistedShares: false,
      carriedForwardLoss: false,
      agriculturalIncomeOver5000: false,
      section44AE: false,
    },
  };
  if (regime === 'old') {
    input.form10IEA = { ack: '123456789012345', filedOn: '2026-07-01' };
    input.deductions = {
      sec80C: [{ id: 'LIC-1', amount: between(r, 0, 200_000) }],
      sec80CCD1B: between(r, 0, 80_000),
      sec80D:
        r() < 0.5
          ? {
              selfSenior: senior,
              selfPremiums: [{ insurer: 'Insurer', policy: 'P1', amount: between(r, 1, 60_000) }],
              selfCheckup: between(r, 0, 9000),
            }
          : undefined,
    };
  } else if (salaried && r() < 0.5) input.deductions = { sec80CCD2: between(r, 0, 30_000) };
  const claimed = between(r, 0, 5_000);
  if (r() < 0.6)
    input.tds = [
      {
        tan: 'CHEA12345B',
        name: 'Customer',
        section: '94C',
        gross: 1_000_000,
        tdsDeducted: claimed + between(r, 0, 500),
        tdsClaimed: claimed,
        headOfIncome: 'BP',
      },
    ];
  const challans = [];
  if (r() < 0.5)
    challans.push({
      bsr: '0510308',
      date: pick(r, ['2025-06-14', '2025-09-15', '2025-12-14', '2026-03-14']),
      serial: between(r, 1, 99999),
      amount: between(r, 1000, 300_000),
    });
  if (r() < 0.4)
    challans.push({
      bsr: '0510308',
      date: pick(r, ['2026-04-10', '2026-07-30', '2026-08-05']),
      serial: between(r, 1, 99999),
      amount: between(r, 1000, 200_000),
    });
  if (challans.length) input.challans = challans;
  return input;
}

const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i * 7);

describe('300 random returns', () => {
  const rules = itrRulesFor('2025-26');
  it.each(SEEDS)('seed %i is clean and its tax matches the independent calculation', (seed) => {
    const input = randomReturn(seed);
    const c = computeItr4(input, rules);
    const json = itr4Json(input, c, rules);
    const errors = (list) =>
      list.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.message}`);

    // Only returns inside ITR-4's income limit are expected to be accepted; the rest must be refused, never built wrongly.
    const eligibility = errors(itr4Eligibility(input, rules));
    expect(eligibility).toEqual([]);
    expect(errors(itr4InputChecks(input))).toEqual([]);
    if (c.totalIncome > 5_000_000) {
      expect(errors(validateItr4Rules(json, rules)).join()).toMatch(/R267/);
      return;
    }
    expect(errors(validateItr4Rules(json, rules))).toEqual([]);
    expect(validateItr4Schema(json, '2026-27').map((i) => i.message)).toEqual([]);

    // The tax, from the law.
    const want = oracle(c.totalIncome, input.regime, c.age);
    expect({
      tax: c.taxOnTotalIncome,
      rebate: c.rebate87A,
      cess: c.cess,
      total: c.grossTaxLiability,
    }).toEqual({ tax: want.tax, rebate: want.rebate, cess: want.cess, total: want.total });
    // Total income is gross total income less deductions, to the nearest ten (288A).
    expect(
      Math.abs(c.totalIncome - Math.max(0, c.grossTotalIncome - c.totalDeductions)),
    ).toBeLessThanOrEqual(5);
    expect(c.totalIncome % 10).toBe(0);
    // A refund and a balance are never both due, and both are rounded to ten (288B).
    expect(c.refundDue * c.balanceTaxPayable).toBe(0);
    expect(c.refundDue % 10 === 0 && c.balanceTaxPayable % 10 === 0).toBe(true);
    // Advance and self-assessment tax come only from the challan dates.
    expect(c.advanceTaxPaid + c.selfAssessmentTaxPaid).toBe(
      (input.challans ?? []).reduce((s, x) => s + x.amount, 0),
    );
    // The late fee, section and 234A follow the filing date.
    expect(c.late).toBe(input.filedOn > '2026-08-31');
    expect(c.fee234F).toBe(c.late ? (c.totalIncome <= 500_000 ? 1000 : 5000) : 0);
    if (!c.late) expect(c.interest234A).toBe(0);
  });
});

describe('the independent oracle itself (known cases from the law)', () => {
  it.each([
    [1_200_000, 'new', 0, { tax: 60_000, rebate: 60_000, total: 0 }],
    // ₹12,75,000: slab tax ₹71,250; the excess over ₹12 lakh is ₹75,000, so no marginal relief is needed and no rebate
    [1_275_000, 'new', 0, { tax: 71_250, rebate: 0, total: 74_100 }],
    [1_300_000, 'new', 0, { tax: 75_000, rebate: 0, total: 78_000 }],
    [500_000, 'old', 30, { tax: 12_500, rebate: 12_500, total: 0 }],
    [600_000, 'old', 30, { tax: 32_500, rebate: 0, total: 33_800 }],
    [600_000, 'old', 65, { tax: 30_000, rebate: 0, total: 31_200 }],
  ])('income %i %s regime age %i', (income, regime, age, want) => {
    const o = oracle(income, regime, age);
    expect(o.tax).toBe(want.tax);
    expect(o.rebate).toBe(want.rebate);
    expect(o.total).toBe(want.total);
  });
});
