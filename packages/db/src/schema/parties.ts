import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, money } from './common.ts';

/**
 * Party groups (Vyapar parity P1-S1): "Wholesale", "Retail > Chennai". A tree through `parent_id`; the API refuses a
 * parent that would put a group inside itself. Names are unique per organization ignoring case, among live groups
 * only, so a name in the trash can be used again.
 */
export const partyGroups = pgTable(
  'party_groups',
  {
    ...base(),
    name: text('name').notNull(),
    parentId: uuid('parent_id'),
  },
  (t) => [
    unique('party_groups_org_id_id').on(t.orgId, t.id),
    uniqueIndex('party_groups_org_name')
      .on(t.orgId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('party_groups_org_parent_idx').on(t.orgId, t.parentId),
    foreignKey({ columns: [t.orgId, t.parentId], foreignColumns: [t.orgId, t.id] }),
  ],
);

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
    groupId: uuid('group_id'),
    extra: jsonb('extra').notNull().default({}),
  },
  (t) => [
    unique('parties_org_id_id').on(t.orgId, t.id),
    index('parties_org_name_idx').on(t.orgId, t.name),
    index('parties_org_group_idx').on(t.orgId, t.groupId),
    foreignKey({
      columns: [t.orgId, t.groupId],
      foreignColumns: [partyGroups.orgId, partyGroups.id],
    }),
  ],
);
