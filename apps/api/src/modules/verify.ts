// Vyapar parity P4-S5 (Verify My Data) and P10-S5 (the TDS payable ledger) on the API.
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  idParam,
  tdsDepositInput,
  tdsList,
  tdsQuery,
  verifyCheck,
  verifyFixResult,
  verifyQuery,
  verifyResult,
} from '@ledgora/contracts';
import { ACC, postTransfer, runVerify, verifySummary, type VerifyData } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { documents, partyDiffs, repostDocuments } from './ledgerBackfill.ts';
import { buildCtx, ledgerEnabled, repost, seedChart } from './ledgerRules.ts';
import { dueOf, refreshInvoices } from './saleRules.ts';
import { refreshPurchases } from './purchaseRules.ts';
import { tdsView } from './tdsRules.ts';

const {
  items,
  stockMovements,
  invoices,
  invoiceLines,
  payments,
  paymentAllocations,
  parties,
  purchases,
  expenses,
  ledgerEntries,
  tdsEntries,
} = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;
const SALE_POSTING = ['tax-invoice', 'bill-of-supply', 'composition', 'credit-note'];

/** Reads what the checks need with set-based queries (no per-document round trips). */
async function gather(tx: Tx, businessId: string): Promise<VerifyData> {
  const today = new Date().toISOString().slice(0, 10);
  const ledgerOn = await ledgerEnabled(tx, businessId);
  const live = and(eq(invoices.businessId, businessId), isNull(invoices.deletedAt));

  const stock = await tx
    .select({
      id: items.id,
      name: items.name,
      trackStock: items.trackStock,
      stock: sql<number>`coalesce(sum(${stockMovements.quantity}) filter (where ${stockMovements.deletedAt} is null), 0)::float8`,
    })
    .from(items)
    .leftJoin(stockMovements, eq(stockMovements.itemId, items.id))
    .where(isNull(items.deletedAt))
    .groupBy(items.id, items.name, items.trackStock);
  const invs = await tx.select().from(invoices).where(live);
  const lineSums = new Map(
    (
      await tx
        .select({
          id: invoiceLines.invoiceId,
          total: sql<number>`sum(${invoiceLines.lineTotal})::float8`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
        .where(live)
        .groupBy(invoiceLines.invoiceId)
    ).map((r) => [r.id, r.total]),
  );
  const totalsOf = (i: (typeof invs)[number]) =>
    ((i.data ?? {}) as { totals?: Record<string, number> }).totals ?? {};
  const pays = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.businessId, businessId), isNull(payments.deletedAt)));
  const allocs = await tx
    .select()
    .from(paymentAllocations)
    .where(isNull(paymentAllocations.deletedAt));
  const byPayment = new Map<string, number>();
  const byInvoice = new Map<string, number>();
  for (const a of allocs) {
    byPayment.set(a.paymentId, r2((byPayment.get(a.paymentId) ?? 0) + a.amount));
    if (a.invoiceId) byInvoice.set(a.invoiceId, r2((byInvoice.get(a.invoiceId) ?? 0) + a.amount));
  }
  const hsn = await tx
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      name: invoiceLines.name,
      taxPercent: invoiceLines.taxPercent,
      hsn: invoiceLines.hsn,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(live, gt(invoiceLines.taxPercent, 0), eq(invoiceLines.hsn, '')));
  const vouchers = await tx
    .select({
      voucherId: ledgerEntries.voucherId,
      debit: sql<number>`sum(${ledgerEntries.debit})::float8`,
      credit: sql<number>`sum(${ledgerEntries.credit})::float8`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.businessId, businessId))
    .groupBy(ledgerEntries.voucherId)
    .having(sql`sum(${ledgerEntries.debit}) <> sum(${ledgerEntries.credit})`);

  const withEntries = new Set(
    (
      await tx
        .selectDistinct({ t: ledgerEntries.refType, id: ledgerEntries.refId })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.businessId, businessId))
    ).map((r) => `${r.t}:${r.id}`),
  );
  const missing: VerifyData['documentsWithoutLedger'] = [];
  if (ledgerOn)
    for (const d of await documents(tx, businessId)) {
      const r = d.row as Record<string, unknown>;
      const posts =
        d.kind === 'invoice'
          ? SALE_POSTING.includes(String(r.invoiceType)) &&
            r.status !== 'cancelled' &&
            Number(r.total) > 0
          : d.kind === 'purchase'
            ? r.docType !== 'order' && Number(r.total) > 0
            : d.kind === 'payment'
              ? ![
                  'invoice_inline',
                  'purchase_inline',
                  'credit_note_refund',
                  'debit_note_refund',
                ].includes(String(r.source)) && Number(r.amount) > 0
              : Number(r.amount) + Number(r.taxAmount) > 0;
      if (posts && !withEntries.has(`${d.kind}:${d.row.id}`))
        missing.push({ kind: d.kind, id: d.row.id, label: String(d.label ?? '') });
    }

  const moves = await tx
    .select({ id: stockMovements.id, refType: stockMovements.refType, refId: stockMovements.refId })
    .from(stockMovements)
    .where(
      and(
        isNull(stockMovements.deletedAt),
        inArray(stockMovements.refType, ['invoice', 'purchase']),
      ),
    );
  const liveInv = new Set(
    (await tx.select({ id: invoices.id }).from(invoices).where(isNull(invoices.deletedAt))).map(
      (r) => r.id,
    ),
  );
  const livePur = new Set(
    (await tx.select({ id: purchases.id }).from(purchases).where(isNull(purchases.deletedAt))).map(
      (r) => r.id,
    ),
  );
  const orphans = moves
    .filter((m) => m.refId && !(m.refType === 'invoice' ? liveInv : livePur).has(m.refId))
    .map((m) => ({ id: m.id, refType: m.refType ?? '', refId: m.refId ?? '' }));

  const dates: VerifyData['documentDates'] = [
    ...invs
      .filter((i) => i.invoiceDate > today)
      .map((i) => ({ kind: 'invoice', id: i.id, label: i.number, date: i.invoiceDate })),
    ...(
      await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.businessId, businessId),
            isNull(purchases.deletedAt),
            gt(purchases.purchaseDate, today),
          ),
        )
    ).map((p) => ({
      kind: 'purchase',
      id: p.id,
      label: p.number || p.invoiceNumber,
      date: p.purchaseDate,
    })),
    ...(
      await tx
        .select()
        .from(expenses)
        .where(
          and(
            eq(expenses.businessId, businessId),
            isNull(expenses.deletedAt),
            gt(expenses.expenseDate, today),
          ),
        )
    ).map((e) => ({
      kind: 'expense',
      id: e.id,
      label: e.number || e.description,
      date: e.expenseDate,
    })),
  ];

  return {
    today,
    ledgerOn,
    items: stock.map((s) => ({ id: s.id, name: s.name, stock: s.stock, trackStock: s.trackStock })),
    invoices: invs.map((i) => {
      const t = totalsOf(i);
      return {
        id: i.id,
        number: i.number,
        invoiceType: i.invoiceType,
        invoiceDate: i.invoiceDate,
        total: i.total,
        status: i.status,
        lineTotal: lineSums.get(i.id) ?? 0,
        extras:
          (t.chargesTotal ?? 0) + (t.chargesTax ?? 0) + (t.tcsAmount ?? 0) + (t.roundOff ?? 0),
        invoiceDiscount: t.invoiceDiscountAmount ?? 0,
      };
    }),
    payments: pays.map((p) => ({
      id: p.id,
      number: p.number,
      settled: r2(p.amount + p.tdsAmount + p.discountAmount),
      allocated: byPayment.get(p.id) ?? 0,
    })),
    invoiceDue: invs
      .filter((i) => byInvoice.has(i.id))
      .map((i) => ({
        id: i.id,
        number: i.number,
        due: dueOf(i),
        allocated: byInvoice.get(i.id) ?? 0,
      })),
    parties: (
      await tx
        .select({ id: parties.id, name: parties.name, gstin: parties.gstin })
        .from(parties)
        .where(isNull(parties.deletedAt))
    ).map((p) => ({ id: p.id, name: p.name, gstin: p.gstin ?? '' })),
    hsnLines: hsn,
    vouchers: vouchers.map((v) => ({ voucherId: v.voucherId, debit: v.debit, credit: v.credit })),
    documentsWithoutLedger: missing,
    orphanMovements: orphans,
    partyMismatches: ledgerOn
      ? await partyDiffs(tx, businessId).then((d) =>
          d.map((x) => ({
            partyId: x.partyId,
            name: x.name,
            ledger: x.ledger,
            documents: x.documents,
          })),
        )
      : [],
    documentDates: dates,
  };
}

