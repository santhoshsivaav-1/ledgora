import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';

export const INVOICE_TYPES = [
  'tax-invoice',
  'quotation',
  'sales-order',
  'proforma',
  'bill-of-supply',
  'composition',
  'credit-note',
  'delivery-challan',
] as const;
export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'cancelled'] as const;

export const invoiceLineInput = z.object({
  itemId: uuid.nullish(),
  name: z.string().trim().min(1).max(300),
  description: z.string().max(1000).default(''),
  hsn: z.string().max(10).default(''),
  unit: z.string().max(10).default('PCS'),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  discount: z.number().min(0).default(0),
  discountType: z.enum(['amount', 'percent']).default('amount'),
  taxPercent: z.number().min(0).max(100).default(0),
  cessPercent: z.number().min(0).max(100).default(0),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>;

export const invoiceOptions = z
  .object({
    reverseCharge: z.boolean(),
    showRoundOff: z.boolean(),
    showTDS: z.boolean(),
    tdsRate: z.number(),
    showTCS: z.boolean(),
    tcsRate: z.number(),
    currency: z.string(),
  })
  .partial();

export const invoiceInput = z.object({
  businessId: uuid,
  partyId: uuid.nullish(),
  invoiceType: z.enum(INVOICE_TYPES).default('tax-invoice'),
  invoiceDate: isoDate,
  dueDate: isoDate.nullish(),
  placeOfSupply: z.string().max(100).default(''),
  taxInclusive: z.boolean().default(false),
  items: z.array(invoiceLineInput).min(1, 'Add at least one line'),
  options: invoiceOptions.default({}),
  terms: z.string().max(5000).default(''),
  notes: z.string().max(2000).default(''),
  /** Fill only when migrating or re-issuing: otherwise the number comes from the series. */
  number: z.string().trim().min(1).max(40).optional(),
});
export type InvoiceInput = z.infer<typeof invoiceInput>;

export const invoiceTotals = z.object({
  subtotal: z.number(),
  taxableAmount: z.number(),
  cgst: z.number(),
  sgst: z.number(),
  igst: z.number(),
  cess: z.number(),
  totalTax: z.number(),
  total: z.number(),
});

export const invoiceLine = invoiceLineInput.extend({
  id: uuid,
  taxableAmount: z.number(),
  taxAmount: z.number(),
  lineTotal: z.number(),
});

export const invoiceSummary = invoiceTotals.extend({
  id: uuid,
  businessId: uuid,
  partyId: uuid.nullable(),
  partyName: z.string().nullable(),
  invoiceType: z.enum(INVOICE_TYPES),
  number: z.string(),
  invoiceDate: z.string(),
  dueDate: z.string().nullable(),
  status: z.enum(INVOICE_STATUSES),
  currency: z.string(),
  paidAmount: z.number(),
  ...withStamps,
});
export type InvoiceSummary = z.infer<typeof invoiceSummary>;

export const invoice = invoiceSummary.extend({
  placeOfSupply: z.string(),
  lines: z.array(invoiceLine),
  data: z.record(z.string(), z.unknown()),
});
export type Invoice = z.infer<typeof invoice>;

export const invoiceListQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  type: z.enum(INVOICE_TYPES).optional(),
  partyId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const cancelInvoiceInput = z.object({
  reason: z.string().max(300).default(''),
  /** Cancelling an invoice that has payments applied needs this: the money goes back to the party as credit. */
  releasePayments: z.boolean().default(false),
});

export const numberSeriesRow = z.object({
  businessId: uuid,
  counterKey: z.string(),
  lastValue: z.number().int(),
});
export const numberSeriesUpdate = z.object({
  businessId: uuid,
  numberSettings: z.record(z.string(), z.unknown()),
});
export const nextNumberQuery = z.object({
  businessId: uuid,
  invoiceType: z.enum(INVOICE_TYPES).default('tax-invoice'),
});
