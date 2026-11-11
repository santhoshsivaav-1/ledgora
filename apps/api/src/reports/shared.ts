// Helpers the ledger reports share: money accounts, entries with reversed pairs left out, document references, the
// account totals of a period and stock valuation (weighted average, tax-engine reports.ts).
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  ACC,
  getFinancialYearLabel,
  parseLocalDate,
  stockValuation,
  type StockMove,
} from '@ledgora/tax-engine';
import { accountTotals } from '../modules/ledgerBackfill.ts';

const {
  accounts,
  ledgerEntries,
  invoices,
  purchases,
  purchaseLines,
  payments,
  expenses,
  cheques,
  transfers,
  items,
  stockMovements,
} = schema;
export const r2 = (n: number) => Math.round(n * 100) / 100;

export const dayBefore = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};
export const today = () => new Date().toISOString().slice(0, 10);
/** 1 April of the financial year `date` is in. */
export const fyStartOf = (date: string) =>
  `${getFinancialYearLabel(parseLocalDate(date)).slice(0, 4)}-04-01`;

/** Cash in Hand and every bank (including "not assigned"): the accounts money sits in. */
export async function moneyAccountIds(tx: Tx, businessId: string) {
  const rows = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.businessId, businessId),
        or(eq(accounts.code, ACC.CASH), eq(accounts.group, 'Bank')),
      ),
    );
  return rows.map((r) => r.id);
}

