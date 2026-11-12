// Vyapar parity P10-S6: cash-limit watch beyond §269ST. Boundaries are the fixtures.
import { describe, expect, it } from 'vitest';
import { cashLoanWatch, cashPaymentWatch, msmeOverdue } from '../src/index.ts';

describe('§40A(3): cash paid to one payee in a day above ₹10,000', () => {
  it('₹10,000 exactly is allowed; ₹10,001 is disallowed; same-day payments add up', () => {
    const w = cashPaymentWatch([
      { payee: 'Om', date: '2026-11-06', amount: 10000, mode: 'cash' },
      { payee: 'Ravi', date: '2026-11-06', amount: 6000, mode: 'cash' },
      { payee: 'Ravi', date: '2026-11-06', amount: 4001, mode: 'cash' },
      { payee: 'Ravi', date: '2026-11-07', amount: 9000, mode: 'cash' },
      { payee: 'Sun', date: '2026-11-06', amount: 50000, mode: 'bank' },
    ]);
    expect(w).toEqual([{ payee: 'Ravi', date: '2026-11-06', total: 10001, disallowed: 10001 }]);
  });
  it('payee names compare without case or spaces at the ends', () => {
    expect(cashPaymentWatch([
      { payee: 'Om ', date: '2026-11-06', amount: 6000, mode: 'cash' },
      { payee: 'om', date: '2026-11-06', amount: 6000, mode: 'cash' },
    ])).toHaveLength(1);
  });
});

describe('§269SS: a loan or deposit of ₹20,000 or more taken in cash', () => {
  it('₹19,999 is fine; ₹20,000 is flagged; a loan into a bank is never flagged', () => {
    expect(cashLoanWatch([
      { id: 'a', lender: 'X', date: '2026-11-01', amount: 19999, cash: true },
      { id: 'b', lender: 'Y', date: '2026-11-02', amount: 20000, cash: true },
      { id: 'c', lender: 'Z', date: '2026-11-03', amount: 900000, cash: false },
    ])).toEqual([{ id: 'b', lender: 'Y', date: '2026-11-02', amount: 20000 }]);
  });
});

describe('§43B(h): unpaid dues to an MSME supplier past 45 days', () => {
  const bill = (o) => ({ id: 'P1', supplier: 'Micro Co', date: '2026-09-01', pending: 5000, msme: true, ...o });
  it('day 45 is fine, day 46 is overdue', () => {
    expect(msmeOverdue([bill()], '2026-10-16')).toEqual([]);
    expect(msmeOverdue([bill()], '2026-10-17')).toEqual([{ id: 'P1', supplier: 'Micro Co', date: '2026-09-01', pending: 5000, daysOld: 46, dueBy: '2026-10-16' }]);
  });
  it('never for a supplier not marked MSME or a paid bill', () => {
    expect(msmeOverdue([bill({ msme: false }), bill({ pending: 0 })], '2027-01-01')).toEqual([]);
  });
  it('uses a shorter agreed period when one is given (15 days without a written agreement)', () => {
    expect(msmeOverdue([bill({ agreedDays: 15 })], '2026-09-17')).toHaveLength(1);
    expect(msmeOverdue([bill({ agreedDays: 90 })], '2026-10-17')).toHaveLength(1); // never more than 45
  });
});
