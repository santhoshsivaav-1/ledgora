import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, money, qty } from './common.ts';

export const units = pgTable(
  'units',
  {
    ...base(),
    code: text('code').notNull(), // PCS, KGS, ...
    name: text('name').notNull(),
  },
  (t) => [unique('units_org_code').on(t.orgId, t.code)],
);

export const items = pgTable(
  'items',
  {
    ...base(),
    name: text('name').notNull(),
    sku: text('sku'),
    hsn: text('hsn').notNull().default(''),
    unit: text('unit').notNull().default('PCS'),
    salePrice: money('sale_price').notNull().default(0),
    purchasePrice: money('purchase_price').notNull().default(0),
    taxPercent: money('tax_percent').notNull().default(0),
    cessPercent: money('cess_percent').notNull().default(0),
    trackStock: boolean('track_stock').notNull().default(true),
    extra: jsonb('extra').notNull().default({}),
  },
  (t) => [
    unique('items_org_id_id').on(t.orgId, t.id),
    index('items_org_name_idx').on(t.orgId, t.name),
  ],
);

/** Stock is the sum of these rows, never an editable number (change 1.15). Positive = in, negative = out.
 *  A movement without a godown belongs to the business's default godown (Phase 3). */
export const stockMovements = pgTable(
  'stock_movements',
  {
    ...base(),
    itemId: uuid('item_id').notNull(),
    quantity: qty('quantity').notNull(),
    reason: text('reason').notNull(), // opening | sale | sale_return | purchase | adjustment | cancel | transfer | manufacture
    refType: text('ref_type'), // invoice | purchase | transfer | manufacture
    refId: uuid('ref_id'),
    godownId: uuid('godown_id'),
    note: text('note').notNull().default(''),
    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.itemId], foreignColumns: [items.orgId, items.id] }),
    index('stock_movements_item_idx').on(t.orgId, t.itemId),
    index('stock_movements_ref_idx').on(t.orgId, t.refType, t.refId),
    index('stock_movements_godown_idx').on(t.orgId, t.godownId, t.itemId),
  ],
);
