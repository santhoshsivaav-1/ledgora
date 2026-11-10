import { boolean, numeric, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { base, money } from './common.ts';

/** Salesmen and other staff an invoice can be credited to (Vyapar parity P2-S1). `user_id` links a login, if any. */
export const staff = pgTable(
  'staff',
  {
    ...base(),
    name: text('name').notNull(),
    phone: text('phone').notNull().default(''),
    userId: text('user_id'),
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    monthlyTarget: money('monthly_target').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [unique('staff_org_id_id').on(t.orgId, t.id)],
);
