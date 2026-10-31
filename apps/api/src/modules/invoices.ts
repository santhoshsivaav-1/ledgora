import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  cancelInvoiceInput,
  idParam,
  invoice,
  invoiceInput,
  invoiceListQuery,
  invoiceSummary,
  nextNumberQuery,
  numberSeriesRow,
  numberSeriesUpdate,
  okBody,
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
  paymentStatusFor,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';

const {
  invoices,
  invoiceLines,
  numberSeries,
  businessSettings,
  parties,
  items,
  stockMovements,
  paymentAllocations,
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

async function build(tx: Tx, input: InvoiceInput) {
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
  const tracked = new Set(known.filter((k) => k.trackStock).map((k) => k.id));

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

const dueOf = (r: Pick<InvoiceRow, 'total' | 'data'>) => {
  const tds = Number((r.data as { totals?: { tdsAmount?: number } }).totals?.tdsAmount) || 0;
  return Math.round((r.total - Math.min(Math.max(0, tds), r.total)) * 100) / 100;
};
export const statusFor = (r: Pick<InvoiceRow, 'total' | 'data'>, paid: number) =>
  paymentStatusFor({ totalAmount: r.total, data: r.data }, paid) as 'unpaid' | 'partial' | 'paid';
export { dueOf };

/** Creates an invoice with its lines, number, stock movements and audit row, all in the caller's transaction. */
export async function createInvoice(
  tx: Tx,
  orgId: string,
  input: InvoiceInput,
  extra: { generatedFromId?: string } = {},
) {
  const built = await build(tx, input);
  const number =
    input.number ??
    (await allocateNumber(tx, orgId, input.businessId, input.invoiceType, input.invoiceDate));
  const [row] = await tx
    .insert(invoices)
    .values({
      ...built.columns,
      orgId,
      number,
      status: 'unpaid',
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
  await audit(tx, orgId, 'invoice.create', 'invoice', row.id, {
    after: { number, total: row.total },
  });
  return { row, lines };
}

export function invoicesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/invoices',
    tag: 'Invoices',
    summary: 'List invoices, newest first',
    query: pageQuery.extend(invoiceListQuery.shape),
    response: page(invoiceSummary),
    handler: async ({ tx, query }) => {
      const where = and(
        query.status ? eq(invoices.status, query.status) : undefined,
        query.type ? eq(invoices.invoiceType, query.type) : undefined,
        query.partyId ? eq(invoices.partyId, query.partyId) : undefined,
        query.from ? gte(invoices.invoiceDate, query.from) : undefined,
        query.to ? lte(invoices.invoiceDate, query.to) : undefined,
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
    summary: 'One invoice with its lines',
    params: idParam,
    response: invoice,
    handler: async ({ tx, params }) => {
      const { row, lines } = await loadInvoice(tx, params.id);
      return toInvoice(tx, row, lines);
    },
  });

  route({
    method: 'post',
    path: '/v1/invoices',
    tag: 'Invoices',
    summary: 'Create an invoice: numbers it, computes GST, moves stock',
    body: invoiceInput,
    response: invoice,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      const { row, lines } = await createInvoice(tx, orgId, body);
      return toInvoice(tx, row, lines);
    },
  });

  route({
    method: 'put',
    path: '/v1/invoices/:id',
    tag: 'Invoices',
    summary: 'Edit an invoice (the number stays; totals and stock are redone)',
    params: idParam,
    body: invoiceInput.omit({ number: true }),
    response: invoice,
    handler: async ({ tx, orgId, params, body }) => {
      const { row: before } = await loadInvoice(tx, params.id);
      if (before.status === 'cancelled')
        throw new AppError('unprocessable', 'A cancelled invoice can not be edited');
      if (body.businessId !== before.businessId)
        throw new AppError('unprocessable', 'An invoice can not move to another business');
      if (body.invoiceType !== before.invoiceType)
        throw new AppError(
          'unprocessable',
          'The document type can not change; make a new document instead',
        );
      const built = await build(tx, { ...body, number: before.number });
      if (built.columns.total + 0.005 < before.paidAmount)
        throw new AppError('unprocessable', 'The new total is below what has already been paid');
      const status =
        before.paidAmount > 0
          ? statusFor({ total: built.columns.total, data: built.columns.data }, before.paidAmount)
          : 'unpaid';
      const [row] = await tx
        .update(invoices)
        .set({ ...built.columns, status, updatedAt: new Date() })
        .where(eq(invoices.id, params.id))
        .returning();
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, params.id));
      const lines = await tx
        .insert(invoiceLines)
        .values(built.lineRows.map((l) => ({ ...l, orgId, invoiceId: row.id })))
        .returning();
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
    summary: 'Cancel an invoice: keeps the number, puts stock back (replaces delete)',
    params: idParam,
    body: cancelInvoiceInput,
    response: invoice,
    handler: async ({ tx, orgId, params, body }) => {
      const { row: before, lines } = await loadInvoice(tx, params.id);
      if (before.status === 'cancelled')
        throw new AppError('already_cancelled', 'This invoice is already cancelled');
      const allocs = await tx
        .select()
        .from(paymentAllocations)
        .where(
          and(eq(paymentAllocations.invoiceId, params.id), isNull(paymentAllocations.deletedAt)),
        );
      if (allocs.length && !body.releasePayments) {
        throw new AppError(
          'credit_dependency',
          'Payments are applied to this invoice. Cancelling it returns that money to the party as credit.',
          {
            allocations: allocs.map((a) => ({ paymentId: a.paymentId, amount: a.amount })),
          },
        );
      }
      if (allocs.length)
        await tx.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, params.id));
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
      await audit(tx, orgId, 'invoice.cancel', 'invoice', row.id, {
        before: { status: before.status },
        after: { reason: body.reason, releasedPayments: allocs.length },
      });
      return toInvoice(tx, row, lines);
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
