// R2.3: ITR-4 for AY 2026-27. Every return built here is checked three ways: the builder's own eligibility and input
// checks, the department's cross-field rules (itr4Rules.ts) and the department's published JSON schema (itr4Schema.ts).
// Expected figures are worked out by hand from the law, not from the code under test.
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

const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};

const taxpayer = (over = {}) => ({
  pan: 'ABCPK1234F',
  firstName: 'Ravi',
  surname: 'Kumar',
  fatherName: 'Suresh Kumar',
  dob: '1985-06-15',
  residenceNo: '12',
  residenceName: 'Lakshmi Nagar',
  roadOrStreet: '3rd Cross Street',
  locality: 'Adyar',
  city: 'Chennai',
  stateCode: '33',
  pinCode: '600020',
  mobile: '9876543210',
  email: 'ravi@example.com',
  employerCategory: 'NA',
  bankAccounts: [
    {
      ifsc: 'HDFC0000123',
      bankName: 'HDFC Bank',
      accountNo: '50100123456789',
      accountType: 'SB',
      useForRefund: true,
    },
  ],
  place: 'Chennai',
  ...over,
});
const declarations = (over = {}) => ({
  houseProperty: false,
  capitalGains: false,
  foreignAssetsOrIncome: false,
  companyDirector: false,
  unlistedShares: false,
  carriedForwardLoss: false,
  agriculturalIncomeOver5000: false,
  section44AE: false,
  ...over,
});
const particulars = {
  sundryCreditors: 200000,
  inventories: 500000,
  sundryDebtors: 300000,
  balWithBanks: 150000,
  cashInHand: 50000,
  partnerMemberOwnCapital: 700000,
  fixedAssets: 0,
  otherAssets: 0,
};
/** A fixed point in time: after the AY 2026-27 due date of 31 August 2026. */
const LATE = '2026-11-16';
const ON_TIME = '2026-08-20';

// A trader, 44AD: ₹55 lakh by bank and ₹5 lakh in cash.
const trader = (over = {}) => ({
  fy: '2025-26',
  filedOn: ON_TIME,
  regime: 'new',
  taxpayer: taxpayer(),
  business: {
    section: '44AD',
    code: '09002',
    name: 'Kumar General Stores',
    digitalReceipts: 5_500_000,
    cashReceipts: 500_000,
    gstTurnover: [{ gstin: gstin('33ABCPK1234F1Z'), amount: 6_000_000 }],
    particulars,
  },
  otherSources: { savingsInterest: 12_000, depositInterest: 20_000 },
  declarations: declarations(),
  ...over,
});

/** The three checks on one return. */
function check(input) {
  const rules = itrRulesFor(input.fy);
  const c = computeItr4(input, rules);
  const json = itr4Json(input, c, rules);
  return {
    c,
    json,
    eligibility: itr4Eligibility(input, rules).filter((i) => i.severity === 'error'),
    inputs: itr4InputChecks(input),
    rules: validateItr4Rules(json, rules),
    schema: validateItr4Schema(json, rules.itr4SchemaAy),
  };
}
const messages = (list) => list.map((i) => `${i.code} ${i.message}`);

describe('a trader on the new regime (44AD)', () => {
  const r = check(trader());
  it('presumptive income is 6% of the bank receipts and 8% of the cash', () => {
    // 55,00,000 × 6% = 3,30,000; 5,00,000 × 8% = 40,000
    expect(r.c.businessIncome).toBe(370_000);
    expect(r.c.incomeOtherSources).toBe(32_000);
    expect(r.c.grossTotalIncome).toBe(402_000);
  });
  it('total income ₹4,02,000: slab tax ₹100 on the ₹2,000 above ₹4 lakh, wiped out by the 87A rebate', () => {
    expect(r.c.totalIncome).toBe(402_000);
    expect(r.c.taxOnTotalIncome).toBe(100);
    expect(r.c.rebate87A).toBe(100);
    expect(r.c.taxAfterRebate).toBe(0);
    expect(r.c.cess).toBe(0);
    expect(r.c.netTaxLiability).toBe(0);
  });
  it('filed in time: no late fee, filing section 11', () => {
    expect(r.c).toMatchObject({ late: false, fee234F: 0, returnFileSection: 11, interest234A: 0 });
  });
  it('passes the builder, the department’s rules and the official schema', () => {
    expect(messages(r.eligibility)).toEqual([]);
    expect(messages(r.inputs)).toEqual([]);
    expect(messages(r.rules.filter((i) => i.severity === 'error'))).toEqual([]);
    expect(messages(r.schema)).toEqual([]);
  });
  it('the file carries the schema’s structure', () => {
    const d = r.json.ITR.ITR4;
    expect(d.Form_ITR4).toMatchObject({ FormName: 'ITR-4', AssessmentYear: '2026' });
    expect(d.ScheduleBP.PersumptiveInc44AD).toMatchObject({
      GrsTotalTrnOver: 6_000_000,
      PersumptiveInc44AD6Per: 330_000,
      PersumptiveInc44AD8Per: 40_000,
      TotPersumptiveInc44AD: 370_000,
    });
    expect(d.FilingStatus).toMatchObject({
      ReturnFileSec: 11,
      F10IEACurrAYOldRegime: 'N',
      ItrFilingDueDate: '2026-08-31',
    });
    expect(d.IncomeDeductions.OthersInc.OthersIncDtlsOthSrc.map((x) => x.OthSrcNatureDesc)).toEqual(
      ['SAV', 'IFD'],
    );
  });
});

