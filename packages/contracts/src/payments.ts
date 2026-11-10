import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';

export const PAYMENT_MODES = ['cash', 'upi', 'bank', 'cheque', 'card', 'other'] as const;

/**
 * Where part of a payment goes: a sale invoice (Payment In) or a purchase bill (Payment Out, Vyapar parity P3-S2).
 * Exactly one of the two.
 */
export const allocationInput = z
  .object({
    invoiceId: uuid.optional(),
    purchaseId: uuid.optional(),
    amount: z.number().positive(),
  })
  .refine((a) => !!a.invoiceId !== !!a.purchaseId, 'Name an invoice or a purchase bill, not both');
export type AllocationInput = z.infer<typeof allocationInput>;

/** TDS sections we deduct under on Payment Out (tax-engine TDS_DEDUCTION_SECTIONS). */
export const TDS_DEDUCTION_SECTION_VALUES = [
  '194C',
  '194J',
  '194H',
  '194I',
  '194Q',
  '194A',
] as const;

export const paymentInput = z.object({
  businessId: uuid,
  partyId: uuid,
  /** in = received from a customer (RCT-n); out = paid to a supplier (PAY-n). */
  direction: z.enum(['in', 'out']).default('in'),
  amount: z.number().positive(),
  mode: z.enum(PAYMENT_MODES).default('cash'),
  paymentDate: isoDate,
  reference: z.string().max(100).default(''),
  notes: z.string().max(500).default(''),
  // Vyapar parity P2-S5: what the payer settled besides money, and where the money went.
  /** Discount allowed at payment time; settles invoices like money. */
  discountAmount: z.number().min(0).default(0),
  /** In: TDS the payer deducted (claimable in 26AS). Out: TDS we deducted (payable to the government). Settles like money. */
  tdsAmount: z.number().min(0).default(0),
  /** Out: the section we deducted under, for the Form 26Q-style report (P6). */
  tdsSection: z.enum(TDS_DEDUCTION_SECTION_VALUES).nullish(),
  accountId: uuid.nullish(),
  chequeDate: isoDate.nullish(),
  /** Receipt number; left out = next in the RCT series. */
  number: z.string().trim().max(40).optional(),
  /** §269ST: the typed acknowledgement when cash from the party reaches ₹2,00,000 in a day. */
  cashAcknowledgement: z.string().max(200).optional(),
  /** Documents to settle, oldest first when `autoAllocate` is true and this is empty. */
  allocations: z.array(allocationInput).default([]),
  autoAllocate: z.boolean().default(false),
});
export type PaymentInput = z.infer<typeof paymentInput>;

export const payment = z.object({
  id: uuid,
  businessId: uuid,
  partyId: uuid,
  amount: z.number(),
  mode: z.enum(PAYMENT_MODES),
  paymentDate: z.string(),
  reference: z.string(),
  notes: z.string(),
  number: z.string(),
  direction: z.enum(['in', 'out']),
  source: z.string(),
  invoiceId: uuid.nullable(),
  accountId: uuid.nullable(),
  chequeDate: z.string().nullable(),
  discountAmount: z.number(),
  tdsAmount: z.number(),
  tdsSection: z.string().nullable(),
  /** Each names the invoice (Payment In) or the purchase bill (Payment Out) it settles; the other key is left out. */
  allocations: z.array(
    z.object({ invoiceId: uuid.optional(), purchaseId: uuid.optional(), amount: z.number() }),
  ),
  /** Part of the payment not applied to any invoice: the party's credit. */
  unallocated: z.number(),
  ...withStamps,
});
export type Payment = z.infer<typeof payment>;
export const paymentListQuery = z.object({
  partyId: uuid.optional(),
  direction: z.enum(['in', 'out']).optional(),
});
/** PUT /v1/payments/:id: the same fields; the allocations are replaced. */
export const paymentUpdate = paymentInput;
