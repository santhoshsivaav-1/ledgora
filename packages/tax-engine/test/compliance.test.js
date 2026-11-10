// Vyapar parity P10-S4 (ITC 180-day rule) and P10-S5 (TDS due dates and interest).
import { describe, it, expect } from 'vitest';
import {
  addDays,
  daysBetween,
  itcAging,
  itcDeadline,
  itcReversalsFor,
  tdsDueDate,
  tdsInterest,
  tdsQuarter,
} from '../src/index.ts';

const bill = {
  id: 'b',
  supplier: 'Om',
  number: 'P-9',
  date: '2026-01-01',
  payable: 12000,
  itc: 2160,
};
const day = (k) => addDays(bill.date, k);

describe('ITC 180-day rule', () => {
  it('boundaries: 179 and 180 days are not yet due, 181 is', () => {
    expect(itcAging([bill], [], day(179)).dueForReversal).toEqual([]);
    expect(itcAging([bill], [], day(180)).dueForReversal).toEqual([]);
    const at181 = itcAging([bill], [], day(181));
    expect(at181.dueForReversal).toHaveLength(1);
    expect(at181.dueForReversal[0]).toMatchObject({
      daysLate: 1,
      unpaid: 12000,
      itcToReverse: 2160,
      deadline: day(180),
    });
  });
  it('at risk from day 150, with the days left (0 on the deadline day)', () => {
    expect(itcAging([bill], [], day(149)).atRisk).toEqual([]);
    expect(itcAging([bill], [], day(150)).atRisk[0]).toMatchObject({
      daysLeft: 30,
      unpaid: 12000,
      itcAtRisk: 2160,
    });
    expect(itcAging([bill], [], day(180)).atRisk[0].daysLeft).toBe(0);
  });
  it('paid in full on the deadline is safe; paid a day later is not', () => {
    expect(itcAging([bill], [{ billId: 'b', amount: 12000, date: day(180) }], day(200))).toEqual({
      atRisk: [],
      dueForReversal: [],
    });
    expect(
      itcAging([bill], [{ billId: 'b', amount: 12000, date: day(181) }], day(200)).dueForReversal,
    ).toHaveLength(1);
    expect(
      itcAging([bill], [{ billId: 'b', amount: 12000, date: day(100) }], day(160)).atRisk,
    ).toEqual([]);
  });
  it('partial payment gives a proportional reversal', () => {
    const r = itcAging([bill], [{ billId: 'b', amount: 3000, date: day(60) }], day(200))
      .dueForReversal[0];
    expect(r).toMatchObject({ unpaid: 9000, itcToReverse: 1620 });
  });
  it('bills with no credit or nothing payable are left out; the deadline helper', () => {
    expect(
      itcAging(
        [
          { ...bill, itc: 0 },
          { ...bill, id: 'c', payable: 0 },
        ],
        [],
        day(300),
      ),
    ).toEqual({ atRisk: [], dueForReversal: [] });
    expect(itcDeadline('2026-01-01')).toBe('2026-06-30');
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
  });
  it('the return period shows the reversal, and a later payment is re-claimed in its own period', () => {
    const pays = [
      { billId: 'b', amount: 3000, date: day(60) },
      { billId: 'b', amount: 5000, date: '2026-08-10' },
    ];
    // Deadline 2026-06-30: the first day past it is 2026-07-01, so July's return reverses the credit on the 9,000 unpaid.
    const july = itcReversalsFor([bill], pays, '2026-07-01', '2026-07-31');
    expect(july.reversed).toBe(1620);
    expect(july.reclaimed).toBe(0);
    expect(itcReversalsFor([bill], pays, '2026-06-01', '2026-06-30').reversed).toBe(0);
    const aug = itcReversalsFor([bill], pays, '2026-08-01', '2026-08-31');
    expect(aug.reclaimed).toBe(900); // 2160 × 5000 / 12000
    expect(aug.reversed).toBe(0);
    // Never re-claims more than was reversed.
    expect(
      itcReversalsFor(
        [bill],
        [{ billId: 'b', amount: 99999, date: '2026-09-01' }],
        '2026-09-01',
        '2026-09-30',
      ).reclaimed,
    ).toBe(2160);
  });
});

describe('TDS due dates and interest', () => {
  it('7th of the next month; March goes to 30 April; December rolls the year', () => {
    expect(tdsDueDate('2026-10-15')).toBe('2026-11-07');
    expect(tdsDueDate('2026-12-31')).toBe('2027-01-07');
    expect(tdsDueDate('2027-03-10')).toBe('2027-04-30');
  });
  it('late deposit costs 1.5% a month or part; on time costs nothing', () => {
    expect(
      tdsInterest({
        tds: 500,
        deductedOn: '2026-10-15',
        depositedOn: '2026-11-07',
        asOf: '2026-12-01',
      }),
    ).toMatchObject({ interest: 0, overdue: false });
    expect(
      tdsInterest({
        tds: 500,
        deductedOn: '2026-10-15',
        depositedOn: '2026-11-20',
        asOf: '2026-12-01',
      }),
    ).toMatchObject({ months: 2, interest: 15 });
    expect(tdsInterest({ tds: 1000, deductedOn: '2026-10-15', asOf: '2026-12-20' })).toMatchObject({
      months: 3,
      rate: 1.5,
      interest: 45,
      overdue: true,
    });
  });
  it('late deduction is 1% a month; a deposit the day after deduction is still one month', () => {
    expect(
      tdsInterest({
        tds: 1000,
        deductedOn: '2026-10-15',
        depositedOn: '2026-10-16',
        asOf: '2026-10-16',
        kind: 'late_deduction',
      }),
    ).toMatchObject({ months: 1, interest: 10 });
  });
  it('quarters of a financial year', () => {
    expect(tdsQuarter('2026-11-05')).toEqual({
      fy: '2026-27',
      q: 'Q3',
      from: '2026-10-01',
      to: '2026-12-31',
    });
    expect(tdsQuarter('2027-02-01')).toEqual({
      fy: '2026-27',
      q: 'Q4',
      from: '2027-01-01',
      to: '2027-03-31',
    });
    expect(tdsQuarter('2026-04-01').q).toBe('Q1');
  });
});

describe('reversals carry the date of the return that shows them', () => {
  it('the first day past the deadline', () => {
    const r = itcReversalsFor([bill], [], '2026-07-01', '2026-07-31');
    expect(r.reversals[0]).toMatchObject({ itc: 2160, date: '2026-07-01' });
  });
});