describe('TDS and a refund', () => {
  it('₹10,000 TDS on a nil tax is refunded, rounded to ten rupees', () => {
    const r = check(
      trader({
        tds: [
          {
            tan: 'CHEA12345B',
            name: 'Acme Contractors',
            section: '94C',
            gross: 500_000,
            tdsDeducted: 10_005,
            tdsClaimed: 10_005,
            headOfIncome: 'BP',
          },
        ],
      }),
    );
    expect(r.c.tdsTotal).toBe(10_005);
    expect(r.c.refundDue).toBe(10_010); // 288B: ₹10,005 to the nearest ten
    expect(r.c.balanceTaxPayable).toBe(0);
    expect(messages(r.rules.filter((i) => i.severity === 'error'))).toEqual([]);
    expect(messages(r.schema)).toEqual([]);
    expect(r.json.ITR.ITR4.TDSonOthThanSals.TotalTDSonOthThanSals).toBe(10_005);
  });
});

describe('a professional (44ADA) with tax to pay, filed late', () => {
  // ₹40 lakh of receipts, all digital: 50% is ₹20 lakh. Plus ₹50,000 of deposit interest.
  const input = trader({
    filedOn: LATE,
    business: {
      section: '44ADA',
      code: '16001',
      name: 'Kumar & Associates, advocates',
      digitalReceipts: 4_000_000,
      cashReceipts: 0,
      particulars,
    },
    otherSources: { depositInterest: 50_000 },
    challans: [{ bsr: '0510308', date: '2026-03-14', serial: 12345, amount: 100_000 }],
  });
  const r = check(input);
  it('works out the new-regime tax slab by slab', () => {
    expect(r.c.totalIncome).toBe(2_050_000);
    // 4–8L 5% = 20,000; 8–12L 10% = 40,000; 12–16L 15% = 60,000; 16–20L 20% = 80,000; 20–20.5L 25% = 12,500
    expect(r.c.taxOnTotalIncome).toBe(212_500);
    expect(r.c.rebate87A).toBe(0);
    expect(r.c.cess).toBe(8_500);
    expect(r.c.netTaxLiability).toBe(221_000);
  });
  it('a challan dated before 1 April is advance tax and a presumptive filer owes interest for the single March instalment', () => {
    expect(r.c.advanceTaxPaid).toBe(100_000);
    expect(r.c.selfAssessmentTaxPaid).toBe(0);
    // Paid ₹1,00,000 of ₹2,21,000 by 15 March: shortfall ₹1,21,000 (already a multiple of ₹100 for rule 119A), 1% for one month
    expect(r.c.interest234C).toBe(1210);
  });
  it('filed after 31 August: late fee ₹5,000, section 139(4), interest under 234A', () => {
    expect(r.c).toMatchObject({ late: true, fee234F: 5000, returnFileSection: 12 });
    expect(r.c.interest234A).toBeGreaterThan(0);
    expect(r.json.ITR.ITR4.FilingStatus.ReturnFileSec).toBe(12);
    expect(r.json.ITR.ITR4.TaxComputation.IntrstPay.LateFilingFee234F).toBe(5000);
  });
  it('the totals add up and pass every check', () => {
    expect(r.c.totalTaxAndInterest).toBe(
      r.c.netTaxLiability + r.c.interest234A + r.c.interest234B + r.c.interest234C + r.c.fee234F,
    );
    expect(r.c.balanceTaxPayable % 10).toBe(0);
    expect(messages(r.eligibility)).toEqual([]);
    expect(messages(r.inputs)).toEqual([]);
    expect(messages(r.rules.filter((i) => i.severity === 'error'))).toEqual([]);
    expect(messages(r.schema)).toEqual([]);
  });
});

