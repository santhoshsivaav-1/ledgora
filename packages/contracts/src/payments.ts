import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';

export const PAYMENT_MODES = ['cash', 'upi', 'bank', 'cheque', 'card', 'other'] as const;

export const paymentInput = z.object({
  businessId: uuid,
  partyId: uuid,
  amount: z.number().positive(),
  mode: z.enum(PAYMENT_MODES).default('cash'),
  paymentDate: isoDate,
  reference: z.string().max(100).default(''),
  notes: z.string().max(500).default(''),
  // Vyapar parity P2-S5: what the payer settled besides money, and where the money went.
  /** Discount allowed at payment time; settles invoices like money. */
  discountAmount: z.number().min(0).default(0),
  /** TDS the payer deducted (claimable in 26AS); settles invoices like money. */
  tdsAmount: z.number().min(0).default(0),
  accountId: uuid.nullish(),
  chequeDate: isoDate.nullish(),
  /** Receipt number; left out = next in the RCT series. */
  number: z.string().trim().max(40).optional(),
  /** §269ST: the typed acknowledgement when cash from the party reaches ₹2,00,000 in a day. */
  cashAcknowledgement: z.string().max(200).optional(),
  /** Invoices to settle, oldest first when `autoAllocate` is true and this is empty. */
  allocations: z.array(z.object({ invoiceId: uuid, amount: z.number().positive() })).default([]),
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
  allocations: z.array(z.object({ invoiceId: uuid, amount: z.number() })),
  /** Part of the payment not applied to any invoice: the party's credit. */
  unallocated: z.number(),
  ...withStamps,
});
export type Payment = z.infer<typeof payment>;
export const paymentListQuery = z.object({ partyId: uuid.optional() });
/** PUT /v1/payments/:id: the same fields; the allocations are replaced. */
export const paymentUpdate = paymentInput;
