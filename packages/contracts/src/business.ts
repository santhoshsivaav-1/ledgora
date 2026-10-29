import { z } from 'zod';
import { optionalGstin, uuid, withStamps } from './common.ts';

export const businessInput = z.object({
  name: z.string().trim().min(1).max(200),
  gstin: optionalGstin,
  pan: z.string().trim().max(10).nullish(),
  address: z.string().max(500).default(''),
  city: z.string().max(100).default(''),
  pin: z.string().max(10).default(''),
  state: z.string().max(100).default(''),
  country: z.string().max(100).default('India'),
  email: z.string().max(200).default(''),
  phone: z.string().max(30).default(''),
  logoFileId: uuid.nullish(),
  signatureFileId: uuid.nullish(),
  stampFileId: uuid.nullish(),
  isDefault: z.boolean().default(false),
});
export type BusinessInput = z.infer<typeof businessInput>;
export const businessPatch = businessInput.partial();
export const business = businessInput.extend({ id: uuid, ...withStamps });
export type Business = z.infer<typeof business>;

export const paymentAccountInput = z.object({
  label: z.string().trim().min(1).max(100),
  bankName: z.string().max(100).default(''),
  accountHolderName: z.string().max(100).default(''),
  accountNumber: z.string().max(40).default(''),
  accountType: z.string().max(40).default(''),
  ifsc: z.string().max(20).default(''),
  swift: z.string().max(20).default(''),
  upiId: z.string().max(100).default(''),
  notes: z.string().max(500).default(''),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const paymentAccount = paymentAccountInput.extend({ id: uuid, businessId: uuid });
export type PaymentAccount = z.infer<typeof paymentAccount>;

export const settingsBody = z.object({
  numberSettings: z.record(z.string(), z.unknown()).default({}),
  printSettings: z.record(z.string(), z.unknown()).default({}),
  preferences: z.record(z.string(), z.unknown()).default({}),
});
export type Settings = z.infer<typeof settingsBody>;
