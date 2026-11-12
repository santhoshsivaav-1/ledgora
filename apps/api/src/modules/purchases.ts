import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  duplicateBillQuery,
  duplicateBillResult,
  expense,
  expenseCategory,
  expenseCategoryInput,
  expenseInput,
  expenseItem,
  expenseItemInput,
  expenseListQuery,
  idParam,
  itcAtRisk,
  itcQuery,
  okBody,
  page,
  pageQuery,
  purchase,
  purchaseInput,
  purchaseListQuery,
  returnableResult,
  supplierStatement,
  type ExpenseInput,
  type Purchase,
  type PurchaseInput,
} from '@ledgora/contracts';
import {
  DEFAULT_INCOME_CATEGORIES,
  debitNoteMovesStock,
  duplicateBill,
  expenseTotals,
  inlinePaymentCheck,
  itcSplit,
  landedCost,
  overConversion,
  overReturns,
  partyStatement,
  purchaseLineTax,
  purchaseTotals,
  rcmSupplierDue,
  returnableQtyPurchase,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { nextSeriesNumber } from './series.ts';
import { dueOfPurchase, orderProgressOf, refreshOrder, refreshPurchases } from './purchaseRules.ts';
import { guardPeriod } from './saleRules.ts';
import { syncLedger } from './ledgerRules.ts';
import { syncTds } from './tdsRules.ts';
import { itcPositions } from './itcRules.ts';

const {
  purchases,
  purchaseLines,
  expenses,
  expenseCategories,
  expenseItems,
  items,
  stockMovements,
  parties,
  payments,
  paymentAllocations,
} = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;
type PurchaseRow = typeof purchases.$inferSelect;
type LineRow = typeof purchaseLines.$inferSelect;
type PurchaseData = {
  charges?: PurchaseInput['charges'];
  roundOff?: boolean;
  tds194QPercent?: number;
};

/** Per line columns and the bill's figures, all from the tax engine (purchaseTotals, landedCost). */
function figures(
  input: Pick<PurchaseInput, 'items' | 'charges' | 'interstate' | 'roundOff' | 'tds194QPercent'>,
) {
  const costs = landedCost(input.items, input.charges);
  const lines = input.items.map((l, i) => {
    const f = purchaseLineTax(l);
    const taxable = r2(f.taxable);
    const tax = r2(f.tax);
    const cess = r2(f.cess);
    return {
      ...l,
      taxableAmount: taxable,
      taxAmount: r2(tax + cess),
      lineTotal: r2(taxable + tax + cess),
      landedCost: costs[i].unitCost,
    };
  });
  const t = purchaseTotals({
    lines: input.items,
    charges: input.charges,
    interstate: input.interstate,
    roundOff: input.roundOff,
    tds194QPercent: input.tds194QPercent,
  });
  return { lines, ...t };
}

async function linesOf(tx: Tx, id: string) {
  return tx
    .select()
    .from(purchaseLines)
    .where(and(eq(purchaseLines.purchaseId, id), isNull(purchaseLines.deletedAt)))
    .orderBy(purchaseLines.createdAt);
}

const roundHeads = (h: { igst: number; cgst: number; sgst: number; cess: number }) => ({
  igst: r2(h.igst),
  cgst: r2(h.cgst),
  sgst: r2(h.sgst),
  cess: r2(h.cess),
});

function toPurchase(r: PurchaseRow, lines: LineRow[]): Purchase {
  const data = (r.data ?? {}) as PurchaseData;
  const charges = data.charges ?? [];
  const itc = itcSplit(lines, { interstate: r.interstate, charges });
  return {
    id: r.id,
    businessId: r.businessId,
    docType: r.docType as Purchase['docType'],
    number: r.number,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierGstin: r.supplierGstin,
    supplierAddress: r.supplierAddress,
    invoiceNumber: r.invoiceNumber,
    purchaseDate: r.purchaseDate,
    dueDate: r.dueDate,
    interstate: r.interstate,
    placeOfSupply: r.placeOfSupply,
    reverseCharge: r.reverseCharge,
    paymentStatus: r.paymentStatus,
    taxableAmount: r.taxableAmount,
    cgst: r.cgst,
    sgst: r.sgst,
    igst: r.igst,
    cess: r.cess,
    total: r.total,
    tdsAmount: r.tdsAmount,
    paidAmount: r.paidAmount,
    charges,
    itc: { eligible: roundHeads(itc.eligible), ineligible: roundHeads(itc.ineligible) },
    poId: r.poId,
    againstPurchaseId: r.againstPurchaseId,
    returnReason: r.returnReason,
    refundMode: r.refundMode,
    fileId: r.fileId,
    notes: r.notes,
    duplicateOf: r.duplicateOf,
    items: lines.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      hsn: l.hsn,
      quantity: l.quantity,
      rate: l.rate,
      taxPercent: l.taxPercent,
      cessPercent: l.cessPercent,
      itcStatus: l.itcStatus as Purchase['items'][number]['itcStatus'],
      taxableAmount: l.taxableAmount,
      taxAmount: l.taxAmount,
      lineTotal: l.lineTotal,
      landedCost: l.landedCost,
    })),
    ...stamps(r),
  };
}

