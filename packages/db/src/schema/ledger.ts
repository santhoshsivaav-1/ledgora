import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { base, money } from './common.ts';
import { businesses } from './business.ts';

/** Vyapar parity P4-S1: the chart of accounts of a business, seeded when its ledger is enabled. */
export const accounts = pgTable(
  'accounts',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    group: text('group').notNull(),
    /** asset | liability | income | expense | equity */
    kind: text('kind').notNull(),
    /** Seeded accounts: the code can not change and they can not be deleted. */
    system: boolean('system').notNull().default(false),
    /** A sub-ledger link, for accounts that stand for one thing (a bank account, a loan, an expense category). */
    bankAccountId: uuid('bank_account_id'),
    loanId: uuid('loan_id'),
    categoryId: uuid('category_id'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('accounts_org_id_id').on(t.orgId, t.id),
    unique('accounts_biz_code').on(t.orgId, t.businessId, t.code),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
  ],
);

/**
 * The books. Append-only: the app role can insert and read but not update or delete (migration 0011), and a deferred
 * trigger refuses any voucher whose debits and credits differ. A correction is a reversal (swapped sides, `reversal_of`
 * pointing at the original) followed by a new posting; nothing here is ever edited. Written only by `repost()`.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    txnDate: date('txn_date').notNull(),
    accountId: uuid('account_id').notNull(),
    debit: money('debit').notNull().default(0),
    credit: money('credit').notNull().default(0),
    /** invoice | purchase | payment | expense | transfer | loan | cheque | adjustment | journal | opening */
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    /** Groups the lines of one posting; debits equal credits per voucher. */
    voucherId: uuid('voucher_id').notNull(),
    partyId: uuid('party_id'),
    narration: text('narration').notNull().default(''),
    fy: text('fy').notNull(),
    reversalOf: uuid('reversal_of'),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.accountId], foreignColumns: [accounts.orgId, accounts.id] }),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('le_org_acct_date').on(t.orgId, t.accountId, t.txnDate),
    index('le_org_ref').on(t.orgId, t.refType, t.refId),
    index('le_org_party_date').on(t.orgId, t.partyId, t.txnDate),
    index('le_org_voucher').on(t.orgId, t.voucherId),
    index('le_org_reversal').on(t.orgId, t.reversalOf),
    check('le_one_side', sql`(${t.debit} = 0) <> (${t.credit} = 0)`),
  ],
);

/** P4-S6: a financial year of a business. A closed year refuses writes dated in it. */
export const financialYears = pgTable(
  'financial_years',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    label: text('label').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** open | closed */
    status: text('status').notNull().default('open'),
    lockedAt: date('locked_at'),
    lockedBy: text('locked_by'),
  },
  (t) => [
    unique('financial_years_biz_label').on(t.orgId, t.businessId, t.label),
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
  ],
);

/**
 * P10-S5: TDS we deducted (and, later, TDS customers deducted from us), one row per deduction with its challan. Rows
 * follow their source: a Payment Out, a purchase with §194Q TDS. `status` is accrued until a challan is entered.
 */
export const tdsEntries = pgTable(
  'tds_entries',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    /** deducted_by_us | deducted_by_customer */
    direction: text('direction').notNull().default('deducted_by_us'),
    partyId: uuid('party_id'),
    partyName: text('party_name').notNull().default(''),
    pan: text('pan').notNull().default(''),
    section: text('section').notNull(),
    baseAmount: money('base_amount').notNull().default(0),
    rate: money('rate').notNull().default(0),
    tdsAmount: money('tds_amount').notNull(),
    date: date('date').notNull(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    challanNo: text('challan_no'),
    bsrCode: text('bsr_code'),
    challanDate: date('challan_date'),
    /** accrued | deposited */
    status: text('status').notNull().default('accrued'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('tds_entries_org_date').on(t.orgId, t.date),
    index('tds_entries_org_ref').on(t.orgId, t.refType, t.refId),
  ],
);