describe('marginal relief just above ₹12 lakh (new regime)', () => {
  it('₹12,10,000 pays ₹10,000 of tax, not ₹61,500', () => {
    const r = check(
      trader({
        business: {
          section: '44ADA',
          code: '16001',
          name: 'Consultant',
          digitalReceipts: 2_420_000,
          cashReceipts: 0,
          particulars,
        },
        otherSources: {},
      }),
    );
    expect(r.c.totalIncome).toBe(1_210_000);
    expect(r.c.taxOnTotalIncome).toBe(61_500);
    expect(r.c.taxAfterRebate).toBe(10_000);
    expect(r.c.cess).toBe(400);
    expect(messages(r.rules.filter((i) => i.severity === 'error'))).toEqual([]);
    expect(messages(r.schema)).toEqual([]);
  });
});

describe('salary together with presumptive income', () => {
  it('the standard deduction is ₹75,000 in the new regime and ₹50,000 in the old', () => {
    const base = trader({
      salary: {
        gross: 600_000,
        basicAndDa: 300_000,
        tds: [{ tan: 'CHEA12345B', name: 'Employer Pvt Ltd', income: 600_000, tds: 20_000 }],
      },
      taxpayer: taxpayer({ employerCategory: 'OTH' }),
    });
    const n = check(base);
    expect(n.c.standardDeduction).toBe(75_000);
    expect(n.c.incomeFromSalary).toBe(525_000);
    expect(messages(n.rules.filter((i) => i.severity === 'error'))).toEqual([]);
    expect(messages(n.schema)).toEqual([]);
    const o = check({
      ...base,
      regime: 'old',
      form10IEA: { ack: '123456789012345', filedOn: '2026-07-01' },
    });
    expect(o.c.standardDeduction).toBe(50_000);
    expect(messages(o.schema)).toEqual([]);
    expect(messages(o.rules.filter((i) => i.severity === 'error'))).toEqual([]);
  });
  it('80CCD(2) is capped at 14% of salary in the new regime', () => {
    const r = check(
      trader({
        salary: { gross: 600_000, basicAndDa: 300_000 },
        taxpayer: taxpayer({ employerCategory: 'OTH' }),
        deductions: { sec80CCD2: 100_000 },
      }),
    );
    expect(r.c.allowed['80CCD2']).toBe(42_000);
    expect(r.json.ITR.ITR4.IncomeDeductions.DeductUndChapVIA.Section80CCDEmployer).toBe(42_000);
    expect(r.json.ITR.ITR4.IncomeDeductions.UsrDeductUndChapVIA.Section80CCDEmployer).toBe(100_000);
    expect(messages(r.schema)).toEqual([]);
  });
});

