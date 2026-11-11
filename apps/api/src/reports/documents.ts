// Vyapar parity Phase 6, document reports (P6-S2, P6-S3): Sale, Purchase, All Transactions, Bill Wise Profit and the
// Receivable Ageing. They read the documents, so they work with the ledger off. Totals are worked out here over the whole
// period, never over a page.
import { and, asc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import { uuid } from '@ledgora/contracts';
import { SALE_TYPES, ageing, weightedAverageCost, type StockMove } from '@ledgora/tax-engine';
import { dueOf } from '../modules/saleRules.ts';
import { itcInputs } from '../modules/itcRules.ts';
import { commonParams, defineReport } from './registry.ts';
import { fyStartOf, liveEntries, paidAsOf, r2, stockMoves, today } from './shared.ts';

const { invoices, invoiceLines, purchases, payments, expenses, transfers, parties, staff } = schema;

const flag = z.enum(['0', '1']).default('0');
const period = (p: { from?: string; to?: string }) => ({
  from: p.from ?? fyStartOf(p.to ?? today()),
  to: p.to ?? today(),
});
const sum = (rows: Record<string, unknown>[], k: string) =>
  r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));

/** Party names by id, for the ids given. */
export async function partyNames(tx: Tx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  return new Map(
    (
      await tx
        .select({ id: parties.id, name: parties.name })
        .from(parties)
        .where(inArray(parties.id, list))
    ).map((p) => [p.id, p.name]),
  );
}

/** Sale documents of a period (credit notes included, their amounts negative). Cancelled ones only when asked. */
export async function saleDocs(
  tx: Tx,
  businessId: string,
  from: string,
  to: string,
  o: { partyId?: string; includeCancelled?: boolean; creditNotes?: boolean } = {},
) {
  const types = [...SALE_TYPES, ...(o.creditNotes === false ? [] : ['credit-note'])];
  return tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        isNull(invoices.deletedAt),
        inArray(invoices.invoiceType, types),
        gte(invoices.invoiceDate, from),
        lte(invoices.invoiceDate, to),
        o.partyId ? eq(invoices.partyId, o.partyId) : undefined,
        o.includeCancelled ? undefined : ne(invoices.status, 'cancelled'),
      ),
    )
    .orderBy(asc(invoices.invoiceDate), asc(invoices.createdAt));
}

/** +1 for a sale, −1 for a credit note: a return takes away from the period's sale. */
export const saleSign = (invoiceType: string) => (invoiceType === 'credit-note' ? -1 : 1);

const totalsOf = (data: unknown) =>
  ((data ?? {}) as { totals?: { chargesTotal?: number; tcsAmount?: number } }).totals ?? {};

// ---- Sale ---------------------------------------------------------------------------------------------------------------

export const saleReport = defineReport({
  id: 'sale',
  title: 'Sale Report',
  group: 'transaction',
  description:
    'Sales invoices of the period with what was received and what is pending; credit notes are taken off. Cancelled documents only on request.',
  params: commonParams.extend({
    partyId: uuid.optional(),
    includeCancelled: flag,
    creditNotes: z.enum(['0', '1']).default('1'),
  }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const docs = await saleDocs(tx, p.businessId, from, to, {
      partyId: p.partyId,
      includeCancelled: p.includeCancelled === '1',
      creditNotes: p.creditNotes === '1',
    });
    const names = await partyNames(
      tx,
      docs.map((d) => d.partyId),
    );
    const people = new Map(
      (await tx.select({ id: staff.id, name: staff.name }).from(staff)).map((s) => [s.id, s.name]),
    );
    const rows = docs.map((d) => {
      const sign = saleSign(d.invoiceType);
      const dead = d.status === 'cancelled';
      const total = dead ? 0 : sign * d.total;
      return {
        id: d.id,
        refType: 'invoice',
        refId: d.id,
        date: d.invoiceDate,
        number: d.number,
        party: d.partyId ? (names.get(d.partyId) ?? '') : '',
        type: d.invoiceType,
        paymentType: dead
          ? 'Cancelled'
          : d.invoiceType === 'credit-note'
            ? 'Credit note'
            : d.paidAmount >= d.total - 0.005
              ? 'Paid'
              : d.paidAmount > 0
                ? 'Partial'
                : 'Credit',
        total,
        received: dead || sign < 0 ? 0 : d.paidAmount,
        balance: dead || sign < 0 ? 0 : r2(dueOf(d) - d.paidAmount),
        taxable: dead ? 0 : sign * d.taxableAmount,
        tax: dead ? 0 : sign * d.totalTax,
        salesman: d.salesmanId ? (people.get(d.salesmanId) ?? '') : '',
      };
    });
    return {
      rows,
      totals: {
        total: sum(rows, 'total'),
        received: sum(rows, 'received'),
        balance: sum(rows, 'balance'),
        taxable: sum(rows, 'taxable'),
        tax: sum(rows, 'tax'),
        count: rows.length,
      },
      meta: { from, to },
    };
  },
});

