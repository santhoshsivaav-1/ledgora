// Phase 3 (docs/AUDIT_2026-11.md): godowns, stock transfers between them, batches and serials across godowns, and a bill
// of materials with manufacture runs. Stock is still the sum of stock_movements rows (never an editable number); a godown
// only says which row went where, and a movement without a godown belongs to the default one. A transfer moves stock and
// changes no money; a manufacture run consumes components and produces the product at the components' cost, and posts one
// voucher (Dr Stock / Cr Stock) so the books keep matching the register.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  ACC,
  bomCost,
  bomNeeds,
  bomShort,
  lotStock,
  postJournal,
  serialStock,
  tracksBatches,
  tracksSerials,
} from '@ledgora/tax-engine';
import { page, pageQuery } from '@ledgora/contracts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { listPage } from '../http.ts';
import { audit } from '../audit.ts';
import { movesOf } from './lots.ts';
import { bumpCounter } from './workspace/store.ts';
import { ledgerEnabled, repost } from './ledgerRules.ts';

const {
  godowns,
  stockMovements,
  stockTransfers,
  stockTransferLines,
  bomComponents,
  manufactureRuns,
  items,
} = schema;

type Extra = { batchNo?: string; expDate?: string; mfgDate?: string; serials?: string[] };

const godownOut = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  address: z.string(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type GodownRow = typeof godowns.$inferSelect;
const godownJson = (r: GodownRow) => ({
  id: r.id,
  name: r.name,
  code: r.code,
  address: r.address,
  isDefault: r.isDefault,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** The business's default godown, if one is marked. Movements without a godown belong to it. */
export async function defaultGodown(tx: Tx) {
  const [row] = await tx
    .select()
    .from(godowns)
    .where(and(isNull(godowns.deletedAt), eq(godowns.isDefault, true)))
    .orderBy(asc(godowns.createdAt));
  return row ?? null;
}

/** Stock of these items in one godown: the rows named for it, plus the un-named rows when it is the default. */
export async function godownStock(
  tx: Tx,
  itemIds: string[],
  godownId: string,
  isDefault: boolean,
): Promise<Map<string, number>> {
  const out = new Map<string, number>(itemIds.map((id) => [id, 0]));
  if (!itemIds.length) return out;
  const cond = isDefault
    ? sql`(${stockMovements.godownId} = ${godownId} or ${stockMovements.godownId} is null)`
    : sql`${stockMovements.godownId} = ${godownId}`;
  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      q: sql<number>`sum(${stockMovements.quantity})::float8`,
    })
    .from(stockMovements)
    .where(and(sql`${stockMovements.itemId} in ${itemIds}`, isNull(stockMovements.deletedAt), cond))
    .groupBy(stockMovements.itemId);
  for (const r of rows) out.set(r.itemId, Math.round(r.q * 1000) / 1000);
  return out;
}

const line = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().positive(),
  batchNo: z.string().max(120).optional(),
  expDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  serials: z.array(z.string().max(120)).max(500).optional(),
});

async function godownById(tx: Tx, id: string, what: string) {
  const [row] = await tx
    .select()
    .from(godowns)
    .where(and(eq(godowns.id, id), isNull(godowns.deletedAt)));
  if (!row) throw notFound(what);
  return row;
}

/**
 * Refuses a transfer whose lines take more out of the from-godown than it holds, batch and serial rules included. The
 * lot facts come from the same engine the sale check uses (movesOf with transfers and manufacture runs included).
 */
