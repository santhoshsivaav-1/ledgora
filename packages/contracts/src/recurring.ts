import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';
import { invoiceInput } from './invoices.ts';

export const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;

export const recurringInput = z.object({
  businessId: uuid,
  partyId: uuid.nullish(),
  name: z.string().trim().min(1).max(200),
  frequency: z.enum(FREQUENCIES).default('monthly'),
  interval: z.number().int().min(1).max(60).default(1),
  nextDate: isoDate,
  endMode: z.enum(['never', 'onDate', 'afterN']).default('never'),
  endDate: isoDate.nullish(),
  maxOccurrences: z.number().int().min(1).nullish(),
  dueDays: z.number().int().min(0).nullish(),
  active: z.boolean().default(true),
  /** What each generated invoice copies: lines, options, terms, notes, type. */
  template: invoiceInput.pick({
    invoiceType: true,
    items: true,
    options: true,
    terms: true,
    notes: true,
    taxInclusive: true,
    placeOfSupply: true,
  }),
});
export type RecurringInput = z.infer<typeof recurringInput>;
export const recurringPatch = recurringInput.partial();
export const recurring = recurringInput.extend({
  id: uuid,
  occurrencesCreated: z.number().int(),
  lastGenerated: z.string().nullable(),
  ...withStamps,
});
export type Recurring = z.infer<typeof recurring>;
export const generateResult = z.object({ invoiceId: uuid, invoiceNumber: z.string() });

export const templateInput = z.object({
  name: z.string().trim().min(1).max(100),
  content: z.string().max(10000).default(''),
  isDefault: z.boolean().default(false),
});
export const termsTemplate = templateInput.extend({ id: uuid, ...withStamps });
