import { and, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  cancelInvoiceInput,
  convertOrderInput,
  idParam,
  invoiceListSalesman,
  invoice,
  invoiceInput,
  invoiceListQuery,
  invoiceSummary,
  nextNumberQuery,
  numberSeriesRow,
  numberSeriesUpdate,
  okBody,
  orderProgress,
  returnableResponse,
  page,
  pageQuery,
  type Invoice,
  type InvoiceInput,
  type InvoiceSummary,
} from '@ledgora/contracts';
import {
  computeInvoiceTotals,
  counterKeyFor,
  DEFAULT_NUMBER_SETTINGS,
  formatDocNumber,
  getFinancialYearLabel,
  INVOICE_TYPES,
  nextCounterValue,
  numberSeriesFor,
  startFor,
  stockDelta,
  stockEffect,
  overReturns,
  returnableQty,
  saleOrderProgress,
  SALES_INVOICE_TYPES,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import type { OrgContext } from '../middleware/context.ts';
import {
  assertInScope,
  checkInlinePayments,
  dueOf,
  invoicePayments,
  receiptAllocations,
  refreshInvoices,
  resolveSalesman,
  runGuards,
  salesmanScope,
  statusFor,
  walkInParty,
  writeInlinePayments,
} from './saleRules.ts';
import { syncLedger } from './ledgerRules.ts';

const {
  invoices,
  invoiceLines,
  numberSeries,
  businessSettings,
  parties,
  items,
  stockMovements,
  paymentAllocations,
  payments,
} = schema;

type InvoiceRow = typeof invoices.$inferSelect;
type LineRow = typeof invoiceLines.$inferSelect;

const toSummary = (r: InvoiceRow, partyName: string | null): InvoiceSummary => ({
  id: r.id,
  businessId: r.businessId,
  partyId: r.partyId,
  partyName,
  invoiceType: r.invoiceType as InvoiceSummary['invoiceType'],
  number: r.number,
  invoiceDate: r.invoiceDate,
  dueDate: r.dueDate,
  status: r.status as InvoiceSummary['status'],
  currency: r.currency,
  subtotal: r.subtotal,
  taxableAmount: r.taxableAmount,
  cgst: r.cgst,
  sgst: r.sgst,
  igst: r.igst,
  cess: r.cess,
  totalTax: r.totalTax,
  total: r.total,
  paidAmount: r.paidAmount,
  salesmanId: r.salesmanId,
  ...stamps(r),
});

const toLine = (l: LineRow): Invoice['lines'][number] => ({
  id: l.id,
  itemId: l.itemId,
  name: l.name,
  description: l.description,
  hsn: l.hsn,
  unit: l.unit,
  quantity: l.quantity,
  rate: l.rate,
  discount: l.discount,
  discountType: ((l.extra as { discountType?: string }).discountType ?? 'amount') as
    'amount' | 'percent',
  taxPercent: l.taxPercent,
  cessPercent: l.cessPercent,
  taxableAmount: l.taxableAmount,
  taxAmount: l.taxAmount,
  lineTotal: l.lineTotal,
});

async function partyNames(tx: Tx, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!wanted.length) return map;
  const rows = await tx
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(inArray(parties.id, wanted));
  for (const r of rows) map.set(r.id, r.name);
  return map;
}

export async function loadInvoice(
  tx: Tx,
  id: string,
): Promise<{ row: InvoiceRow; lines: LineRow[] }> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), isNull(invoices.deletedAt)));
  if (!row) throw notFound('Invoice');
  const lines = await tx
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, id), isNull(invoiceLines.deletedAt)))
    .orderBy(invoiceLines.position);
  return { row, lines };
}

async function toInvoice(tx: Tx, row: InvoiceRow, lines: LineRow[]): Promise<Invoice> {
  const names = await partyNames(tx, [row.partyId]);
  return {
    ...toSummary(row, row.partyId ? (names.get(row.partyId) ?? null) : null),
    placeOfSupply: row.placeOfSupply,
    lines: lines.map(toLine),
    data: row.data as Record<string, unknown>,
    payments: await invoicePayments(tx, row.id),
  };
}

// ---- numbering (change 1.16: "one transaction locks number_series") ------------------------------------------------

async function seriesSettings(tx: Tx, businessId: string) {
  const [s] = await tx
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  return numberSeriesFor((s?.numberSettings as Record<string, unknown>) ?? {}, null, '');
}

