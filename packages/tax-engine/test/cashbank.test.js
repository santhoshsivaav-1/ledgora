// Vyapar parity Phase 5: reconciliation matching (P5-S6, "recon match 8"), cash & bank entries (P5-S1/S2), transfers
// (P5-S3), the cash watch and the dashboard totals (P5-S7).
import { describe, it, expect } from 'vitest';
import {
  ACC,
  bankFromIfsc,
  cashBankTotals,
  cashOutWatch,
  cashWatch,
  counterAccount,
  loanCashProblem,
  loanTaxSuggestions,
  dayEndCount,
  isBalanced,
  maskAccount,
  matchStatement,
  normalizeStatementDate,
  parseBankStatement,
  postCashBankEntry,
  postLoanDisbursal,
  postLoanPayment,
  postTransfer,
  reconDifference,
  statementHashes,
  transferProblem,
  validAccountNumber,
  validIfsc,
  validUpi,
} from '../src/index.ts';

const net = (ps, account) =>
  Math.round(
    ps
      .flatMap((p) => p.lines)
      .filter((l) => l.account === account)
      .reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0) * 100,
  ) / 100;

describe('reconciliation matching', () => {
  const entries = [
    { id: 'e1', date: '2026-11-06', debit: 5000, credit: 0, reference: 'RCT-5' },
    { id: 'e2', date: '2026-11-05', debit: 0, credit: 4455, reference: 'PAY-3' },
    { id: 'e3', date: '2026-11-01', debit: 1000, credit: 0 },
  ];
  it('exact: same amount, same day, money in matches a ledger debit', () => {
    const r = matchStatement(
      [{ date: '2026-11-06', description: 'UPI/Ravi', credit: 5000 }],
      entries,
    );
    expect(r.matches).toMatchObject([{ row: 0, entryId: 'e1', days: 0 }]);
  });
  it('money out matches a ledger credit', () => {
    const r = matchStatement(
      [{ date: '2026-11-05', description: 'NEFT Om', debit: 4455 }],
      entries,
    );
    expect(r.matches[0].entryId).toBe('e2');
  });
  it('tolerance: within ±3 days matches, 4 days does not', () => {
    expect(matchStatement([{ date: '2026-11-04', credit: 1000 }], entries).matches[0].entryId).toBe(
      'e3',
    );
    expect(matchStatement([{ date: '2026-11-05', credit: 1000 }], entries).matches).toEqual([]);
    expect(
      matchStatement([{ date: '2026-11-05', credit: 1000 }], entries, { toleranceDays: 5 }).matches,
    ).toHaveLength(1);
  });
  it('the side matters: a deposit never matches a payment of the same amount', () => {
    expect(matchStatement([{ date: '2026-11-05', credit: 4455 }], entries).matches).toEqual([]);
  });
  it('duplicates: two equal statement rows take two entries, not one twice', () => {
    const two = [
      { id: 'a', date: '2026-11-03', debit: 0, credit: 100 },
      { id: 'b', date: '2026-11-03', debit: 0, credit: 100 },
    ];
    const rows = [
      { date: '2026-11-03', description: 'SMS charges', debit: 100 },
      { date: '2026-11-03', description: 'SMS charges', debit: 100 },
      { date: '2026-11-03', description: 'SMS charges', debit: 100 },
    ];
    const r = matchStatement(rows, two);
    expect(r.matches.map((m) => m.entryId).sort()).toEqual(['a', 'b']);
    expect(r.unmatchedRows).toEqual([2]);
    const h = statementHashes(rows);
    expect(new Set(h).size).toBe(3);
  });
  it('a reference in the description wins over a nearer date', () => {
    const es = [
      { id: 'near', date: '2026-11-06', debit: 500, credit: 0, reference: 'RCT-9' },
      { id: 'ref', date: '2026-11-04', debit: 500, credit: 0, reference: 'RCT-7' },
    ];
    const r = matchStatement(
      [{ date: '2026-11-06', description: 'IMPS RCT-7 Kiran', credit: 500 }],
      es,
    );
    expect(r.matches[0]).toMatchObject({ entryId: 'ref', byReference: true });
  });
  it('unmatched rows and entries are reported; hashes are stable between uploads', () => {
    const rows = [{ date: '2026-11-03', description: 'SMS charges', debit: 180 }];
    const r = matchStatement(rows, entries);
    expect(r.unmatchedRows).toEqual([0]);
    expect(r.unmatchedEntries.sort()).toEqual(['e1', 'e2', 'e3']);
    expect(statementHashes(rows)).toEqual(statementHashes([{ ...rows[0] }]));
    expect(reconDifference(240100, 240100)).toBe(0);
    expect(reconDifference(240100, 240280)).toBe(-180);
  });
  it('statement dates in the forms banks print, from parseBankStatement', () => {
    expect(normalizeStatementDate('06/11/2026')).toBe('2026-11-06');
    expect(normalizeStatementDate('06-11-26')).toBe('2026-11-06');
    expect(normalizeStatementDate('6-Nov-2026')).toBe('2026-11-06');
    expect(normalizeStatementDate('06 Nov 26')).toBe('2026-11-06');
    expect(normalizeStatementDate('2026-11-06')).toBe('2026-11-06');
    expect(normalizeStatementDate('31/02/2026')).toBeNull();
    expect(normalizeStatementDate('46332')).toBe('2026-11-06'); // an Excel date cell
    expect(normalizeStatementDate('12345')).toBeNull();
    expect(normalizeStatementDate('Opening balance')).toBeNull();
    const { transactions } = parseBankStatement(
      'Date,Narration,Withdrawal Amt,Deposit Amt,Closing Balance\n06/11/2026,UPI/Ravi,,5000,240100\n',
    );
    const rows = transactions.map((t) => ({ ...t, date: normalizeStatementDate(t.date) }));
    expect(matchStatement(rows, entries).matches[0].entryId).toBe('e1');
  });
});