// ---- Purchase -----------------------------------------------------------------------------------------------------------

export const purchaseReport = defineReport({
  id: 'purchase',
  title: 'Purchase Report',
  group: 'transaction',
  description:
    'Purchase bills of the period with what was paid, what is pending and the input credit; debit notes are taken off.',
  params: commonParams.extend({
    partyId: uuid.optional(),
    debitNotes: z.enum(['0', '1']).default('1'),
  }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const docs = await tx
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.businessId, p.businessId),
          isNull(purchases.deletedAt),
          inArray(purchases.docType, p.debitNotes === '1' ? ['bill', 'debit-note'] : ['bill']),
          gte(purchases.purchaseDate, from),
          lte(purchases.purchaseDate, to),
          p.partyId ? eq(purchases.supplierId, p.partyId) : undefined,
        ),
      )
      .orderBy(asc(purchases.purchaseDate), asc(purchases.createdAt));
    const itc = new Map((await itcInputs(tx, p.businessId)).bills.map((b) => [b.id, b.itc]));
    const rows = docs.map((d) => {
      const sign = d.docType === 'debit-note' ? -1 : 1;
      const tax = r2(d.cgst + d.sgst + d.igst + d.cess);
      return {
        id: d.id,
        refType: 'purchase',
        refId: d.id,
        date: d.purchaseDate,
        number: d.invoiceNumber || d.number,
        party: d.supplierName,
        type: d.docType,
        total: sign * d.total,
        paid: sign < 0 ? 0 : d.paidAmount,
        balance: sign < 0 ? 0 : r2(Math.max(0, d.total - d.tdsAmount - d.paidAmount)),
        taxable: sign * d.taxableAmount,
        tax: sign * tax,
        itcEligible: sign * (Number(itc.get(d.id)) || (sign > 0 ? tax : 0)),
        itcClaimed: sign * (Number(itc.get(d.id)) || 0),
      };
    });
    return {
      rows,
      totals: {
        total: sum(rows, 'total'),
        paid: sum(rows, 'paid'),
        balance: sum(rows, 'balance'),
        taxable: sum(rows, 'taxable'),
        tax: sum(rows, 'tax'),
        itcClaimed: sum(rows, 'itcClaimed'),
        count: rows.length,
      },
      meta: { from, to },
    };
  },
});

// ---- All Transactions ---------------------------------------------------------------------------------------------------

const TXN_TYPES = [
  'sale',
  'purchase',
  'payment-in',
  'payment-out',
  'expense',
  'income',
  'transfer',
  'journal',
] as const;