/** Takes the next number of a business's series for a document type. The row lock serialises concurrent saves. */
async function allocateNumber(
  tx: Tx,
  orgId: string,
  businessId: string,
  invoiceType: string,
  invoiceDate: string,
) {
  const prefix = INVOICE_TYPES[invoiceType]?.prefix ?? 'INV';
  const series = await seriesSettings(tx, businessId);
  const counterKey = counterKeyFor(prefix, series, '');
  await tx.insert(numberSeries).values({ orgId, businessId, counterKey }).onConflictDoNothing();
  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = await tx
      .select()
      .from(numberSeries)
      .where(and(eq(numberSeries.businessId, businessId), eq(numberSeries.counterKey, counterKey)))
      .for('update');
    const next = nextCounterValue(row.lastValue, startFor(invoiceType, series));
    await tx
      .update(numberSeries)
      .set({ lastValue: next, updatedAt: new Date() })
      .where(eq(numberSeries.id, row.id));
    const number = formatDocNumber({
      settings: series,
      typePrefix: prefix,
      next,
      fyLabel: getFinancialYearLabel(new Date(`${invoiceDate}T00:00:00`)),
    });
    // A counter that lags behind hand-typed or imported numbers must never hand one out twice.
    const [taken] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, businessId),
          eq(invoices.number, number),
          isNull(invoices.deletedAt),
        ),
      );
    if (!taken) return number;
  }
  throw new AppError('conflict', 'Could not find a free invoice number');
}

// ---- the shared build step ---------------------------------------------------------------------------------------------

type BuildInput = InvoiceInput & { sourceOrderId?: string };

async function build(tx: Tx, input: BuildInput) {
  const biz = await loadBusiness(tx, input.businessId);
  let party: typeof parties.$inferSelect | undefined;
  if (input.partyId) {
    [party] = await tx
      .select()
      .from(parties)
      .where(and(eq(parties.id, input.partyId), isNull(parties.deletedAt)));
    if (!party) throw notFound('Party');
  }
  const itemIds = [...new Set(input.items.map((i) => i.itemId).filter((x): x is string => !!x))];
  const known = itemIds.length
    ? await tx
        .select({ id: items.id, trackStock: items.trackStock })
        .from(items)
        .where(inArray(items.id, itemIds))
    : [];
  if (known.length !== itemIds.length) throw notFound('Item');
  // P2-S6: a credit note with Restock off returns no goods to stock.
  const restockOff = input.invoiceType === 'credit-note' && input.restock === false;
  const tracked = new Set(restockOff ? [] : known.filter((k) => k.trackStock).map((k) => k.id));

  const cfg = INVOICE_TYPES[input.invoiceType];
  const t = computeInvoiceTotals({
    items: input.items,
    profile: { country: biz.country, state: biz.state, gstin: biz.gstin ?? '' },
    client: {
      name: party?.name,
      state: party?.state,
      country: party?.country,
      gstin: party?.gstin ?? '',
      isSEZ: party?.isSez ?? false,
    },
    details: { placeOfSupply: input.placeOfSupply },
    showGST: cfg?.showGST !== false,
    taxInclusive: input.taxInclusive,
    invoiceOptions: input.options,
    charges: input.charges,
  });
  const { lines: calc, ...totals } = t as { lines: Record<string, number>[] } & Record<
    string,
    number
  >;
  const lineRows = input.items.map((l, i) => {
    const c = calc[i];
    return {
      position: i,
      itemId: l.itemId ?? null,
      name: l.name,
      description: l.description,
      hsn: l.hsn,
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      discount: l.discount,
      taxPercent: l.taxPercent,
      cessPercent: l.cessPercent,
      taxableAmount: c.taxable,
      taxAmount: c.tax + c.cess,
      lineTotal: Math.round((c.taxable + c.tax + c.cess) * 100) / 100,
      extra: { discountType: l.discountType },
    };
  });
  return {
    columns: {
      businessId: input.businessId,
      partyId: input.partyId ?? null,
      invoiceType: input.invoiceType,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate ?? null,
      currency: input.options.currency ?? 'INR',
      placeOfSupply: input.placeOfSupply,
      subtotal: totals.subtotal,
      taxableAmount: totals.taxableAmount,
      cgst: totals.cgst,
      sgst: totals.sgst + (totals.utgst || 0),
      igst: totals.igst,
      cess: totals.cess,
      totalTax: totals.totalTaxAmount,
      total: totals.total,
      data: {
        totals,
        terms: input.terms,
        notes: input.notes,
        options: input.options,
        taxInclusive: input.taxInclusive,
        // Vyapar parity Phase 2: written only when used, so older invoices keep their exact data.
        ...(input.charges?.length ? { charges: input.charges } : {}),
        ...(input.invoiceType === 'credit-note'
          ? {
              againstInvoiceId: input.againstInvoiceId ?? null,
              returnReason: input.returnReason ?? null,
              restock: input.restock !== false,
              refund: input.refund ?? { mode: 'adjust' },
            }
          : {}),
        ...(input.expectedDeliveryDate ? { expectedDeliveryDate: input.expectedDeliveryDate } : {}),
        ...(input.sourceOrderId ? { sourceOrderId: input.sourceOrderId } : {}),
      },
    },
    lineRows,
    tracked,
  };
}

