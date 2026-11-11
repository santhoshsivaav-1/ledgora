// Vyapar parity Phase 6 (reports): the pure maths behind the ledger reports. Stock valuation (weighted average), the
// Profit & Loss and Balance Sheet assembled from account totals, the direct-method Cash Flow and ageing buckets
// (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P6-S2, P6-S3, P6-S4, P6-S7). The API reads the totals; nothing here does I/O.
//
// Stock is not posted per movement (decision D-06 / D-11): purchases are expenses in the ledger and stock is valued at
// report time. So the P&L is the periodic one (opening stock + purchases − closing stock) and the Balance Sheet adds the
// closing stock as an asset, with the stock items were opened with standing as capital.

import type { Numeric } from './types.ts';
import { r2 } from './money.ts';
import type { AccountKind } from './posting.ts';

const n = (v: Numeric) => Number(v) || 0;

// ---- stock valuation ------------------------------------------------------------------------------------------------

export interface StockMove {
  date: string;
  /** Signed: in > 0, out < 0. */
  qty: Numeric;
  /** What a unit came in at, for inflows that set cost (purchases, opening stock). Left out = at the running average. */
  unitCost?: Numeric | null;
}

/**
 * Moving weighted-average cost of one item up to `asOf` (inclusive): each inflow with a cost re-averages, inflows
 * without one (returns, positive adjustments) and outflows go at the running average. Movements on the same date keep
 * their order. Negative stock values at the last known average (never a negative average).
 */
export function weightedAverageCost(moves: StockMove[], asOf: string) {
  let qty = 0;
  let avg = 0;
  for (const m of moves.filter((x) => x.date <= asOf)) {
    const q = n(m.qty);
    if (q > 0 && m.unitCost != null && n(m.unitCost) >= 0) {
      // Stock at or below zero has no cost to average with: the new lot sets it.
      avg = qty > 0 ? (qty * avg + q * n(m.unitCost)) / (qty + q) : n(m.unitCost);
    }
    qty += q;
  }
  return {
    qty: Math.round(qty * 1000) / 1000,
    avg: Math.round(avg * 10000) / 10000,
    value: r2(qty * avg),
  };
}

/** Closing stock of many items on `asOf`: per item quantity, average and value, and the total. */
export function stockValuation(items: { id: string; moves: StockMove[] }[], asOf: string) {
  const rows = items.map((i) => ({ id: i.id, ...weightedAverageCost(i.moves, asOf) }));
  return { rows, total: r2(rows.reduce((s, r) => s + r.value, 0)) };
}

// ---- Profit & Loss ----------------------------------------------------------------------------------------------------

export interface AccountTotal {
  code: string;
  name: string;
  group: string;
  kind: AccountKind | string;
  debit: Numeric;
  credit: Numeric;
}
export interface PnlLine {
  code?: string;
  name: string;
  amount: number;
}

const income = (a: AccountTotal) => r2(n(a.credit) - n(a.debit));
const expense = (a: AccountTotal) => r2(n(a.debit) - n(a.credit));
const lines = (list: AccountTotal[], sign: (a: AccountTotal) => number): PnlLine[] =>
  list
    .map((a) => ({ code: a.code, name: a.name, amount: sign(a) }))
    .filter((l) => Math.abs(l.amount) >= 0.005)
    .sort((x, y) => String(x.code).localeCompare(String(y.code)));
const total = (l: PnlLine[]) => r2(l.reduce((s, x) => s + x.amount, 0));

/**
 * The Profit & Loss of a period, Indian layout: direct income, then direct expenses with opening stock added and closing
 * stock taken off (gross profit), then indirect income and expenses (net profit). `accounts` are the movements of each
 * income and expense account in the period (other kinds are ignored).
 */
