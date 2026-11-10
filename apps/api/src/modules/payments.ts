import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  idParam,
  okBody,
  page,
  pageQuery,
  payment,
  paymentInput,
  paymentListQuery,
  paymentUpdate,
  type Payment,
  type PaymentInput,
} from '@ledgora/contracts';
import { allocateReceipt, cashLimitCheck } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { dueOf, refreshInvoices, transactionSettings } from './saleRules.ts';

const { payments, paymentAllocations, invoices, parties, numberSeries } = schema;

const r2 = (n: number) => Math.round(n * 100) / 100;
const SALES = ['tax-invoice', 'bill-of-supply', 'composition'];

async function allocationsOf(tx: Tx, ids: string[]) {
  const map = new Map<string, { invoiceId: string; amount: number }[]>();
  if (!ids.length) return map;
  const rows = await tx
    .select()
    .from(paymentAllocations)
    .where(and(inArray(paymentAllocations.paymentId, ids), isNull(paymentAllocations.deletedAt)));
  for (const a of rows)
    map.set(a.paymentId, [
      ...(map.get(a.paymentId) ?? []),
      { invoiceId: a.invoiceId, amount: a.amount },
    ]);
  return map;
}

const toPayment = (
  r: typeof payments.$inferSelect,
  allocations: { invoiceId: string; amount: number }[],
): Payment => ({
  id: r.id,
  businessId: r.businessId,
  partyId: r.partyId,
  amount: r.amount,
  mode: r.mode as Payment['mode'],
  paymentDate: r.paymentDate,
  reference: r.reference,
  notes: r.notes,
  number: r.number,
  direction: r.direction as Payment['direction'],
  source: r.source,
  invoiceId: r.invoiceId,
  accountId: r.accountId,
  chequeDate: r.chequeDate,
  discountAmount: r.discountAmount,
  tdsAmount: r.tdsAmount,
  allocations,
  // P2-S5: what the receipt settled (money + discount + TDS) less what went to invoices: the party's advance.
  unallocated: r2(
    r.amount + r.discountAmount + r.tdsAmount - allocations.reduce((s, a) => s + a.amount, 0),
  ),
  ...stamps(r),
});

/** Next receipt number of a business: RCT-1, RCT-2, ... (its own row in number_series, locked while taken). */
async function nextReceiptNumber(tx: Tx, orgId: string, businessId: string) {
  const counterKey = 'counter_RCT';
  await tx.insert(numberSeries).values({ orgId, businessId, counterKey }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.businessId, businessId), eq(numberSeries.counterKey, counterKey)))
    .for('update');
  const next = row.lastValue + 1;
  await tx
    .update(numberSeries)
    .set({ lastValue: next, updatedAt: new Date() })
    .where(eq(numberSeries.id, row.id));
  return `RCT-${next}`;
}

/**
 * Works out and checks where a receipt goes. `settled = amount + discount + TDS`; allocations must not exceed it nor
 * what is pending on each invoice. `excludePaymentId` is the receipt being edited: its own allocations count as not
 * yet paid.
 */
