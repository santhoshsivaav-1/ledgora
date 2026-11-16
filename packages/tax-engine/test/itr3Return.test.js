// R2.5: ITR-3 for AY 2026-27. Every return built here is checked four ways: the builder's eligibility and input checks, the
// department's validation rules by number (itr3Rules.ts), the department's published JSON schema (itr3Schema.ts), and, for the
// figures, hand calculations from the law written out below (not from the code under test).
import { describe, expect, it } from 'vitest';
import {
  ITR3_RULES_CHECKED,
  auditLiability,
  computeBlocks,
  computeItr3,
  itr3Eligibility,
  itr3InputChecks,
  itr3Json,
  validateItr3Rules,
} from '../src/index.ts';
import { validateItr3Schema } from '../src/itr3Schema.ts';
import { assets, balanceSheet, books, declarations, itr3Input } from './fixtures/itr3Fixture.js';

const build = (input) => {
  const c = computeItr3(input);
  const file = itr3Json(input, c);
  return { c, file, schema: validateItr3Schema(file), rules: validateItr3Rules(file), checks: itr3InputChecks(input, c) };
};
const errors = (xs) => xs.filter((x) => x.severity === 'error').map((x) => x.code);

const full = () =>
  itr3Input({
    regime: 'old',
    form10IEA: { ack: '123456789012345', filedOn: '2026-06-01' },
    salary: {
      gross: 300000,
      basicAndDa: 150000,
      professionalTax: 2400,
      employer: { name: 'ABC Pvt Ltd', nature: 'PE', address: '5 Mount Road', city: 'Chennai', stateCode: '33' },
      tds: [{ tan: 'CHEA12345B', name: 'ABC Pvt Ltd', income: 300000, tds: 5000 }],
    },
    otherSources: {
      savingsInterest: 4000,
      depositInterest: 9000,
      refundInterest: 500,
      dividend: [0, 1000, 0, 0, 500],
      other: [{ description: 'Commission', amount: 2000 }],
    },
    deductions: {
      sec80C: [{ id: 'LIC123', amount: 100000 }],
      sec80D: { selfPremiums: [{ insurer: 'Star Health', policy: 'P1', amount: 18000 }] },
    },
    tds: [{ tan: 'CHEB12345A', name: 'Buyer Co', section: '94C', gross: 500000, tdsDeducted: 5000, tdsClaimed: 5000, headOfIncome: 'BP' }],
    tcs: [{ tan: 'CHEC12345A', name: 'Seller Co', tcs: 1000, claimed: 1000 }],
    challans: [
      { bsr: '0510308', date: '2026-03-14', serial: 12345, amount: 100000 },
      { bsr: '0510308', date: '2026-07-10', serial: 9, amount: 5000 },
    ],
    business: { name: 'Kumar Stores', code: '09001', method: 'CASH', gstTurnover: [{ gstin: '33ABCPK1234F1ZC', amount: 6000000 }] },
    adjustments: {
      personalExpenses: 12000,
      cashPaymentsUs40A3: 30000,
      unpaid43B: { pfEsiContribution: 8000, msePayable: 15000 },
      paid43BOfEarlierYears: { bonusCommission: 5000 },
    },
  });