/** Brings the stock movements of an invoice in line with what its type and status say it should have done. */
async function syncStock(
  tx: Tx,
  orgId: string,
  invoiceId: string,
  invoiceType: string,
  status: string,
  lines: { itemId: string | null; quantity: number }[],
  tracked: Set<string>,
  reason: string,
) {
  const want = stockEffect(
    lines
      .filter((l) => l.itemId && tracked.has(l.itemId))
      .map((l) => ({ productId: l.itemId, quantity: l.quantity })),
    invoiceType,
    status,
  );
  const rows = await tx
    .select({
      itemId: stockMovements.itemId,
      q: sql<number>`sum(${stockMovements.quantity})::float8`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.refType, 'invoice'),
        eq(stockMovements.refId, invoiceId),
        isNull(stockMovements.deletedAt),
      ),
    )
    .groupBy(stockMovements.itemId);
  const have: Record<string, number> = {};
  for (const r of rows) have[r.itemId] = Math.round(r.q * 1000) / 1000;
  const delta = stockDelta(have, want);
  for (const [itemId, quantity] of Object.entries(delta)) {
    await tx
      .insert(stockMovements)
      .values({ orgId, itemId, quantity, reason, refType: 'invoice', refId: invoiceId });
  }
}

export { dueOf, statusFor };

/** The Phase 2 fields have defaults in the contract; callers inside the API (recurring) may leave them out. */
type CreateInput = Omit<InvoiceInput, 'payments' | 'charges' | 'confirm' | 'restock'> &
  Partial<Pick<InvoiceInput, 'payments' | 'charges' | 'confirm' | 'restock'>>;

const withDefaults = (i: CreateInput): InvoiceInput => ({
  ...i,
  payments: i.payments ?? [],
  charges: i.charges ?? [],
  confirm: i.confirm ?? {},
  restock: i.restock ?? true,
});

const asLineInputs = (lines: LineRow[]) =>
  lines.map((l) => ({ itemId: l.itemId, name: l.name, quantity: l.quantity }));

/** P2-S6: a credit note against an invoice may not return more than is left to return. */
async function checkReturn(tx: Tx, input: InvoiceInput, selfId?: string) {
  if (input.invoiceType !== 'credit-note' || !input.againstInvoiceId) return input;
  const { row: inv, lines } = await loadInvoice(tx, input.againstInvoiceId);
  if (!SALES_INVOICE_TYPES.includes(inv.invoiceType) || inv.status === 'cancelled')
    throw new AppError('unprocessable', 'A credit note can only return a live sale invoice', [
      { path: 'againstInvoiceId', message: 'Pick a live sale invoice' },
    ]);
  if (input.partyId && inv.partyId && input.partyId !== inv.partyId)
    throw new AppError('unprocessable', `Invoice ${inv.number} belongs to a different party`);
  const prior = await priorCreditNotes(tx, inv.id, selfId);
  const over = overReturns(input.items, returnableQty(asLineInputs(lines), prior));
  if (over.length)
    throw new AppError(
      'over_return',
      `More than is left to return: ${over.map((o) => `${o.name} (${o.returnable} left)`).join(', ')}`,
      over,
    );
  return { ...input, partyId: input.partyId ?? inv.partyId };
}

async function priorCreditNotes(tx: Tx, invoiceId: string, excludeId?: string) {
  const cns = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.invoiceType, 'credit-note'),
        isNull(invoices.deletedAt),
        sql`${invoices.data}->>'againstInvoiceId' = ${invoiceId}`,
        excludeId ? ne(invoices.id, excludeId) : undefined,
      ),
    );
  const out = [];
  for (const cn of cns) {
    const { lines } = await loadInvoice(tx, cn.id);
    out.push({ status: cn.status, lines: asLineInputs(lines) });
  }
  return out;
}

