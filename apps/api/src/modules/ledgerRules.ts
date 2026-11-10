// Vyapar parity Phase 4: the server side of the ledger. The decisions are the pure functions in @ledgora/tax-engine
// (posting.ts); this file reads the documents they need and writes what they return, in the caller's transaction, so a
// document and its postings are saved or refused together. Nothing outside `repost()` writes to ledger_entries.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  ACC,
  DEFAULT_CHART,
  debitNoteItcReversal,
  getFinancialYearLabel,
  itcSplit,
  parseLocalDate,
  postExpense,
  postInvoice,
  postPayment,
  postPurchase,
  type PostCtx,
  type Posting,
} from '@ledgora/tax-engine';

const {
  accounts,
  ledgerEntries,
  businessSettings,
  invoices,
  purchases,
  purchaseLines,
  payments,
  expenses,
  expenseCategories,
  paymentAccounts,
} = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---- the flag and the chart -----------------------------------------------------------------------------------------

type Prefs = { accounting?: { ledger?: boolean; enabledAt?: string } } & Record<string, unknown>;

/** `accounting.ledger`, per business (business_settings.preferences.accounting.ledger). Off = documents behave as before. */
export async function ledgerEnabled(tx: Tx, businessId: string) {
  const [s] = await tx
    .select({ p: businessSettings.preferences })
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  return !!(s?.p as Prefs | undefined)?.accounting?.ledger;
}

export async function setLedgerFlag(tx: Tx, orgId: string, businessId: string, on: boolean) {
  const [s] = await tx
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  const prev = (s?.preferences ?? {}) as Prefs;
  const preferences: Prefs = {
    ...prev,
    accounting: {
      ...prev.accounting,
      ledger: on,
      ...(on ? { enabledAt: new Date().toISOString() } : {}),
    },
  };
  if (s)
    await tx
      .update(businessSettings)
      .set({ preferences, updatedAt: new Date() })
      .where(eq(businessSettings.id, s.id));
  else await tx.insert(businessSettings).values({ orgId, businessId, preferences });
}

/** Seeds the default chart for a business. Idempotent: existing codes are left alone. Returns how many were added. */
export async function seedChart(tx: Tx, orgId: string, businessId: string) {
  const rows = await tx
    .insert(accounts)
    .values(
      DEFAULT_CHART.map((a) => ({
        orgId,
        businessId,
        code: a.code,
        name: a.name,
        group: a.group,
        kind: a.kind,
        system: a.system,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: accounts.id });
  return rows.length;
}

export async function accountsByCode(tx: Tx, businessId: string) {
  const rows = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, businessId), isNull(accounts.deletedAt)));
  return new Map(rows.map((a) => [a.code, a]));
}

export async function nextCode(tx: Tx, businessId: string, from: number, to: number) {
  const rows = await tx
    .select({ code: accounts.code })
    .from(accounts)
    .where(eq(accounts.businessId, businessId));
  const used = rows.map((r) => Number(r.code)).filter((c) => c >= from && c <= to);
  return String(Math.min(to, used.length ? Math.max(...used) + 1 : from));
}

/**
 * A bank account's chart account (1101…), created the first time a payment names it. The payment account's label
 * names it. Phase 5 (Cash & Bank) will own these; until then they appear on demand.
 */
async function ensureBankAccount(tx: Tx, orgId: string, businessId: string, bankId: string) {
  const [found] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, businessId), eq(accounts.bankAccountId, bankId)));
  if (found) return found.code;
  const [pa] = await tx
    .select({ label: paymentAccounts.label })
    .from(paymentAccounts)
    .where(eq(paymentAccounts.id, bankId));
  if (!pa) return null;
  const code = await nextCode(tx, businessId, 1101, 1189);
  await tx
    .insert(accounts)
    .values({
      orgId,
      businessId,
      code,
      name: pa.label,
      group: 'Bank',
      kind: 'asset',
      bankAccountId: bankId,
    })
    .onConflictDoNothing();
  return code;
}

/** An expense category's own account (5101…): "one account per expense category", created on first use. */
async function ensureCategoryAccount(
  tx: Tx,
  orgId: string,
  businessId: string,
  categoryId: string,
) {
  const [found] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, businessId), eq(accounts.categoryId, categoryId)));
  if (found) return found.code;
  const [c] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, categoryId));
  if (!c || c.kind === 'income') return null;
  const code = await nextCode(tx, businessId, 5101, 5199);
  await tx
    .insert(accounts)
    .values({
      orgId,
      businessId,
      code,
      name: c.name,
      group: c.kind === 'direct' ? 'Direct expense' : 'Indirect expense',
      kind: 'expense',
      categoryId,
    })
    .onConflictDoNothing();
  return code;
}

