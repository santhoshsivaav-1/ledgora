// Vyapar parity Phase 2: the server side of the sale rules. The decisions are the pure functions in
// @ledgora/tax-engine (sale.ts, credit.ts); this file loads what they need and writes what they decide, always in the
// caller's transaction so an invoice and its payments are saved or refused together.
import { and, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import type { InlinePayment } from '@ledgora/contracts';
import {
  cashLimitCheck,
  creditCheck,
  inlinePaymentCheck,
  negativeStockCheck,
  paymentStatusFor,
  periodLocked,
  SALES_INVOICE_TYPES,
  STOCK_SIGN,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { OrgContext } from '../middleware/context.ts';

const { invoices, payments, paymentAllocations, parties, staff, businessSettings, stockMovements } =
  schema;

type InvoiceRow = typeof invoices.$inferSelect;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** What the payer owes on an invoice: the total less TDS they deduct. */
export const dueOf = (r: Pick<InvoiceRow, 'total' | 'data'>) => {
  const tds = Number((r.data as { totals?: { tdsAmount?: number } }).totals?.tdsAmount) || 0;
  return r2(r.total - Math.min(Math.max(0, tds), r.total));
};
export const statusFor = (r: Pick<InvoiceRow, 'total' | 'data'>, paid: number) =>
  paymentStatusFor({ totalAmount: r.total, data: r.data }, paid) as 'unpaid' | 'partial' | 'paid';

/** Re-derives paid_amount and status of invoices from their allocations, so the two can never drift apart. */
export async function refreshInvoices(tx: Tx, invoiceIds: string[]) {
  for (const id of new Set(invoiceIds)) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
    if (!inv || inv.status === 'cancelled') continue;
    const [s] = await tx
      .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.invoiceId, id), isNull(paymentAllocations.deletedAt)));
    const paid = r2(s.v);
    await tx
      .update(invoices)
      .set({ paidAmount: paid, status: statusFor(inv, paid), updatedAt: new Date() })
      .where(eq(invoices.id, id));
  }
}

// ---- transaction settings (Settings > Transaction, stored in business_settings.preferences.transaction) ----------------

export interface TransactionSettings {
  /** On or before this date nothing may be saved (owner override with a reason). */
  lockDate?: string | null;
  /** Months whose GST return is filed, 'YYYY-MM'. */
  filedMonths?: string[];
  /** Selling more than is in stock. Unset = allow, the behaviour from before Phase 2. */
  negativeStock?: 'allow' | 'warn' | 'block';
  commissionBasis?: 'sale' | 'collection';
  /** §269ST limit; default ₹2,00,000. */
  cashLimit?: number;
}

export async function transactionSettings(
  tx: Tx,
  businessId: string,
): Promise<TransactionSettings> {
  const [s] = await tx
    .select({ preferences: businessSettings.preferences })
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  const prefs = (s?.preferences ?? {}) as {
    transaction?: TransactionSettings;
    filedMonths?: string[];
  };
  return { filedMonths: prefs.filedMonths, ...(prefs.transaction ?? {}) };
}

// ---- P2-S1 salesman scope -------------------------------------------------------------------------------------------------

/**
 * A member with the Salesman role whose login is linked to a staff row sees only invoices credited to that row. Other
 * roles, and a salesman not linked yet, get null (no filter): linking is what turns the scope on, so members who were
 * salesmen before Phase 2 keep seeing what they saw.
 */
export async function salesmanScope(tx: Tx, auth: OrgContext): Promise<string[] | null> {
  if (auth.role !== 'salesman') return null;
  const rows = await tx
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.userId, auth.user.id), isNull(staff.deletedAt)));
  return rows.length ? rows.map((r) => r.id) : null;
}

/** 404 rather than 403, so a salesman can not probe which invoice ids exist. */
export function assertInScope(scope: string[] | null, row: Pick<InvoiceRow, 'salesmanId'>) {
  if (scope && !(row.salesmanId && scope.includes(row.salesmanId))) throw notFound('Invoice');
}

