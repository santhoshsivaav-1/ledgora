// Vyapar parity P5-S5: loan accounts on the API. A loan gets its own chart account (2301…), its schedule
// (tax-engine loan.ts), and posts the money received: Dr Bank / Cr Loan (a processing fee is Bank Charges). Each payment
// posts Dr Loan (principal), Dr Loan Interest, Dr Bank Charges, Cr Bank, and the schedule is rebuilt from all payments,
// so the loan account's balance always equals what the schedule says is outstanding. Increase Loan is a `topup` payment.
// India: §269SS / §269T refuse ₹20,000 or more taken or repaid in cash unless the owner acknowledges it (audited), and the
// interest and principal of housing and education loans feed the Regime Calculator (§24(b), §80C, §80E).
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  idParam,
  loan,
  loanDetail,
  loanInput,
  loanListQuery,
  loanPatch,
  loanPaymentInput,
  loanPaymentParams,
  loanInterestCreditInput,
  loanInterestCreditParams,
  loanStatement,
  loanTaxQuery,
  loanTaxSummary,
  okBody,
} from '@ledgora/contracts';
import {
  LoanError,
  buildSchedule,
  emi as emiOf,
  getFinancialYearLabel,
  loanCashProblem,
  accruedSettlement,
  loanInterestTds,
  loanTaxSuggestions,
  nextDue,
  parseLocalDate,
  scheduleFor,
  type LoanPaymentKind,
  type ScheduleRow,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { guardPeriod } from './saleRules.ts';
import { syncTds } from './tdsRules.ts';
import { seedChart } from './ledgerRules.ts';
import {
  bankOf,
  loanChartOf,
  loanTerms,
  paymentsOfLoan,
  rebuildSchedule,
  requireCashbank,
  statementOf,
  syncCashbank,
} from './cashbankRules.ts';

const { loans, loanSchedule, loanPayments, loanInterestCredits, accounts, parties } = schema;

/** The lender named as a party must be one of this organization's parties. */
async function checkLenderParty(tx: Tx, partyId: string | null | undefined) {
  if (!partyId) return;
  const [p] = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.id, partyId), isNull(parties.deletedAt)));
  if (!p) throw notFound('Lender party');
}

/**
 * §194A TDS on interest paid or credited now (`interest`: only interest not credited before). The year's interest to the
 * lender is added up across all their loans (by lender party when set, else this loan): interest credited, plus interest
 * paid that had not been credited, dated up to this one in its financial year. `cap` = the most that can be kept.
 */
async function tdsOnInterest(
  tx: Tx,
  l: typeof loans.$inferSelect,
  pay: { date: string; interest: number; cap: number; tdsAmount?: number },
) {
  if (!(pay.interest > 0)) return { tdsAmount: 0, tdsBase: 0, tdsRate: 0 };
  const fy = getFinancialYearLabel(parseLocalDate(pay.date));
  const y = Number(fy.slice(0, 4));
  const lenderLoans = l.lenderPartyId
    ? (
        await tx
          .select({ id: loans.id })
          .from(loans)
          .where(
            and(
              eq(loans.businessId, l.businessId),
              eq(loans.lenderPartyId, l.lenderPartyId),
              isNull(loans.deletedAt),
            ),
          )
      ).map((x) => x.id)
    : [l.id];
  const earlier = await tx
    .select()
    .from(loanPayments)
    .where(
      and(
        inArray(loanPayments.loanId, lenderLoans),
        isNull(loanPayments.deletedAt),
        gte(loanPayments.date, `${y}-04-01`),
        lte(loanPayments.date, pay.date),
      ),
    );
  const credited = await tx
    .select()
    .from(loanInterestCredits)
    .where(
      and(
        inArray(loanInterestCredits.loanId, lenderLoans),
        isNull(loanInterestCredits.deletedAt),
        gte(loanInterestCredits.date, `${y}-04-01`),
        lte(loanInterestCredits.date, pay.date),
      ),
    );
  const calc = loanInterestTds({
    lenderType: l.lenderType,
    exempt: l.tdsExempt,
    interest: pay.interest,
    ytdInterest:
      earlier.reduce((s, p) => s + p.interest - p.accruedSettled, 0) +
      credited.reduce((s, c) => s + c.amount, 0),
    ytdDeducted: earlier.some((p) => p.tdsAmount > 0) || credited.some((c) => c.tdsAmount > 0),
    panAvailable: !!l.lenderPan,
  });
  // TDS comes out of what is paid or credited; it can not be more than that.
  const tdsAmount = Math.min(r2(pay.cap), pay.tdsAmount ?? calc.tds);
  return {
    tdsAmount,
    tdsBase: calc.applies ? calc.taxableBase : pay.interest,
    tdsRate: calc.applies ? calc.rate : tdsAmount ? r2((tdsAmount / pay.interest) * 100) : 0,
  };
}