/** Σ (debit − credit) of some accounts, optionally before a date (exclusive) or up to one (inclusive). */
export async function netOf(tx: Tx, ids: string[], o: { before?: string; upTo?: string } = {}) {
  if (!ids.length) return 0;
  const [r] = await tx
    .select({
      v: sql<number>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)::float8`,
    })
    .from(ledgerEntries)
    .where(
      and(
        inArray(ledgerEntries.accountId, ids),
        o.before ? sql`${ledgerEntries.txnDate} < ${o.before}` : undefined,
        o.upTo ? lte(ledgerEntries.txnDate, o.upTo) : undefined,
      ),
    );
  return r2(r.v);
}

/**
 * Entries of a business in a period, oldest first, without corrections: a reversal and the entry it reversed are both
 * left out (they net to nothing and are dated alike), so a report shows what the books say now.
 */
export async function liveEntries(tx: Tx, businessId: string, from?: string, to?: string) {
  const rows = await tx
    .select({ e: ledgerEntries, code: accounts.code, group: accounts.group })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(
      and(
        eq(ledgerEntries.businessId, businessId),
        from ? gte(ledgerEntries.txnDate, from) : undefined,
        to ? lte(ledgerEntries.txnDate, to) : undefined,
      ),
    )
    .orderBy(asc(ledgerEntries.txnDate), asc(ledgerEntries.createdAt));
  const reversed = new Set(rows.map((r) => r.e.reversalOf).filter(Boolean));
  return rows.filter((r) => !r.e.reversalOf && !reversed.has(r.e.id));
}

/** The number people know a document by, per (refType, refId). */
export async function refNumbers(tx: Tx, refs: { refType: string; refId: string }[]) {
  const out = new Map<string, { number: string; mode?: string }>();
  const ids = (t: string) => [...new Set(refs.filter((r) => r.refType === t).map((r) => r.refId))];
  const put = (t: string, id: string, number: string, mode?: string) =>
    out.set(`${t}:${id}`, { number, mode });
  const inv = ids('invoice');
  if (inv.length)
    for (const r of await tx
      .select({ id: invoices.id, n: invoices.number })
      .from(invoices)
      .where(inArray(invoices.id, inv)))
      put('invoice', r.id, r.n);
  const pur = ids('purchase');
  if (pur.length)
    for (const r of await tx
      .select({ id: purchases.id, n: purchases.number, b: purchases.invoiceNumber })
      .from(purchases)
      .where(inArray(purchases.id, pur)))
      put('purchase', r.id, r.n || r.b);
  const pay = ids('payment');
  if (pay.length)
    for (const r of await tx
      .select({ id: payments.id, n: payments.number, m: payments.mode })
      .from(payments)
      .where(inArray(payments.id, pay)))
      put('payment', r.id, r.n, r.m);
  const exp = ids('expense');
  if (exp.length)
    for (const r of await tx
      .select({ id: expenses.id, n: expenses.number, m: expenses.paymentMode })
      .from(expenses)
      .where(inArray(expenses.id, exp)))
      put('expense', r.id, r.n, r.m);
  const chq = ids('cheque');
  if (chq.length)
    for (const r of await tx
      .select({ id: cheques.id, n: cheques.number })
      .from(cheques)
      .where(inArray(cheques.id, chq)))
      put('cheque', r.id, r.n, 'cheque');
  const tr = ids('transfer');
  if (tr.length)
    for (const r of await tx
      .select({ id: transfers.id, n: transfers.reference })
      .from(transfers)
      .where(inArray(transfers.id, tr)))
      put('transfer', r.id, r.n);
  return out;
}

/** A label for the type of a ledger posting. */
export const REF_LABELS: Record<string, string> = {
  invoice: 'Sale',
  purchase: 'Purchase',
  payment: 'Payment',
  expense: 'Expense',
  cheque: 'Cheque',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
  loan: 'Loan',
  loan_payment: 'Loan payment',
  loan_interest: 'Interest credited',
  opening: 'Opening balance',
  journal: 'Journal',
  fy_close: 'Year-end closing',
};

/** Every account of the business with its group and its totals in a period (or up to a date). */
export async function totalsWithGroup(tx: Tx, businessId: string, from?: string, to?: string) {
  const t = await accountTotals(tx, businessId, to, from);
  const groups = new Map(
    (
      await tx
        .select({ id: accounts.id, group: accounts.group })
        .from(accounts)
        .where(eq(accounts.businessId, businessId))
    ).map((a) => [a.id, a.group]),
  );
  return t.map((a) => ({ ...a, group: groups.get(a.id) ?? '' }));
}

/**
 * Stock movements of every tracked item as dated, costed moves: a purchase at its line's landed cost (or taxable value
 * per unit), opening stock at the item's purchase price, everything else at the running average. A movement is dated
 * by its document (bill or invoice date), else the day it was recorded. Items belong to the organization, so the
 * valuation is the organization's stock.
 */
export async function stockMoves(tx: Tx) {
  const its = await tx
    .select({ id: items.id, price: items.purchasePrice, track: items.trackStock })
    .from(items)
    .where(isNull(items.deletedAt));
  const tracked = new Map(its.filter((i) => i.track).map((i) => [i.id, i.price]));
  if (!tracked.size)
    return {
      moves: [] as { id: string; moves: StockMove[] }[],
      openings: [] as { date: string; value: number }[],
      prices: tracked,
    };
  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      qty: stockMovements.quantity,
      reason: stockMovements.reason,
      refType: stockMovements.refType,
      refId: stockMovements.refId,
      movedAt: sql<string>`(${stockMovements.movedAt} at time zone 'Asia/Kolkata')::date::text`,
      billDate: purchases.purchaseDate,
      invoiceDate: invoices.invoiceDate,
    })
    .from(stockMovements)
    .leftJoin(
      purchases,
      and(eq(stockMovements.refType, 'purchase'), eq(purchases.id, stockMovements.refId)),
    )
    .leftJoin(
      invoices,
      and(eq(stockMovements.refType, 'invoice'), eq(invoices.id, stockMovements.refId)),
    )
    .where(
      and(isNull(stockMovements.deletedAt), inArray(stockMovements.itemId, [...tracked.keys()])),
    )
    .orderBy(asc(stockMovements.movedAt));
  const billIds = [
    ...new Set(rows.filter((r) => r.reason === 'purchase' && r.refId).map((r) => r.refId!)),
  ];
  const cost = new Map<string, number>();
  if (billIds.length) {
    const acc = new Map<string, { q: number; v: number }>();
    for (const l of await tx
      .select()
      .from(purchaseLines)
      .where(and(inArray(purchaseLines.purchaseId, billIds), isNull(purchaseLines.deletedAt)))) {
      if (!l.itemId || !(l.quantity > 0)) continue;
      const k = `${l.purchaseId}:${l.itemId}`;
      const unit =
        l.landedCost > 0
          ? l.landedCost
          : l.taxableAmount > 0
            ? l.taxableAmount / l.quantity
            : l.rate;
      const a = acc.get(k) ?? { q: 0, v: 0 };
      acc.set(k, { q: a.q + l.quantity, v: a.v + unit * l.quantity });
    }
    for (const [k, a] of acc) cost.set(k, a.q > 0 ? a.v / a.q : 0);
  }
  const byItem = new Map<string, StockMove[]>();
  const openings: { date: string; value: number }[] = [];
  for (const r of rows) {
    const date = r.billDate ?? r.invoiceDate ?? r.movedAt;
    const unitCost =
      r.reason === 'purchase' && r.refId
        ? (cost.get(`${r.refId}:${r.itemId}`) ?? null)
        : r.reason === 'opening'
          ? (tracked.get(r.itemId) ?? 0)
          : null;
    if (r.reason === 'opening')
      openings.push({ date, value: r.qty * (tracked.get(r.itemId) ?? 0) });
    const list = byItem.get(r.itemId) ?? [];
    list.push({ date, qty: r.qty, unitCost });
    byItem.set(r.itemId, list);
  }
  for (const list of byItem.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return {
    moves: [...byItem.entries()].map(([id, moves]) => ({ id, moves })),
    openings,
    /** Purchase price of every tracked item: what a unit is costed at when it has no purchase history. */
    prices: tracked,
  };
}

/**
 * Stock values the statements need: on `asOf` (closing), on `before` (the eve of a period, its opening stock), and the
 * value the items were opened with (their opening quantities at purchase price; never posted, so it stands as capital).
 */
export async function stockFigures(tx: Tx, asOf: string, before?: string) {
  const { moves, openings } = await stockMoves(tx);
  return {
    closing: stockValuation(moves, asOf).total,
    before: before ? stockValuation(moves, before).total : 0,
    initial: r2(openings.filter((o) => o.date <= asOf).reduce((s, o) => s + o.value, 0)),
  };
}

/**
 * What had been paid against each invoice or bill by the end of `asOf`: allocations of payments dated on or before it.
 * Ageing "as of a past date" needs this, not the paid amount of today.
 */
export async function paidAsOf(tx: Tx, kind: 'invoice' | 'purchase', ids: string[], asOf: string) {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const col =
    kind === 'invoice' ? schema.paymentAllocations.invoiceId : schema.paymentAllocations.purchaseId;
  const rows = await tx
    .select({
      id: col,
      v: sql<number>`coalesce(sum(${schema.paymentAllocations.amount}), 0)::float8`,
    })
    .from(schema.paymentAllocations)
    .innerJoin(payments, eq(payments.id, schema.paymentAllocations.paymentId))
    .where(
      and(
        inArray(col, ids),
        isNull(schema.paymentAllocations.deletedAt),
        isNull(payments.deletedAt),
        lte(payments.paymentDate, asOf),
      ),
    )
    .groupBy(col);
  for (const r of rows) if (r.id) out.set(r.id, r2(r.v));
  return out;
}

/** CSV-safe text: quotes around anything with a comma, quote or newline; a leading =,+,-,@ is defused (spreadsheet formulas). */
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
