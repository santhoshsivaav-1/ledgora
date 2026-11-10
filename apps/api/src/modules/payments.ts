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
import { allocatePayment, cashLimitCheck } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { dueOf, refreshInvoices, transactionSettings } from './saleRules.ts';
import { openBills, pendingOfPurchase, refreshPurchases } from './purchaseRules.ts';
import { nextSeriesNumber } from './series.ts';
import { guardPeriod } from './saleRules.ts';
import { syncLedger, unpostLedger } from './ledgerRules.ts';
import { syncTds } from './tdsRules.ts';

const { payments, paymentAllocations, invoices, purchases, parties } = schema;

const r2 = (n: number) => Math.round(n * 100) / 100;
const SALES = ['tax-invoice', 'bill-of-supply', 'composition'];

/** An allocation as the API answers it: only the key it settles, so Payment In reads exactly as before Phase 3. */
type Allocation = { invoiceId?: string; purchaseId?: string; amount: number };
type Plan = Allocation[];
const asAllocations = (plan: Plan): Allocation[] =>
  plan.map((a) =>
    a.purchaseId
      ? { purchaseId: a.purchaseId, amount: a.amount }
      : { invoiceId: a.invoiceId, amount: a.amount },
  );
const ids = (list: (string | null | undefined)[]) => list.filter((x): x is string => !!x);

async function allocationsOf(tx: Tx, ids: string[]) {
  const map = new Map<string, Allocation[]>();
  if (!ids.length) return map;
  const rows = await tx
    .select()
    .from(paymentAllocations)
    .where(and(inArray(paymentAllocations.paymentId, ids), isNull(paymentAllocations.deletedAt)));
  for (const a of rows)
    map.set(a.paymentId, [
      ...(map.get(a.paymentId) ?? []),
      a.purchaseId
        ? { purchaseId: a.purchaseId, amount: a.amount }
        : { invoiceId: a.invoiceId!, amount: a.amount },
    ]);
  return map;
}

const toPayment = (r: typeof payments.$inferSelect, allocations: Allocation[]): Payment => ({
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
  tdsSection: r.tdsSection,
  allocations,
  // P2-S5: what the receipt settled (money + discount + TDS) less what went to invoices: the party's advance.
  unallocated: r2(
    r.amount + r.discountAmount + r.tdsAmount - allocations.reduce((s, a) => s + a.amount, 0),
  ),
  ...stamps(r),
});

/**
 * Works out and checks where a payment goes: sale invoices for Payment In, purchase bills for Payment Out (P3-S2). Both
 * use the same engine (tax-engine allocatePayment). `settled = amount + discount + TDS`; allocations must not exceed it
 * nor what is pending on each document. `excludePaymentId` is the payment being edited: its own allocations count as
 * not yet paid.
 */
