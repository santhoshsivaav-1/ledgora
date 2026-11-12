// Vyapar parity P6-S5, GST reports built from the document lines: GST Rate, HSN and SAC summaries, Sale and Purchase
// with GST (invoice by rate) and Form 27EQ (TCS on receipts). The GST split of a line follows its document: IGST when
// the document carries IGST, else CGST and SGST in halves. Credit and debit notes count negative when included.
import { and, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import { SALE_TYPES } from '@ledgora/tax-engine';
import { commonParams, defineReport } from './registry.ts';
import { fyStartOf, r2, today } from './shared.ts';
import { settingValue } from '../modules/settingsStore.ts';

const { invoices, invoiceLines, purchases, purchaseLines, parties, payments, paymentAllocations } =
  schema;
const flag = z.enum(['0', '1']).default('1');
const sideAll = z.enum(['sale', 'purchase', 'both']).default('sale');
const period = (p: { from?: string; to?: string }) => ({
  from: p.from ?? fyStartOf(p.to ?? today()),
  to: p.to ?? today(),
});
const sum = (rows: Record<string, unknown>[], k: string) =>
  r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));

/** One document line with its GST worked out and signed, ready to group. */
export interface GstLine {
  side: 'sale' | 'purchase';
  docId: string;
  docNo: string;
  date: string;
  partyId: string | null;
  partyName: string;
  gstin: string;
  pos: string;
  name: string;
  hsn: string;
  unit: string;
  qty: number;
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  itcStatus: string;
  refType: 'invoice' | 'purchase';
}

const split = (tax: number, interstate: boolean) =>
  interstate
    ? { cgst: 0, sgst: 0, igst: r2(tax) }
    : { cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), igst: 0 };

/** Sale lines of the period (credit notes negative when `notes`), cancelled documents left out. */
export async function saleGstLines(
  tx: Tx,
  businessId: string,
  from: string,
  to: string,
  notes: boolean,
) {
  const docs = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        isNull(invoices.deletedAt),
        ne(invoices.status, 'cancelled'),
        inArray(invoices.invoiceType, [...SALE_TYPES, ...(notes ? ['credit-note'] : [])]),
        gte(invoices.invoiceDate, from),
        lte(invoices.invoiceDate, to),
      ),
    );
  if (!docs.length) return [] as GstLine[];
  const people = new Map(
    (
      await tx
        .select({ id: parties.id, name: parties.name, gstin: parties.gstin })
        .from(parties)
        .where(
          inArray(
            parties.id,
            [...new Set(docs.map((d) => d.partyId).filter((x): x is string => !!x))].concat(
              '00000000-0000-0000-0000-000000000000',
            ),
          ),
        )
    ).map((x) => [x.id, x]),
  );
  const byId = new Map(docs.map((d) => [d.id, d]));
  const lines = await tx
    .select()
    .from(invoiceLines)
    .where(
      and(
        inArray(
          invoiceLines.invoiceId,
          docs.map((d) => d.id),
        ),
        isNull(invoiceLines.deletedAt),
      ),
    );
  return lines.map((l): GstLine => {
    const d = byId.get(l.invoiceId)!;
    const sg = d.invoiceType === 'credit-note' ? -1 : 1;
    const who = d.partyId ? people.get(d.partyId) : undefined;
    const s = split(sg * l.taxAmount, d.igst > 0);
    return {
      side: 'sale',
      docId: d.id,
      docNo: d.number,
      date: d.invoiceDate,
      partyId: d.partyId,
      partyName: who?.name ?? '',
      gstin: who?.gstin ?? '',
      pos: d.placeOfSupply,
      name: l.name,
      hsn: l.hsn,
      unit: l.unit,
      qty: sg * l.quantity,
      rate: l.taxPercent,
      taxable: r2(sg * l.taxableAmount),
      ...s,
      cess: r2((sg * l.taxableAmount * l.cessPercent) / 100),
      itcStatus: '',
      refType: 'invoice',
    };
  });
}

