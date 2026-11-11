import {
  boolean,
  date,
  foreignKey,
  index,
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

// Vyapar parity Phase 6 (reports): what a user keeps about reports (favourites, recent, saved views), the schedules that
// e-mail a report, and the e-way bill register (the details the portal gives back, which the invoice does not hold).

/** One row per member: starred reports, the last few opened, and named filter sets ("saved views"). */
export const reportPrefs = pgTable(
  'report_prefs',
  {
    ...base(),
    userId: text('user_id').notNull(),
    favourites: jsonb('favourites').notNull().default([]),
    recent: jsonb('recent').notNull().default([]),
    views: jsonb('views').notNull().default([]),
  },
  (t) => [uniqueIndex('report_prefs_user').on(t.orgId, t.userId)],
);

/**
 * A report e-mailed on a schedule: weekly (the week before) or monthly (the month before) to the recipients, as a CSV.
 * `last_period` is the period already sent, so the same period never goes twice, whatever restarts happen.
 */
export const reportSchedules = pgTable(
  'report_schedules',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    reportId: text('report_id').notNull(),
    /** The filters the report is run with, apart from the period (which the schedule sets). */
    params: jsonb('params').notNull().default({}),
    /** weekly | monthly */
    frequency: text('frequency').notNull(),
    recipients: jsonb('recipients').notNull().default([]),
    createdBy: text('created_by').notNull().default(''),
    active: boolean('active').notNull().default(true),
    lastPeriod: text('last_period'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('report_schedules_active').on(t.active),
  ],
);

/** What the e-way bill portal returned for an invoice: its number, the vehicle and where it stands. */
export const ewayBills = pgTable(
  'eway_bills',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    ewayNo: text('eway_no').notNull().default(''),
    vehicleNo: text('vehicle_no').notNull().default(''),
    distanceKm: text('distance_km').notNull().default(''),
    /** pending | generated | cancelled */
    status: text('status').notNull().default('pending'),
    validUntil: date('valid_until'),
    /** The day the NIC JSON file was exported for this invoice. */
    jsonExportedOn: date('json_exported_on'),
    notes: text('notes').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    uniqueIndex('eway_bills_live_invoice')
      .on(t.orgId, t.invoiceId)
      .where(sql`${t.deletedAt} is null`),
  ],
);
