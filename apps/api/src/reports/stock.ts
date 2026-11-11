// Vyapar parity P6-S4, item and stock reports: Stock Summary and Detail, Item Detail, Low Stock, Item by Party, Item-wise
// and Category-wise P&L, sale / purchase and stock by category, Item-wise Discount. Stock is the organization's (items
// belong to it); valuation is moving weighted-average cost (tax-engine reports.ts). An item's category is the text in
// its `extra.category` until Item Categories exist (P1), with '' shown as "Uncategorised".
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import { uuid } from '@ledgora/contracts';
import { stockValuation } from '@ledgora/tax-engine';
import {
  billProfit,
  costing,
  lineCost,
  lineDiscount,
  saleDocs,
  saleLines,
  saleSign,
} from './documents.ts';
import { partyByItem } from './party.ts';
import { commonParams, defineReport } from './registry.ts';
import { fyStartOf, r2, stockMoves, today } from './shared.ts';

const { items, stockMovements, invoices, invoiceLines, purchases, purchaseLines, parties } = schema;
const flag = z.enum(['0', '1']).default('0');
const period = (p: { from?: string; to?: string }) => ({
  from: p.from ?? fyStartOf(p.to ?? today()),
  to: p.to ?? today(),
});
const sum = (rows: Record<string, unknown>[], k: string) =>
  r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
const qty3 = (n: number) => Math.round(n * 1000) / 1000;
const categoryOf = (extra: unknown) => {
  const c = (extra as { category?: unknown } | null)?.category;
  return typeof c === 'string' && c.trim() ? c.trim() : 'Uncategorised';
};
const minStockOf = (extra: unknown) => {
  const m = Number((extra as { minStock?: unknown } | null)?.minStock);
  return Number.isFinite(m) && m > 0 ? m : null;
};

async function liveItems(tx: Tx) {
  return tx.select().from(items).where(isNull(items.deletedAt)).orderBy(asc(items.name));
}

/** Quantity, average cost and value of every tracked item on a date. */
async function valuation(tx: Tx, asOf: string) {
  const { moves } = await stockMoves(tx);
  const v = stockValuation(moves, asOf);
  return new Map(v.rows.map((r) => [r.id, r]));
}

// ---- Stock Summary and by category ----------------------------------------------------------------------------------------