describe('the old regime', () => {
  const old = (over = {}) =>
    trader({
      regime: 'old',
      form10IEA: { ack: '123456789012345', filedOn: '2026-07-01' },
      deductions: {
        sec80C: [
          { id: 'LIC-998877', amount: 100_000 },
          { id: 'PPF-4455', amount: 80_000 },
        ],
        sec80CCD1B: 60_000,
        sec80D: {
          selfPremiums: [{ insurer: 'Star Health', policy: 'P/123/456', amount: 18_000 }],
          selfCheckup: 6_000,
          parentsSenior: true,
          parentsPremiums: [{ insurer: 'Care Health', policy: 'C-778', amount: 55_000 }],
        },
      },
      ...over,
    });
  const r = check(old());
  it('caps 80C at ₹1.5 lakh, 80CCD(1B) at ₹50,000, 80D at ₹25,000 + ₹50,000, and takes 80TTA on savings interest', () => {
    // 80D: self 18,000 premium + 5,000 of the 6,000 check-up (cap 5,000) = 23,000; parents (senior) 55,000 capped at 50,000
    expect(r.c.allowed).toMatchObject({
      '80C': 150_000,
      '80CCD1B': 50_000,
      '80D': 73_000,
      '80TTA': 10_000,
    });
    expect(r.c.totalDeductions).toBe(150_000 + 50_000 + 73_000 + 10_000);
  });
  it('slab tax on the old slabs after the deductions, and Form 10-IEA is recorded', () => {
    // GTI 4,02,000 − 2,83,000 = 1,19,000: below the ₹2.5 lakh exemption
    expect(r.c.totalIncome).toBe(119_000);
    expect(r.c.taxOnTotalIncome).toBe(0);
    expect(r.json.ITR.ITR4.FilingStatus).toMatchObject({
      F10IEACurrAYOldRegime: 'Y',
      F10IEAAckNoCurrAYOldTax: 123456789012345,
      F10IEADateCurrAYOldTax: '2026-07-01',
    });
    expect(r.json.ITR.ITR4.Schedule80C.TotalAmt).toBe(180_000);
    expect(r.json.ITR.ITR4.Schedule80D.Sec80DSelfFamSrCtznHealth.EligibleAmountOfDedn).toBe(73_000);
  });
  it('passes every check', () => {
    expect(messages(r.inputs)).toEqual([]);
    expect(messages(r.rules.filter((i) => i.severity === 'error'))).toEqual([]);
    expect(messages(r.schema)).toEqual([]);
  });
  it('without the Form 10-IEA details the old regime is refused', () => {
    expect(messages(check(old({ form10IEA: undefined })).inputs).join()).toMatch(/FORM_10IEA/);
  });
});

describe('what ITR-4 can not take', () => {
  it.each([
    ['houseProperty', 'house property'],
    ['capitalGains', 'Capital gains'],
    ['foreignAssetsOrIncome', 'Foreign'],
    ['companyDirector', 'director'],
    ['unlistedShares', 'unlisted'],
    ['carriedForwardLoss', 'losses'],
    ['agriculturalIncomeOver5000', 'Agricultural'],
    ['section44AE', '44AE'],
  ])('%s is refused', (flag, text) => {
    const list = check(trader({ declarations: declarations({ [flag]: true }) })).eligibility;
    expect(
      list.some((i) => i.code === 'ITR4_NOT_ELIGIBLE' && new RegExp(text, 'i').test(i.message)),
    ).toBe(true);
  });
  it('turnover above the 44AD ceiling and income below the presumptive minimum are refused', () => {
    // Above ₹3 crore, or above ₹2 crore with more than 5% in cash: books, audit and ITR-3.
    expect(
      check(
        trader({
          business: { ...trader().business, digitalReceipts: 31_000_000, cashReceipts: 0 },
        }),
      ).eligibility.map((i) => i.code),
    ).toContain('PRESUMPTIVE_LIMIT');
    expect(
      check(
        trader({
          business: { ...trader().business, digitalReceipts: 18_000_000, cashReceipts: 4_000_000 },
        }),
      ).eligibility.map((i) => i.code),
    ).toContain('PRESUMPTIVE_LIMIT');
    expect(
      check(
        trader({
          business: { ...trader().business, digitalReceipts: 25_000_000, cashReceipts: 100_000 },
        }),
      ).eligibility,
    ).toEqual([]); // 0.4% cash: the ₹3 crore ceiling applies
    expect(
      check(
        trader({ business: { ...trader().business, declaredIncome: 100_000 } }),
      ).eligibility.map((i) => i.code),
    ).toContain('BELOW_PRESUMPTIVE');
  });
  it('receipts below the GST turnover are a warning (the department compares the two)', () => {
    const w = itr4Eligibility(
      trader({
        business: {
          ...trader().business,
          gstTurnover: [{ gstin: gstin('33ABCPK1234F1Z'), amount: 9_000_000 }],
        },
      }),
    );
    expect(w.map((i) => i.code)).toContain('GST_TURNOVER_MISMATCH');
    expect(itr4Eligibility(trader()).map((i) => i.code)).not.toContain('GST_TURNOVER_MISMATCH');
  });
  it('a year whose ITR-4 schema is not published yet can not be built', () => {
    expect(itr4Eligibility(trader({ fy: '2026-27' })).map((i) => i.code)).toContain(
      'ITR4_NO_SCHEMA',
    );
  });
  it('a company PAN is not an individual’s', () => {
    expect(
      check(trader({ taxpayer: taxpayer({ pan: 'ABCCK1234F' }) })).inputs.map((i) => i.code),
    ).toContain('PAN_NOT_INDIVIDUAL');
  });
});

