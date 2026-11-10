import { z } from 'zod';
import { isoDate, uuid, withStamps } from './common.ts';

// Vyapar parity Phase 4 (ledger) and P10-S5 (TDS ledger): chart of accounts, the account ledger, journals, backfill,
// financial years, Verify My Data and TDS entries.

export const ACCOUNT_KINDS = ['asset', 'liability', 'income', 'expense', 'equity'] as const;
const side = z.enum(['Dr', 'Cr']);

export const accountInput = z.object({
  businessId: uuid,
  /** Left out = the next free code in the group's range. */
  code: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/, 'Use 3 to 6 digits')
    .optional(),
  name: z.string().trim().min(1).max(120),
  group: z.string().trim().min(1).max(60),
  /** Only needed in "Duties & taxes", which holds both credit we claim and tax we owe. */
  kind: z.enum(ACCOUNT_KINDS).optional(),
  /** Posted against Opening Balance Equity on `openingDate`. */
  opening: z.object({ amount: z.number().positive(), side, date: isoDate }).optional(),
});
export const accountPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
});
export const account = z.object({
  id: uuid,
  businessId: uuid,
  code: z.string(),
  name: z.string(),
  group: z.string(),
  kind: z.enum(ACCOUNT_KINDS),
  system: z.boolean(),
  active: z.boolean(),
  debit: z.number(),
  credit: z.number(),
  /** In the account's natural direction. */
  balance: z.number(),
  ...withStamps,
});
export const accountListQuery = z.object({
  businessId: uuid,
  kind: z.enum(ACCOUNT_KINDS).optional(),
  q: z.string().trim().max(60).optional(),
});

export const ledgerQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  partyId: uuid.optional(),
  /** Reversed pairs are hidden by default: the view shows what the books say now, `all` shows every row. */
  all: z.enum(['0', '1']).default('0'),
});
export const ledgerEntry = z.object({
  id: uuid,
  txnDate: z.string(),
  voucherId: uuid,
  refType: z.string(),
  refId: uuid,
  partyId: uuid.nullable(),
  narration: z.string(),
  debit: z.number(),
  credit: z.number(),
  reversalOf: uuid.nullable(),
  running: z.number(),
});
export const accountLedger = z.object({
  account: z.object({ id: uuid, code: z.string(), name: z.string(), kind: z.enum(ACCOUNT_KINDS) }),
  opening: z.number(),
  entries: z.array(ledgerEntry),
  debit: z.number(),
  credit: z.number(),
  closing: z.number(),
  /** Dr or Cr of the closing balance. */
  closingSide: side,
});

export const trialBalanceQuery = z.object({
  businessId: uuid,
  asOf: isoDate.optional(),
  fy: z.string().max(10).optional(),
});
export const trialBalanceResult = z.object({
  lines: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      kind: z.enum(ACCOUNT_KINDS),
      debit: z.number(),
      credit: z.number(),
    }),
  ),
  debit: z.number(),
  credit: z.number(),
  balanced: z.boolean(),
});

export const journalInput = z
  .object({
    businessId: uuid,
    date: isoDate,
    narration: z.string().trim().max(300).default(''),
    rows: z
      .array(
        z.object({
          accountId: uuid,
          debit: z.number().min(0).default(0),
          credit: z.number().min(0).default(0),
          partyId: uuid.nullish(),
        }),
      )
      .min(2)
      .max(50),
  })
  .superRefine((j, ctx) => {
    j.rows.forEach((r, i) => {
      if (r.debit > 0 === r.credit > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['rows', i],
          message: 'Each row has a debit or a credit, not both and not neither',
        });
    });
    const d = Math.round(j.rows.reduce((s, r) => s + r.debit, 0) * 100);
    const c = Math.round(j.rows.reduce((s, r) => s + r.credit, 0) * 100);
    if (d !== c)
      ctx.addIssue({
        code: 'custom',
        path: ['rows'],
        message: `Debits ${d / 100} and credits ${c / 100} must be equal`,
      });
  });
