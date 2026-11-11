import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';

// Vyapar parity Phase 5 (Cash & Bank): bank accounts (P5-S1), cash entries (P5-S2), transfers (P5-S3), cheques (P5-S4),
// loans (P5-S5), reconciliation (P5-S6) and the dashboard summary (P5-S7). Behind the per-business `cashbank` flag,
// which needs the ledger (`accounting.ledger`) on.

const money = z.number().finite();
const positive = z.number().finite().positive();
const notNegative = z.number().finite().min(0);
const blankOr = (re: RegExp, message: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || re.test(v), message)
    .default('');

export const cashbankStatusQuery = z.object({ businessId: uuid });
export const cashbankStatus = z.object({
  /** `cashbank` is on. */
  enabled: z.boolean(),
  /** `accounting.ledger` is on (Cash & Bank needs it). */
  ledger: z.boolean(),
  /** Banks may go below zero on a transfer (an OD or CC account always may). */
  allowOverdraft: z.boolean(),
});
export const cashbankSettingsInput = z.object({
  businessId: uuid,
  enabled: z.boolean(),
  allowOverdraft: z.boolean().optional(),
});

// ---- bank accounts (P5-S1) ----
export const BANK_ACCOUNT_TYPES = ['current', 'savings', 'od', 'cc'] as const;
export const bankAccountInput = z.object({
  businessId: uuid,
  /** Display name, unique per business. */
  label: z.string().trim().min(1).max(100),
  accountType: z.enum(BANK_ACCOUNT_TYPES).default('current'),
  bankName: z.string().trim().max(100).default(''),
  accountHolderName: z.string().trim().max(100).default(''),
  accountNumber: blankOr(/^\d{9,18}$/, 'Account number is 9 to 18 digits'),
  ifsc: blankOr(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Not a valid IFSC (like HDFC0000123)'),
  branch: z.string().trim().max(150).default(''),
  swift: z.string().trim().max(20).default(''),
  upiId: blankOr(
    /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/,
    'A UPI ID looks like name@bank',
  ),
  /** Signed: negative = overdrawn. Posted against Opening Balance Equity on `openingDate`. */
  openingBalance: money.default(0),
  openingDate: isoDate.optional(),
  printOnInvoice: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).default(''),
});
export const bankAccountPatch = bankAccountInput.omit({ businessId: true }).partial();
export const bankAccount = z.object({
  id: uuid,
  businessId: uuid,
  label: z.string(),
  accountType: z.string(),
  bankName: z.string(),
  accountHolderName: z.string(),
  accountNumber: z.string(),
  /** ••4521 */
  accountNumberMasked: z.string(),
  ifsc: z.string(),
  branch: z.string(),
  swift: z.string(),
  upiId: z.string(),
  openingBalance: z.number(),
  openingDate: z.string().nullable(),
  printOnInvoice: z.boolean(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  notes: z.string(),
  /** Its chart account (1101…). */
  accountId: uuid,
  code: z.string(),
  /** Σ debit − Σ credit of the chart account. */
  balance: z.number(),
  lastTxn: z.string().nullable(),
  ...withStamps,
});
export const bankAccountListQuery = z.object({
  businessId: uuid,
  /** '1' = switched-off accounts too. */
  all: z.enum(['0', '1']).default('0'),
});

/** Cash in Hand and every bank: the pickers for transfers and money modes. */
export const cashBankAccount = z.object({
  accountId: uuid,
  code: z.string(),
  name: z.string(),
  kind: z.enum(['cash', 'bank']),
  /** The payment_accounts id of a bank; null for Cash in Hand. */
  bankAccountId: uuid.nullable(),
  accountType: z.string().nullable(),
  balance: z.number(),
});

export const statementQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  all: z.enum(['0', '1']).default('0'),
});
export const statementRow = z.object({
  id: uuid,
  txnDate: z.string(),
  refType: z.string(),
  refId: uuid,
  partyId: uuid.nullable(),
  partyName: z.string().nullable(),
  narration: z.string(),
  deposit: z.number(),
  withdrawal: z.number(),
  running: z.number(),
  reconciled: z.boolean(),
  reversalOf: uuid.nullable(),
});
export const accountStatement = z.object({
  account: cashBankAccount,
  opening: z.number(),
  deposits: z.number(),
  withdrawals: z.number(),
  closing: z.number(),
  rows: z.array(statementRow),
});