describe('bank account fields', () => {
  it('IFSC, account number, UPI, masking and the bank lookup', () => {
    expect(validIfsc('HDFC0000123')).toBe(true);
    expect(validIfsc('HDFC1000123')).toBe(false);
    expect(bankFromIfsc('hdfc0000123')).toBe('HDFC Bank');
    expect(bankFromIfsc('ZZZZ0000123')).toBe('');
    expect(validAccountNumber('50100012344521')).toBe(true);
    expect(validAccountNumber('12345678')).toBe(false);
    expect(validAccountNumber('1234567890123456789')).toBe(false);
    expect(maskAccount('50100012344521')).toBe('••4521');
    expect(validUpi('shop@hdfc')).toBe(true);
    expect(validUpi('shop.hdfc')).toBe(false);
  });
});

describe('cash and bank entries', () => {
  const entry = (over) =>
    postCashBankEntry({
      id: 'x',
      date: '2026-11-06',
      account: ACC.CASH,
      amount: 500,
      direction: 'increase',
      kind: 'adjust',
      ...over,
    });
  it('adjust: add cash against Opening Balance Equity, or Other Income when counted as income', () => {
    expect(net(entry(), ACC.CASH)).toBe(500);
    expect(net(entry(), ACC.OPENING_EQUITY)).toBe(-500);
    expect(net(entry({ countAsIncome: true }), ACC.OTHER_INCOME)).toBe(-500);
    expect(net(entry({ direction: 'reduce' }), ACC.CASH)).toBe(-500);
    expect(net(entry({ direction: 'reduce', countAsIncome: true }), ACC.CASH_OVER_SHORT)).toBe(500);
  });
  it('deposit is the owner’s capital; withdraw goes to drawings, bank charges or a chosen account', () => {
    expect(counterAccount({ kind: 'deposit', direction: 'increase' })).toBe(ACC.CAPITAL);
    expect(counterAccount({ kind: 'withdraw', direction: 'reduce' })).toBe(ACC.DRAWINGS);
    expect(
      counterAccount({ kind: 'withdraw', direction: 'reduce', category: 'bank_charges' }),
    ).toBe(ACC.BANK_CHARGES);
    expect(
      counterAccount({ kind: 'withdraw', direction: 'reduce', category: 'other', account: '5301' }),
    ).toBe('5301');
    const w = entry({
      account: '1101',
      kind: 'withdraw',
      direction: 'reduce',
      category: 'bank_charges',
      amount: 180,
    });
    expect(net(w, '1101')).toBe(-180);
    expect(net(w, ACC.BANK_CHARGES)).toBe(180);
  });
  it('day-end count: equal makes no entry, short and over go to Cash Over / Short', () => {
    expect(dayEndCount(48300, 48300)).toEqual({ difference: 0, direction: null, amount: 0 });
    expect(dayEndCount(48300, 48000)).toEqual({
      difference: -300,
      direction: 'reduce',
      amount: 300,
    });
    const short = entry({ kind: 'count', direction: 'reduce', amount: 300 });
    expect(net(short, ACC.CASH_OVER_SHORT)).toBe(300);
    expect(dayEndCount(100, 100.5).direction).toBe('increase');
  });
});

