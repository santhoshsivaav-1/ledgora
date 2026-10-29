import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  expense,
  expenseCategory,
  expenseCategoryInput,
  expenseInput,
  idParam,
  okBody,
  page,
  pageQuery,
  purchase,
  purchaseInput,
  type Purchase,
  type PurchaseInput,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';

const { purchases, purchaseLines, expenses, expenseCategories, items, stockMovements } = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;

function figures(input: PurchaseInput) {
  const lines = input.items.map((l) => {
    const taxable = r2(l.quantity * l.rate);
    const tax = r2((taxable * l.taxPercent) / 100);
    const cess = r2((taxable * l.cessPercent) / 100);
    return {
      ...l,
      taxableAmount: taxable,
      taxAmount: r2(tax + cess),
      lineTotal: r2(taxable + tax + cess),
      tax,
      cess,
    };
  });
  const sum = (f: (l: (typeof lines)[number]) => number) => r2(lines.reduce((s, l) => s + f(l), 0));
  const tax = sum((l) => l.tax);
  return {
    lines,
    taxableAmount: sum((l) => l.taxableAmount),
    cgst: input.interstate ? 0 : r2(tax / 2),
    sgst: input.interstate ? 0 : r2(tax - r2(tax / 2)),
    igst: input.interstate ? tax : 0,
    cess: sum((l) => l.cess),
    total: sum((l) => l.lineTotal),
  };
}

async function linesOf(tx: Tx, id: string) {
  return tx
    .select()
    .from(purchaseLines)
    .where(and(eq(purchaseLines.purchaseId, id), isNull(purchaseLines.deletedAt)))
    .orderBy(purchaseLines.createdAt);
}

function toPurchase(
  r: typeof purchases.$inferSelect,
  lines: (typeof purchaseLines.$inferSelect)[],
): Purchase {
  return {
    id: r.id,
    businessId: r.businessId,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    supplierGstin: r.supplierGstin,
    supplierAddress: r.supplierAddress,
    invoiceNumber: r.invoiceNumber,
    purchaseDate: r.purchaseDate,
    interstate: r.interstate,
    paymentStatus: r.paymentStatus,
    taxableAmount: r.taxableAmount,
    cgst: r.cgst,
    sgst: r.sgst,
    igst: r.igst,
    cess: r.cess,
    total: r.total,
    items: lines.map((l) => ({
      itemId: l.itemId,
      name: l.name,
      hsn: l.hsn,
      quantity: l.quantity,
      rate: l.rate,
      taxPercent: l.taxPercent,
      cessPercent: l.cessPercent,
      taxableAmount: l.taxableAmount,
      taxAmount: l.taxAmount,
      lineTotal: l.lineTotal,
    })),
    ...stamps(r),
  };
}

