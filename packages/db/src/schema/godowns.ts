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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { base, money, qty } from './common.ts';
import { items } from './items.ts';

// Phase 3 (docs/AUDIT_2026-11.md): godowns and stock transfers, batch and expiry across godowns, and a bill of materials
// for small manufacturers. Stock stays the sum of stock_movements rows — a godown only says which row went where, and a
// movement without a godown belongs to the default one. Nothing here changes money by itself: a transfer moves stock
// between two godowns of the same business, and a manufacture run consumes components and produces the product, whose
// component cost posts one voucher (Dr Stock / Cr Stock) so the books keep matching the register.

export const godowns = pgTable(
  'godowns',
  {
    ...base(),
    name: text('name').notNull(),
    code: text('code').notNull().default(''),
    address: text('address').notNull().default(''),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [
    unique('godowns_org_id_id').on(t.orgId, t.id),
    uniqueIndex('godowns_org_name_live')
      .on(t.orgId, t.name)
      .where(sql`deleted_at is null`),
  ],
);

export const stockTransfers = pgTable(
  'stock_transfers',
  {
    ...base(),
    number: text('number').notNull(),
    transferDate: date('transfer_date').notNull(),
    fromGodownId: uuid('from_godown_id').notNull(),
    toGodownId: uuid('to_godown_id').notNull(),
    note: text('note').notNull().default(''),
  },
  (t) => [
    unique('stock_transfers_org_id_id').on(t.orgId, t.id),
    uniqueIndex('stock_transfers_org_number_live')
      .on(t.orgId, t.number)
      .where(sql`deleted_at is null`),
    index('stock_transfers_org_date_idx').on(t.orgId, t.transferDate),
    foreignKey({ columns: [t.orgId, t.fromGodownId], foreignColumns: [godowns.orgId, godowns.id] }),
    foreignKey({ columns: [t.orgId, t.toGodownId], foreignColumns: [godowns.orgId, godowns.id] }),
  ],
);

export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    ...base(),
    transferId: uuid('transfer_id').notNull(),
    itemId: uuid('item_id').notNull(),
    quantity: qty('quantity').notNull(),
    /** Batch number, expiry and serials ride along so the batch stays traceable in the godown it moves to. */
    extra: jsonb('extra').notNull().default({}),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.transferId],
      foreignColumns: [stockTransfers.orgId, stockTransfers.id],
    }),
    foreignKey({ columns: [t.orgId, t.itemId], foreignColumns: [items.orgId, items.id] }),
    index('stock_transfer_lines_transfer_idx').on(t.orgId, t.transferId),
  ],
);

/** One bill of materials: the components that make one unit of the parent item. */
export const bomComponents = pgTable(
  'bom_components',
  {
    ...base(),
    itemId: uuid('item_id').notNull(),
    componentItemId: uuid('component_item_id').notNull(),
    quantity: qty('quantity').notNull(),
    scrapPercent: numeric('scrap_percent', { precision: 5, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    note: text('note').notNull().default(''),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.itemId], foreignColumns: [items.orgId, items.id] }),
    foreignKey({ columns: [t.orgId, t.componentItemId], foreignColumns: [items.orgId, items.id] }),
    uniqueIndex('bom_org_item_component_live')
      .on(t.orgId, t.itemId, t.componentItemId)
      .where(sql`deleted_at is null`),
    index('bom_org_item_idx').on(t.orgId, t.itemId),
  ],
);

/** One run of the BOM: consumes the components, produces the product, at the components' cost. */
export const manufactureRuns = pgTable(
  'manufacture_runs',
  {
    ...base(),
    number: text('number').notNull(),
    runDate: date('run_date').notNull(),
    itemId: uuid('item_id').notNull(),
    quantity: qty('quantity').notNull(),
    /** What was consumed: { itemId, name, quantity, unitCost, godownId } per component, as it was that day. */
    bomSnapshot: jsonb('bom_snapshot').notNull().default([]),
    unitCost: money('unit_cost').notNull().default(0),
    godownId: uuid('godown_id'),
    note: text('note').notNull().default(''),
  },
  (t) => [
    uniqueIndex('manufacture_runs_org_number_live')
      .on(t.orgId, t.number)
      .where(sql`deleted_at is null`),
    index('manufacture_runs_org_date_idx').on(t.orgId, t.runDate),
    foreignKey({ columns: [t.orgId, t.itemId], foreignColumns: [items.orgId, items.id] }),
  ],
);
