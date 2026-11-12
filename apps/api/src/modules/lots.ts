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

const { items, invoices, invoiceLines, purchases, purchaseLines } = schema;
type Extra = {
  batchNo?: string;
  expDate?: string;
  mfgDate?: string;
  serials?: string[];
  batches?: never;
  trackBatch?: boolean;
  trackSerial?: boolean;
};

/** Every move of these items: sales and returns (by document type), purchase bills and debit notes. */
async function movesOf(tx: Tx, itemIds: string[], excludeInvoiceId?: string | null) {
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
    });
  }
  return out;
}

/** Batch and serial stock of one item. */
export async function lotsOfItem(tx: Tx, itemId: string) {
  const [item] = await tx
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.deletedAt)));
  if (!item) throw notFound('Item');
  const opening = (item.extra ?? {}) as Parameters<typeof lotStock>[0] & {
    trackBatch?: boolean;
    trackSerial?: boolean;
  };
  const moves = (await movesOf(tx, [itemId])).get(itemId) ?? [];
  return {
    tracksBatches: tracksBatches(opening),
    tracksSerials: tracksSerials(opening),
    batches: lotStock(opening, moves),
    serials: serialStock(opening, moves),
  };
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
  const block = (await settingValue(tx, input.businessId, 'txn.negativeStock')) === 'block';
  const problems: string[] = [];
  for (const l of input.items) {
    const item = tracked.find((r) => r.id === l.itemId);
    if (!item) continue;
    const e = (item.extra ?? {}) as Parameters<typeof lotStock>[0];
    const m = moves.get(item.id) ?? [];
    problems.push(
      ...saleLotProblems(l, {
        batches: batchOn && tracksBatches(e) ? lotStock(e, m) : null,
        serials: serialOn && tracksSerials(e) ? serialStock(e, m) : null,
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
    summary: 'Batches (first-expiring first) and serial numbers of an item that are in stock',
    params: z.object({ id: z.string().uuid() }),
    handler: async ({ tx, params }) => lotsOfItem(tx, params.id),
  });
}