async function loadPurchase(tx: Tx, id: string) {
  const [r] = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), isNull(purchases.deletedAt)));
  if (!r) throw notFound('Purchase');
  return r;
}

/** Other bills of this supplier in the same FY with the same bill number (the tax-engine rule). */
async function findDuplicate(
  tx: Tx,
  o: {
    supplierId?: string | null;
    supplierGstin?: string;
    supplierName?: string;
    billNo?: string;
    date: string;
    excludeId?: string;
  },
) {
  if (!o.billNo?.trim()) return null;
  // A supplier picked from the parties is matched by id (and its name, for bills saved without the link).
  let supplierName = o.supplierName;
  if (o.supplierId && !supplierName) {
    const [p] = await tx
      .select({ name: parties.name })
      .from(parties)
      .where(eq(parties.id, o.supplierId));
    supplierName = p?.name;
  }
  const rows = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.docType, 'bill'), isNull(purchases.deletedAt)));
  const candidates = rows
    .filter((b) => !o.supplierId || !b.supplierId || b.supplierId === o.supplierId)
    .map((b) => ({ ...b, date: b.purchaseDate }));
  return duplicateBill(candidates, {
    supplierGstin: o.supplierGstin,
    supplierName,
    billNo: o.billNo,
    date: o.date,
    excludeId: o.excludeId,
  }) as PurchaseRow | null;
}

/** Lines of the earlier live debit notes against a bill. */
async function priorReturns(tx: Tx, billId: string, excludeId?: string) {
  const notes = await tx
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.againstPurchaseId, billId),
        eq(purchases.docType, 'debit-note'),
        isNull(purchases.deletedAt),
        excludeId ? ne(purchases.id, excludeId) : undefined,
      ),
    );
  return Promise.all(notes.map(async (n) => ({ items: await linesOf(tx, n.id) })));
}

/** A stock movement per tracked item: in for a bill, out for a debit note that sends goods back. */
async function moveStock(tx: Tx, orgId: string, row: PurchaseRow, lines: LineRow[], sign: 1 | -1) {
  for (const l of lines) {
    if (!l.itemId) continue;
    const [it] = await tx.select({ t: items.trackStock }).from(items).where(eq(items.id, l.itemId));
    if (!it) throw notFound('Item');
    if (it.t)
      await tx.insert(stockMovements).values({
        orgId,
        itemId: l.itemId,
        quantity: sign * l.quantity,
        reason: sign > 0 ? 'purchase' : 'purchase_return',
        refType: 'purchase',
        refId: row.id,
        note: sign > 0 && l.landedCost ? `landed cost ${l.landedCost}` : '',
      });
  }
}

/**
 * Saves a purchase bill or debit note with its lines, stock, payments and links, or refuses it. Used by
 * POST /v1/purchases and by converting a purchase order, so both follow the same rules.
 */
