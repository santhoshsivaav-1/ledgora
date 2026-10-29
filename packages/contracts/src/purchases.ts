import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';

export const purchaseLineInput = z.object({
  itemId: uuid.nullish(),
  name: z.string().trim().min(1).max(300),
  hsn: z.string().max(10).default(''),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  taxPercent: z.number().min(0).max(100).default(0),
  cessPercent: z.number().min(0).max(100).default(0),
});

export const purchaseInput = z.object({
  businessId: uuid,
  supplierId: uuid.nullish(),
  supplierName: z.string().max(200).default(''),
  supplierGstin: z.string().max(15).default(''),
  supplierAddress: z.string().max(500).default(''),
  invoiceNumber: z.string().max(60).default(''),
  purchaseDate: isoDate,
  interstate: z.boolean().default(false),
  paymentStatus: z.enum(['Unpaid', 'Partial', 'Paid']).default('Unpaid'),
  items: z.array(purchaseLineInput).min(1),
});
export type PurchaseInput = z.infer<typeof purchaseInput>;

export const purchase = z.object({
  id: uuid,
  businessId: uuid,
  supplierId: uuid.nullable(),
  supplierName: z.string(),
  supplierGstin: z.string(),
  supplierAddress: z.string(),
  invoiceNumber: z.string(),
  purchaseDate: z.string(),
  interstate: z.boolean(),
  paymentStatus: z.string(),
  taxableAmount: z.number(),
  cgst: z.number(),
  sgst: z.number(),
  igst: z.number(),
  cess: z.number(),
  total: z.number(),
  items: z.array(
    purchaseLineInput.extend({
      taxableAmount: z.number(),
      taxAmount: z.number(),
      lineTotal: z.number(),
    }),
  ),
  ...withStamps,
});
export type Purchase = z.infer<typeof purchase>;

export const expenseInput = z.object({
  businessId: uuid,
  categoryId: uuid.nullish(),
  expenseDate: isoDate,
  description: z.string().max(300).default(''),
  vendor: z.string().max(200).default(''),
  amount: z.number().positive(),
  taxAmount: z.number().min(0).default(0),
  paymentMode: z.string().max(20).default('cash'),
  fileId: uuid.nullish(),
});
export type ExpenseInput = z.infer<typeof expenseInput>;
export const expense = expenseInput.extend({ id: uuid, ...withStamps });
export const expenseCategoryInput = z.object({ name: z.string().trim().min(1).max(100) });
export const expenseCategory = expenseCategoryInput.extend({ id: uuid });
