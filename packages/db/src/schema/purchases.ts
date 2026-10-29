import {
  boolean,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, money, qty } from './common.ts';
import { businesses } from './business.ts';
import { parties } from './parties.ts';
import { items } from './items.ts';

export const purchases = pgTable(
  'purchases',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    supplierId: uuid('supplier_id'),
    supplierName: text('supplier_name').notNull().default(''),
    supplierGstin: text('supplier_gstin').notNull().default(''),
    supplierAddress: text('supplier_address').notNull().default(''),
    invoiceNumber: text('invoice_number').notNull().default(''),
    purchaseDate: date('purchase_date').notNull(),
    interstate: boolean('interstate').notNull().default(false),
    paymentStatus: text('payment_status').notNull().default('Unpaid'),
    taxableAmount: money('taxable_amount').notNull().default(0),
    cgst: money('cgst').notNull().default(0),
    sgst: money('sgst').notNull().default(0),
    igst: money('igst').notNull().default(0),
    cess: money('cess').notNull().default(0),
    total: money('total').notNull().default(0),
    data: jsonb('data').notNull().default({}),
  },
  (t) => [
    unique('purchases_org_id_id').on(t.orgId, t.id),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.supplierId], foreignColumns: [parties.orgId, parties.id] }),
    index('purchases_org_date_idx').on(t.orgId, t.purchaseDate),
  ],
);

export const purchaseLines = pgTable(
  'purchase_lines',
  {
    ...base(),
    purchaseId: uuid('purchase_id').notNull(),
    itemId: uuid('item_id'),
    name: text('name').notNull(),
    hsn: text('hsn').notNull().default(''),
    quantity: qty('quantity').notNull().default(1),
    rate: money('rate').notNull().default(0),
    taxPercent: money('tax_percent').notNull().default(0),
    cessPercent: money('cess_percent').notNull().default(0),
    taxableAmount: money('taxable_amount').notNull().default(0),
    taxAmount: money('tax_amount').notNull().default(0),
    lineTotal: money('line_total').notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.purchaseId],
      foreignColumns: [purchases.orgId, purchases.id],
    }),
    foreignKey({ columns: [t.orgId, t.itemId], foreignColumns: [items.orgId, items.id] }),
    index('purchase_lines_purchase_idx').on(t.orgId, t.purchaseId),
  ],
);

export const expenseCategories = pgTable(
  'expense_categories',
  {
    ...base(),
    name: text('name').notNull(),
  },
  (t) => [
    unique('expense_categories_org_id_id').on(t.orgId, t.id),
    unique('expense_categories_name').on(t.orgId, t.name),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    categoryId: uuid('category_id'),
    expenseDate: date('expense_date').notNull(),
    description: text('description').notNull().default(''),
    vendor: text('vendor').notNull().default(''),
    amount: money('amount').notNull(),
    taxAmount: money('tax_amount').notNull().default(0),
    paymentMode: text('payment_mode').notNull().default('cash'),
    fileId: uuid('file_id'),
    data: jsonb('data').notNull().default({}),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({
      columns: [t.orgId, t.categoryId],
      foreignColumns: [expenseCategories.orgId, expenseCategories.id],
    }),
    index('expenses_org_date_idx').on(t.orgId, t.expenseDate),
  ],
);