export async function createPurchase(
  tx: Tx,
  orgId: string,
  body: PurchaseInput,
  existing?: PurchaseRow,
) {
  await loadBusiness(tx, body.businessId);
  if (existing) {
    if (existing.docType !== body.docType)
      throw new AppError('unprocessable', 'A bill can not become a debit note, or the reverse');
    // Returns were checked against the bill as it was; editing it under them could leave them returning more than bought.
    if (existing.docType === 'bill' && (await priorReturns(tx, existing.id)).length)
      throw new AppError(
        'conflict',
        'Debit notes were made against this bill. Delete them before changing the bill.',
      );
  }
  let supplierName = body.supplierName;
  if (body.supplierId) {
    const [p] = await tx
      .select({ name: parties.name })
      .from(parties)
      .where(and(eq(parties.id, body.supplierId), isNull(parties.deletedAt)));
    if (!p) throw notFound('Supplier');
    supplierName ||= p.name;
  }
  const isNote = body.docType === 'debit-note';
  let interstate = body.interstate;
  let against: PurchaseRow | null = null;
  let billLines: LineRow[] = [];
  if (isNote && body.againstPurchaseId) {
    against = await loadPurchase(tx, body.againstPurchaseId);
    if (against.docType !== 'bill')
      throw new AppError('unprocessable', 'A debit note goes against a purchase bill');
    if (body.supplierId && against.supplierId && against.supplierId !== body.supplierId)
      throw new AppError('unprocessable', 'That bill is from a different supplier');
    interstate = against.interstate;
    billLines = await linesOf(tx, against.id);
    if (debitNoteMovesStock(body.returnReason)) {
      const left = returnableQtyPurchase(
        billLines,
        await priorReturns(tx, against.id, existing?.id),
      );
      const over = overReturns(body.items, left);
      if (over.length)
        throw new AppError(
          'over_return',
          `More than is left to return: ${over.map((o) => `${o.name} (${o.returnable} left)`).join(', ')}`,
          over,
        );
    }
  }

  // P3-S1 use case 4: same supplier bill number this year. Saved only once the user says so.
  let duplicateOf: string | null = null;
  if (!isNote) {
    const dup = await findDuplicate(tx, {
      supplierId: body.supplierId,
      supplierGstin: body.supplierGstin,
      supplierName,
      billNo: body.invoiceNumber,
      date: body.purchaseDate,
      excludeId: existing?.id,
    });
    if (dup && !body.allowDuplicate)
      throw new AppError(
        'duplicate_bill',
        `Bill ${body.invoiceNumber} from this supplier is already recorded (${dup.number || dup.invoiceNumber}, ${dup.purchaseDate})`,
        { id: dup.id, number: dup.number, purchaseDate: dup.purchaseDate },
      );
    duplicateOf = dup?.id ?? null;
  }

  // P3-S3: receiving against an order may not take more than is pending on it.
  if (body.poId) {
    if (isNote)
      throw new AppError('unprocessable', 'A debit note is not received against an order');
    const { order, progress } = await orderProgressOf(tx, body.poId, existing?.id);
    if (!order || order.deletedAt) throw notFound('Purchase order');
    if (order.status === 'cancelled')
      throw new AppError('unprocessable', `Purchase order ${order.number} is cancelled`);
    const over = overConversion(progress.lines, body.items);
    if (over.length)
      throw new AppError(
        'over_conversion',
        `More than is pending on ${order.number}: ${over.map((o) => `${o.name} (${o.returnable} pending)`).join(', ')}`,
        over,
      );
  }

  const f = figures({ ...body, interstate });
  // Payments made with the bill are checked against what we pay the supplier (the total less §194Q TDS).
  if (body.payments.length) {
    if (isNote) throw new AppError('unprocessable', 'A debit note is settled by its refund mode');
    if (!body.supplierId)
      throw new AppError(
        'unprocessable',
        'Pick the supplier from your parties to record a payment',
      );
    const check = inlinePaymentCheck({ payments: body.payments, total: f.payable });
    if (!check.ok) {
      const e = check.errors[0];
      throw new AppError(
        e.code === 'OVER_ALLOCATED' ? 'over_allocated' : 'unprocessable',
        e.message,
        check.errors,
      );
    }
  }
  if (isNote && body.refundMode !== 'adjust' && !body.supplierId)
    throw new AppError('unprocessable', 'Pick the supplier from your parties to record a refund');

  const number =
    body.number ||
    existing?.number ||
    (await nextSeriesNumber(tx, orgId, body.businessId, isNote ? 'DN' : 'PUR'));
  const {
    items: _items,
    charges,
    payments: inline,
    roundOff,
    tds194QPercent,
    allowDuplicate: _allow,
    number: _n,
    ...cols
  } = body;
  const values = {
    ...cols,
    supplierName,
    interstate,
    number,
    fileId: cols.fileId ?? null,
    dueDate: cols.dueDate ?? null,
    poId: cols.poId ?? null,
    againstPurchaseId: cols.againstPurchaseId ?? null,
    returnReason: isNote ? (cols.returnReason ?? null) : null,
    duplicateOf,
    taxableAmount: f.taxable,
    cgst: f.cgst,
    sgst: f.sgst,
    igst: f.igst,
    cess: f.cess,
    total: f.total,
    tdsAmount: isNote ? 0 : f.tdsAmount,
    data: { charges, roundOff, tds194QPercent } satisfies PurchaseData,
  };
  let row: PurchaseRow;
  if (existing) {
    // An edit starts from a clean slate: what the old version brought in (lines, stock, the money paid with it and the
    // advance applied to it) is taken out, then everything below runs as for a new document.
    await tx.delete(purchaseLines).where(eq(purchaseLines.purchaseId, existing.id));
    await tx
      .delete(stockMovements)
      .where(and(eq(stockMovements.refType, 'purchase'), eq(stockMovements.refId, existing.id)));
    const own = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.purchaseId, existing.id),
          inArray(payments.source, ['purchase_inline', 'debit_note_refund']),
        ),
      );
    if (own.length) {
      const ownIds = own.map((x) => x.id);
      await tx.delete(paymentAllocations).where(inArray(paymentAllocations.paymentId, ownIds));
      await tx.delete(payments).where(inArray(payments.id, ownIds));
    }
    const advances = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.source, 'po_advance'));
    if (advances.length)
      await tx.delete(paymentAllocations).where(
        and(
          eq(paymentAllocations.purchaseId, existing.id),
          inArray(
            paymentAllocations.paymentId,
            advances.map((x) => x.id),
          ),
        ),
      );
    [row] = await tx
      .update(purchases)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(purchases.id, existing.id))
      .returning();
  } else
    [row] = await tx
      .insert(purchases)
      .values({ ...values, orgId })
      .returning();
  const lines = await tx
    .insert(purchaseLines)
    .values(
      f.lines.map((l) => ({
        orgId,
        purchaseId: row.id,
        itemId: l.itemId ?? null,
        name: l.name,
        hsn: l.hsn,
        quantity: l.quantity,
        rate: l.rate,
        taxPercent: l.taxPercent,
        cessPercent: l.cessPercent,
        itcStatus: l.itcStatus,
        taxableAmount: l.taxableAmount,
        taxAmount: l.taxAmount,
        lineTotal: l.lineTotal,
        landedCost: l.landedCost,
      })),
    )
    .returning();

  if (!isNote) await moveStock(tx, orgId, row, lines, 1);
  else if (debitNoteMovesStock(body.returnReason)) await moveStock(tx, orgId, row, lines, -1);

  // Money paid with the bill: one Payment Out per row, allocated to this bill.
  for (const p of inline) {
    const [pay] = await tx
      .insert(payments)
      .values({
        orgId,
        businessId: row.businessId,
        partyId: body.supplierId!,
        amount: p.amount,
        mode: p.mode,
        paymentDate: row.purchaseDate,
        reference: p.reference,
        accountId: p.accountId ?? null,
        chequeDate: p.chequeDate ?? null,
        direction: 'out',
        source: 'purchase_inline',
        purchaseId: row.id,
        number: row.number,
      })
      .returning();
    await tx
      .insert(paymentAllocations)
      .values({ orgId, paymentId: pay.id, purchaseId: row.id, amount: p.amount });
  }
  // P3-S3: an advance paid on the order is applied to the bill that receives the goods.
  if (row.poId) {
    const advances = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.purchaseOrderId, row.poId),
          eq(payments.source, 'po_advance'),
          isNull(payments.deletedAt),
        ),
      );
    let pending = r2(f.payable - sumOf(inline.map((p) => p.amount)));
    for (const adv of advances) {
      if (pending <= 0) break;
      const [used] = await tx
        .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
        .from(paymentAllocations)
        .where(and(eq(paymentAllocations.paymentId, adv.id), isNull(paymentAllocations.deletedAt)));
      const take = r2(Math.min(pending, adv.amount - used.v));
      if (take <= 0) continue;
      await tx
        .insert(paymentAllocations)
        .values({ orgId, paymentId: adv.id, purchaseId: row.id, amount: take });
      pending = r2(pending - take);
    }
    await refreshOrder(tx, row.poId);
  }
  if (existing?.poId && existing.poId !== row.poId) await refreshOrder(tx, existing.poId);
  // A debit note refunded in cash or by bank is money coming back from the supplier.
  if (isNote && body.refundMode !== 'adjust')
    await tx.insert(payments).values({
      orgId,
      businessId: row.businessId,
      partyId: body.supplierId!,
      amount: row.total,
      mode: body.refundMode === 'cash' ? 'cash' : 'bank',
      paymentDate: row.purchaseDate,
      direction: 'in',
      source: 'debit_note_refund',
      purchaseId: row.id,
      number: row.number,
    });

  await refreshPurchases(tx, [row.id, row.againstPurchaseId]);
  const [saved] = await tx.select().from(purchases).where(eq(purchases.id, row.id));
  // A smaller bill can not drop below what vouchers already paid on it.
  if (existing && !isNote && saved.paidAmount > (await dueOfPurchase(tx, saved)) + 0.005)
    throw new AppError('over_allocated', 'The new total is below what has already been paid');
  // Phase 4: with the ledger on, the document is posted (an edit reverses the old postings and posts the new).
  await syncLedger(tx, orgId, 'purchase', row.id);
  await syncTds(tx, orgId, 'purchase', row.id);
  await audit(
    tx,
    orgId,
    `${isNote ? 'debit_note' : 'purchase'}.${existing ? 'update' : 'create'}`,
    'purchase',
    row.id,
    { after: { total: row.total, number, ...(duplicateOf ? { duplicateOf } : {}) } },
  );
  return toPurchase(saved, lines);
}

