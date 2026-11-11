// Vyapar parity P4-S4: backfill. Posts every existing document of a business into the ledger, checks that the party
// balances the ledger gives equal the ones worked out from the documents, and only then turns the ledger on.
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  PostingError,
  getFinancialYearLabel,
  parseLocalDate,
  postOpening,
  trialBalance,
  type AccountKind,
} from '@ledgora/tax-engine';
import { postingsFor, repost, seedChart, setLedgerFlag, type LedgerKind } from './ledgerRules.ts';

const { invoices, purchases, payments, expenses, parties, ledgerEntries, accounts, cheques } =
  schema;
const r2 = (n: number) => Math.round(n * 100) / 100;
const SALE_TYPES = ['tax-invoice', 'bill-of-supply', 'composition'];

/** Thrown inside a savepoint to undo everything the savepoint did while still returning the result. */
class Rollback<T> extends Error {
  readonly value: T;
  constructor(value: T) {
    super('rollback');
    this.value = value;
  }
}
/** Runs `fn` in a savepoint. `keep(result)` false = undo its writes; the result is returned either way. */
async function attempt<T>(tx: Tx, fn: (sp: Tx) => Promise<T>, keep: (r: T) => boolean): Promise<T> {
  try {
    return await tx.transaction(async (sp) => {
      const r = await fn(sp as unknown as Tx);
      if (!keep(r)) throw new Rollback(r);
      return r;
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
}

// ---- party balances, two independent ways -------------------------------------------------------------------------------

/**
 * What each party owes us (receivable) and what we owe each (payable), worked out from the documents alone, by the
 * outstanding rules and without the posting functions, so comparing it with the ledger is a real check. A party that is
 * both a customer and a supplier has a balance in each.
 */
export async function documentBalances(tx: Tx, businessId: string) {
  const inv = await tx
    .select({
      party: invoices.partyId,
      type: invoices.invoiceType,
      status: invoices.status,
      total: invoices.total,
    })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), isNull(invoices.deletedAt)));
  const pur = await tx
    .select({
      party: purchases.supplierId,
      type: purchases.docType,
      total: purchases.total,
      tds: purchases.tdsAmount,
      rcm: purchases.reverseCharge,
      tax: sql<number>`(${purchases.cgst} + ${purchases.sgst} + ${purchases.igst} + ${purchases.cess})::float8`,
    })
    .from(purchases)
    .where(and(eq(purchases.businessId, businessId), isNull(purchases.deletedAt)));
  const pay = await tx
    .select({
      party: payments.partyId,
      dir: payments.direction,
      source: payments.source,
      amount: payments.amount,
      tds: payments.tdsAmount,
      disc: payments.discountAmount,
    })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), isNull(payments.deletedAt)));
  const recv = new Map<string, number>();
  const payable = new Map<string, number>();
  const add = (m: Map<string, number>, k: string | null, v: number) =>
    k && m.set(k, r2((m.get(k) ?? 0) + v));
  // A party's opening balance: positive = they owe us, negative = we owe them (the sign the credit-limit check reads).
  for (const p of await tx
    .select({ id: parties.id, opening: parties.openingBalance })
    .from(parties)
    .where(isNull(parties.deletedAt))) {
    if (p.opening > 0) add(recv, p.id, p.opening);
    else if (p.opening < 0) add(payable, p.id, -p.opening);
  }
  for (const i of inv) {
    if (i.status === 'cancelled' || !(i.total > 0)) continue;
    if (SALE_TYPES.includes(i.type)) add(recv, i.party, i.total);
    else if (i.type === 'credit-note') add(recv, i.party, -i.total);
  }
  for (const p of pur) {
    if (p.type === 'order') continue;
    if (p.type === 'debit-note') add(payable, p.party, -p.total);
    else add(payable, p.party, p.total - p.tds - (p.rcm ? p.tax : 0));
  }
  for (const p of pay) {
    const settled = p.amount + p.tds + p.disc;
    if (p.source === 'credit_note_refund') add(recv, p.party, p.amount);
    else if (p.source === 'debit_note_refund') add(payable, p.party, p.amount);
    else if (p.dir === 'out') add(payable, p.party, -settled);
    else add(recv, p.party, -settled);
  }
  // Phase 5: a received cheque that bounced with its charges put on the party: they owe the charges too. (The bounced
  // cheque's payment is voided, so it is not in `pay` above.)
  for (const c of await tx
    .select({ party: cheques.partyId, charges: cheques.bounceCharges })
    .from(cheques)
    .where(
      and(
        eq(cheques.businessId, businessId),
        isNull(cheques.deletedAt),
        eq(cheques.direction, 'received'),
        eq(cheques.status, 'bounced'),
        eq(cheques.chargeTo, 'party'),
      ),
    ))
    if (c.charges > 0) add(recv, c.party, c.charges);
  return { recv, payable };
}