/** Purchase lines of the period (debit notes negative when `notes`). */
export async function purchaseGstLines(
  tx: Tx,
  businessId: string,
  from: string,
  to: string,
  notes: boolean,
) {
  const docs = await tx
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.businessId, businessId),
        isNull(purchases.deletedAt),
        inArray(purchases.docType, notes ? ['bill', 'debit-note'] : ['bill']),
        gte(purchases.purchaseDate, from),
        lte(purchases.purchaseDate, to),
      ),
    );
  if (!docs.length) return [] as GstLine[];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const lines = await tx
    .select()
    .from(purchaseLines)
    .where(
      and(
        inArray(
          purchaseLines.purchaseId,
          docs.map((d) => d.id),
        ),
        isNull(purchaseLines.deletedAt),
      ),
    );
  return lines.map((l): GstLine => {
    const d = byId.get(l.purchaseId)!;
    const sg = d.docType === 'debit-note' ? -1 : 1;
    const s = split(sg * l.taxAmount, d.interstate);
    return {
      side: 'purchase',
      docId: d.id,
      docNo: d.invoiceNumber || d.number,
      date: d.purchaseDate,
      partyId: d.supplierId,
      partyName: d.supplierName,
      gstin: d.supplierGstin,
      pos: d.placeOfSupply,
      name: l.name,
      hsn: l.hsn,
      unit: 'NOS',
      qty: sg * l.quantity,
      rate: l.taxPercent,
      taxable: r2(sg * l.taxableAmount),
      ...s,
      cess: r2((sg * l.taxableAmount * l.cessPercent) / 100),
      itcStatus: l.itcStatus,
      refType: 'purchase',
    };
  });
}

async function gstLines(
  tx: Tx,
  businessId: string,
  from: string,
  to: string,
  side: 'sale' | 'purchase' | 'both',
  notes: boolean,
) {
  return [
    ...(side !== 'purchase' ? await saleGstLines(tx, businessId, from, to, notes) : []),
    ...(side !== 'sale' ? await purchaseGstLines(tx, businessId, from, to, notes) : []),
  ];
}

/** Services carry a SAC, which starts with 99; goods an HSN. */
const isService = (hsn: string) => /^99/.test(hsn);

// ---- GST Rate Report ------------------------------------------------------------------------------------------------------

export const gstRate = defineReport({
  id: 'gst-rate',
  title: 'GST Rate Report',
  group: 'gst',
  description:
    'Taxable value and CGST, SGST, IGST and cess for each rate slab, for sales, purchases or both.',
  params: commonParams.extend({ side: sideAll, creditNotes: flag }),
  run: async (tx, p) => {
    const { from, to } = period(p);
    const by = new Map<
      string,
      {
        side: string;
        rate: number;
        taxable: number;
        cgst: number;
        sgst: number;
        igst: number;
        cess: number;
        docs: Set<string>;
      }
    >();
    for (const l of await gstLines(tx, p.businessId, from, to, p.side, p.creditNotes === '1')) {
      const k = `${l.side}|${l.rate}`;
      const v = by.get(k) ?? {
        side: l.side,
        rate: l.rate,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        docs: new Set<string>(),
      };
      v.taxable += l.taxable;
      v.cgst += l.cgst;
      v.sgst += l.sgst;
      v.igst += l.igst;
      v.cess += l.cess;
      v.docs.add(l.docId);
      by.set(k, v);
    }
    const rows = [...by.entries()]
      .map(([id, v]) => ({
        id,
        side: v.side === 'sale' ? 'Sale' : 'Purchase',
        rate: v.rate,
        taxable: r2(v.taxable),
        cgst: r2(v.cgst),
        sgst: r2(v.sgst),
        igst: r2(v.igst),
        cess: r2(v.cess),
        totalTax: r2(v.cgst + v.sgst + v.igst + v.cess),
        invoices: v.docs.size,
      }))
      .sort((a, b) => a.side.localeCompare(b.side) || a.rate - b.rate);
    return {
      rows,
      totals: {
        taxable: sum(rows, 'taxable'),
        cgst: sum(rows, 'cgst'),
        sgst: sum(rows, 'sgst'),
        igst: sum(rows, 'igst'),
        cess: sum(rows, 'cess'),
        totalTax: sum(rows, 'totalTax'),
      },
      meta: { from, to },
    };
  },
});

// ---- HSN and SAC summaries ------------------------------------------------------------------------------------------------

