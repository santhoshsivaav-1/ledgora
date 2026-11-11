// Vyapar parity P5-S5: loan maths (docs/VYAPAR_IMPLEMENTATION_PHASES.md, "Phase 5 test plan": emi 6, schedule 8,
// applyPayment 6).
import { describe, it, expect } from 'vitest';
import {
  LoanError,
  addMonths,
  applyPayment,
  buildSchedule,
  emi,
  emisDueWithin,
  nextDue,
  outstandingOf,
  scheduleFor,
  totalInterest,
} from '../src/index.ts';

const sumP = (s) => Math.round(s.reduce((t, r) => t + r.principalPart, 0) * 100) / 100;
const TERM = { principal: 1000000, ratePct: 12, months: 12, firstEmiDate: '2026-05-05' };

describe('emi', () => {
  it('textbook case: ₹10,00,000 at 12% for 12 months is ₹88,848.79', () => {
    expect(emi(TERM)).toBe(88848.79);
  });
  it('flat: (P + P·rate·years) / months', () => {
    expect(emi({ principal: 120000, ratePct: 10, months: 12, type: 'flat' })).toBe(11000);
    expect(emi({ principal: 100000, ratePct: 12, months: 24, type: 'flat' })).toBe(5166.67);
  });
  it('zero interest is principal over months', () => {
    expect(emi({ principal: 1000, ratePct: 0, months: 3 })).toBe(333.33);
  });
  it('a long reducing loan', () => {
    // ₹50,00,000 at 8.5% for 20 years: the usual home-loan example, ₹43,391.16.
    expect(emi({ principal: 5000000, ratePct: 8.5, months: 240 })).toBe(43391.16);
  });
  it('nothing to repay is 0', () => {
    expect(emi({ principal: 0, ratePct: 12, months: 12 })).toBe(0);
    expect(emi({ principal: 1000, ratePct: 12, months: 0 })).toBe(0);
  });
  it('reads numbers given as strings', () => {
    expect(emi({ principal: '1000000', ratePct: '12', months: 12 })).toBe(88848.79);
  });
});

