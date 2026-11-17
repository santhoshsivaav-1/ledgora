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
    // Phase 3 (S6): the lists page in the order the screens show, straight from indexes instead of a whole-table scan.
    // The keyset walks (sort key, created_at): newest date first, ties in insertion order, exactly like the old
    // in-memory sort. The JSON fields are text-compared in SQL, which is exact for the ISO dates the screens store.
    index('documents_bills_date_idx')
      .on(t.orgId, t.collection, sql`(coalesce(${t.data}->>'invoiceDate', '')) desc`, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('documents_txn_date_idx')
      .on(t.orgId, t.collection, sql`(coalesce(${t.data}->>'date', '')) desc`, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('documents_list_name_idx')
      .on(
        t.orgId,
        t.collection,
        sql`(lower(coalesce(${t.data}->>'name', ${t.data}->>'businessName', '')))`,
        t.createdAt,
      )
      .where(sql`${t.deletedAt} is null`),
    index('documents_list_client_idx')
      .on(t.orgId, t.collection, sql`(lower(coalesce(${t.data}->>'clientName', '')))`, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('documents_list_status_idx')
      .on(
        t.orgId,
        t.collection,
        sql`(coalesce(${t.data}->>'status', ''))`,
        sql`(coalesce(${t.data}->>'invoiceDate', '')) desc`,
        t.createdAt,
      )
      .where(sql`${t.deletedAt} is null`),
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
