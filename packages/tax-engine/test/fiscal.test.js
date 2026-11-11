// Vyapar parity P7-S3: closing journal golden values, the checks, the carry-forward equality and numbering restarts.
import { describe, expect, it } from 'vitest';
import {
  ACC, BACKUP_MAX_AGE_HOURS, carryForward, closeProblems, closingJournal, counterKeyFor, fyBounds, fyLabelOf, isBalanced, nextFyLabel,
  reopenProblems, sameBalances, trialBalance, voucher,
} from '../src/index.ts';

const mv = (code, name, kind, debit, credit) => ({ code, name, kind, debit, credit });
// FY 2025-26: sales 100000 (+18000 GST), purchases 60000, expenses 15000, discount allowed 500, other income 2000.
const MOVES = [
  mv('4000', 'Sales', 'income', 0, 100000), mv('4100', 'Other Income', 'income', 0, 2000), mv('5000', 'Purchases', 'expense', 60000, 0),
  mv('5100', 'Expenses', 'expense', 15000, 0), mv('5200', 'Discount Allowed', 'expense', 500, 0),
  mv('1000', 'Cash', 'asset', 5, 0), // balance-sheet accounts are never part of the journal
];

describe('financial year labels', () => {
  it('bounds and labels', () => {
    expect(fyBounds('2025-26')).toEqual({ start: '2025-04-01', end: '2026-03-31' });
    expect(fyLabelOf('2026-03-31')).toBe('2025-26');
    expect(fyLabelOf('2026-04-01')).toBe('2026-27');
    expect(fyLabelOf('2099-12-31')).toBe('2099-00');
    expect(nextFyLabel('2025-26')).toBe('2026-27');
    expect(() => fyBounds('2025-27')).toThrow();
    expect(() => fyBounds('FY25')).toThrow();
  });
});

describe('closing journal (golden)', () => {
  it('profit: clears income and expense and credits Retained Earnings with the profit', () => {
    const { posting, income, expense, netProfit } = closingJournal({ yearId: 'fy1', label: '2025-26', movements: MOVES });
    expect({ income, expense, netProfit }).toEqual({ income: 102000, expense: 75500, netProfit: 26500 });
    expect(posting.date).toBe('2026-03-31');
    expect(posting.refType).toBe('fy_close');
    expect(posting.refId).toBe('fy1');
    expect(isBalanced(posting)).toBe(true);
    expect(posting.lines).toEqual([
      { account: '4000', debit: 100000, narration: 'Close 2025-26' },
      { account: '4100', debit: 2000, narration: 'Close 2025-26' },
      { account: '5000', credit: 60000, narration: 'Close 2025-26' },
      { account: '5100', credit: 15000, narration: 'Close 2025-26' },
      { account: '5200', credit: 500, narration: 'Close 2025-26' },
      { account: ACC.OPENING_EQUITY, credit: 26500, narration: 'Net profit of 2025-26 to Retained Earnings' },
    ]);
  });
  it('loss: debits Retained Earnings', () => {
    const { posting, netProfit } = closingJournal({ yearId: 'fy2', label: '2025-26', movements: [mv('4000', 'Sales', 'income', 0, 1000), mv('5100', 'Expenses', 'expense', 4000, 0)] });
    expect(netProfit).toBe(-3000);
    expect(posting.lines.at(-1)).toMatchObject({ account: ACC.OPENING_EQUITY, debit: 3000 });
    expect(isBalanced(posting)).toBe(true);
  });
  it('a sales return (income account with a debit) and a purchase return still clear to zero', () => {
    const { posting } = closingJournal({ yearId: 'x', label: '2025-26', movements: [mv('4000', 'Sales', 'income', 500, 10000), mv('5000', 'Purchases', 'expense', 6000, 1000)] });
    expect(posting.lines[0]).toMatchObject({ account: '4000', debit: 9500 });
    expect(posting.lines[1]).toMatchObject({ account: '5000', credit: 5000 });
    expect(isBalanced(posting)).toBe(true);
  });
  it('nothing to close posts nothing', () => {
    expect(closingJournal({ yearId: 'z', label: '2025-26', movements: [mv('1000', 'Cash', 'asset', 5, 0)] }).posting).toBeNull();
  });
  it('random years: the journal always balances and leaves every P&L account at zero', () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 200; k++) {
      const moves = Array.from({ length: 1 + Math.floor(rnd() * 9) }, (_, i) =>
        mv(String(4000 + i * 100 + (rnd() < 0.5 ? 0 : 1000)), 'a', rnd() < 0.5 ? 'income' : 'expense', Math.round(rnd() * 1e6) / 100, Math.round(rnd() * 1e6) / 100));
      const uniq = [...new Map(moves.map((m) => [m.code, m])).values()];
      const { posting } = closingJournal({ yearId: 'r', label: '2025-26', movements: uniq });
      if (!posting) continue;
      expect(isBalanced(posting)).toBe(true);
      for (const m of uniq) {
        const l = posting.lines.filter((x) => x.account === m.code);
        const net = (m.debit - m.credit) + l.reduce((s, x) => s + (x.debit ?? 0) - (x.credit ?? 0), 0);
        expect(Math.abs(Math.round(net * 100))).toBe(0);
      }
    }
  });
});