export function purchasesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/purchases',
    tag: 'Purchases',
    summary: 'List purchase bills',
    query: pageQuery,
    response: page(purchase),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, purchases, {
        ...query,
        searchColumns: [purchases.supplierName, purchases.invoiceNumber],
      });
      const out: Purchase[] = [];
      for (const r of res.data) out.push(toPurchase(r, await linesOf(tx, r.id)));
      return { data: out, nextCursor: res.nextCursor };
    },
  });

  route({
    method: 'get',
    path: '/v1/purchases/:id',
    tag: 'Purchases',
    summary: 'One purchase bill',
    params: idParam,
    response: purchase,
    handler: async ({ tx, params }) => {
      const [r] = await tx
        .select()
        .from(purchases)
        .where(and(eq(purchases.id, params.id), isNull(purchases.deletedAt)));
      if (!r) throw notFound('Purchase');
      return toPurchase(r, await linesOf(tx, r.id));
    },
  });

  route({
    method: 'post',
    path: '/v1/purchases',
    tag: 'Purchases',
    summary: 'Record a purchase bill; stock goes up for tracked items',
    body: purchaseInput,
    response: purchase,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const f = figures(body);
      const { items: _items, ...cols } = body;
      const [row] = await tx
        .insert(purchases)
        .values({
          ...cols,
          orgId,
          taxableAmount: f.taxableAmount,
          cgst: f.cgst,
          sgst: f.sgst,
          igst: f.igst,
          cess: f.cess,
          total: f.total,
        })
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
            taxableAmount: l.taxableAmount,
            taxAmount: l.taxAmount,
            lineTotal: l.lineTotal,
          })),
        )
        .returning();
      for (const l of lines) {
        if (!l.itemId) continue;
        const [it] = await tx
          .select({ t: items.trackStock })
          .from(items)
          .where(eq(items.id, l.itemId));
        if (!it) throw notFound('Item');
        if (it.t)
          await tx.insert(stockMovements).values({
            orgId,
            itemId: l.itemId,
            quantity: l.quantity,
            reason: 'purchase',
            refType: 'purchase',
            refId: row.id,
          });
      }
      await audit(tx, orgId, 'purchase.create', 'purchase', row.id, {
        after: { total: row.total },
      });
      return toPurchase(row, lines);
    },
  });

  route({
    method: 'delete',
    path: '/v1/purchases/:id',
    tag: 'Purchases',
    summary: 'Move a purchase bill to the trash and take its stock back out',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(purchases)
        .set({ deletedAt: new Date() })
        .where(and(eq(purchases.id, params.id), isNull(purchases.deletedAt)))
        .returning();
      if (!row) throw notFound('Purchase');
      // The stock this bill brought in leaves with it, and comes back if the bill is restored.
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
      await audit(tx, orgId, 'purchase.delete', 'purchase', row.id, {
        before: { total: row.total },
      });
      return { ok: true };
    },
  });

  // ---- expenses ----
  route({
    method: 'get',
    path: '/v1/expenses',
    tag: 'Expenses',
    summary: 'List expenses',
    query: pageQuery,
    response: page(expense),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, expenses, {
        ...query,
        searchColumns: [expenses.description, expenses.vendor],
      });
      return { data: res.data.map(toExpense), nextCursor: res.nextCursor };
    },
  });

  route({
    method: 'post',
    path: '/v1/expenses',
    tag: 'Expenses',
    summary: 'Record an expense',
    body: expenseInput,
    response: expense,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const [row] = await tx
        .insert(expenses)
        .values({ ...body, orgId })
        .returning();
      await audit(tx, orgId, 'expense.create', 'expense', row.id, {
        after: { amount: row.amount },
      });
      return toExpense(row);
    },
  });

  route({
    method: 'put',
    path: '/v1/expenses/:id',
    tag: 'Expenses',
    summary: 'Replace an expense',
    params: idParam,
    body: expenseInput,
    response: expense,
    handler: async ({ tx, orgId, params, body }) => {
      const [row] = await tx
        .update(expenses)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(expenses.id, params.id), isNull(expenses.deletedAt)))
        .returning();
      if (!row) throw notFound('Expense');
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
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(expenses)
        .set({ deletedAt: new Date() })
        .where(and(eq(expenses.id, params.id), isNull(expenses.deletedAt)))
        .returning();
      if (!row) throw notFound('Expense');
      await audit(tx, orgId, 'expense.delete', 'expense', row.id);
      return { ok: true };
    },
  });

  route({
    method: 'get',
    path: '/v1/expense-categories',
    tag: 'Expenses',
    summary: 'Expense categories',
    response: z.object({ data: z.array(expenseCategory) }),
    handler: async ({ tx }) => {
      const rows = await tx
        .select()
        .from(expenseCategories)
        .where(isNull(expenseCategories.deletedAt))
        .orderBy(expenseCategories.name);
      return { data: rows.map((c) => ({ id: c.id, name: c.name })) };
    },
  });

  route({
    method: 'post',
    path: '/v1/expense-categories',
    tag: 'Expenses',
    summary: 'Add an expense category',
    body: expenseCategoryInput,
    response: expenseCategory,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const [c] = await tx
        .insert(expenseCategories)
        .values({ ...body, orgId })
        .returning();
      await audit(tx, orgId, 'expense_category.create', 'expense_category', c.id, { after: body });
      return { id: c.id, name: c.name };
    },
  });
}

const toExpense = (r: typeof expenses.$inferSelect) => ({
  id: r.id,
  businessId: r.businessId,
  categoryId: r.categoryId,
  expenseDate: r.expenseDate,
  description: r.description,
  vendor: r.vendor,
  amount: r.amount,
  taxAmount: r.taxAmount,
  paymentMode: r.paymentMode,
  fileId: r.fileId,
  ...stamps(r),
});