/** The same two balances from the ledger: Dr − Cr on Receivable, Cr − Dr on Payable, per party. */
export async function ledgerBalances(tx: Tx, businessId: string) {
  const rows = await tx
    .select({
      party: ledgerEntries.partyId,
      code: accounts.code,
      debit: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)::float8`,
      credit: sql<number>`coalesce(sum(${ledgerEntries.credit}), 0)::float8`,
    })
    .from(ledgerEntries)
    .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
    .where(and(eq(ledgerEntries.businessId, businessId), inArray(accounts.code, ['1300', '2000'])))
    .groupBy(ledgerEntries.partyId, accounts.code);
  const recv = new Map<string, number>();
  const payable = new Map<string, number>();
  for (const r of rows) {
    if (!r.party) continue;
    if (r.code === '1300') recv.set(r.party, r2(r.debit - r.credit));
    else payable.set(r.party, r2(r.credit - r.debit));
  }
  return { recv, payable };
}

/** Parties whose two balances differ. */
export async function partyDiffs(tx: Tx, businessId: string) {
  const [d, l] = await Promise.all([
    documentBalances(tx, businessId),
    ledgerBalances(tx, businessId),
  ]);
  const names = new Map(
    (await tx.select({ id: parties.id, name: parties.name }).from(parties)).map((p) => [
      p.id,
      p.name,
    ]),
  );
  const out: { partyId: string; name: string; ledger: number; documents: number }[] = [];
  for (const [label, docs, led] of [
    ['receivable', d.recv, l.recv],
    ['payable', d.payable, l.payable],
  ] as const)
    for (const id of new Set([...docs.keys(), ...led.keys()])) {
      const doc = docs.get(id) ?? 0;
      const lg = led.get(id) ?? 0;
      if (Math.abs(doc - lg) > 0.005)
        out.push({
          partyId: id,
          name: `${names.get(id) ?? id} (${label})`,
          ledger: lg,
          documents: doc,
        });
    }
  return out;
}

/** Σ debit and Σ credit per account of a business, for the trial balance. */
export async function accountTotals(tx: Tx, businessId: string, asOf?: string, fromDate?: string) {
  const conds = [eq(ledgerEntries.businessId, businessId)];
  if (asOf) conds.push(sql`${ledgerEntries.txnDate} <= ${asOf}`);
  if (fromDate) conds.push(gte(ledgerEntries.txnDate, fromDate));
  return tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      debit: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)::float8`,
      credit: sql<number>`coalesce(sum(${ledgerEntries.credit}), 0)::float8`,
    })
    .from(accounts)
    .leftJoin(ledgerEntries, and(eq(ledgerEntries.accountId, accounts.id), ...conds))
    .where(and(eq(accounts.businessId, businessId), isNull(accounts.deletedAt)))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.kind);
}

export async function trialBalanceOf(tx: Tx, businessId: string, asOf?: string, fromDate?: string) {
  const rows = await accountTotals(tx, businessId, asOf, fromDate);
  return trialBalance(
    rows.map((r) => ({
      code: r.code,
      name: r.name,
      kind: r.kind as AccountKind,
      debit: r.debit,
      credit: r.credit,
    })),
  );
}