/** The salesman an invoice may name: a live staff row, and for a Salesman member only themselves (filled in if left out). */
export async function resolveSalesman(
  tx: Tx,
  scope: string[] | null,
  wanted: string | null | undefined,
  keep?: string | null,
) {
  if (scope) {
    if (wanted && !scope.includes(wanted))
      throw new AppError('forbidden', 'A salesman can only record their own sales');
    return wanted ?? keep ?? scope[0];
  }
  if (!wanted) return null;
  const [s] = await tx
    .select({ id: staff.id, active: staff.active })
    .from(staff)
    .where(and(eq(staff.id, wanted), isNull(staff.deletedAt)));
  if (!s || (!s.active && wanted !== keep))
    throw new AppError('unprocessable', 'Salesman not found or inactive', [
      { path: 'salesmanId', message: 'Pick an active salesman' },
    ]);
  return s.id;
}

// ---- P2-S2 inline payments --------------------------------------------------------------------------------------------------

/** Document types money can be received with: sales are settled by it; a sale order holds it as an advance. */
const PAYABLE = [...SALES_INVOICE_TYPES, 'sales-order'];

/** The walk-in party a cash sale without a customer is recorded against, made the first time it is needed. */
export async function walkInParty(tx: Tx, orgId: string) {
  const [found] = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(
      and(
        sql`lower(${parties.name}) = 'cash sale'`,
        eq(parties.kind, 'customer'),
        isNull(parties.deletedAt),
      ),
    )
    .limit(1);
  if (found) return found.id;
  const [row] = await tx
    .insert(parties)
    .values({ orgId, name: 'Cash Sale', kind: 'customer' })
    .returning({ id: parties.id });
  await audit(tx, orgId, 'party.create', 'party', row.id, {
    after: { name: 'Cash Sale', walkIn: true },
  });
  return row.id;
}

/** Money applied to an invoice through separate receipts (not this invoice's own inline rows). */
async function receiptsApplied(tx: Tx, invoiceId: string) {
  const [s] = await tx
    .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(
      and(
        eq(paymentAllocations.invoiceId, invoiceId),
        isNull(paymentAllocations.deletedAt),
        isNull(payments.deletedAt),
        ne(payments.source, 'invoice_inline'),
      ),
    );
  return r2(s.v);
}

/** Checks the rows before anything is written: amounts, cheque dates, and Σ ≤ total (422 over_allocated). */
export async function checkInlinePayments(
  tx: Tx,
  o: {
    invoiceType: string;
    total: number;
    data: unknown;
    invoiceId?: string;
    rows: InlinePayment[];
  },
) {
  if (!o.rows.length) return { earlier: o.invoiceId ? await receiptsApplied(tx, o.invoiceId) : 0 };
  if (!PAYABLE.includes(o.invoiceType))
    throw new AppError(
      'unprocessable',
      'Payments can only be received with a sale or a sale order',
    );
  const earlier = o.invoiceId ? await receiptsApplied(tx, o.invoiceId) : 0;
  const check = inlinePaymentCheck({
    payments: o.rows,
    total: dueOf({ total: o.total, data: o.data as InvoiceRow['data'] }),
    earlier,
  });
  if (!check.ok) {
    const over = check.errors.find((e) => e.code === 'OVER_ALLOCATED');
    throw new AppError(
      over ? 'over_allocated' : 'unprocessable',
      over?.message ?? check.errors[0].message,
      check.errors.map((e) => ({
        path: e.row < 0 ? 'payments' : `payments.${e.row}`,
        code: e.code,
        message: e.message,
      })),
    );
  }
  return { earlier };
}

/**
 * Replaces an invoice's inline payments with `rows`: one `payments` row each (source invoice_inline), allocated to the
 * invoice when it is a sale. On a sale order the money stays unallocated, the party's advance, until the order is
 * invoiced. Receipts recorded separately are never touched here.
 */