async function planAllocations(tx: Tx, body: PaymentInput, excludePaymentId?: string) {
  const out = body.direction === 'out';
  const pendingOfInvoice = async (inv: typeof invoices.$inferSelect) => {
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
  let plan: Plan = body.allocations;
  if (plan.some((a) => (out ? a.invoiceId : a.purchaseId)))
    throw new AppError(
      'unprocessable',
      out ? 'A payment out settles purchase bills' : 'A payment in settles sale invoices',
    );
  if (body.autoAllocate && !plan.length) {
    const docs = [];
    if (out)
      for (const bill of await openBills(tx, body.partyId))
        docs.push({
          id: bill.id,
          date: bill.purchaseDate,
          pending: await pendingOfPurchase(tx, bill, excludePaymentId),
        });
    else {
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
      for (const inv of open)
        docs.push({ id: inv.id, date: inv.invoiceDate, pending: await pendingOfInvoice(inv) });
    }
    plan = allocatePayment({
      direction: body.direction,
      amount: body.amount,
      discount: body.discountAmount,
      tds: body.tdsAmount,
      docs,
      strategy: 'oldest_first',
    }).allocations.map((a) =>
      out ? { purchaseId: a.docId, amount: a.amount } : { invoiceId: a.docId, amount: a.amount },
    );
  }

  const settled = r2(body.amount + body.discountAmount + body.tdsAmount);
  const total = r2(plan.reduce((s, a) => s + a.amount, 0));
  if (total > settled + 0.005)
    throw new AppError(
      'over_allocated',
      body.discountAmount || body.tdsAmount
        ? `The amounts applied to ${out ? 'bills' : 'invoices'} are more than the ₹${settled} settled (money + discount + TDS)`
        : `The amounts applied to ${out ? 'bills' : 'invoices'} are more than the payment`,
    );
  if (out) {
    const targets = plan.length
      ? await tx
          .select()
          .from(purchases)
          .where(
            and(
              inArray(purchases.id, ids(plan.map((a) => a.purchaseId))),
              isNull(purchases.deletedAt),
            ),
          )
      : [];
    for (const a of plan) {
      const bill = targets.find((t) => t.id === a.purchaseId);
      if (!bill || bill.docType !== 'bill') throw notFound('Purchase bill');
      const label = bill.number || bill.invoiceNumber;
      if (bill.supplierId !== body.partyId)
        throw new AppError('unprocessable', `Bill ${label} is from a different supplier`);
      if (a.amount > (await pendingOfPurchase(tx, bill, excludePaymentId)) + 0.005)
        throw new AppError('unprocessable', `More than is due on bill ${label}`);
    }
    return { plan, total };
  }
  const targets = plan.length
    ? await tx
        .select()
        .from(invoices)
        .where(
          and(inArray(invoices.id, ids(plan.map((a) => a.invoiceId))), isNull(invoices.deletedAt)),
        )
    : [];
  for (const a of plan) {
    const inv = targets.find((t) => t.id === a.invoiceId);
    if (!inv) throw notFound('Invoice');
    if (inv.partyId !== body.partyId)
      throw new AppError('unprocessable', `Invoice ${inv.number} belongs to a different party`);
    if (inv.status === 'cancelled')
      throw new AppError('unprocessable', `Invoice ${inv.number} is cancelled`);
    if (a.amount > (await pendingOfInvoice(inv)) + 0.005)
      throw new AppError('unprocessable', `More than is due on invoice ${inv.number}`);
  }
  return { plan, total };
}

/** Re-settles every document a payment touched, before or after. */
async function refreshTargets(
  tx: Tx,
  list: { invoiceId?: string | null; purchaseId?: string | null }[],
) {
  await refreshInvoices(tx, ids(list.map((a) => a.invoiceId)));
  await refreshPurchases(
    tx,
    list.map((a) => a.purchaseId),
  );
}

const insertAllocations = (tx: Tx, orgId: string, paymentId: string, plan: Plan) =>
  plan.length
    ? tx.insert(paymentAllocations).values(
        plan.map((a) => ({
          orgId,
          paymentId,
          invoiceId: a.invoiceId ?? null,
          purchaseId: a.purchaseId ?? null,
          amount: a.amount,
        })),
      )
    : Promise.resolve();

/** Checks that need no plan: the party, cheque date, §269ST cash. */
async function checkReceipt(tx: Tx, orgId: string, body: PaymentInput, excludePaymentId?: string) {
  await loadBusiness(tx, body.businessId);
  const [party] = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.id, body.partyId), isNull(parties.deletedAt)));
  if (!party) throw notFound('Party');
  if (body.direction !== 'out' && body.tdsSection)
    throw new AppError('unprocessable', 'A TDS section is for TDS we deduct on a payment out');
  if (body.mode === 'cheque' && !body.chequeDate)
    throw new AppError('unprocessable', 'A cheque needs its date', [
      { path: 'chequeDate', message: 'A cheque needs its date' },
    ]);
  // §269ST is about cash received; money paid out is not limited by it (§40A(3) is a warning on the screen).
  if (body.mode === 'cash' && body.direction !== 'out') {
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
  return {
    ...cols,
    accountId: cols.accountId ?? null,
    chequeDate: cols.chequeDate ?? null,
    tdsSection: cols.tdsSection ?? null,
  };
};

