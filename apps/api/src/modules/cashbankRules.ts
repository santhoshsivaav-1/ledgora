// Vyapar parity Phase 5 (Cash & Bank): the server side. The decisions are the pure functions in @ledgora/tax-engine
// (cashbank.ts, cheque.ts, loan.ts, posting.ts); this file reads the documents they need and writes what they return
// through ledgerRules.ts `repost()`, in the caller's transaction. Nothing here writes ledger_entries any other way.
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  ACC,
  maskAccount,
  postCashBankEntry,
  postCheque,
  postLoanDisbursal,
  postLoanInterestCredit,
  postLoanPayment,
  postOpening,
  postTransfer,
  scheduleFor,
  type ChequeStatus,
  type EntryKind,
  type LoanPaymentKind,
  type LoanTerms,
  type Posting,
  type WithdrawCategory,
} from '@ledgora/tax-engine';
import { AppError, notFound } from '../errors.ts';
import { ensureBankAccount, ledgerEnabled, nextCode, repost, seedChart } from './ledgerRules.ts';

const {
  accounts,
  ledgerEntries,
  businessSettings,
  paymentAccounts,
  parties,
  transfers,
  cashEntries,
  cheques,
  loans,
  loanSchedule,
  loanPayments,
  loanInterestCredits,
  bankRecon,
} = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

// ---- the flag ----------------------------------------------------------------------------------------------------------

type Prefs = {
  cashbank?: { enabled?: boolean; allowOverdraft?: boolean; enabledAt?: string };
} & Record<string, unknown>;

/** `cashbank`, per business. It only counts when the ledger (`accounting.ledger`) is on too. */
export async function cashbankSettings(tx: Tx, businessId: string) {
  const ledger = await ledgerEnabled(tx, businessId);
  const [s] = await tx
    .select({ p: businessSettings.preferences })
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  const cb = (s?.p as Prefs | undefined)?.cashbank ?? {};
  return { enabled: ledger && !!cb.enabled, ledger, allowOverdraft: !!cb.allowOverdraft };
}
export const cashbankEnabled = async (tx: Tx, businessId: string) =>
  (await cashbankSettings(tx, businessId)).enabled;

export async function requireCashbank(tx: Tx, businessId: string) {
  const s = await cashbankSettings(tx, businessId);
  if (!s.ledger)
    throw new AppError(
      'conflict',
      'Cash & Bank needs the accounting ledger. Turn the ledger on in Accounting first.',
    );
  if (!s.enabled)
    throw new AppError('conflict', 'Cash & Bank is off for this business. Turn it on first.');
  return s;
}

/**
 * Switches Cash & Bank on or off. Turning it on seeds the accounts it needs (idempotent), gives every bank account its
 * chart account and posts its opening balance. Off keeps the documents and their postings; only the screens go away.
 */
export async function setCashbank(
  tx: Tx,
  orgId: string,
  businessId: string,
  o: { enabled: boolean; allowOverdraft?: boolean },
) {
  if (o.enabled && !(await ledgerEnabled(tx, businessId)))
    throw new AppError(
      'conflict',
      'Cash & Bank needs the accounting ledger. Turn the ledger on in Accounting first.',
    );
  const [s] = await tx
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  const prev = (s?.preferences ?? {}) as Prefs;
  const preferences: Prefs = {
    ...prev,
    cashbank: {
      ...prev.cashbank,
      enabled: o.enabled,
      ...(o.allowOverdraft !== undefined ? { allowOverdraft: o.allowOverdraft } : {}),
      ...(o.enabled && !prev.cashbank?.enabled ? { enabledAt: new Date().toISOString() } : {}),
    },
  };
  if (s)
    await tx
      .update(businessSettings)
      .set({ preferences, updatedAt: new Date() })
      .where(eq(businessSettings.id, s.id));
  else await tx.insert(businessSettings).values({ orgId, businessId, preferences });
  if (!o.enabled) return;
  await seedChart(tx, orgId, businessId);
  for (const bank of await tx
    .select()
    .from(paymentAccounts)
    .where(and(eq(paymentAccounts.businessId, businessId), isNull(paymentAccounts.deletedAt)))) {
    // An opening balance needs a date; one that never had one is dated the day the bank was added.
    if (!bank.openingDate)
      await tx
        .update(paymentAccounts)
        .set({ openingDate: bank.createdAt.toISOString().slice(0, 10) })
        .where(eq(paymentAccounts.id, bank.id));
    await syncBankOpening(tx, orgId, bank.id);
  }
}