// ---- cash and bank entries (P5-S1 deposit / withdraw, P5-S2 adjust, day-end count) ----
export const CASH_ENTRY_KINDS = ['adjust', 'count', 'deposit', 'withdraw'] as const;
export const cashEntryInput = z.object({
  businessId: uuid,
  /** The cash or bank chart account. Left out = Cash in Hand. */
  accountId: uuid.optional(),
  kind: z.enum(['adjust', 'deposit', 'withdraw']).default('adjust'),
  direction: z.enum(['increase', 'reduce']),
  amount: positive,
  date: isoDate,
  remarks: z.string().max(300).default(''),
  /** Adjust: more cash is Other Income, less is Cash Over / Short, instead of Opening Balance Equity. */
  countAsIncome: z.boolean().default(false),
  /** Withdraw: what the money went on. */
  category: z.enum(['drawings', 'bank_charges', 'other']).optional(),
  /** Withdraw → other / deposit from: the chart account on the other side. */
  counterAccountId: uuid.optional(),
});
export const dayEndCountInput = z.object({
  businessId: uuid,
  date: isoDate,
  counted: notNegative,
  remarks: z.string().max(300).default(''),
});
export const cashEntry = z.object({
  id: uuid,
  businessId: uuid,
  accountId: uuid,
  kind: z.enum(CASH_ENTRY_KINDS),
  direction: z.enum(['increase', 'reduce']),
  amount: z.number(),
  date: z.string(),
  remarks: z.string(),
  countAsIncome: z.boolean(),
  category: z.string().nullable(),
  counterAccountId: uuid.nullable(),
  systemBalance: z.number().nullable(),
  counted: z.number().nullable(),
  ...withStamps,
});
export const dayEndResult = z.object({
  system: z.number(),
  counted: z.number(),
  difference: z.number(),
  /** null when the count matched: nothing was posted. */
  entry: cashEntry.nullable(),
});
export const cashEntryListQuery = z.object({ businessId: uuid, accountId: uuid.optional() });

// ---- transfers (P5-S3) ----
export const transferInput = z
  .object({
    businessId: uuid,
    fromAccountId: uuid,
    toAccountId: uuid,
    amount: positive,
    fee: notNegative.default(0),
    date: isoDate,
    reference: z.string().max(100).default(''),
    notes: z.string().max(500).default(''),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'From and To must be different accounts',
    path: ['toAccountId'],
  });
export const transfer = z.object({
  id: uuid,
  businessId: uuid,
  fromAccountId: uuid,
  toAccountId: uuid,
  fromName: z.string(),
  toName: z.string(),
  amount: z.number(),
  fee: z.number(),
  date: z.string(),
  reference: z.string(),
  notes: z.string(),
  ...withStamps,
});
export const transferListQuery = z.object({ businessId: uuid });

