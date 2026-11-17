// Batch and serial stock in the typed API (the POS counter and /v1/invoices). The rules are tax-engine/lots.ts; this
// file reads the moves from the database. An item tracks batches or serials when its extra says so (trackBatch /
// trackSerial) or it has opening lots (extra.batches / extra.serials). The checks apply only while the plan includes
// batch and serial tracking and Settings > Item has it on.
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  STOCK_SIGN,
  lotStock,
  saleLotProblems,
  serialStock,
  tracksBatches,
  tracksSerials,
  type LotMove,
} from '@ledgora/tax-engine';
import { planAllows } from '@ledgora/contracts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { planOfTx } from '../middleware/feature.ts';
import { settingValue } from './settingsStore.ts';

const {
  items,
  invoices,
  invoiceLines,
  purchases,
  purchaseLines,
  godowns,
  stockTransfers,
  stockTransferLines,
  manufactureRuns,
} = schema;
type Extra = {
  batchNo?: string;
  expDate?: string;
  mfgDate?: string;
  serials?: string[];
  godownId?: string;
  batches?: never;
  trackBatch?: boolean;
  trackSerial?: boolean;
};

/** Every move of these items: sales and returns (by document type), purchase bills and debit notes, transfers between
 *  godowns and manufacture runs — with the godown each move belongs to, so batch stock can be read per godown. */
export async function movesOf(tx: Tx, itemIds: string[], excludeInvoiceId?: string | null) {
  const out = new Map<string, LotMove[]>();
  if (!itemIds.length) return out;
  const push = (id: string | null, m: LotMove) => {
    if (!id) return;
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(m);
  };
  const sold = await tx
    .select({
      itemId: invoiceLines.itemId,
      quantity: invoiceLines.quantity,
      extra: invoiceLines.extra,
      type: invoices.invoiceType,
      status: invoices.status,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        inArray(invoiceLines.itemId, itemIds),
        isNull(invoices.deletedAt),
        excludeInvoiceId ? ne(invoices.id, excludeInvoiceId) : undefined,
      ),
    );
  for (const r of sold) {
    const sign = r.status === 'cancelled' ? 0 : (STOCK_SIGN[r.type] ?? -1);
    if (!sign) continue;
    const e = (r.extra ?? {}) as Extra;
    push(r.itemId, {
      sign,
      quantity: Number(r.quantity),
      batchNo: e.batchNo,
      expDate: e.expDate,
      mfgDate: e.mfgDate,
      serials: e.serials,
      godownId: e.godownId ?? null,
    });
  }
  const bought = await tx
    .select({
      itemId: purchaseLines.itemId,
      quantity: purchaseLines.quantity,
      extra: purchaseLines.extra,
      docType: purchases.docType,
    })
    .from(purchaseLines)
    .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
    .where(and(inArray(purchaseLines.itemId, itemIds), isNull(purchases.deletedAt)));
  for (const r of bought) {
    const e = (r.extra ?? {}) as Extra;
    push(r.itemId, {
      sign: r.docType === 'debit-note' ? -1 : 1,
      quantity: Number(r.quantity),
      batchNo: e.batchNo,
      expDate: e.expDate,
      mfgDate: e.mfgDate,
      serials: e.serials,
      godownId: e.godownId ?? null,
    });
  }
  // Transfers: out of the from-godown, into the to-godown, batch and serial facts riding on the transfer line.
  const moved = await tx
    .select({
      itemId: stockTransferLines.itemId,
      quantity: stockTransferLines.quantity,
      extra: stockTransferLines.extra,
      fromGodownId: stockTransfers.fromGodownId,
      toGodownId: stockTransfers.toGodownId,
    })
    .from(stockTransferLines)
    .innerJoin(stockTransfers, eq(stockTransfers.id, stockTransferLines.transferId))
    .where(
      and(
        inArray(stockTransferLines.itemId, itemIds),
        isNull(stockTransfers.deletedAt),
        isNull(stockTransferLines.deletedAt),
      ),
    );
  for (const r of moved) {
    const e = (r.extra ?? {}) as Extra;
    push(r.itemId, {
      sign: -1,
      quantity: Number(r.quantity),
      batchNo: e.batchNo,
      expDate: e.expDate,
      mfgDate: e.mfgDate,
      serials: e.serials,
      godownId: r.fromGodownId,
    });
    push(r.itemId, {
      sign: 1,
      quantity: Number(r.quantity),
      batchNo: e.batchNo,
      expDate: e.expDate,
      mfgDate: e.mfgDate,
      serials: e.serials,
      godownId: r.toGodownId,
    });
  }
  // Manufacture: the components out of the run's godown, the product into it (the snapshot holds what was consumed).
  const runs = await tx
    .select()
    .from(manufactureRuns)
    .where(and(inArray(manufactureRuns.itemId, itemIds), isNull(manufactureRuns.deletedAt)));
  for (const r of runs) {
    push(r.itemId, { sign: 1, quantity: Number(r.quantity), godownId: r.godownId });
    for (const c of (r.bomSnapshot ?? []) as { itemId?: string; quantity?: number }[]) {
      if (!c.itemId) continue;
      push(c.itemId, { sign: -1, quantity: Number(c.quantity) || 0, godownId: r.godownId });
    }
  }
  return out;
}

