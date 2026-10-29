import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { base } from './common.ts';

/** The tenant. Sign-up and membership arrive in Phase 2; Phase 1 only needs the row to hang data on. */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Better Auth's organization plugin reads these two; the app does not use them yet. */
  slug: text('slug').unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** An uploaded object (logo, signature, stamp, saved PDF). The bytes live in S3/R2 or the local disk driver. */
export const files = pgTable(
  'files',
  {
    ...base(),
    kind: text('kind').notNull(), // logo | signature | stamp | invoice_pdf | attachment | export
    storageKey: text('storage_key').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    ownerType: text('owner_type'), // business | invoice | purchase | expense
    ownerId: uuid('owner_id'),
    status: text('status').notNull().default('pending'), // pending (URL issued) | ready (bytes stored)
  },
  (t) => [
    unique('files_org_id_id').on(t.orgId, t.id),
    index('files_owner_idx').on(t.orgId, t.ownerType, t.ownerId),
  ],
);

/** Who changed what. Written by the API in the same transaction as the change. */
export const auditLog = pgTable(
  'audit_log',
  {
    ...base(),
    actorId: text('actor_id'),
    ip: text('ip'),
    action: text('action').notNull(), // invoice.create, invoice.cancel, party.delete, ...
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  (t) => [index('audit_entity_idx').on(t.orgId, t.entityType, t.entityId)],
);

/** Background work such as the legacy import and the full export (change 1.24). */
export const jobs = pgTable(
  'jobs',
  {
    ...base(),
    kind: text('kind').notNull(), // import.legacy | export.full
    status: text('status').notNull().default('queued'), // queued | running | done | failed
    progress: integer('progress').notNull().default(0),
    result: jsonb('result'),
    error: text('error'),
  },
  (t) => [index('jobs_org_idx').on(t.orgId, t.createdAt)],
);
