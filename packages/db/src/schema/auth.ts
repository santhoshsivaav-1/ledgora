import {
  boolean,
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
import { organizations } from './platform.ts';

// Tables owned by Better Auth (change 2.1). Column names follow its model so the Drizzle adapter maps them without
// extra config. None of them is tenant data: they are read and written by the auth layer on the owner connection and
// are NOT granted to app_user (migration 0004), so request code running as a tenant can not read other people's sessions.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  phoneNumber: text('phone_number').unique(),
  phoneNumberVerified: boolean('phone_number_verified').notNull().default(false),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('two_factor_user_idx').on(t.userId)],
);

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** One of the built-in roles in packages/contracts/src/permissions.ts. */
    role: text('role').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('member_org_user').on(t.organizationId, t.userId),
    index('member_user_idx').on(t.userId),
  ],
);

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** The invited e-mail, or '' when the invitation is by phone. */
    email: text('email').notNull().default(''),
    phone: text('phone'),
    role: text('role').notNull().default('viewer'),
    businessIds: jsonb('business_ids').notNull().default([]),
    status: text('status').notNull().default('pending'), // pending | accepted | revoked
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('invitation_org_idx').on(t.organizationId)],
);

/** A browser or phone seen signing in, so a sign-in from a new one can raise an alert (change 2.12). Not tenant data. */
export const userDevices = pgTable(
  'user_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    label: text('label').notNull().default(''),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('user_devices_fp').on(t.userId, t.fingerprint)],
);

/** Limits a member to some businesses (change 2.9). No rows for a member = every business. Enforced by RLS. */
export const memberBusinesses = pgTable(
  'member_businesses',
  {
    ...base(),
    memberId: text('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id').notNull(),
  },
  (t) => [
    unique('member_businesses_pair').on(t.memberId, t.businessId),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
  ],
);

/** The plan an organization is on. Phase 2 only creates the 14-day trial; Razorpay billing is Phase 4. */
export const subscriptions = pgTable('subscriptions', {
  ...base(),
  plan: text('plan').notNull().default('trial'),
  status: text('status').notNull().default('trialing'), // trialing | active | past_due | canceled
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
});
