// Vyapar parity P6-S6 (and the Income Tax group of the index), the remaining reports: Expense, Expense Category, Expense
// Item, Other Income, Discount, Sale Order and Order Item, Purchase Order, Salesman, Cash Watch (§269ST) and the E-way
// Bill Register. They read documents, so they work with the ledger off.
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import { uuid } from '@ledgora/contracts';
import { cashWatch, salesmanPerformance, saleOrderProgress } from '@ledgora/tax-engine';
import { lineDiscount, partyNames, saleDocs, saleLines } from './documents.ts';
import { commonParams, defineReport } from './registry.ts';
import { fyStartOf, r2, today } from './shared.ts';

const {
  expenses,
  expenseCategories,
  invoices,
  invoiceLines,
  payments,
  purchaseOrders,
  staff,
  ewayBills,
} = schema;
const period = (p: { from?: string; to?: string }) => ({
  from: p.from ?? fyStartOf(p.to ?? today()),
  to: p.to ?? today(),
});
const sum = (rows: Record<string, unknown>[], k: string) =>
  r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
const qty3 = (n: number) => Math.round(n * 1000) / 1000;

async function categoryNames(tx: Tx) {
  return new Map(
    (
      await tx
        .select({ id: expenseCategories.id, name: expenseCategories.name })
        .from(expenseCategories)
    ).map((c) => [c.id, c.name]),
  );
}
async function expenseRows(
  tx: Tx,
  businessId: string,
  from: string,
  to: string,
  kind: 'expense' | 'income',
) {
  return tx
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.businessId, businessId),
        isNull(expenses.deletedAt),
        eq(expenses.kind, kind),
        gte(expenses.expenseDate, from),
        lte(expenses.expenseDate, to),
      ),
    )
    .orderBy(asc(expenses.expenseDate), asc(expenses.createdAt));
}

// ---- Expense reports ------------------------------------------------------------------------------------------------------

export const expenseReport = defineReport({
  id: 'expense',
  title: 'Expense Report',
  group: 'expense',
  description: 'Every expense of the period with its category, payee, GST and how it was paid.',
  params: commonParams.extend({ categoryId: uuid.optional() }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const cats = await categoryNames(tx);
    const names = await partyNames(
      tx,
      (await expenseRows(tx, p.businessId, from, to, 'expense')).map((e) => e.payeePartyId),
    );
    const rows = (await expenseRows(tx, p.businessId, from, to, 'expense'))
      .filter((e) => !p.categoryId || e.categoryId === p.categoryId)
      .map((e) => ({
        id: e.id,
        refType: 'expense',
        refId: e.id,
        date: e.expenseDate,
        number: e.number,
        category: e.categoryId ? (cats.get(e.categoryId) ?? '') : 'Uncategorised',
        payee: e.payeePartyId ? (names.get(e.payeePartyId) ?? e.vendor) : e.vendor,
        description: e.description,
        amount: e.amount,
        gst: e.taxAmount,
        total: r2(e.amount + e.taxAmount),
        mode: e.paymentMode,
      }));
    return {
      rows,
      totals: { amount: sum(rows, 'amount'), gst: sum(rows, 'gst'), total: sum(rows, 'total') },
      meta: { from, to },
    };
  },
});