/** P2-S6: a cash or bank refund on a credit note is money going out (payments.direction 'out'). */
async function writeRefund(
  tx: Tx,
  orgId: string,
  cn: InvoiceRow,
  refund: InvoiceInput['refund'],
  { soft = false } = {},
) {
  const old = and(
    eq(payments.invoiceId, cn.id),
    eq(payments.source, 'credit_note_refund'),
    isNull(payments.deletedAt),
  );
  if (soft) await tx.update(payments).set({ deletedAt: new Date() }).where(old);
  else await tx.delete(payments).where(old);
  if (!refund || refund.mode === 'adjust' || soft || cn.invoiceType !== 'credit-note') return;
  if (!cn.partyId) throw new AppError('unprocessable', 'A refund needs a party');
  await tx.insert(payments).values({
    orgId,
    businessId: cn.businessId,
    partyId: cn.partyId,
    amount: cn.total,
    mode: refund.mode === 'cash' ? 'cash' : 'bank',
    accountId: refund.accountId ?? null,
    reference: refund.reference ?? '',
    paymentDate: cn.invoiceDate,
    direction: 'out',
    source: 'credit_note_refund',
    invoiceId: cn.id,
    number: cn.number,
    notes: `Refund on ${cn.number}`,
  });
}

/** Creates an invoice with its lines, number, stock movements, payments and audit row, all in the caller's transaction. */
export async function createInvoice(
  tx: Tx,
  orgId: string,
  raw: CreateInput,
  extra: { generatedFromId?: string; auth?: OrgContext; sourceOrderId?: string } = {},
) {
  let input = withDefaults(raw);
  const scope = extra.auth ? await salesmanScope(tx, extra.auth) : null;
  // A cash sale needs no customer: its payments are recorded against the walk-in "Cash Sale" party.
  if (!input.partyId && input.payments.length && SALES_INVOICE_TYPES.includes(input.invoiceType))
    input = { ...input, partyId: await walkInParty(tx, orgId) };
  input = await checkReturn(tx, input);
  const built = await build(tx, { ...input, sourceOrderId: extra.sourceOrderId });
  await checkInlinePayments(tx, {
    invoiceType: input.invoiceType,
    total: built.columns.total,
    data: built.columns.data,
    rows: input.payments,
  });
  if (extra.auth)
    await runGuards(tx, orgId, extra.auth, {
      businessId: input.businessId,
      invoiceType: input.invoiceType,
      invoiceDate: input.invoiceDate,
      partyId: input.partyId ?? null,
      total: built.columns.total,
      data: built.columns.data,
      lines: built.lineRows,
      tracked: built.tracked,
      payments: input.payments,
      confirm: input.confirm,
      restock: input.restock,
    });
  const salesmanId = await resolveSalesman(tx, scope, input.salesmanId);
  const number =
    input.number ??
    (await allocateNumber(tx, orgId, input.businessId, input.invoiceType, input.invoiceDate));
  let [row] = await tx
    .insert(invoices)
    .values({
      ...built.columns,
      orgId,
      number,
      status: 'unpaid',
      salesmanId,
      generatedFromId: extra.generatedFromId ?? null,
    })
    .returning();
  const lines = await tx
    .insert(invoiceLines)
    .values(built.lineRows.map((l) => ({ ...l, orgId, invoiceId: row.id })))
    .returning();
  const lineIds = lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity }));
  await syncStock(
    tx,
    orgId,
    row.id,
    row.invoiceType,
    row.status,
    lineIds,
    built.tracked,
    INVOICE_TYPES[row.invoiceType]?.prefix === 'CN' ? 'sale_return' : 'sale',
  );
  if (input.payments.length) {
    await writeInlinePayments(tx, orgId, row, input.payments);
    [row] = await tx.select().from(invoices).where(eq(invoices.id, row.id));
  }
  if (row.invoiceType === 'credit-note') await writeRefund(tx, orgId, row, input.refund);
  // Phase 4: with the ledger on, the sale and the money taken with it are posted in this same transaction.
  await syncLedger(tx, orgId, 'invoice', row.id);
  await audit(tx, orgId, 'invoice.create', 'invoice', row.id, {
    after: { number, total: row.total, ...(salesmanId ? { salesmanId } : {}) },
  });
  return { row, lines };
}