/** What the pure posting functions need that is not on the document: bank and category accounts. */
export async function buildCtx(
  tx: Tx,
  orgId: string,
  businessId: string,
  refs: { bankIds?: (string | null | undefined)[]; categoryId?: string | null } = {},
): Promise<PostCtx> {
  const banks = new Map<string, string>();
  for (const id of new Set((refs.bankIds ?? []).filter((x): x is string => !!x))) {
    const code = await ensureBankAccount(tx, orgId, businessId, id);
    if (code) banks.set(id, code);
  }
  const cat = refs.categoryId
    ? await ensureCategoryAccount(tx, orgId, businessId, refs.categoryId)
    : null;
  return {
    bankAccount: (id) => (id ? banks.get(id) : undefined),
    expenseAccount: (id) => (id && id === refs.categoryId ? cat : undefined),
  };
}

// ---- repost ------------------------------------------------------------------------------------------------------------

const fyOf = (date: string) => getFinancialYearLabel(parseLocalDate(date));

/**
 * Makes the ledger say what `postings` say for one document (refType, refId): the vouchers it has now are reversed (a
 * counter-entry with swapped sides, `reversal_of` set, dated like the original) and the new ones inserted. A document
 * whose postings did not change is left alone, so running this twice, or saving an edit that changes no money, writes
 * nothing. Delete = repost with no postings. Append-only: no row is ever updated or removed.
 */
export async function repost(
  tx: Tx,
  orgId: string,
  o: { businessId: string; refType: string; refId: string; postings: Posting[] },
) {
  const chart = await accountsByCode(tx, o.businessId);
  const idOf = (code: string) => {
    const a = chart.get(code);
    if (!a) throw new Error(`The ledger has no account ${code}; enable the ledger first`);
    return a.id;
  };
  const existing = await tx
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.refType, o.refType), eq(ledgerEntries.refId, o.refId)))
    .orderBy(asc(ledgerEntries.createdAt));
  const reversed = new Set(existing.map((e) => e.reversalOf).filter(Boolean));
  const active = existing.filter((e) => !e.reversalOf && !reversed.has(e.id));

  const sig = (
    rows: {
      date: string;
      account: string;
      debit: number;
      credit: number;
      party: string;
      note: string;
    }[],
  ) => rows.map((r) => `${r.date}|${r.account}|${r.debit}|${r.credit}|${r.party}|${r.note}`).sort();
  const before = sig(
    active.map((e) => ({
      date: e.txnDate,
      account: e.accountId,
      debit: e.debit,
      credit: e.credit,
      party: e.partyId ?? '',
      note: e.narration,
    })),
  );
  const after = sig(
    o.postings.flatMap((p) =>
      p.lines.map((l) => ({
        date: p.date,
        account: idOf(l.account),
        debit: r2(l.debit ?? 0),
        credit: r2(l.credit ?? 0),
        party: l.partyId ?? '',
        note: l.narration ?? '',
      })),
    ),
  );
  if (before.length === after.length && before.every((v, i) => v === after[i]))
    return { changed: false, vouchers: 0 };

  const rows: (typeof ledgerEntries.$inferInsert)[] = [];
  const base = { orgId, businessId: o.businessId, refType: o.refType, refId: o.refId };
  const reversalVoucher = new Map<string, string>();
  for (const e of active) {
    const v = reversalVoucher.get(e.voucherId) ?? randomUUID();
    reversalVoucher.set(e.voucherId, v);
    rows.push({
      ...base,
      txnDate: e.txnDate,
      accountId: e.accountId,
      debit: e.credit,
      credit: e.debit,
      voucherId: v,
      partyId: e.partyId,
      narration: e.narration ? `Reversal: ${e.narration}` : 'Reversal',
      fy: e.fy,
      reversalOf: e.id,
    });
  }
  for (const p of o.postings) {
    const voucherId = randomUUID();
    for (const l of p.lines)
      rows.push({
        ...base,
        txnDate: p.date,
        accountId: idOf(l.account),
        debit: r2(l.debit ?? 0),
        credit: r2(l.credit ?? 0),
        voucherId,
        partyId: l.partyId ?? null,
        narration: l.narration ?? '',
        fy: fyOf(p.date),
      });
  }
  if (rows.length) await tx.insert(ledgerEntries).values(rows);
  return { changed: true, vouchers: reversalVoucher.size + o.postings.length };
}

// ---- document builders -------------------------------------------------------------------------------------------------

type InvoiceRow = typeof invoices.$inferSelect;
type PurchaseRow = typeof purchases.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
const heads = (h: { cgst: number; sgst: number; igst: number; cess: number }) => ({
  cgst: r2(h.cgst),
  sgst: r2(h.sgst),
  igst: r2(h.igst),
  cess: r2(h.cess),
});

export async function invoicePostings(tx: Tx, orgId: string, row: InvoiceRow): Promise<Posting[]> {
  if (row.deletedAt) return [];
  const t =
    (
      (row.data ?? {}) as {
        totals?: { tcsAmount?: number; roundOff?: number; chargesTotal?: number };
      }
    ).totals ?? {};
  const pays = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.invoiceId, row.id), isNull(payments.deletedAt)));
  const ctx = await buildCtx(tx, orgId, row.businessId, { bankIds: pays.map((p) => p.accountId) });
  const as = (p: PaymentRow) => ({
    amount: p.amount,
    mode: p.mode,
    accountId: p.accountId,
    date: p.paymentDate,
  });
  return postInvoice(
    {
      ...row,
      tcsAmount: t.tcsAmount,
      roundOff: t.roundOff,
      chargesTaxable: t.chargesTotal,
      payments: pays.filter((p) => p.source === 'invoice_inline').map(as),
      refunds: pays.filter((p) => p.source === 'credit_note_refund').map(as),
    },
    ctx,
  );
}