/**
 * §269SS / §269T: money of ₹20,000 or more taken or repaid in cash. Refused unless the owner types an acknowledgement,
 * which is written to the audit log (the same pattern as the §269ST cash-receipt guard on payments).
 */
async function guardLoanCash(
  tx: Tx,
  orgId: string,
  o: {
    direction: 'take' | 'repay';
    amount: number;
    inCash: boolean;
    ack?: string;
    loanId?: string;
  },
) {
  const problem = loanCashProblem(o);
  if (!problem) return;
  if (!o.ack?.trim())
    throw new AppError('cash_limit', `${problem.message} Type an acknowledgement to save anyway.`, {
      section: problem.section,
      amount: o.amount,
    });
  await audit(tx, orgId, 'guard.cash_loan', 'loan', o.loanId ?? null, {
    after: { section: problem.section, amount: o.amount, ack: o.ack.trim() },
  });
}

/** Locks a loan row for the rest of the transaction, so two payments can not rebuild its schedule at once. */
const lockLoan = (tx: Tx, id: string) =>
  tx.select({ id: loans.id }).from(loans).where(eq(loans.id, id)).for('update');
const r2 = (n: number) => Math.round(n * 100) / 100;

const loanError = (e: unknown): never => {
  if (e instanceof LoanError) throw new AppError('unprocessable', e.message);
  throw e;
};

async function loanOf(tx: Tx, id: string) {
  const [l] = await tx
    .select()
    .from(loans)
    .where(and(eq(loans.id, id), isNull(loans.deletedAt)));
  if (!l) throw notFound('Loan');
  return l;
}

