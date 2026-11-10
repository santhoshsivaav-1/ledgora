import {
  boolean,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, money, qty } from './common.ts';
import { businesses } from './business.ts';
import { parties } from './parties.ts';
import { items } from './items.ts';

/** Vyapar parity P3-S3: goods ordered from a supplier. No effect on stock, GST or the books until received on a bill. */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id'),
    supplierName: text('supplier_name').notNull().default(''),
    supplierGstin: text('supplier_gstin').notNull().default(''),
    orderDate: date('order_date').notNull(),
    expectedDate: date('expected_date'),
    interstate: boolean('interstate').notNull().default(false),
    /** open | partial | received | cancelled: derived from received quantities, stored for the list filter. */
    status: text('status').notNull().default('open'),
    taxableAmount: money('taxable_amount').notNull().default(0),
    total: money('total').notNull().default(0),
    /** charges, notes */
    data: jsonb('data').notNull().default({}),
  },
  (t) => [
    unique('purchase_orders_org_id_id').on(t.orgId, t.id),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.supplierId], foreignColumns: [parties.orgId, parties.id] }),
    index('purchase_orders_org_date_idx').on(t.orgId, t.orderDate),
    index('purchase_orders_status_idx').on(t.orgId, t.status),
  ],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    ...base(),
    orderId: uuid('order_id').notNull(),
    itemId: uuid('item_id'),
    name: text('name').notNull(),
    hsn: text('hsn').notNull().default(''),
    quantity: qty('quantity').notNull().default(1),
    rate: money('rate').notNull().default(0),
    taxPercent: money('tax_percent').notNull().default(0),
    cessPercent: money('cess_percent').notNull().default(0),
    /** Kept in step with the bills converted from the order (purchaseOrderProgress). */
    receivedQty: qty('received_qty').notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.orderId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.id],
    }),
    foreignKey({ columns: [t.orgId, t.itemId], foreignColumns: [items.orgId, items.id] }),
    index('purchase_order_lines_order_idx').on(t.orgId, t.orderId),
  ],
);

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
    /** charges[], roundOff, tds194QPercent */
    data: jsonb('data').notNull().default({}),
    // Vyapar parity Phase 3.
    /** bill | debit-note (P3-S4: a purchase return is a purchase document going the other way). */
    docType: text('doc_type').notNull().default('bill'),
    /** Our reference: PUR-n / DN-n. '' on bills saved before Phase 3. */
    number: text('number').notNull().default(''),
    dueDate: date('due_date'),
    placeOfSupply: text('place_of_supply').notNull().default(''),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    /** §194Q TDS withheld from the supplier. */
    tdsAmount: money('tds_amount').notNull().default(0),
    /** Re-derived from payment allocations, like invoices.paid_amount. */
    paidAmount: money('paid_amount').notNull().default(0),
    poId: uuid('po_id'),
    againstPurchaseId: uuid('against_purchase_id'),
    returnReason: text('return_reason'),
    refundMode: text('refund_mode').notNull().default('adjust'),
    fileId: uuid('file_id'),
    notes: text('notes').notNull().default(''),
    /** Another bill with the same supplier bill number this year, saved anyway after the warning. */
    duplicateOf: uuid('duplicate_of'),
  },
  (t) => [
    unique('purchases_org_id_id').on(t.orgId, t.id),
    foreignKey({
      columns: [t.orgId, t.poId],
      foreignColumns: [purchaseOrders.orgId, purchaseOrders.id],
    }),
    foreignKey({ columns: [t.orgId, t.againstPurchaseId], foreignColumns: [t.orgId, t.id] }),
    index('purchases_supplier_idx').on(t.orgId, t.supplierId),
    index('purchases_doc_type_idx').on(t.orgId, t.docType),
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
    /** P3-S1: eligible | capital_goods | ineligible_17_5 | blocked | exempt_supply_use. */
    itcStatus: text('itc_status').notNull().default('eligible'),
    /** Cost per unit with the bill's charges spread in (and credit we can not claim): what stock came in at. */
    landedCost: numeric('landed_cost', { precision: 14, scale: 4, mode: 'number' })
      .notNull()
      .default(0),
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
    // Vyapar parity P3-S5: a tree, and where it lands in the P&L.
    parentId: uuid('parent_id'),
    /** direct | indirect (expenses) | income (Other Income categories). */
    kind: text('kind').notNull().default('indirect'),
    /** Seeded categories; renaming is allowed, deleting is not. */
    isSystem: boolean('is_system').notNull().default(false),
  },
  (t) => [
    unique('expense_categories_org_id_id').on(t.orgId, t.id),
    // An expense and an income category may share a name ("Commission" paid and received).
    unique('expense_categories_kind_name').on(t.orgId, t.kind, t.name),
    foreignKey({ columns: [t.orgId, t.parentId], foreignColumns: [t.orgId, t.id] }),
  ],
);

/** P3-S5: things a business pays for again and again (rent, electricity), with their SAC and GST rate. */
export const expenseItems = pgTable(
  'expense_items',
  {
    ...base(),
    name: text('name').notNull(),
    sac: text('sac').notNull().default(''),
    defaultRate: money('default_rate').notNull().default(0),
    gstRate: money('gst_rate').notNull().default(0),
    defaultCategoryId: uuid('default_category_id'),
  },
  (t) => [
    unique('expense_items_org_id_id').on(t.orgId, t.id),
    foreignKey({
      columns: [t.orgId, t.defaultCategoryId],
      foreignColumns: [expenseCategories.orgId, expenseCategories.id],
    }),
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
    /** items[] (itemised expenses) */
    data: jsonb('data').notNull().default({}),
    // Vyapar parity P3-S5 / P3-S6.
    /** expense | income (Other Income). */
    kind: text('kind').notNull().default('expense'),
    /** EXP-n / INC-n. '' on expenses saved before Phase 3. */
    number: text('number').notNull().default(''),
    payeePartyId: uuid('payee_party_id'),
    interstate: boolean('interstate').notNull().default(false),
    itcEligible: boolean('itc_eligible').notNull().default(true),
    exempt: boolean('exempt').notNull().default(false),
    accountId: uuid('account_id'),
    /** null = paid in full (every expense before Phase 3). */
    paidAmount: money('paid_amount'),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.payeePartyId], foreignColumns: [parties.orgId, parties.id] }),
    index('expenses_org_kind_idx').on(t.orgId, t.kind),
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