export async function purchasePostings(
  tx: Tx,
  orgId: string,
  row: PurchaseRow,
): Promise<Posting[]> {
  if (row.deletedAt) return [];
  const lines = await tx
    .select()
    .from(purchaseLines)
    .where(and(eq(purchaseLines.purchaseId, row.id), isNull(purchaseLines.deletedAt)));
  const charges =
    ((row.data ?? {}) as { charges?: { amount: number; gstRate: number; taxable?: boolean }[] })
      .charges ?? [];
  const pays = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.purchaseId, row.id), isNull(payments.deletedAt)));
  const ctx = await buildCtx(tx, orgId, row.businessId, { bankIds: pays.map((p) => p.accountId) });
  let eligible;
  if (row.docType === 'debit-note') {
    // What a debit note takes back is the credit claimed on the matching bill lines (3B 4(B)(2)).
    const bill = row.againstPurchaseId
      ? await tx
          .select()
          .from(purchaseLines)
          .where(
            and(
              eq(purchaseLines.purchaseId, row.againstPurchaseId),
              isNull(purchaseLines.deletedAt),
            ),
          )
      : [];
    eligible = debitNoteItcReversal(lines, {
      billLines: bill,
      interstate: row.interstate,
    }).reversal;
  } else eligible = itcSplit(lines, { interstate: row.interstate, charges }).eligible;
  const refund = pays.find((p) => p.source === 'debit_note_refund');
  return postPurchase(
    {
      ...row,
      itc: { eligible: heads(eligible) },
      refundAccountId: refund?.accountId,
      payments: pays
        .filter((p) => p.source === 'purchase_inline')
        .map((p) => ({
          amount: p.amount,
          mode: p.mode,
          accountId: p.accountId,
          date: p.paymentDate,
        })),
    },
    ctx,
  );
}

export async function paymentPostings(tx: Tx, orgId: string, row: PaymentRow): Promise<Posting[]> {
  const ctx = await buildCtx(tx, orgId, row.businessId, { bankIds: [row.accountId] });
  return postPayment(row, ctx);
}

export async function expensePostings(tx: Tx, orgId: string, row: ExpenseRow): Promise<Posting[]> {
  if (row.deletedAt) return [];
  const ctx = await buildCtx(tx, orgId, row.businessId, {
    bankIds: [row.accountId],
    categoryId: row.categoryId,
  });
  return postExpense(row, ctx);
}

export type LedgerKind = 'invoice' | 'purchase' | 'payment' | 'expense';

/** The postings of one document, by kind. */
export async function postingsFor(
  tx: Tx,
  orgId: string,
  kind: LedgerKind,
  row: InvoiceRow | PurchaseRow | PaymentRow | ExpenseRow,
) {
  if (kind === 'invoice') return invoicePostings(tx, orgId, row as InvoiceRow);
  if (kind === 'purchase') return purchasePostings(tx, orgId, row as PurchaseRow);
  if (kind === 'payment') return paymentPostings(tx, orgId, row as PaymentRow);
  return expensePostings(tx, orgId, row as ExpenseRow);
}

const TABLES = {
  invoice: invoices,
  purchase: purchases,
  payment: payments,
  expense: expenses,
} as const;

/**
 * After a document is created, edited, cancelled, deleted or restored: if the business has the ledger on, repost it.
 * Looks the document up by id (soft-deleted ones too, so deleting reverses). A hard-deleted document goes through
 * `unpostLedger` instead. With the ledger off this does nothing, so a flag-off build behaves exactly as before.
 */
export async function syncLedger(tx: Tx, orgId: string, kind: LedgerKind, id: string) {
  const table = TABLES[kind];
  const [row] = await tx.select().from(table).where(eq(table.id, id));
  if (!row) return;
  if (!(await ledgerEnabled(tx, row.businessId))) return;
  await repost(tx, orgId, {
    businessId: row.businessId,
    refType: kind,
    refId: id,
    postings: await postingsFor(tx, orgId, kind, row),
  });
}

/** Reverses a document's postings when the document itself is about to be removed for good. */
export async function unpostLedger(
  tx: Tx,
  orgId: string,
  businessId: string,
  refType: LedgerKind,
  refId: string,
) {
  if (!(await ledgerEnabled(tx, businessId))) return;
  await repost(tx, orgId, { businessId, refType, refId, postings: [] });
}

/** Reposts every document that points at a payment-bearing parent, after its payments changed. */
export async function syncMany(
  tx: Tx,
  orgId: string,
  kind: LedgerKind,
  ids: (string | null | undefined)[],
) {
  for (const id of new Set(ids.filter((x): x is string => !!x)))
    await syncLedger(tx, orgId, kind, id);
}

export { ACC };
