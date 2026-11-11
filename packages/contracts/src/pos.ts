import { z } from 'zod';
import { isoDate, uuid } from './common.ts';
import { chargeInput } from './invoices.ts';

// Vyapar parity P12 (Point of Sale). The sale itself is an invoice; these are the settings, the counter's lookups and
// the one call that saves a bill.

const PAY_MODES = ['cash', 'upi', 'card', 'bank', 'cheque', 'other'] as const;

export const posSettingsQuery = z.object({ businessId: uuid });
export const posSettings = z.object({
  billDiscount: z.boolean(),
  billTax: z.boolean(),
  freeQty: z.boolean(),
  loyalty: z.object({
    enabled: z.boolean(),
    earnPer100: z.number().min(0).max(1000),
    pointValue: z.number().min(0).max(1000),
    minBill: z.number().min(0),
    maxRedeemPercent: z.number().min(0).max(100),
  }),
  roundOff: z.enum(['nearest', 'up', 'down', 'none']),
  directQtyChange: z.boolean(),
  primaryAction: z.enum(['save-print', 'save-new']),
  pricing: z.enum(['without-tax', 'with-tax']),
  paymentModes: z.array(z.enum(PAY_MODES)).max(6),
  modeAccounts: z.record(z.string(), uuid),
  cashSaleDefault: z.boolean(),
  paper: z.enum(['80mm', '58mm', 'a4']),
  receiptFooter: z.string().max(300),
  allowNegativeStock: z.boolean(),
});
export type PosSettingsDto = z.infer<typeof posSettings>;
export const posSettingsInput = z.object({
  businessId: uuid,
  settings: posSettings
    .partial()
    .extend({ loyalty: posSettings.shape.loyalty.partial().optional() }),
});

export const posItemQuery = z.object({
  businessId: uuid,
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const posItem = z.object({
  id: uuid,
  name: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  hsn: z.string(),
  unit: z.string(),
  salePrice: z.number(),
  priceInclTax: z.boolean(),
  taxPercent: z.number(),
  cessPercent: z.number(),
  trackStock: z.boolean(),
  stock: z.number(),
  /** The search matched the barcode or item code exactly: a scan, to add straight away. */
  exact: z.boolean(),
});
export const posItems = z.object({ data: z.array(posItem) });

export const posCustomerQuery = z.object({
  businessId: uuid,
  q: z.string().trim().max(100).default(''),
});
export const posCustomer = z.object({
  id: uuid,
  name: z.string(),
  phone: z.string().nullable(),
  state: z.string().nullable(),
  gstin: z.string().nullable(),
  points: z.number(),
  /** What the customer owes now (from open invoices). */
  due: z.number(),
});
export const posCustomers = z.object({ data: z.array(posCustomer) });

export const posSaleInput = z.object({
  businessId: uuid,
  partyId: uuid.nullish(),
  invoiceDate: isoDate.optional(),
  lines: z
    .array(
      z.object({
        itemId: uuid.nullish(),
        name: z.string().trim().min(1).max(300),
        hsn: z.string().max(10).default(''),
        unit: z.string().max(10).default('PCS'),
        quantity: z.number().positive(),
        freeQty: z.number().min(0).default(0),
        rate: z.number().min(0),
        discount: z.number().min(0).default(0),
        discountType: z.enum(['amount', 'percent']).default('amount'),
        taxPercent: z.number().min(0).max(100).default(0),
        cessPercent: z.number().min(0).max(100).default(0),
      }),
    )
    .min(1, 'Add at least one item')
    .max(200),
  billDiscount: z
    .object({ type: z.enum(['amount', 'percent']), value: z.number().min(0) })
    .nullish(),
  billTaxPercent: z.number().min(0).max(100).nullish(),
  charges: z.array(chargeInput).max(10).default([]),
  redeemPoints: z.number().min(0).default(0),
  tenders: z
    .array(
      z.object({
        mode: z.enum(PAY_MODES),
        amount: z.number().positive(),
        accountId: uuid.nullish(),
        reference: z.string().max(80).default(''),
      }),
    )
    .max(6)
    .default([]),
  remarks: z.string().max(1000).default(''),
  salesmanId: uuid.nullish(),
  /** The guards' answers (negative stock, credit limit, §269ST), as on an invoice. */
  confirm: z.record(z.string(), z.unknown()).default({}),
  /** A retried save of the same bill (the counter lost its connection) returns the bill saved the first time. */
  clientKey: z.string().min(8).max(64).optional(),
});
export type PosSaleInput = z.infer<typeof posSaleInput>;

export const posSaleResult = z.object({
  invoiceId: uuid,
  number: z.string(),
  total: z.number(),
  paid: z.number(),
  change: z.number(),
  credit: z.number(),
  pointsEarned: z.number(),
  pointsBalance: z.number(),
  replayed: z.boolean(),
});