// ---- party opening balances ----------------------------------------------------------------------------------------------

/** The day opening balances are dated: the start of the financial year of the business's first document. */
async function openingDate(tx: Tx, businessId: string) {
  const firsts = await Promise.all([
    tx
      .select({ d: sql<string | null>`min(${invoices.invoiceDate})` })
      .from(invoices)
      .where(eq(invoices.businessId, businessId)),
    tx
      .select({ d: sql<string | null>`min(${purchases.purchaseDate})` })
      .from(purchases)
      .where(eq(purchases.businessId, businessId)),
    tx
      .select({ d: sql<string | null>`min(${payments.paymentDate})` })
      .from(payments)
      .where(eq(payments.businessId, businessId)),
    tx
      .select({ d: sql<string | null>`min(${expenses.expenseDate})` })
      .from(expenses)
      .where(eq(expenses.businessId, businessId)),
  ]);
  const first = [
    new Date().toISOString().slice(0, 10),
    ...firsts.map((f) => f[0]?.d).filter((d): d is string => !!d),
  ].sort()[0];
  return `${getFinancialYearLabel(parseLocalDate(first)).slice(0, 4)}-04-01`;
}

/**
 * Posts the opening balance of every party (Dr Receivable for a positive one, Cr Payable for a negative one, against
 * Opening Balance Equity) and takes back one that was posted for a party whose balance is now zero or who is deleted.
 * Parties are shared by the organization's businesses, so this posts into the business being backfilled. Returns how
 * many vouchers changed. Account openings (made with Add Account) are never touched: they carry no party.
 */
export async function postPartyOpenings(tx: Tx, orgId: string, businessId: string) {
  const date = await openingDate(tx, businessId);
  const list = await tx
    .select({ id: parties.id, opening: parties.openingBalance })
    .from(parties)
    .where(isNull(parties.deletedAt));
  let changed = 0;
  for (const p of list) {
    const amount = Math.abs(p.opening);
    const postings =
      amount > 0
        ? postOpening({
            id: p.id,
            date,
            account: p.opening > 0 ? '1300' : '2000',
            amount,
            side: p.opening > 0 ? 'Dr' : 'Cr',
            partyId: p.id,
          })
        : [];
    if (
      (await repost(tx, orgId, { businessId, refType: 'opening', refId: p.id, postings })).changed
    )
      changed++;
  }
  const posted = await tx
    .selectDistinct({ id: ledgerEntries.refId })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.businessId, businessId),
        eq(ledgerEntries.refType, 'opening'),
        sql`${ledgerEntries.partyId} is not null`,
      ),
    );
  const live = new Set(list.map((p) => p.id));
  for (const { id } of posted)
    if (
      !live.has(id) &&
      (await repost(tx, orgId, { businessId, refType: 'opening', refId: id, postings: [] })).changed
    )
      changed++;
  return changed;
}

// ---- the backfill ------------------------------------------------------------------------------------------------------------

export interface BackfillResult {
  dryRun: boolean;
  documents: number;
  vouchers: number;
  problems: { kind: string; id: string; label: string; message: string }[];
  diffs: { partyId: string; name: string; ledger: number; documents: number }[];
  trialBalance: { debit: number; credit: number; balanced: boolean } | null;
  enabled: boolean;
}