export const allTransactions = defineReport({
  id: 'all-transactions',
  title: 'All Transactions',
  group: 'transaction',
  description:
    'Sales, purchases, payments in and out, expenses, other income, transfers and journals of the period in one list.',
  params: commonParams.extend({
    types: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').filter(Boolean) : [])),
    partyId: uuid.optional(),
  }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const want = (t: (typeof TXN_TYPES)[number]) => !p.types.length || p.types.includes(t);
    const rows: {
      id: string;
      refType: string;
      refId: string;
      date: string;
      number: string;
      party: string;
      type: string;
      paymentType: string;
      total: number;
      balance: number;
    }[] = [];
    if (want('sale'))
      for (const d of await saleDocs(tx, p.businessId, from, to, { partyId: p.partyId }))
        rows.push({
          id: d.id,
          refType: 'invoice',
          refId: d.id,
          date: d.invoiceDate,
          number: d.number,
          party: d.partyId ?? '',
          type: d.invoiceType === 'credit-note' ? 'Credit note' : 'Sale',
          paymentType: d.paidAmount >= d.total - 0.005 ? 'Paid' : 'Credit',
          total: saleSign(d.invoiceType) * d.total,
          balance: d.invoiceType === 'credit-note' ? 0 : r2(dueOf(d) - d.paidAmount),
        });
    if (want('purchase'))
      for (const d of await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.businessId, p.businessId),
            isNull(purchases.deletedAt),
            inArray(purchases.docType, ['bill', 'debit-note']),
            gte(purchases.purchaseDate, from),
            lte(purchases.purchaseDate, to),
            p.partyId ? eq(purchases.supplierId, p.partyId) : undefined,
          ),
        ))
        rows.push({
          id: d.id,
          refType: 'purchase',
          refId: d.id,
          date: d.purchaseDate,
          number: d.invoiceNumber || d.number,
          party: d.supplierId ?? d.supplierName,
          type: d.docType === 'debit-note' ? 'Debit note' : 'Purchase',
          paymentType: d.paidAmount >= d.total - d.tdsAmount - 0.005 ? 'Paid' : 'Credit',
          total: (d.docType === 'debit-note' ? -1 : 1) * d.total,
          balance:
            d.docType === 'debit-note' ? 0 : r2(Math.max(0, d.total - d.tdsAmount - d.paidAmount)),
        });
    if (want('payment-in') || want('payment-out'))
      for (const d of await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.businessId, p.businessId),
            isNull(payments.deletedAt),
            inArray(payments.source, ['receipt', 'payment']),
            gte(payments.paymentDate, from),
            lte(payments.paymentDate, to),
            p.partyId ? eq(payments.partyId, p.partyId) : undefined,
          ),
        )) {
        const out = d.direction === 'out';
        if (!want(out ? 'payment-out' : 'payment-in')) continue;
        rows.push({
          id: d.id,
          refType: 'payment',
          refId: d.id,
          date: d.paymentDate,
          number: d.number,
          party: d.partyId,
          type: out ? 'Payment out' : 'Payment in',
          paymentType: d.mode,
          total: d.amount,
          balance: 0,
        });
      }
    if (want('expense') || want('income'))
      for (const d of await tx
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.businessId, p.businessId),
            isNull(expenses.deletedAt),
            gte(expenses.expenseDate, from),
            lte(expenses.expenseDate, to),
          ),
        )) {
        const t = d.kind === 'income' ? 'income' : 'expense';
        if (!want(t) || (p.partyId && d.payeePartyId !== p.partyId)) continue;
        rows.push({
          id: d.id,
          refType: 'expense',
          refId: d.id,
          date: d.expenseDate,
          number: d.number,
          party: d.payeePartyId ?? d.vendor,
          type: t === 'income' ? 'Other income' : 'Expense',
          paymentType: d.paymentMode,
          total: r2(d.amount + d.taxAmount),
          balance: 0,
        });
      }
    if (want('transfer') && !p.partyId)
      for (const d of await tx
        .select()
        .from(transfers)
        .where(
          and(
            eq(transfers.businessId, p.businessId),
            isNull(transfers.deletedAt),
            gte(transfers.date, from),
            lte(transfers.date, to),
          ),
        ))
        rows.push({
          id: d.id,
          refType: 'transfer',
          refId: d.id,
          date: d.date,
          number: d.reference,
          party: '',
          type: 'Transfer',
          paymentType: '',
          total: d.amount,
          balance: 0,
        });
    if (want('journal') && !p.partyId) {
      const seen = new Map<string, { date: string; total: number; note: string }>();
      for (const { e } of await liveEntries(tx, p.businessId, from, to))
        if (e.refType === 'journal') {
          const v = seen.get(e.refId) ?? { date: e.txnDate, total: 0, note: e.narration };
          v.total = r2(v.total + e.debit);
          seen.set(e.refId, v);
        }
      for (const [id, v] of seen)
        rows.push({
          id,
          refType: 'journal',
          refId: id,
          date: v.date,
          number: /^(JV-\d+)/.exec(v.note)?.[1] ?? '',
          party: '',
          type: 'Journal',
          paymentType: '',
          total: v.total,
          balance: 0,
        });
    }
    // Party ids become names (suppliers and vendors that are free text stay as they are).
    const names = await partyNames(
      tx,
      rows.map((r) => r.party),
    );
    const out = rows
      .map((r) => ({
        ...r,
        party: names.get(r.party) ?? (/^[0-9a-f-]{36}$/.test(r.party) ? '' : r.party),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    return {
      rows: out,
      totals: { total: sum(out, 'total'), balance: sum(out, 'balance'), count: out.length },
      meta: { from, to, types: [...TXN_TYPES] },
    };
  },
});