const run = async (tx: Tx, businessId: string) => {
  const checks = runVerify(await gather(tx, businessId));
  return { ranAt: new Date().toISOString(), summary: verifySummary(checks), checks };
};

/** Trims allocations that exceed what a payment is or what an invoice owes, newest first. Idempotent. */
async function trimAllocations(tx: Tx, businessId: string) {
  const allocs = await tx
    .select()
    .from(paymentAllocations)
    .where(isNull(paymentAllocations.deletedAt))
    .orderBy(desc(paymentAllocations.createdAt));
  const pays = new Map(
    (await tx.select().from(payments).where(eq(payments.businessId, businessId))).map((p) => [
      p.id,
      r2(p.amount + p.tdsAmount + p.discountAmount),
    ]),
  );
  const invs = new Map(
    (await tx.select().from(invoices).where(eq(invoices.businessId, businessId))).map((i) => [
      i.id,
      dueOf(i),
    ]),
  );
  let fixed = 0;
  const touchedInv = new Set<string>();
  const touchedPur = new Set<string>();
  const trim = async (list: typeof allocs, cap: number) => {
    let total = r2(list.reduce((s, a) => s + a.amount, 0));
    for (const a of list) {
      if (total <= cap + 0.005) break;
      const cut = r2(Math.min(a.amount, total - cap));
      if (cut >= a.amount - 0.005)
        await tx.delete(paymentAllocations).where(eq(paymentAllocations.id, a.id));
      else
        await tx
          .update(paymentAllocations)
          .set({ amount: r2(a.amount - cut), updatedAt: new Date() })
          .where(eq(paymentAllocations.id, a.id));
      total = r2(total - cut);
      fixed++;
      if (a.invoiceId) touchedInv.add(a.invoiceId);
      if (a.purchaseId) touchedPur.add(a.purchaseId);
    }
  };
  for (const [id, settled] of pays)
    await trim(
      allocs.filter((a) => a.paymentId === id),
      settled,
    );
  const fresh = await tx
    .select()
    .from(paymentAllocations)
    .where(isNull(paymentAllocations.deletedAt))
    .orderBy(desc(paymentAllocations.createdAt));
  for (const [id, due] of invs)
    await trim(
      fresh.filter((a) => a.invoiceId === id),
      due,
    );
  await refreshInvoices(tx, [...touchedInv]);
  await refreshPurchases(tx, [...touchedPur]);
  return fixed;
}