async function checkTransferStock(
  tx: Tx,
  fromGodown: GodownRow,
  lines: { itemId: string; quantity: number; batchNo?: string; serials?: string[] }[],
) {
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const rows = await tx.select().from(items).where(inArray(items.id, ids));
  const problems: string[] = [];
  const batchIds = new Set(
    rows.filter((r) => tracksBatches((r.extra ?? {}) as never)).map((r) => r.id),
  );
  const serialIds = new Set(
    rows.filter((r) => tracksSerials((r.extra ?? {}) as never)).map((r) => r.id),
  );
  // Whole-item stock in the from-godown, for items that keep plain quantities. A batch or serial item's holdings live in
  // its opening lots plus the moves, and the lot check below covers it exactly, so it is left out here.
  const plainIds = rows.filter((r) => !batchIds.has(r.id) && !serialIds.has(r.id)).map((r) => r.id);
  const stock = await godownStock(tx, plainIds, fromGodown.id, fromGodown.isDefault);
  const wanted = new Map<string, number>();
  for (const l of lines)
    wanted.set(l.itemId, Math.round(((wanted.get(l.itemId) ?? 0) + l.quantity) * 1000) / 1000);
  for (const [id, q] of wanted) {
    if (batchIds.has(id) || serialIds.has(id)) continue;
    const have = stock.get(id) ?? 0;
    if (have < q) {
      const item = rows.find((r) => r.id === id);
      problems.push(`${item?.name ?? 'item'}: ${have} in ${fromGodown.name}, transfer needs ${q}`);
    }
  }
  // Batch and serial stock in the from-godown.
  if (batchIds.size || serialIds.size) {
    const moves = await movesOf(tx, [...batchIds, ...serialIds]);
    for (const l of lines) {
      const item = rows.find((r) => r.id === l.itemId);
      if (!item) continue;
      const e = (item.extra ?? {}) as Parameters<typeof tracksBatches>[0];
      const m = (moves.get(item.id) ?? []).filter(
        (mv) => mv.godownId === fromGodown.id || (!mv.godownId && fromGodown.isDefault),
      );
      if (batchIds.has(item.id)) {
        // The opening lots sit in the default godown: a from-godown other than the default starts from its moves alone.
        const open: Parameters<typeof lotStock>[0] = fromGodown.isDefault ? e : {};
        const have = lotStock(open, m).find((b) => b.batchNo === String(l.batchNo ?? '').trim());
        if (!l.batchNo) problems.push(`${item.name}: name the batch to move`);
        else if (!have)
          problems.push(`${item.name}: batch ${l.batchNo} is not in ${fromGodown.name}`);
        else if (have.qty < l.quantity)
          problems.push(
            `${item.name}: batch ${l.batchNo} has ${have.qty}, transfer needs ${l.quantity}`,
          );
      }
      if (serialIds.has(item.id)) {
        const open: Parameters<typeof serialStock>[0] = fromGodown.isDefault ? e : {};
        const inStock = new Set(serialStock(open, m));
        const serials = l.serials ?? [];
        if (serials.length !== l.quantity)
          problems.push(
            `${item.name}: ${l.quantity} serial numbers needed, ${serials.length} given`,
          );
        else
          for (const s of serials)
            if (!inStock.has(s))
              problems.push(`${item.name}: serial ${s} is not in ${fromGodown.name}`);
      }
    }
  }
  if (problems.length)
    throw new AppError(
      'unprocessable',
      `Not enough stock in ${fromGodown.name}: ${problems[0]}`,
      problems.map((message) => ({ path: 'lines', message })),
    );
}