// ---- cheques (P5-S4) ----
export const CHEQUE_STATUSES = ['open', 'deposited', 'cleared', 'bounced', 'cancelled'] as const;
export const CHEQUE_ACTIONS = ['deposit', 'clear', 'bounce', 'cancel'] as const;
export const chequeInput = z.object({
  businessId: uuid,
  direction: z.enum(['received', 'issued']),
  partyId: uuid,
  number: z.string().trim().min(1).max(30),
  amount: positive,
  chequeDate: isoDate,
  /** When it was received or handed over; the payment is dated this day. */
  receivedDate: isoDate,
  /** Bank account (payment_accounts id) it goes into (received) or is drawn on (issued). */
  bankAccountId: uuid.nullable().optional(),
  reminderDays: z.number().int().min(0).max(90).default(3),
  notes: z.string().max(500).default(''),
  /** Link documents: invoices (received) or purchase bills (issued) the cheque pays. */
  allocations: z
    .array(z.object({ invoiceId: uuid.optional(), purchaseId: uuid.optional(), amount: positive }))
    .default([]),
  autoAllocate: z.boolean().default(false),
});
export const chequeActionInput = z.object({
  action: z.enum(CHEQUE_ACTIONS),
  date: isoDate,
  /** Deposit / clear: the bank account, when not chosen before. */
  bankAccountId: uuid.optional(),
  /** Bounce only. */
  bounceCharges: notNegative.default(0),
  chargeTo: z.enum(['party', 'us']).default('party'),
  note: z.string().max(300).default(''),
});
export const cheque = z.object({
  id: uuid,
  businessId: uuid,
  direction: z.enum(['received', 'issued']),
  partyId: uuid,
  partyName: z.string(),
  number: z.string(),
  amount: z.number(),
  chequeDate: z.string(),
  receivedDate: z.string(),
  bankAccountId: uuid.nullable(),
  status: z.enum(CHEQUE_STATUSES),
  statusDate: z.string().nullable(),
  bounceCharges: z.number(),
  chargeTo: z.enum(['party', 'us']),
  paymentId: uuid.nullable(),
  reminderDays: z.number(),
  notes: z.string(),
  /** What the register can do with it now. */
  actions: z.array(z.enum(CHEQUE_ACTIONS)),
  postDated: z.boolean(),
  due: z.boolean(),
  /** RBI: valid three months from its date. Past this day it is stale and can not be presented. */
  validTill: z.string(),
  stale: z.boolean(),
  noticeServedOn: z.string().nullable(),
  /** A bounced received cheque: the Negotiable Instruments Act §138 / §142 dates. */
  section138: z
    .object({
      stage: z.enum([
        'send_notice',
        'notice_overdue',
        'awaiting_payment',
        'complaint_window',
        'complaint_lapsed',
      ]),
      noticeBy: z.string(),
      daysLeft: z.number(),
      payBy: z.string().nullable(),
      complaintFrom: z.string().nullable(),
      complaintBy: z.string().nullable(),
    })
    .nullable(),
  ...withStamps,
});
export const chequePatch = z.object({
  /** When the §138 demand notice reached the drawer; null clears it. */
  noticeServedOn: isoDate.nullable().optional(),
  reminderDays: z.number().int().min(0).max(90).optional(),
  notes: z.string().max(500).optional(),
});
export const chequeListQuery = z.object({
  businessId: uuid,
  direction: z.enum(['received', 'issued']).optional(),
  status: z.enum(CHEQUE_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ---- loans (P5-S5) ----
export const LOAN_TYPES = [
  'term',
  'od',
  'cc',
  'vehicle',
  'business',
  'personal',
  'housing',
  'education',
  'other',
] as const;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
export const LENDER_TYPES = ['bank', 'nbfc', 'company', 'individual', 'other'] as const;
/** §194A: who lent the money decides TDS on its interest (a bank is exempt). */
const lenderFields = {
  lenderType: z.enum(LENDER_TYPES).default('bank'),
  /** The lender's PAN; without it TDS is 20% (§206AA). */
  lenderPan: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || PAN.test(v), 'Not a valid PAN (like ABCDE1234F)')
    .default(''),
  lenderPartyId: uuid.nullable().default(null),
  /** No TDS on this loan's interest (Form 15G / 15H on file, or the business is not required to deduct). */
  tdsExempt: z.boolean().default(false),
};
export const loanInput = z.object({
  businessId: uuid,
  name: z.string().trim().min(1).max(100),
  lender: z.string().trim().max(100).default(''),
  type: z.enum(LOAN_TYPES).default('term'),
  principal: positive,
  ratePct: z.number().finite().min(0).max(100),
  interestType: z.enum(['reducing', 'flat']).default('reducing'),
  tenureMonths: z.number().int().min(1).max(600),
  /** Left out = the formula's EMI. */
  emi: positive.optional(),
  firstEmiDate: isoDate,
  receivedOn: isoDate,
  /** payment_accounts id; null = received in cash. */
  receivedAccountId: uuid.nullable().default(null),
  processingFee: notNegative.default(0),
  purpose: z.enum(['business', 'housing', 'education', 'other']).default('business'),
  notes: z.string().max(500).default(''),
  ...lenderFields,
  /** §269SS: taking ₹20,000 or more in cash needs this typed acknowledgement (it is audited). */
  cashAcknowledgement: z.string().trim().max(300).optional(),
});
export const loanPatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  lender: z.string().trim().max(100).optional(),
  notes: z.string().max(500).optional(),
  purpose: z.enum(['business', 'housing', 'education', 'other']).optional(),
  lenderType: z.enum(LENDER_TYPES).optional(),
  lenderPan: lenderFields.lenderPan.optional(),
  lenderPartyId: uuid.nullable().optional(),
  tdsExempt: z.boolean().optional(),
});
export const scheduleRow = z.object({
  n: z.number(),
  dueDate: z.string(),
  emi: z.number(),
  principalPart: z.number(),
  interestPart: z.number(),
  balanceAfter: z.number(),
  status: z.enum(['due', 'paid', 'part']),
  paidOn: z.string().nullable(),
  paidPrincipal: z.number(),
  paidInterest: z.number(),
});
export const loanPayment = z.object({
  id: uuid,
  loanId: uuid,
  date: z.string(),
  kind: z.enum(['emi', 'part', 'prepay', 'topup']),
  principal: z.number(),
  interest: z.number(),
  charges: z.number(),
  accountId: uuid.nullable(),
  reschedule: z.enum(['tenure', 'emi']),
  notes: z.string(),
  tdsAmount: z.number(),
  tdsBase: z.number(),
  tdsRate: z.number(),
  /** Of `interest`, what pays interest credited earlier, and the TDS already kept on it then. */
  accruedSettled: z.number(),
  accruedTds: z.number(),
  ...withStamps,
});
export const loan = z.object({
  id: uuid,
  businessId: uuid,
  name: z.string(),
  lender: z.string(),
  type: z.string(),
  principal: z.number(),
  ratePct: z.number(),
  interestType: z.enum(['reducing', 'flat']),
  tenureMonths: z.number(),
  emi: z.number(),
  firstEmiDate: z.string(),
  receivedOn: z.string(),
  receivedAccountId: uuid.nullable(),
  processingFee: z.number(),
  purpose: z.string(),
  lenderType: z.enum(LENDER_TYPES),
  lenderPan: z.string(),
  lenderPartyId: uuid.nullable(),
  tdsExempt: z.boolean(),
  /** §194A TDS kept from this loan's interest so far (at payment and at credit). */
  tdsDeducted: z.number(),
  /** Interest credited to the lender and not paid yet (gross). */
  interestCreditedUnpaid: z.number(),
  status: z.enum(['active', 'closed']),
  notes: z.string(),
  /** Its chart account (2301…). */
  accountId: uuid,
  code: z.string(),
  /** Principal still owed, by the schedule (equals the loan account's credit balance). */
  outstanding: z.number(),
  interestPaid: z.number(),
  nextDue: z
    .object({ n: z.number(), dueDate: z.string(), principal: z.number(), interest: z.number() })
    .nullable(),
  ...withStamps,
});
export const loanInterestCredit = z.object({
  id: uuid,
  loanId: uuid,
  date: z.string(),
  amount: z.number(),
  tdsAmount: z.number(),
  tdsBase: z.number(),
  tdsRate: z.number(),
  notes: z.string(),
  ...withStamps,
});
export const loanInterestCreditInput = z.object({
  date: isoDate,
  amount: positive,
  notes: z.string().max(300).default(''),
  /** §194A TDS. Left out = worked out from the lender and the year's interest; give it to override. */
  tdsAmount: notNegative.optional(),
});
export const loanInterestCreditParams = z.object({ id: uuid, creditId: uuid });
export const loanDetail = loan.extend({
  schedule: z.array(scheduleRow),
  payments: z.array(loanPayment),
  credits: z.array(loanInterestCredit),
});
export const loanListQuery = z.object({ businessId: uuid });
export const loanStatement = z.object({
  outstanding: z.number(),
  rows: z.array(
    z.object({
      id: uuid,
      txnDate: z.string(),
      refType: z.string(),
      refId: uuid,
      narration: z.string(),
      /** Principal repaid (Dr the loan account). */
      repaid: z.number(),
      /** Principal borrowed (Cr the loan account). */
      borrowed: z.number(),
      outstanding: z.number(),
    }),
  ),
});
export const loanTaxQuery = z.object({
  businessId: uuid,
  /** '2026-27'; left out = the current financial year. */
  fy: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});