describe('equality: the new year opens on what the old one closed with', () => {
  // A small ledger of the year as postings: capital, sale on credit with GST, purchase for cash, an expense, collection.
  const entries = [
    voucher('2025-04-01', 'opening', 'o', [{ account: ACC.CASH, dr: 50000 }, { account: ACC.CAPITAL, cr: 50000 }]),
    voucher('2025-06-10', 'invoice', 'i1', [{ account: ACC.RECEIVABLE, dr: 118000 }, { account: ACC.SALES, cr: 100000 }, { account: ACC.OUT_CGST, cr: 9000 }, { account: ACC.OUT_SGST, cr: 9000 }]),
    voucher('2025-07-01', 'purchase', 'p1', [{ account: ACC.PURCHASES, dr: 60000 }, { account: ACC.IN_CGST, dr: 5400 }, { account: ACC.IN_SGST, dr: 5400 }, { account: ACC.CASH, cr: 70800 }]),
    voucher('2025-08-01', 'expense', 'e1', [{ account: ACC.EXPENSES, dr: 15000 }, { account: ACC.CASH, cr: 15000 }]),
    voucher('2025-09-01', 'payment', 'r1', [{ account: ACC.CASH, dr: 40000 }, { account: ACC.RECEIVABLE, cr: 40000 }]),
  ];
  const names = { [ACC.CASH]: ['Cash', 'asset'], [ACC.RECEIVABLE]: ['Receivable', 'asset'], [ACC.IN_CGST]: ['In CGST', 'asset'], [ACC.IN_SGST]: ['In SGST', 'asset'], [ACC.OUT_CGST]: ['Out CGST', 'liability'], [ACC.OUT_SGST]: ['Out SGST', 'liability'], [ACC.CAPITAL]: ['Capital', 'equity'], [ACC.OPENING_EQUITY]: ['Retained', 'equity'], [ACC.SALES]: ['Sales', 'income'], [ACC.PURCHASES]: ['Purchases', 'expense'], [ACC.EXPENSES]: ['Expenses', 'expense'] };
  const totals = (list) => {
    const by = {};
    for (const p of list) for (const l of p.lines) { const t = (by[l.account] ??= { code: l.account, name: names[l.account][0], kind: names[l.account][1], debit: 0, credit: 0 }); t.debit += l.debit ?? 0; t.credit += l.credit ?? 0; }
    return Object.values(by);
  };
  it('balance sheet balances unchanged, retained earnings = profit, P&L accounts are zero afterwards', () => {
    const before = totals(entries);
    const { posting, netProfit } = closingJournal({ yearId: 'fy', label: '2025-26', movements: before });
    expect(netProfit).toBe(25000);
    const after = totals([...entries, posting]);
    const a = carryForward(before);
    const b = carryForward(after);
    // assets and liabilities are exactly as before; the profit moved from the P&L accounts into equity
    expect(b.assets).toBe(a.assets);
    expect(b.liabilities).toBe(a.liabilities);
    expect(b.equity).toBe(a.equity + 25000);
    expect(b.rows.find((r) => r.code === ACC.OPENING_EQUITY).amount).toBe(25000);
    expect(trialBalance(after).balanced).toBe(true);
    for (const t of after.filter((x) => x.kind === 'income' || x.kind === 'expense')) expect(Math.round((t.debit - t.credit) * 100)).toBe(0);
    // account by account, nothing but equity changed
    expect(sameBalances(a, b).onlyOld).toEqual([]);
    expect(sameBalances(a, b).onlyNew).toEqual([`${ACC.OPENING_EQUITY}:25000.00`]);
    expect(sameBalances(b, carryForward(after)).equal).toBe(true);
    expect(a.cashAndBank).toBe(50000 - 70800 - 15000 + 40000);
    expect(a.receivable).toBe(78000);
  });
  it('a second year opens on the first year\'s closing: retained earnings is prior retained + profit', () => {
    const y1 = totals(entries);
    const c1 = closingJournal({ yearId: 'fy1', label: '2025-26', movements: y1 });
    const year2 = [voucher('2026-05-01', 'invoice', 'i2', [{ account: ACC.RECEIVABLE, dr: 11800 }, { account: ACC.SALES, cr: 10000 }, { account: ACC.OUT_CGST, cr: 900 }, { account: ACC.OUT_SGST, cr: 900 }])];
    // the year's own movement excludes the earlier closing entry
    const m2 = totals(year2);
    const c2 = closingJournal({ yearId: 'fy2', label: '2026-27', movements: m2 });
    const all = totals([...entries, c1.posting, ...year2, c2.posting]);
    expect(carryForward(all).rows.find((r) => r.code === ACC.OPENING_EQUITY).amount).toBe(25000 + 10000);
    expect(trialBalance(all).balanced).toBe(true);
  });
});