/** The godowns of the organization, name order, each with whether it is the default. */
export function godownsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/godowns',
    tag: 'Godowns',
    summary: 'Every godown of the organization',
    response: z.object({ data: z.array(godownOut), defaultId: z.string().nullable() }),
    handler: async ({ tx }) => {
      const rows = await tx
        .select()
        .from(godowns)
        .where(isNull(godowns.deletedAt))
        .orderBy(asc(godowns.name));
      const def = rows.find((r) => r.isDefault) ?? (await defaultGodown(tx));
      return { data: rows.map(godownJson), defaultId: def?.id ?? null };
    },
  });

  route({
    method: 'post',
    path: '/v1/godowns',
    tag: 'Godowns',
    summary: 'Add a godown. The first one becomes the default',
    body: z.object({
      name: z.string().trim().min(1).max(120),
      code: z.string().trim().max(40).optional(),
      address: z.string().trim().max(500).optional(),
      isDefault: z.boolean().optional(),
    }),
    response: godownOut,
    handler: async ({ tx, orgId, body }) => {
      const existing = await tx.select().from(godowns).where(isNull(godowns.deletedAt));
      if (existing.some((g) => g.name.toLowerCase() === body.name.toLowerCase()))
        throw new AppError('conflict', `A godown named ${body.name} already exists`);
      const makeDefault = body.isDefault === true || existing.length === 0;
      if (makeDefault)
        await tx
          .update(godowns)
          .set({ isDefault: false })
          .where(and(isNull(godowns.deletedAt), eq(godowns.isDefault, true)));
      const [row] = await tx
        .insert(godowns)
        .values({
          orgId,
          name: body.name,
          code: body.code ?? '',
          address: body.address ?? '',
          isDefault: makeDefault,
        })
        .returning();
      await audit(tx, orgId, 'godown.create', 'godown', row!.id, { after: { name: row!.name } });
      return godownJson(row!);
    },
  });

  route({
    method: 'patch',
    path: '/v1/godowns/:id',
    tag: 'Godowns',
    summary: 'Rename a godown, or make it the default one',
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      name: z.string().trim().min(1).max(120).optional(),
      code: z.string().trim().max(40).optional(),
      address: z.string().trim().max(500).optional(),
      isDefault: z.boolean().optional(),
    }),
    response: godownOut,
    handler: async ({ tx, orgId, params, body }) => {
      const row = await godownById(tx, params.id, 'Godown');
      if (body.isDefault === true)
        await tx
          .update(godowns)
          .set({ isDefault: false })
          .where(and(isNull(godowns.deletedAt), eq(godowns.isDefault, true)));
      const [updated] = await tx
        .update(godowns)
        .set({
          name: body.name ?? row.name,
          code: body.code ?? row.code,
          address: body.address ?? row.address,
          isDefault: body.isDefault ?? row.isDefault,
          updatedAt: new Date(),
        })
        .where(eq(godowns.id, row.id))
        .returning();
      await audit(tx, orgId, 'godown.update', 'godown', row.id, { after: { name: updated!.name } });
      return godownJson(updated!);
    },
  });

  route({
    method: 'delete',
    path: '/v1/godowns/:id',
    tag: 'Godowns',
    summary: 'Remove a godown. One that still holds stock must be emptied first',
    params: z.object({ id: z.string().uuid() }),
    response: z.object({ success: z.boolean() }),
    handler: async ({ tx, orgId, params }) => {
      const row = await godownById(tx, params.id, 'Godown');
      const [{ q }] = await tx
        .select({ q: sql<number>`coalesce(sum(${stockMovements.quantity}), 0)::float8` })
        .from(stockMovements)
        .where(
          and(
            isNull(stockMovements.deletedAt),
            row.isDefault
              ? sql`(${stockMovements.godownId} = ${row.id} or ${stockMovements.godownId} is null)`
              : sql`${stockMovements.godownId} = ${row.id}`,
          ),
        );
      if (Math.abs(q) > 0.0001)
        throw new AppError(
          'unprocessable',
          `${row.name} still holds ${Math.round(q * 1000) / 1000} units of stock. Transfer them out first.`,
        );
      if (row.isDefault) {
        const rest = await tx
          .select()
          .from(godowns)
          .where(and(isNull(godowns.deletedAt), sql`${godowns.id} <> ${row.id}`))
          .orderBy(asc(godowns.createdAt));
        if (rest[0])
          await tx.update(godowns).set({ isDefault: true }).where(eq(godowns.id, rest[0].id));
      }
      await tx.update(godowns).set({ deletedAt: new Date() }).where(eq(godowns.id, row.id));
      await audit(tx, orgId, 'godown.delete', 'godown', row.id, { before: { name: row.name } });
      return { success: true as const };
    },
  });

  // ---- stock by godown ----
  route({
    method: 'get',
    path: '/v1/godowns/stock',
    tag: 'Godowns',
    summary:
      'Stock of every tracked item in one godown (the default godown also holds unnamed movements)',
    query: z.object({ godownId: z.string().uuid().optional() }),
    response: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number() })),
    handler: async ({ tx, query }) => {
      const g = query.godownId
        ? await godownById(tx, query.godownId, 'Godown')
        : await defaultGodown(tx);
      if (!g) return [];
      const tracked = await tx
        .select()
        .from(items)
        .where(and(isNull(items.deletedAt), eq(items.trackStock, true)));
      if (!tracked.length) return [];
      const stock = await godownStock(
        tx,
        tracked.map((r) => r.id),
        g.id,
        g.isDefault,
      );
      return tracked
        .map((r) => {
          let quantity = stock.get(r.id) ?? 0;
          // A batch or serial item's opening lots are not movements; they belong to the default godown.
          const e = (r.extra ?? {}) as { batches?: { qty?: number }[]; serials?: string[] };
          if (g.isDefault && quantity === 0 && (e.batches?.length || e.serials?.length)) {
            quantity =
              (e.batches ?? []).reduce((s, b) => s + (Number(b.qty) || 0), 0) +
              (e.serials?.length ?? 0);
          }
          return { itemId: r.id, quantity };
        })
        .filter((r) => r.quantity !== 0)
        .sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity));
    },
  });

  // ---- transfers ----
  route({
    method: 'get',
    path: '/v1/godowns/transfers',
    tag: 'Godowns',
    summary: 'Stock transfers, newest first, one page at a time',
    query: pageQuery,
    response: page(
      z.object({
        id: z.string().uuid(),
        number: z.string(),
        transferDate: z.string(),
        fromGodownId: z.string().uuid(),
        toGodownId: z.string().uuid(),
        note: z.string(),
        lines: z.array(
          z.object({
            itemId: z.string().uuid(),
            quantity: z.number(),
            batchNo: z.string().optional(),
            expDate: z.string().optional(),
            serials: z.array(z.string()).optional(),
          }),
        ),
        createdAt: z.string(),
      }),
    ),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, stockTransfers, { ...query });
      const ids = res.data.map((r) => r.id);
      const lines = ids.length
        ? await tx
            .select()
            .from(stockTransferLines)
            .where(
              and(
                sql`${stockTransferLines.transferId} in ${ids}`,
                isNull(stockTransferLines.deletedAt),
              ),
            )
        : [];
      return {
        data: res.data.map((r) => ({
          id: r.id,
          number: r.number,
          transferDate: r.transferDate,
          fromGodownId: r.fromGodownId,
          toGodownId: r.toGodownId,
          note: r.note,
          lines: lines
            .filter((l) => l.transferId === r.id)
            .map((l) => {
              const e = (l.extra ?? {}) as Extra;
              return {
                itemId: l.itemId,
                quantity: Number(l.quantity),
                batchNo: e.batchNo,
                expDate: e.expDate,
                serials: e.serials,
              };
            }),
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: res.nextCursor,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/godowns/transfers',
    tag: 'Godowns',
    summary:
      'Move stock from one godown to another: one movement out and one in per line, batch and serial facts riding on the line',
    body: z.object({
      transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      fromGodownId: z.string().uuid(),
      toGodownId: z.string().uuid(),
      note: z.string().max(500).optional(),
      lines: z.array(line).min(1).max(200),
    }),
    response: z.object({ success: z.boolean(), id: z.string().uuid(), number: z.string() }),
    handler: async ({ tx, orgId, body }) => {
      if (body.fromGodownId === body.toGodownId)
        throw new AppError('bad_request', 'Choose two different godowns');
      const from = await godownById(tx, body.fromGodownId, 'Godown');
      await godownById(tx, body.toGodownId, 'Godown');
      const names = await tx
        .select({
          id: items.id,
          name: items.name,
          trackStock: items.trackStock,
          extra: items.extra,
        })
        .from(items)
        .where(
          and(
            sql`${items.id} in ${[...new Set(body.lines.map((l) => l.itemId))]}`,
            isNull(items.deletedAt),
          ),
        );
      for (const l of body.lines) {
        const item = names.find((r) => r.id === l.itemId);
        if (!item) throw notFound('Item');
        if (!item.trackStock)
          throw new AppError(
            'unprocessable',
            `${item.name} does not track stock, so it can not be transferred`,
          );
      }
      await checkTransferStock(tx, from, body.lines);
      const seq = await bumpCounter(tx, orgId, 'stockTransferCounter', (c) => Number(c ?? 0) + 1);
      const number = `STR-${String(seq).padStart(5, '0')}`;
      const [t] = await tx
        .insert(stockTransfers)
        .values({
          orgId,
          number,
          transferDate: body.transferDate,
          fromGodownId: body.fromGodownId,
          toGodownId: body.toGodownId,
          note: body.note ?? '',
        })
        .returning();
      for (const l of body.lines) {
        const e: Extra = {};
        if (l.batchNo) e.batchNo = l.batchNo;
        if (l.expDate) e.expDate = l.expDate;
        if (l.serials?.length) e.serials = l.serials;
        await tx
          .insert(stockTransferLines)
          .values({ orgId, transferId: t!.id, itemId: l.itemId, quantity: l.quantity, extra: e });
        for (const g of [body.fromGodownId, body.toGodownId]) {
          await tx.insert(stockMovements).values({
            orgId,
            itemId: l.itemId,
            quantity: g === body.fromGodownId ? -l.quantity : l.quantity,
            reason: 'transfer',
            refType: 'transfer',
            refId: t!.id,
            godownId: g,
            note: `${number}${l.batchNo ? ` batch ${l.batchNo}` : ''}`,
          });
        }
      }
      await audit(tx, orgId, 'godown.transfer', 'stock_transfer', t!.id, {
        after: { number, lines: body.lines.length },
      });
      return { success: true as const, id: t!.id, number };
    },
  });

  route({
    method: 'delete',
    path: '/v1/godowns/transfers/:id',
    tag: 'Godowns',
    summary: 'Cancel a transfer: its movements are reversed and the stock goes back',
    params: z.object({ id: z.string().uuid() }),
    response: z.object({ success: z.boolean() }),
    handler: async ({ tx, orgId, params }) => {
      const [t] = await tx
        .select()
        .from(stockTransfers)
        .where(and(eq(stockTransfers.id, params.id), isNull(stockTransfers.deletedAt)));
      if (!t) throw notFound('Transfer');
      await tx
        .update(stockTransfers)
        .set({ deletedAt: new Date() })
        .where(eq(stockTransfers.id, t.id));
      await tx
        .update(stockTransferLines)
        .set({ deletedAt: new Date() })
        .where(and(eq(stockTransferLines.transferId, t.id), isNull(stockTransferLines.deletedAt)));
      await tx
        .update(stockMovements)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(stockMovements.refType, 'transfer'),
            eq(stockMovements.refId, t.id),
            isNull(stockMovements.deletedAt),
          ),
        );
      await audit(tx, orgId, 'godown.transfer.delete', 'stock_transfer', t.id, {
        before: { number: t.number },
      });
      return { success: true as const };
    },
  });

  // ---- bill of materials ----
  route({
    method: 'get',
    path: '/v1/items/:id/bom',
    tag: 'Godowns',
    summary:
      'The bill of materials of an item: what one unit is made of, and what that costs today',
    params: z.object({ id: z.string().uuid() }),
    response: z.object({
      lines: z.array(
        z.object({
          id: z.string().uuid(),
          componentItemId: z.string().uuid(),
          quantity: z.number(),
          scrapPercent: z.number(),
          note: z.string(),
        }),
      ),
      unitCost: z.number(),
    }),
    handler: async ({ tx, params }) => {
      const lines = await tx
        .select()
        .from(bomComponents)
        .where(and(eq(bomComponents.itemId, params.id), isNull(bomComponents.deletedAt)))
        .orderBy(asc(bomComponents.createdAt));
      const ids = lines.map((l) => l.componentItemId);
      const components = ids.length
        ? await tx
            .select({ id: items.id, purchasePrice: items.purchasePrice })
            .from(items)
            .where(sql`${items.id} in ${ids}`)
        : [];
      const costOf = (id: string) => components.find((c) => c.id === id)?.purchasePrice ?? 0;
      return {
        lines: lines.map((l) => ({
          id: l.id,
          componentItemId: l.componentItemId,
          quantity: Number(l.quantity),
          scrapPercent: Number(l.scrapPercent),
          note: l.note,
        })),
        unitCost: bomCost(lines, costOf),
      };
    },
  });

  route({
    method: 'put',
    path: '/v1/items/:id/bom',
    tag: 'Godowns',
    summary: 'Replace the bill of materials of an item',
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      lines: z
        .array(
          z.object({
            componentItemId: z.string().uuid(),
            quantity: z.number().positive(),
            scrapPercent: z.number().min(0).max(100).optional(),
            note: z.string().max(300).optional(),
          }),
        )
        .max(200),
    }),
    response: z.object({ success: z.boolean() }),
    handler: async ({ tx, orgId, params, body }) => {
      const [item] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, params.id), isNull(items.deletedAt)));
      if (!item) throw notFound('Item');
      if (body.lines.some((l) => l.componentItemId === params.id))
        throw new AppError('bad_request', 'An item can not be a component of itself');
      const ids = [...new Set(body.lines.map((l) => l.componentItemId))];
      const components = ids.length
        ? await tx
            .select({ id: items.id })
            .from(items)
            .where(and(sql`${items.id} in ${ids}`, isNull(items.deletedAt)))
        : [];
      for (const id of ids)
        if (!components.find((c) => c.id === id)) throw notFound('Component item');
      await tx
        .update(bomComponents)
        .set({ deletedAt: new Date() })
        .where(and(eq(bomComponents.itemId, params.id), isNull(bomComponents.deletedAt)));
      if (body.lines.length)
        await tx.insert(bomComponents).values(
          body.lines.map((l) => ({
            orgId,
            itemId: params.id,
            componentItemId: l.componentItemId,
            quantity: l.quantity,
            scrapPercent: l.scrapPercent ?? 0,
            note: l.note ?? '',
          })),
        );
      await audit(tx, orgId, 'bom.save', 'item', params.id, {
        after: { lines: body.lines.length },
      });
      return { success: true as const };
    },
  });

  // ---- manufacture ----
  route({
    method: 'get',
    path: '/v1/godowns/manufacture',
    tag: 'Godowns',
    summary: 'Manufacture runs, newest first, one page at a time',
    query: pageQuery,
    response: page(
      z.object({
        id: z.string().uuid(),
        number: z.string(),
        runDate: z.string(),
        itemId: z.string().uuid(),
        quantity: z.number(),
        unitCost: z.number(),
        godownId: z.string().uuid().nullable(),
        bomSnapshot: z.unknown(),
        note: z.string(),
        createdAt: z.string(),
      }),
    ),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, manufactureRuns, { ...query });
      return {
        data: res.data.map((r) => ({
          id: r.id,
          number: r.number,
          runDate: r.runDate,
          itemId: r.itemId,
          quantity: Number(r.quantity),
          unitCost: Number(r.unitCost),
          godownId: r.godownId ?? null,
          bomSnapshot: r.bomSnapshot,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: res.nextCursor,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/godowns/manufacture',
    tag: 'Godowns',
    summary:
      "Make `quantity` of an item from its bill of materials: components go out, the product comes in, at the components' cost, with one Stock voucher",
    body: z.object({
      runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      itemId: z.string().uuid(),
      quantity: z.number().positive(),
      godownId: z.string().uuid().optional(),
      note: z.string().max(500).optional(),
    }),
    response: z.object({
      success: z.boolean(),
      id: z.string().uuid(),
      number: z.string(),
      unitCost: z.number(),
    }),
    handler: async ({ tx, orgId, body }) => {
      const [item] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, body.itemId), isNull(items.deletedAt)));
      if (!item) throw notFound('Item');
      if (!item.trackStock)
        throw new AppError(
          'unprocessable',
          `${item.name} does not track stock, so it can not be manufactured`,
        );
      const g = body.godownId
        ? await godownById(tx, body.godownId, 'Godown')
        : await defaultGodown(tx);
      const bom = await tx
        .select()
        .from(bomComponents)
        .where(and(eq(bomComponents.itemId, body.itemId), isNull(bomComponents.deletedAt)));
      if (!bom.length)
        throw new AppError(
          'unprocessable',
          `${item.name} has no bill of materials. Add its components first`,
        );
      const ids = [...new Set(bom.map((l) => l.componentItemId))];
      const components = await tx
        .select({
          id: items.id,
          name: items.name,
          purchasePrice: items.purchasePrice,
          extra: items.extra,
        })
        .from(items)
        .where(and(sql`${items.id} in ${ids}`, isNull(items.deletedAt)));
      // Stock in the godown the run consumes from (the default godown also holds the unnamed movements), read once.
      const stockMap = g
        ? await godownStock(tx, ids, g.id, g.isDefault)
        : new Map(ids.map((id) => [id, 0]));
      const stockOf = (id: string) => {
        if (!g) return 0;
        let q = stockMap.get(id) ?? 0;
        // A batch or serial component's opening lots are not movements; they belong to the default godown.
        const e = (components.find((c) => c.id === id)?.extra ?? {}) as {
          batches?: { qty?: number }[];
          serials?: string[];
        };
        if (g.isDefault && q === 0 && (e.batches?.length || e.serials?.length)) {
          q =
            (e.batches ?? []).reduce((s, b) => s + (Number(b.qty) || 0), 0) +
            (e.serials?.length ?? 0);
        }
        return q;
      };
      const short = bomShort(bom, body.quantity, stockOf);
      if (short.length) {
        const problems = short.map(
          (s) =>
            `${components.find((c) => c.id === s.componentItemId)?.name ?? 'component'}: needs ${s.quantity}, ${g?.name ?? 'the godown'} has ${s.have}`,
        );
        throw new AppError(
          'unprocessable',
          `Not enough stock to make ${body.quantity} ${item.name}: ${problems[0]}`,
          problems.map((message) => ({ path: 'lines', message })),
        );
      }
      const costOf = (id: string) => components.find((c) => c.id === id)?.purchasePrice ?? 0;
      const unitCost = bomCost(bom, costOf);
      const needs = bomNeeds(bom, body.quantity);
      const seq = await bumpCounter(tx, orgId, 'manufactureCounter', (c) => Number(c ?? 0) + 1);
      const number = `MFG-${String(seq).padStart(5, '0')}`;
      const [run] = await tx
        .insert(manufactureRuns)
        .values({
          orgId,
          number,
          runDate: body.runDate,
          itemId: body.itemId,
          quantity: body.quantity,
          bomSnapshot: needs.map((n) => ({
            itemId: n.componentItemId,
            name: components.find((c) => c.id === n.componentItemId)?.name ?? '',
            quantity: n.quantity,
            unitCost: costOf(n.componentItemId),
            godownId: g?.id ?? null,
          })),
          unitCost,
          godownId: g?.id ?? null,
          note: body.note ?? '',
        })
        .returning();
      for (const n of needs) {
        await tx.insert(stockMovements).values({
          orgId,
          itemId: n.componentItemId,
          quantity: -n.quantity,
          reason: 'manufacture',
          refType: 'manufacture',
          refId: run!.id,
          godownId: g?.id ?? null,
          note: `${number}: made ${body.quantity} ${item.name}`,
        });
      }
      await tx.insert(stockMovements).values({
        orgId,
        itemId: body.itemId,
        quantity: body.quantity,
        reason: 'manufacture',
        refType: 'manufacture',
        refId: run!.id,
        godownId: g?.id ?? null,
        note: `${number}: made from ${needs.length} component${needs.length === 1 ? '' : 's'}`,
      });
      await audit(tx, orgId, 'godown.manufacture', 'manufacture_run', run!.id, {
        after: { number, quantity: body.quantity, unitCost },
      });
      // The books: one voucher at the components' cost (Dr Stock / Cr Stock), so the register and the ledger agree.
      const businessId = await defaultBusinessId(tx);
      if (businessId && (await ledgerEnabled(tx, businessId))) {
        try {
          await repost(tx, orgId, {
            businessId,
            refType: 'manufacture_run',
            refId: run!.id,
            postings: postJournal({
              id: run!.id,
              date: body.runDate,
              narration: `${number} · Made ${body.quantity} ${item.name}`,
              rows: [
                {
                  account: ACC.STOCK,
                  debit: Math.round(unitCost * body.quantity * 100) / 100,
                  narration: `${number}: finished goods into ${g?.name ?? 'stock'}`,
                },
                {
                  account: ACC.STOCK,
                  credit: Math.round(unitCost * body.quantity * 100) / 100,
                  narration: `${number}: components consumed`,
                },
              ],
            }),
          });
        } catch {
          /* a missing account or a posting refusal must not lose the run; the register stays the source of truth */
        }
      }
      return { success: true as const, id: run!.id, number, unitCost };
    },
  });
}

/** The organization's default business: whose books a manufacture run posts to. */
async function defaultBusinessId(tx: Tx) {
  const { businesses } = schema;
  const [b] = await tx
    .select({ id: businesses.id })
    .from(businesses)
    .where(isNull(businesses.deletedAt))
    .orderBy(desc(businesses.isDefault), asc(businesses.createdAt));
  return b?.id ?? null;
}