async function planAllocations(tx: Tx, body: PaymentInput, excludePaymentId?: string) {
  const pendingOf = async (inv: typeof invoices.$inferSelect) => {
    if (!excludePaymentId) return r2(dueOf(inv) - inv.paidAmount);
    const [mine] = await tx
      .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.invoiceId, inv.id),
          eq(paymentAllocations.paymentId, excludePaymentId),
          isNull(paymentAllocations.deletedAt),
        ),
      );
    return r2(dueOf(inv) - inv.paidAmount + mine.v);
  };
  let plan = body.allocations;
  if (body.autoAllocate && !plan.length) {
    const open = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.partyId, body.partyId),
          isNull(invoices.deletedAt),
          ne(invoices.status, 'cancelled'),
          inArray(invoices.invoiceType, SALES),
        ),
      )
      .orderBy(asc(invoices.invoiceDate), asc(invoices.createdAt));
    const list = [];
    for (const inv of open)
      list.push({ id: inv.id, date: inv.invoiceDate, pending: await pendingOf(inv) });
    plan = allocateReceipt({
      amount: body.amount,
      discount: body.discountAmount,
      tds: body.tdsAmount,
      invoices: list,
      strategy: 'oldest_first',
    }).allocations;
  }

  const settled = r2(body.amount + body.discountAmount + body.tdsAmount);
  const total = r2(plan.reduce((s, a) => s + a.amount, 0));
  if (total > settled + 0.005)
    throw new AppError(
      'over_allocated',
      body.discountAmount || body.tdsAmount
        ? `The amounts applied to invoices are more than the ₹${settled} settled (money + discount + TDS)`
        : 'The amounts applied to invoices are more than the payment',
    );
  const targets = plan.length
    ? await tx
        .select()
        .from(invoices)
        .where(
          and(
            inArray(
              invoices.id,
              plan.map((a) => a.invoiceId),
            ),
            isNull(invoices.deletedAt),
          ),
        )
    : [];
  for (const a of plan) {
    const inv = targets.find((t) => t.id === a.invoiceId);
    if (!inv) throw notFound('Invoice');
    if (inv.partyId !== body.partyId)
      throw new AppError('unprocessable', `Invoice ${inv.number} belongs to a different party`);
    if (inv.status === 'cancelled')
      throw new AppError('unprocessable', `Invoice ${inv.number} is cancelled`);
    if (a.amount > (await pendingOf(inv)) + 0.005)
      throw new AppError('unprocessable', `More than is due on invoice ${inv.number}`);
  }
  return { plan, total };
}

/** Checks that need no plan: the party, cheque date, §269ST cash. */
async function checkReceipt(tx: Tx, orgId: string, body: PaymentInput, excludePaymentId?: string) {
  await loadBusiness(tx, body.businessId);
  const [party] = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.id, body.partyId), isNull(parties.deletedAt)));
  if (!party) throw notFound('Party');
  if (body.mode === 'cheque' && !body.chequeDate)
    throw new AppError('unprocessable', 'A cheque needs its date', [
      { path: 'chequeDate', message: 'A cheque needs its date' },
    ]);
  if (body.mode === 'cash') {
    const [day] = await tx
      .select({ v: sql<number>`coalesce(sum(${payments.amount}), 0)::float8` })
      .from(payments)
      .where(
        and(
          eq(payments.partyId, body.partyId),
          eq(payments.mode, 'cash'),
          eq(payments.direction, 'in'),
          eq(payments.paymentDate, body.paymentDate),
          isNull(payments.deletedAt),
          excludePaymentId ? ne(payments.id, excludePaymentId) : undefined,
        ),
      );
    const settings = await transactionSettings(tx, body.businessId);
    const cash = cashLimitCheck({
      dayCashTotal: day.v,
      newCash: body.amount,
      limit: settings.cashLimit,
    });
    if (cash.breached) {
      const ack = (body.cashAcknowledgement ?? '').trim();
      if (!ack)
        throw new AppError(
          'cash_limit',
          `Cash from this party today reaches ₹${cash.total} (limit ₹${cash.limit}, section 269ST). Type an acknowledgement to save.`,
          cash,
        );
      await audit(tx, orgId, 'guard.cash_limit', 'payment', excludePaymentId ?? null, {
        after: { ...cash, ack },
      });
    }
  }
}

const columns = (body: PaymentInput) => {
  const { allocations: _a, autoAllocate: _b, cashAcknowledgement: _c, number: _n, ...cols } = body;
  return { ...cols, accountId: cols.accountId ?? null, chequeDate: cols.chequeDate ?? null };
};