export async function writeInlinePayments(
  tx: Tx,
  orgId: string,
  inv: InvoiceRow,
  rows: InlinePayment[],
  { soft = false }: { soft?: boolean } = {},
) {
  const old = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.invoiceId, inv.id),
        eq(payments.source, 'invoice_inline'),
        isNull(payments.deletedAt),
      ),
    );
  const oldIds = old.map((p) => p.id);
  if (oldIds.length) {
    if (soft) {
      await tx
        .update(paymentAllocations)
        .set({ deletedAt: new Date() })
        .where(inArray(paymentAllocations.paymentId, oldIds));
      await tx.update(payments).set({ deletedAt: new Date() }).where(inArray(payments.id, oldIds));
    } else {
      await tx.delete(paymentAllocations).where(inArray(paymentAllocations.paymentId, oldIds));
      await tx.delete(payments).where(inArray(payments.id, oldIds));
    }
  }
  if (rows.length && !inv.partyId)
    throw new AppError('unprocessable', 'A payment needs a party (use the Cash Sale party)');
  const allocate = SALES_INVOICE_TYPES.includes(inv.invoiceType);
  for (const p of rows) {
    const [row] = await tx
      .insert(payments)
      .values({
        orgId,
        businessId: inv.businessId,
        partyId: inv.partyId as string,
        amount: p.amount,
        mode: p.mode,
        accountId: p.accountId ?? null,
        reference: p.reference,
        chequeDate: p.chequeDate ?? null,
        paymentDate: inv.invoiceDate,
        source: 'invoice_inline',
        invoiceId: inv.id,
        number: inv.number,
        notes: inv.invoiceType === 'sales-order' ? `Advance on ${inv.number}` : '',
      })
      .returning({ id: payments.id });
    if (allocate)
      await tx
        .insert(paymentAllocations)
        .values({ orgId, paymentId: row.id, invoiceId: inv.id, amount: p.amount });
  }
  await refreshInvoices(tx, [inv.id]);
  if (oldIds.length || rows.length)
    await audit(tx, orgId, 'invoice.payments', 'invoice', inv.id, {
      after: {
        removed: oldIds.length,
        rows: rows.map((p) => ({ mode: p.mode, amount: p.amount })),
      },
    });
}

/** The payments the editor's Payment block lists for an invoice: its inline rows plus receipts applied to it. */
export async function invoicePayments(tx: Tx, invoiceId: string) {
  const allocs = await tx
    .select({ paymentId: paymentAllocations.paymentId, amount: paymentAllocations.amount })
    .from(paymentAllocations)
    .where(and(eq(paymentAllocations.invoiceId, invoiceId), isNull(paymentAllocations.deletedAt)));
  const own = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.invoiceId, invoiceId), isNull(payments.deletedAt)));
  const ids = [...new Set([...allocs.map((a) => a.paymentId), ...own.map((p) => p.id)])];
  if (!ids.length) return [];
  const rows = await tx
    .select()
    .from(payments)
    .where(and(inArray(payments.id, ids), isNull(payments.deletedAt)))
    .orderBy(payments.createdAt);
  const applied = new Map<string, number>();
  for (const a of allocs) applied.set(a.paymentId, r2((applied.get(a.paymentId) ?? 0) + a.amount));
  return rows.map((p) => ({
    paymentId: p.id,
    source: p.source,
    mode: p.mode,
    accountId: p.accountId,
    amount: applied.get(p.id) ?? p.amount,
    reference: p.reference,
    chequeDate: p.chequeDate,
    paymentDate: p.paymentDate,
    number: p.number,
  }));
}

// ---- P2-S4 save guards ----------------------------------------------------------------------------------------------------

export interface GuardInput {
  businessId: string;
  invoiceType: string;
  invoiceDate: string;
  partyId: string | null;
  total: number;
  data: unknown;
  lines: { itemId: string | null; name: string; quantity: number }[];
  tracked: Set<string>;
  payments: InlinePayment[];
  confirm: {
    creditLimit?: boolean;
    negativeStock?: boolean;
    cashAcknowledgement?: string;
    overrideReason?: string;
  };
  /** Set when editing: the invoice's own figures are left out of "already owed" and "in stock". */
  invoiceId?: string;
  /** Money separate receipts already applied to the invoice being edited. */
  earlier?: number;
  restock?: boolean;
}

const SALE_TYPES = SALES_INVOICE_TYPES;

