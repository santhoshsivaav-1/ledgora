import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { base } from './common.ts';

export const businesses = pgTable(
  'businesses',
  {
    ...base(),
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
    logoFileId: uuid('logo_file_id'),
    signatureFileId: uuid('signature_file_id'),
    stampFileId: uuid('stamp_file_id'),
    isDefault: boolean('is_default').notNull().default(false),
  },
  (t) => [
    unique('businesses_org_id_id').on(t.orgId, t.id),
    index('businesses_org_idx').on(t.orgId),
  ],
);

/** One row per business: numbering, print preferences and the rest of the old key-value `meta.json`. */
export const businessSettings = pgTable(
  'business_settings',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    numberSettings: jsonb('number_settings').notNull().default({}),
    printSettings: jsonb('print_settings').notNull().default({}),
    preferences: jsonb('preferences').notNull().default({}),
  },
  (t) => [
    unique('business_settings_business').on(t.orgId, t.businessId),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
  ],
);

export const paymentAccounts = pgTable(
  'payment_accounts',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    label: text('label').notNull(),
    bankName: text('bank_name').notNull().default(''),
    accountHolderName: text('account_holder_name').notNull().default(''),
    accountNumber: text('account_number').notNull().default(''),
    accountType: text('account_type').notNull().default(''),
    ifsc: text('ifsc').notNull().default(''),
    swift: text('swift').notNull().default(''),
    upiId: text('upi_id').notNull().default(''),
    notes: text('notes').notNull().default(''),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('payment_accounts_business_idx').on(t.orgId, t.businessId),
  ],
);
