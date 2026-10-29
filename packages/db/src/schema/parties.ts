import { boolean, index, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { base, money } from './common.ts';

/** Customers and suppliers in one table; `kind` says which (a party can be both). */
export const parties = pgTable(
  'parties',
  {
    ...base(),
    kind: text('kind').notNull().default('customer'), // customer | supplier | both
    name: text('name').notNull(),
    gstin: text('gstin'),
    pan: text('pan'),
    address: text('address').notNull().default(''),
    city: text('city').notNull().default(''),
    pin: text('pin').notNull().default(''),
    state: text('state').notNull().default(''),
    country: text('country').notNull().default('India'),
    email: text('email').notNull().default(''),
    phone: text('phone').notNull().default(''),
    isSez: boolean('is_sez').notNull().default(false),
    openingBalance: money('opening_balance').notNull().default(0),
    extra: jsonb('extra').notNull().default({}),
  },
  (t) => [
    unique('parties_org_id_id').on(t.orgId, t.id),
    index('parties_org_name_idx').on(t.orgId, t.name),
  ],
);