describe('transfers and loans', () => {
  it('transfer: both sides move by the amount; a fee is Bank Charges from the source', () => {
    const p = postTransfer({
      id: 't',
      date: '2026-11-06',
      from: '1101',
      to: ACC.CASH,
      amount: 10000,
      fee: 15,
    });
    expect(isBalanced(p[0])).toBe(true);
    expect(net(p, ACC.CASH)).toBe(10000);
    expect(net(p, '1101')).toBe(-10015);
    expect(net(p, ACC.BANK_CHARGES)).toBe(15);
  });
  it('transfer guard: same account, more than cash in hand, bank overdraft by setting', () => {
    const t = {
      fromAccount: ACC.CASH,
      toAccount: '1101',
      amount: 500,
      fromBalance: 400,
      fromIsCash: true,
    };
    expect(transferProblem({ ...t, toAccount: ACC.CASH })).toMatch(/different/);
    expect(transferProblem(t)).toMatch(/Only ₹400/);
    expect(transferProblem({ ...t, fromIsCash: false, allowOverdraft: true })).toBeNull();
    expect(transferProblem({ ...t, fromIsCash: false })).toMatch(/Only/);
    expect(transferProblem({ ...t, amount: 400 })).toBeNull();
  });
  it('loan with a processing fee: bank gets the net, the fee is a bank charge; an EMI posts four lines', () => {
    const d = postLoanDisbursal({
      id: 'l',
      date: '2026-04-01',
      loanAccount: '2301',
      bankAccount: '1101',
      amount: 1000000,
      fee: 5000,
    });
    expect(net(d, '1101')).toBe(995000);
    expect(net(d, '2301')).toBe(-1000000);
    const e = postLoanPayment({
      id: 'lp',
      date: '2026-05-05',
      loanAccount: '2301',
      bankAccount: '1101',
      principal: 78848.79,
      interest: 10000,
      fees: 100,
      refType: 'loan_payment',
    });
    expect(e[0].refType).toBe('loan_payment');
    expect(e[0].lines).toHaveLength(4);
  });
});

describe('cash watch and dashboard totals', () => {
  it('§269ST: cash in from one party on one day reaching ₹2,00,000', () => {
    const w = cashWatch([
      { partyId: 'p', date: '2026-11-06', amount: 150000, mode: 'cash' },
      { partyId: 'p', date: '2026-11-06', amount: 50000, mode: 'cash' },
      { partyId: 'p', date: '2026-11-07', amount: 199999, mode: 'cash' },
      { partyId: 'q', date: '2026-11-06', amount: 500000, mode: 'bank' },
      { partyId: 'q', date: '2026-11-06', amount: 500000, mode: 'cash', direction: 'out' },
    ]);
    expect(w).toEqual([{ partyId: 'p', date: '2026-11-06', total: 200000 }]);
  });
  it('totals and overdraft warning', () => {
    const t = cashBankTotals([
      { kind: 'cash', name: 'Cash in Hand', balance: 48300 },
      { kind: 'bank', name: 'HDFC', balance: 240100 },
      { kind: 'bank', name: 'SBI OD', balance: -5000 },
    ]);
    expect(t).toEqual({
      cash: 48300,
      bank: 235100,
      total: 283400,
      overdrawn: [{ name: 'SBI OD', balance: -5000 }],
    });
  });
});