/** What the party already owes: opening balance + unpaid sales − credit notes − unapplied money (advances). */
export async function partyOutstanding(tx: Tx, partyId: string, excludeInvoiceId?: string) {
  const [p] = await tx
    .select({ opening: parties.openingBalance })
    .from(parties)
    .where(eq(parties.id, partyId));
  const live = and(
    eq(invoices.partyId, partyId),
    isNull(invoices.deletedAt),
    ne(invoices.status, 'cancelled'),
    excludeInvoiceId ? ne(invoices.id, excludeInvoiceId) : undefined,
  );
  const docs = await tx
    .select({
      invoiceType: invoices.invoiceType,
      total: invoices.total,
      data: invoices.data,
      paid: invoices.paidAmount,
    })
    .from(invoices)
    .where(and(live, inArray(invoices.invoiceType, [...SALE_TYPES, 'credit-note'])));
  let owed = Number(p?.opening) || 0;
  for (const d of docs) owed += d.invoiceType === 'credit-note' ? -d.total : dueOf(d) - d.paid;
  const mine = and(
    eq(payments.partyId, partyId),
    eq(payments.direction, 'in'),
    isNull(payments.deletedAt),
    excludeInvoiceId ? sql`${payments.invoiceId} is distinct from ${excludeInvoiceId}` : undefined,
  );
  const [settled] = await tx
    .select({
      v: sql<number>`coalesce(sum(${payments.amount} + ${payments.discountAmount} + ${payments.tdsAmount}), 0)::float8`,
    })
    .from(payments)
    .where(mine);
  const [applied] = await tx
    .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(and(mine, isNull(paymentAllocations.deletedAt)));
  const unapplied = { v: r2(settled.v - applied.v) };
  // Money refunded on credit notes goes back on the party's account.
  const [refunded] = await tx
    .select({ v: sql<number>`coalesce(sum(${payments.amount}), 0)::float8` })
    .from(payments)
    .where(
      and(eq(payments.partyId, partyId), eq(payments.direction, 'out'), isNull(payments.deletedAt)),
    );
  owed += refunded.v;
  return r2(owed - (Number(unapplied?.v) || 0));
}

/** Cash already received from the party on a day (§269ST counts per person per day). */
async function dayCash(tx: Tx, partyId: string, date: string, excludeInvoiceId?: string) {
  const [s] = await tx
    .select({ v: sql<number>`coalesce(sum(${payments.amount}), 0)::float8` })
    .from(payments)
    .where(
      and(
        eq(payments.partyId, partyId),
        eq(payments.mode, 'cash'),
        eq(payments.direction, 'in'),
        eq(payments.paymentDate, date),
        isNull(payments.deletedAt),
        excludeInvoiceId
          ? sql`${payments.invoiceId} is distinct from ${excludeInvoiceId}`
          : undefined,
      ),
    );
  return r2(s.v);
}

async function stockOnHand(tx: Tx, itemIds: string[], excludeInvoiceId?: string) {
  if (!itemIds.length) return {};
  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      q: sql<number>`sum(${stockMovements.quantity})::float8`,
    })
    .from(stockMovements)
    .where(
      and(
        inArray(stockMovements.itemId, itemIds),
        isNull(stockMovements.deletedAt),
        excludeInvoiceId
          ? sql`not (${stockMovements.refType} = 'invoice' and ${stockMovements.refId} = ${excludeInvoiceId})`
          : undefined,
      ),
    )
    .groupBy(stockMovements.itemId);
  const out: Record<string, number> = Object.fromEntries(itemIds.map((id) => [id, 0]));
  for (const r of rows) out[r.itemId] = Math.round(r.q * 1000) / 1000;
  return out;
}

/** Records an owner override, then lets the save through. */
async function override(
  tx: Tx,
  orgId: string,
  auth: OrgContext,
  guard: string,
  reason: string,
  detail: object,
) {
  if (auth.role !== 'owner' || !reason.trim()) return false;
  await audit(tx, orgId, 'guard.override', 'invoice', null, {
    after: { guard, reason, ...detail },
  });
  return true;
}

/**
 * Runs the P2-S4 guards on a save and throws the first that stops it. Warnings that the caller has confirmed pass;
 * blocks pass only for the owner with a reason, which is audited. Every refusal carries the figures the dialog shows.
 */