/** Every document of the business that posts, oldest first: invoices, purchases, payments, expenses. */
export async function documents(tx: Tx, businessId: string, from?: string) {
  const dateFilter = (col: Parameters<typeof gte>[0]) => (from ? gte(col, from) : undefined);
  const live = <T extends { deletedAt: unknown }>(t: T) => isNull(t.deletedAt as never);
  const [inv, pur, pay, exp] = await Promise.all([
    tx
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.businessId, businessId), live(invoices), dateFilter(invoices.invoiceDate)),
      )
      .orderBy(asc(invoices.invoiceDate), asc(invoices.id)),
    tx
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.businessId, businessId),
          live(purchases),
          dateFilter(purchases.purchaseDate),
        ),
      )
      .orderBy(asc(purchases.purchaseDate), asc(purchases.id)),
    tx
      .select()
      .from(payments)
      .where(
        and(eq(payments.businessId, businessId), live(payments), dateFilter(payments.paymentDate)),
      )
      .orderBy(asc(payments.paymentDate), asc(payments.id)),
    tx
      .select()
      .from(expenses)
      .where(
        and(eq(expenses.businessId, businessId), live(expenses), dateFilter(expenses.expenseDate)),
      )
      .orderBy(asc(expenses.expenseDate), asc(expenses.id)),
  ]);
  return [
    ...inv.map((row) => ({ kind: 'invoice' as LedgerKind, row, label: row.number })),
    ...pur.map((row) => ({
      kind: 'purchase' as LedgerKind,
      row,
      label: row.number || row.invoiceNumber,
    })),
    ...pay.map((row) => ({
      kind: 'payment' as LedgerKind,
      row,
      label: row.number || row.reference,
    })),
    ...exp.map((row) => ({
      kind: 'expense' as LedgerKind,
      row,
      label: row.number || row.description,
    })),
  ];
}

/**
 * Seeds the chart, posts every document, then checks the books: the trial balance balances and every party's ledger
 * balance equals the one from the documents. Writes nothing when `dryRun`, or when there are problems and `force` is not
 * set (the work is rolled back, so a half-posted ledger is never left behind). Idempotent: a second run changes nothing.
 * The ledger is switched on only when the checks are clean (or forced).
 */
export async function backfillLedger(
  tx: Tx,
  orgId: string,
  o: { businessId: string; dryRun: boolean; force: boolean; from?: string },
): Promise<BackfillResult> {
  const result = await attempt<BackfillResult>(
    tx,
    async (sp) => {
      await seedChart(sp, orgId, o.businessId);
      const docs = await documents(sp, o.businessId, o.from);
      const problems: BackfillResult['problems'] = [];
      let vouchers = await postPartyOpenings(sp, orgId, o.businessId);
      for (const d of docs) {
        try {
          const postings = await postingsFor(sp, orgId, d.kind, d.row as never);
          const r = await repost(sp, orgId, {
            businessId: o.businessId,
            refType: d.kind,
            refId: d.row.id,
            postings,
          });
          vouchers += r.vouchers;
        } catch (e) {
          if (!(e instanceof PostingError)) throw e;
          problems.push({
            kind: d.kind,
            id: d.row.id,
            label: String(d.label ?? ''),
            message: e.message,
          });
        }
      }
      const diffs = await partyDiffs(sp, o.businessId);
      const tb = await trialBalanceOf(sp, o.businessId);
      return {
        dryRun: o.dryRun,
        documents: docs.length,
        vouchers,
        problems,
        diffs,
        trialBalance: { debit: tb.debit, credit: tb.credit, balanced: tb.balanced },
        enabled: false,
      };
    },
    (r) =>
      !o.dryRun &&
      (o.force || (r.problems.length === 0 && r.diffs.length === 0 && !!r.trialBalance?.balanced)),
  );
  const clean =
    result.problems.length === 0 && result.diffs.length === 0 && !!result.trialBalance?.balanced;
  if (!o.dryRun && (clean || o.force)) {
    await setLedgerFlag(tx, orgId, o.businessId, true);
    return { ...result, enabled: true };
  }
  return result;
}

/** Reposts every posting document of a business (the fix for ledger_missing and the like). Returns how many changed. */
export async function repostDocuments(tx: Tx, orgId: string, businessId: string) {
  let changed = await postPartyOpenings(tx, orgId, businessId);
  for (const d of await documents(tx, businessId)) {
    const postings = await postingsFor(tx, orgId, d.kind, d.row as never);
    const r = await repost(tx, orgId, { businessId, refType: d.kind, refId: d.row.id, postings });
    if (r.changed) changed++;
  }
  return changed;
}