describe('close and reopen checks', () => {
  const y = (label, status = 'open') => ({ label, status, ...fyBounds(label) });
  const base = { ledgerOn: true, year: y('2025-26'), years: [y('2024-25', 'closed'), y('2025-26'), y('2026-27')], today: '2026-11-11', lastBackupAt: '2026-11-11T08:00:00Z', now: Date.parse('2026-11-11T12:00:00Z'), confirmText: '2025-26', method: 'new-year' };
  const codes = (o) => closeProblems({ ...base, ...o }).map((p) => p.code);
  it('a ready year has no problems', () => expect(codes({})).toEqual([]));
  it('refuses with the ledger off, with an Enable accounting message', () => {
    const p = closeProblems({ ...base, ledgerOn: false });
    expect(p[0].code).toBe('ledger_required');
    expect(p[0].message).toMatch(/Enable accounting/);
  });
  it('year not ended, already closed, an earlier year open, stale or missing backup, wrong confirmation', () => {
    expect(codes({ today: '2026-03-31' })).toContain('not_ended');
    expect(codes({ year: y('2025-26', 'closed') })).toContain('already_closed');
    expect(codes({ year: y('2026-27'), years: [y('2025-26'), y('2026-27')], today: '2028-01-01', confirmText: '2026-27' })).toContain('earlier_open');
    expect(codes({ lastBackupAt: '2026-11-09T08:00:00Z' })).toContain('backup_needed');
    expect(codes({ lastBackupAt: null })).toContain('backup_needed');
    expect(BACKUP_MAX_AGE_HOURS).toBe(24);
    expect(codes({ confirmText: '2024-25' })).toContain('confirm_mismatch');
  });
  it('the prefix method needs a valid prefix', () => {
    expect(codes({ method: 'prefix', newPrefix: '' })).toContain('prefix_required');
    expect(codes({ method: 'prefix', newPrefix: 'A B' })).toContain('prefix_invalid');
    expect(codes({ method: 'prefix', newPrefix: '2026-27/' })).toEqual([]);
  });
  it('reopen: owner only, with a reason, not under a later closed year', () => {
    const closed = y('2025-26', 'closed');
    const years = [closed, y('2026-27', 'closed')];
    const r = (o) => reopenProblems({ role: 'owner', reason: 'Late purchase bill', year: closed, years: [closed], ...o }).map((p) => p.code);
    expect(r({})).toEqual([]);
    expect(r({ role: 'admin' })).toContain('owner_only');
    expect(r({ reason: 'x' })).toContain('reason_required');
    expect(r({ years })).toContain('later_closed');
    expect(r({ year: y('2025-26') })).toContain('not_closed');
  });
});

describe('numbering restarts each year', () => {
  it('a series set to reset on the financial year keeps a counter per year', () => {
    expect(counterKeyFor('INV', { resetOn: 'fy' }, '', '2026-27')).toBe('counter_INV#fy:2026-27');
    expect(counterKeyFor('INV', { resetOn: 'fy' }, '', '2025-26')).not.toBe(counterKeyFor('INV', { resetOn: 'fy' }, '', '2026-27'));
    expect(counterKeyFor('INV', {}, '', '2026-27')).toBe('counter_INV');
    expect(counterKeyFor('INV', { own: true }, 'GST1')).toBe('counter_INV@GST1');
  });
});
