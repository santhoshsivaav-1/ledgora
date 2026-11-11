// Vyapar parity Phase 5 (Cash & Bank) on the API: the flag, bank accounts (P5-S1), cash in hand and adjustments
// (P5-S2), transfers (P5-S3), bank reconciliation (P5-S6) and the dashboard summary (P5-S7). Cheques and loans have
// their own modules. Every write posts through cashbankRules.ts `syncCashbank` / `syncBankOpening`, i.e. `repost()`.
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  accountStatement,
  bankAccount,
  bankAccountInput,
  bankAccountListQuery,
  bankAccountPatch,
  cashBankAccount,
  cashEntry,
  cashEntryInput,
  cashEntryListQuery,
  cashbankSettingsInput,
  cashbankStatus,
  cashbankStatusQuery,
  cashbankSummary,
  dayEndCountInput,
  dayEndResult,
  idParam,
  okBody,
  reconMatchInput,
  reconMatchResult,
  reconIgnoreInput,
  reconSaveInput,
  reconSaveResult,
  statementQuery,
  transfer,
  transferInput,
  transferListQuery,
} from '@ledgora/contracts';
import {
  ACC,
  cashBankTotals,
  cashOutWatch,
  cashWatch,
  chequesDue,
  dayEndCount,
  emisDueWithin,
  matchStatement,
  transferProblem,
  type ChequeStatus,
  type ScheduleRow,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { guardPeriod } from './saleRules.ts';
import {
  assertBankRemovable,
  assertMoneyAccount,
  balancesOf,
  bankChartOf,
  bankOf,
  cashAccountOf,
  cashbankSettings,
  chartAccountOf,
  moneyAccounts,
  requireCashbank,
  setCashbank,
  statementOf,
  syncBankOpening,
  syncCashbank,
  toBankAccount,
} from './cashbankRules.ts';

const {
  accounts,
  ledgerEntries,
  paymentAccounts,
  transfers,
  cashEntries,
  cheques,
  loans,
  loanSchedule,
  payments,
  parties,
  bankRecon,
  expenses,
} = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (d: number) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  return t.toISOString().slice(0, 10);
};