export const stockSummary = defineReport({
  id: 'stock-summary',
  title: 'Stock Summary',
  group: 'item',
  description: 'Quantity and value of each item on the date, at weighted-average purchase cost.',
  params: commonParams.extend({ hideZero: flag, category: z.string().optional() }),
  run: async (tx, p) => {
    const asOf = p.to ?? today();
    const v = await valuation(tx, asOf);
    const rows = (await liveItems(tx))
      .filter((i) => i.trackStock && (!p.category || categoryOf(i.extra) === p.category))
      .map((i) => {
        const s = v.get(i.id);
        return {
          id: i.id,
          item: i.name,
          category: categoryOf(i.extra),
          unit: i.unit,
          salePrice: i.salePrice,
          purchasePrice: i.purchasePrice,
          qty: s?.qty ?? 0,
          avgCost: s?.avg ?? 0,
          value: s?.value ?? 0,
        };
      })
      .filter((r) => p.hideZero !== '1' || Math.abs(r.qty) > 0.0005);
    return { rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') }, meta: { asOf } };
  },
});

export const stockByCategory = defineReport({
  id: 'stock-by-category',
  title: 'Stock Summary by Item Category',
  group: 'item',
  description: 'Quantity and value of stock on the date, added up by item category.',
  params: commonParams,
  run: async (tx, p) => {
    const asOf = p.to ?? today();
    const v = await valuation(tx, asOf);
    const by = new Map<string, { qty: number; value: number }>();
    for (const i of await liveItems(tx)) {
      if (!i.trackStock) continue;
      const c = categoryOf(i.extra);
      const s = v.get(i.id);
      const cur = by.get(c) ?? { qty: 0, value: 0 };
      by.set(c, { qty: qty3(cur.qty + (s?.qty ?? 0)), value: r2(cur.value + (s?.value ?? 0)) });
    }
    const rows = [...by.entries()]
      .map(([category, x]) => ({ id: category, category, ...x }))
      .sort((a, b) => a.category.localeCompare(b.category));
    return { rows, totals: { qty: sum(rows, 'qty'), value: sum(rows, 'value') }, meta: { asOf } };
  },
});

// ---- Stock Detail and Item Detail -----------------------------------------------------------------------------------------

/**
 * The movements of one item with their documents: date by the bill or invoice (else the day recorded), what it was,
 * the party, quantity in and out and a running balance. `price` is the document's rate (Item Detail); `cost` what a unit
 * was costed at (Stock Detail).
 */
async function itemLedger(tx: Tx, itemId: string, from: string, to: string) {
  const [item] = await tx.select().from(items).where(eq(items.id, itemId));
  if (!item) return null;
  const rows = await tx
    .select({
      id: stockMovements.id,
      qty: stockMovements.quantity,
      reason: stockMovements.reason,
      refType: stockMovements.refType,
      refId: stockMovements.refId,
      movedAt: stockMovements.movedAt,
      billDate: purchases.purchaseDate,
      billNo: purchases.invoiceNumber,
      billNo2: purchases.number,
      supplierId: purchases.supplierId,
      supplierName: purchases.supplierName,
      invDate: invoices.invoiceDate,
      invNo: invoices.number,
      partyId: invoices.partyId,
    })
    .from(stockMovements)
    .leftJoin(
      purchases,
      and(eq(stockMovements.refType, 'purchase'), eq(purchases.id, stockMovements.refId)),
    )
    .leftJoin(
      invoices,
      and(eq(stockMovements.refType, 'invoice'), eq(invoices.id, stockMovements.refId)),
    )
    .where(and(eq(stockMovements.itemId, itemId), isNull(stockMovements.deletedAt)))
    .orderBy(asc(stockMovements.movedAt));
  const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const dated = rows
    .map((r) => ({ ...r, date: r.billDate ?? r.invDate ?? ist(r.movedAt) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const billIds = [
    ...new Set(dated.filter((r) => r.refType === 'purchase' && r.refId).map((r) => r.refId!)),
  ];
  const invIds = [
    ...new Set(dated.filter((r) => r.refType === 'invoice' && r.refId).map((r) => r.refId!)),
  ];
  const rate = new Map<string, number>();
  const landed = new Map<string, number>();
  if (billIds.length)
    for (const l of await tx
      .select()
      .from(purchaseLines)
      .where(
        and(
          inArray(purchaseLines.purchaseId, billIds),
          eq(purchaseLines.itemId, itemId),
          isNull(purchaseLines.deletedAt),
        ),
      )) {
      rate.set(`purchase:${l.purchaseId}`, l.rate);
      landed.set(`purchase:${l.purchaseId}`, l.landedCost > 0 ? l.landedCost : l.rate);
    }
  if (invIds.length)
    for (const l of await tx
      .select()
      .from(invoiceLines)
      .where(
        and(
          inArray(invoiceLines.invoiceId, invIds),
          eq(invoiceLines.itemId, itemId),
          isNull(invoiceLines.deletedAt),
        ),
      ))
      rate.set(`invoice:${l.invoiceId}`, l.rate);
  const names = new Map(
    (
      await tx
        .select({ id: parties.id, name: parties.name })
        .from(parties)
        .where(
          inArray(
            parties.id,
            [
              ...new Set(
                dated.map((r) => r.partyId ?? r.supplierId).filter((x): x is string => !!x),
              ),
            ].concat('00000000-0000-0000-0000-000000000000'),
          ),
        )
    ).map((x) => [x.id, x.name]),
  );
  const cost = await costing(tx);
  const opening = qty3(dated.filter((r) => r.date < from).reduce((s, r) => s + r.qty, 0));
  const label: Record<string, string> = {
    opening: 'Opening stock',
    sale: 'Sale',
    sale_return: 'Sale return',
    purchase: 'Purchase',
    purchase_return: 'Purchase return',
    adjustment: 'Adjustment',
    cancel: 'Cancelled sale',
  };
  let run = opening;
  const out = dated
    .filter((r) => r.date >= from && r.date <= to)
    .map((r) => {
      run = qty3(run + r.qty);
      const key = `${r.refType}:${r.refId}`;
      const unitCost =
        r.reason === 'purchase'
          ? (landed.get(key) ?? 0)
          : r.reason === 'opening'
            ? item.purchasePrice
            : cost(itemId, r.date);
      return {
        id: r.id,
        refType: r.refType ?? '',
        refId: r.refId ?? '',
        date: r.date,
        type: label[r.reason] ?? r.reason,
        number: r.invNo ?? (r.billNo || r.billNo2 || ''),
        party: names.get(r.partyId ?? r.supplierId ?? '') ?? r.supplierName ?? '',
        qtyIn: r.qty > 0 ? r.qty : null,
        qtyOut: r.qty < 0 ? -r.qty : null,
        price: rate.get(key) ?? null,
        cost: r2(unitCost),
        balance: run,
      };
    });
  // The value comes from the same valuation as Stock Summary, so the two always agree.
  const w = (await valuation(tx, to)).get(itemId);
  return {
    item,
    rows: out,
    opening,
    qtyIn: qty3(out.reduce((s, r) => s + (r.qtyIn ?? 0), 0)),
    qtyOut: qty3(out.reduce((s, r) => s + (r.qtyOut ?? 0), 0)),
    closing: run,
    value: w?.value ?? 0,
    avg: w?.avg ?? 0,
  };
}

function ledgerReport(id: string, title: string, description: string) {
  return defineReport({
    id,
    title,
    group: 'item',
    description,
    params: commonParams.extend({ itemId: uuid }),
    run: async (tx, p) => {
      const { from, to } = period(p);
      const l = await itemLedger(tx, p.itemId, from, to);
      if (!l)
        return {
          rows: [],
          totals: { opening: 0, qtyIn: 0, qtyOut: 0, closing: 0, value: 0 },
          meta: { from, to, item: '' },
        };
      return {
        rows: l.rows,
        totals: {
          opening: l.opening,
          qtyIn: l.qtyIn,
          qtyOut: l.qtyOut,
          closing: l.closing,
          value: l.value,
        },
        meta: { from, to, item: l.item.name, unit: l.item.unit, avgCost: l.avg },
      };
    },
  });
}
export const stockDetail = ledgerReport(
  'stock-detail',
  'Stock Detail',
  'One item: opening quantity, each movement with the cost it was valued at, closing quantity and value.',
);
export const itemDetail = ledgerReport(
  'item-detail',
  'Item Detail',
  'One item as a ledger: every sale, purchase and adjustment with its party and price, and the running stock.',
);

// ---- Low Stock ------------------------------------------------------------------------------------------------------------

export const lowStock = defineReport({
  id: 'low-stock',
  title: 'Low Stock Summary',
  group: 'item',
  description:
    'Items whose stock is at or below their minimum (the item’s own, else the limit given here, 5 by default).',
  params: commonParams.extend({
    threshold: z.coerce.number().min(0).default(5),
    category: z.string().optional(),
  }),
  run: async (tx, p) => {
    const v = await valuation(tx, today());
    const rows = (await liveItems(tx))
      .filter((i) => i.trackStock && (!p.category || categoryOf(i.extra) === p.category))
      .map((i) => {
        const min = minStockOf(i.extra) ?? p.threshold;
        const q = v.get(i.id)?.qty ?? 0;
        return {
          id: i.id,
          item: i.name,
          category: categoryOf(i.extra),
          unit: i.unit,
          minStock: min,
          current: q,
          shortfall: qty3(Math.max(0, min - q)),
        };
      })
      .filter((r) => r.current <= r.minStock)
      .sort((a, b) => b.shortfall - a.shortfall);
    return { rows, totals: { shortfall: sum(rows, 'shortfall'), count: rows.length }, meta: {} };
  },
});

// ---- Item by Party --------------------------------------------------------------------------------------------------------

export const itemByParty = defineReport({
  id: 'item-by-party',
  title: 'Item Report by Party',
  group: 'item',
  description:
    'For one item: which parties bought it and which supplied it, with quantity and value.',
  params: commonParams.extend({ itemId: uuid }),
  run: async (tx, p, ctx) => {
    const r = await partyByItem.run(tx, p, ctx);
    return { ...r, rows: r.rows.map(({ item: _i, ...x }) => x) };
  },
});

// ---- Item-wise and Category-wise P&L, sale by category, discount ---------------------------------------------------------

/** Profit per item over a period: the same invoices, lines and costing as Bill Wise Profit, so the two always agree. */
async function itemProfit(tx: Tx, businessId: string, from: string, to: string) {
  const list = await billProfit(tx, businessId, from, to);
  const cost = await costing(tx);
  const names = new Map((await liveItems(tx)).map((i) => [i.id, i]));
  const by = new Map<
    string,
    { item: string; category: string; saleQty: number; saleAmt: number; cost: number }
  >();
  for (const x of list)
    for (const l of x.lines) {
      const k = l.itemId ?? 'none';
      const it = l.itemId ? names.get(l.itemId) : undefined;
      const v = by.get(k) ?? {
        item: it?.name ?? (l.itemId ? l.name : 'Other (no item)'),
        category: it ? categoryOf(it.extra) : 'Uncategorised',
        saleQty: 0,
        saleAmt: 0,
        cost: 0,
      };
      v.saleQty += l.quantity;
      v.saleAmt += l.taxableAmount;
      v.cost += lineCost(l, cost, x.d.invoiceDate);
      by.set(k, v);
    }
  const v = await valuation(tx, to);
  return [...by.entries()].map(([id, x]) => ({
    id,
    item: x.item,
    category: x.category,
    saleQty: qty3(x.saleQty),
    saleAmt: r2(x.saleAmt),
    cost: r2(x.cost),
    closingStock: v.get(id)?.value ?? 0,
    profit: r2(x.saleAmt - x.cost),
  }));
}

export const itemPnl = defineReport({
  id: 'item-pnl',
  title: 'Item-wise Profit & Loss',
  group: 'item',
  description: 'Sale value, cost, closing stock value and profit for each item sold in the period.',
  profit: true,
  params: commonParams.extend({ category: z.string().optional() }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const rows = (await itemProfit(tx, p.businessId, from, to))
      .filter((r) => !p.category || r.category === p.category)
      .sort((a, b) => b.profit - a.profit);
    return {
      rows,
      totals: {
        saleQty: sum(rows, 'saleQty'),
        saleAmt: sum(rows, 'saleAmt'),
        cost: sum(rows, 'cost'),
        closingStock: sum(rows, 'closingStock'),
        profit: sum(rows, 'profit'),
      },
      meta: { from, to },
    };
  },
});

export const categoryPnl = defineReport({
  id: 'category-pnl',
  title: 'Item Category-wise Profit & Loss',
  group: 'item',
  description: 'Item-wise profit added up by item category.',
  profit: true,
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = period(p);
    const by = new Map<
      string,
      { saleQty: number; saleAmt: number; cost: number; closingStock: number; profit: number }
    >();
    for (const r of await itemProfit(tx, p.businessId, from, to)) {
      const c = by.get(r.category) ?? {
        saleQty: 0,
        saleAmt: 0,
        cost: 0,
        closingStock: 0,
        profit: 0,
      };
      by.set(r.category, {
        saleQty: qty3(c.saleQty + r.saleQty),
        saleAmt: r2(c.saleAmt + r.saleAmt),
        cost: r2(c.cost + r.cost),
        closingStock: r2(c.closingStock + r.closingStock),
        profit: r2(c.profit + r.profit),
      });
    }
    const rows = [...by.entries()]
      .map(([category, x]) => ({ id: category, category, ...x }))
      .sort((a, b) => b.profit - a.profit);
    return {
      rows,
      totals: {
        saleAmt: sum(rows, 'saleAmt'),
        cost: sum(rows, 'cost'),
        profit: sum(rows, 'profit'),
      },
      meta: { from, to },
    };
  },
});

export const byCategory = defineReport({
  id: 'by-category',
  title: 'Sale / Purchase by Item Category',
  group: 'item',
  description:
    'Quantity and value of sales (or purchases) per item category, before GST and net of returns.',
  params: commonParams.extend({ side: z.enum(['sale', 'purchase']).default('sale') }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const cat = new Map((await liveItems(tx)).map((i) => [i.id, categoryOf(i.extra)]));
    const by = new Map<string, { qty: number; amount: number }>();
    const add = (itemId: string | null, q: number, a: number) => {
      const c = (itemId && cat.get(itemId)) || 'Uncategorised';
      const v = by.get(c) ?? { qty: 0, amount: 0 };
      by.set(c, { qty: qty3(v.qty + q), amount: r2(v.amount + a) });
    };
    if (p.side === 'sale') {
      const docs = await saleDocs(tx, p.businessId, from, to);
      const sign = new Map(docs.map((d) => [d.id, saleSign(d.invoiceType)]));
      for (const l of await saleLines(
        tx,
        docs.map((d) => d.id),
      ))
        add(
          l.itemId,
          (sign.get(l.invoiceId) ?? 1) * l.quantity,
          (sign.get(l.invoiceId) ?? 1) * l.taxableAmount,
        );
    } else {
      const bills = await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.businessId, p.businessId),
            isNull(purchases.deletedAt),
            inArray(purchases.docType, ['bill', 'debit-note']),
            gte(purchases.purchaseDate, from),
            lte(purchases.purchaseDate, to),
          ),
        );
      const sign = new Map(bills.map((b) => [b.id, b.docType === 'debit-note' ? -1 : 1]));
      if (bills.length)
        for (const l of await tx
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
          ))
          add(
            l.itemId,
            (sign.get(l.purchaseId) ?? 1) * l.quantity,
            (sign.get(l.purchaseId) ?? 1) * l.taxableAmount,
          );
    }
    const rows = [...by.entries()]
      .map(([category, x]) => ({ id: category, category, ...x }))
      .sort((a, b) => b.amount - a.amount);
    return {
      rows,
      totals: { qty: sum(rows, 'qty'), amount: sum(rows, 'amount') },
      meta: { from, to, side: p.side },
    };
  },
});

