import { z } from 'zod';
import { uuid, withStamps } from './common.ts';

export const itemInput = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(60).nullish(),
  hsn: z.string().trim().max(10).default(''),
  unit: z.string().trim().max(10).default('PCS'),
  salePrice: z.number().min(0).default(0),
  purchasePrice: z.number().min(0).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  cessPercent: z.number().min(0).max(100).default(0),
  trackStock: z.boolean().default(true),
  /** Opening stock, written as the first stock movement when the item is created. */
  openingStock: z.number().min(0).default(0),
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type ItemInput = z.infer<typeof itemInput>;
export const itemPatch = itemInput.omit({ openingStock: true }).partial();
export const item = itemInput
  .omit({ openingStock: true })
  .extend({ id: uuid, stock: z.number(), ...withStamps });
export type Item = z.infer<typeof item>;

export const stockAdjustInput = z.object({
  quantity: z.number().refine((n) => n !== 0, 'Quantity can not be 0'),
  note: z.string().max(200).default(''),
});
export const stockMovement = z.object({
  id: uuid,
  itemId: uuid,
  quantity: z.number(),
  reason: z.string(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  note: z.string(),
  movedAt: z.string(),
});

export const unitInput = z.object({
  code: z.string().trim().min(1).max(10).toUpperCase(),
  name: z.string().trim().min(1).max(60),
});
export const unit = unitInput.extend({ id: uuid });