describe('India: cash limits and loan deductions', () => {
  it('§40A(3): cash paid out to one party in a day above ₹10,000', () => {
    const w = cashOutWatch([
      { partyId: 's', date: '2026-11-06', amount: 6000, mode: 'cash', direction: 'out' },
      { partyId: 's', date: '2026-11-06', amount: 5000, mode: 'cash', direction: 'out' },
      { partyId: 't', date: '2026-11-06', amount: 10000, mode: 'cash', direction: 'out' },
      { partyId: 's', date: '2026-11-06', amount: 50000, mode: 'cash', direction: 'in' },
    ]);
    expect(w).toEqual([{ partyId: 's', date: '2026-11-06', total: 11000 }]);
  });
  it('§269SS / §269T: ₹20,000 or more taken or repaid in cash', () => {
    expect(loanCashProblem({ direction: 'take', amount: 20000, inCash: true }).section).toBe(
      '269SS',
    );
    expect(loanCashProblem({ direction: 'repay', amount: 25000, inCash: true }).section).toBe(
      '269T',
    );
    expect(loanCashProblem({ direction: 'take', amount: 19999, inCash: true })).toBeNull();
    expect(loanCashProblem({ direction: 'take', amount: 500000, inCash: false })).toBeNull();
  });
  it('§24(b) home-loan interest capped at ₹2,00,000; principal to 80C; §80E education interest; business loans left out', () => {
    expect(
      loanTaxSuggestions([
        { purpose: 'housing', interest: 180000, principal: 60000 },
        { purpose: 'housing', interest: 50000, principal: 20000 },
        { purpose: 'education', interest: 42000, principal: 30000 },
        { purpose: 'business', interest: 99000, principal: 1 },
      ]),
    ).toEqual({ '24b': 200000, housingInterest: 230000, '80C': 80000, '80E': 42000 });
  });
});

// ---- §194A on loan interest, and the cheque clear date for the ITC 180-day rule ------------------------------------------
import { chequePaidOn, loanInterestTds } from '../src/index.ts';

describe('§194A TDS on loan interest', () => {
  it('banks and loans marked exempt: nothing', () => {
    expect(loanInterestTds({ lenderType: 'bank', interest: 90000, panAvailable: true }).tds).toBe(
      0,
    );
    expect(
      loanInterestTds({ lenderType: 'nbfc', exempt: true, interest: 90000, panAvailable: true })
        .tds,
    ).toBe(0);
  });
  it('under ₹10,000 in the year: nothing; the payment that crosses it covers the year (catch-up); then each payment', () => {
    expect(
      loanInterestTds({
        lenderType: 'individual',
        interest: 6000,
        ytdInterest: 0,
        panAvailable: true,
      }).tds,
    ).toBe(0);
    expect(
      loanInterestTds({
        lenderType: 'individual',
        interest: 4000,
        ytdInterest: 6000,
        panAvailable: true,
      }).tds,
    ).toBe(0);
    const cross = loanInterestTds({
      lenderType: 'individual',
      interest: 4500,
      ytdInterest: 6000,
      panAvailable: true,
    });
    expect(cross).toMatchObject({
      applies: true,
      rate: 10,
      taxableBase: 10500,
      tds: 1050,
      reason: 'crosses_aggregate',
    });
    expect(
      loanInterestTds({
        lenderType: 'nbfc',
        interest: 3000,
        ytdInterest: 10500,
        ytdDeducted: true,
        panAvailable: true,
      }).tds,
    ).toBe(300);
  });
  it('without the lender’s PAN: 20% (§206AA)', () => {
    expect(
      loanInterestTds({ lenderType: 'company', interest: 20000, panAvailable: false }),
    ).toMatchObject({ rate: 20, tds: 4000 });
  });
  it('the posting keeps the TDS: Cr TDS Payable, the bank pays the net', () => {
    const p = postLoanPayment({
      id: 'x',
      date: '2026-11-05',
      loanAccount: '2301',
      bankAccount: '1101',
      principal: 5000,
      interest: 20000,
      tds: 2000,
    });
    expect(isBalanced(p[0])).toBe(true);
    expect(net(p, ACC.TDS_PAYABLE)).toBe(-2000);
    expect(net(p, '1101')).toBe(-23000);
    expect(net(p, ACC.LOAN_INTEREST)).toBe(20000);
  });
});

