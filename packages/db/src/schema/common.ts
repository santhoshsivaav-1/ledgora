import { numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Columns every tenant table has. `org_id` is what row-level security keys on (migration 0002_rls.sql);
 * `deleted_at` is the soft-delete marker behind the Trash screen (change 1.10).
 */
export const base = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** Rupee amounts: exact decimals in Postgres, plain numbers in TypeScript. */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });

/** Quantities and rates that need more than paise (stock in kg, per-unit rates). */
export const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });
