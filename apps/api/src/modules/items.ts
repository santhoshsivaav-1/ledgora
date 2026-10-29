import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  idParam,
  item,
  itemInput,
  itemPatch,
  okBody,
  page,
  pageQuery,
  stockAdjustInput,
  stockMovement,
  unit,
  unitInput,
  type Item,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';

const { items, stockMovements, units } = schema;

/** Stock is always the sum of the movements (change 1.15). */
export const stockOf = (itemId: unknown) =>
  sql<number>`coalesce((select sum(m.quantity) from stock_movements m where m.item_id = ${itemId} and m.deleted_at is null), 0)::float8`;

async function stockFor(tx: Tx, ids: string[]) {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      qty: sql<number>`sum(${stockMovements.quantity})::float8`,
    })
    .from(stockMovements)
    .where(and(isNull(stockMovements.deletedAt), inArray(stockMovements.itemId, ids)))
    .groupBy(stockMovements.itemId);
  for (const r of rows) out.set(r.itemId, Math.round(r.qty * 1000) / 1000);
  return out;
}

const toItem = (r: typeof items.$inferSelect, stock: number): Item => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  hsn: r.hsn,
  unit: r.unit,
  salePrice: r.salePrice,
  purchasePrice: r.purchasePrice,
  taxPercent: r.taxPercent,
  cessPercent: r.cessPercent,
  trackStock: r.trackStock,
  extra: r.extra as Record<string, unknown>,
  stock,
  ...stamps(r),
});

export function itemsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/items',
    tag: 'Items',
    summary: 'List or search items, with current stock',
    query: pageQuery,
    response: page(item),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, items, {
        ...query,
        searchColumns: [items.name, items.sku, items.hsn],
      });
      const stock = await stockFor(
        tx,
        res.data.map((r) => r.id),
      );
      return {
        data: res.data.map((r) => toItem(r, stock.get(r.id) ?? 0)),
        nextCursor: res.nextCursor,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/items/:id',
    tag: 'Items',
    summary: 'One item',
    params: idParam,
    response: item,
    handler: async ({ tx, params }) => {
      const [row] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, params.id), isNull(items.deletedAt)));
      if (!row) throw notFound('Item');
      return toItem(row, (await stockFor(tx, [row.id])).get(row.id) ?? 0);
    },
  });

  route({
    method: 'post',
    path: '/v1/items',
    tag: 'Items',
    summary: 'Create an item (opening stock becomes the first stock movement)',
    body: itemInput,
    response: item,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const { openingStock, ...fields } = body;
      const [row] = await tx
        .insert(items)
        .values({ ...fields, orgId })
        .returning();
      if (openingStock > 0 && row.trackStock) {
        await tx
          .insert(stockMovements)
          .values({ orgId, itemId: row.id, quantity: openingStock, reason: 'opening' });
      }
      await audit(tx, orgId, 'item.create', 'item', row.id, { after: row });
      return toItem(row, row.trackStock ? openingStock : 0);
    },
  });

  route({
    method: 'patch',
    path: '/v1/items/:id',
    tag: 'Items',
    summary: 'Change an item (stock changes go through /stock)',
    params: idParam,
    body: itemPatch,
    response: item,
    handler: async ({ tx, orgId, params, body }) => {
      const [before] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, params.id), isNull(items.deletedAt)));
      if (!before) throw notFound('Item');
      const [row] = await tx
        .update(items)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(items.id, params.id))
        .returning();
      await audit(tx, orgId, 'item.update', 'item', row.id, { before, after: row });
      return toItem(row, (await stockFor(tx, [row.id])).get(row.id) ?? 0);
    },
  });

  route({
    method: 'delete',
    path: '/v1/items/:id',
    tag: 'Items',
    summary: 'Move an item to the trash',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(items)
        .set({ deletedAt: new Date() })
        .where(and(eq(items.id, params.id), isNull(items.deletedAt)))
        .returning();
      if (!row) throw notFound('Item');
      await audit(tx, orgId, 'item.delete', 'item', row.id, { before: row });
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/items/:id/stock',
    tag: 'Items',
    summary: 'Adjust stock by a positive or negative quantity',
    params: idParam,
    body: stockAdjustInput,
    response: item,
    handler: async ({ tx, orgId, params, body }) => {
      const [row] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, params.id), isNull(items.deletedAt)));
      if (!row) throw notFound('Item');
      await tx.insert(stockMovements).values({
        orgId,
        itemId: row.id,
        quantity: body.quantity,
        reason: 'adjustment',
        note: body.note,
      });
      await audit(tx, orgId, 'item.stock', 'item', row.id, { after: body });
      return toItem(row, (await stockFor(tx, [row.id])).get(row.id) ?? 0);
    },
  });

  route({
    method: 'get',
    path: '/v1/items/:id/movements',
    tag: 'Items',
    summary: 'Stock history of an item, newest first',
    params: idParam,
    response: z.object({ data: z.array(stockMovement) }),
    handler: async ({ tx, params }) => {
      const rows = await tx
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.itemId, params.id), isNull(stockMovements.deletedAt)))
        .orderBy(desc(stockMovements.movedAt), desc(stockMovements.id))
        .limit(500);
      return {
        data: rows.map((m) => ({
          id: m.id,
          itemId: m.itemId,
          quantity: m.quantity,
          reason: m.reason,
          refType: m.refType,
          refId: m.refId,
          note: m.note,
          movedAt: m.movedAt.toISOString(),
        })),
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/units',
    tag: 'Items',
    summary: 'Units of measure',
    response: z.object({ data: z.array(unit) }),
    handler: async ({ tx }) => {
      const rows = await tx.select().from(units).where(isNull(units.deletedAt)).orderBy(units.code);
      return { data: rows.map((u) => ({ id: u.id, code: u.code, name: u.name })) };
    },
  });

  route({
    method: 'post',
    path: '/v1/units',
    tag: 'Items',
    summary: 'Add a unit',
    body: unitInput,
    response: unit,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const [u] = await tx
        .insert(units)
        .values({ ...body, orgId })
        .returning();
      await audit(tx, orgId, 'unit.create', 'unit', u.id, { after: body });
      return { id: u.id, code: u.code, name: u.name };
    },
  });
}
