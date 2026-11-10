import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';
import { chargeInput, inlinePayment } from './invoices.ts';

/** Vyapar parity P3-S1: how much of a line's GST is credit (tax-engine ITC_STATUSES). Missing = eligible. */
export const ITC_STATUS_VALUES = [
  'eligible',
  'capital_goods',
  'ineligible_17_5',
  'blocked',
  'exempt_supply_use',
] as const;
/** P3-S4 (tax-engine DEBIT_NOTE_REASONS). */
export const DEBIT_NOTE_REASON_VALUES = [
  'purchase-return',
  'rate-difference',
  'quality',
  'other',
] as const;
/** P3-S4: how the supplier settles a debit note. `adjust` lowers what we owe them. */
export const REFUND_MODE_VALUES = ['adjust', 'cash', 'bank'] as const;

export const purchaseLineInput = z.object({
  itemId: uuid.nullish(),
  name: z.string().trim().min(1).max(300),
  hsn: z.string().max(10).default(''),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  taxPercent: z.number().min(0).max(100).default(0),
  cessPercent: z.number().min(0).max(100).default(0),
  itcStatus: z.enum(ITC_STATUS_VALUES).default('eligible'),
});

export const purchaseInput = z
  .object({
    businessId: uuid,
    /** P3-S4: a debit note is a purchase document of its own kind; stock and ITC go the other way. */
    docType: z.enum(['bill', 'debit-note']).default('bill'),
    /** Our reference: PUR-n for a bill, DN-n for a debit note. Left out = the next in the series. */
    number: z.string().trim().max(40).optional(),
    supplierId: uuid.nullish(),
    supplierName: z.string().max(200).default(''),
    supplierGstin: z.string().max(15).default(''),
    supplierAddress: z.string().max(500).default(''),
    /** The supplier's bill number (the debit note's own number for a return). */
    invoiceNumber: z.string().max(60).default(''),
    purchaseDate: isoDate,
    dueDate: isoDate.nullish(),
    interstate: z.boolean().default(false),
    placeOfSupply: z.string().max(60).default(''),
    /** RCM: we pay the GST (GSTR-3B 3.1(d)) and claim it back as credit (4(A)(3)). */
    reverseCharge: z.boolean().default(false),
    paymentStatus: z.enum(['Unpaid', 'Partial', 'Paid']).default('Unpaid'),
    items: z.array(purchaseLineInput).min(1),
    charges: z.array(chargeInput).max(20).default([]),
    roundOff: z.boolean().default(false),
    /** §194Q: % we withhold from the supplier on goods bought above ₹50 lakh in the year (usually 0.1). */
    tds194QPercent: z.number().min(0).max(5).default(0),
    /** P3-S1: paid at the time of purchase (direction out). */
    payments: z.array(inlinePayment).max(6).default([]),
    fileId: uuid.nullish(),
    notes: z.string().max(1000).default(''),
    /** P3-S3: the purchase order this bill receives goods against. */
    poId: uuid.nullish(),
    /** P3-S4: the bill a debit note returns against (optional for old bills). */
    againstPurchaseId: uuid.nullish(),
    returnReason: z.enum(DEBIT_NOTE_REASON_VALUES).nullish(),
    refundMode: z.enum(REFUND_MODE_VALUES).default('adjust'),
    /** Save although the supplier's bill number is already on another bill this year. */
    allowDuplicate: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.docType === 'debit-note' && !v.returnReason)
      ctx.addIssue({
        code: 'custom',
        path: ['returnReason'],
        message: 'Pick why the goods go back',
      });
  });
export type PurchaseInput = z.infer<typeof purchaseInput>;