export function paymentsModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/payments',
    tag: 'Payments',
    summary: 'Payments in and out, newest first',
    query: pageQuery.extend(paymentListQuery.shape),
    response: page(payment),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, payments, {
        ...query,
        where: and(
          query.partyId ? eq(payments.partyId, query.partyId) : undefined,
          query.direction ? eq(payments.direction, query.direction) : undefined,
        ),
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
      'Record a payment in (applied to invoices) or out (applied to purchase bills), with any discount or TDS; the rest stays as an advance',
    body: paymentInput,
    response: payment,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.paymentDate,
        c.req.header('x-override-reason'),
      );
      await checkReceipt(tx, orgId, body);
      const { plan, total } = await planAllocations(tx, body);
      const out = body.direction === 'out';
      const number =
        body.number || (await nextSeriesNumber(tx, orgId, body.businessId, out ? 'PAY' : 'RCT'));
      const [row] = await tx
        .insert(payments)
        .values({ ...columns(body), number, orgId, source: out ? 'payment' : 'receipt' })
        .returning();
      await insertAllocations(tx, orgId, row.id, plan);
      await refreshTargets(tx, plan);
      await syncLedger(tx, orgId, 'payment', row.id);
      await syncTds(tx, orgId, 'payment', row.id);
      await audit(tx, orgId, 'payment.create', 'payment', row.id, {
        after: {
          amount: row.amount,
          discount: row.discountAmount,
          tds: row.tdsAmount,
          tdsSection: row.tdsSection,
          direction: row.direction,
          allocated: total,
        },
      });
      return toPayment(row, asAllocations(plan));
    },
  });

  route({
    method: 'put',
    path: '/v1/payments/:id',
    tag: 'Payments',
    summary:
      'Edit a payment in or out: its allocations are replaced and every document it touched, before or after, is re-settled',
    params: idParam,
    body: paymentUpdate,
    response: payment,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      const [before] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, params.id), isNull(payments.deletedAt)));
      if (!before) throw notFound('Payment');
      const why = c.req.header('x-override-reason');
      await guardPeriod(tx, orgId, auth, before.businessId, before.paymentDate, why);
      await guardPeriod(tx, orgId, auth, body.businessId, body.paymentDate, why);
      if (before.source !== 'receipt' && before.source !== 'payment')
        throw new AppError(
          'unprocessable',
          before.direction === 'out'
            ? 'This payment belongs to a purchase document; edit it from there'
            : 'This payment was received with an invoice; edit it from the invoice',
        );
      if (body.direction !== before.direction)
        throw new AppError(
          'unprocessable',
          'A payment in can not become a payment out, or the reverse',
        );
      await checkReceipt(tx, orgId, body, params.id);
      const { plan, total } = await planAllocations(tx, body, params.id);
      const old = await tx
        .select({
          invoiceId: paymentAllocations.invoiceId,
          purchaseId: paymentAllocations.purchaseId,
        })
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, params.id));
      await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, params.id));
      const [row] = await tx
        .update(payments)
        .set({ ...columns(body), number: body.number || before.number, updatedAt: new Date() })
        .where(eq(payments.id, params.id))
        .returning();
      await insertAllocations(tx, orgId, row.id, plan);
      await refreshTargets(tx, [...old, ...plan]);
      await syncLedger(tx, orgId, 'payment', row.id);
      await syncTds(tx, orgId, 'payment', row.id);
      await audit(tx, orgId, 'payment.update', 'payment', row.id, {
        before: { amount: before.amount },
        after: { amount: row.amount, allocated: total },
      });
      return toPayment(row, asAllocations(plan));
    },
  });

  route({
    method: 'delete',
    path: '/v1/payments/:id',
    tag: 'Payments',
    summary: 'Delete a payment and reopen the invoices or bills it paid (its TDS goes with it)',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, params.id), isNull(payments.deletedAt)));
      if (!row) throw notFound('Payment');
      await guardPeriod(
        tx,
        orgId,
        auth,
        row.businessId,
        row.paymentDate,
        c.req.header('x-override-reason'),
      );
      const allocs = await tx
        .select()
        .from(paymentAllocations)
        .where(eq(paymentAllocations.paymentId, params.id));
      await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, params.id));
      // The payment is removed for good, so its postings are reversed first (the ledger keeps the history).
      await unpostLedger(tx, orgId, row.businessId, 'payment', row.id);
      await tx.delete(payments).where(eq(payments.id, params.id));
      await syncTds(tx, orgId, 'payment', row.id);
      await refreshTargets(tx, allocs);
      await audit(tx, orgId, 'payment.delete', 'payment', row.id, {
        before: { amount: row.amount },
      });
      return { ok: true };
    },
  });
}