function categoryReport(
  id: string,
  title: string,
  description: string,
  kind: 'expense' | 'income',
) {
  return defineReport({
    id,
    title,
    group: 'expense',
    description,
    params: commonParams,
    run: async (tx, p) => {
      const { from, to } = period(p);
      const cats = await categoryNames(tx);
      const by = new Map<string, number>();
      for (const e of await expenseRows(tx, p.businessId, from, to, kind)) {
        const c = e.categoryId ? (cats.get(e.categoryId) ?? 'Uncategorised') : 'Uncategorised';
        by.set(c, r2((by.get(c) ?? 0) + e.amount + e.taxAmount));
      }
      const total = r2([...by.values()].reduce((s, v) => s + v, 0));
      const rows = [...by.entries()]
        .map(([category, amount]) => ({
          id: category,
          category,
          total: amount,
          share: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.total - a.total);
      return { rows, totals: { total }, meta: { from, to } };
    },
  });
}
export const expenseCategoryReport = categoryReport(
  'expense-category',
  'Expense Category Report',
  'Spending by category with each category’s share of the total.',
  'expense',
);
export const otherIncomeReport = categoryReport(
  'other-income',
  'Other Income',
  'Income other than sales, by category.',
  'income',
);

export const expenseItemReport = defineReport({
  id: 'expense-item',
  title: 'Expense Item Report',
  group: 'expense',
  description:
    'Quantity and amount of each expense item (rent, electricity, …); an expense saved without items is listed under its description.',
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = period(p);
    const by = new Map<string, { qty: number; amount: number }>();
    for (const e of await expenseRows(tx, p.businessId, from, to, 'expense')) {
      const lines =
        (
          (e.data ?? {}) as {
            items?: { name: string; quantity: number; rate: number; gstRate: number }[];
          }
        ).items ?? [];
      const list = lines.length
        ? lines.map((l) => ({ name: l.name, qty: l.quantity, amount: l.quantity * l.rate }))
        : [{ name: e.description || 'Not itemised', qty: 1, amount: e.amount }];
      for (const l of list) {
        const v = by.get(l.name) ?? { qty: 0, amount: 0 };
        by.set(l.name, { qty: qty3(v.qty + l.qty), amount: r2(v.amount + l.amount) });
      }
    }
    const rows = [...by.entries()]
      .map(([item, x]) => ({ id: item, item, ...x }))
      .sort((a, b) => b.amount - a.amount);
    return {
      rows,
      totals: { qty: sum(rows, 'qty'), amount: sum(rows, 'amount') },
      meta: { from, to },
    };
  },
});

// ---- Discount -------------------------------------------------------------------------------------------------------------

export const discountReport = defineReport({
  id: 'discount',
  title: 'Discount Report',
  group: 'cashbank',
  description:
    'Per party: discount given on sales lines, and the discount given and received on payments. Purchase lines carry no discount field, so none is shown for them.',
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = period(p);
    const by = new Map<string, { sale: number; given: number; received: number }>();
    const slot = (k: string) => by.get(k) ?? { sale: 0, given: 0, received: 0 };
    const docs = (await saleDocs(tx, p.businessId, from, to, { creditNotes: false })).filter(
      (d) => d.status !== 'cancelled',
    );
    const who = new Map(docs.map((d) => [d.id, d.partyId ?? 'none']));
    for (const l of await saleLines(
      tx,
      docs.map((d) => d.id),
    )) {
      const k = who.get(l.invoiceId) ?? 'none';
      by.set(k, { ...slot(k), sale: r2(slot(k).sale + lineDiscount(l)) });
    }
    for (const pay of await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.businessId, p.businessId),
          isNull(payments.deletedAt),
          gte(payments.paymentDate, from),
          lte(payments.paymentDate, to),
          sql`${payments.discountAmount} > 0`,
        ),
      )) {
      const cur = slot(pay.partyId);
      by.set(
        pay.partyId,
        pay.direction === 'out'
          ? { ...cur, received: r2(cur.received + pay.discountAmount) }
          : { ...cur, given: r2(cur.given + pay.discountAmount) },
      );
    }
    const names = await partyNames(tx, [...by.keys()]);
    const rows = [...by.entries()]
      .map(([k, v]) => ({
        id: k,
        party: names.get(k) ?? 'No party',
        saleDiscount: v.sale,
        paymentDiscountGiven: v.given,
        paymentDiscountReceived: v.received,
      }))
      .filter(
        (r) => r.saleDiscount > 0 || r.paymentDiscountGiven > 0 || r.paymentDiscountReceived > 0,
      )
      .sort((a, b) => a.party.localeCompare(b.party));
    return {
      rows,
      totals: {
        saleDiscount: sum(rows, 'saleDiscount'),
        paymentDiscountGiven: sum(rows, 'paymentDiscountGiven'),
        paymentDiscountReceived: sum(rows, 'paymentDiscountReceived'),
      },
      meta: { from, to },
    };
  },
});

