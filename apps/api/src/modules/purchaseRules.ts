// Vyapar parity Phase 3: the server side of the purchase rules. The decisions are the pure functions in
// @ledgora/tax-engine (purchase.ts, payments.ts); this file loads what they need and writes what they decide, always in
// the caller's transaction so a bill, its stock and its payments are saved or refused together.
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import { purchaseOrderProgress } from '@ledgora/tax-engine';

const { purchases, purchaseLines, purchaseOrders, purchaseOrderLines, paymentAllocations } = schema;

type PurchaseRow = typeof purchases.$inferSelect;
const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

/**
 * What we owe on a bill before payments: the total, less the §194Q TDS we keep, less debit notes against it that are
 * settled by adjusting what we owe (a cash or bank refund comes back as money instead), less the RCM tax (D-13).
 */
export async function dueOfPurchase(tx: Tx, bill: PurchaseRow) {
  const [dn] = await tx
    .select({ v: sql<number>`coalesce(sum(${purchases.total}), 0)::float8` })
    .from(purchases)
    .where(
      and(
        eq(purchases.againstPurchaseId, bill.id),
        eq(purchases.docType, 'debit-note'),
        eq(purchases.refundMode, 'adjust'),
        isNull(purchases.deletedAt),
      ),
    );
  // D-13: on a reverse-charge bill the supplier is owed the value without the tax (the ledger's Cr Payable); the tax is
  // Cr RCM Payable and is paid to the government.
  const rcm = bill.reverseCharge ? bill.cgst + bill.sgst + bill.igst + bill.cess : 0;
  return r2(Math.max(0, bill.total - rcm - bill.tdsAmount - dn.v));
}

/** Pending on a bill. `excludePaymentId` is the payment being edited: its own allocations count as not yet paid. */
export async function pendingOfPurchase(tx: Tx, bill: PurchaseRow, excludePaymentId?: string) {
  let mine = 0;
  if (excludePaymentId) {
    const [m] = await tx
      .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.purchaseId, bill.id),
          eq(paymentAllocations.paymentId, excludePaymentId),
          isNull(paymentAllocations.deletedAt),
        ),
      );
    mine = m.v;
  }
  return r2((await dueOfPurchase(tx, bill)) - bill.paidAmount + mine);
}

/** A supplier's live bills, oldest first, for auto-allocation of a Payment Out. */
export async function openBills(tx: Tx, supplierId: string) {
  return tx
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.supplierId, supplierId),
        eq(purchases.docType, 'bill'),
        isNull(purchases.deletedAt),
      ),
    )
    .orderBy(asc(purchases.purchaseDate), asc(purchases.createdAt));
}

/** Re-derives paid_amount and payment_status of bills from their allocations, so the two can never drift apart. */
export async function refreshPurchases(tx: Tx, ids: (string | null | undefined)[]) {
  for (const id of new Set(ids.filter((x): x is string => !!x))) {
    const [bill] = await tx.select().from(purchases).where(eq(purchases.id, id));
    if (!bill || bill.docType !== 'bill') continue;
    const [s] = await tx
      .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.purchaseId, id), isNull(paymentAllocations.deletedAt)));
    const paid = r2(s.v);
    const due = await dueOfPurchase(tx, bill);
    const status = due > 0 && paid >= due - EPS ? 'Paid' : paid > EPS ? 'Partial' : 'Unpaid';
    await tx
      .update(purchases)
      .set({ paidAmount: paid, paymentStatus: status, updatedAt: new Date() })
      .where(eq(purchases.id, id));
  }
}

/** A purchase order's progress from the live bills converted from it (P3-S3). */
export async function orderProgressOf(tx: Tx, orderId: string, excludeBillId?: string) {
  const [order] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
  const lines = await tx
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.orderId, orderId), isNull(purchaseOrderLines.deletedAt)))
    .orderBy(purchaseOrderLines.createdAt);
  const bills = await tx
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.poId, orderId),
        eq(purchases.docType, 'bill'),
        isNull(purchases.deletedAt),
        excludeBillId ? ne(purchases.id, excludeBillId) : undefined,
      ),
    );
  const billLines = bills.length
    ? await tx
        .select()
        .from(purchaseLines)
        .where(
          and(
            inArray(
              purchaseLines.purchaseId,
              bills.map((b) => b.id),
            ),
            isNull(purchaseLines.deletedAt),
          ),
        )
    : [];
  const progress = purchaseOrderProgress(
    lines,
    [{ items: billLines }],
    order?.status === 'cancelled',
  );
  return { order, lines, progress };
}

/** Stores the derived received quantities and status on the order, so its list can filter on them. */
export async function refreshOrder(tx: Tx, orderId: string | null | undefined) {
  if (!orderId) return;
  const { order, lines, progress } = await orderProgressOf(tx, orderId);
  if (!order) return;
  for (let i = 0; i < lines.length; i++)
    await tx
      .update(purchaseOrderLines)
      .set({ receivedQty: progress.lines[i].received, updatedAt: new Date() })
      .where(eq(purchaseOrderLines.id, lines[i].id));
  if (order.status !== 'cancelled')
    await tx
      .update(purchaseOrders)
      .set({ status: progress.status, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, orderId));
}
