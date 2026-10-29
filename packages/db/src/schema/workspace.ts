import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { base } from './common.ts';
import { sql } from 'drizzle-orm';

/**
 * The workspace documents (change 3.23, "the bridge"): the existing billing screens keep their own JSON shapes for
 * invoices, clients, products, expenses, purchases, receipts, recurring schedules, business profiles and terms
 * templates. Each one is stored here, one row per document, inside the organization's tenant wall: row-level security,
 * sign-in, roles and the audit log all apply, and nothing is read from the browser's computer any more.
 * The typed tables (invoices, parties, items, ...) stay the target for the per-screen rewrite that follows.
 */
export const documents = pgTable(
  'documents',
  {
    ...base(),
    collection: text('collection').notNull(), // bills | clients | products | expenses | purchases | receipts | recurring | profiles | templates
    /** The id the screens use (an invoice number, 'cli_...', 'default'). Unique among live documents of a collection. */
    key: text('key').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [
    uniqueIndex('documents_live_key')
      .on(t.orgId, t.collection, t.key)
      .where(sql`${t.deletedAt} is null`),
    index('documents_collection_idx').on(t.orgId, t.collection),
  ],
);

/** Settings that are one value each: the active business profile, numbering counters, display options, per-person preferences. */
export const workspaceKv = pgTable(
  'workspace_kv',
  {
    orgId: base().orgId,
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('workspace_kv_pk').on(t.orgId, t.key)],
);
