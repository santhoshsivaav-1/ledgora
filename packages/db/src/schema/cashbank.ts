import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, money, qty } from './common.ts';
import { businesses } from './business.ts';
import { parties } from './parties.ts';
import { accounts } from './ledger.ts';

// Vyapar parity Phase 5 (Cash & Bank). Every table here is a document that posts to the ledger through `repost()`;
// none of them holds a balance. A bank account is a `payment_accounts` row (P5-S1 adds its opening balance); its
// chart account is the `accounts` row whose `bank_account_id` points at it.

/** P5-S3: money moved between cash and bank accounts. `from/to` are chart accounts (Cash in Hand or a bank). */
export const transfers = pgTable(
  'transfers',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    fromAccountId: uuid('from_account_id').notNull(),
    toAccountId: uuid('to_account_id').notNull(),
    amount: money('amount').notNull(),
    /** Bank charges for the transfer, taken from the source account. */
    fee: money('fee').notNull().default(0),
    date: date('date').notNull(),
    reference: text('reference').notNull().default(''),
    notes: text('notes').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({
      columns: [t.orgId, t.fromAccountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    foreignKey({
      columns: [t.orgId, t.toAccountId],
      foreignColumns: [accounts.orgId, accounts.id],
    }),
    index('transfers_org_date').on(t.orgId, t.businessId, t.date),
  ],
);

/**
 * P5-S1 / P5-S2: one-sided cash and bank entries. `kind` adjust (Adjust Cash / Adjust bank balance), count (day-end
 * count's over / short), deposit (owner puts money in) or withdraw (drawings, bank charges, another account).
 */
export const cashEntries = pgTable(
  'cash_entries',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    /** The cash or bank chart account the money is in. */
    accountId: uuid('account_id').notNull(),
    kind: text('kind').notNull(),
    /** increase | reduce */
    direction: text('direction').notNull(),
    amount: money('amount').notNull(),
    date: date('date').notNull(),
    remarks: text('remarks').notNull().default(''),
    countAsIncome: boolean('count_as_income').notNull().default(false),
    /** withdraw: drawings | bank_charges | other */
    category: text('category'),
    /** The other side when the user chose it (withdraw → other, deposit from a named account). */
    counterAccountId: uuid('counter_account_id'),
    /** Day-end count: what the books said and what was counted. */
    systemBalance: money('system_balance'),
    counted: money('counted'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.accountId], foreignColumns: [accounts.orgId, accounts.id] }),
    index('cash_entries_org_date').on(t.orgId, t.businessId, t.date),
  ],
);

/** P5-S4: the cheque register. A cheque comes with its payment (mode cheque), which posts the receipt itself. */
export const cheques = pgTable(
  'cheques',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    /** received | issued */
    direction: text('direction').notNull(),
    partyId: uuid('party_id').notNull(),
    number: text('number').notNull(),
    amount: money('amount').notNull(),
    chequeDate: date('cheque_date').notNull(),
    receivedDate: date('received_date').notNull(),
    /** The bank account it is deposited into (received) or drawn on (issued). */
    bankAccountId: uuid('bank_account_id'),
    /** open | deposited | cleared | bounced | cancelled */
    status: text('status').notNull().default('open'),
    statusDate: date('status_date'),
    bounceCharges: money('bounce_charges').notNull().default(0),
    /** party | us (received cheques); an issued cheque's charges are always ours. */
    chargeTo: text('charge_to').notNull().default('party'),
    paymentId: uuid('payment_id'),
    reminderDays: integer('reminder_days').notNull().default(3),
    notes: text('notes').notNull().default(''),
    /** A bounced received cheque: when the §138 demand notice reached the drawer (starts their 15 days to pay). */
    noticeServedOn: date('notice_served_on'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.partyId], foreignColumns: [parties.orgId, parties.id] }),
    uniqueIndex('cheques_live_number')
      .on(t.orgId, t.direction, t.partyId, t.number)
      .where(sql`${t.deletedAt} is null`),
    index('cheques_org_status').on(t.orgId, t.businessId, t.status, t.chequeDate),
    index('cheques_org_payment').on(t.orgId, t.paymentId),
  ],
);