export function paymentsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/payments',
    tag: 'Payments',
    summary: 'Payments received, newest first',
    query: pageQuery.extend(paymentListQuery.shape),
    response: page(payment),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, payments, {
        ...query,
        where: query.partyId ? eq(payments.partyId, query.partyId) : undefined,
        searchColumns: [payments.reference, payments.number],
      });
      const allocs = await allocationsOf(
        tx,
        res.data.map((p) => p.id),
      );
      return {
        data: res.data.map((p) => toPayment(p, allocs.get(p.id) ?? [])),
        nextCursor: res.nextCursor,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/payments/:id',
    tag: 'Payments',
    summary: 'One payment',
    params: idParam,
    response: payment,
    handler: async ({ tx, params }) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, params.id), isNull(payments.deletedAt)));
      if (!row) throw notFound('Payment');
      return toPayment(row, (await allocationsOf(tx, [row.id])).get(row.id) ?? []);
    },
  });

  route({
    method: 'post',
    path: '/v1/payments',
    tag: 'Payments',
    summary:
      'Record a payment (with any discount or TDS) and apply it to invoices; any rest stays as party credit',
    body: paymentInput,
    response: payment,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await checkReceipt(tx, orgId, body);
      const { plan, total } = await planAllocations(tx, body);
      const number = body.number || (await nextReceiptNumber(tx, orgId, body.businessId));
      const [row] = await tx
        .insert(payments)
        .values({ ...columns(body), number, orgId })
        .returning();
      if (plan.length)
        await tx.insert(paymentAllocations).values(
          plan.map((a) => ({
            orgId,
            paymentId: row.id,
            invoiceId: a.invoiceId,
            amount: a.amount,
          })),
        );
      await refreshInvoices(
        tx,
        plan.map((a) => a.invoiceId),
      );
      await audit(tx, orgId, 'payment.create', 'payment', row.id, {
        after: {
          amount: row.amount,
          discount: row.discountAmount,
          tds: row.tdsAmount,
          allocated: total,
        },
      });
      return toPayment(row, plan);
    },
  });

  route({
    method: 'put',
    path: '/v1/payments/:id',
    tag: 'Payments',
    summary:
      'Edit a receipt: its allocations are replaced and every invoice it touched, before or after, is re-settled',
    params: idParam,
    body: paymentUpdate,
    response: payment,
    handler: async ({ tx, orgId, params, body }) => {
      const [before] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, params.id), isNull(payments.deletedAt)));
      if (!before) throw notFound('Payment');
      if (before.source !== 'receipt')
        throw new AppError(
          'unprocessable',
          'This payment was received with an invoice; edit it from the invoice',
        );
      await checkReceipt(tx, orgId, body, params.id);
      const { plan, total } = await planAllocations(tx, body, params.id);
      const old = await tx
        .select({ invoiceId: paymentAllocations.invoiceId })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, params.id));
      await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, params.id));
      const [row] = await tx
        .update(payments)
        .set({ ...columns(body), number: body.number || before.number, updatedAt: new Date() })
        .where(eq(payments.id, params.id))
        .returning();
      if (plan.length)
        await tx.insert(paymentAllocations).values(
          plan.map((a) => ({
            orgId,
            paymentId: row.id,
            invoiceId: a.invoiceId,
            amount: a.amount,
          })),
        );
      await refreshInvoices(tx, [...old.map((a) => a.invoiceId), ...plan.map((a) => a.invoiceId)]);
      await audit(tx, orgId, 'payment.update', 'payment', row.id, {
        before: { amount: before.amount },
        after: { amount: row.amount, allocated: total },
      });
      return toPayment(row, plan);
    },
  });

  route({
    method: 'delete',
    path: '/v1/payments/:id',
    tag: 'Payments',
    summary: 'Delete a payment and reopen the invoices it paid',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, params.id), isNull(payments.deletedAt)));
      if (!row) throw notFound('Payment');
      const allocs = await tx
        .select()
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, params.id));
      await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, params.id));
      await tx.delete(payments).where(eq(payments.id, params.id));
      await refreshInvoices(
        tx,
        allocs.map((a) => a.invoiceId),
      );
      await audit(tx, orgId, 'payment.delete', 'payment', row.id, {
        before: { amount: row.amount },
      });
      return { ok: true };
    },
  });
}