// ---- money accounts ----------------------------------------------------------------------------------------------------

export async function chartAccountOf(tx: Tx, businessId: string, id: string) {
  const [a] = await tx
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.id, id), eq(accounts.businessId, businessId), isNull(accounts.deletedAt)),
    );
  if (!a) throw notFound('Account');
  return a;
}
const byCode = async (tx: Tx, businessId: string, code: string) => {
  const [a] = await tx
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.businessId, businessId), eq(accounts.code, code), isNull(accounts.deletedAt)),
    );
  if (!a)
    throw new AppError('conflict', `The ledger has no account ${code}; enable the ledger first`);
  return a;
};
export const cashAccountOf = (tx: Tx, businessId: string) => byCode(tx, businessId, ACC.CASH);

/** A live bank account (payment_accounts row) of the business. */
export async function bankOf(tx: Tx, businessId: string, id: string) {
  const [b] = await tx
    .select()
    .from(paymentAccounts)
    .where(
      and(
        eq(paymentAccounts.id, id),
        eq(paymentAccounts.businessId, businessId),
        isNull(paymentAccounts.deletedAt),
      ),
    );
  if (!b) throw notFound('Bank account');
  return b;
}

/** The chart account of a bank, created if it has none yet. */
export async function bankChartOf(tx: Tx, orgId: string, businessId: string, bankId: string) {
  await bankOf(tx, businessId, bankId);
  const code = await ensureBankAccount(tx, orgId, businessId, bankId);
  if (!code) throw notFound('Bank account');
  return byCode(tx, businessId, code);
}

/** Chart code of where money is: a bank (by payment_accounts id) or, with none, Cash in Hand. */
export async function moneyCode(tx: Tx, orgId: string, businessId: string, bankId?: string | null) {
  return bankId ? (await bankChartOf(tx, orgId, businessId, bankId)).code : ACC.CASH;
}

/** Cash and bank chart accounts are the only ones money can be moved between. */
export function assertMoneyAccount(a: typeof accounts.$inferSelect) {
  if (a.code !== ACC.CASH && a.group !== 'Bank')
    throw new AppError('unprocessable', `${a.name} is not Cash in Hand or a bank account`);
}