/** P5-S5: a loan the business took. Its chart account (2301…) is the `accounts` row whose `loan_id` points here. */
export const loans = pgTable(
  'loans',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    name: text('name').notNull(),
    lender: text('lender').notNull().default(''),
    /** term | od | cc | vehicle | business | personal | housing | education | other */
    type: text('type').notNull().default('term'),
    principal: money('principal').notNull(),
    ratePct: qty('rate_pct').notNull().default(0),
    /** reducing | flat */
    interestType: text('interest_type').notNull().default('reducing'),
    tenureMonths: integer('tenure_months').notNull(),
    emi: money('emi').notNull(),
    firstEmiDate: date('first_emi_date').notNull(),
    receivedOn: date('received_on').notNull(),
    /** The bank account the money came into; null = cash. */
    receivedAccountId: uuid('received_account_id'),
    processingFee: money('processing_fee').notNull().default(0),
    /** business, or housing / education for the §24(b) / §80E suggestions in the regime calculator. */
    purpose: text('purpose').notNull().default('business'),
    /** active | closed */
    status: text('status').notNull().default('active'),
    notes: text('notes').notNull().default(''),
    /** §194A: bank (exempt) | nbfc | company | individual | other. */
    lenderType: text('lender_type').notNull().default('bank'),
    lenderPan: text('lender_pan').notNull().default(''),
    /** The lender as a party, when they are one: interest to them is added up across their loans for the threshold. */
    lenderPartyId: uuid('lender_party_id'),
    /** No TDS on this loan's interest (Form 15G / 15H on file, or the business is not required to deduct). */
    tdsExempt: boolean('tds_exempt').notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('loans_org_business').on(t.orgId, t.businessId),
  ],
);

/** The repayment schedule, rebuilt from the loan and its payments whenever one changes (tax-engine scheduleFor). */
export const loanSchedule = pgTable(
  'loan_schedule',
  {
    ...base(),
    loanId: uuid('loan_id').notNull(),
    n: integer('n').notNull(),
    dueDate: date('due_date').notNull(),
    emi: money('emi').notNull(),
    principalPart: money('principal_part').notNull(),
    interestPart: money('interest_part').notNull(),
    balanceAfter: money('balance_after').notNull(),
    /** due | paid | part */
    status: text('status').notNull().default('due'),
    paidOn: date('paid_on'),
    paidPrincipal: money('paid_principal').notNull().default(0),
    paidInterest: money('paid_interest').notNull().default(0),
  },
  (t) => [index('loan_schedule_loan').on(t.orgId, t.loanId, t.n)],
);

export const loanPayments = pgTable(
  'loan_payments',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    loanId: uuid('loan_id').notNull(),
    date: date('date').notNull(),
    /** emi | part | prepay */
    kind: text('kind').notNull().default('emi'),
    principal: money('principal').notNull().default(0),
    interest: money('interest').notNull().default(0),
    charges: money('charges').notNull().default(0),
    /** The bank account it was paid from; null = cash. */
    accountId: uuid('account_id'),
    /** part / prepay: keep the EMI and finish sooner (tenure) or keep the end date (emi). */
    reschedule: text('reschedule').notNull().default('tenure'),
    notes: text('notes').notNull().default(''),
    /** §194A TDS kept from the interest (posted Cr TDS Payable), on `tdsBase` at `tdsRate` %. */
    tdsAmount: money('tds_amount').notNull().default(0),
    tdsBase: money('tds_base').notNull().default(0),
    tdsRate: money('tds_rate').notNull().default(0),
    /** The part of `interest` that pays interest credited earlier (gross), and the TDS already kept on it then. */
    accruedSettled: money('accrued_settled').notNull().default(0),
    accruedTds: money('accrued_tds').notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('loan_payments_loan').on(t.orgId, t.loanId, t.date),
  ],
);

/**
 * §194A at credit: interest credited to a lender's account before it is paid (an EMI fallen due, the 31 March accrual).
 * TDS is due at credit or payment, whichever is first, so it is kept here; the payment that later pays this interest
 * clears Interest Payable instead (loan_payments.accrued_settled).
 */
export const loanInterestCredits = pgTable(
  'loan_interest_credits',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    loanId: uuid('loan_id').notNull(),
    date: date('date').notNull(),
    amount: money('amount').notNull(),
    tdsAmount: money('tds_amount').notNull().default(0),
    tdsBase: money('tds_base').notNull().default(0),
    tdsRate: money('tds_rate').notNull().default(0),
    notes: text('notes').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    index('loan_interest_credits_loan').on(t.orgId, t.loanId, t.date),
  ],
);

/**
 * P5-S6: a bank ledger entry ticked off against a statement row, or (`ignored`, no entry) a statement row the user chose
 * to leave out (a duplicate line, a reversal the bank undid itself).
 */
export const bankRecon = pgTable(
  'bank_recon',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    bankAccountId: uuid('bank_account_id').notNull(),
    entryId: uuid('entry_id'),
    statementRowHash: text('statement_row_hash').notNull(),
    statementDate: date('statement_date'),
    clearedOn: date('cleared_on').notNull(),
    ignored: boolean('ignored').notNull().default(false),
    reason: text('reason').notNull().default(''),
  },
  (t) => [
    uniqueIndex('bank_recon_live_entry')
      .on(t.orgId, t.entryId)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('bank_recon_live_row')
      .on(t.orgId, t.bankAccountId, t.statementRowHash)
      .where(sql`${t.deletedAt} is null`),
  ],
);