const sumOf = (a: number[]) => r2(a.reduce((s, x) => s + x, 0));

export function purchasesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/purchases',
    tag: 'Purchases',
    summary: 'List purchase bills and debit notes',
    query: pageQuery.extend(purchaseListQuery.shape),
    response: page(purchase),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, purchases, {
        ...query,
        where: and(
          query.docType ? eq(purchases.docType, query.docType) : undefined,
          query.supplierId ? eq(purchases.supplierId, query.supplierId) : undefined,
        ),
        searchColumns: [purchases.supplierName, purchases.invoiceNumber, purchases.number],
      });
      const out: Purchase[] = [];
      for (const r of res.data) out.push(toPurchase(r, await linesOf(tx, r.id)));
      return { data: out, nextCursor: res.nextCursor };
    },
  });

  route({
    method: 'get',
    path: '/v1/purchases/duplicate-check',
    tag: 'Purchases',
    summary: 'Is this supplier bill number already on a bill this financial year?',
    query: duplicateBillQuery,
    response: duplicateBillResult,
    handler: async ({ tx, query }) => {
      const dup = await findDuplicate(tx, { ...query, billNo: query.billNo });
      return {
        duplicate: dup
          ? {
              id: dup.id,
              number: dup.number,
              invoiceNumber: dup.invoiceNumber,
              purchaseDate: dup.purchaseDate,
            }
          : null,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/purchases/itc-at-risk',
    tag: 'Purchases',
    summary:
      'Bills whose supplier is unpaid and nearing (150+ days) or past 180 days: the credit at risk and the credit to reverse',
    query: itcQuery,
    response: itcAtRisk,
    handler: async ({ tx, query }) =>
      itcPositions(tx, query.businessId, query.asOf ?? new Date().toISOString().slice(0, 10)),
  });

  route({
    method: 'get',
    path: '/v1/purchases/:id',
    tag: 'Purchases',
    summary: 'One purchase bill or debit note',
    params: idParam,
    response: purchase,
    handler: async ({ tx, params }) => {
      const r = await loadPurchase(tx, params.id);
      return toPurchase(r, await linesOf(tx, r.id));
    },
  });

  route({
    method: 'get',
    path: '/v1/purchases/:id/returnable',
    tag: 'Purchases',
    summary: 'What is left to return on each line of a bill (for a debit note)',
    params: idParam,
    response: returnableResult,
    handler: async ({ tx, params }) => {
      const bill = await loadPurchase(tx, params.id);
      const lines = await linesOf(tx, bill.id);
      const left = returnableQtyPurchase(lines, await priorReturns(tx, bill.id));
      const key = (l: LineRow) =>
        l.itemId ? `id:${l.itemId}` : `nm:${l.name.trim().toLowerCase()}`;
      return {
        lines: lines.map((l) => ({
          itemId: l.itemId,
          name: l.name,
          billed: l.quantity,
          returnable: left[key(l)] ?? 0,
          returned: r2(l.quantity - (left[key(l)] ?? 0)),
          rate: l.rate,
          taxPercent: l.taxPercent,
        })),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/purchases',
    tag: 'Purchases',
    summary:
      'Record a purchase bill (stock in at landed cost, payments out) or a debit note (stock out, ITC reversed)',
    body: purchaseInput,
    response: purchase,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.purchaseDate,
        c.req.header('x-override-reason'),
      );
      return createPurchase(tx, orgId, body);
    },
  });

  route({
    method: 'put',
    path: '/v1/purchases/:id',
    tag: 'Purchases',
    summary:
      'Replace a purchase bill or debit note: its lines, stock, payments made with it and ledger postings are redone',
    params: idParam,
    body: purchaseInput,
    response: purchase,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      const row = await loadPurchase(tx, params.id);
      const why = c.req.header('x-override-reason');
      await guardPeriod(tx, orgId, auth, row.businessId, row.purchaseDate, why);
      await guardPeriod(tx, orgId, auth, body.businessId, body.purchaseDate, why);
      return createPurchase(tx, orgId, body, row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/purchases/:id',
    tag: 'Purchases',
    summary:
      'Move a purchase bill or debit note to the trash: its stock, payments made with it and refunds are undone',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const [current] = await tx
        .select()
        .from(purchases)
        .where(and(eq(purchases.id, params.id), isNull(purchases.deletedAt)));
      if (current)
        await guardPeriod(
          tx,
          orgId,
          auth,
          current.businessId,
          current.purchaseDate,
          c.req.header('x-override-reason'),
        );
      const [row] = await tx
        .update(purchases)
        .set({ deletedAt: new Date() })
        .where(and(eq(purchases.id, params.id), isNull(purchases.deletedAt)))
        .returning();
      if (!row) throw notFound('Purchase');
      // The stock this document moved leaves with it, and comes back if it is restored.
      await tx
        .update(stockMovements)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(stockMovements.refType, 'purchase'),
            eq(stockMovements.refId, row.id),
            isNull(stockMovements.deletedAt),
          ),
        );
      // Payments made with the bill and a debit note's refund belong to it and go; separate Payment Out vouchers that
      // paid it stay, their allocation to this bill is released (the money becomes the supplier's advance).
      const own = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.purchaseId, row.id),
            inArray(payments.source, ['purchase_inline', 'debit_note_refund']),
          ),
        );
      const ownIds = own.map((p) => p.id);
      if (ownIds.length) {
        await tx.delete(paymentAllocations).where(inArray(paymentAllocations.paymentId, ownIds));
        await tx.delete(payments).where(inArray(payments.id, ownIds));
      }
      await tx.delete(paymentAllocations).where(eq(paymentAllocations.purchaseId, row.id));
      await refreshPurchases(tx, [row.againstPurchaseId]);
      await refreshOrder(tx, row.poId);
      await syncLedger(tx, orgId, 'purchase', row.id);
      await syncTds(tx, orgId, 'purchase', row.id);
      await audit(tx, orgId, 'purchase.delete', 'purchase', row.id, {
        before: { total: row.total, number: row.number },
      });
      return { ok: true };
    },
  });

  route({
    method: 'get',
    path: '/v1/suppliers/:id/statement',
    tag: 'Purchases',
    summary: "A supplier's balance: bills − payments out − debit notes",
    params: idParam,
    response: supplierStatement,
    handler: async ({ tx, params }) => {
      const [p] = await tx
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.id, params.id), isNull(parties.deletedAt)));
      if (!p) throw notFound('Party');
      const docs = await tx
        .select()
        .from(purchases)
        .where(and(eq(purchases.supplierId, params.id), isNull(purchases.deletedAt)));
      const outs = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.partyId, params.id),
            eq(payments.direction, 'out'),
            isNull(payments.deletedAt),
          ),
        );
      // A debit note refunded in cash or bank is a return the supplier paid back: it nets out of the returns.
      const refunded = docs
        .filter((d) => d.docType === 'debit-note' && d.refundMode !== 'adjust')
        .reduce((t, d) => t + d.total, 0);
      return partyStatement({
        // What we owe on a bill is its total less the §194Q TDS we keep and pay to the government instead, and less
        // the RCM tax on a reverse-charge bill (D-13), which is paid to the government too.
        documents: docs
          .filter((d) => d.docType === 'bill')
          .map((d) => ({
            total: rcmSupplierDue({
              total: d.total,
              reverseCharge: d.reverseCharge,
              tax: d.cgst + d.sgst + d.igst,
              cess: d.cess,
              tds: d.tdsAmount,
            }),
          })),
        payments: outs.map((o) => ({
          amount: o.amount,
          discount: o.discountAmount,
          tds: o.tdsAmount,
        })),
        returns: [
          {
            total:
              docs.filter((d) => d.docType === 'debit-note').reduce((t, d) => t + d.total, 0) -
              refunded,
          },
        ],
      });
    },
  });

  // ---- expenses and other income (P3-S5 / P3-S6) ----
  route({
    method: 'get',
    path: '/v1/expenses',
    tag: 'Expenses',
    summary: 'List expenses, or other income with ?kind=income',
    query: pageQuery.extend(expenseListQuery.shape),
    response: page(expense),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, expenses, {
        ...query,
        where: query.kind ? eq(expenses.kind, query.kind) : undefined,
        searchColumns: [expenses.description, expenses.vendor, expenses.number],
      });
      return { data: res.data.map(toExpense), nextCursor: res.nextCursor };
    },
  });

  route({
    method: 'post',
    path: '/v1/expenses',
    tag: 'Expenses',
    summary: 'Record an expense or other income',
    body: expenseInput,
    response: expense,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await loadBusiness(tx, body.businessId);
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.expenseDate,
        c.req.header('x-override-reason'),
      );
      const values = await expenseValues(tx, body);
      const number =
        body.number ||
        (await nextSeriesNumber(
          tx,
          orgId,
          body.businessId,
          body.kind === 'income' ? 'INC' : 'EXP',
        ));
      const [row] = await tx
        .insert(expenses)
        .values({ ...values, number, orgId })
        .returning();
      await syncLedger(tx, orgId, 'expense', row.id);
      await audit(
        tx,
        orgId,
        `${body.kind === 'income' ? 'income' : 'expense'}.create`,
        'expense',
        row.id,
        {
          after: { amount: row.amount, tax: row.taxAmount },
        },
      );
      return toExpense(row);
    },
  });

  route({
    method: 'put',
    path: '/v1/expenses/:id',
    tag: 'Expenses',
    summary: 'Replace an expense or other income',
    params: idParam,
    body: expenseInput,
    response: expense,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      const why = c.req.header('x-override-reason');
      const [old] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, params.id), isNull(expenses.deletedAt)));
      if (old) await guardPeriod(tx, orgId, auth, old.businessId, old.expenseDate, why);
      await guardPeriod(tx, orgId, auth, body.businessId, body.expenseDate, why);
      const values = await expenseValues(tx, body);
      const [row] = await tx
        .update(expenses)
        .set({ ...values, ...(body.number ? { number: body.number } : {}), updatedAt: new Date() })
        .where(and(eq(expenses.id, params.id), isNull(expenses.deletedAt)))
        .returning();
      if (!row) throw notFound('Expense');
      await syncLedger(tx, orgId, 'expense', row.id);
      await audit(tx, orgId, 'expense.update', 'expense', row.id);
      return toExpense(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/expenses/:id',
    tag: 'Expenses',
    summary: 'Move an expense to the trash',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const [old] = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, params.id), isNull(expenses.deletedAt)));
      if (old)
        await guardPeriod(
          tx,
          orgId,
          auth,
          old.businessId,
          old.expenseDate,
          c.req.header('x-override-reason'),
        );
      const [row] = await tx
        .update(expenses)
        .set({ deletedAt: new Date() })
        .where(and(eq(expenses.id, params.id), isNull(expenses.deletedAt)))
        .returning();
      if (!row) throw notFound('Expense');
      await syncLedger(tx, orgId, 'expense', row.id);
      await audit(tx, orgId, 'expense.delete', 'expense', row.id);
      return { ok: true };
    },
  });

  route({
    method: 'get',
    path: '/v1/expense-categories',
    tag: 'Expenses',
    summary:
      'Expense and income categories (the income ones are added the first time they are asked for)',
    query: z.object({ kind: z.enum(['direct', 'indirect', 'income', 'expense']).optional() }),
    response: z.object({ data: z.array(expenseCategory) }),
    handler: async ({ tx, orgId, query }) => {
      if (query.kind === 'income')
        await tx
          .insert(expenseCategories)
          .values(
            DEFAULT_INCOME_CATEGORIES.map((c) => ({
              orgId,
              name: c.name,
              kind: 'income',
              isSystem: true,
            })),
          )
          .onConflictDoNothing();
      const rows = await tx
        .select()
        .from(expenseCategories)
        .where(
          and(
            isNull(expenseCategories.deletedAt),
            query.kind === 'income'
              ? eq(expenseCategories.kind, 'income')
              : query.kind === 'expense'
                ? ne(expenseCategories.kind, 'income')
                : query.kind
                  ? eq(expenseCategories.kind, query.kind)
                  : undefined,
          ),
        )
        .orderBy(expenseCategories.name);
      return { data: rows.map(toCategory) };
    },
  });

  route({
    method: 'post',
    path: '/v1/expense-categories',
    tag: 'Expenses',
    summary: 'Add an expense or income category, optionally under a parent',
    body: expenseCategoryInput,
    response: expenseCategory,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      if (body.parentId) {
        const [parent] = await tx
          .select()
          .from(expenseCategories)
          .where(and(eq(expenseCategories.id, body.parentId), isNull(expenseCategories.deletedAt)));
        if (!parent) throw notFound('Parent category');
        if ((parent.kind === 'income') !== (body.kind === 'income'))
          throw new AppError(
            'unprocessable',
            'An income category can only sit under another income category',
          );
      }
      const [c] = await tx
        .insert(expenseCategories)
        .values({ ...body, parentId: body.parentId ?? null, orgId })
        .returning();
      await audit(tx, orgId, 'expense_category.create', 'expense_category', c.id, { after: body });
      return toCategory(c);
    },
  });

  route({
    method: 'get',
    path: '/v1/expense-items',
    tag: 'Expenses',
    summary: 'Expense items (rent, electricity ...) with their SAC and GST rate',
    response: z.object({ data: z.array(expenseItem) }),
    handler: async ({ tx }) => {
      const rows = await tx
        .select()
        .from(expenseItems)
        .where(isNull(expenseItems.deletedAt))
        .orderBy(expenseItems.name);
      return { data: rows.map(toExpenseItem) };
    },
  });

  route({
    method: 'post',
    path: '/v1/expense-items',
    tag: 'Expenses',
    summary: 'Add an expense item',
    body: expenseItemInput,
    response: expenseItem,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const [row] = await tx
        .insert(expenseItems)
        .values({ ...body, defaultCategoryId: body.defaultCategoryId ?? null, orgId })
        .returning();
      await audit(tx, orgId, 'expense_item.create', 'expense_item', row.id, { after: body });
      return toExpenseItem(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/expense-items/:id',
    tag: 'Expenses',
    summary: 'Remove an expense item (expenses that used it keep their lines)',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(expenseItems)
        .set({ deletedAt: new Date() })
        .where(and(eq(expenseItems.id, params.id), isNull(expenseItems.deletedAt)))
        .returning();
      if (!row) throw notFound('Expense item');
      await audit(tx, orgId, 'expense_item.delete', 'expense_item', row.id);
      return { ok: true };
    },
  });
}