// ---- Sale orders and purchase orders ---------------------------------------------------------------------------------------

/** Each sale order of the period with its lines and how far invoices have taken it (the rule of P2-S6). */
async function saleOrders(tx: Tx, businessId: string, from: string, to: string) {
  const orders = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        isNull(invoices.deletedAt),
        eq(invoices.invoiceType, 'sales-order'),
        gte(invoices.invoiceDate, from),
        lte(invoices.invoiceDate, to),
      ),
    )
    .orderBy(asc(invoices.invoiceDate), asc(invoices.createdAt));
  if (!orders.length) return [];
  const lines = await tx
    .select()
    .from(invoiceLines)
    .where(
      and(
        inArray(
          invoiceLines.invoiceId,
          orders.map((o) => o.id),
        ),
        isNull(invoiceLines.deletedAt),
      ),
    );
  const made = await tx
    .select()
    .from(invoices)
    .where(
      and(
        isNull(invoices.deletedAt),
        inArray(
          sql<string>`${invoices.data}->>'sourceOrderId'`,
          orders.map((o) => o.id),
        ),
      ),
    );
  const madeLines = made.length
    ? await tx
        .select()
        .from(invoiceLines)
        .where(
          and(
            inArray(
              invoiceLines.invoiceId,
              made.map((m) => m.id),
            ),
            isNull(invoiceLines.deletedAt),
          ),
        )
    : [];
  return orders.map((o) => {
    const mine = lines.filter((l) => l.invoiceId === o.id);
    const docs = made
      .filter((m) => ((m.data ?? {}) as { sourceOrderId?: string }).sourceOrderId === o.id)
      .map((m) => ({
        status: m.status,
        lines: madeLines
          .filter((l) => l.invoiceId === m.id)
          .map((l) => ({ itemId: l.itemId, name: l.name, quantity: l.quantity })),
      }));
    const progress = saleOrderProgress(
      mine.map((l) => ({ itemId: l.itemId, name: l.name, quantity: l.quantity })),
      docs,
      o.status === 'cancelled',
    );
    return { order: o, lines: mine, progress };
  });
}

export const saleOrderReport = defineReport({
  id: 'sale-order',
  title: 'Sale Order Report',
  group: 'orders',
  description:
    'Sale orders of the period with their value, the advance received and whether invoices have fulfilled them.',
  params: commonParams.extend({
    status: z.enum(['', 'open', 'partially-invoiced', 'closed', 'cancelled']).default(''),
  }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const list = (await saleOrders(tx, p.businessId, from, to)).filter(
      (x) => !p.status || x.progress.status === p.status,
    );
    const names = await partyNames(
      tx,
      list.map((x) => x.order.partyId),
    );
    const rows = list.map(({ order: o, progress }) => ({
      id: o.id,
      refType: 'invoice',
      refId: o.id,
      number: o.number,
      party: o.partyId ? (names.get(o.partyId) ?? '') : '',
      date: o.invoiceDate,
      due: o.dueDate ?? '',
      status: progress.status,
      total: o.total,
      advance: o.paidAmount,
    }));
    return {
      rows,
      totals: { total: sum(rows, 'total'), advance: sum(rows, 'advance'), count: rows.length },
      meta: { from, to },
    };
  },
});