export function profitAndLoss(o: {
  accounts: AccountTotal[];
  openingStock?: Numeric;
  closingStock?: Numeric;
}) {
  const inc = o.accounts.filter((a) => a.kind === 'income');
  const exp = o.accounts.filter((a) => a.kind === 'expense');
  const directIncome = lines(
    inc.filter((a) => a.group !== 'Indirect income'),
    income,
  );
  const indirectIncome = lines(
    inc.filter((a) => a.group === 'Indirect income'),
    income,
  );
  const directExpenses = lines(
    exp.filter((a) => a.group === 'Direct expense'),
    expense,
  );
  const indirectExpenses = lines(
    exp.filter((a) => a.group !== 'Direct expense'),
    expense,
  );
  const openingStock = r2(n(o.openingStock));
  const closingStock = r2(n(o.closingStock));
  const costOfSales = r2(openingStock + total(directExpenses) - closingStock);
  const grossProfit = r2(total(directIncome) - costOfSales);
  const netProfit = r2(grossProfit + total(indirectIncome) - total(indirectExpenses));
  return {
    directIncome,
    directExpenses,
    indirectIncome,
    indirectExpenses,
    totals: {
      directIncome: total(directIncome),
      directExpenses: total(directExpenses),
      indirectIncome: total(indirectIncome),
      indirectExpenses: total(indirectExpenses),
      openingStock,
      closingStock,
      costOfSales,
      grossProfit,
      netProfit,
    },
  };
}

// ---- Balance Sheet ----------------------------------------------------------------------------------------------------

/**
 * The Balance Sheet on a date from every account's balance up to it. Assets (with the closing stock), liabilities and
 * capital as booked; the profit split into earlier years and the current year (`currentProfit`, the P&L from the start
 * of the year); and the stock the items were opened with (`openingStock`, not in the ledger) as capital. Both sides are
 * equal whenever the ledger balances; any difference shows as "Difference in opening balances" so it is never hidden.
 */
export function balanceSheet(o: {
  accounts: AccountTotal[];
  closingStock?: Numeric;
  openingStock?: Numeric;
  currentProfit?: Numeric;
}) {
  const of = (kind: string) => o.accounts.filter((a) => a.kind === kind);
  const assets = lines(of('asset'), expense);
  const closingStock = r2(n(o.closingStock));
  if (closingStock) assets.push({ name: 'Closing stock', amount: closingStock });
  const liabilities = lines(of('liability'), income);
  const capital = lines(of('equity'), income);
  const openingStock = r2(n(o.openingStock));
  if (openingStock)
    capital.push({ name: 'Opening stock (capital introduced)', amount: openingStock });
  const allProfit = r2(
    of('income').reduce((s, a) => s + income(a), 0) -
      of('expense').reduce((s, a) => s + expense(a), 0) +
      closingStock -
      openingStock,
  );
  const currentProfit = r2(n(o.currentProfit));
  const retained = r2(allProfit - currentProfit);
  const profit = [
    ...(Math.abs(retained) >= 0.005
      ? [{ name: 'Retained earnings (earlier years)', amount: retained }]
      : []),
    { name: 'Net profit (current year)', amount: currentProfit },
  ];
  const assetTotal = total(assets);
  let liabilityTotal = r2(total(liabilities) + total(capital) + total(profit));
  const difference = r2(assetTotal - liabilityTotal);
  const suspense =
    Math.abs(difference) >= 0.005
      ? [{ name: 'Difference in opening balances', amount: difference }]
      : [];
  liabilityTotal = r2(liabilityTotal + total(suspense));
  return {
    assets,
    liabilities,
    capital,
    profit,
    suspense,
    totals: {
      assets: assetTotal,
      liabilities: liabilityTotal,
      difference,
      balanced: !suspense.length,
    },
  };
}

// ---- Cash Flow (direct method) ------------------------------------------------------------------------------------------

