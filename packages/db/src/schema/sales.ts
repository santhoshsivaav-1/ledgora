import {
  date,
  foreignKey,
  index,
  integer,
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

/** One counter per business and counter key, e.g. `counter_INV`. Locked FOR UPDATE while an invoice is numbered. */
export const numberSeries = pgTable(
  'number_series',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    counterKey: text('counter_key').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [
    unique('number_series_key').on(t.orgId, t.businessId, t.counterKey),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    partyId: uuid('party_id'),
    invoiceType: text('invoice_type').notNull().default('tax-invoice'),
    number: text('number').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date'),
    status: text('status').notNull().default('unpaid'), // unpaid | partial | paid | cancelled
    currency: text('currency').notNull().default('INR'),
    placeOfSupply: text('place_of_supply').notNull().default(''),
    subtotal: money('subtotal').notNull().default(0),
    taxableAmount: money('taxable_amount').notNull().default(0),
    cgst: money('cgst').notNull().default(0),
    sgst: money('sgst').notNull().default(0),
    igst: money('igst').notNull().default(0),
    cess: money('cess').notNull().default(0),
    totalTax: money('total_tax').notNull().default(0),
    total: money('total').notNull().default(0),
    paidAmount: money('paid_amount').notNull().default(0),
    generatedFromId: uuid('generated_from_id'),
    cancelledAt: date('cancelled_at'),
    /** Everything the print layout needs that has no column of its own: totals breakdown, terms, notes, options. */
    data: jsonb('data').notNull().default({}),
  },
  (t) => [
    unique('invoices_org_id_id').on(t.orgId, t.id),
    // A live invoice number is unique per business; trashed or cancelled copies may repeat it.
    index('invoices_org_date_idx').on(t.orgId, t.invoiceDate),
    index('invoices_party_idx').on(t.orgId, t.partyId),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.partyId], foreignColumns: [parties.orgId, parties.id] }),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    ...base(),
    invoiceId: uuid('invoice_id').notNull(),
    position: integer('position').notNull().default(0),
    itemId: uuid('item_id'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    hsn: text('hsn').notNull().default(''),
    unit: text('unit').notNull().default('PCS'),
    quantity: qty('quantity').notNull().default(1),
    rate: money('rate').notNull().default(0),
    discount: money('discount').notNull().default(0),
    taxPercent: money('tax_percent').notNull().default(0),
    cessPercent: money('cess_percent').notNull().default(0),
    taxableAmount: money('taxable_amount').notNull().default(0),
    taxAmount: money('tax_amount').notNull().default(0),
    lineTotal: money('line_total').notNull().default(0),
    extra: jsonb('extra').notNull().default({}),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.invoiceId], foreignColumns: [invoices.orgId, invoices.id] }),
    foreignKey({ columns: [t.orgId, t.itemId], foreignColumns: [items.orgId, items.id] }),
    index('invoice_lines_invoice_idx').on(t.orgId, t.invoiceId),
  ],
);
