import { z } from 'zod';
import { isoDate, patchOf, uuid, withStamps } from './common.ts';

// Vyapar parity P2-S1: salesmen.
export const staffInput = z.object({
  name: z.string().trim().min(1).max(100),
  /** Optional; when given, 10 digits. */
  phone: z.union([z.string().regex(/^\d{10}$/, 'Use 10 digits'), z.literal('')]).default(''),
  /** The login this person uses (a user id), so a Salesman sees only their own invoices. */
  userId: z.string().max(100).nullish(),
  commissionPct: z.number().min(0).max(100).default(0),
  monthlyTarget: z.number().min(0).default(0),
  active: z.boolean().default(true),
});
export type StaffInput = z.infer<typeof staffInput>;
export const staffPatch = patchOf(staffInput);
export const staffMember = staffInput.extend({ id: uuid, ...withStamps });
export type StaffMember = z.infer<typeof staffMember>;
export const staffListQuery = z.object({
  /** true = only active staff (the pickers); left out = everyone (the Salesman screen). */
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const COMMISSION_BASES = ['sale', 'collection'] as const;
export const performanceQuery = z.object({
  from: isoDate,
  to: isoDate,
  basis: z.enum(COMMISSION_BASES).default('sale'),
});
export const staffPerformance = z.object({
  sales: z.number(),
  returns: z.number(),
  netSales: z.number(),
  collected: z.number(),
  outstanding: z.number(),
  commission: z.number(),
  targetPct: z.number().nullable(),
  invoices: z.array(
    z.object({
      id: uuid,
      number: z.string(),
      invoiceType: z.string(),
      invoiceDate: z.string(),
      taxableAmount: z.number(),
      total: z.number(),
      paidAmount: z.number(),
      status: z.string(),
    }),
  ),
});
export type StaffPerformance = z.infer<typeof staffPerformance>;