const toPayment = (p: typeof loanPayments.$inferSelect) => ({
  id: p.id,
  loanId: p.loanId,
  date: p.date,
  kind: p.kind as LoanPaymentKind,
  principal: p.principal,
  interest: p.interest,
  charges: p.charges,
  accountId: p.accountId,
  reschedule: p.reschedule as 'tenure' | 'emi',
  notes: p.notes,
  tdsAmount: p.tdsAmount,
  tdsBase: p.tdsBase,
  tdsRate: p.tdsRate,
  accruedSettled: p.accruedSettled,
  accruedTds: p.accruedTds,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/** A loan's live interest credits, oldest first. */
const creditsOf = (tx: Tx, loanId: string) =>
  tx
    .select()
    .from(loanInterestCredits)
    .where(and(eq(loanInterestCredits.loanId, loanId), isNull(loanInterestCredits.deletedAt)))
    .orderBy(asc(loanInterestCredits.date), asc(loanInterestCredits.createdAt));
const toCredit = (c: typeof loanInterestCredits.$inferSelect) => ({
  id: c.id,
  loanId: c.loanId,
  date: c.date,
  amount: c.amount,
  tdsAmount: c.tdsAmount,
  tdsBase: c.tdsBase,
  tdsRate: c.tdsRate,
  notes: c.notes,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

async function toLoan(tx: Tx, orgId: string, l: typeof loans.$inferSelect) {
  const a = await loanChartOf(tx, orgId, l);
  const schedule = (
    await tx
      .select()
      .from(loanSchedule)
      .where(eq(loanSchedule.loanId, l.id))
      .orderBy(asc(loanSchedule.n))
  ).map((s): ScheduleRow => ({
    n: s.n,
    dueDate: s.dueDate,
    emi: s.emi,
    principalPart: s.principalPart,
    interestPart: s.interestPart,
    balanceAfter: s.balanceAfter,
    status: s.status as ScheduleRow['status'],
    paidOn: s.paidOn,
    paidPrincipal: s.paidPrincipal,
    paidInterest: s.paidInterest,
  }));
  const pays = await paymentsOfLoan(tx, l.id);
  const credits = await creditsOf(tx, l.id);
  return {
    detail: { schedule, payments: pays.map(toPayment), credits: credits.map(toCredit) },
    loan: {
      id: l.id,
      businessId: l.businessId,
      name: l.name,
      lender: l.lender,
      type: l.type,
      principal: l.principal,
      ratePct: l.ratePct,
      interestType: l.interestType as 'reducing' | 'flat',
      tenureMonths: l.tenureMonths,
      emi: l.emi,
      firstEmiDate: l.firstEmiDate,
      receivedOn: l.receivedOn,
      receivedAccountId: l.receivedAccountId,
      processingFee: l.processingFee,
      purpose: l.purpose,
      lenderType: l.lenderType as 'bank' | 'nbfc' | 'company' | 'individual' | 'other',
      lenderPan: l.lenderPan,
      lenderPartyId: l.lenderPartyId,
      tdsExempt: l.tdsExempt,
      tdsDeducted: r2(
        pays.reduce((s, p) => s + p.tdsAmount, 0) + credits.reduce((s, c) => s + c.tdsAmount, 0),
      ),
      interestCreditedUnpaid: r2(
        credits.reduce((s, c) => s + c.amount, 0) - pays.reduce((s, p) => s + p.accruedSettled, 0),
      ),
      status: l.status as 'active' | 'closed',
      notes: l.notes,
      accountId: a.id,
      code: a.code,
      outstanding: r2(
        l.principal +
          pays.reduce((s, p) => s + (p.kind === 'topup' ? p.principal : -p.principal), 0),
      ),
      interestPaid: r2(pays.reduce((s, p) => s + p.interest, 0)),
      nextDue: nextDue(schedule),
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    },
  };
}
const asLoan = async (tx: Tx, orgId: string, l: typeof loans.$inferSelect) =>
  (await toLoan(tx, orgId, l)).loan;
const asDetail = async (tx: Tx, orgId: string, l: typeof loans.$inferSelect) => {
  const { loan: out, detail } = await toLoan(tx, orgId, l);
  return { ...out, ...detail };
};

export function loansModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/loans',
    tag: 'Cash & Bank',
    summary: 'Loan accounts with outstanding principal and the next instalment',
    query: loanListQuery,
    response: z.object({ data: z.array(loan) }),
    handler: async ({ tx, orgId, query }) => {
      await requireCashbank(tx, query.businessId);
      const rows = await tx
        .select()
        .from(loans)
        .where(and(eq(loans.businessId, query.businessId), isNull(loans.deletedAt)))
        .orderBy(asc(loans.receivedOn), asc(loans.createdAt));
      const out = [];
      for (const l of rows) out.push(await asLoan(tx, orgId, l));
      return { data: out };
    },
  });

  route({
    method: 'get',
    path: '/v1/loans/tax-summary',
    tag: 'Cash & Bank',
    summary:
      'For the Regime Calculator: interest and principal paid in a financial year on housing and education loans (§24(b), §80C, §80E)',
    query: loanTaxQuery,
    response: loanTaxSummary,
    handler: async ({ tx, query }) => {
      await requireCashbank(tx, query.businessId);
      const fy =
        query.fy ?? getFinancialYearLabel(parseLocalDate(new Date().toISOString().slice(0, 10)));
      const y = Number(fy.slice(0, 4));
      const list = await tx
        .select()
        .from(loans)
        .where(
          and(
            eq(loans.businessId, query.businessId),
            isNull(loans.deletedAt),
            inArray(loans.purpose, ['housing', 'education']),
          ),
        );
      const items = [];
      for (const l of list) {
        const pays = await tx
          .select()
          .from(loanPayments)
          .where(
            and(
              eq(loanPayments.loanId, l.id),
              isNull(loanPayments.deletedAt),
              gte(loanPayments.date, `${y}-04-01`),
              lte(loanPayments.date, `${y + 1}-03-31`),
            ),
          );
        const repaid = pays.filter((p) => p.kind !== 'topup');
        items.push({
          loanId: l.id,
          name: l.name,
          purpose: l.purpose,
          interest: r2(repaid.reduce((s, p) => s + p.interest, 0)),
          principal: r2(repaid.reduce((s, p) => s + p.principal, 0)),
        });
      }
      return { fy, items, suggestions: loanTaxSuggestions(items) };
    },
  });

  route({
    method: 'get',
    path: '/v1/loans/:id',
    tag: 'Cash & Bank',
    summary: 'A loan with its schedule and payments',
    params: idParam,
    response: loanDetail,
    handler: async ({ tx, orgId, params }) => {
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      return asDetail(tx, orgId, l);
    },
  });

  route({
    method: 'post',
    path: '/v1/loans',
    tag: 'Cash & Bank',
    summary:
      'Add a loan: its ledger account and schedule are created and the money received is posted (Dr Bank / Cr Loan)',
    body: loanInput,
    response: loanDetail,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await requireCashbank(tx, body.businessId);
      await checkLenderParty(tx, body.lenderPartyId);
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.receivedOn,
        c.req.header('x-override-reason'),
      );
      if (body.receivedAccountId) await bankOf(tx, body.businessId, body.receivedAccountId);
      await guardLoanCash(tx, orgId, {
        direction: 'take',
        amount: body.principal,
        inCash: !body.receivedAccountId,
        ack: body.cashAcknowledgement,
      });
      if (body.firstEmiDate < body.receivedOn)
        throw new AppError('unprocessable', 'The first EMI can not be before the loan is received');
      if (body.processingFee >= body.principal)
        throw new AppError('unprocessable', 'The processing fee must be less than the principal');
      const emi =
        body.emi ??
        emiOf({
          principal: body.principal,
          ratePct: body.ratePct,
          months: body.tenureMonths,
          type: body.interestType,
        });
      try {
        buildSchedule({
          principal: body.principal,
          ratePct: body.ratePct,
          months: body.tenureMonths,
          type: body.interestType,
          emi,
          firstEmiDate: body.firstEmiDate,
        });
      } catch (e) {
        loanError(e);
      }
      const { cashAcknowledgement: _ack, ...cols } = body;
      const [row] = await tx
        .insert(loans)
        .values({ ...cols, emi, orgId })
        .returning();
      const a = await loanChartOf(tx, orgId, row);
      await rebuildSchedule(tx, orgId, row);
      await syncCashbank(tx, orgId, 'loan', row.id);
      await audit(tx, orgId, 'loan.create', 'loan', row.id, {
        after: { name: row.name, principal: row.principal, code: a.code },
      });
      return asDetail(tx, orgId, row);
    },
  });

  route({
    method: 'patch',
    path: '/v1/loans/:id',
    tag: 'Cash & Bank',
    summary:
      'Rename a loan or change its notes or purpose (the money terms are fixed once it is added)',
    params: idParam,
    body: loanPatch,
    response: loan,
    handler: async ({ tx, orgId, params, body }) => {
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      await checkLenderParty(tx, body.lenderPartyId);
      const [row] = await tx
        .update(loans)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(loans.id, l.id))
        .returning();
      if (body.name)
        await tx
          .update(accounts)
          .set({ name: body.name, updatedAt: new Date() })
          .where(eq(accounts.loanId, l.id));
      await audit(tx, orgId, 'loan.update', 'loan', l.id, {
        before: { name: l.name },
        after: body,
      });
      return asLoan(tx, orgId, row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/loans/:id',
    tag: 'Cash & Bank',
    summary: 'Delete a loan with no payments: the money received is reversed',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      if ((await paymentsOfLoan(tx, l.id)).length || (await creditsOf(tx, l.id)).length)
        throw new AppError(
          'conflict',
          'This loan has payments or interest credits. Delete them first.',
        );
      await guardPeriod(
        tx,
        orgId,
        auth,
        l.businessId,
        l.receivedOn,
        c.req.header('x-override-reason'),
      );
      await tx.update(loans).set({ deletedAt: new Date() }).where(eq(loans.id, l.id));
      await syncCashbank(tx, orgId, 'loan', l.id);
      await tx.delete(loanSchedule).where(eq(loanSchedule.loanId, l.id));
      await tx
        .update(accounts)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(accounts.loanId, l.id));
      await audit(tx, orgId, 'loan.delete', 'loan', l.id, { before: { name: l.name } });
      return { ok: true as const };
    },
  });

  route({
    method: 'post',
    path: '/v1/loans/:id/payments',
    tag: 'Cash & Bank',
    summary:
      'Pay a loan: an EMI (pays the next instalment), a part payment or a prepayment. Posts Dr Loan, Loan Interest, Bank Charges / Cr Bank and rebuilds the schedule',
    params: idParam,
    body: loanPaymentInput,
    response: loanDetail,
    status: 201,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      await lockLoan(tx, params.id);
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      const topup = body.kind === 'topup';
      if (l.status === 'closed' && !topup) throw new AppError('conflict', 'This loan is paid off');
      if (topup && (body.interest > 0 || !(body.principal > 0)))
        throw new AppError('unprocessable', 'Enter the amount the loan is increased by');
      await guardPeriod(
        tx,
        orgId,
        auth,
        l.businessId,
        body.date,
        c.req.header('x-override-reason'),
      );
      if (body.date < l.receivedOn)
        throw new AppError('unprocessable', 'A payment can not be before the loan was received');
      if (body.accountId) await bankOf(tx, l.businessId, body.accountId);
      if (!(body.principal + body.interest + body.charges > 0))
        throw new AppError('unprocessable', 'Enter what was paid');
      if (topup && body.charges >= body.principal)
        throw new AppError('unprocessable', 'The charges must be less than the amount borrowed');
      // Check against the schedule before writing anything: no payment may take the principal below zero.
      const pays = await paymentsOfLoan(tx, l.id);
      try {
        scheduleFor(loanTerms(l), [
          ...pays.map((p) => ({
            date: p.date,
            kind: p.kind as LoanPaymentKind,
            principal: p.principal,
            interest: p.interest,
            reschedule: p.reschedule as 'tenure' | 'emi',
          })),
          { ...body },
        ]);
      } catch (e) {
        loanError(e);
      }
      // Interest credited earlier (§194A at credit) is paid first; only the rest is new interest with its own TDS.
      const acc = topup
        ? { settled: 0, tds: 0 }
        : accruedSettlement(
            (await creditsOf(tx, l.id)).map((c) => ({ amount: c.amount, tds: c.tdsAmount })),
            (await paymentsOfLoan(tx, l.id)).reduce((s, p) => s + p.accruedSettled, 0),
            body.interest,
          );
      const tds = topup
        ? { tdsAmount: 0, tdsBase: 0, tdsRate: 0 }
        : await tdsOnInterest(tx, l, {
            date: body.date,
            interest: r2(body.interest - acc.settled),
            cap: r2(body.principal + body.interest + body.charges - acc.tds),
            tdsAmount: body.tdsAmount,
          });
      await guardLoanCash(tx, orgId, {
        direction: topup ? 'take' : 'repay',
        // What actually leaves in cash: the TDS kept is paid to the Government, not to the lender.
        amount: topup
          ? body.principal
          : r2(body.principal + body.interest + body.charges - tds.tdsAmount - acc.tds),
        inCash: !body.accountId,
        ack: body.cashAcknowledgement,
        loanId: l.id,
      });
      const { cashAcknowledgement: _a, tdsAmount: _t, ...payCols } = body;
      const [row] = await tx
        .insert(loanPayments)
        .values({
          ...payCols,
          ...tds,
          accruedSettled: acc.settled,
          accruedTds: acc.tds,
          orgId,
          businessId: l.businessId,
          loanId: l.id,
        })
        .returning();
      await rebuildSchedule(tx, orgId, l);
      await syncCashbank(tx, orgId, 'loan_payment', row.id);
      await syncTds(tx, orgId, 'loan_payment', row.id);
      await audit(tx, orgId, 'loan.payment', 'loan', l.id, {
        after: {
          kind: row.kind,
          principal: row.principal,
          interest: row.interest,
          tds: row.tdsAmount,
        },
      });
      return asDetail(tx, orgId, await loanOf(tx, l.id));
    },
  });

  route({
    method: 'delete',
    path: '/v1/loans/:id/payments/:paymentId',
    tag: 'Cash & Bank',
    summary: 'Delete a loan payment: its posting is reversed and the schedule rebuilt',
    params: loanPaymentParams,
    response: loanDetail,
    handler: async ({ tx, orgId, auth, params, c }) => {
      await lockLoan(tx, params.id);
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      const [p] = await tx
        .select()
        .from(loanPayments)
        .where(
          and(
            eq(loanPayments.id, params.paymentId),
            eq(loanPayments.loanId, l.id),
            isNull(loanPayments.deletedAt),
          ),
        );
      if (!p) throw notFound('Loan payment');
      await guardPeriod(tx, orgId, auth, l.businessId, p.date, c.req.header('x-override-reason'));
      // Removing a top-up can leave later repayments paying more than is owed: refuse that before writing.
      try {
        scheduleFor(
          loanTerms(l),
          (await paymentsOfLoan(tx, l.id))
            .filter((x) => x.id !== p.id)
            .map((x) => ({
              date: x.date,
              kind: x.kind as LoanPaymentKind,
              principal: x.principal,
              interest: x.interest,
              reschedule: x.reschedule as 'tenure' | 'emi',
            })),
        );
      } catch (e) {
        loanError(e);
      }
      await tx.update(loanPayments).set({ deletedAt: new Date() }).where(eq(loanPayments.id, p.id));
      await rebuildSchedule(tx, orgId, l);
      await syncCashbank(tx, orgId, 'loan_payment', p.id);
      await syncTds(tx, orgId, 'loan_payment', p.id);
      await audit(tx, orgId, 'loan.payment_delete', 'loan', l.id, {
        before: { principal: p.principal, interest: p.interest },
      });
      return asDetail(tx, orgId, await loanOf(tx, l.id));
    },
  });

  route({
    method: 'get',
    path: '/v1/loans/:id/statement',
    tag: 'Cash & Bank',
    summary:
      "A loan's statement from its ledger account: borrowed, repaid and the principal outstanding after each",
    params: idParam,
    response: loanStatement,
    handler: async ({ tx, orgId, params }) => {
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      const st = await statementOf(tx, await loanChartOf(tx, orgId, l), {});
      // The loan account is a liability: what is owed is credit less debit, so the running Dr-positive figure flips.
      return {
        outstanding: r2(-st.closing),
        rows: st.rows.map((r) => ({
          id: r.id,
          txnDate: r.txnDate,
          refType: r.refType,
          refId: r.refId,
          narration: r.narration,
          repaid: r.deposit,
          borrowed: r.withdrawal,
          outstanding: r2(-r.running),
        })),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/loans/:id/interest-credits',
    tag: 'Cash & Bank',
    summary:
      'Credit interest to the lender before paying it (an EMI fallen due, the 31 March accrual): the expense is booked and §194A TDS kept now; the payment that later pays it clears Interest Payable',
    params: idParam,
    body: loanInterestCreditInput,
    response: loanDetail,
    status: 201,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      await lockLoan(tx, params.id);
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      await guardPeriod(
        tx,
        orgId,
        auth,
        l.businessId,
        body.date,
        c.req.header('x-override-reason'),
      );
      if (body.date < l.receivedOn)
        throw new AppError(
          'unprocessable',
          'Interest can not be credited before the loan was received',
        );
      // Interest Payable (2420) arrived after some businesses turned the ledger on: make sure it is in the chart.
      await seedChart(tx, orgId, l.businessId);
      const tds = await tdsOnInterest(tx, l, {
        date: body.date,
        interest: body.amount,
        cap: r2(body.amount - 0.01),
        tdsAmount: body.tdsAmount,
      });
      const [row] = await tx
        .insert(loanInterestCredits)
        .values({
          orgId,
          businessId: l.businessId,
          loanId: l.id,
          date: body.date,
          amount: body.amount,
          notes: body.notes,
          ...tds,
        })
        .returning();
      await syncCashbank(tx, orgId, 'loan_interest', row.id);
      await syncTds(tx, orgId, 'loan_interest', row.id);
      await audit(tx, orgId, 'loan.interest_credit', 'loan', l.id, {
        after: { date: row.date, amount: row.amount, tds: row.tdsAmount },
      });
      return asDetail(tx, orgId, await loanOf(tx, l.id));
    },
  });

  route({
    method: 'delete',
    path: '/v1/loans/:id/interest-credits/:creditId',
    tag: 'Cash & Bank',
    summary:
      'Delete an interest credit (its posting is reversed, its accrued TDS removed); refused while payments have already paid it',
    params: loanInterestCreditParams,
    response: loanDetail,
    handler: async ({ tx, orgId, auth, params, c }) => {
      await lockLoan(tx, params.id);
      const l = await loanOf(tx, params.id);
      await requireCashbank(tx, l.businessId);
      const credits = await creditsOf(tx, l.id);
      const cr = credits.find((x) => x.id === params.creditId);
      if (!cr) throw notFound('Interest credit');
      await guardPeriod(tx, orgId, auth, l.businessId, cr.date, c.req.header('x-override-reason'));
      const settled = (await paymentsOfLoan(tx, l.id)).reduce((s, p) => s + p.accruedSettled, 0);
      const left = credits.filter((x) => x.id !== cr.id).reduce((s, x) => s + x.amount, 0);
      if (settled > left + 0.005)
        throw new AppError(
          'conflict',
          'A payment has already paid this interest. Delete that payment first, then the credit.',
        );
      await tx
        .update(loanInterestCredits)
        .set({ deletedAt: new Date() })
        .where(eq(loanInterestCredits.id, cr.id));
      await syncCashbank(tx, orgId, 'loan_interest', cr.id);
      await syncTds(tx, orgId, 'loan_interest', cr.id);
      await audit(tx, orgId, 'loan.interest_credit_delete', 'loan', l.id, {
        before: { date: cr.date, amount: cr.amount },
      });
      return asDetail(tx, orgId, await loanOf(tx, l.id));
    },
  });
}