// ---- costing and Bill Wise Profit ---------------------------------------------------------------------------------------

/**
 * What a sale line cost, by the rule of the guide: the item's weighted-average purchase cost as of the invoice date
 * (`weightedAverageCost` over its movements), else the item's purchase price when it has no purchase history; a service
 * or an untracked item costs nothing. One function for Bill Wise Profit, Party-wise P&L and Item-wise P&L, so the three
 * always add up to the same profit.
 */
export async function costing(tx: Tx) {
  const { moves, prices } = await stockMoves(tx);
  const byItem = new Map<string, StockMove[]>(moves.map((m) => [m.id, m.moves]));
  const cache = new Map<string, number>();
  return (itemId: string | null | undefined, date: string) => {
    if (!itemId || !prices.has(itemId)) return 0;
    const k = `${itemId}|${date}`;
    let v = cache.get(k);
    if (v === undefined) {
      const w = weightedAverageCost(byItem.get(itemId) ?? [], date);
      v = w.avg > 0 ? w.avg : (prices.get(itemId) ?? 0);
      cache.set(k, v);
    }
    return v;
  };
}

/** What one sale line cost, to the paisa. */
export const lineCost = (
  l: { itemId: string | null; quantity: number },
  cost: (itemId: string | null | undefined, date: string) => number,
  date: string,
) => r2(l.quantity * cost(l.itemId, date));

/** Sale lines of some invoices with their invoice. */
export async function saleLines(tx: Tx, invoiceIds: string[]) {
  if (!invoiceIds.length) return [];
  return tx
    .select()
    .from(invoiceLines)
    .where(and(inArray(invoiceLines.invoiceId, invoiceIds), isNull(invoiceLines.deletedAt)))
    .orderBy(asc(invoiceLines.position));
}

/** Discount given on a line: what the quantity at the rate comes to less what was charged (before tax). */
export const lineDiscount = (l: { quantity: number; rate: number; taxableAmount: number }) =>
  Math.max(0, r2(l.quantity * l.rate - l.taxableAmount));

/** One row per sale invoice with its cost, shared by Bill Wise Profit and the profit reports built on it. */
export async function billProfit(
  tx: Tx,
  businessId: string,
  from: string,
  to: string,
  o: { includeCharges?: boolean; partyId?: string } = {},
) {
  const docs = (
    await saleDocs(tx, businessId, from, to, { partyId: o.partyId, creditNotes: false })
  ).filter((d) => d.status !== 'cancelled');
  const lines = await saleLines(
    tx,
    docs.map((d) => d.id),
  );
  const cost = await costing(tx);
  return docs.map((d) => {
    const mine = lines.filter((l) => l.invoiceId === d.id);
    // Each line's cost is rounded to the paisa on its own; the invoice, item and party figures all add those, so they agree.
    const costTotal = r2(mine.reduce((s, l) => s + lineCost(l, cost, d.invoiceDate), 0));
    const charges = r2(Number(totalsOf(d.data).chargesTotal) || 0);
    const discount = r2(mine.reduce((s, l) => s + lineDiscount(l), 0));
    // The value of the goods and services on the lines; charges are shown apart, so item profit adds up to this.
    const sale = mine.length ? r2(mine.reduce((t, l) => t + l.taxableAmount, 0)) : d.taxableAmount;
    const profit = r2(sale - costTotal + (o.includeCharges ? charges : 0));
    return { d, sale, cost: costTotal, charges, discount, profit, lines: mine };
  });
}