/**
 * The columns of an expense or income. Itemised: amount and GST come from the lines (expenseTotals). The payee must be
 * a live party; the category must be of the record's kind.
 */
async function expenseValues(tx: Tx, body: ExpenseInput) {
  if (body.payeePartyId) {
    const [p] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.id, body.payeePartyId), isNull(parties.deletedAt)));
    if (!p) throw notFound('Payee');
  }
  if (body.categoryId) {
    const [c] = await tx
      .select({ kind: expenseCategories.kind })
      .from(expenseCategories)
      .where(and(eq(expenseCategories.id, body.categoryId), isNull(expenseCategories.deletedAt)));
    if (!c) throw notFound('Category');
    if ((c.kind === 'income') !== (body.kind === 'income'))
      throw new AppError(
        'unprocessable',
        body.kind === 'income' ? 'Pick an income category' : 'Pick an expense category',
      );
  }
  const t = expenseTotals({
    items: body.items,
    amount: body.amount,
    gstAmount: body.taxAmount,
    interstate: body.interstate,
    itcEligible: body.itcEligible,
  });
  const amount = body.items.length ? t.taxable : body.amount;
  const taxAmount = body.items.length ? t.gst : body.taxAmount;
  if (body.paidAmount != null && body.paidAmount > r2(amount + taxAmount) + 0.005)
    throw new AppError('over_allocated', 'Paid is more than the total');
  const { items: lines, number: _n, ...cols } = body;
  return {
    ...cols,
    amount,
    taxAmount: body.exempt ? 0 : taxAmount,
    categoryId: cols.categoryId ?? null,
    payeePartyId: cols.payeePartyId ?? null,
    accountId: cols.accountId ?? null,
    fileId: cols.fileId ?? null,
    paidAmount: cols.paidAmount ?? null,
    data: { items: lines },
  };
}

