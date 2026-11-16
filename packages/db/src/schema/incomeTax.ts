import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { base, money } from './common.ts';
import { businesses } from './business.ts';

// R2 (docs/FEATURE_GAPS_2026-11.md): income tax. The taxpayer is the person behind a business (a proprietor), so everything
// hangs off the business like the GST filings do. Identity (Aadhaar) and bank account numbers are sealed at rest with a key
// bound to the organization (apps/api/src/crypto.ts); nothing else here is secret.

/** Who files the return: the details ITR asks that the books do not hold. One per business. */
export const taxpayerProfiles = pgTable(
  'taxpayer_profiles',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    pan: text('pan').notNull(),
    firstName: text('first_name').notNull().default(''),
    middleName: text('middle_name').notNull().default(''),
    surname: text('surname').notNull(),
    fatherName: text('father_name').notNull(),
    dob: date('dob').notNull(),
    residenceNo: text('residence_no').notNull().default(''),
    residenceName: text('residence_name').notNull().default(''),
    roadOrStreet: text('road_or_street').notNull().default(''),
    locality: text('locality').notNull().default(''),
    city: text('city').notNull().default(''),
    stateCode: text('state_code').notNull().default(''),
    pinCode: text('pin_code').notNull().default(''),
    mobile: text('mobile').notNull().default(''),
    email: text('email').notNull().default(''),
    /** AES-256-GCM of the 12-digit number, or empty. */
    aadhaarSealed: text('aadhaar_sealed').notNull().default(''),
    /** CGOV | SGOV | PSU | PE | PESG | PEPS | PEO | OTH | NA */
    employerCategory: text('employer_category').notNull().default('NA'),
    place: text('place').notNull().default(''),
    /** [{ ifsc, bankName, accountNoSealed, last4, accountType, useForRefund }] */
    bankAccounts: jsonb('bank_accounts').notNull().default([]),
    /** The Form 10-IEA the person filed to leave the new regime: { ack, filedOn } or null. */
    form10Iea: jsonb('form_10iea'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    uniqueIndex('taxpayer_profiles_business')
      .on(t.orgId, t.businessId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** What the person has entered for one return (regime, scheme, salary, deductions, TDS rows …), kept between visits. */
export const itrDrafts = pgTable(
  'itr_drafts',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    /** Financial year of the income, '2025-26'. */
    fy: text('fy').notNull(),
    data: jsonb('data').notNull().default({}),
    updatedBy: text('updated_by').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    uniqueIndex('itr_drafts_year')
      .on(t.orgId, t.businessId, t.fy)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** A challan the person paid on the portal (advance tax or self-assessment tax). BSR code + date + serial identify it. */
export const taxChallans = pgTable(
  'tax_challans',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    /** The financial year the payment is for: tax paid in April can be the year just ended (self-assessment) or the new one. */
    fy: text('fy').notNull(),
    bsrCode: text('bsr_code').notNull(),
    challanDate: date('challan_date').notNull(),
    serialNo: integer('serial_no').notNull(),
    amount: money('amount').notNull(),
    note: text('note').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('tax_challans_business_year').on(t.orgId, t.businessId, t.fy, t.challanDate),
    uniqueIndex('tax_challans_identity')
      .on(t.orgId, t.businessId, t.bsrCode, t.challanDate, t.serialNo)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** An AIS / TIS file read in: its rows as the person confirmed them, to compare with the books and the return. */
export const aisImports = pgTable(
  'ais_imports',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    fy: text('fy').notNull(),
    /** ais | tis */
    kind: text('kind').notNull(),
    fileName: text('file_name').notNull().default(''),
    rows: jsonb('rows').notNull().default([]),
    importedBy: text('imported_by').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('ais_imports_business_year').on(t.orgId, t.businessId, t.fy),
  ],
);