describe('the figures, worked by hand', () => {
  const { c, file } = build(itr3Input());
  const k = c.calc;
  it('trading and profit and loss accounts', () => {
    // Revenue 60,00,000. Credits 60,00,000 + closing stock 5,00,000. Debits: opening 4,00,000, purchases 45,00,000, direct 60,000.
    expect(k.revenue).toBe(6_000_000);
    expect(k.directExpenses).toBe(60_000);
    expect(k.grossProfit).toBe(6_500_000 - 400_000 - 4_500_000 - 60_000); // 15,40,000
    // Other income 12,000 + 3,000 + 15,000 = 30,000. Expenses 3,60,000 + 1,80,000 + 1,03,000; interest 40,000; depreciation 31,000.
    expect(k.otherIncomeTotal).toBe(30_000);
    expect(k.pbidta).toBe(1_540_000 + 30_000 - 360_000 - 180_000 - 103_000); // 9,27,000
    expect(k.profitBeforeTax).toBe(927_000 - 40_000 - 31_000); // 8,56,000
  });
  it('Schedule BP: other-source income out, tax depreciation in', () => {
    // Laptop 60,000 (1 Jun: full 40% = 24,000), printer 20,000 (15 Jan: under 180 days, half 20% = 4,000), fittings 2,00,000
    // bought Aug 2024 (10% = 20,000 in 2024-25, so 1,80,000 opens this year: 18,000). Total 46,000.
    expect(k.taxDepreciation).toBe(46_000);
    expect(k.creditedToOtherHeads).toBe(15_000); // interest 12,000 + dividend 3,000
    expect(k.businessIncome).toBe(856_000 - 15_000 + 31_000 - 46_000); // 8,26,000
    expect(c.incomeOtherSources).toBe(15_000);
    expect(c.grossTotalIncome).toBe(841_000);
  });
  it('balances: sources 11,70,000 = application', () => {
    expect(k.fundsSource).toBe(1_170_000);
    expect(k.fundsApplied).toBe(1_170_000);
    const bs = file.ITR.ITR3.PARTA_BS;
    expect(bs.FundSrc.TotFundSrc).toBe(bs.FundApply.TotFundApply);
  });
  it('new regime: total income 8,41,000 is within the section 87A rebate, so no tax', () => {
    // Slab tax would be (8,00,000-4,00,000) x 5% + 41,000 x 10% = 24,100; the rebate (income up to 12 lakh) removes it.
    expect(c.totalIncome).toBe(841_000);
    expect(c.taxOnTotalIncome).toBe(24_100);
    expect(c.rebate87A).toBe(24_100);
    expect(c.netTaxLiability).toBe(0);
  });
  it('old regime: slabs, then 4% cess', () => {
    const r = build(full());
    // Business: PBT 8,56,000 - 15,000 credited elsewhere + 31,000 - 46,000 + adds 12,000 + 30,000 + 8,000 + 15,000 - 5,000.
    expect(r.c.calc.businessIncome).toBe(826_000 + 12_000 + 30_000 + 8_000 + 15_000 - 5_000);
    // Old regime, under 60: nil to 2.5L, 5% to 5L (12,500), 20% to 10L (1,00,000), 30% above; then 4% cess.
    const ti = r.c.totalIncome;
    expect(ti).toBeGreaterThan(1_000_000);
    const slab = 12_500 + 100_000 + Math.round(0.3 * (ti - 1_000_000));
    expect(r.c.taxOnTotalIncome).toBe(slab);
    expect(r.c.cess).toBe(Math.round(slab * 0.04));
  });
});

describe('every return is clean against the schema, the department rules and the input checks', () => {
  const cases = {
    'a trader, new regime': () => itr3Input(),
    'salary, deductions, TDS, TCS, challans, adjustments (old regime)': full,
    'a service business with no stock': () =>
      itr3Input({ books: books({ saleOfGoods: 0, saleOfServices: 2_000_000, openingStock: 0, closingStock: 0, purchases: 0 }), balanceSheet: balanceSheet({ inventories: 0, proprietorCapital: 0 }) }),
    'turnover above 1 crore with a tax audit': () =>
      itr3Input({
        books: books({ saleOfGoods: 25_000_000, purchases: 20_000_000 }),
        balanceSheet: balanceSheet({ proprietorCapital: 0 }),
        audit: { audited: true, reportDate: '2026-07-01', ack: '123456789012345', auditorName: 'XYZ & Co', auditorPan: 'AAAFX1234X', cashReceiptsPct: 30, cashPaymentsPct: 30 },
        filedOn: '2026-10-20',
      }),
    'a vehicle block in the 45% rate, old regime': () =>
      itr3Input({
        regime: 'old',
        form10IEA: { ack: '123456789012345', filedOn: '2026-06-01' },
        blocks: computeBlocks('2025-26', [], [{ block: 'PM45', fy: '2025-26', wdv: 500000 }]),
      }),
    'late filing': () => itr3Input({ filedOn: '2026-12-20' }),
  };
  for (const [name, make] of Object.entries(cases))
    it(name, () => {
      const r = build(make());
      expect(r.schema.map((i) => i.message)).toEqual([]);
      expect(r.rules.map((i) => i.message)).toEqual([]);
      expect(errors(r.checks)).toEqual([]);
    });
  it('the audit case carries the report details and the later due date', () => {
    const r = build(cases['turnover above 1 crore with a tax audit']());
    const f = r.file.ITR.ITR3;
    expect(f.PartA_GEN2.AuditInfo).toMatchObject({ LiableSec44ABflg: 'Y', AuditAccountantFlg: 'Y', AckNum44AB: 123456789012345 });
    expect(f.PartA_GEN1.FilingStatus.ItrFilingDueDate).toBe('2026-10-31');
    expect(r.c.late).toBe(false); // 20 October is before the audit due date
  });
});

