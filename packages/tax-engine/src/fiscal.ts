// Vyapar parity P7-S3: Close financial year. Pure functions: the year's bounds, the closing journal that moves the
// year's profit to Retained Earnings, the checks before closing or reopening, the carry-forward summary and the
// numbering key that restarts a series each year. The API reads the ledger and calls these; nothing here reads a
// database. Golden tests pin the journal and the equality the guide asks for: the new year opens on exactly what the
// old one closed with.
import { ACC, balanceOf, voucher, type AccountKind, type Posting } from './posting.ts';
import { r2 } from './money.ts';

// ---- the year ------------------------------------------------------------------------------------------------------------

/** '2025-26' → 1 April 2025 to 31 March 2026. */
export function fyBounds(label: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) throw new Error(`${label} is not a financial year like 2025-26`);
  const y = Number(m[1]);
  if ((y + 1) % 100 !== Number(m[2]))
    throw new Error(`${label} does not run from one year to the next`);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}
/** The financial year a date (yyyy-mm-dd) falls in. */
export function fyLabelOf(date: string) {
  const [y, mo] = date.split('-').map(Number);
  const start = mo >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const nextFyLabel = (label: string) => fyLabelOf(addDay(fyBounds(label).end));
export function addDay(iso: string) {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

// ---- the closing journal -------------------------------------------------------------------------------------------------

export interface Movement {
  code: string;
  name: string;
  kind: AccountKind;
  debit: number;
  credit: number;
}
export const FY_CLOSE_REF = 'fy_close';

/**
 * The entry that closes the year's income and expense accounts into Retained Earnings (3100), dated the last day of the
 * year. `movements` is each account's debits and credits **within the year, leaving out an earlier closing entry** (so a
 * reclose after a reopen is the same as the first close). Profit credits Retained Earnings, a loss debits it. A year
 * with nothing to close returns no posting.
 */
export function closingJournal(o: {
  yearId: string;
  label: string;
  movements: Movement[];
  retained?: string;
}) {
  const { end } = fyBounds(o.label);
  const retained = o.retained ?? ACC.OPENING_EQUITY;
  const pnl = o.movements.filter((m) => m.kind === 'income' || m.kind === 'expense');
  const income = r2(
    pnl.filter((m) => m.kind === 'income').reduce((s, m) => s + m.credit - m.debit, 0),
  );
  const expense = r2(
    pnl.filter((m) => m.kind === 'expense').reduce((s, m) => s + m.debit - m.credit, 0),
  );
  const netProfit = r2(income - expense);
  const raw = [
    // income has a credit balance: debit it to clear; expense has a debit balance: credit it to clear
    ...pnl.map((m) => ({
      account: m.code,
      dr: r2(m.credit - m.debit),
      cr: 0,
      narration: `Close ${o.label}`,
    })),
    {
      account: retained,
      cr: netProfit,
      dr: 0,
      narration: `Net ${netProfit >= 0 ? 'profit' : 'loss'} of ${o.label} to Retained Earnings`,
    },
  ].map((l) => ({ ...l }));
  // an expense account's `dr` above is (credit − debit) = a negative number, which voucher() flips to a credit: right.
  const posting: Posting | null = voucher(end, FY_CLOSE_REF, o.yearId, raw);
  return { posting, income, expense, netProfit };
}

// ---- checks --------------------------------------------------------------------------------------------------------------

export interface YearRow {
  label: string;
  start: string;
  end: string;
  status: 'open' | 'closed';
}
export interface Problem {
  code: string;
  message: string;
}
export const BACKUP_MAX_AGE_HOURS = 24;

/** Why this year can not be closed now. An empty list means it can. */
export function closeProblems(o: {
  ledgerOn: boolean;
  year: YearRow;
  years: YearRow[];
  today: string;
  lastBackupAt: string | null;
  now: number;
  confirmText: string;
  method: 'prefix' | 'new-year';
  newPrefix?: string;
}): Problem[] {
  const out: Problem[] = [];
  if (!o.ledgerOn)
    out.push({
      code: 'ledger_required',
      message: 'Closing a year needs the accounting ledger. Enable accounting first.',
    });
  if (o.year.status === 'closed')
    out.push({ code: 'already_closed', message: `${o.year.label} is already closed` });
  if (o.year.end >= o.today)
    out.push({
      code: 'not_ended',
      message: `${o.year.label} runs until ${o.year.end}; it can be closed after that`,
    });
  const earlier = o.years
    .filter((y) => y.end < o.year.start && y.status === 'open')
    .sort((a, b) => a.end.localeCompare(b.end))[0];
  if (earlier) out.push({ code: 'earlier_open', message: `Close ${earlier.label} first` });
  const age = o.lastBackupAt ? (o.now - new Date(o.lastBackupAt).getTime()) / 36e5 : Infinity;
  if (!(age <= BACKUP_MAX_AGE_HOURS))
    out.push({
      code: 'backup_needed',
      message: o.lastBackupAt
        ? `The last backup is over ${BACKUP_MAX_AGE_HOURS} hours old. Back up now.`
        : 'There is no backup yet. Back up now.',
    });
  if (o.confirmText.trim() !== o.year.label)
    out.push({ code: 'confirm_mismatch', message: `Type ${o.year.label} to confirm` });
  if (o.method === 'prefix') {
    const p = (o.newPrefix ?? '').trim();
    if (!p) out.push({ code: 'prefix_required', message: 'Enter the new prefix' });
    else if (!/^[A-Za-z0-9\-/]{1,8}$/.test(p))
      out.push({ code: 'prefix_invalid', message: 'A prefix is up to 8 letters, digits, - or /' });
  }
  return out;
}

/** Why this year can not be reopened: owner only, with a reason, and not under a later closed year. */
export function reopenProblems(o: {
  role: string;
  reason: string;
  year: YearRow;
  years: YearRow[];
}): Problem[] {
  const out: Problem[] = [];
  if (o.role !== 'owner')
    out.push({ code: 'owner_only', message: 'Only the owner can reopen a closed year' });
  if (o.year.status !== 'closed')
    out.push({ code: 'not_closed', message: `${o.year.label} is not closed` });
  if (o.reason.trim().length < 5)
    out.push({ code: 'reason_required', message: 'Give a reason (at least 5 characters)' });
  const later = o.years.find((y) => y.start > o.year.end && y.status === 'closed');
  if (later) out.push({ code: 'later_closed', message: `Reopen ${later.label} first` });
  return out;
}

// ---- carry forward -------------------------------------------------------------------------------------------------------

export interface Closing {
  code: string;
  name: string;
  kind: AccountKind;
  group?: string;
  debit: number;
  credit: number;
}
/**
 * What the new year opens with: every balance-sheet account's closing balance (the ledger is continuous, so these are
 * the opening balances of the next year without re-posting them), grouped for the result page. Income and expense
 * accounts are not carried: the closing journal cleared them.
 */
export function carryForward(accounts: Closing[], o: { stockValue?: number } = {}) {
  const rows = accounts
    .filter((a) => a.kind === 'asset' || a.kind === 'liability' || a.kind === 'equity')
    .map((a) => ({
      code: a.code,
      name: a.name,
      kind: a.kind,
      group: a.group ?? '',
      amount: balanceOf(a.kind, a.debit, a.credit),
    }))
    .filter((a) => Math.abs(a.amount) >= 0.005)
    .sort((x, y) => x.code.localeCompare(y.code));
  const sum = (k: AccountKind) =>
    r2(rows.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0));
  const money = rows.filter((r) => r.code === ACC.CASH || r.group === 'Bank');
  const parties = rows.filter((r) => r.code === ACC.RECEIVABLE || r.code === ACC.PAYABLE);
  return {
    rows,
    assets: sum('asset'),
    liabilities: sum('liability'),
    equity: sum('equity'),
    cashAndBank: r2(money.reduce((s, r) => s + r.amount, 0)),
    receivable: r2(rows.find((r) => r.code === ACC.RECEIVABLE)?.amount ?? 0),
    payable: r2(rows.find((r) => r.code === ACC.PAYABLE)?.amount ?? 0),
    partyAccounts: parties.length,
    stockValue: r2(o.stockValue ?? 0),
  };
}

/** The equality P7-S3 rests on: two sets of closing balances agree, account by account, within a paisa. */
export function sameBalances(
  a: ReturnType<typeof carryForward>,
  b: ReturnType<typeof carryForward>,
) {
  const key = (x: { code: string; amount: number }) => `${x.code}:${x.amount.toFixed(2)}`;
  const A = new Set(a.rows.map(key));
  const B = new Set(b.rows.map(key));
  return {
    equal: A.size === B.size && [...A].every((k) => B.has(k)),
    onlyOld: [...A].filter((k) => !B.has(k)),
    onlyNew: [...B].filter((k) => !A.has(k)),
  };
}
