import { describe, expect, it } from 'vitest';
import { DEDUCTOR_SECTIONS, panHolderKind, quarterRegister, registerCsv, statementDueDate, statementLateFee, tdsToDeduct, validPan } from '../src/tdsDeductor.ts';

const ask = (o) => ({ section: '194C', amount: 0, paidBefore: 0, deductedBefore: 0, pan: 'ABCPK1234F', ...o });

describe('PAN', () => {
  it('knows a valid one and who holds it', () => {
    expect(validPan('abcpk1234f')).toBe(true);
    expect(validPan('ABC123')).toBe(false);
    expect(panHolderKind('ABCPK1234F')).toBe('individual');
    expect(panHolderKind('ABCCK1234F')).toBe('other');
    expect(panHolderKind('')).toBe('unknown');
  });
});

describe('what to deduct', () => {
  it('194C: a payment over 30,000 is deducted at 1% for an individual and 2% for a company', () => {
    expect(tdsToDeduct(ask({ amount: 40000 }))).toMatchObject({ deduct: true, rate: 1, tds: 400 });
    expect(tdsToDeduct(ask({ amount: 40000, pan: 'ABCCK1234F' }))).toMatchObject({ rate: 2, tds: 800 });
  });
  it('194C: small payments are free until the year passes 1,00,000, then the whole year is caught', () => {
    expect(tdsToDeduct(ask({ amount: 20000 })).deduct).toBe(false);
    expect(tdsToDeduct(ask({ amount: 20000, paidBefore: 70000 })).deduct).toBe(false); // 90,000 so far
    const d = tdsToDeduct(ask({ amount: 20000, paidBefore: 90000 })); // 1,10,000 so far
    expect(d).toMatchObject({ deduct: true, tds: 1100, paidToDate: 110000 });
    expect(d.reason).toMatch(/passed 100000/);
  });
  it('after that, each payment is deducted on its own, less nothing twice', () => {
    expect(tdsToDeduct(ask({ amount: 10000, paidBefore: 110000, deductedBefore: 1100 })).tds).toBe(100);
  });
  it('194J: nothing until 50,000 a year, then 10% of all of it', () => {
    expect(tdsToDeduct(ask({ section: '194J', amount: 30000 })).deduct).toBe(false);
    expect(tdsToDeduct(ask({ section: '194J', amount: 30000, paidBefore: 30000 }))).toMatchObject({ deduct: true, tds: 6000 });
  });
  it('without a valid PAN the rate is at least 20%', () => {
    expect(tdsToDeduct(ask({ amount: 40000, pan: '' }))).toMatchObject({ rate: 20, tds: 8000, panMissing: true });
    expect(tdsToDeduct(ask({ section: '194J', amount: 60000, pan: 'bad' })).rate).toBe(20);
  });
  it('a lower-deduction certificate lowers the rate, but only with a valid PAN', () => {
    expect(tdsToDeduct(ask({ section: '194J', amount: 100000, lowerRate: 2 })).tds).toBe(2000);
    expect(tdsToDeduct(ask({ section: '194J', amount: 100000, lowerRate: 2, pan: '' })).rate).toBe(20);
  });
  it('rent: 6,00,000 a year before 194I applies', () => {
    expect(tdsToDeduct(ask({ section: '194I', amount: 50000, paidBefore: 500000 })).deduct).toBe(false);
    expect(tdsToDeduct(ask({ section: '194I', amount: 50000, paidBefore: 560000 }))).toMatchObject({ deduct: true, tds: 61000 });
  });
  it('refuses an unknown section instead of guessing', () => {
    expect(tdsToDeduct(ask({ section: '999', amount: 1e6 })).deduct).toBe(false);
    expect(DEDUCTOR_SECTIONS.every((s) => s.rateIndividual >= 0 && s.annualThreshold + s.singleThreshold > 0)).toBe(true);
  });
});

describe('statement dates and the late fee', () => {
  it('has the four due dates', () => {
    expect(statementDueDate('2026-27', 'Q1')).toBe('2026-07-31');
    expect(statementDueDate('2026-27', 'Q3')).toBe('2027-01-31');
    expect(statementDueDate('2026-27', 'Q4')).toBe('2027-05-31');
  });
  it('charges 200 a day, never more than the TDS', () => {
    expect(statementLateFee({ dueDate: '2026-07-31', filedOn: '2026-07-31', asOf: '2026-12-01', tdsTotal: 5000 })).toEqual({ days: 0, fee: 0, late: false });
    expect(statementLateFee({ dueDate: '2026-07-31', filedOn: '2026-08-10', asOf: '2026-12-01', tdsTotal: 5000 })).toEqual({ days: 10, fee: 2000, late: true });
    expect(statementLateFee({ dueDate: '2026-07-31', filedOn: null, asOf: '2026-09-30', tdsTotal: 5000 }).fee).toBe(5000);
  });
});

describe('the quarter register', () => {
  const e = (o) => ({ id: Math.random().toString(), partyName: 'Asha', pan: 'ABCPK1234F', section: '194C', baseAmount: 40000, rate: 1, tdsAmount: 400, date: '2026-05-10', status: 'deposited', challanNo: '123', bsrCode: '0510308', challanDate: '2026-06-05', ...o });
  const reg = quarterRegister([
    e({}), e({ id: 'b', date: '2026-06-20', tdsAmount: 400, challanNo: '124', challanDate: '2026-07-07' }),
    e({ id: 'c', partyName: 'Ravi', pan: '', tdsAmount: 8000, baseAmount: 40000, rate: 20, status: 'accrued', challanNo: null, challanDate: null, date: '2026-06-25' }),
    e({ id: 'd', date: '2026-08-01' }), // another quarter
  ], { fy: '2026-27', quarter: 'Q1', asOf: '2026-09-15' });
  it('keeps only the quarter and groups by deductee and challan', () => {
    expect(reg.rows).toHaveLength(3);
    expect(reg.from).toBe('2026-04-01');
    expect(reg.to).toBe('2026-06-30');
    expect(reg.deductees).toHaveLength(2);
    expect(reg.deductees.find((d) => d.partyName === 'Asha')).toMatchObject({ payments: 2, tds: 800 });
    expect(reg.challans.map((c) => c.challanNo).sort()).toEqual(['123', '124']);
  });
  it('totals, interest and the problems to fix', () => {
    expect(reg.totals).toMatchObject({ tds: 8800, deposited: 800, undeposited: 8000 });
    expect(reg.totals.interest).toBeGreaterThan(0);
    expect(reg.issues.join(' ')).toMatch(/without a valid PAN/);
    expect(reg.issues.join(' ')).toMatch(/not deposited/);
    expect(reg.issues.join(' ')).toMatch(/234E/);
    expect(reg.rows.find((r) => r.id === 'c').flags).toEqual(['PAN missing or invalid', 'Not deposited, overdue']);
  });
  it('writes a CSV of both lists', () => {
    const csv = registerCsv(reg);
    expect(csv).toContain('"Asha","ABCPK1234F","194C",2,80000,800');
    expect(csv).toContain('"123","0510308","2026-06-05",400,1');
  });
});