/**
 * Batch and serial stock of one item — the whole business, or just one godown when `godownId` is given. An item's
 * opening lots are not tagged with a godown, so they belong to the default one: a godown other than the default starts
 * empty and fills as transfers and purchases name it.
 */
export async function lotsOfItem(tx: Tx, itemId: string, godownId?: string | null) {
  const [item] = await tx
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)));
  if (!item) throw notFound('Item');
  const opening = (item.extra ?? {}) as Parameters<typeof lotStock>[0] & {
    trackBatch?: boolean;
    trackSerial?: boolean;
  };
  let moves = (await movesOf(tx, [itemId])).get(itemId) ?? [];
  let open: Parameters<typeof lotStock>[0] = opening;
  if (godownId) {
    const gd = await godownById(tx, godownId);
    moves = moves.filter((m) => m.godownId === gd.id || (!m.godownId && gd.isDefault));
    if (!gd.isDefault) open = {}; // the opening lots sit in the default godown
  }
  return {
    tracksBatches: tracksBatches(opening),
    tracksSerials: tracksSerials(opening),
    batches: lotStock(open, moves),
    serials: serialStock(open, moves),
  };
}

async function godownById(tx: Tx, id: string) {
  const [row] = await tx
    .select()
    .from(godowns)
    .where(and(eq(godowns.id, id), isNull(godowns.deletedAt)));
  if (!row) throw notFound('Godown');
  return row;
}

/**
 * Refuses a sale whose lines do not name a valid batch or serial numbers for items that track them (422 with every
 * problem). Only for documents that take stock out, and only when the plan and Settings > Item have tracking on.
 */
export async function checkSaleLots(
  tx: Tx,
  input: {
    businessId: string;
    invoiceType: string;
    invoiceDate: string;
    items: {
      itemId?: string | null;
      name: string;
      quantity: number;
      batchNo?: string | null;
      serials?: string[] | null;
      godownId?: string | null;
    }[];
  },
  excludeInvoiceId?: string | null,
) {
  if ((STOCK_SIGN[input.invoiceType] ?? -1) >= 0) return;
  const [batchOn, serialOn] = await Promise.all([
    settingValue(tx, input.businessId, 'item.batch'),
    settingValue(tx, input.businessId, 'item.serial'),
  ]);
  if (!batchOn && !serialOn) return;
  if (!planAllows((await planOfTx(tx)).plan, 'inventory_pro')) return;
  const ids = [...new Set(input.items.map((l) => l.itemId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const rows = await tx.select().from(items).where(inArray(items.id, ids));
  const tracked = rows.filter((r) => {
    const e = (r.extra ?? {}) as Parameters<typeof tracksBatches>[0];
    return (batchOn && tracksBatches(e)) || (serialOn && tracksSerials(e));
  });
  if (!tracked.length) return;
  const moves = await movesOf(
    tx,
    tracked.map((r) => r.id),
    excludeInvoiceId,
  );
  // A line that names a godown sells from that godown; a move without a godown belongs to the default one (Phase 3).
  const [def] = await tx
    .select({ id: godowns.id, isDefault: godowns.isDefault })
    .from(godowns)
    .where(and(isNull(godowns.deletedAt), eq(godowns.isDefault, true)));
  const inGodown = (id: string, gid: string | null | undefined) => {
    const all = moves.get(id) ?? [];
    if (!gid) return all;
    return all.filter(
      (m) => m.godownId === gid || (!m.godownId && def?.isDefault && def.id === gid),
    );
  };
  const block = (await settingValue(tx, input.businessId, 'txn.negativeStock')) === 'block';
  const problems: string[] = [];
  for (const l of input.items) {
    const item = tracked.find((r) => r.id === l.itemId);
    if (!item) continue;
    const e = (item.extra ?? {}) as Parameters<typeof lotStock>[0];
    const m = inGodown(item.id, l.godownId);
    // The opening lots sit in the default godown: a line selling from another godown starts from its moves alone.
    const open: Parameters<typeof lotStock>[0] = l.godownId && l.godownId !== def?.id ? {} : e;
    problems.push(
      ...saleLotProblems(l, {
        batches: batchOn && tracksBatches(e) ? lotStock(open, m) : null,
        serials: serialOn && tracksSerials(e) ? serialStock(open, m) : null,
        date: input.invoiceDate,
        block,
      }),
    );
  }
  if (problems.length)
    throw new AppError(
      'unprocessable',
      problems[0]!,
      problems.map((message) => ({ path: 'items', message })),
    );
}

export function lotsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/items/:id/lots',
    tag: 'Items',
    summary:
      'Batches (first-expiring first) and serial numbers of an item that are in stock, in the whole business or one godown',
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ godownId: z.string().uuid().optional() }),
    handler: async ({ tx, params, query }) => lotsOfItem(tx, params.id, query.godownId ?? null),
  });
}