function summaryReport(id: string, title: string, description: string, services: boolean) {
  return defineReport({
    id,
    title,
    group: 'gst',
    description,
    params: commonParams.extend({
      side: z.enum(['sale', 'purchase']).default('sale'),
      digits: z.enum(['4', '6', '8']).default('8'),
      creditNotes: flag,
    }),
    run: async (tx, p) => {
      const { from, to } = period(p);
      const digits = Number(p.digits);
      const by = new Map<
        string,
        {
          code: string;
          desc: string;
          unit: string;
          rate: number;
          qty: number;
          taxable: number;
          cgst: number;
          sgst: number;
          igst: number;
          cess: number;
        }
      >();
      for (const l of await gstLines(tx, p.businessId, from, to, p.side, p.creditNotes === '1')) {
        if (isService(l.hsn) !== services) continue;
        const code = l.hsn ? l.hsn.slice(0, digits) : '';
        const k = `${code}|${l.unit}|${l.rate}`;
        const v = by.get(k) ?? {
          code,
          desc: l.name,
          unit: l.unit,
          rate: l.rate,
          qty: 0,
          taxable: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0,
        };
        v.qty += l.qty;
        v.taxable += l.taxable;
        v.cgst += l.cgst;
        v.sgst += l.sgst;
        v.igst += l.igst;
        v.cess += l.cess;
        by.set(k, v);
      }
      const rows = [...by.entries()]
        .map(([id2, v]) => ({
          id: id2,
          code: v.code || '(none)',
          description: v.desc,
          uqc: v.unit,
          qty: Math.round(v.qty * 1000) / 1000,
          taxable: r2(v.taxable),
          rate: v.rate,
          cgst: r2(v.cgst),
          sgst: r2(v.sgst),
          igst: r2(v.igst),
          cess: r2(v.cess),
          total: r2(v.taxable + v.cgst + v.sgst + v.igst + v.cess),
        }))
        .sort((a, b) => a.code.localeCompare(b.code) || a.rate - b.rate);
      return {
        rows,
        totals: {
          qty: sum(rows, 'qty'),
          taxable: sum(rows, 'taxable'),
          cgst: sum(rows, 'cgst'),
          sgst: sum(rows, 'sgst'),
          igst: sum(rows, 'igst'),
          cess: sum(rows, 'cess'),
          total: sum(rows, 'total'),
        },
        meta: { from, to, digits },
      };
    },
  });
}
export const hsnSummary = summaryReport(
  'hsn',
  'HSN Summary',
  'Goods by HSN code (4, 6 or 8 digits), unit and rate: quantity, taxable value and tax, as in GSTR-1 Table 12.',
  false,
);
export const sacReport = summaryReport(
  'sac',
  'SAC Report',
  'Services by SAC code and rate: taxable value and tax.',
  true,
);

// ---- Sale with GST and Purchase with GST -----------------------------------------------------------------------------------

function registerReport(id: string, title: string, description: string, side: 'sale' | 'purchase') {
  return defineReport({
    id,
    title,
    group: 'gst',
    description,
    params: commonParams.extend({ creditNotes: flag }),
    run: async (tx, p) => {
      const { from, to } = period(p);
      const by = new Map<
        string,
        {
          l: GstLine;
          taxable: number;
          cgst: number;
          sgst: number;
          igst: number;
          cess: number;
          itc: Set<string>;
        }
      >();
      for (const l of await gstLines(tx, p.businessId, from, to, side, p.creditNotes === '1')) {
        const k = `${l.docId}|${l.rate}`;
        const v = by.get(k) ?? {
          l,
          taxable: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0,
          itc: new Set<string>(),
        };
        v.taxable += l.taxable;
        v.cgst += l.cgst;
        v.sgst += l.sgst;
        v.igst += l.igst;
        v.cess += l.cess;
        if (l.itcStatus) v.itc.add(l.itcStatus);
        by.set(k, v);
      }
      const rows = [...by.entries()]
        .map(([id2, v]) => ({
          id: id2,
          refType: v.l.refType,
          refId: v.l.docId,
          date: v.l.date,
          number: v.l.docNo,
          party: v.l.partyName,
          gstin: v.l.gstin,
          pos: v.l.pos,
          rate: v.l.rate,
          taxable: r2(v.taxable),
          cgst: r2(v.cgst),
          sgst: r2(v.sgst),
          igst: r2(v.igst),
          cess: r2(v.cess),
          total: r2(v.taxable + v.cgst + v.sgst + v.igst + v.cess),
          ...(side === 'purchase' ? { itc: [...v.itc].join(', ') } : {}),
        }))
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || a.number.localeCompare(b.number) || a.rate - b.rate,
        );
      return {
        rows,
        totals: {
          taxable: sum(rows, 'taxable'),
          cgst: sum(rows, 'cgst'),
          sgst: sum(rows, 'sgst'),
          igst: sum(rows, 'igst'),
          cess: sum(rows, 'cess'),
          total: sum(rows, 'total'),
        },
        meta: { from, to },
      };
    },
  });
}
export const saleWithGst = registerReport(
  'sale-gst',
  'Sale with GST',
  'Invoice-wise register of sales: one row per invoice and rate with the GST split.',
  'sale',
);
export const purchaseWithGst = registerReport(
  'purchase-gst',
  'Purchase with GST',
  'Bill-wise register of purchases: one row per bill and rate with the GST split and the input-credit status.',
  'purchase',
);

