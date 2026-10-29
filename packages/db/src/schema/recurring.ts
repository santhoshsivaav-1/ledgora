import {
  boolean,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { base } from './common.ts';
import { businesses } from './business.ts';
import { parties } from './parties.ts';

/** A schedule that stamps out the same invoice again. Phase 1 generates on request; the scheduler is change 6.7. */
export const recurringSchedules = pgTable(
  'recurring_schedules',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    partyId: uuid('party_id'),
    name: text('name').notNull(),
    invoiceType: text('invoice_type').notNull().default('tax-invoice'),
    frequency: text('frequency').notNull().default('monthly'), // weekly | monthly | quarterly | yearly
    interval: integer('interval').notNull().default(1),
    anchorDay: integer('anchor_day'),
    nextDate: date('next_date').notNull(),
    endMode: text('end_mode').notNull().default('never'), // never | onDate | afterN
    endDate: date('end_date'),
    maxOccurrences: integer('max_occurrences'),
    occurrencesCreated: integer('occurrences_created').notNull().default(0),
    lastGenerated: date('last_generated'),
    dueDays: integer('due_days'),
    active: boolean('active').notNull().default(true),
    /** Lines, options, terms and notes the generated invoice copies. */
    template: jsonb('template').notNull().default({}),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.partyId], foreignColumns: [parties.orgId, parties.id] }),
  ],
);

export const termsTemplates = pgTable('terms_templates', {
  ...base(),
  name: text('name').notNull(),
  content: text('content').notNull().default(''),
  isDefault: boolean('is_default').notNull().default(false),
});
