// Vyapar parity P3-S3: purchase orders. An order moves no stock, posts nothing and is not in any GST return; goods
// arrive on purchase bills converted from it (createPurchase with poId), which bump its received quantities.
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  idParam,
  okBody,
  page,
  pageQuery,
  purchase,
  purchaseOrder,
  purchaseOrderConvert,
  purchaseOrderInput,
  type PurchaseOrder,
} from '@ledgora/contracts';
import { cleanCharges, purchaseTotals } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { nextSeriesNumber } from './series.ts';
import { createPurchase } from './purchases.ts';
import { guardPeriod } from './saleRules.ts';
import { syncLedger } from './ledgerRules.ts';
import { orderProgressOf } from './purchaseRules.ts';

const { purchaseOrders, purchaseOrderLines, payments, parties } = schema;
type OrderRow = typeof purchaseOrders.$inferSelect;
const r2 = (n: number) => Math.round(n * 100) / 100;

async function toOrder(tx: Tx, r: OrderRow): Promise<PurchaseOrder> {
  const { lines, progress } = await orderProgressOf(tx, r.id);
  const advances = await tx
    .select({ amount: payments.amount })
    .from(payments)
    .where(
      and(
        eq(payments.purchaseOrderId, r.id),
        eq(payments.source, 'po_advance'),
        isNull(payments.deletedAt),
      ),
    );
  const data = (r.data ?? {}) as { charges?: PurchaseOrder['charges']; notes?: string };
  return {
    id: r.id,
    businessId: r.businessId,
    number: r.number,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierGstin: r.supplierGstin,
    orderDate: r.orderDate,
    expectedDate: r.expectedDate,
    interstate: r.interstate,
    status: progress.status as PurchaseOrder['status'],
    taxableAmount: r.taxableAmount,
    total: r.total,
    advance: r2(advances.reduce((s, a) => s + a.amount, 0)),
    pendingValue: r2(lines.reduce((s, l, i) => s + progress.lines[i].pending * l.rate, 0)),
    charges: cleanCharges(data.charges).map((c) => ({ ...c, hsn: c.hsn ?? '' })),
    notes: data.notes ?? '',
    items: lines.map((l, i) => ({
      itemId: l.itemId,
      name: l.name,
      hsn: l.hsn,
      quantity: l.quantity,
      rate: l.rate,
      taxPercent: l.taxPercent,
      cessPercent: l.cessPercent,
      receivedQty: progress.lines[i].received,
      pendingQty: progress.lines[i].pending,
    })),
    ...stamps(r),
  };
}

async function loadOrder(tx: Tx, id: string) {
  const [r] = await tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt)));
  if (!r) throw notFound('Purchase order');
  return r;
}

