// R2.4: advance tax for the year in progress: challan dating (rules 133 / 134), the instalments, what to pay now and
// the interest if nothing more is paid. Expected figures are worked out by hand.
import { describe, expect, it } from 'vitest';
import { challanKind, planAdvanceTax, projectTax } from '../src/index.ts';

const base = {
  fy: '2025-26',
  regime: 'new',
  dob: '1985-06-15',
  tdsExpected: 0,
  challans: [],
  asOf: '2025-10-01',
};
// A professional with ₹40 lakh of receipts: 50% = ₹20 lakh; tax ₹2,12,500 + 4% cess = ₹2,21,000.
const professional = { section: '44ADA', digitalReceipts: 4_000_000, cashReceipts: 0 };
// A trader with ₹1.2 crore of receipts, all digital: 6% = ₹7,20,000.
describe('challans are dated by the department’s rule', () => {
  it('advance tax up to 31 March, self-assessment after, and nothing before the year', () => {
    expect(challanKind('2025-04-01', '2025-26')).toBe('advance');
    expect(challanKind('2026-03-31', '2025-26')).toBe('advance');
    expect(challanKind('2026-04-01', '2025-26')).toBe('self_assessment');
    expect(challanKind('2025-03-31', '2025-26')).toBe('earlier_year');
  });
});

describe('projection', () => {
  it('a 44ADA professional’s tax: ₹20 lakh of income, new regime', () => {
    const p = projectTax({ ...base, business: professional });
    expect(p.businessIncome).toBe(2_000_000);
    expect(p.totalTax).toBe((20_000 + 40_000 + 60_000 + 80_000) * 1.04);
  });
});

describe('a presumptive filer pays all of it on 15 March', () => {
  it('one instalment, nothing due before it', () => {
    const v = planAdvanceTax({ ...base, business: professional, asOf: '2025-10-01' });
    expect(v.mode).toBe('presumptive');
    expect(v.projectedTax).toBe(208_000);
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0]).toMatchObject({
      dueDate: '2026-03-15',
      cumulativeDue: 208_000,
      status: 'upcoming',
    });
    expect(v.payNow).toBe(0);
    expect(v.next).toMatchObject({ dueDate: '2026-03-15', topUp: 208_000 });
  });
  it('after 15 March with half paid: overdue, pay the rest, interest 1% on the shortfall (rule 119A)', () => {
    const v = planAdvanceTax({
      ...base,
      business: professional,
      asOf: '2026-03-20',
      challans: [{ bsr: '0510308', serial: 1, date: '2026-03-10', amount: 104_050 }],
    });
    expect(v.rows[0]).toMatchObject({ status: 'overdue', shortfall: 103_950 });
    expect(v.payNow).toBe(103_950);
    expect(v.interest234C).toBe(1_039); // ₹1,03,950 rounded down to ₹1,03,900 × 1%
    expect(v.interest234B).toMatchObject({ applies: true, shortfall: 103_900 }); // 50% paid: under 90%
    expect(v.interest234B.perMonth).toBe(1_039);
  });
  it('paid in full: nothing to pay and no interest', () => {
    const v = planAdvanceTax({
      ...base,
      business: professional,
      asOf: '2026-03-20',
      challans: [{ bsr: '0510308', serial: 1, date: '2026-03-14', amount: 208_000 }],
    });
    expect(v.rows[0].status).toBe('paid');
    expect(v).toMatchObject({ payNow: 0, interest234C: 0 });
    expect(v.interest234B.applies).toBe(false);
  });
  it('under ₹10,000 after TDS there is no advance tax at all', () => {
    const v = planAdvanceTax({ ...base, business: professional, tdsExpected: 200_000 });
    expect(v.applies).toBe(false);
    expect(v.note).toMatch(/10,000/);
    expect(v.rows).toEqual([]);
  });
});

describe('a filer without presumptive income pays in four instalments', () => {
  const salaryOnly = { ...base, salary: 3_000_000 };
  it('15%, 45%, 75%, 100% of the tax after TDS', () => {
    const v = planAdvanceTax({ ...salaryOnly, tdsExpected: 100_000 });
    expect(v.mode).toBe('regular');
    expect(v.rows.map((r) => [r.dueDate, r.cumulativePct])).toEqual([
      ['2025-06-15', 0.15],
      ['2025-09-15', 0.45],
      ['2025-12-15', 0.75],
      ['2026-03-15', 1],
    ]);
    expect(v.rows[0].cumulativeDue).toBeCloseTo(v.netLiability * 0.15, 1);
  });
  it('on 1 October with nothing paid: two instalments overdue, pay 45% now, interest for both', () => {
    const v = planAdvanceTax({ ...salaryOnly, tdsExpected: 100_000, asOf: '2025-10-01' });
    expect(v.rows.map((r) => r.status)).toEqual(['overdue', 'overdue', 'upcoming', 'upcoming']);
    expect(v.payNow).toBeCloseTo(v.netLiability * 0.45, 1);
    // 234C: 15% by June and 45% by September missed: (15% × 3 + 45% × 3) months of 1%, bases in ₹100s
    const floor = (x) => Math.floor(x / 100) * 100;
    const want = floor(v.netLiability * 0.15) * 0.03 + floor(v.netLiability * 0.45) * 0.03;
    expect(v.interest234C).toBeCloseTo(want, 0);
  });
  it('a payment before an instalment counts toward it; the 36% waiver does not save a September shortfall', () => {
    // ₹30 lakh salary: taxable ₹29,25,000 after the ₹75,000 standard deduction; tax ₹3,00,000 + 30% of ₹5,25,000 = ₹4,57,500,
    // cess ₹18,300, total ₹4,75,800; after ₹1,00,000 TDS ₹3,75,800 is the liability.
    const v = planAdvanceTax({
      ...salaryOnly,
      tdsExpected: 100_000,
      asOf: '2025-10-01',
      challans: [{ bsr: '0510308', serial: 7, date: '2025-06-10', amount: 120_000 }],
    });
    expect(v.projectedTax).toBe(475_800);
    expect(v.netLiability).toBe(375_800);
    expect(v.rows[0]).toMatchObject({ status: 'paid', paidByDate: 120_000 }); // 15% is ₹56,370
    // By 15 September 45% = ₹1,69,110 was due; ₹1,20,000 is 31.9%, under the 36% waiver (₹1,35,288).
    expect(v.rows[1]).toMatchObject({
      status: 'overdue',
      cumulativeDue: 169_110,
      shortfall: 49_110,
    });
    // 234C: ₹49,110 rounded down to ₹49,100, 1% for three months
    expect(v.interest234C).toBe(1_473);
  });
});

describe('challans of another year are set aside', () => {
  it('one dated before 1 April is not advance tax for this year', () => {
    const v = planAdvanceTax({
      ...base,
      business: professional,
      challans: [{ bsr: '0510308', serial: 1, date: '2025-03-15', amount: 50_000 }],
    });
    expect(v.ignored).toHaveLength(1);
    expect(v.paidAdvance).toBe(0);
  });
  it('after the year, tax paid is self-assessment and is shown apart', () => {
    const v = planAdvanceTax({
      ...base,
      asOf: '2026-05-01',
      business: professional,
      challans: [{ bsr: '0510308', serial: 1, date: '2026-04-20', amount: 30_000 }],
    });
    expect(v.paidAdvance).toBe(0);
    expect(v.paidAfterYear).toBe(30_000);
  });
});