export async function runGuards(tx: Tx, orgId: string, auth: OrgContext, g: GuardInput) {
  const settings = await transactionSettings(tx, g.businessId);
  const reason = g.confirm.overrideReason ?? '';

  // Period lock.
  const lock = periodLocked({
    date: g.invoiceDate,
    lockDate: settings.lockDate,
    filedMonths: settings.filedMonths,
    role: auth.role,
  });
  if (
    lock.locked &&
    !(await override(tx, orgId, auth, 'period_locked', reason, {
      date: g.invoiceDate,
      why: lock.reason,
    }))
  )
    throw new AppError(
      'period_locked',
      lock.reason === 'filed_month'
        ? 'The GST return for this month is filed. Only the owner can save into it, with a reason.'
        : `Books are locked up to ${settings.lockDate}. Only the owner can save into a locked period, with a reason.`,
      { reason: lock.reason, lockDate: settings.lockDate ?? null, canOverride: lock.canOverride },
    );

  // Credit limit (sales only; what stays unpaid after the money received with the sale).
  if (g.partyId && SALE_TYPES.includes(g.invoiceType)) {
    const [p] = await tx
      .select({ name: parties.name, limit: parties.creditLimit, mode: parties.creditMode })
      .from(parties)
      .where(eq(parties.id, g.partyId));
    if (p && p.mode !== 'none') {
      const received = g.payments.reduce((s, x) => s + x.amount, 0);
      const used = await partyOutstanding(tx, g.partyId, g.invoiceId);
      const due = dueOf({ total: g.total, data: g.data as InvoiceRow['data'] });
      const c = creditCheck({
        limit: p.limit,
        mode: p.mode,
        used,
        newAmount: r2(due - received - (g.earlier ?? 0)),
      });
      const detail = {
        party: p.name,
        limit: c.limit,
        used: c.used,
        after: c.after,
        exceededBy: c.exceededBy,
        mode: c.mode,
      };
      if (!c.ok) {
        const passes =
          c.mode === 'warn'
            ? g.confirm.creditLimit === true
            : await override(tx, orgId, auth, 'credit_limit', reason, detail);
        if (!passes)
          throw new AppError(
            'credit_limit',
            `${p.name} has a limit of ₹${c.limit}. Outstanding ₹${c.used} + this sale = ₹${c.after}. Exceeds by ₹${c.exceededBy}.`,
            detail,
          );
        if (c.mode === 'warn')
          await audit(tx, orgId, 'guard.credit_limit', 'invoice', g.invoiceId ?? null, {
            after: detail,
          });
      }
    }
  }

  // §269ST cash.
  const newCash = g.payments.filter((p) => p.mode === 'cash').reduce((s, p) => s + p.amount, 0);
  if (g.partyId && newCash > 0) {
    const cash = cashLimitCheck({
      dayCashTotal: await dayCash(tx, g.partyId, g.invoiceDate, g.invoiceId),
      newCash,
      limit: settings.cashLimit,
    });
    if (cash.breached) {
      const ack = (g.confirm.cashAcknowledgement ?? '').trim();
      if (!ack)
        throw new AppError(
          'cash_limit',
          `Cash from this party today reaches ₹${cash.total} (limit ₹${cash.limit}, section 269ST). Type an acknowledgement to save.`,
          cash,
        );
      await audit(tx, orgId, 'guard.cash_limit', 'invoice', g.invoiceId ?? null, {
        after: { ...cash, ack },
      });
    }
  }

  // Negative stock (only documents that take stock out).
  const mode = settings.negativeStock ?? 'allow';
  const takesStock = (STOCK_SIGN[g.invoiceType] ?? -1) < 0;
  if (mode !== 'allow' && takesStock && g.restock !== false) {
    const lines = g.lines.filter((l) => l.itemId && g.tracked.has(l.itemId));
    const stock = await stockOnHand(
      tx,
      [...new Set(lines.map((l) => l.itemId as string))],
      g.invoiceId,
    );
    const res = negativeStockCheck(lines, stock, mode);
    if (res.action === 'block' || (res.action === 'warn' && g.confirm.negativeStock !== true))
      throw new AppError(
        'negative_stock',
        `Not enough stock: ${res.short.map((s) => `${s.name || 'item'} short by ${s.short}`).join(', ')}`,
        { mode, short: res.short },
      );
  }
}

/** Receipt allocations other than the invoice's own inline rows (the ones cancelling must ask about). */
export async function receiptAllocations(tx: Tx, invoiceId: string) {
  return tx
    .select({ paymentId: paymentAllocations.paymentId, amount: paymentAllocations.amount })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(
      and(
        eq(paymentAllocations.invoiceId, invoiceId),
        isNull(paymentAllocations.deletedAt),
        notInArray(payments.source, ['invoice_inline']),
      ),
    );
}
