import {
  boolean,
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
import { base, money } from './common.ts';
import { businesses } from './business.ts';
import { financialYears } from './ledger.ts';

// Vyapar parity Phase 7 (Utilities): the backup history and schedule (P7-S4) and the record of each financial-year
// close (P7-S3). The bytes of a backup live in storage and are listed in `files`; this is its metadata.

/** One backup file: taken by hand, by the schedule, or as the safety copy a restore takes first. */
export const backups = pgTable(
  'backups',
  {
    ...base(),
    /** manual | auto | safety */
    kind: text('kind').notNull(),
    fileId: uuid('file_id'),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    encrypted: boolean('encrypted').notNull().default(false),
    /** none | password (the owner's, never stored) | server (a key the server derives, for scheduled backups) */
    keyMode: text('key_mode').notNull().default('none'),
    /** The copy on Google Drive, when the organization has connected it. */
    driveFileId: text('drive_file_id'),
    schemaVersion: integer('schema_version').notNull(),
    sha256: text('sha256').notNull(),
    counts: jsonb('counts').notNull().default({}),
    createdBy: text('created_by').notNull().default(''),
    note: text('note').notNull().default(''),
  },
  (t) => [index('backups_org_created').on(t.orgId, t.createdAt)],
);

/** The backup schedule of an organization: one row. `last_slot` ('2026-11-11' or '2026-W45') is what has run, so a slot runs once. */
export const backupSettings = pgTable(
  'backup_settings',
  {
    ...base(),
    /** off | daily | weekly */
    frequency: text('frequency').notNull().default('off'),
    /** Hour of day (IST) the backup is due from. */
    hour: integer('hour').notNull().default(21),
    keepLast: integer('keep_last').notNull().default(7),
    remind: boolean('remind').notNull().default(true),
    remindDays: integer('remind_days').notNull().default(7),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSlot: text('last_slot'),
    lastError: text('last_error'),
  },
  (t) => [uniqueIndex('backup_settings_org').on(t.orgId)],
);

/** What closing a financial year did, kept for the result page, the equality check and Reopen. */
export const fyCloses = pgTable(
  'fy_closes',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    yearId: uuid('year_id').notNull(),
    /** prefix | new-year */
    method: text('method').notNull(),
    newPrefix: text('new_prefix').notNull().default(''),
    netProfit: money('net_profit').notNull().default(0),
    summary: jsonb('summary').notNull().default({}),
    closedBy: text('closed_by').notNull().default(''),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenedBy: text('reopened_by'),
    reopenReason: text('reopen_reason'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.yearId], foreignColumns: [financialYears.id] }),
    index('fy_closes_year').on(t.orgId, t.yearId),
    uniqueIndex('fy_closes_open_year')
      .on(t.orgId, t.yearId)
      .where(sql`${t.reopenedAt} is null and ${t.deletedAt} is null`),
  ],
);

/** The Google Drive an organization saves backups to. The refresh token is encrypted with a key from the server's secret. */
export const backupDrive = pgTable(
  'backup_drive',
  {
    ...base(),
    email: text('email').notNull().default(''),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    /** The "Ledgora Backups" folder this app made (the drive.file scope only sees what the app created). */
    folderId: text('folder_id'),
    lastError: text('last_error'),
  },
  (t) => [uniqueIndex('backup_drive_org').on(t.orgId)],
);