describe('buildSchedule', () => {
  it('reducing: the first row is the guide’s (interest ₹10,000, principal ₹78,848.79)', () => {
    const s = buildSchedule(TERM);
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({
      n: 1,
      dueDate: '2026-05-05',
      interestPart: 10000,
      principalPart: 78848.79,
      balanceAfter: 921151.21,
      status: 'due',
    });
  });
  it('Σ principal is exactly the principal and the last balance is 0', () => {
    const s = buildSchedule(TERM);
    expect(sumP(s)).toBe(1000000);
    expect(s.at(-1).balanceAfter).toBe(0);
  });
  it('total interest matches EMI × n − principal within the last row’s rounding', () => {
    const s = buildSchedule(TERM);
    expect(Math.abs(totalInterest(s) - (88848.79 * 12 - 1000000))).toBeLessThan(0.05);
  });
  it('flat: equal rows, interest per the formula, last row absorbs rounding', () => {
    const s = buildSchedule({
      principal: 100000,
      ratePct: 12,
      months: 24,
      type: 'flat',
      firstEmiDate: '2026-01-31',
    });
    expect(sumP(s)).toBe(100000);
    expect(totalInterest(s)).toBe(24000);
    expect(s[1].dueDate).toBe('2026-02-28');
  });
  it('rounding: Σ principal stays exact for awkward numbers (property over 200 cases)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      const loan = {
        principal: Math.round(rnd() * 5000000 * 100) / 100 + 1000,
        ratePct: Math.round(rnd() * 2400) / 100,
        months: 1 + Math.floor(rnd() * 120),
        type: rnd() < 0.3 ? 'flat' : 'reducing',
        firstEmiDate: '2026-04-30',
      };
      const s = buildSchedule(loan);
      expect(sumP(s), JSON.stringify(loan)).toBe(Math.round(loan.principal * 100) / 100);
      expect(s.at(-1).balanceAfter).toBe(0);
      for (const r of s) expect(r.principalPart).toBeGreaterThanOrEqual(0);
    }
  });
  it('an EMI the owner typed is used; a bigger one finishes early', () => {
    const s = buildSchedule({ ...TERM, emi: 100000 });
    expect(s.length).toBeLessThan(12);
    expect(sumP(s)).toBe(1000000);
  });
  it('an EMI that does not cover the interest is refused', () => {
    expect(() => buildSchedule({ ...TERM, emi: 5000 })).toThrow(LoanError);
  });
  it('dates step a month, keeping the day where the month has it', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-15', 2)).toBe('2028-02-15');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});

describe('applyPayment', () => {
  const base = buildSchedule(TERM);
  it('an EMI as prefilled marks the row paid and leaves the rest alone', () => {
    const due = nextDue(base);
    expect(due).toMatchObject({ n: 1, principal: 78848.79, interest: 10000 });
    const r = applyPayment(TERM, base, {
      date: '2026-05-05',
      kind: 'emi',
      principal: due.principal,
      interest: due.interest,
    });
    expect(r.schedule[0]).toMatchObject({ status: 'paid', paidOn: '2026-05-05' });
    expect(r.schedule.slice(1)).toEqual(base.slice(1));
    expect(r.outstanding).toBe(921151.21);
  });
  it('a smaller EMI leaves the row part-paid, and the next payment finishes it', () => {
    let r = applyPayment(TERM, base, {
      date: '2026-05-05',
      kind: 'emi',
      principal: 50000,
      interest: 10000,
    });
    expect(r.schedule[0].status).toBe('part');
    expect(nextDue(r.schedule)).toMatchObject({ n: 1, principal: 28848.79, interest: 0 });
    r = applyPayment(TERM, r.schedule, {
      date: '2026-05-20',
      kind: 'emi',
      principal: 28848.79,
      interest: 0,
    });
    expect(r.schedule[0].status).toBe('paid');
    expect(r.outstanding).toBe(921151.21);
  });
  it('prepayment keeping the EMI shortens the tenure; Σ principal + prepaid = principal', () => {
    let r = applyPayment(TERM, base, {
      date: '2026-05-05',
      kind: 'emi',
      principal: 78848.79,
      interest: 10000,
    });
    r = applyPayment(
      TERM,
      r.schedule,
      { date: '2026-05-10', kind: 'prepay', principal: 300000 },
      r.prepaid,
    );
    expect(r.schedule.length).toBeLessThan(12);
    expect(r.schedule.filter((x) => x.status === 'due')[0].emi).toBeLessThanOrEqual(88848.79);
    expect(Math.round((sumP(r.schedule) + r.prepaid) * 100) / 100).toBe(1000000);
    expect(r.schedule.at(-1).balanceAfter).toBe(0);
  });
  it('part payment keeping the tenure lowers the EMI', () => {
    let r = applyPayment(TERM, base, {
      date: '2026-05-05',
      kind: 'emi',
      principal: 78848.79,
      interest: 10000,
    });
    r = applyPayment(
      TERM,
      r.schedule,
      { date: '2026-05-10', kind: 'part', principal: 200000, reschedule: 'emi' },
      r.prepaid,
    );
    expect(r.schedule).toHaveLength(12);
    expect(r.schedule[1].emi).toBeLessThan(88848.79);
    expect(Math.round((sumP(r.schedule) + r.prepaid) * 100) / 100).toBe(1000000);
  });
  it('paying it all off closes the loan; paying more is refused', () => {
    const r = applyPayment(TERM, base, { date: '2026-05-10', kind: 'prepay', principal: 1000000 });
    expect(r).toMatchObject({ outstanding: 0, closed: true });
    expect(r.schedule.filter((x) => x.status === 'due')).toHaveLength(0);
    expect(() =>
      applyPayment(TERM, base, { date: '2026-05-10', kind: 'prepay', principal: 1000000.5 }),
    ).toThrow(LoanError);
  });
  it('scheduleFor replays payments in date order; the ledger balance equals the schedule balance', () => {
    const pays = [
      { date: '2026-06-05', kind: 'emi', principal: 79637.28, interest: 9211.51 },
      { date: '2026-05-05', kind: 'emi', principal: 78848.79, interest: 10000 },
    ];
    const r = scheduleFor(TERM, pays);
    expect(r.schedule.slice(0, 2).map((x) => x.status)).toEqual(['paid', 'paid']);
    const ledgerBalance = 1000000 - pays.reduce((s, p) => s + p.principal, 0);
    expect(r.outstanding).toBe(Math.round(ledgerBalance * 100) / 100);
    expect(outstandingOf(1000000, r.schedule, r.prepaid)).toBe(r.outstanding);
    expect(r.schedule[1].balanceAfter).toBe(r.outstanding);
    expect(emisDueWithin(r.schedule, '2026-06-30', 7).map((x) => x.n)).toEqual([3]);
    expect(emisDueWithin(r.schedule, '2026-06-20', 7)).toEqual([]);
  });
});

describe('Increase Loan (top-up)', () => {
  const T = { principal: 1000000, ratePct: 12, months: 12, firstEmiDate: '2026-05-05' };
  const sumP = (s) => Math.round(s.reduce((t, r) => t + r.principalPart, 0) * 100) / 100;
  it('adds to what is owed; keeping the EMI makes it longer; Σ principal = principal + top-up', () => {
    const r = scheduleFor(T, [
      { date: '2026-05-05', kind: 'emi', principal: 78848.79, interest: 10000 },
      { date: '2026-05-20', kind: 'topup', principal: 200000 },
    ]);
    expect(r.outstanding).toBe(1121151.21);
    expect(r.schedule.length).toBeGreaterThan(12);
    expect(sumP(r.schedule)).toBe(1200000);
    expect(r.schedule.at(-1).balanceAfter).toBe(0);
  });
  it('keeping the end date raises the EMI instead', () => {
    const r = scheduleFor(T, [
      { date: '2026-05-05', kind: 'emi', principal: 78848.79, interest: 10000 },
      { date: '2026-05-20', kind: 'topup', principal: 200000, reschedule: 'emi' },
    ]);
    expect(r.schedule).toHaveLength(12);
    expect(r.schedule[1].emi).toBeGreaterThan(88848.79);
    expect(sumP(r.schedule)).toBe(1200000);
  });
  it('a top-up on a paid-off loan opens it again with a fresh schedule', () => {
    const r = scheduleFor(T, [
      { date: '2026-05-10', kind: 'prepay', principal: 1000000 },
      { date: '2026-06-10', kind: 'topup', principal: 50000 },
    ]);
    expect(r.closed).toBe(false);
    expect(r.outstanding).toBe(50000);
    expect(r.schedule.filter((x) => x.status === 'due').length).toBeGreaterThan(0);
  });
});