describe('ITC 180 days: a supplier cheque counts on its clear date', () => {
  it('cleared → clear date; open, deposited, bounced, cancelled → not paid; no register entry → payment date', () => {
    expect(chequePaidOn('2026-03-01', { status: 'cleared', statusDate: '2026-03-09' })).toBe(
      '2026-03-09',
    );
    for (const status of ['open', 'deposited', 'bounced', 'cancelled'])
      expect(chequePaidOn('2026-03-01', { status, statusDate: '2026-03-02' })).toBeNull();
    expect(chequePaidOn('2026-03-01', null)).toBe('2026-03-01');
  });
});

// ---- §194A at credit: interest credited before it is paid --------------------------------------------------------------
import { accruedSettlement, postLoanInterestCredit } from '../src/index.ts';

describe('§194A when interest is credited before it is paid', () => {
  it('the credit books the expense and keeps the TDS now; the lender is owed the net', () => {
    const p = postLoanInterestCredit({ id: 'c', date: '2027-03-31', amount: 12000, tds: 1200 });
    expect(isBalanced(p[0])).toBe(true);
    expect(p[0].refType).toBe('loan_interest');
    expect(net(p, ACC.LOAN_INTEREST)).toBe(12000);
    expect(net(p, ACC.INTEREST_PAYABLE)).toBe(-10800);
    expect(net(p, ACC.TDS_PAYABLE)).toBe(-1200);
  });
  it('the payment of credited interest clears Interest Payable: no second expense, no second TDS, the bank pays the net', () => {
    const p = postLoanPayment({
      id: 'p',
      date: '2027-04-05',
      loanAccount: '2301',
      bankAccount: '1101',
      principal: 5000,
      interest: 12000,
      accrued: 12000,
      accruedTds: 1200,
    });
    expect(isBalanced(p[0])).toBe(true);
    expect(net(p, ACC.INTEREST_PAYABLE)).toBe(10800);
    expect(net(p, ACC.LOAN_INTEREST)).toBe(0);
    expect(net(p, '1101')).toBe(-15800);
    // Credit + payment together: Interest Payable back to zero, expense once, TDS once.
    const both = [
      ...postLoanInterestCredit({ id: 'c', date: '2027-03-31', amount: 12000, tds: 1200 }),
      ...p,
    ];
    expect(net(both, ACC.INTEREST_PAYABLE)).toBe(0);
    expect(net(both, ACC.LOAN_INTEREST)).toBe(12000);
    expect(net(both, ACC.TDS_PAYABLE)).toBe(-1200);
  });
  it('a payment with more interest than was credited: the rest is expense now, with its own TDS', () => {
    const p = postLoanPayment({
      id: 'p',
      date: '2027-04-05',
      loanAccount: '2301',
      bankAccount: '1101',
      principal: 0,
      interest: 15000,
      accrued: 12000,
      accruedTds: 1200,
      tds: 300,
    });
    expect(isBalanced(p[0])).toBe(true);
    expect(net(p, ACC.LOAN_INTEREST)).toBe(3000);
    expect(net(p, '1101')).toBe(-13500);
  });
  it('settlement is first credited, first paid, with the TDS share in proportion', () => {
    const credits = [
      { amount: 10000, tds: 1000 },
      { amount: 5000, tds: 1000 },
    ];
    expect(accruedSettlement(credits, 0, 4000)).toEqual({ settled: 4000, tds: 400 });
    expect(accruedSettlement(credits, 8000, 4000)).toEqual({ settled: 4000, tds: 200 + 400 });
    expect(accruedSettlement(credits, 15000, 4000)).toEqual({ settled: 0, tds: 0 });
    expect(accruedSettlement([], 0, 4000)).toEqual({ settled: 0, tds: 0 });
  });
});