const toCategory = (c: typeof expenseCategories.$inferSelect) => ({
  id: c.id,
  name: c.name,
  parentId: c.parentId,
  kind: c.kind,
  isSystem: c.isSystem,
});

const toExpenseItem = (r: typeof expenseItems.$inferSelect) => ({
  id: r.id,
  name: r.name,
  sac: r.sac,
  defaultRate: r.defaultRate,
  gstRate: r.gstRate,
  defaultCategoryId: r.defaultCategoryId,
  ...stamps(r),
});

const toExpense = (r: typeof expenses.$inferSelect) => {
  const total = r2(r.amount + r.taxAmount);
  return {
    id: r.id,
    businessId: r.businessId,
    kind: r.kind as 'expense' | 'income',
    number: r.number,
    categoryId: r.categoryId,
    expenseDate: r.expenseDate,
    description: r.description,
    vendor: r.vendor,
    payeePartyId: r.payeePartyId,
    amount: r.amount,
    taxAmount: r.taxAmount,
    interstate: r.interstate,
    itcEligible: r.itcEligible,
    exempt: r.exempt,
    items: ((r.data as { items?: ExpenseInput['items'] })?.items ?? []) as ExpenseInput['items'],
    paymentMode: r.paymentMode,
    accountId: r.accountId,
    paidAmount: r.paidAmount ?? total,
    total,
    fileId: r.fileId,
    ...stamps(r),
  };
};