export function purchaseOrdersModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/purchase-orders',
    tag: 'Purchases',
    summary: 'Purchase orders, newest first',
    query: pageQuery.extend({
      status: z.enum(['open', 'partial', 'received', 'cancelled']).optional(),
      supplierId: z.string().uuid().optional(),
    }),
    response: page(purchaseOrder),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, purchaseOrders, {
        ...query,
        where: and(
          query.status ? eq(purchaseOrders.status, query.status) : undefined,
          query.supplierId ? eq(purchaseOrders.supplierId, query.supplierId) : undefined,
        ),
        searchColumns: [purchaseOrders.number, purchaseOrders.supplierName],
      });
      const data: PurchaseOrder[] = [];
      for (const r of res.data) data.push(await toOrder(tx, r));
      return { data, nextCursor: res.nextCursor };
    },
  });

  route({
    method: 'get',
    path: '/v1/purchase-orders/:id',
    tag: 'Purchases',
    summary: 'One purchase order with received and pending quantities',
    params: idParam,
    response: purchaseOrder,
    handler: async ({ tx, params }) => toOrder(tx, await loadOrder(tx, params.id)),
  });

  route({
    method: 'post',
    path: '/v1/purchase-orders',
    tag: 'Purchases',
    summary: 'Place a purchase order (no stock, ledger or GST effect); an advance is a Payment Out',
    body: purchaseOrderInput,
    response: purchaseOrder,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      let supplierName = body.supplierName;
      if (body.supplierId) {
        const [p] = await tx
          .select({ name: parties.name })
          .from(parties)
          .where(and(eq(parties.id, body.supplierId), isNull(parties.deletedAt)));
        if (!p) throw notFound('Supplier');
        supplierName ||= p.name;
      }
      if (body.advance && !body.supplierId)
        throw new AppError(
          'unprocessable',
          'Pick the supplier from your parties to record an advance',
        );
      const t = purchaseTotals({
        lines: body.items,
        charges: body.charges,
        interstate: body.interstate,
      });
      const number = body.number || (await nextSeriesNumber(tx, orgId, body.businessId, 'PO'));
      const [row] = await tx
        .insert(purchaseOrders)
        .values({
          orgId,
          businessId: body.businessId,
          number,
          supplierId: body.supplierId ?? null,
          supplierName,
          supplierGstin: body.supplierGstin,
          orderDate: body.orderDate,
          expectedDate: body.expectedDate ?? null,
          interstate: body.interstate,
          taxableAmount: t.taxable,
          total: t.total,
          data: { charges: body.charges, notes: body.notes },
        })
        .returning();
      await tx.insert(purchaseOrderLines).values(
        body.items.map((l) => ({
          orgId,
          orderId: row.id,
          itemId: l.itemId ?? null,
          name: l.name,
          hsn: l.hsn,
          quantity: l.quantity,
          rate: l.rate,
          taxPercent: l.taxPercent,
          cessPercent: l.cessPercent,
        })),
      );
      if (body.advance) {
        const [adv] = await tx
          .insert(payments)
          .values({
            orgId,
            businessId: body.businessId,
            partyId: body.supplierId!,
            amount: body.advance.amount,
            mode: body.advance.mode,
            paymentDate: body.orderDate,
            reference: body.advance.reference,
            accountId: body.advance.accountId ?? null,
            chequeDate: body.advance.chequeDate ?? null,
            direction: 'out',
            source: 'po_advance',
            purchaseOrderId: row.id,
            number,
          })
          .returning({ id: payments.id });
        await syncLedger(tx, orgId, 'payment', adv.id);
      }
      await audit(tx, orgId, 'purchase_order.create', 'purchase_order', row.id, {
        after: { number, total: row.total, advance: body.advance?.amount ?? 0 },
      });
      return toOrder(tx, row);
    },
  });

  route({
    method: 'post',
    path: '/v1/purchase-orders/:id/convert',
    tag: 'Purchases',
    summary:
      'Receive some or all of the pending goods on a purchase bill; the order advance is applied to it first',
    params: idParam,
    body: purchaseOrderConvert,
    response: purchase,
    status: 201,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      const order = await loadOrder(tx, params.id);
      await guardPeriod(
        tx,
        orgId,
        auth,
        order.businessId,
        body.purchaseDate,
        c.req.header('x-override-reason'),
      );
      const { lines } = await orderProgressOf(tx, order.id);
      const key = (l: { itemId?: string | null; name: string }) =>
        l.itemId ? `id:${l.itemId}` : `nm:${l.name.trim().toLowerCase()}`;
      const byKey = new Map(lines.map((l) => [key(l), l]));
      const items = body.lines.map((l) => {
        const src = byKey.get(key(l));
        if (!src) throw new AppError('unprocessable', `${l.name} is not on ${order.number}`);
        return {
          itemId: src.itemId,
          name: src.name,
          hsn: src.hsn,
          quantity: l.quantity,
          rate: src.rate,
          taxPercent: src.taxPercent,
          cessPercent: src.cessPercent,
          itcStatus: 'eligible' as const,
        };
      });
      const bill = await createPurchase(tx, orgId, {
        businessId: order.businessId,
        docType: 'bill',
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        supplierGstin: order.supplierGstin,
        supplierAddress: '',
        invoiceNumber: body.invoiceNumber,
        purchaseDate: body.purchaseDate,
        interstate: order.interstate,
        placeOfSupply: '',
        reverseCharge: false,
        paymentStatus: 'Unpaid',
        items,
        charges: [],
        roundOff: false,
        tds194QPercent: 0,
        payments: [],
        notes: `Received against ${order.number}`,
        poId: order.id,
        refundMode: 'adjust',
        allowDuplicate: body.allowDuplicate,
      });
      await audit(tx, orgId, 'purchase_order.convert', 'purchase_order', order.id, {
        after: { purchaseId: bill.id, lines: body.lines.length },
      });
      return bill;
    },
  });

  route({
    method: 'post',
    path: '/v1/purchase-orders/:id/cancel',
    tag: 'Purchases',
    summary:
      'Cancel an order: nothing more can be received; any advance stays with the supplier as our advance',
    params: idParam,
    response: purchaseOrder,
    handler: async ({ tx, orgId, params }) => {
      const order = await loadOrder(tx, params.id);
      if (order.status === 'cancelled')
        throw new AppError('already_cancelled', 'Already cancelled');
      const [row] = await tx
        .update(purchaseOrders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(purchaseOrders.id, order.id))
        .returning();
      await audit(tx, orgId, 'purchase_order.cancel', 'purchase_order', order.id);
      return toOrder(tx, row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/purchase-orders/:id',
    tag: 'Purchases',
    summary: 'Delete an order nothing has been received against',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const order = await loadOrder(tx, params.id);
      const { progress } = await orderProgressOf(tx, order.id);
      if (progress.lines.some((l) => l.received > 0))
        throw new AppError('conflict', 'Goods were received against this order; cancel it instead');
      await tx
        .update(purchaseOrders)
        .set({ deletedAt: new Date() })
        .where(eq(purchaseOrders.id, order.id));
      await audit(tx, orgId, 'purchase_order.delete', 'purchase_order', order.id);
      return { ok: true };
    },
  });
}
