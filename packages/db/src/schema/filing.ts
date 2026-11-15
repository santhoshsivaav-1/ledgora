import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { base } from './common.ts';
import { businesses } from './business.ts';

// File-ready returns (docs/FILE_READY_PLAN.md, Phase 1). A filing pack is one return (GSTR-1, GSTR-3B, the IMS action
// list) for one period, in the portal's upload format. Saving the same return again makes a new version and retires
// the old one (`superseded_at`), so what a CA approved is exactly what is filed: an approval is tied to `sha256`.

export const filingPacks = pgTable(
  'filing_packs',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    /** gstr1 | gstr3b | ims */
    kind: text('kind').notNull(),
    /** The portal's return period, MMYYYY (the last month of the quarter for QRMP). */
    period: text('period').notNull(),
    quarterly: boolean('quarterly').notNull().default(false),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    version: integer('version').notNull().default(1),
    /** draft | ready | in_review | changes_requested | approved | filed */
    status: text('status').notNull(),
    payload: jsonb('payload').notNull(),
    /** SHA-256 of the canonical JSON of `payload`. */
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    /** The checks the server ran on save (FilingIssue[]). */
    issues: jsonb('issues').notNull().default([]),
    /** Warning ids a person accepted. */
    acknowledged: jsonb('acknowledged').notNull().default([]),
    /** Kept for re-checking 3B after a later GSTR-1 or IMS change. */
    itc2b: jsonb('itc2b'),
    preparedBy: text('prepared_by').notNull().default(''),
    /** Set once the pack is sent for review; from then on it needs an approval before it is recorded as filed. */
    reviewRequestedAt: timestamp('review_requested_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** The sha256 the reviewer approved. */
    approvedSha256: text('approved_sha256'),
    arn: text('arn'),
    filedOn: date('filed_on'),
    filedBy: text('filed_by'),
    ackFileId: uuid('ack_file_id'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('filing_packs_business_period').on(t.orgId, t.businessId, t.periodTo),
    index('filing_packs_status').on(t.orgId, t.status),
    // One live pack per return and period; older versions stay for the history.
    uniqueIndex('filing_packs_current')
      .on(t.orgId, t.businessId, t.kind, t.period)
      .where(sql`${t.supersededAt} is null and ${t.deletedAt} is null`),
  ],
);

/** The timeline of a pack: comments and every status change, with who did it. */
export const filingEvents = pgTable(
  'filing_events',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    packId: uuid('pack_id')
      .notNull()
      .references(() => filingPacks.id),
    /** comment | status */
    kind: text('kind').notNull(),
    actorId: text('actor_id').notNull().default(''),
    actorName: text('actor_name').notNull().default(''),
    actorRole: text('actor_role').notNull().default(''),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    body: text('body').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('filing_events_pack').on(t.orgId, t.packId, t.createdAt),
  ],
);