export const saleOrderItem = defineReport({
  id: 'sale-order-item',
  title: 'Sale Order Item Report',
  group: 'orders',
  description:
    'For each item on sale orders: how much was ordered, invoiced and is still pending, and the ordered value.',
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = period(p);
    const by = new Map<
      string,
      { item: string; ordered: number; invoiced: number; pending: number; amount: number }
    >();
    for (const { order, lines, progress } of await saleOrders(tx, p.businessId, from, to)) {
      if (order.status === 'cancelled') continue;
      lines.forEach((l, i) => {
        const pr = progress.lines[i];
        const k = l.itemId ?? l.name;
        const v = by.get(k) ?? { item: l.name, ordered: 0, invoiced: 0, pending: 0, amount: 0 };
        by.set(k, {
          item: v.item,
          ordered: qty3(v.ordered + l.quantity),
          invoiced: qty3(v.invoiced + (pr?.invoiced ?? 0)),
          pending: qty3(v.pending + (pr?.pending ?? 0)),
          amount: r2(v.amount + l.taxableAmount),
        });
      });
    }
    const rows = [...by.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.pending - a.pending);
    return {
      rows,
      totals: {
        ordered: sum(rows, 'ordered'),
        invoiced: sum(rows, 'invoiced'),
        pending: sum(rows, 'pending'),
        amount: sum(rows, 'amount'),
      },
      meta: { from, to },
    };
  },
});

export const purchaseOrderReport = defineReport({
  id: 'purchase-order',
  title: 'Purchase Order Report',
  group: 'orders',
  description: 'Purchase orders of the period with the supplier, expected date, status and value.',
  params: commonParams.extend({
    status: z.enum(['', 'open', 'partial', 'received', 'cancelled']).default(''),
  }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const rows = (
      await tx
        .select()
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.businessId, p.businessId),
            isNull(purchaseOrders.deletedAt),
            gte(purchaseOrders.orderDate, from),
            lte(purchaseOrders.orderDate, to),
            p.status ? eq(purchaseOrders.status, p.status) : undefined,
          ),
        )
        .orderBy(asc(purchaseOrders.orderDate))
    ).map((o) => ({
      id: o.id,
      number: o.number,
      supplier: o.supplierName,
      date: o.orderDate,
      expected: o.expectedDate ?? '',
      status: o.status,
      taxable: o.taxableAmount,
      total: o.total,
    }));
    return {
      rows,
      totals: { taxable: sum(rows, 'taxable'), total: sum(rows, 'total'), count: rows.length },
      meta: { from, to },
    };
  },
});

// ---- Salesman -------------------------------------------------------------------------------------------------------------

export const salesmanReport = defineReport({
  id: 'salesman',
  title: 'Salesman Report',
  group: 'orders',
  description:
    'For each salesman: sales, collections, what is outstanding on their invoices, commission and progress against the monthly target.',
  params: commonParams.extend({ basis: z.enum(['sale', 'collection']).default('sale') }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const people = await tx
      .select()
      .from(staff)
      .where(isNull(staff.deletedAt))
      .orderBy(asc(staff.name));
    const docs = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, p.businessId),
          isNull(invoices.deletedAt),
          gte(invoices.invoiceDate, from),
          lte(invoices.invoiceDate, to),
          sql`${invoices.salesmanId} is not null`,
        ),
      );
    const rows = people.map((s) => {
      const perf = salesmanPerformance(
        docs.filter((d) => d.salesmanId === s.id),
        { pct: s.commissionPct, basis: p.basis, monthlyTarget: s.monthlyTarget },
      );
      return {
        id: s.id,
        salesman: s.name,
        sales: perf.netSales,
        collected: perf.collected,
        outstanding: perf.outstanding,
        commission: perf.commission,
        targetPct: perf.targetPct,
      };
    });
    return {
      rows,
      totals: {
        sales: sum(rows, 'sales'),
        collected: sum(rows, 'collected'),
        outstanding: sum(rows, 'outstanding'),
        commission: sum(rows, 'commission'),
      },
      meta: { from, to, basis: p.basis },
    };
  },
});

// ---- Cash Watch (§269ST) ---------------------------------------------------------------------------------------------------

