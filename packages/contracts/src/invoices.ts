import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';
import { PAYMENT_MODES } from './payments.ts';

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
  /** Batch and serial numbers, for an item that tracks them (kept on the line's extra). */
  batchNo: z.string().trim().max(40).nullish(),
  expDate: isoDate.nullish(),
  mfgDate: isoDate.nullish(),
  serials: z.array(z.string().trim().min(1).max(60)).max(500).nullish(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>;

export const invoiceOptions = z
  .object({
    reverseCharge: z.boolean(),
    showRoundOff: z.boolean(),
    /** P2-S3: nearest (default), up or down. */
    roundOffMode: z.enum(['nearest', 'up', 'down']),
    showTDS: z.boolean(),
    tdsRate: z.number(),
    showTCS: z.boolean(),
    tcsRate: z.number(),
    currency: z.string(),
  })
  .partial();

// ---- Vyapar parity Phase 2 ---------------------------------------------------------------------------------------------

/** P2-S2: money received with the sale. Becomes a `payments` row (source invoice_inline) allocated to the invoice. */
export const inlinePayment = z.object({
  mode: z.enum(PAYMENT_MODES),
  accountId: uuid.nullish(),
  amount: z.number().positive(),
  reference: z.string().max(80).default(''),
  chequeDate: isoDate.nullish(),
});
export type InlinePayment = z.infer<typeof inlinePayment>;

/** P2-S3: an additional charge, a taxable supply at its own GST rate. `amount` is before tax. */
export const chargeInput = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(1).max(80),
  amount: z.number().min(0),
  gstRate: z.number().min(0).max(100).default(0),
  hsn: z.string().max(10).default(''),
  taxable: z.boolean().default(true),
});
export type ChargeInput = z.infer<typeof chargeInput>;

/**
 * P2-S4: answers to the save-time guards. A guard that only warns is passed by confirming it; `cashAcknowledgement`
 * must be typed for §269ST; `overrideReason` lets the owner save into a locked period (kept in the audit log).
 */
export const guardConfirmations = z
  .object({
    creditLimit: z.boolean(),
    negativeStock: z.boolean(),
    cashAcknowledgement: z.string().max(200),
    overrideReason: z.string().max(300),
  })
  .partial();

export const RETURN_REASONS = [
  'sales-return',
  'post-sale-discount',
  'deficiency-in-service',
  'correction',
  'others',
] as const;
/** P2-S6: how a credit note gives the money back. `adjust` leaves it on the party's balance. */
export const creditNoteRefund = z.object({
  mode: z.enum(['adjust', 'cash', 'bank']).default('adjust'),
  accountId: uuid.nullish(),
  reference: z.string().max(80).default(''),
});

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
  /** P2-S1: the salesman credited with the sale. */
  salesmanId: uuid.nullish(),
  /** P2-S2: payments received with the sale; Σ amount ≤ total (else 422 over_allocated). */
  payments: z.array(inlinePayment).max(6).default([]),
  /** P2-S3: additional charges. */
  charges: z.array(chargeInput).max(20).default([]),
  /** P2-S4 */
  confirm: guardConfirmations.default({}),
  /** P2-S6 credit note: the invoice it returns against, why, whether goods go back to stock, how money goes back. */
  againstInvoiceId: uuid.nullish(),
  returnReason: z.enum(RETURN_REASONS).nullish(),
  restock: z.boolean().default(true),
  refund: creditNoteRefund.nullish(),
  /** P2-S6 sale order. */
  expectedDeliveryDate: isoDate.nullish(),
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
  salesmanId: uuid.nullable(),
  ...withStamps,
});
export type InvoiceSummary = z.infer<typeof invoiceSummary>;

/** A payment applied to an invoice, as the editor's Payment block shows it. Receipts are read-only there. */
export const invoicePayment = z.object({
  paymentId: uuid,
  source: z.string(),
  mode: z.string(),
  accountId: uuid.nullable(),
  amount: z.number(),
  reference: z.string(),
  chequeDate: z.string().nullable(),
  paymentDate: z.string(),
  number: z.string(),
});

export const invoice = invoiceSummary.extend({
  placeOfSupply: z.string(),
  lines: z.array(invoiceLine),
  data: z.record(z.string(), z.unknown()),
  payments: z.array(invoicePayment),
});
export type Invoice = z.infer<typeof invoice>;

export const invoiceListQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  type: z.enum(INVOICE_TYPES).optional(),
  partyId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const invoiceListSalesman = z.object({ salesmanId: uuid.optional() });

/** P2-S6: what a credit note may still return per invoice line, keyed like returnableQty (id:… or nm:…). */
export const returnableResponse = z.object({
  invoiceId: uuid,
  lines: z.array(
    z.object({ key: z.string(), name: z.string(), sold: z.number(), returnable: z.number() }),
  ),
  /** The invoice's additional charges; a credit note returns them in proportion (proportionalCharges). */
  charges: z.array(chargeInput),
});

/** P2-S6: an order's progress and the partial conversion to an invoice. */
export const orderProgress = z.object({
  status: z.enum(['open', 'partially-invoiced', 'closed', 'cancelled']),
  lines: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      ordered: z.number(),
      invoiced: z.number(),
      pending: z.number(),
    }),
  ),
  invoices: z.array(z.object({ id: uuid, number: z.string(), status: z.string() })),
});
export const convertOrderInput = z.object({
  invoiceDate: isoDate,
  invoiceType: z.enum(['tax-invoice', 'bill-of-supply', 'composition']).default('tax-invoice'),
  /** Quantity per order line (by position). Left out = everything still pending. */
  lines: z
    .array(z.object({ position: z.number().int().min(0), quantity: z.number().min(0) }))
    .optional(),
  payments: z.array(inlinePayment).max(6).default([]),
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
