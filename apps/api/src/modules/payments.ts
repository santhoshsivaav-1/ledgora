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
  type Payment,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { dueOf, statusFor } from './invoices.ts';

const { payments, paymentAllocations, invoices, parties } = schema;

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
  allocations,
  unallocated: r2(r.amount - allocations.reduce((s, a) => s + a.amount, 0)),
  ...stamps(r),
});

/** Re-derives paid_amount and status of invoices from their allocations, so the two can never drift apart. */
async function refreshInvoices(tx: Tx, invoiceIds: string[]) {
  for (const id of new Set(invoiceIds)) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
    if (!inv || inv.status === 'cancelled') continue;
    const [sum] = await tx
      .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.invoiceId, id), isNull(paymentAllocations.deletedAt)));
    const paid = r2(sum.v);
    await tx
      .update(invoices)
      .set({ paidAmount: paid, status: statusFor(inv, paid), updatedAt: new Date() })
      .where(eq(invoices.id, id));
  }
}

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
        searchColumns: [payments.reference],
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
    summary: 'Record a payment and apply it to invoices; any rest stays as party credit',
    body: paymentInput,
    response: payment,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const [party] = await tx
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.id, body.partyId), isNull(parties.deletedAt)));
      if (!party) throw notFound('Party');

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
        let left = body.amount;
        plan = [];
        for (const inv of open) {
          const due = r2(dueOf(inv) - inv.paidAmount);
          if (due <= 0 || left <= 0) continue;
          const take = Math.min(due, left);
          plan.push({ invoiceId: inv.id, amount: r2(take) });
          left = r2(left - take);
        }
      }

      const total = r2(plan.reduce((s, a) => s + a.amount, 0));
      if (total > body.amount + 0.005)
        throw new AppError(
          'unprocessable',
          'The amounts applied to invoices are more than the payment',
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
        if (a.amount > r2(dueOf(inv) - inv.paidAmount) + 0.005)
          throw new AppError('unprocessable', `More than is due on invoice ${inv.number}`);
      }

      const { allocations: _a, autoAllocate: _b, ...cols } = body;
      const [row] = await tx
        .insert(payments)
        .values({ ...cols, orgId })
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
