import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { base, money } from './common.ts';
import { businesses } from './business.ts';

// R4.1 (docs/FEATURE_GAPS_2026-11.md): the fixed-asset register. Assets carry what depreciation needs (cost, the day put to
// use, the income-tax block, the Companies Act life); the depreciation itself is computed by the tax engine each time, never
// stored, so a corrected date or sale always shows the right figures. Block openings hold the written-down value brought
// forward for assets bought before the register began.

export const fixedAssets = pgTable(
  'fixed_assets',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    name: text('name').notNull(),
    /** Income-tax block: LAND | BLD5 | BLD10 | BLD40 | FF10 | PM15 | PM30 | PM40 | PM45 | INT25 | SHIP20 */
    block: text('block').notNull(),
    cost: money('cost').notNull(),
    putToUse: date('put_to_use').notNull(),
    /** Companies Act useful life in years; empty takes the class default. */
    lifeYears: integer('life_years'),
    residualPct: numeric('residual_pct', { precision: 5, scale: 2 }),
    note: text('note').notNull().default(''),
    disposalDate: date('disposal_date'),
    disposalProceeds: money('disposal_proceeds'),
    disposalExpenses: money('disposal_expenses'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('fixed_assets_business').on(t.orgId, t.businessId, t.putToUse),
  ],
);

/** The written-down value of a block on 1 April of `fy`, brought from before the register (one per block and year). */
export const assetBlockOpenings = pgTable(
  'asset_block_openings',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    fy: text('fy').notNull(),
    block: text('block').notNull(),
    wdv: money('wdv').notNull(),
    /** True only when every asset behind the figure is listed in the register. */
    trackedAll: boolean('tracked_all').notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    uniqueIndex('asset_block_openings_identity')
      .on(t.orgId, t.businessId, t.fy, t.block)
      .where(sql`${t.deletedAt} is null`),
  ],
);