export const itemDiscount = defineReport({
  id: 'item-discount',
  title: 'Item-wise Discount',
  group: 'item',
  description:
    'For each item sold: quantity, value charged, the discount given on it and the discount as a share of the undiscounted value.',
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = period(p);
    const docs = (await saleDocs(tx, p.businessId, from, to, { creditNotes: false })).filter(
      (d) => d.status !== 'cancelled',
    );
    const by = new Map<string, { item: string; qty: number; amount: number; discount: number }>();
    for (const l of await saleLines(
      tx,
      docs.map((d) => d.id),
    )) {
      const k = l.itemId ?? l.name;
      const v = by.get(k) ?? { item: l.name, qty: 0, amount: 0, discount: 0 };
      v.qty += l.quantity;
      v.amount += l.taxableAmount;
      v.discount += lineDiscount(l);
      by.set(k, v);
    }
    const rows = [...by.entries()]
      .map(([id, v]) => ({
        id,
        item: v.item,
        qty: qty3(v.qty),
        amount: r2(v.amount),
        discount: r2(v.discount),
        discountPct:
          v.amount + v.discount > 0
            ? Math.round((v.discount / (v.amount + v.discount)) * 1000) / 10
            : 0,
      }))
      .filter((r) => r.discount > 0.004)
      .sort((a, b) => b.discount - a.discount);
    return {
      rows,
      totals: {
        qty: sum(rows, 'qty'),
        amount: sum(rows, 'amount'),
        discount: sum(rows, 'discount'),
      },
      meta: { from, to },
    };
  },
});

export const STOCK_REPORTS = [
  stockSummary,
  stockByCategory,
  stockDetail,
  itemDetail,
  lowStock,
  itemByParty,
  itemPnl,
  categoryPnl,
  byCategory,
  itemDiscount,
];