export const loanTaxSummary = z.object({
  fy: z.string(),
  items: z.array(
    z.object({
      loanId: uuid,
      name: z.string(),
      purpose: z.string(),
      interest: z.number(),
      principal: z.number(),
    }),
  ),
  suggestions: z.object({
    '24b': z.number(),
    housingInterest: z.number(),
    '80C': z.number(),
    '80E': z.number(),
  }),
});
export const loanPaymentInput = z.object({
  /** topup = Increase Loan: more principal borrowed, received into `accountId`. */
  kind: z.enum(['emi', 'part', 'prepay', 'topup']).default('emi'),
  date: isoDate,
  principal: notNegative,
  interest: notNegative.default(0),
  charges: notNegative.default(0),
  /** payment_accounts id it is paid from; null = cash. */
  accountId: uuid.nullable().default(null),
  reschedule: z.enum(['tenure', 'emi']).default('tenure'),
  notes: z.string().max(300).default(''),
  /** §194A TDS on the interest. Left out = worked out from the lender and the year's interest; give it to override. */
  tdsAmount: notNegative.optional(),
  /** §269SS / §269T: ₹20,000 or more in cash needs this typed acknowledgement (it is audited). */
  cashAcknowledgement: z.string().trim().max(300).optional(),
});
export const loanPaymentParams = z.object({ id: uuid, paymentId: uuid });