/** P2-S6: an order's per-line progress from the invoices converted from it. */
async function progressOf(tx: Tx, order: InvoiceRow, lines: LineRow[]) {
  const made = await tx
    .select()
    .from(invoices)
    .where(and(isNull(invoices.deletedAt), sql`${invoices.data}->>'sourceOrderId' = ${order.id}`))
    .orderBy(invoices.createdAt);
  const withLines = [];
  for (const inv of made) {
    const { lines: l } = await loadInvoice(tx, inv.id);
    withLines.push({ status: inv.status, lines: asLineInputs(l) });
  }
  const p = saleOrderProgress(asLineInputs(lines), withLines, order.status === 'cancelled');
  return {
    status: p.status as 'open' | 'partially-invoiced' | 'closed' | 'cancelled',
    lines: p.lines.map((l) => ({ ...l, name: String(l.name ?? '') })),
    invoices: made.map((i) => ({ id: i.id, number: i.number, status: i.status })),
  };
}

/** The editor sends back all inline payment rows on save; left out, the saved ones stay as they are. */
const invoiceUpdate = invoiceInput
  .omit({ number: true })
  .extend({ payments: invoiceInput.shape.payments.removeDefault().optional() });

export function invoicesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/invoices',
    tag: 'Invoices',
    summary: 'List invoices, newest first',
    query: pageQuery.extend(invoiceListQuery.shape).extend(invoiceListSalesman.shape),
    response: page(invoiceSummary),
    handler: async ({ tx, query, auth }) => {
      // P2-S1: a Salesman member sees only invoices credited to them.
      const scope = await salesmanScope(tx, auth);
      const where = and(
        query.status ? eq(invoices.status, query.status) : undefined,
        query.type ? eq(invoices.invoiceType, query.type) : undefined,
        query.partyId ? eq(invoices.partyId, query.partyId) : undefined,
        query.from ? gte(invoices.invoiceDate, query.from) : undefined,
        query.to ? lte(invoices.invoiceDate, query.to) : undefined,
        query.salesmanId ? eq(invoices.salesmanId, query.salesmanId) : undefined,
        scope ? inArray(invoices.salesmanId, scope) : undefined,
      );
      const res = await listPage(tx, invoices, {
        ...query,
        where,
        searchColumns: [invoices.number],
      });
      const names = await partyNames(
        tx,
        res.data.map((r) => r.partyId),
      );
      return {
        data: res.data.map((r) => toSummary(r, r.partyId ? (names.get(r.partyId) ?? null) : null)),
        nextCursor: res.nextCursor,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/invoices/:id',
    tag: 'Invoices',
    summary: 'One invoice with its lines and payments',
    params: idParam,
    response: invoice,
    handler: async ({ tx, params, auth }) => {
      const { row, lines } = await loadInvoice(tx, params.id);
      assertInScope(await salesmanScope(tx, auth), row);
      return toInvoice(tx, row, lines);
    },
  });

  route({
    method: 'post',
    path: '/v1/invoices',
    tag: 'Invoices',
    summary:
      'Create an invoice: numbers it, computes GST, moves stock, records payments received with it',
    body: invoiceInput,
    response: invoice,
    status: 201,
    handler: async ({ tx, orgId, body, auth }) => {
      const { row, lines } = await createInvoice(tx, orgId, body, { auth });
      return toInvoice(tx, row, lines);
    },
  });

  route({
    method: 'put',
    path: '/v1/invoices/:id',
    tag: 'Invoices',
    summary: 'Edit an invoice (the number stays; totals, stock and inline payments are redone)',
    params: idParam,
    body: invoiceUpdate,
    response: invoice,
    handler: async ({ tx, orgId, params, body: raw, auth }) => {
      const scope = await salesmanScope(tx, auth);
      const { row: before } = await loadInvoice(tx, params.id);
      assertInScope(scope, before);
      if (before.status === 'cancelled')
        throw new AppError('unprocessable', 'A cancelled invoice can not be edited');
      if (raw.businessId !== before.businessId)
        throw new AppError('unprocessable', 'An invoice can not move to another business');
      if (raw.invoiceType !== before.invoiceType)
        throw new AppError(
          'unprocessable',
          'The document type can not change; make a new document instead',
        );
      const keepPayments = raw.payments === undefined;
      let body: InvoiceInput = { ...raw, payments: raw.payments ?? [], number: before.number };
      if (!body.partyId && body.payments.length && SALES_INVOICE_TYPES.includes(body.invoiceType))
        body = { ...body, partyId: await walkInParty(tx, orgId) };
      body = await checkReturn(tx, body, params.id);
      const built = await build(tx, {
        ...body,
        sourceOrderId: (before.data as { sourceOrderId?: string }).sourceOrderId,
      });
      if (keepPayments) {
        if (built.columns.total + 0.005 < before.paidAmount)
          throw new AppError('unprocessable', 'The new total is below what has already been paid');
      }
      const { earlier } = await checkInlinePayments(tx, {
        invoiceType: body.invoiceType,
        total: built.columns.total,
        data: built.columns.data,
        invoiceId: params.id,
        rows: body.payments,
      });
      if (!keepPayments && built.columns.total + 0.005 < earlier)
        throw new AppError('unprocessable', 'The new total is below what has already been paid');
      await runGuards(tx, orgId, auth, {
        businessId: body.businessId,
        invoiceType: body.invoiceType,
        invoiceDate: body.invoiceDate,
        partyId: body.partyId ?? null,
        total: built.columns.total,
        data: built.columns.data,
        lines: built.lineRows,
        tracked: built.tracked,
        payments: body.payments,
        confirm: body.confirm,
        invoiceId: params.id,
        earlier: keepPayments ? before.paidAmount : earlier,
        restock: body.restock,
      });
      const salesmanId = await resolveSalesman(
        tx,
        scope,
        raw.salesmanId === undefined ? before.salesmanId : raw.salesmanId,
        before.salesmanId,
      );
      let [row] = await tx
        .update(invoices)
        .set({ ...built.columns, salesmanId, updatedAt: new Date() })
        .where(eq(invoices.id, params.id))
        .returning();
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, params.id));
      const lines = await tx
        .insert(invoiceLines)
        .values(built.lineRows.map((l) => ({ ...l, orgId, invoiceId: row.id })))
        .returning();
      if (!keepPayments) await writeInlinePayments(tx, orgId, row, body.payments);
      else await refreshInvoices(tx, [row.id]);
      [row] = await tx.select().from(invoices).where(eq(invoices.id, row.id));
      await syncStock(
        tx,
        orgId,
        row.id,
        row.invoiceType,
        row.status,
        lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        built.tracked,
        'edit',
      );
      if (row.invoiceType === 'credit-note') await writeRefund(tx, orgId, row, body.refund);
      await syncLedger(tx, orgId, 'invoice', row.id);
      await audit(tx, orgId, 'invoice.update', 'invoice', row.id, {
        before: { total: before.total },
        after: { total: row.total },
      });
      return toInvoice(tx, row, lines);
    },
  });

  route({
    method: 'post',
    path: '/v1/invoices/:id/cancel',
    tag: 'Invoices',
    summary:
      'Cancel an invoice: keeps the number, puts stock back, reverses its own payments (replaces delete)',
    params: idParam,
    body: cancelInvoiceInput,
    response: invoice,
    handler: async ({ tx, orgId, params, body, auth }) => {
      const { row: before, lines } = await loadInvoice(tx, params.id);
      assertInScope(await salesmanScope(tx, auth), before);
      if (before.status === 'cancelled')
        throw new AppError('already_cancelled', 'This invoice is already cancelled');
      // Separate receipts need the user's go-ahead (their money becomes party credit); the invoice's own inline
      // payments and refunds are simply reversed with it.
      const allocs = await receiptAllocations(tx, params.id);
      if (allocs.length && !body.releasePayments) {
        throw new AppError(
          'credit_dependency',
          'Payments are applied to this invoice. Cancelling it returns that money to the party as credit.',
          {
            allocations: allocs.map((a) => ({ paymentId: a.paymentId, amount: a.amount })),
          },
        );
      }
      await writeInlinePayments(tx, orgId, before, [], { soft: true });
      await writeRefund(tx, orgId, before, null, { soft: true });
      if (allocs.length)
        await tx
          .delete(paymentAllocations)
          .where(
            and(eq(paymentAllocations.invoiceId, params.id), isNull(paymentAllocations.deletedAt)),
          );
      const itemIds = lines.map((l) => l.itemId).filter((x): x is string => !!x);
      const known = itemIds.length
        ? await tx
            .select({ id: items.id, trackStock: items.trackStock })
            .from(items)
            .where(inArray(items.id, itemIds))
        : [];
      await syncStock(
        tx,
        orgId,
        params.id,
        before.invoiceType,
        'cancelled',
        lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        new Set(known.filter((k) => k.trackStock).map((k) => k.id)),
        'cancel',
      );
      const data = { ...(before.data as object), cancelReason: body.reason };
      const [row] = await tx
        .update(invoices)
        .set({
          status: 'cancelled',
          paidAmount: 0,
          cancelledAt: new Date().toISOString().slice(0, 10),
          data,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, params.id))
        .returning();
      await syncLedger(tx, orgId, 'invoice', row.id);
      await audit(tx, orgId, 'invoice.cancel', 'invoice', row.id, {
        before: { status: before.status },
        after: { reason: body.reason, releasedPayments: allocs.length },
      });
      return toInvoice(tx, row, lines);
    },
  });

  route({
    method: 'get',
    path: '/v1/invoices/:id/returnable',
    tag: 'Invoices',
    summary: 'What a credit note against this invoice may still return, per line (and its charges)',
    params: idParam,
    response: returnableResponse,
    handler: async ({ tx, params, auth }) => {
      const { row, lines } = await loadInvoice(tx, params.id);
      assertInScope(await salesmanScope(tx, auth), row);
      const left = returnableQty(asLineInputs(lines), await priorCreditNotes(tx, row.id));
      const sold: Record<string, { name: string; qty: number }> = {};
      for (const l of lines) {
        const key = l.itemId ? `id:${l.itemId}` : `nm:${l.name.trim().toLowerCase()}`;
        const s = (sold[key] ??= { name: l.name, qty: 0 });
        s.qty += l.quantity;
      }
      return {
        invoiceId: row.id,
        lines: Object.entries(sold).map(([key, s]) => ({
          key,
          name: s.name,
          sold: s.qty,
          returnable: left[key] ?? 0,
        })),
        charges: ((row.data as { charges?: unknown[] }).charges ?? []) as never,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/invoices/:id/progress',
    tag: 'Invoices',
    summary: 'A sale order: ordered, invoiced and pending per line, and its status',
    params: idParam,
    response: orderProgress,
    handler: async ({ tx, params, auth }) => {
      const { row, lines } = await loadInvoice(tx, params.id);
      assertInScope(await salesmanScope(tx, auth), row);
      if (row.invoiceType !== 'sales-order')
        throw new AppError('unprocessable', 'Only a sale order has progress');
      return progressOf(tx, row, lines);
    },
  });

  route({
    method: 'post',
    path: '/v1/invoices/:id/convert',
    tag: 'Invoices',
    summary: 'Invoice part or all of a sale order; its advance is applied to the new invoice',
    params: idParam,
    body: convertOrderInput,
    response: invoice,
    status: 201,
    handler: async ({ tx, orgId, params, body, auth }) => {
      const { row: order, lines } = await loadInvoice(tx, params.id);
      assertInScope(await salesmanScope(tx, auth), order);
      if (order.invoiceType !== 'sales-order')
        throw new AppError('unprocessable', 'Only a sale order can be converted this way');
      if (order.status === 'cancelled')
        throw new AppError('unprocessable', 'This sale order is cancelled');
      const before = await progressOf(tx, order, lines);
      const want = new Map((body.lines ?? []).map((l) => [l.position, l.quantity]));
      const picked = lines
        .map((l, i) => {
          const pending = before.lines[i]?.pending ?? 0;
          const q = body.lines ? (want.get(i) ?? 0) : pending;
          if (q > pending + 1e-9)
            throw new AppError('unprocessable', `Only ${pending} of ${l.name} is left to invoice`, [
              { path: `lines.${i}`, message: `At most ${pending}` },
            ]);
          return { l, q };
        })
        .filter((x) => x.q > 0);
      if (!picked.length)
        throw new AppError('unprocessable', 'Nothing left to invoice on this order');
      const d = order.data as {
        options?: InvoiceInput['options'];
        taxInclusive?: boolean;
        terms?: string;
        notes?: string;
      };
      const { row, lines: made } = await createInvoice(
        tx,
        orgId,
        {
          businessId: order.businessId,
          partyId: order.partyId,
          invoiceType: body.invoiceType,
          invoiceDate: body.invoiceDate,
          dueDate: null,
          placeOfSupply: order.placeOfSupply,
          taxInclusive: !!d.taxInclusive,
          items: picked.map(({ l, q }) => ({ ...toLine(l), quantity: q })),
          options: d.options ?? {},
          terms: d.terms ?? '',
          notes: d.notes ?? '',
          salesmanId: order.salesmanId,
          payments: body.payments,
        },
        { auth, sourceOrderId: order.id },
      );
      // The order's advance pays the new invoice first.
      const advances = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.invoiceId, order.id),
            eq(payments.source, 'invoice_inline'),
            isNull(payments.deletedAt),
          ),
        )
        .orderBy(payments.createdAt);
      let due = Math.round((dueOf(row) - row.paidAmount) * 100) / 100;
      for (const p of advances) {
        if (due <= 0) break;
        const [used] = await tx
          .select({ v: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::float8` })
          .from(paymentAllocations)
          .where(and(eq(paymentAllocations.paymentId, p.id), isNull(paymentAllocations.deletedAt)));
        const take = Math.round(Math.min(p.amount - used.v, due) * 100) / 100;
        if (take <= 0) continue;
        await tx
          .insert(paymentAllocations)
          .values({ orgId, paymentId: p.id, invoiceId: row.id, amount: take });
        due = Math.round((due - take) * 100) / 100;
      }
      await refreshInvoices(tx, [row.id]);
      const after = await progressOf(tx, order, lines);
      await tx
        .update(invoices)
        .set({
          data: { ...(order.data as object), orderStatus: after.status },
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, order.id));
      await audit(tx, orgId, 'invoice.convert', 'invoice', order.id, {
        after: { invoiceId: row.id, number: row.number, status: after.status },
      });
      const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, row.id));
      return toInvoice(tx, fresh, made);
    },
  });

  route({
    method: 'delete',
    path: '/v1/invoices/:id',
    tag: 'Invoices',
    summary: 'Trash a quotation or proforma. Tax documents are cancelled, never deleted',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const { row } = await loadInvoice(tx, params.id);
      if (!['quotation', 'sales-order', 'proforma'].includes(row.invoiceType)) {
        throw new AppError(
          'unprocessable',
          'Tax documents can not be deleted. Cancel the invoice instead (POST /v1/invoices/:id/cancel)',
        );
      }
      await tx.update(invoices).set({ deletedAt: new Date() }).where(eq(invoices.id, params.id));
      await audit(tx, orgId, 'invoice.delete', 'invoice', row.id, {
        before: { number: row.number },
      });
      return { ok: true };
    },
  });

  // ---- number series ----
  route({
    method: 'get',
    path: '/v1/number-series',
    tag: 'Invoices',
    summary: 'Counters per business and document type',
    response: z.object({ data: z.array(numberSeriesRow) }),
    handler: async ({ tx }) => {
      const rows = await tx
        .select()
        .from(numberSeries)
        .where(isNull(numberSeries.deletedAt))
        .orderBy(numberSeries.counterKey);
      return {
        data: rows.map((r) => ({
          businessId: r.businessId,
          counterKey: r.counterKey,
          lastValue: r.lastValue,
        })),
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/number-series/next',
    tag: 'Invoices',
    summary: 'Preview the next number without using it',
    query: nextNumberQuery,
    response: z.object({ number: z.string() }),
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const prefix = INVOICE_TYPES[query.invoiceType]?.prefix ?? 'INV';
      const series = await seriesSettings(tx, query.businessId);
      const [row] = await tx
        .select()
        .from(numberSeries)
        .where(
          and(
            eq(numberSeries.businessId, query.businessId),
            eq(numberSeries.counterKey, counterKeyFor(prefix, series, '')),
          ),
        );
      const next = nextCounterValue(row?.lastValue ?? 0, startFor(query.invoiceType, series));
      return {
        number: formatDocNumber({
          settings: series,
          typePrefix: prefix,
          next,
          fyLabel: getFinancialYearLabel(),
        }),
      };
    },
  });

  route({
    method: 'put',
    path: '/v1/number-series',
    tag: 'Invoices',
    summary:
      'Set how a business numbers its documents (prefix, padding, start, financial-year label)',
    body: numberSeriesUpdate,
    response: z.object({ numberSettings: z.record(z.string(), z.unknown()) }),
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const merged = { ...DEFAULT_NUMBER_SETTINGS, ...body.numberSettings };
      await tx
        .insert(businessSettings)
        .values({ orgId, businessId: body.businessId, numberSettings: merged })
        .onConflictDoUpdate({
          target: [businessSettings.orgId, businessSettings.businessId],
          set: { numberSettings: merged, updatedAt: new Date() },
        });
      await audit(tx, orgId, 'numbering.update', 'business', body.businessId, { after: merged });
      return { numberSettings: merged };
    },
  });
}