export const cashWatchReport = defineReport({
  id: 'cash-watch',
  title: 'Cash Watch (§269ST)',
  group: 'incometax',
  description:
    'Days on which one party paid you ₹2,00,000 or more in cash. Section 269ST bars receiving that much in cash from one person in a day.',
  params: commonParams.extend({ limit: z.coerce.number().positive().default(200000) }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const receipts = await tx
      .select({
        partyId: payments.partyId,
        date: payments.paymentDate,
        amount: payments.amount,
        mode: payments.mode,
        direction: payments.direction,
      })
      .from(payments)
      .where(
        and(
          eq(payments.businessId, p.businessId),
          isNull(payments.deletedAt),
          eq(payments.mode, 'cash'),
          eq(payments.direction, 'in'),
          gte(payments.paymentDate, from),
          lte(payments.paymentDate, to),
        ),
      );
    const hits = cashWatch(receipts, p.limit);
    const names = await partyNames(
      tx,
      hits.map((h) => h.partyId),
    );
    const rows = hits.map((h) => ({
      id: `${h.partyId}|${h.date}`,
      party: names.get(h.partyId) ?? '',
      date: h.date,
      total: h.total,
      over: r2(h.total - p.limit),
    }));
    return {
      rows,
      totals: { total: sum(rows, 'total'), count: rows.length },
      meta: { from, to, limit: p.limit },
    };
  },
});

// ---- E-way Bill Register -------------------------------------------------------------------------------------------------

/** Goods worth more than this need an e-way bill to move (a consignment value of ₹50,000, tax included). */
export const EWAY_LIMIT = 50000;

export const ewayRegister = defineReport({
  id: 'eway-register',
  title: 'E-way Bill Register',
  group: 'gst',
  description:
    'Sales invoices of ₹50,000 or more with goods on them, with the e-way bill number, vehicle and status you recorded; “pending” means none is recorded yet.',
  params: commonParams.extend({
    status: z.enum(['', 'pending', 'generated', 'cancelled']).default(''),
  }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const docs = (await saleDocs(tx, p.businessId, from, to, { creditNotes: false })).filter(
      (d) => d.status !== 'cancelled' && d.total >= EWAY_LIMIT,
    );
    if (!docs.length)
      return { rows: [], totals: { value: 0, pending: 0 }, meta: { from, to, limit: EWAY_LIMIT } };
    const lines = await saleLines(
      tx,
      docs.map((d) => d.id),
    );
    const goods = new Set(lines.filter((l) => !/^99/.test(l.hsn)).map((l) => l.invoiceId));
    const bills = new Map(
      (
        await tx
          .select()
          .from(ewayBills)
          .where(
            and(
              inArray(
                ewayBills.invoiceId,
                docs.map((d) => d.id),
              ),
              isNull(ewayBills.deletedAt),
            ),
          )
      ).map((b) => [b.invoiceId, b]),
    );
    const names = await partyNames(
      tx,
      docs.map((d) => d.partyId),
    );
    const rows = docs
      .filter((d) => goods.has(d.id))
      .map((d) => {
        const b = bills.get(d.id);
        return {
          id: d.id,
          refType: 'invoice',
          refId: d.id,
          number: d.number,
          date: d.invoiceDate,
          party: d.partyId ? (names.get(d.partyId) ?? '') : '',
          value: d.total,
          ewayNo: b?.ewayNo ?? '',
          vehicle: b?.vehicleNo ?? '',
          status: b?.status ?? 'pending',
          validUntil: b?.validUntil ?? '',
          jsonExportedOn: b?.jsonExportedOn ?? '',
        };
      })
      .filter((r) => !p.status || r.status === p.status);
    return {
      rows,
      totals: {
        value: sum(rows, 'value'),
        pending: rows.filter((r) => r.status === 'pending').length,
      },
      meta: { from, to, limit: EWAY_LIMIT },
    };
  },
});

export const MISC_REPORTS = [
  expenseReport,
  expenseCategoryReport,
  expenseItemReport,
  otherIncomeReport,
  discountReport,
  saleOrderReport,
  saleOrderItem,
  purchaseOrderReport,
  salesmanReport,
  cashWatchReport,
  ewayRegister,
];