export const journal = z.object({
  id: uuid,
  number: z.string(),
  date: z.string(),
  narration: z.string(),
  total: z.number(),
  rows: z.array(
    z.object({
      accountId: uuid,
      code: z.string(),
      name: z.string(),
      debit: z.number(),
      credit: z.number(),
      partyId: uuid.nullable(),
    }),
  ),
});
export const journalListQuery = z.object({ businessId: uuid });

export const ledgerStatusQuery = z.object({ businessId: uuid });
export const ledgerStatus = z.object({
  enabled: z.boolean(),
  enabledAt: z.string().nullable(),
  accounts: z.number(),
  entries: z.number(),
});
export const backfillInput = z.object({
  businessId: uuid,
  /** Counts and a diff, writes nothing. */
  dryRun: z.boolean().default(true),
  /** Turn the ledger on even though party balances differ. Never the default. */
  force: z.boolean().default(false),
  from: isoDate.optional(),
});
export const backfillResult = z.object({
  dryRun: z.boolean(),
  documents: z.number(),
  vouchers: z.number(),
  problems: z.array(
    z.object({ kind: z.string(), id: z.string(), label: z.string(), message: z.string() }),
  ),
  diffs: z.array(
    z.object({ partyId: z.string(), name: z.string(), ledger: z.number(), documents: z.number() }),
  ),
  trialBalance: z
    .object({ debit: z.number(), credit: z.number(), balanced: z.boolean() })
    .nullable(),
  enabled: z.boolean(),
});

export const financialYear = z.object({
  id: uuid,
  label: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['open', 'closed']),
  lockedAt: z.string().nullable(),
});
export const financialYearsQuery = z.object({ businessId: uuid });
export const lockSettings = z.object({
  lockBefore: isoDate.nullable(),
  allowEditAfterGstFiled: z.boolean(),
});
export const lockSettingsInput = lockSettings.extend({ businessId: uuid });

export const verifyQuery = z.object({ businessId: uuid });
export const verifyCheck = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.enum(['error', 'warn', 'info']),
  count: z.number(),
  rows: z.array(z.record(z.string(), z.unknown())),
  fix: z.enum(['repost', 'trim_allocations']).optional(),
});
export const verifyResult = z.object({
  ranAt: z.string(),
  summary: z.object({ passed: z.number(), warnings: z.number(), errors: z.number() }),
  checks: z.array(verifyCheck),
});
export const verifyFixResult = z.object({ fixed: z.number(), check: verifyCheck });

export const tdsQuery = z.object({
  businessId: uuid,
  from: isoDate.optional(),
  to: isoDate.optional(),
  section: z.string().max(10).optional(),
});
export const tdsEntry = z.object({
  id: uuid,
  direction: z.string(),
  partyId: uuid.nullable(),
  partyName: z.string(),
  pan: z.string(),
  section: z.string(),
  baseAmount: z.number(),
  rate: z.number(),
  tdsAmount: z.number(),
  date: z.string(),
  refType: z.string(),
  refId: uuid,
  status: z.enum(['accrued', 'deposited']),
  challanNo: z.string().nullable(),
  bsrCode: z.string().nullable(),
  challanDate: z.string().nullable(),
  dueDate: z.string(),
  overdue: z.boolean(),
  interest: z.number(),
  panMissing: z.boolean(),
});
export const tdsList = z.object({
  data: z.array(tdsEntry),
  total: z.number(),
  deposited: z.number(),
  pending: z.number(),
});
export const tdsDepositInput = z.object({
  challanNo: z.string().trim().min(1).max(40),
  bsrCode: z
    .string()
    .trim()
    .regex(/^\d{7}$/, 'The BSR code is 7 digits'),
  challanDate: isoDate,
  accountId: uuid.nullish(),
});

export const itcQuery = z.object({ businessId: uuid, asOf: isoDate.optional() });
export const itcAtRisk = z.object({
  atRisk: z.array(
    z.object({
      id: z.string(),
      supplier: z.string(),
      number: z.string(),
      date: z.string(),
      unpaid: z.number(),
      itc: z.number(),
      daysLeft: z.number(),
    }),
  ),
  dueForReversal: z.array(
    z.object({
      id: z.string(),
      supplier: z.string(),
      number: z.string(),
      date: z.string(),
      unpaid: z.number(),
      itc: z.number(),
      daysLate: z.number(),
    }),
  ),
});