const toCashEntry = (e: typeof cashEntries.$inferSelect) => ({
  id: e.id,
  businessId: e.businessId,
  accountId: e.accountId,
  kind: e.kind as 'adjust' | 'count' | 'deposit' | 'withdraw',
  direction: e.direction as 'increase' | 'reduce',
  amount: e.amount,
  date: e.date,
  remarks: e.remarks,
  countAsIncome: e.countAsIncome,
  category: e.category,
  counterAccountId: e.counterAccountId,
  systemBalance: e.systemBalance,
  counted: e.counted,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

async function toTransfer(tx: Tx, t: typeof transfers.$inferSelect) {
  const names = new Map(
    (
      await tx
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(inArray(accounts.id, [t.fromAccountId, t.toAccountId]))
    ).map((a) => [a.id, a.name]),
  );
  return {
    id: t.id,
    businessId: t.businessId,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    fromName: names.get(t.fromAccountId) ?? '',
    toName: names.get(t.toAccountId) ?? '',
    amount: t.amount,
    fee: t.fee,
    date: t.date,
    reference: t.reference,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Exactly one default among the accounts printed on invoices; a label is unique per business. */
async function checkBankFields(
  tx: Tx,
  businessId: string,
  b: { label?: string; isDefault?: boolean; printOnInvoice?: boolean },
  exceptId?: string,
) {
  if (b.isDefault && b.printOnInvoice === false)
    throw new AppError('unprocessable', 'The default account for invoices must be printed on them');
  if (b.label) {
    const [dup] = await tx
      .select({ id: paymentAccounts.id })
      .from(paymentAccounts)
      .where(
        and(
          eq(paymentAccounts.businessId, businessId),
          sql`lower(${paymentAccounts.label}) = lower(${b.label})`,
          isNull(paymentAccounts.deletedAt),
          exceptId ? ne(paymentAccounts.id, exceptId) : undefined,
        ),
      );
    if (dup) throw new AppError('conflict', `There is already a bank account called ${b.label}`);
  }
  if (b.isDefault)
    await tx
      .update(paymentAccounts)
      .set({ isDefault: false })
      .where(
        and(
          eq(paymentAccounts.businessId, businessId),
          isNull(paymentAccounts.deletedAt),
          exceptId ? ne(paymentAccounts.id, exceptId) : undefined,
        ),
      );
}

/** The balance of a money account, without one document (the one being edited). */
async function balanceExcept(tx: Tx, accountId: string, refType: string, refId?: string) {
  const [r] = await tx
    .select({
      v: sql<number>`coalesce(sum(${ledgerEntries.debit} - ${ledgerEntries.credit}), 0)::float8`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.accountId, accountId),
        refId
          ? sql`not (${ledgerEntries.refType} = ${refType} and ${ledgerEntries.refId} = ${refId})`
          : undefined,
      ),
    );
  return r2(r.v);
}

async function checkTransfer(tx: Tx, body: z.infer<typeof transferInput>, exceptId?: string) {
  const from = await chartAccountOf(tx, body.businessId, body.fromAccountId);
  const to = await chartAccountOf(tx, body.businessId, body.toAccountId);
  assertMoneyAccount(from);
  assertMoneyAccount(to);
  if (!from.active || !to.active)
    throw new AppError('unprocessable', 'A switched-off account can not be used');
  const settings = await cashbankSettings(tx, body.businessId);
  const bank = from.bankAccountId ? await bankOf(tx, body.businessId, from.bankAccountId) : null;
  const problem = transferProblem({
    fromAccount: from.id,
    toAccount: to.id,
    amount: body.amount,
    fee: body.fee,
    fromBalance: await balanceExcept(tx, from.id, 'transfer', exceptId),
    fromIsCash: from.code === ACC.CASH,
    allowOverdraft:
      settings.allowOverdraft || bank?.accountType === 'od' || bank?.accountType === 'cc',
  });
  if (problem) throw new AppError('unprocessable', problem);
}

export function cashbankModule({ route }: Registrar) {
  // ---- the flag ----
  route({
    method: 'get',
    path: '/v1/cashbank/settings',
    tag: 'Cash & Bank',
    summary: 'Is Cash & Bank on for this business (it needs the ledger on)',
    query: cashbankStatusQuery,
    response: cashbankStatus,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      return cashbankSettings(tx, query.businessId);
    },
  });

  route({
    method: 'put',
    path: '/v1/cashbank/settings',
    tag: 'Cash & Bank',
    summary:
      'Turn Cash & Bank on or off. On: the accounts it needs are added and every bank account gets its ledger account and opening balance',
    body: cashbankSettingsInput,
    response: cashbankStatus,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      await setCashbank(tx, orgId, body.businessId, body);
      await audit(tx, orgId, 'cashbank.settings', 'business', body.businessId, { after: body });
      return cashbankSettings(tx, body.businessId);
    },
  });

  route({
    method: 'get',
    path: '/v1/cashbank/accounts',
    tag: 'Cash & Bank',
    summary: 'Cash in Hand and every bank account with its balance (the pickers for transfers)',
    query: cashbankStatusQuery,
    response: z.object({ data: z.array(cashBankAccount) }),
    handler: async ({ tx, orgId, query }) => {
      await requireCashbank(tx, query.businessId);
      return { data: await moneyAccounts(tx, orgId, query.businessId) };
    },
  });

  // ---- bank accounts (P5-S1) ----
  route({
    method: 'get',
    path: '/v1/bank-accounts',
    tag: 'Cash & Bank',
    summary: 'Bank accounts with their balance and last transaction date',
    query: bankAccountListQuery,
    response: z.object({ data: z.array(bankAccount) }),
    handler: async ({ tx, orgId, query }) => {
      await requireCashbank(tx, query.businessId);
      const rows = await tx
        .select()
        .from(paymentAccounts)
        .where(
          and(
            eq(paymentAccounts.businessId, query.businessId),
            isNull(paymentAccounts.deletedAt),
            query.all === '1' ? undefined : eq(paymentAccounts.isActive, true),
          ),
        )
        .orderBy(asc(paymentAccounts.createdAt));
      const charts: (typeof accounts.$inferSelect)[] = [];
      for (const b of rows) charts.push(await bankChartOf(tx, orgId, query.businessId, b.id));
      const bal = await balancesOf(
        tx,
        charts.map((a) => a.id),
      );
      return { data: rows.map((b, i) => toBankAccount(b, charts[i], bal.get(charts[i].id))) };
    },
  });

  route({
    method: 'post',
    path: '/v1/bank-accounts',
    tag: 'Cash & Bank',
    summary:
      'Add a bank account: its ledger account is created and its opening balance posted, in one transaction',
    body: bankAccountInput,
    response: bankAccount,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await requireCashbank(tx, body.businessId);
      const openingDate = body.openingDate ?? today();
      if (body.openingBalance)
        await guardPeriod(
          tx,
          orgId,
          auth,
          body.businessId,
          openingDate,
          c.req.header('x-override-reason'),
        );
      await checkBankFields(tx, body.businessId, body);
      const [row] = await tx
        .insert(paymentAccounts)
        .values({ ...body, ifsc: body.ifsc.toUpperCase(), openingDate, orgId })
        .returning();
      const a = await bankChartOf(tx, orgId, body.businessId, row.id);
      await syncBankOpening(tx, orgId, row.id);
      await audit(tx, orgId, 'bank_account.create', 'payment_account', row.id, {
        after: { label: row.label, opening: row.openingBalance, code: a.code },
      });
      return toBankAccount(row, a, (await balancesOf(tx, [a.id])).get(a.id));
    },
  });

  route({
    method: 'get',
    path: '/v1/bank-accounts/:id',
    tag: 'Cash & Bank',
    summary: 'One bank account with its balance',
    params: idParam,
    response: bankAccount,
    handler: async ({ tx, orgId, params }) => {
      const [b] = await tx
        .select()
        .from(paymentAccounts)
        .where(and(eq(paymentAccounts.id, params.id), isNull(paymentAccounts.deletedAt)));
      if (!b) throw notFound('Bank account');
      await requireCashbank(tx, b.businessId);
      const a = await bankChartOf(tx, orgId, b.businessId, b.id);
      return toBankAccount(b, a, (await balancesOf(tx, [a.id])).get(a.id));
    },
  });

  route({
    method: 'patch',
    path: '/v1/bank-accounts/:id',
    tag: 'Cash & Bank',
    summary:
      'Change a bank account. A new opening balance or date is reversed and posted again; inactive hides it from pickers',
    params: idParam,
    body: bankAccountPatch,
    response: bankAccount,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      const [b] = await tx
        .select()
        .from(paymentAccounts)
        .where(and(eq(paymentAccounts.id, params.id), isNull(paymentAccounts.deletedAt)));
      if (!b) throw notFound('Bank account');
      await requireCashbank(tx, b.businessId);
      const openingChanged =
        (body.openingBalance !== undefined && body.openingBalance !== b.openingBalance) ||
        (body.openingDate !== undefined && body.openingDate !== b.openingDate);
      if (openingChanged) {
        const why = c.req.header('x-override-reason');
        await guardPeriod(tx, orgId, auth, b.businessId, b.openingDate, why);
        await guardPeriod(tx, orgId, auth, b.businessId, body.openingDate ?? b.openingDate, why);
      }
      await checkBankFields(
        tx,
        b.businessId,
        {
          label: body.label,
          isDefault: body.isDefault,
          printOnInvoice: body.printOnInvoice ?? b.printOnInvoice,
        },
        b.id,
      );
      const [row] = await tx
        .update(paymentAccounts)
        .set({
          ...body,
          ...(body.ifsc !== undefined ? { ifsc: body.ifsc.toUpperCase() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(paymentAccounts.id, b.id))
        .returning();
      const a = await bankChartOf(tx, orgId, b.businessId, b.id);
      if (body.label || body.isActive !== undefined)
        await tx
          .update(accounts)
          .set({ name: row.label, active: row.isActive, updatedAt: new Date() })
          .where(eq(accounts.id, a.id));
      if (openingChanged) await syncBankOpening(tx, orgId, b.id);
      await audit(tx, orgId, 'bank_account.update', 'payment_account', b.id, {
        before: { label: b.label, opening: b.openingBalance, active: b.isActive },
        after: body,
      });
      return toBankAccount(row, a, (await balancesOf(tx, [a.id])).get(a.id));
    },
  });

  route({
    method: 'delete',
    path: '/v1/bank-accounts/:id',
    tag: 'Cash & Bank',
    summary:
      'Delete a bank account that has no entries (409 otherwise: switch it off instead, which keeps its history)',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [b] = await tx
        .select()
        .from(paymentAccounts)
        .where(and(eq(paymentAccounts.id, params.id), isNull(paymentAccounts.deletedAt)));
      if (!b) throw notFound('Bank account');
      await requireCashbank(tx, b.businessId);
      const a = await assertBankRemovable(tx, b.id);
      await tx
        .update(paymentAccounts)
        .set({ deletedAt: new Date() })
        .where(eq(paymentAccounts.id, b.id));
      if (a) await tx.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, a.id));
      await audit(tx, orgId, 'bank_account.delete', 'payment_account', b.id, {
        before: { label: b.label },
      });
      return { ok: true as const };
    },
  });

  route({
    method: 'get',
    path: '/v1/bank-accounts/:id/transactions',
    tag: 'Cash & Bank',
    summary:
      "A bank account's statement: opening balance, deposits and withdrawals with a running balance, reconciled marks",
    params: idParam,
    query: statementQuery,
    response: accountStatement,
    handler: async ({ tx, orgId, params, query }) => {
      const [b] = await tx
        .select()
        .from(paymentAccounts)
        .where(and(eq(paymentAccounts.id, params.id), isNull(paymentAccounts.deletedAt)));
      if (!b) throw notFound('Bank account');
      await requireCashbank(tx, b.businessId);
      const a = await bankChartOf(tx, orgId, b.businessId, b.id);
      const st = await statementOf(tx, a, query);
      return {
        account: {
          accountId: a.id,
          code: a.code,
          name: b.label,
          kind: 'bank' as const,
          bankAccountId: b.id,
          accountType: b.accountType || null,
          balance: (await balancesOf(tx, [a.id])).get(a.id)?.balance ?? 0,
        },
        ...st,
      };
    },
  });

  // ---- cash in hand and entries (P5-S2, and deposit / withdraw on a bank, P5-S1) ----
  route({
    method: 'get',
    path: '/v1/cash/transactions',
    tag: 'Cash & Bank',
    summary: 'Cash in Hand: opening, cash in and out with a running balance',
    query: statementQuery.extend({ businessId: z.string().uuid() }),
    response: accountStatement,
    handler: async ({ tx, query }) => {
      await requireCashbank(tx, query.businessId);
      const a = await cashAccountOf(tx, query.businessId);
      const st = await statementOf(tx, a, query);
      return {
        account: {
          accountId: a.id,
          code: a.code,
          name: a.name,
          kind: 'cash' as const,
          bankAccountId: null,
          accountType: null,
          balance: (await balancesOf(tx, [a.id])).get(a.id)?.balance ?? 0,
        },
        ...st,
      };
    },
  });

  route({
    method: 'get',
    path: '/v1/cash/entries',
    tag: 'Cash & Bank',
    summary: 'Cash and bank adjustments, deposits, withdrawals and day-end counts, newest first',
    query: cashEntryListQuery,
    response: z.object({ data: z.array(cashEntry) }),
    handler: async ({ tx, query }) => {
      await requireCashbank(tx, query.businessId);
      const rows = await tx
        .select()
        .from(cashEntries)
        .where(
          and(
            eq(cashEntries.businessId, query.businessId),
            isNull(cashEntries.deletedAt),
            query.accountId ? eq(cashEntries.accountId, query.accountId) : undefined,
          ),
        )
        .orderBy(desc(cashEntries.date), desc(cashEntries.createdAt));
      return { data: rows.map(toCashEntry) };
    },
  });

  route({
    method: 'post',
    path: '/v1/cash/entries',
    tag: 'Cash & Bank',
    summary:
      'Adjust cash or a bank balance, or deposit / withdraw (owner capital, drawings, bank charges, another account)',
    body: cashEntryInput,
    response: cashEntry,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await requireCashbank(tx, body.businessId);
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.date,
        c.req.header('x-override-reason'),
      );
      const a = body.accountId
        ? await chartAccountOf(tx, body.businessId, body.accountId)
        : await cashAccountOf(tx, body.businessId);
      assertMoneyAccount(a);
      if (body.kind === 'deposit' && body.direction !== 'increase')
        throw new AppError('unprocessable', 'A deposit adds money');
      if (body.kind === 'withdraw' && body.direction !== 'reduce')
        throw new AppError('unprocessable', 'A withdrawal takes money out');
      if (body.kind === 'withdraw' && body.category === 'other' && !body.counterAccountId)
        throw new AppError('unprocessable', 'Choose the account the money went to');
      if (body.counterAccountId) {
        const other = await chartAccountOf(tx, body.businessId, body.counterAccountId);
        if (other.id === a.id)
          throw new AppError('unprocessable', 'The other side must be a different account');
        if (other.code === ACC.CASH || other.group === 'Bank')
          throw new AppError(
            'unprocessable',
            'Use a transfer to move money between cash and banks',
          );
      }
      if (a.code === ACC.CASH && body.direction === 'reduce') {
        const bal = (await balancesOf(tx, [a.id])).get(a.id)?.balance ?? 0;
        if (body.amount > bal + 0.005)
          throw new AppError('unprocessable', `Only ₹${bal} is in hand`);
      }
      const [row] = await tx
        .insert(cashEntries)
        .values({
          orgId,
          businessId: body.businessId,
          accountId: a.id,
          kind: body.kind,
          direction: body.direction,
          amount: body.amount,
          date: body.date,
          remarks: body.remarks,
          countAsIncome: body.kind === 'adjust' && body.countAsIncome,
          category: body.kind === 'withdraw' ? (body.category ?? 'drawings') : null,
          counterAccountId: body.counterAccountId ?? null,
        })
        .returning();
      await syncCashbank(tx, orgId, 'cash_entry', row.id);
      await audit(tx, orgId, `cash.${body.kind}`, 'cash_entry', row.id, {
        after: { account: a.code, direction: row.direction, amount: row.amount },
      });
      return toCashEntry(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/cash/entries/:id',
    tag: 'Cash & Bank',
    summary: 'Delete a cash or bank entry: its posting is reversed',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const [e] = await tx
        .select()
        .from(cashEntries)
        .where(and(eq(cashEntries.id, params.id), isNull(cashEntries.deletedAt)));
      if (!e) throw notFound('Entry');
      await requireCashbank(tx, e.businessId);
      await guardPeriod(tx, orgId, auth, e.businessId, e.date, c.req.header('x-override-reason'));
      await tx.update(cashEntries).set({ deletedAt: new Date() }).where(eq(cashEntries.id, e.id));
      await syncCashbank(tx, orgId, 'cash_entry', e.id);
      await audit(tx, orgId, 'cash.delete', 'cash_entry', e.id, {
        before: { kind: e.kind, amount: e.amount },
      });
      return { ok: true as const };
    },
  });

  route({
    method: 'post',
    path: '/v1/cash/count',
    tag: 'Cash & Bank',
    summary:
      'Day-end count: cash counted against the books on a date. A difference posts to Cash Over / Short; an equal count posts nothing',
    body: dayEndCountInput,
    response: dayEndResult,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await requireCashbank(tx, body.businessId);
      const a = await cashAccountOf(tx, body.businessId);
      const system = (await balancesOf(tx, [a.id], body.date)).get(a.id)?.balance ?? 0;
      const d = dayEndCount(system, body.counted);
      if (!d.direction) return { system, counted: body.counted, difference: 0, entry: null };
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.date,
        c.req.header('x-override-reason'),
      );
      const [row] = await tx
        .insert(cashEntries)
        .values({
          orgId,
          businessId: body.businessId,
          accountId: a.id,
          kind: 'count',
          direction: d.direction,
          amount: d.amount,
          date: body.date,
          remarks: body.remarks || (d.difference > 0 ? 'Cash over' : 'Cash short'),
          systemBalance: system,
          counted: body.counted,
        })
        .returning();
      await syncCashbank(tx, orgId, 'cash_entry', row.id);
      await audit(tx, orgId, 'cash.count', 'cash_entry', row.id, {
        after: { system, counted: body.counted, difference: d.difference },
      });
      return { system, counted: body.counted, difference: d.difference, entry: toCashEntry(row) };
    },
  });

  // ---- transfers (P5-S3) ----
  route({
    method: 'get',
    path: '/v1/transfers',
    tag: 'Cash & Bank',
    summary: 'Money moved between cash and banks, newest first',
    query: transferListQuery,
    response: z.object({ data: z.array(transfer) }),
    handler: async ({ tx, query }) => {
      await requireCashbank(tx, query.businessId);
      const rows = await tx
        .select()
        .from(transfers)
        .where(and(eq(transfers.businessId, query.businessId), isNull(transfers.deletedAt)))
        .orderBy(desc(transfers.date), desc(transfers.createdAt));
      const out = [];
      for (const t of rows) out.push(await toTransfer(tx, t));
      return { data: out };
    },
  });

  route({
    method: 'post',
    path: '/v1/transfers',
    tag: 'Cash & Bank',
    summary:
      'Move money between Cash in Hand and banks (cash can not go below zero; banks only with overdraft allowed). A fee posts to Bank Charges',
    body: transferInput,
    response: transfer,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await requireCashbank(tx, body.businessId);
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.date,
        c.req.header('x-override-reason'),
      );
      await checkTransfer(tx, body);
      const [row] = await tx
        .insert(transfers)
        .values({ ...body, orgId })
        .returning();
      await syncCashbank(tx, orgId, 'transfer', row.id);
      await audit(tx, orgId, 'transfer.create', 'transfer', row.id, {
        after: { amount: row.amount, fee: row.fee },
      });
      return toTransfer(tx, row);
    },
  });

  route({
    method: 'put',
    path: '/v1/transfers/:id',
    tag: 'Cash & Bank',
    summary: 'Edit a transfer: its posting is reversed and posted again',
    params: idParam,
    body: transferInput,
    response: transfer,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      const [before] = await tx
        .select()
        .from(transfers)
        .where(and(eq(transfers.id, params.id), isNull(transfers.deletedAt)));
      if (!before) throw notFound('Transfer');
      if (before.businessId !== body.businessId)
        throw new AppError('unprocessable', 'A transfer can not move to another business');
      await requireCashbank(tx, body.businessId);
      const why = c.req.header('x-override-reason');
      await guardPeriod(tx, orgId, auth, body.businessId, before.date, why);
      await guardPeriod(tx, orgId, auth, body.businessId, body.date, why);
      await checkTransfer(tx, body, before.id);
      const [row] = await tx
        .update(transfers)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(transfers.id, before.id))
        .returning();
      await syncCashbank(tx, orgId, 'transfer', row.id);
      await audit(tx, orgId, 'transfer.update', 'transfer', row.id, {
        before: { amount: before.amount, fee: before.fee },
        after: { amount: row.amount, fee: row.fee },
      });
      return toTransfer(tx, row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/transfers/:id',
    tag: 'Cash & Bank',
    summary: 'Delete a transfer: its posting is reversed',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const [t] = await tx
        .select()
        .from(transfers)
        .where(and(eq(transfers.id, params.id), isNull(transfers.deletedAt)));
      if (!t) throw notFound('Transfer');
      await requireCashbank(tx, t.businessId);
      await guardPeriod(tx, orgId, auth, t.businessId, t.date, c.req.header('x-override-reason'));
      await tx.update(transfers).set({ deletedAt: new Date() }).where(eq(transfers.id, t.id));
      await syncCashbank(tx, orgId, 'transfer', t.id);
      await audit(tx, orgId, 'transfer.delete', 'transfer', t.id, { before: { amount: t.amount } });
      return { ok: true as const };
    },
  });

  // ---- bank reconciliation (P5-S6) ----
  /** Live (not reversed) entries of a bank's chart account, with what to look for in a statement description. */
  async function bookEntries(tx: Tx, accountId: string) {
    const rows = await tx
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId))
      .orderBy(asc(ledgerEntries.txnDate), asc(ledgerEntries.createdAt));
    const reversed = new Set(rows.map((r) => r.reversalOf).filter(Boolean));
    const live = rows.filter((r) => !r.reversalOf && !reversed.has(r.id));
    const ids = (t: string) => live.filter((r) => r.refType === t).map((r) => r.refId);
    const refs = new Map<string, string>();
    const payIds = ids('payment');
    if (payIds.length)
      for (const p of await tx
        .select({ id: payments.id, number: payments.number, reference: payments.reference })
        .from(payments)
        .where(inArray(payments.id, payIds)))
        refs.set(p.id, p.reference || p.number);
    const chqIds = ids('cheque');
    if (chqIds.length)
      for (const ch of await tx
        .select({ id: cheques.id, number: cheques.number })
        .from(cheques)
        .where(inArray(cheques.id, chqIds)))
        refs.set(ch.id, ch.number);
    const trIds = ids('transfer');
    if (trIds.length)
      for (const t of await tx
        .select({ id: transfers.id, reference: transfers.reference })
        .from(transfers)
        .where(inArray(transfers.id, trIds)))
        if (t.reference) refs.set(t.id, t.reference);
    const done = new Set(
      live.length
        ? (
            await tx
              .select({ id: bankRecon.entryId })
              .from(bankRecon)
              .where(
                and(
                  inArray(
                    bankRecon.entryId,
                    live.map((r) => r.id),
                  ),
                  isNull(bankRecon.deletedAt),
                ),
              )
          ).map((r) => r.id)
        : [],
    );
    return live.map((r) => ({
      id: r.id,
      txnDate: r.txnDate,
      narration: r.narration,
      reference: refs.get(r.refId) ?? null,
      deposit: r.debit,
      withdrawal: r.credit,
      reconciled: done.has(r.id),
    }));
  }

  const bankFor = async (tx: Tx, orgId: string, id: string) => {
    const [b] = await tx
      .select()
      .from(paymentAccounts)
      .where(and(eq(paymentAccounts.id, id), isNull(paymentAccounts.deletedAt)));
    if (!b) throw notFound('Bank account');
    await requireCashbank(tx, b.businessId);
    return { b, a: await bankChartOf(tx, orgId, b.businessId, b.id) };
  };

  route({
    method: 'post',
    path: '/v1/bank-accounts/:id/reconcile/match',
    tag: 'Cash & Bank',
    summary:
      'Match statement rows (from parseBankStatement) to the bank’s entries: same amount, date within ±3 days, a reference in the description first. Writes nothing',
    params: idParam,
    body: reconMatchInput,
    response: reconMatchResult,
    handler: async ({ tx, orgId, params, body }) => {
      const { b, a } = await bankFor(tx, orgId, params.id);
      const entries = await bookEntries(tx, a.id);
      const open = entries.filter((e) => !e.reconciled);
      const result = matchStatement(
        body.rows,
        open.map((e) => ({
          id: e.id,
          date: e.txnDate,
          debit: e.deposit,
          credit: e.withdrawal,
          reference: e.reference,
        })),
        { toleranceDays: body.toleranceDays },
      );
      const seen = new Set(
        result.hashes.length
          ? (
              await tx
                .select({ h: bankRecon.statementRowHash })
                .from(bankRecon)
                .where(
                  and(
                    eq(bankRecon.bankAccountId, b.id),
                    inArray(bankRecon.statementRowHash, result.hashes),
                    isNull(bankRecon.deletedAt),
                  ),
                )
            ).map((r) => r.h)
          : [],
      );
      const already = result.hashes.flatMap((h, i) => (seen.has(h) ? [i] : []));
      const matches = result.matches.filter((m) => !seen.has(m.hash));
      const used = new Set(matches.map((m) => m.entryId));
      return {
        hashes: result.hashes,
        matches,
        alreadyReconciled: already,
        unmatchedRows: body.rows
          .map((_, i) => i)
          .filter((i) => !seen.has(result.hashes[i]) && !matches.some((m) => m.row === i)),
        unmatchedEntries: open.filter((e) => !used.has(e.id)).map((e) => e.id),
        entries,
        bookBalance: (await balancesOf(tx, [a.id])).get(a.id)?.balance ?? 0,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/bank-accounts/:id/reconcile',
    tag: 'Cash & Bank',
    summary:
      'Mark matched entries reconciled. Finishing while the statement and the books still differ needs a reason (audited)',
    params: idParam,
    body: reconSaveInput,
    response: reconSaveResult,
    handler: async ({ tx, orgId, params, body }) => {
      const { b, a } = await bankFor(tx, orgId, params.id);
      const entries = new Map((await bookEntries(tx, a.id)).map((e) => [e.id, e]));
      for (const m of body.matches) {
        const e = entries.get(m.entryId);
        if (!e) throw new AppError('unprocessable', 'An entry is not on this bank account');
        if (e.reconciled) throw new AppError('conflict', 'An entry is already reconciled');
      }
      const bookBalance = (await balancesOf(tx, [a.id], body.clearedOn)).get(a.id)?.balance ?? 0;
      const difference = r2(body.statementBalance - bookBalance);
      if (Math.abs(difference) > 0.005 && !body.reason)
        throw new AppError(
          'unprocessable',
          `The statement and the books differ by ₹${difference}. Give a reason to finish anyway.`,
          { difference },
        );
      if (body.matches.length)
        await tx.insert(bankRecon).values(
          body.matches.map((m) => ({
            orgId,
            businessId: b.businessId,
            bankAccountId: b.id,
            entryId: m.entryId,
            statementRowHash: m.hash,
            statementDate: m.statementDate ?? null,
            clearedOn: body.clearedOn,
          })),
        );
      await audit(tx, orgId, 'bank.reconcile', 'payment_account', b.id, {
        after: {
          reconciled: body.matches.length,
          statementBalance: body.statementBalance,
          bookBalance,
          difference,
          reason: body.reason ?? null,
        },
      });
      return { reconciled: body.matches.length, bookBalance, difference };
    },
  });

  route({
    method: 'post',
    path: '/v1/bank-accounts/:id/reconcile/ignore',
    tag: 'Cash & Bank',
    summary:
      'Leave statement rows out of reconciliation (a duplicate line, a charge the bank reversed itself); a re-uploaded statement shows them as done',
    params: idParam,
    body: reconIgnoreInput,
    response: okBody,
    handler: async ({ tx, orgId, params, body }) => {
      const { b } = await bankFor(tx, orgId, params.id);
      const done = new Set(
        (
          await tx
            .select({ h: bankRecon.statementRowHash })
            .from(bankRecon)
            .where(
              and(
                eq(bankRecon.bankAccountId, b.id),
                inArray(
                  bankRecon.statementRowHash,
                  body.rows.map((r) => r.hash),
                ),
                isNull(bankRecon.deletedAt),
              ),
            )
        ).map((r) => r.h),
      );
      const fresh = body.rows.filter((r) => !done.has(r.hash));
      if (fresh.length)
        await tx.insert(bankRecon).values(
          fresh.map((r) => ({
            orgId,
            businessId: b.businessId,
            bankAccountId: b.id,
            entryId: null,
            statementRowHash: r.hash,
            statementDate: r.statementDate ?? null,
            clearedOn: r.statementDate ?? today(),
            ignored: true,
            reason: r.reason,
          })),
        );
      await audit(tx, orgId, 'bank.reconcile_ignore', 'payment_account', b.id, {
        after: { rows: fresh.length, reasons: fresh.map((r) => r.reason).filter(Boolean) },
      });
      return { ok: true as const };
    },
  });

  route({
    method: 'delete',
    path: '/v1/bank-accounts/:id/reconcile/:entryId',
    tag: 'Cash & Bank',
    summary: 'Un-reconcile one entry',
    params: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }),
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const { b } = await bankFor(tx, orgId, params.id);
      const [r] = await tx
        .update(bankRecon)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(bankRecon.bankAccountId, b.id),
            eq(bankRecon.entryId, params.entryId),
            isNull(bankRecon.deletedAt),
          ),
        )
        .returning();
      if (!r) throw notFound('Reconciled entry');
      await audit(tx, orgId, 'bank.unreconcile', 'payment_account', b.id, {
        before: { entryId: params.entryId },
      });
      return { ok: true as const };
    },
  });

  // ---- dashboard (P5-S7) ----
  route({
    method: 'get',
    path: '/v1/cashbank/summary',
    tag: 'Cash & Bank',
    summary:
      'Home widgets: Cash + Bank total, overdrawn accounts, cheques due, loan EMIs due in 7 days, §269ST cash watch',
    query: cashbankStatusQuery,
    response: cashbankSummary,
    handler: async ({ tx, orgId, query }) => {
      await requireCashbank(tx, query.businessId);
      const accts = await moneyAccounts(tx, orgId, query.businessId);
      const totals = cashBankTotals(accts);
      const now = today();
      const open = await tx
        .select({ c: cheques, partyName: parties.name })
        .from(cheques)
        .innerJoin(parties, eq(parties.id, cheques.partyId))
        .where(
          and(
            eq(cheques.businessId, query.businessId),
            isNull(cheques.deletedAt),
            inArray(cheques.status, ['open', 'deposited']),
          ),
        )
        .orderBy(asc(cheques.chequeDate));
      const due = chequesDue(
        open.map((x) => ({ ...x.c, status: x.c.status as ChequeStatus, partyName: x.partyName })),
        now,
      );
      const loanRows = await tx
        .select({ l: loans, s: loanSchedule })
        .from(loanSchedule)
        .innerJoin(loans, eq(loans.id, loanSchedule.loanId))
        .where(
          and(
            eq(loans.businessId, query.businessId),
            isNull(loans.deletedAt),
            eq(loans.status, 'active'),
            ne(loanSchedule.status, 'paid'),
          ),
        )
        .orderBy(asc(loanSchedule.dueDate));
      const emis = emisDueWithin(
        loanRows.map((x) => ({ ...x.s, status: x.s.status as ScheduleRow['status'] })),
        now,
        7,
      );
      const loanName = new Map(loanRows.map((x) => [x.s.id, x.l]));
      const cashIn = await tx
        .select({
          partyId: payments.partyId,
          date: payments.paymentDate,
          amount: payments.amount,
          mode: payments.mode,
          direction: payments.direction,
        })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, query.businessId),
            isNull(payments.deletedAt),
            eq(payments.mode, 'cash'),
            eq(payments.direction, 'in'),
            gte(payments.paymentDate, daysAgo(90)),
          ),
        );
      const watch = cashWatch(cashIn);
      // §40A(3): cash paid out to one party in a day above ₹10,000, by Payment Out or an expense paid in cash.
      const since = daysAgo(90);
      const cashOut = [
        ...(await tx
          .select({
            partyId: payments.partyId,
            date: payments.paymentDate,
            amount: payments.amount,
          })
          .from(payments)
          .where(
            and(
              eq(payments.businessId, query.businessId),
              isNull(payments.deletedAt),
              eq(payments.mode, 'cash'),
              eq(payments.direction, 'out'),
              gte(payments.paymentDate, since),
            ),
          )),
        ...(
          await tx
            .select()
            .from(expenses)
            .where(
              and(
                eq(expenses.businessId, query.businessId),
                isNull(expenses.deletedAt),
                eq(expenses.paymentMode, 'cash'),
                gte(expenses.expenseDate, since),
              ),
            )
        )
          .filter((e) => e.payeePartyId && e.kind !== 'income')
          .map((e) => ({
            partyId: e.payeePartyId!,
            date: e.expenseDate,
            amount: e.paidAmount ?? r2(e.amount + e.taxAmount),
          })),
      ].map((x) => ({ ...x, mode: 'cash', direction: 'out' }));
      const outWatch = cashOutWatch(cashOut);
      const names = new Map(
        watch.length || outWatch.length
          ? (
              await tx
                .select({ id: parties.id, name: parties.name })
                .from(parties)
                .where(
                  inArray(
                    parties.id,
                    [...watch, ...outWatch].map((w) => w.partyId),
                  ),
                )
            ).map((p) => [p.id, p.name])
          : [],
      );
      return {
        ...totals,
        accounts: accts,
        chequesDue: {
          count: due.length,
          amount: r2(due.reduce((s, c) => s + c.amount, 0)),
          items: due.map((c) => ({
            id: c.id,
            number: c.number,
            partyName: c.partyName,
            amount: c.amount,
            chequeDate: c.chequeDate,
            direction: c.direction as 'received' | 'issued',
            status: c.status,
          })),
        },
        emiDue: {
          count: emis.length,
          amount: r2(emis.reduce((s, e) => s + e.emi - e.paidPrincipal - e.paidInterest, 0)),
          items: emis.map((e) => {
            const l = loanName.get((e as unknown as { id: string }).id)!;
            return { loanId: l.id, name: l.name, dueDate: e.dueDate, emi: e.emi };
          }),
        },
        cashWatch: watch.map((w) => ({ ...w, partyName: names.get(w.partyId) ?? '' })),
        cashOutWatch: outWatch.map((w) => ({ ...w, partyName: names.get(w.partyId) ?? '' })),
      };
    },
  });
}