export const billWiseProfit = defineReport({
  id: 'bill-wise-profit',
  title: 'Bill Wise Profit',
  group: 'transaction',
  description:
    'Profit on each sales invoice: its value before GST less what the goods cost (weighted average as of the invoice date). Services cost nothing.',
  profit: true,
  params: commonParams.extend({ partyId: uuid.optional(), includeCharges: flag }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const list = await billProfit(tx, p.businessId, from, to, {
      includeCharges: p.includeCharges === '1',
      partyId: p.partyId,
    });
    const names = await partyNames(
      tx,
      list.map((x) => x.d.partyId),
    );
    const rows = list.map((x) => ({
      id: x.d.id,
      refType: 'invoice',
      refId: x.d.id,
      date: x.d.invoiceDate,
      number: x.d.number,
      party: x.d.partyId ? (names.get(x.d.partyId) ?? '') : '',
      sale: x.sale,
      cost: x.cost,
      charges: x.charges,
      discount: x.discount,
      profit: x.profit,
      profitPct: x.sale > 0 ? Math.round((x.profit / x.sale) * 1000) / 10 : 0,
    }));
    const sale = sum(rows, 'sale');
    const profit = sum(rows, 'profit');
    return {
      rows,
      totals: {
        sale,
        cost: sum(rows, 'cost'),
        charges: sum(rows, 'charges'),
        discount: sum(rows, 'discount'),
        profit,
        profitPct: sale > 0 ? Math.round((profit / sale) * 1000) / 10 : 0,
      },
      meta: { from, to },
    };
  },
});

// ---- Receivable Ageing --------------------------------------------------------------------------------------------------

export const receivableAgeing = defineReport({
  id: 'ageing',
  title: 'Receivable Ageing',
  group: 'party',
  description:
    'What each customer owed you on the date, split by the age of the invoices, counting only money received by then.',
  params: commonParams,
  run: async (tx, p) => {
    const asOf = p.to ?? today();
    const docs = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, p.businessId),
          isNull(invoices.deletedAt),
          inArray(invoices.invoiceType, [...SALE_TYPES]),
          ne(invoices.status, 'cancelled'),
          lte(invoices.invoiceDate, asOf),
        ),
      );
    const paid = await paidAsOf(
      tx,
      'invoice',
      docs.map((d) => d.id),
      asOf,
    );
    const names = await partyNames(
      tx,
      docs.map((d) => d.partyId),
    );
    const rows = ageing(
      docs.map((d) => ({
        partyId: d.partyId ?? 'none',
        partyName: d.partyId ? (names.get(d.partyId) ?? '') : 'No party',
        date: d.invoiceDate,
        due: r2(dueOf(d) - (paid.get(d.id) ?? 0)),
      })),
      asOf,
    ).map((r) => ({ id: r.partyId, ...r }));
    const t = (k: '0-30' | '31-60' | '61-90' | '90+' | 'total') =>
      r2(rows.reduce((s, r) => s + r[k], 0));
    return {
      rows,
      totals: {
        '0-30': t('0-30'),
        '31-60': t('31-60'),
        '61-90': t('61-90'),
        '90+': t('90+'),
        total: t('total'),
      },
      meta: { asOf },
    };
  },
});

export const DOCUMENT_REPORTS = [
  saleReport,
  purchaseReport,
  allTransactions,
  billWiseProfit,
  receivableAgeing,
];