// ---- reconciliation (P5-S6) ----
export const statementLine = z.object({
  date: isoDate,
  description: z.string().max(500).default(''),
  debit: notNegative.default(0),
  credit: notNegative.default(0),
  balance: z.number().finite().nullable().optional(),
});
export const reconMatchInput = z.object({
  rows: z.array(statementLine).max(5000),
  toleranceDays: z.number().int().min(0).max(15).default(3),
});
export const reconEntry = z.object({
  id: uuid,
  txnDate: z.string(),
  narration: z.string(),
  reference: z.string().nullable(),
  deposit: z.number(),
  withdrawal: z.number(),
  reconciled: z.boolean(),
});
export const reconMatchResult = z.object({
  hashes: z.array(z.string()),
  matches: z.array(
    z.object({
      row: z.number(),
      hash: z.string(),
      entryId: uuid,
      days: z.number(),
      byReference: z.boolean(),
    }),
  ),
  /** Statement rows reconciled before (same fingerprint): shown as done. */
  alreadyReconciled: z.array(z.number()),
  unmatchedRows: z.array(z.number()),
  unmatchedEntries: z.array(uuid),
  entries: z.array(reconEntry),
  bookBalance: z.number(),
});
export const reconSaveInput = z.object({
  matches: z
    .array(
      z.object({
        entryId: uuid,
        hash: z.string().min(1).max(64),
        statementDate: isoDate.optional(),
      }),
    )
    .max(5000),
  /** Closing balance on the statement. */
  statementBalance: z.number().finite(),
  clearedOn: isoDate,
  /** Needed when the statement and the books still differ after these matches. */
  reason: z.string().trim().max(300).optional(),
});
export const reconIgnoreInput = z.object({
  rows: z
    .array(
      z.object({
        hash: z.string().min(1).max(64),
        statementDate: isoDate.optional(),
        reason: z.string().trim().max(300).default(''),
      }),
    )
    .min(1)
    .max(5000),
});
export const reconSaveResult = z.object({
  reconciled: z.number(),
  bookBalance: z.number(),
  difference: z.number(),
});

// ---- dashboard (P5-S7) ----
export const cashbankSummary = z.object({
  cash: z.number(),
  bank: z.number(),
  total: z.number(),
  accounts: z.array(cashBankAccount),
  overdrawn: z.array(z.object({ name: z.string(), balance: z.number() })),
  chequesDue: z.object({
    count: z.number(),
    amount: z.number(),
    items: z.array(
      z.object({
        id: uuid,
        number: z.string(),
        partyName: z.string(),
        amount: z.number(),
        chequeDate: z.string(),
        direction: z.enum(['received', 'issued']),
        status: z.enum(CHEQUE_STATUSES),
      }),
    ),
  }),
  emiDue: z.object({
    count: z.number(),
    amount: z.number(),
    items: z.array(
      z.object({ loanId: uuid, name: z.string(), dueDate: z.string(), emi: z.number() }),
    ),
  }),
  /** §269ST: cash in from one party on one day at or over ₹2,00,000. */
  cashWatch: z.array(
    z.object({ partyId: uuid, partyName: z.string(), date: z.string(), total: z.number() }),
  ),
  /** §40A(3): cash paid out to one party on one day above ₹10,000. */
  cashOutWatch: z.array(
    z.object({ partyId: uuid, partyName: z.string(), date: z.string(), total: z.number() }),
  ),
});

// ---- IFSC lookup ----
export const ifscParam = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Not a valid IFSC (like HDFC0000123)'),
});
export const ifscDetails = z.object({
  ifsc: z.string(),
  bank: z.string(),
  branch: z.string(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  micr: z.string(),
  /** live = the IFSC directory answered; bundled = offline, only the bank name from the built-in table. */
  source: z.enum(['live', 'bundled']),
});