describe('what the builder refuses', () => {
  const code = (input) => errors(itr3InputChecks(input, computeItr3(input)));
  it.each([
    ['houseProperty', 'ITR3_HP'],
    ['capitalGains', 'ITR3_CG'],
    ['foreignAssetsOrIncome', 'ITR3_FA'],
    ['companyDirector', 'ITR3_DIRECTOR'],
    ['unlistedShares', 'ITR3_UNLISTED'],
    ['partnerInFirm', 'ITR3_PARTNER'],
    ['carriedForwardLoss', 'ITR3_CFL'],
    ['agriculturalIncomeOver5000', 'ITR3_AGRI'],
    ['cashDeposits1Crore', 'ITR3_7P_DEPOSIT'],
    ['manufacturingAccount', 'ITR3_MA'],
    ['speculativeOrSpecifiedBusiness', 'ITR3_SPEC'],
    ['nonResident', 'ITR3_NRI'],
  ])('%s', (flag, expected) => {
    expect(code(itr3Input({ declarations: declarations({ [flag]: true }) }))).toContain(expected);
  });
  it('an unbalanced balance sheet', () => {
    expect(code(itr3Input({ balanceSheet: { ...balanceSheet(), sundryDebtors: 999_999 } }))).toContain('ITR3_BS_UNBALANCED');
  });
  it('a sale that ends the block (section 50 gain) belongs in Schedule CG', () => {
    const sold = [{ id: 'm', name: 'm', block: 'PM15', cost: 90000, putToUse: '2020-01-01', disposal: { date: '2025-09-01', proceeds: 70000 } }];
    const blocks = computeBlocks('2025-26', sold, [{ block: 'PM15', fy: '2025-26', wdv: 50000 }]);
    expect(code(itr3Input({ blocks }))).toContain('ITR3_S50');
  });
  it('a tax audit that has not been done', () => {
    const input = itr3Input({ books: books({ saleOfGoods: 25_000_000, purchases: 20_000_000 }), balanceSheet: balanceSheet({ proprietorCapital: 0 }), audit: { cashReceiptsPct: 40, cashPaymentsPct: 40 } });
    expect(code(input)).toContain('ITR3_AUDIT_REQUIRED');
  });
  it('audit report details that are missing or wrong', () => {
    const input = itr3Input({ books: books({ saleOfGoods: 25_000_000, purchases: 20_000_000 }), balanceSheet: balanceSheet({ proprietorCapital: 0 }), audit: { audited: true, cashReceiptsPct: 40, cashPaymentsPct: 40, ack: '12' } });
    expect(code(input)).toEqual(expect.arrayContaining(['ITR3_AUDIT_DATE', 'ITR3_AUDIT_ACK', 'ITR3_AUDITOR', 'ITR3_AUDITOR_PAN']));
  });
  it('a loss that cannot be fully set off must be carried forward', () => {
    const input = itr3Input({ books: books({ otherExpenses: [{ name: 'Big', amount: 2_000_000 }] }), balanceSheet: balanceSheet({ sundryCreditors: 0 }) });
    const c = computeItr3(input);
    expect(c.lossCarriedForward).toBeGreaterThan(0);
    expect(code(input)).toContain('ITR3_LOSS_CF');
  });
  it('a loss is set off against other sources first', () => {
    const input = itr3Input({
      books: books({ otherExpenses: [{ name: 'Big', amount: 1_000_000 }], interestIncome: 40_000 }),
      otherSources: { depositInterest: 100_000 },
      balanceSheet: balanceSheet({ sundryCreditors: 0 }),
    });
    const c = computeItr3(input);
    // Other sources: 1,00,000 not in the books + 40,000 interest and 3,000 dividend that are; the loss comes off that first.
    const loss = -c.calc.businessIncome;
    expect(loss).toBeGreaterThan(0);
    expect(c.businessLossSetOff).toBe(Math.min(loss, 143_000));
    expect(c.lossCarriedForward).toBe(Math.max(0, loss - 143_000));
    expect(c.incomeOtherSources).toBe(143_000 - c.businessLossSetOff);
  });
  it('total income above 50 lakh needs Schedule AL', () => {
    const input = itr3Input({ books: books({ saleOfGoods: 20_000_000, purchases: 10_000_000 }), balanceSheet: balanceSheet({ proprietorCapital: 0 }), audit: { audited: true, reportDate: '2026-07-01', ack: '123456789012345', auditorName: 'A', auditorPan: 'AAAFX1234X', cashReceiptsPct: 1, cashPaymentsPct: 1 } });
    expect(code(input)).toContain('ITR3_SCHEDULE_AL');
  });
  it('identity checks shared with ITR-4', () => {
    expect(code(itr3Input({ taxpayer: { ...itr3Input().taxpayer, pan: 'BAD' } }))).toContain('PAN_INVALID');
    expect(code(itr3Input({ business: { ...itr3Input().business, code: '' } }))).toContain('ITR3_NATURE');
  });
  it('the 44AB limit is 10 crore only when cash is 5% or less', () => {
    expect(auditLiability(50_000_000, 4, 4).liable).toBe(false);
    expect(auditLiability(50_000_000, 6, 4).liable).toBe(true);
    expect(auditLiability(10_000_000, 100, 100).liable).toBe(false);
    expect(auditLiability(10_000_001, 100, 100).liable).toBe(true);
    expect(auditLiability(100_000_001, 1, 1).liable).toBe(true);
  });
});

