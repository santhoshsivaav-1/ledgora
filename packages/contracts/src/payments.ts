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
  allocations: z.array(z.object({ invoiceId: uuid, amount: z.number() })),
  /** Part of the payment not applied to any invoice: the party's credit. */
  unallocated: z.number(),
  ...withStamps,
});
export type Payment = z.infer<typeof payment>;
export const paymentListQuery = z.object({ partyId: uuid.optional() });