/** Σ debit − Σ credit (and the last entry date) of each account, over the whole ledger or up to `asOf`. */
export async function balancesOf(tx: Tx, ids: string[], asOf?: string) {
  const out = new Map<string, { balance: number; last: string | null }>();
  if (!ids.length) return out;
  const rows = await tx
    .select({
      id: ledgerEntries.accountId,
      d: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)::float8`,
      c: sql<number>`coalesce(sum(${ledgerEntries.credit}), 0)::float8`,
      last: sql<string | null>`max(${ledgerEntries.txnDate})::text`,
    })
    .from(ledgerEntries)
    .where(
      and(
        inArray(ledgerEntries.accountId, ids),
        asOf ? sql`${ledgerEntries.txnDate} <= ${asOf}` : undefined,
      ),
    )
    .groupBy(ledgerEntries.accountId);
  for (const r of rows) out.set(r.id, { balance: r2(r.d - r.c), last: r.last });
  return out;
}

/**
 * Cash in Hand, every live bank, and "Bank (not assigned)" when money sits there: the pickers for transfers and the
 * Cash + Bank total, each with its balance.
 */
export async function moneyAccounts(tx: Tx, orgId: string, businessId: string) {
  const cash = await cashAccountOf(tx, businessId);
  const banks = await tx
    .select()
    .from(paymentAccounts)
    .where(
      and(
        eq(paymentAccounts.businessId, businessId),
        isNull(paymentAccounts.deletedAt),
        eq(paymentAccounts.isActive, true),
      ),
    )
    .orderBy(asc(paymentAccounts.createdAt));
  const charts = [];
  for (const b of banks) charts.push({ b, a: await bankChartOf(tx, orgId, businessId, b.id) });
  const unassigned = await byCode(tx, businessId, ACC.BANK_UNASSIGNED);
  const bal = await balancesOf(tx, [cash.id, unassigned.id, ...charts.map((x) => x.a.id)]);
  type Row = {
    accountId: string;
    code: string;
    name: string;
    kind: 'cash' | 'bank';
    bankAccountId: string | null;
    accountType: string | null;
    balance: number;
  };
  const out: Row[] = [
    {
      accountId: cash.id,
      code: cash.code,
      name: cash.name,
      kind: 'cash' as const,
      bankAccountId: null,
      accountType: null,
      balance: bal.get(cash.id)?.balance ?? 0,
    },
    ...charts.map(({ a, b }) => ({
      accountId: a.id,
      code: a.code,
      name: b.label,
      kind: 'bank' as const,
      bankAccountId: b.id,
      accountType: b.accountType || null,
      balance: bal.get(a.id)?.balance ?? 0,
    })),
  ];
  const u = bal.get(unassigned.id);
  if (u && Math.abs(u.balance) > 0.005)
    out.push({
      accountId: unassigned.id,
      code: unassigned.code,
      name: unassigned.name,
      kind: 'bank',
      bankAccountId: null,
      accountType: null,
      balance: u.balance,
    });
  return out;
}

/** A bank account as the API answers it. */
export const toBankAccount = (
  b: typeof paymentAccounts.$inferSelect,
  a: typeof accounts.$inferSelect,
  bal?: { balance: number; last: string | null },
) => ({
  id: b.id,
  businessId: b.businessId,
  label: b.label,
  accountType: b.accountType,
  bankName: b.bankName,
  accountHolderName: b.accountHolderName,
  accountNumber: b.accountNumber,
  accountNumberMasked: maskAccount(b.accountNumber),
  ifsc: b.ifsc,
  branch: b.branch,
  swift: b.swift,
  upiId: b.upiId,
  openingBalance: b.openingBalance,
  openingDate: b.openingDate,
  printOnInvoice: b.printOnInvoice,
  isDefault: b.isDefault,
  isActive: b.isActive,
  notes: b.notes,
  accountId: a.id,
  code: a.code,
  balance: bal?.balance ?? 0,
  lastTxn: bal?.last ?? null,
  createdAt: b.createdAt.toISOString(),
  updatedAt: b.updatedAt.toISOString(),
});

const entriesOn = async (tx: Tx, accountId: string) =>
  (
    await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId))
  )[0].n;

/** Refuses to remove a bank whose chart account has entries (P5-S1 acceptance 3): switch it off instead. */
export async function assertBankRemovable(tx: Tx, bankId: string) {
  const [a] = await tx.select().from(accounts).where(eq(accounts.bankAccountId, bankId));
  if (a && (await entriesOn(tx, a.id)) > 0)
    throw new AppError(
      'conflict',
      'This bank account has entries in the books. Switch it off (inactive) instead of deleting it.',
    );
  return a ?? null;
}

// ---- postings of each document -----------------------------------------------------------------------------------------

/** A bank's opening balance, against Opening Balance Equity (signed: negative = overdrawn = Cr). */
export async function syncBankOpening(tx: Tx, orgId: string, bankId: string) {
  const [b] = await tx.select().from(paymentAccounts).where(eq(paymentAccounts.id, bankId));
  if (!b || !(await ledgerEnabled(tx, b.businessId))) return;
  const code = await ensureBankAccount(tx, orgId, b.businessId, b.id);
  if (!code) return;
  const amount = r2(b.openingBalance);
  const postings: Posting[] =
    b.deletedAt || !amount
      ? []
      : postOpening({
          id: b.id,
          date: b.openingDate ?? today(),
          account: code,
          amount: Math.abs(amount),
          side: amount > 0 ? 'Dr' : 'Cr',
        });
  await repost(tx, orgId, { businessId: b.businessId, refType: 'opening', refId: b.id, postings });
}

const codesOf = async (tx: Tx, ids: string[]) =>
  new Map(
    (
      await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(inArray(accounts.id, ids))
    ).map((a) => [a.id, a.code]),
  );

/** The loan's chart account (2301…, group Loans), created with the loan. */
export async function loanChartOf(
  tx: Tx,
  orgId: string,
  loan: { id: string; businessId: string; name: string },
) {
  const [found] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.businessId, loan.businessId), eq(accounts.loanId, loan.id)));
  if (found) return found;
  const code = await nextCode(tx, loan.businessId, 2301, 2399);
  const [a] = await tx
    .insert(accounts)
    .values({
      orgId,
      businessId: loan.businessId,
      code,
      name: loan.name,
      group: 'Loans',
      kind: 'liability',
      loanId: loan.id,
    })
    .returning();
  return a;
}

export type CashbankKind =
  'transfer' | 'cash_entry' | 'cheque' | 'loan' | 'loan_payment' | 'loan_interest';
const REF_TYPE: Record<CashbankKind, string> = {
  transfer: 'transfer',
  cash_entry: 'adjustment',
  cheque: 'cheque',
  loan: 'loan',
  loan_payment: 'loan_payment',
  loan_interest: 'loan_interest',
};

async function postingsOf(tx: Tx, orgId: string, kind: CashbankKind, id: string) {
  if (kind === 'transfer') {
    const [t] = await tx.select().from(transfers).where(eq(transfers.id, id));
    if (!t) return null;
    if (t.deletedAt) return { businessId: t.businessId, postings: [] };
    const codes = await codesOf(tx, [t.fromAccountId, t.toAccountId]);
    return {
      businessId: t.businessId,
      postings: postTransfer({
        id: t.id,
        date: t.date,
        from: codes.get(t.fromAccountId)!,
        to: codes.get(t.toAccountId)!,
        amount: t.amount,
        fee: t.fee,
        narration: t.reference ? `Transfer ${t.reference}` : t.notes || 'Transfer',
      }),
    };
  }
  if (kind === 'cash_entry') {
    const [e] = await tx.select().from(cashEntries).where(eq(cashEntries.id, id));
    if (!e) return null;
    if (e.deletedAt) return { businessId: e.businessId, postings: [] };
    const codes = await codesOf(tx, [
      e.accountId,
      ...(e.counterAccountId ? [e.counterAccountId] : []),
    ]);
    const label = {
      adjust: 'Adjustment',
      count: 'Day-end count',
      deposit: 'Deposit',
      withdraw: 'Withdrawal',
    };
    return {
      businessId: e.businessId,
      postings: postCashBankEntry({
        id: e.id,
        date: e.date,
        account: codes.get(e.accountId)!,
        amount: e.amount,
        direction: e.direction as 'increase' | 'reduce',
        kind: e.kind as EntryKind,
        countAsIncome: e.countAsIncome,
        category: (e.category ?? undefined) as WithdrawCategory | undefined,
        counter: e.counterAccountId ? codes.get(e.counterAccountId) : null,
        narration: [label[e.kind as EntryKind] ?? 'Adjustment', e.remarks]
          .filter(Boolean)
          .join(': '),
      }),
    };
  }
  if (kind === 'cheque') {
    const [c] = await tx.select().from(cheques).where(eq(cheques.id, id));
    if (!c) return null;
    if (c.deletedAt) return { businessId: c.businessId, postings: [] };
    const bank = c.bankAccountId
      ? await moneyCode(tx, orgId, c.businessId, c.bankAccountId)
      : ACC.BANK_UNASSIGNED;
    return {
      businessId: c.businessId,
      postings: postCheque(
        {
          id: c.id,
          direction: c.direction as 'received' | 'issued',
          status: c.status as ChequeStatus,
          amount: c.amount,
          partyId: c.partyId,
          receivedDate: c.receivedDate,
          statusDate: c.statusDate,
          paymentId: c.paymentId,
          bounceCharges: c.bounceCharges,
          chargeTo: c.chargeTo as 'party' | 'us',
          number: c.number,
        },
        bank,
      ),
    };
  }
  if (kind === 'loan') {
    const [l] = await tx.select().from(loans).where(eq(loans.id, id));
    if (!l) return null;
    if (l.deletedAt) return { businessId: l.businessId, postings: [] };
    const acct = await loanChartOf(tx, orgId, l);
    return {
      businessId: l.businessId,
      postings: postLoanDisbursal({
        id: l.id,
        date: l.receivedOn,
        loanAccount: acct.code,
        bankAccount: await moneyCode(tx, orgId, l.businessId, l.receivedAccountId),
        amount: l.principal,
        fee: l.processingFee,
      }),
    };
  }
  if (kind === 'loan_interest') {
    const [cr] = await tx.select().from(loanInterestCredits).where(eq(loanInterestCredits.id, id));
    if (!cr) return null;
    if (cr.deletedAt) return { businessId: cr.businessId, postings: [] };
    return {
      businessId: cr.businessId,
      postings: postLoanInterestCredit({
        id: cr.id,
        date: cr.date,
        amount: cr.amount,
        tds: cr.tdsAmount,
        narration: cr.notes ? `Interest credited: ${cr.notes}` : 'Interest credited',
      }),
    };
  }
  const [p] = await tx.select().from(loanPayments).where(eq(loanPayments.id, id));
  if (!p) return null;
  if (p.deletedAt) return { businessId: p.businessId, postings: [] };
  const [l] = await tx.select().from(loans).where(eq(loans.id, p.loanId));
  const acct = await loanChartOf(tx, orgId, l);
  // Increase Loan: more money borrowed on the same loan, posted like the loan itself (Dr Bank / Cr Loan).
  if (p.kind === 'topup')
    return {
      businessId: p.businessId,
      postings: postLoanDisbursal({
        id: p.id,
        date: p.date,
        loanAccount: acct.code,
        bankAccount: await moneyCode(tx, orgId, p.businessId, p.accountId),
        amount: p.principal,
        fee: p.charges,
        refType: 'loan_payment',
        narration: 'Loan increased',
      }),
    };
  return {
    businessId: p.businessId,
    postings: postLoanPayment({
      id: p.id,
      date: p.date,
      loanAccount: acct.code,
      bankAccount: await moneyCode(tx, orgId, p.businessId, p.accountId),
      principal: p.principal,
      interest: p.interest,
      fees: p.charges,
      tds: p.tdsAmount,
      accrued: p.accruedSettled,
      accruedTds: p.accruedTds,
      refType: 'loan_payment',
    }),
  };
}

/**
 * Makes the ledger say what a Cash & Bank document says now (create, edit, status change, delete all come here): its
 * postings through `repost()`, which reverses what was there and posts the new state. Ledger off = nothing.
 */
export async function syncCashbank(tx: Tx, orgId: string, kind: CashbankKind, id: string) {
  const r = await postingsOf(tx, orgId, kind, id);
  if (!r || !(await ledgerEnabled(tx, r.businessId))) return;
  await repost(tx, orgId, {
    businessId: r.businessId,
    refType: REF_TYPE[kind],
    refId: id,
    postings: r.postings,
  });
}

// ---- loans: the stored schedule ----------------------------------------------------------------------------------------

export const loanTerms = (l: typeof loans.$inferSelect): LoanTerms => ({
  principal: l.principal,
  ratePct: l.ratePct,
  months: l.tenureMonths,
  type: l.interestType as 'reducing' | 'flat',
  emi: l.emi,
  firstEmiDate: l.firstEmiDate,
});

/** Live payments of a loan, oldest first. */
export const paymentsOfLoan = (tx: Tx, loanId: string) =>
  tx
    .select()
    .from(loanPayments)
    .where(and(eq(loanPayments.loanId, loanId), isNull(loanPayments.deletedAt)))
    .orderBy(asc(loanPayments.date), asc(loanPayments.createdAt));

/**
 * Rebuilds a loan's stored schedule from its terms and every live payment (tax-engine scheduleFor) and closes or
 * reopens the loan. The schedule is derived data, not the books: it is replaced, never posted.
 */
export async function rebuildSchedule(tx: Tx, orgId: string, l: typeof loans.$inferSelect) {
  const pays = await paymentsOfLoan(tx, l.id);
  const r = scheduleFor(
    loanTerms(l),
    pays.map((p) => ({
      date: p.date,
      kind: p.kind as LoanPaymentKind,
      principal: p.principal,
      interest: p.interest,
      reschedule: p.reschedule as 'tenure' | 'emi',
    })),
  );
  await tx.delete(loanSchedule).where(eq(loanSchedule.loanId, l.id));
  if (r.schedule.length)
    await tx.insert(loanSchedule).values(r.schedule.map((x) => ({ ...x, orgId, loanId: l.id })));
  const status = r.closed ? 'closed' : 'active';
  if (status !== l.status)
    await tx.update(loans).set({ status, updatedAt: new Date() }).where(eq(loans.id, l.id));
  return { ...r, interestPaid: r2(pays.reduce((s, p) => s + p.interest, 0)) };
}

// ---- cheques and payments ----------------------------------------------------------------------------------------------

type PaymentRow = typeof schema.payments.$inferSelect;
const CHEQUE_SOURCES = ['receipt', 'payment'];

export async function chequeOfPayment(tx: Tx, paymentId: string) {
  const [c] = await tx
    .select()
    .from(cheques)
    .where(and(eq(cheques.paymentId, paymentId), isNull(cheques.deletedAt)));
  return c ?? null;
}

async function assertChequeNumberFree(
  tx: Tx,
  c: { direction: string; partyId: string; number: string },
  exceptId?: string,
) {
  const [dup] = await tx
    .select({ id: cheques.id })
    .from(cheques)
    .where(
      and(
        eq(cheques.direction, c.direction),
        eq(cheques.partyId, c.partyId),
        eq(cheques.number, c.number),
        isNull(cheques.deletedAt),
        exceptId ? ne(cheques.id, exceptId) : undefined,
      ),
    );
  if (dup)
    throw new AppError('conflict', `Cheque ${c.number} of this party is already in the register`);
}

/** The register row for a payment made by cheque (Payment In / Out with mode cheque, Cash & Bank on). */
export async function registerCheque(
  tx: Tx,
  orgId: string,
  pay: PaymentRow,
  extra: { number?: string; reminderDays?: number; notes?: string } = {},
) {
  const c = {
    orgId,
    businessId: pay.businessId,
    direction: pay.direction === 'out' ? 'issued' : 'received',
    partyId: pay.partyId,
    number: (extra.number || pay.reference || pay.number || '').trim() || pay.id.slice(0, 8),
    amount: pay.amount,
    chequeDate: pay.chequeDate ?? pay.paymentDate,
    receivedDate: pay.paymentDate,
    bankAccountId: pay.accountId,
    paymentId: pay.id,
    reminderDays: extra.reminderDays ?? 3,
    notes: extra.notes ?? '',
  };
  await assertChequeNumberFree(tx, c);
  const [row] = await tx.insert(cheques).values(c).returning();
  await syncCashbank(tx, orgId, 'cheque', row.id);
  return row;
}

/** Refuses to change or delete a payment whose cheque has moved on (deposited, cleared): do that from the register. */
export async function assertPaymentChangeable(tx: Tx, paymentId: string) {
  const c = await chequeOfPayment(tx, paymentId);
  if (c && c.status !== 'open')
    throw new AppError(
      'conflict',
      `Cheque ${c.number} is ${c.status}. Change it from the cheque register (bounce or cancel it) instead.`,
    );
}

/** After a payment is saved: its cheque follows it (added, updated, or dropped when the mode is no longer cheque). */
export async function afterPaymentSaved(tx: Tx, orgId: string, pay: PaymentRow) {
  const c = await chequeOfPayment(tx, pay.id);
  if (c && pay.mode !== 'cheque') {
    await tx.update(cheques).set({ deletedAt: new Date() }).where(eq(cheques.id, c.id));
    await syncCashbank(tx, orgId, 'cheque', c.id);
    return;
  }
  if (c) {
    const number = (pay.reference || c.number).trim();
    await assertChequeNumberFree(
      tx,
      { direction: c.direction, partyId: pay.partyId, number },
      c.id,
    );
    await tx
      .update(cheques)
      .set({
        partyId: pay.partyId,
        number,
        amount: pay.amount,
        chequeDate: pay.chequeDate ?? pay.paymentDate,
        receivedDate: pay.paymentDate,
        bankAccountId: pay.accountId,
        updatedAt: new Date(),
      })
      .where(eq(cheques.id, c.id));
    await syncCashbank(tx, orgId, 'cheque', c.id);
    return;
  }
  if (
    pay.mode === 'cheque' &&
    CHEQUE_SOURCES.includes(pay.source) &&
    (await cashbankEnabled(tx, pay.businessId))
  )
    await registerCheque(tx, orgId, pay);
}

/** Before a payment is deleted: an open cheque goes with it. */
export async function beforePaymentDeleted(tx: Tx, orgId: string, paymentId: string) {
  await assertPaymentChangeable(tx, paymentId);
  const c = await chequeOfPayment(tx, paymentId);
  if (!c) return;
  await tx.update(cheques).set({ deletedAt: new Date() }).where(eq(cheques.id, c.id));
  await syncCashbank(tx, orgId, 'cheque', c.id);
}

// ---- account statements (P5-S1 detail, P5-S2 cash) -----------------------------------------------------------------------

/**
 * A cash or bank account's statement: opening balance before `from`, then every entry with Deposit / Withdrawal and a
 * running balance, oldest first; whether each is reconciled; the party's name. Reversed pairs are hidden unless `all`.
 */
export async function statementOf(
  tx: Tx,
  a: typeof accounts.$inferSelect,
  q: { from?: string; to?: string; all?: '0' | '1' },
) {
  const [open] = q.from
    ? await tx
        .select({
          d: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)::float8`,
          c: sql<number>`coalesce(sum(${ledgerEntries.credit}), 0)::float8`,
        })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.accountId, a.id), sql`${ledgerEntries.txnDate} < ${q.from}`))
    : [{ d: 0, c: 0 }];
  const rows = await tx
    .select({ e: ledgerEntries, partyName: parties.name })
    .from(ledgerEntries)
    .leftJoin(parties, eq(parties.id, ledgerEntries.partyId))
    .where(
      and(
        eq(ledgerEntries.accountId, a.id),
        q.from ? sql`${ledgerEntries.txnDate} >= ${q.from}` : undefined,
        q.to ? sql`${ledgerEntries.txnDate} <= ${q.to}` : undefined,
      ),
    )
    .orderBy(asc(ledgerEntries.txnDate), asc(ledgerEntries.createdAt));
  const reversed = new Set(rows.map((r) => r.e.reversalOf).filter(Boolean));
  const shown = q.all === '1' ? rows : rows.filter((r) => !r.e.reversalOf && !reversed.has(r.e.id));
  const recon = shown.length
    ? new Set(
        (
          await tx
            .select({ id: bankRecon.entryId })
            .from(bankRecon)
            .where(
              and(
                inArray(
                  bankRecon.entryId,
                  shown.map((r) => r.e.id),
                ),
                isNull(bankRecon.deletedAt),
              ),
            )
        ).map((r) => r.id),
      )
    : new Set<string>();
  // The party sits on the other side of the voucher (Receivable / Payable), not on the cash or bank line: take it
  // from there so the statement's Party column is filled.
  const voucherParty = new Map<string, { id: string; name: string }>();
  const missing = [...new Set(shown.filter((r) => !r.e.partyId).map((r) => r.e.voucherId))];
  if (missing.length)
    for (const v of await tx
      .select({ voucherId: ledgerEntries.voucherId, id: parties.id, name: parties.name })
      .from(ledgerEntries)
      .innerJoin(parties, eq(parties.id, ledgerEntries.partyId))
      .where(inArray(ledgerEntries.voucherId, missing)))
      if (!voucherParty.has(v.voucherId)) voucherParty.set(v.voucherId, { id: v.id, name: v.name });
  // A hidden pair nets to zero, so the running balance over what is shown still ends at the true balance.
  let run = r2(open.d - open.c);
  const opening = run;
  const out = shown.map(({ e, partyName }) => {
    run = r2(run + e.debit - e.credit);
    const vp = e.partyId ? null : voucherParty.get(e.voucherId);
    return {
      id: e.id,
      txnDate: e.txnDate,
      refType: e.refType,
      refId: e.refId,
      partyId: e.partyId ?? vp?.id ?? null,
      partyName: partyName ?? vp?.name ?? null,
      narration: e.narration,
      deposit: e.debit,
      withdrawal: e.credit,
      running: run,
      reconciled: recon.has(e.id),
      reversalOf: e.reversalOf,
    };
  });
  return {
    opening,
    deposits: r2(out.reduce((s, r) => s + r.deposit, 0)),
    withdrawals: r2(out.reduce((s, r) => s + r.withdrawal, 0)),
    closing: run,
    rows: out,
  };
}