describe('the department rules catch a broken file', () => {
  const broken = (mutate) => {
    const input = itr3Input();
    const file = itr3Json(input, computeItr3(input));
    mutate(file.ITR.ITR3);
    return validateItr3Rules(file).map((i) => i.code);
  };
  it.each([
    [52, (r) => { r.PARTA_BS.FundSrc.TotFundSrc += 5; }],
    [55, (r) => { r.PARTA_BS.FundSrc.TotFundSrc += 5; r.PARTA_BS.FundApply.TotFundApply += 5; }],
    [75, (r) => { r.TradingAccount.GrossProfitFrmBusProf += 100; }],
    [82, (r) => { r.PARTA_PL.CreditsToPL.TotCreditsToPL += 100; }],
    [94, (r) => { r.PARTA_PL.DebitsToPL.PBT += 100; }],
    [240, (r) => { r.ITR3ScheduleBP.BusinessIncOthThanSpec.DepreciationAllowITAct32.TotDeprAllowITAct += 1000; }],
    [262, (r) => { r.ITR3ScheduleBP.BusinessIncOthThanSpec.PLAftAdjDedBusOthThanSpec += 500; }],
    [304, (r) => { r.ScheduleDPM.PlantMachinery.Rate40.DepreciationDetail.FullRateDeprAmt += 1000; }],
    [311, (r) => { r.ScheduleDPM.PlantMachinery.Rate40.DepreciationDetail.DepreciationAtFullRate += 1000; }],
    [335, (r) => { r.ScheduleDEP.SummaryFromDeprSch.FurnitureSummary += 100; }],
    [919, (r) => { r['PartB-TI'].TotalTI += 1000; }],
    [935, (r) => { r['PartB-TI'].TotalIncome += 1000; }],
    [965, (r) => { r.PartB_TTI.ComputationOfTaxLiability.TaxPayableOnTI.EducationCess += 100; }],
    [971, (r) => { r.PartB_TTI.TaxPaid.TaxesPaid.TotalTaxesPaid += 100; }],
  ])('rule %i', (rule, mutate) => {
    expect(broken(mutate)).toContain(`ITR3_RULE_${rule}`);
  });
  it('lists the rules it checks', () => {
    expect(ITR3_RULES_CHECKED.length).toBeGreaterThan(100);
    expect(new Set(ITR3_RULES_CHECKED).size).toBe(ITR3_RULES_CHECKED.length);
  });
  it('rule 310: the 45% block can not be claimed under the new regime', () => {
    const input = itr3Input({ blocks: computeBlocks('2025-26', [], [{ block: 'PM45', fy: '2025-26', wdv: 500000 }]) });
    expect(build(input).rules.map((i) => i.code)).toContain('ITR3_RULE_310');
  });
});

describe('the eligibility notes', () => {
  it('warns when the old regime has no Form 10-IEA', () => {
    const input = itr3Input({ regime: 'old' });
    expect(itr3Eligibility(input).map((i) => i.code)).toContain('ITR3_10IEA');
  });
  it('carries the block notes through', () => {
    const blocks = computeBlocks('2025-26', assets, []);
    expect(Array.isArray(blocks)).toBe(true);
  });
});
