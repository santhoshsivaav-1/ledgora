import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { base } from './common.ts';
import { businesses } from './business.ts';
import { parties } from './parties.ts';
import { staff } from './staff.ts';

// Vyapar parity Phase 9 (behind the `msg.enabled` setting): messages and their queue, share links, service reminders and
// the salesman's location visits with the consent they need.

/** A template the business changed. The built-in text lives in code; a row here overrides it for one event, channel and language. */
export const messageTemplates = pgTable(
  'message_templates',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    event: text('event').notNull(),
    channel: text('channel').notNull(),
    language: text('language').notNull().default('en'),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('message_templates_key').on(t.orgId, t.businessId, t.event, t.channel, t.language),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
  ],
);

/**
 * One row per message, from the moment it is queued: the worker sends `queued` rows whose `scheduled_at` has come, under
 * a row lock, and moves them to sent / failed. `idempotency_key` makes queuing the same message twice a no-op.
 */
export const messages = pgTable(
  'messages',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    channel: text('channel').notNull(),
    toAddress: text('to_address').notNull(),
    partyId: uuid('party_id'),
    event: text('event').notNull(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull(),
    /** queued | sent | delivered | failed | opened | cancelled */
    status: text('status').notNull().default('queued'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key').notNull(),
    providerId: text('provider_id'),
    /** For a payment reminder: { offset, dueDate }, which is what shouldRemind needs to know was already sent. */
    meta: jsonb('meta').notNull().default({}),
  },
  (t) => [
    unique('messages_idempotency').on(t.orgId, t.idempotencyKey),
    index('messages_due').on(t.status, t.scheduledAt),
    index('messages_ref').on(t.orgId, t.refType, t.refId),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
  ],
);

/** A read-only public link to a document (/s/:token). The token is 192 random bits; it expires and can be revoked. */
export const documentLinks = pgTable(
  'document_links',
  {
    ...base(),
    token: text('token').notNull().unique(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    views: integer('views').notNull().default(0),
  },
  (t) => [index('document_links_ref').on(t.orgId, t.refType, t.refId)],
);

/** Recurring service reminders (P8-S10 / P9-S5): "AC annual service" every 12 months, remind 7 days before. */
export const serviceReminders = pgTable(
  'service_reminders',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    name: text('name').notNull(),
    itemId: uuid('item_id'),
    partyId: uuid('party_id'),
    /** days | months */
    intervalUnit: text('interval_unit').notNull(),
    intervalEvery: integer('interval_every').notNull(),
    remindBeforeDays: integer('remind_before_days').notNull().default(7),
    channel: text('channel').notNull().default('whatsapp'),
    nextDue: text('next_due').notNull(),
    /** The due date the last "due soon" message was queued for. */
    lastSentFor: text('last_sent_for'),
    lastDoneAt: text('last_done_at'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    index('service_reminders_due').on(t.orgId, t.active, t.nextDue),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.partyId], foreignColumns: [parties.orgId, parties.id] }),
  ],
);

/** A salesman's agreement to have their location recorded on visits. Without a live (not revoked) row nothing is stored. */
export const staffConsents = pgTable(
  'staff_consents',
  {
    ...base(),
    staffId: uuid('staff_id').notNull(),
    /** Which wording they agreed to, so a changed text asks again. */
    textVersion: text('text_version').notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('staff_consents_staff').on(t.orgId, t.staffId),
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staff.orgId, staff.id] }),
  ],
);

/** Personal data: a check-in at a party. Deleted by the retention job after `visits.retentionDays` (90 by default). */
export const staffVisits = pgTable(
  'staff_visits',
  {
    ...base(),
    staffId: uuid('staff_id').notNull(),
    partyId: uuid('party_id'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note').notNull().default(''),
  },
  (t) => [
    index('staff_visits_at').on(t.at),
    index('staff_visits_staff').on(t.orgId, t.staffId, t.at),
    foreignKey({ columns: [t.orgId, t.staffId], foreignColumns: [staff.orgId, staff.id] }),
    foreignKey({ columns: [t.orgId, t.partyId], foreignColumns: [parties.orgId, parties.id] }),
  ],
);