// ---- Form 27EQ (TCS on receipts) ------------------------------------------------------------------------------------------

export const form27eq = defineReport({
  id: 'form-27eq',
  title: 'Form 27EQ (Beta)',
  group: 'gst',
  description:
    'TCS you collected, by the day the money was received (§206C collects on receipt): collectee PAN and name, nature, amount received, TCS and rate. A missing PAN is flagged (higher rate under §206CC). Beta until a CA has reviewed it; the file itself is not generated.',
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = period(p);
    // Settings > GST > Collector TAN, for the return's header ('' until the owner fills it in).
    const collectorTan = await settingValue(tx, p.businessId, 'gst.tan');
    const tcsOf = sql<number>`coalesce((${invoices.data}->'totals'->>'tcsAmount')::float8, 0)`;
    const docs = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, p.businessId),
          isNull(invoices.deletedAt),
          ne(invoices.status, 'cancelled'),
          inArray(invoices.invoiceType, [...SALE_TYPES]),
          sql`${tcsOf} > 0`,
        ),
      );
    if (!docs.length)
      return {
        rows: [],
        totals: { received: 0, tcs: 0, missingPan: 0 },
        meta: { from, to, beta: true, collectorTan },
      };
    const allocs = await tx
      .select({
        invoiceId: paymentAllocations.invoiceId,
        amount: paymentAllocations.amount,
        date: payments.paymentDate,
        payNo: payments.number,
        payId: payments.id,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(
        and(
          inArray(
            paymentAllocations.invoiceId,
            docs.map((d) => d.id),
          ),
          isNull(paymentAllocations.deletedAt),
          isNull(payments.deletedAt),
          gte(payments.paymentDate, from),
          lte(payments.paymentDate, to),
        ),
      );
    const byDoc = new Map(docs.map((d) => [d.id, d]));
    const people = new Map(
      (
        await tx
          .select()
          .from(parties)
          .where(
            inArray(
              parties.id,
              [...new Set(docs.map((d) => d.partyId).filter((x): x is string => !!x))].concat(
                '00000000-0000-0000-0000-000000000000',
              ),
            ),
          )
      ).map((x) => [x.id, x]),
    );
    const rows = allocs
      .map((a) => {
        const d = byDoc.get(a.invoiceId!)!;
        const tcsTotal =
          Number(((d.data ?? {}) as { totals?: { tcsAmount?: number } }).totals?.tcsAmount) || 0;
        const opts =
          ((d.data ?? {}) as { invoiceOptions?: { tcsSection?: string; tcsRate?: number } })
            .invoiceOptions ?? {};
        const who = d.partyId ? people.get(d.partyId) : undefined;
        const pan = (
          who?.pan ||
          (/^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(who?.gstin ?? '') ? who!.gstin!.slice(2, 12) : '')
        ).toUpperCase();
        const tcs = d.total > 0 ? r2((tcsTotal * a.amount) / d.total) : 0;
        return {
          id: `${a.payId}|${d.id}`,
          refType: 'payment',
          refId: a.payId,
          pan: pan || 'PANNOTAVBL',
          collectee: who?.name ?? '',
          nature: opts.tcsSection ? `§${opts.tcsSection}` : '§206C(1H) sale of goods',
          date: a.date,
          invoice: d.number,
          received: r2(a.amount),
          tcs,
          rate: opts.tcsRate ?? (d.total > 0 ? Math.round((tcsTotal / d.total) * 10000) / 100 : 0),
          challan: '',
          panMissing: !pan,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      rows,
      totals: {
        received: sum(rows, 'received'),
        tcs: sum(rows, 'tcs'),
        missingPan: rows.filter((r) => r.panMissing).length,
      },
      meta: { from, to, beta: true, collectorTan },
    };
  },
});

export const GST_REPORTS = [gstRate, hsnSummary, sacReport, saleWithGst, purchaseWithGst, form27eq];
