import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Companies (Accounts) Rules 2014, Rule 3(1) proviso: the books keep an audit trail of every transaction and an edit log
// of every change, with its date, and it can not be switched off (FY 2023-24 onward). Rows are written only by the
// database trigger `edit_log_capture` (migration 0030); the app's role may read its own organization's rows and can
// never change or delete one. See docs/FEATURE_GAPS_2026-11.md, R1.5.
export const editLog = pgTable(
  'edit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id').notNull(),
    tableName: text('table_name').notNull(),
    rowId: uuid('row_id').notNull(),
    /** INSERT | UPDATE | DELETE */
    action: text('action').notNull(),
    oldRow: jsonb('old_row'),
    newRow: jsonb('new_row'),
    /** For an UPDATE: the columns whose value changed. */
    changed: text('changed').array(),
    actorId: text('actor_id'),
    ip: text('ip'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('edit_log_row').on(t.orgId, t.tableName, t.rowId, t.at),
    index('edit_log_org_at').on(t.orgId, t.at),
  ],
);