/** The cash-flow heading of a voucher's net effect on cash and bank, by what posted it. */
export function cashFlowCategory(refType: string, net: Numeric) {
  const inflow = n(net) > 0;
  switch (refType) {
    case 'invoice':
      return inflow ? 'Sales and money from customers' : 'Refunds to customers';
    case 'payment':
    case 'cheque':
      return inflow ? 'Money from customers' : 'Payments to suppliers';
    case 'purchase':
      return inflow ? 'Refunds from suppliers' : 'Purchases paid';
    case 'expense':
      return inflow ? 'Other income' : 'Expenses';
    case 'loan':
      return inflow ? 'Loans received' : 'Loans repaid';
    case 'loan_payment':
      return inflow ? 'Loans received' : 'Loan repayments and interest';
    case 'adjustment':
      return inflow ? 'Capital and adjustments in' : 'Drawings and adjustments out';
    case 'transfer':
      return 'Bank charges on transfers';
    case 'opening':
      return inflow ? 'Opening balances added' : 'Opening overdrafts';
    case 'journal':
      return 'Journals';
    default:
      return inflow ? 'Other money in' : 'Other money out';
  }
}

/**
 * Cash Flow of a period from the vouchers that touched cash or bank (`net` = their Σ debit − credit on cash and bank
 * accounts; a transfer between them nets to its fee). Opening + in − out = closing, which equals the Cash & Bank total.
 */
export function cashFlow(o: { opening: Numeric; vouchers: { refType: string; net: Numeric }[] }) {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const v of o.vouchers) {
    const net = r2(n(v.net));
    if (Math.abs(net) < 0.005) continue;
    const cat = cashFlowCategory(v.refType, net);
    const m = net > 0 ? inflow : outflow;
    m.set(cat, r2((m.get(cat) ?? 0) + Math.abs(net)));
  }
  const list = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  const moneyIn = list(inflow);
  const moneyOut = list(outflow);
  const totalIn = r2(moneyIn.reduce((s, x) => s + x.amount, 0));
  const totalOut = r2(moneyOut.reduce((s, x) => s + x.amount, 0));
  const opening = r2(n(o.opening));
  return {
    opening,
    moneyIn,
    moneyOut,
    totalIn,
    totalOut,
    net: r2(totalIn - totalOut),
    closing: r2(opening + totalIn - totalOut),
  };
}

// ---- ageing -------------------------------------------------------------------------------------------------------------

export const AGEING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** The bucket of a document dated `date`, seen on `asOf` (days since the date; a future date counts as 0). */
export function ageingBucket(date: string, asOf: string): AgeingBucket {
  const days = Math.max(
    0,
    Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000),
  );
  return days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
}

/** What is still due per party, split by age. Documents with nothing due are left out. */
export function ageing(
  docs: { partyId: string; partyName: string; date: string; due: Numeric }[],
  asOf: string,
) {
  const by = new Map<
    string,
    { partyId: string; partyName: string; total: number } & Record<AgeingBucket, number>
  >();
  for (const d of docs) {
    const due = r2(n(d.due));
    if (due <= 0.005 || d.date > asOf) continue;
    const row = by.get(d.partyId) ?? {
      partyId: d.partyId,
      partyName: d.partyName,
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
      total: 0,
    };
    const b = ageingBucket(d.date, asOf);
    row[b] = r2(row[b] + due);
    row.total = r2(row.total + due);
    by.set(d.partyId, row);
  }
  return [...by.values()].sort((a, b) => b.total - a.total);
}

// ---- scheduled reports (P6-S8) ---------------------------------------------------------------------------------------

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/**
 * The last complete period before `today` for a schedule: weekly = the Monday to Sunday week before this one, monthly =
 * the calendar month before this one. `key` names it ('2026-11-02..2026-11-08'), so a schedule that has already sent
 * that key does not send again however often the runner wakes (idempotent across restarts).
 */
export function previousPeriod(frequency: 'weekly' | 'monthly', today: string) {
  const t = utc(today);
  if (frequency === 'weekly') {
    const sinceMonday = (t.getUTCDay() + 6) % 7;
    const thisMonday = new Date(t);
    thisMonday.setUTCDate(t.getUTCDate() - sinceMonday);
    const from = new Date(thisMonday);
    from.setUTCDate(from.getUTCDate() - 7);
    const to = new Date(thisMonday);
    to.setUTCDate(to.getUTCDate() - 1);
    return { from: ymd(from), to: ymd(to), key: `${ymd(from)}..${ymd(to)}` };
  }
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
  return { from: ymd(first), to: ymd(last), key: `${ymd(first)}..${ymd(last)}` };
}