export const purchase = z.object({
  id: uuid,
  businessId: uuid,
  docType: z.enum(['bill', 'debit-note']),
  number: z.string(),
  supplierId: uuid.nullable(),
  supplierName: z.string(),
  supplierGstin: z.string(),
  supplierAddress: z.string(),
  invoiceNumber: z.string(),
  purchaseDate: z.string(),
  dueDate: z.string().nullable(),
  interstate: z.boolean(),
  placeOfSupply: z.string(),
  reverseCharge: z.boolean(),
  paymentStatus: z.string(),
  taxableAmount: z.number(),
  cgst: z.number(),
  sgst: z.number(),
  igst: z.number(),
  cess: z.number(),
  total: z.number(),
  tdsAmount: z.number(),
  paidAmount: z.number(),
  charges: z.array(chargeInput),
  /** Credit by bucket (tax-engine itcSplit), for GSTR-3B Table 4. */
  itc: z.object({
    eligible: z.object({ igst: z.number(), cgst: z.number(), sgst: z.number(), cess: z.number() }),
    ineligible: z.object({
      igst: z.number(),
      cgst: z.number(),
      sgst: z.number(),
      cess: z.number(),
    }),
  }),
  poId: uuid.nullable(),
  againstPurchaseId: uuid.nullable(),
  returnReason: z.string().nullable(),
  refundMode: z.string(),
  fileId: uuid.nullable(),
  notes: z.string(),
  /** Set when another bill of this supplier has the same bill number this year (saved anyway). */
  duplicateOf: uuid.nullable(),
  items: z.array(
    purchaseLineInput.extend({
      taxableAmount: z.number(),
      taxAmount: z.number(),
      lineTotal: z.number(),
      /** Cost per unit once charges are spread over the goods (and lost credit added): what stock comes in at. */
      landedCost: z.number(),
    }),
  ),
  ...withStamps,
});
export type Purchase = z.infer<typeof purchase>;
export const purchaseListQuery = z.object({
  docType: z.enum(['bill', 'debit-note']).optional(),
  supplierId: uuid.optional(),
});

/** GET /v1/purchases/duplicate-check: is this supplier bill number already on a bill this year? */
export const duplicateBillQuery = z.object({
  supplierId: uuid.optional(),
  supplierGstin: z.string().max(15).optional(),
  supplierName: z.string().max(200).optional(),
  billNo: z.string().max(60),
  date: isoDate,
  excludeId: uuid.optional(),
});
export const duplicateBillResult = z.object({
  duplicate: z
    .object({ id: uuid, number: z.string(), invoiceNumber: z.string(), purchaseDate: z.string() })
    .nullable(),
});

/** GET /v1/purchases/:id/returnable: per bill line, what is left to return (P3-S4). */
export const returnableResult = z.object({
  lines: z.array(
    z.object({
      itemId: uuid.nullable(),
      name: z.string(),
      billed: z.number(),
      returned: z.number(),
      returnable: z.number(),
      rate: z.number(),
      taxPercent: z.number(),
    }),
  ),
});

/** GET /v1/suppliers/:id/statement (P3 acceptance 3): bills − payments − debit notes. */
export const supplierStatement = z.object({
  documents: z.number(),
  settled: z.number(),
  returns: z.number(),
  balance: z.number(),
});

// ---- P3-S3 purchase orders ------------------------------------------------------------------------------------------

export const purchaseOrderLineInput = purchaseLineInput.omit({ itcStatus: true });