export function verifyModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/verify',
    tag: 'Utilities',
    summary: 'Verify My Data: run every check and report what is wrong',
    query: verifyQuery,
    response: verifyResult,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      return run(tx, query.businessId);
    },
  });

  route({
    method: 'post',
    path: '/v1/verify/:checkId/fix',
    tag: 'Utilities',
    summary:
      'Fix one check automatically: rebuild the ledger of the documents (repost) or trim over-allocated payments. Idempotent and audited',
    params: z.object({ checkId: z.string().max(40) }),
    body: z.object({ businessId: z.string().uuid() }),
    response: verifyFixResult,
    handler: async ({ tx, orgId, params, body }) => {
      await loadBusiness(tx, body.businessId);
      const before = (await run(tx, body.businessId)).checks.find((c) => c.id === params.checkId);
      if (!before) throw notFound('Check');
      if (!before.fix) throw new AppError('unprocessable', 'This check has no automatic fix');
      let fixed = 0;
      if (before.fix === 'repost') {
        if (!(await ledgerEnabled(tx, body.businessId)))
          throw new AppError('conflict', 'The ledger is off for this business');
        await seedChart(tx, orgId, body.businessId);
        fixed = await repostDocuments(tx, orgId, body.businessId);
      } else fixed = await trimAllocations(tx, body.businessId);
      await audit(tx, orgId, 'verify.fix', 'business', body.businessId, {
        after: { check: params.checkId, fixed },
      });
      return {
        fixed,
        check:
          (await run(tx, body.businessId)).checks.find((c) => c.id === params.checkId) ??
          verifyCheck.parse({ ...before, count: 0, rows: [] }),
      };
    },
  });

  // ---- TDS payable (P10-S5) ----
  route({
    method: 'get',
    path: '/v1/tds',
    tag: 'Tax',
    summary: 'TDS we deducted, with due dates, interest for late deposit and the missing-PAN flag',
    query: tdsQuery,
    response: tdsList,
    handler: async ({ tx, query }) => {
      const asOf = new Date().toISOString().slice(0, 10);
      const rows = await tx
        .select()
        .from(tdsEntries)
        .where(
          and(
            eq(tdsEntries.businessId, query.businessId),
            query.from ? sql`${tdsEntries.date} >= ${query.from}` : undefined,
            query.to ? sql`${tdsEntries.date} <= ${query.to}` : undefined,
            query.section ? eq(tdsEntries.section, query.section) : undefined,
          ),
        )
        .orderBy(asc(tdsEntries.date));
      const data = rows.map((e) => tdsView(e, asOf));
      const sum = (f: (x: (typeof data)[number]) => boolean) =>
        r2(data.filter(f).reduce((s, x) => s + x.tdsAmount, 0));
      return {
        data,
        total: sum(() => true),
        deposited: sum((x) => x.status === 'deposited'),
        pending: sum((x) => x.status === 'accrued'),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/tds/:id/deposit',
    tag: 'Tax',
    summary:
      'Mark TDS deposited with its challan (BSR code, serial, date); posts Dr TDS Payable / Cr bank when the ledger is on',
    params: idParam,
    body: tdsDepositInput,
    response: z.object({ ok: z.literal(true) }),
    handler: async ({ tx, orgId, params, body }) => {
      const [e] = await tx.select().from(tdsEntries).where(eq(tdsEntries.id, params.id));
      if (!e) throw notFound('TDS entry');
      if (e.status === 'deposited')
        throw new AppError('conflict', 'This TDS is already marked deposited');
      await tx
        .update(tdsEntries)
        .set({
          status: 'deposited',
          challanNo: body.challanNo,
          bsrCode: body.bsrCode,
          challanDate: body.challanDate,
          updatedAt: new Date(),
        })
        .where(eq(tdsEntries.id, e.id));
      if (await ledgerEnabled(tx, e.businessId)) {
        const ctx = await buildCtx(tx, orgId, e.businessId, { bankIds: [body.accountId] });
        const from = body.accountId
          ? (ctx.bankAccount?.(body.accountId) ?? ACC.BANK_UNASSIGNED)
          : ACC.BANK_UNASSIGNED;
        await repost(tx, orgId, {
          businessId: e.businessId,
          refType: 'transfer',
          refId: e.id,
          postings: postTransfer({
            id: e.id,
            date: body.challanDate,
            from,
            to: ACC.TDS_PAYABLE,
            amount: e.tdsAmount,
            narration: `TDS deposited, challan ${body.challanNo}`,
          }),
        });
      }
      await audit(tx, orgId, 'tds.deposit', 'tds_entry', e.id, {
        after: { challanNo: body.challanNo, amount: e.tdsAmount },
      });
      return { ok: true as const };
    },
  });
}