describe('the department’s rules catch a tampered file', () => {
  const good = check(
    trader({
      tds: [
        {
          tan: 'CHEA12345B',
          name: 'Acme',
          section: '94C',
          gross: 500_000,
          tdsDeducted: 10_000,
          tdsClaimed: 10_000,
          headOfIncome: 'BP',
        },
      ],
    }),
  );
  const tamper = (mutate) => {
    const copy = structuredClone(good.json);
    mutate(copy.ITR.ITR4);
    return validateItr4Rules(copy)
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
  };
  it.each([
    [
      '6% rule',
      (d) => {
        d.ScheduleBP.PersumptiveInc44AD.PersumptiveInc44AD6Per = 1;
        d.ScheduleBP.PersumptiveInc44AD.TotPersumptiveInc44AD = 40_001;
        d.IncomeDeductions.IncomeFromBusinessProf = 40_001;
      },
      'R5',
    ],
    [
      'business income differs from Schedule BP',
      (d) => {
        d.IncomeDeductions.IncomeFromBusinessProf += 1;
      },
      'R2',
    ],
    [
      'gross total income',
      (d) => {
        d.IncomeDeductions.GrossTotIncome += 1000;
      },
      'R196',
    ],
    [
      'tax after rebate',
      (d) => {
        d.TaxComputation.TaxPayableOnRebate += 1;
      },
      'R52',
    ],
    [
      'total fee and interest',
      (d) => {
        d.TaxComputation.TotTaxPlusIntrstPay += 7;
      },
      'R54',
    ],
    [
      'TDS total',
      (d) => {
        d.TaxPaid.TaxesPaid.TDS += 5;
      },
      'R131',
    ],
    [
      'refund',
      (d) => {
        d.Refund.RefundDue += 50;
      },
      'R128',
    ],
    [
      'new regime and 80C',
      (d) => {
        d.IncomeDeductions.DeductUndChapVIA.Section80C = 5;
        d.IncomeDeductions.DeductUndChapVIA.TotalChapVIADeductions = 5;
      },
      'R183',
    ],
    [
      'TDS claimed above income',
      (d) => {
        d.TDSonOthThanSals.TDSonOthThanSalDtls[0].GrossAmount = 1;
      },
      'R117',
    ],
    [
      'wrong due date',
      (d) => {
        d.FilingStatus.ItrFilingDueDate = '2026-07-31';
      },
      'R234',
    ],
    [
      'wrong filing section',
      (d) => {
        d.FilingStatus.ReturnFileSec = 12;
      },
      'FILING_SEC',
    ],
    [
      'total income not rounded',
      (d) => {
        d.IncomeDeductions.TotalIncome += 3;
        d.IncomeDeductions.GrossTotIncome += 3;
        d.IncomeDeductions.GrossTotIncomeIncLTCG112A += 3;
      },
      'R288A',
    ],
  ])('%s', (_name, mutate, code) => {
    expect(tamper(mutate)).toContain(code);
  });
});

describe('the official schema refuses what is out of shape', () => {
  const good = check(trader());
  const bad = (mutate) => {
    const copy = structuredClone(good.json);
    mutate(copy.ITR.ITR4);
    return validateItr4Schema(copy).map((i) => i.message);
  };
  it('a decimal amount (the schema takes whole rupees)', () => {
    expect(
      bad((d) => {
        d.IncomeDeductions.GrossTotIncome = 402_000.5;
      }).join(),
    ).toMatch(/GrossTotIncome/);
  });
  it('a field the schema does not know', () => {
    expect(
      bad((d) => {
        d.Extra = 1;
      }).join(),
    ).toMatch(/additional properties "Extra"|Extra/);
  });
  it('a PAN with trailing text (patterns match the whole value)', () => {
    expect(
      bad((d) => {
        d.PersonalInfo.PAN = 'ABCPK1234FX';
      }).join(),
    ).toMatch(/PAN/);
  });
  it('a business code that is not on the list', () => {
    expect(
      bad((d) => {
        d.ScheduleBP.NatOfBus44AD[0].CodeAD = '99999';
      }).join(),
    ).toMatch(/CodeAD/);
  });
  it('a missing required section', () => {
    expect(
      bad((d) => {
        delete d.Verification;
      }).join(),
    ).toMatch(/Verification/);
  });
  it('the whole return missing', () => {
    expect(validateItr4Schema({ ITR: {} }).length).toBeGreaterThan(0);
  });
});