export const purchaseOrderInput = z.object({
  businessId: uuid,
  /** PO-n; left out = the next in the series. */
  number: z.string().trim().max(40).optional(),
  supplierId: uuid.nullish(),
  supplierName: z.string().max(200).default(''),
  supplierGstin: z.string().max(15).default(''),
  orderDate: isoDate,
  expectedDate: isoDate.nullish(),
  interstate: z.boolean().default(false),
  items: z.array(purchaseOrderLineInput).min(1),
  charges: z.array(chargeInput).max(20).default([]),
  notes: z.string().max(1000).default(''),
  /** Advance paid with the order: a Payment Out (source po_advance) left unallocated until the bill. */
  advance: inlinePayment.nullish(),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInput>;

export const purchaseOrder = z.object({
  id: uuid,
  businessId: uuid,
  number: z.string(),
  supplierId: uuid.nullable(),
  supplierName: z.string(),
  supplierGstin: z.string(),
  orderDate: z.string(),
  expectedDate: z.string().nullable(),
  interstate: z.boolean(),
  status: z.enum(['open', 'partial', 'received', 'cancelled']),
  taxableAmount: z.number(),
  total: z.number(),
  advance: z.number(),
  /** Value of what is still to be received, before tax. */
  pendingValue: z.number(),
  charges: z.array(chargeInput),
  notes: z.string(),
  items: z.array(
    purchaseOrderLineInput.extend({ receivedQty: z.number(), pendingQty: z.number() }),
  ),
  ...withStamps,
});
export type PurchaseOrder = z.infer<typeof purchaseOrder>;

/** POST /v1/purchase-orders/:id/convert: receive some or all of the pending goods on a purchase bill. */
export const purchaseOrderConvert = z.object({
  purchaseDate: isoDate,
  /** The supplier's bill number. */
  invoiceNumber: z.string().max(60).default(''),
  lines: z
    .array(
      z.object({
        itemId: uuid.nullish(),
        name: z.string().min(1),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
  allowDuplicate: z.boolean().default(false),
});

// ---- P3-S5 / P3-S6 expenses and other income ----------------------------------------------------------------------

export const expenseLineInput = z.object({
  expenseItemId: uuid.nullish(),
  name: z.string().trim().min(1).max(200),
  sac: z.string().max(10).default(''),
  quantity: z.number().positive().default(1),
  rate: z.number().min(0),
  gstRate: z.number().min(0).max(100).default(0),
});

export const expenseInput = z.object({
  businessId: uuid,
  /** `income` is Other Income (P3-S6): same record, money coming in. */
  kind: z.enum(['expense', 'income']).default('expense'),
  /** EXP-n / INC-n; left out = the next in the series. */
  number: z.string().trim().max(40).optional(),
  categoryId: uuid.nullish(),
  expenseDate: isoDate,
  description: z.string().max(300).default(''),
  vendor: z.string().max(200).default(''),
  /** The party paid (or, for income, the payer): enables TDS and the supplier statement. */
  payeePartyId: uuid.nullish(),
  /** Before GST. Worked out from `items` when there are any. */
  amount: z.number().positive(),
  /** GST paid (expense) or charged (income). Worked out from `items` when there are any. */
  taxAmount: z.number().min(0).default(0),
  interstate: z.boolean().default(false),
  /** Expense: GST counts as input tax credit. Left out it does (as every expense saved before Phase 3 did). */
  itcEligible: z.boolean().default(true),
  /** Income: exempt (agricultural income, for example), kept out of GST. */
  exempt: z.boolean().default(false),
  items: z.array(expenseLineInput).max(100).default([]),
  paymentMode: z.string().max(20).default('cash'),
  accountId: uuid.nullish(),
  /** Paid now (expense) or received now (income); left out = all of it. Less than the total = on credit. */
  paidAmount: z.number().min(0).nullish(),
  fileId: uuid.nullish(),
});
export type ExpenseInput = z.infer<typeof expenseInput>;
export const expense = expenseInput.extend({
  id: uuid,
  number: z.string(),
  total: z.number(),
  paidAmount: z.number(),
  ...withStamps,
});
export const expenseListQuery = z.object({ kind: z.enum(['expense', 'income']).optional() });

export const expenseCategoryInput = z.object({
  name: z.string().trim().min(1).max(100),
  parentId: uuid.nullish(),
  /** direct / indirect place an expense in the P&L; income is an Other Income category. */
  kind: z.enum(['direct', 'indirect', 'income']).default('indirect'),
});
export const expenseCategory = z.object({
  id: uuid,
  name: z.string(),
  parentId: uuid.nullable(),
  kind: z.string(),
  isSystem: z.boolean(),
});

export const expenseItemInput = z.object({
  name: z.string().trim().min(1).max(200),
  sac: z.string().max(10).default(''),
  defaultRate: z.number().min(0).default(0),
  gstRate: z.number().min(0).max(100).default(0),
  defaultCategoryId: uuid.nullish(),
});
export const expenseItem = expenseItemInput.extend({ id: uuid, ...withStamps });
