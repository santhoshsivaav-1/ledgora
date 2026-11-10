// Vyapar parity Phase 4: the books on the API. Chart of accounts (P4-S1), the account ledger and trial balance (P4-S7),
// manual journals (P4-S7), the backfill that turns the ledger on (P4-S4) and financial years with the period lock
// (P4-S6). Postings themselves are written by ledgerRules.ts `repost`; nothing here writes ledger rows any other way.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  account,
  accountInput,
  accountLedger,
  accountListQuery,
  accountPatch,
  backfillInput,
  backfillResult,
  financialYear,
  financialYearsQuery,
  idParam,
  journal,
  journalInput,
  journalListQuery,
  ledgerQuery,
  ledgerStatus,
  ledgerStatusQuery,
  lockSettings,
  lockSettingsInput,
  okBody,
  trialBalanceQuery,
  trialBalanceResult,
  type ACCOUNT_KINDS,
} from '@ledgora/contracts';
import {
  drCr,
  getFinancialYearLabel,
  kindForGroup,
  parseLocalDate,
  postJournal,
  postOpening,
  runningBalance,
  balanceOf,
  type AccountKind,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { accountTotals, backfillLedger, trialBalanceOf } from './ledgerBackfill.ts';
import { accountsByCode, ledgerEnabled, nextCode, repost } from './ledgerRules.ts';
import { guardPeriod } from './saleRules.ts';
import { nextSeriesNumber } from './series.ts';

const {
  accounts,
  ledgerEntries,
  financialYears,
  invoices,
  purchases,
  expenses,
  payments,
  businessSettings,
} = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;
type Kind = (typeof ACCOUNT_KINDS)[number];

/** Where a new account's code comes from, by group (and kind for "Duties & taxes"). The seeded accounts sit below these. */
const RANGES: Record<string, [number, number]> = {
  Cash: [1010, 1099],
  Bank: [1101, 1189],
  'Current assets': [1250, 1299],
  Receivables: [1310, 1399],
  Inventory: [1410, 1499],
  'Fixed assets': [1710, 1799],
  Payables: [2010, 2099],
  'Current liabilities': [2410, 2499],
  Loans: [2301, 2399],
  Equity: [3200, 3999],
  'Direct income': [4300, 4399],
  'Indirect income': [4140, 4299],
  'Direct expense': [5030, 5099],
  'Indirect expense': [5300, 5999],
};
const dutyRange = (kind: Kind): [number, number] =>
  kind === 'asset' ? [1540, 1599] : [2150, 2199];

const jvNumber = (narration: string) => /^(JV-\d+) · /.exec(narration)?.[1] ?? '';
const jvText = (narration: string) => narration.replace(/^JV-\d+ · /, '');

async function accountOf(tx: Tx, id: string) {
  const [a] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)));
  if (!a) throw notFound('Account');
  return a;
}
const requireLedger = async (tx: Tx, businessId: string) => {
  if (!(await ledgerEnabled(tx, businessId)))
    throw new AppError(
      'conflict',
      'The ledger is off for this business. Turn it on in Accounting first.',
    );
};

/** Financial years from the first document to the current one, created the first time they are asked for. */
async function ensureFinancialYears(tx: Tx, orgId: string, businessId: string) {
  const mins = await Promise.all([
    tx
      .select({ d: sql<string | null>`min(${invoices.invoiceDate})` })
      .from(invoices)
      .where(eq(invoices.businessId, businessId)),
    tx
      .select({ d: sql<string | null>`min(${purchases.purchaseDate})` })
      .from(purchases)
      .where(eq(purchases.businessId, businessId)),
    tx
      .select({ d: sql<string | null>`min(${expenses.expenseDate})` })
      .from(expenses)
      .where(eq(expenses.businessId, businessId)),
    tx
      .select({ d: sql<string | null>`min(${payments.paymentDate})` })
      .from(payments)
      .where(eq(payments.businessId, businessId)),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const first = [today, ...mins.map((m) => m[0]?.d).filter((d): d is string => !!d)].sort()[0];
  const startOf = (d: string) => Number(getFinancialYearLabel(parseLocalDate(d)).slice(0, 4));
  const rows = [];
  for (let y = startOf(first); y <= startOf(today); y++)
    rows.push({
      orgId,
      businessId,
      label: `${y}-${String(y + 1).slice(-2)}`,
      startDate: `${y}-04-01`,
      endDate: `${y + 1}-03-31`,
    });
  await tx.insert(financialYears).values(rows).onConflictDoNothing();
}
const toYear = (y: typeof financialYears.$inferSelect) => ({
  id: y.id,
  label: y.label,
  startDate: y.startDate,
  endDate: y.endDate,
  status: y.status as 'open' | 'closed',
  lockedAt: y.lockedAt,
});

export function ledgerModule({ route }: Registrar) {
  // ---- status and backfill (P4-S4) ----
  route({
    method: 'get',
    path: '/v1/accounting/status',
    tag: 'Accounting',
    summary: 'Is the ledger on for this business, and how big is it',
    query: ledgerStatusQuery,
    response: ledgerStatus,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const [s] = await tx
        .select({ p: businessSettings.preferences })
        .from(businessSettings)
        .where(eq(businessSettings.businessId, query.businessId));
      const acc = (s?.p as { accounting?: { ledger?: boolean; enabledAt?: string } } | undefined)
        ?.accounting;
      const [a] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(accounts)
        .where(eq(accounts.businessId, query.businessId));
      const [e] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.businessId, query.businessId));
      return {
        enabled: !!acc?.ledger,
        enabledAt: acc?.enabledAt ?? null,
        accounts: a.n,
        entries: e.n,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/accounting/backfill',
    tag: 'Accounting',
    summary:
      'Post every existing document into the ledger and turn it on. dryRun (the default) writes nothing and shows what would happen; the ledger is switched on only when the party balances match the documents (or force)',
    body: backfillInput,
    response: backfillResult,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const result = await backfillLedger(tx, orgId, body);
      await audit(
        tx,
        orgId,
        body.dryRun ? 'ledger.backfill_check' : 'ledger.backfill',
        'business',
        body.businessId,
        {
          after: {
            documents: result.documents,
            problems: result.problems.length,
            diffs: result.diffs.length,
            enabled: result.enabled,
            force: body.force,
          },
        },
      );
      return result;
    },
  });

  // ---- chart of accounts (P4-S1) ----
  route({
    method: 'get',
    path: '/v1/accounts',
    tag: 'Accounting',
    summary: "The chart of accounts with each account's balance",
    query: accountListQuery,
    response: z.object({ data: z.array(account) }),
    handler: async ({ tx, query }) => {
      const rows = await tx
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.businessId, query.businessId),
            isNull(accounts.deletedAt),
            query.kind ? eq(accounts.kind, query.kind) : undefined,
            query.q ? sql`${accounts.name} ilike ${`%${query.q}%`}` : undefined,
          ),
        )
        .orderBy(asc(accounts.code));
      const totals = new Map((await accountTotals(tx, query.businessId)).map((t) => [t.id, t]));
      return {
        data: rows.map((a) => {
          const t = totals.get(a.id);
          const d = t?.debit ?? 0,
            c = t?.credit ?? 0;
          return {
            id: a.id,
            businessId: a.businessId,
            code: a.code,
            name: a.name,
            group: a.group,
            kind: a.kind as Kind,
            system: a.system,
            active: a.active,
            debit: d,
            credit: c,
            balance: balanceOf(a.kind as AccountKind, d, c),
            ...stamps(a),
          };
        }),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/accounts',
    tag: 'Accounting',
    summary: 'Add an account; an opening balance is posted against Opening Balance Equity',
    body: accountInput,
    response: account,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await loadBusiness(tx, body.businessId);
      await requireLedger(tx, body.businessId);
      const kind = kindForGroup(body.group, body.kind);
      if (!kind)
        throw new AppError(
          'unprocessable',
          body.group === 'Duties & taxes'
            ? 'Say whether this is credit you claim (asset) or tax you owe (liability)'
            : `Unknown group ${body.group}`,
          [{ path: 'group', message: 'Pick a group' }],
        );
      const range = body.group === 'Duties & taxes' ? dutyRange(kind) : RANGES[body.group];
      const code = body.code ?? (await nextCode(tx, body.businessId, range[0], range[1]));
      if ((await accountsByCode(tx, body.businessId)).has(code))
        throw new AppError('conflict', `Account ${code} already exists`, [
          { path: 'code', message: 'This code is taken' },
        ]);
      const [row] = await tx
        .insert(accounts)
        .values({
          orgId,
          businessId: body.businessId,
          code,
          name: body.name,
          group: body.group,
          kind,
        })
        .returning();
      if (body.opening) {
        await guardPeriod(
          tx,
          orgId,
          auth,
          body.businessId,
          body.opening.date,
          c.req.header('x-override-reason'),
        );
        await repost(tx, orgId, {
          businessId: body.businessId,
          refType: 'opening',
          refId: row.id,
          postings: postOpening({
            id: row.id,
            date: body.opening.date,
            account: code,
            amount: body.opening.amount,
            side: body.opening.side,
          }),
        });
      }
      await audit(tx, orgId, 'account.create', 'account', row.id, {
        after: { code, name: body.name },
      });
      const t = (await accountTotals(tx, body.businessId)).find((x) => x.id === row.id);
      return {
        id: row.id,
        businessId: row.businessId,
        code,
        name: row.name,
        group: row.group,
        kind: kind as Kind,
        system: false,
        active: true,
        debit: t?.debit ?? 0,
        credit: t?.credit ?? 0,
        balance: balanceOf(kind, t?.debit ?? 0, t?.credit ?? 0),
        ...stamps(row),
      };
    },
  });

  route({
    method: 'patch',
    path: '/v1/accounts/:id',
    tag: 'Accounting',
    summary: 'Rename an account or switch it off (the code of a system account never changes)',
    params: idParam,
    body: accountPatch,
    response: okBody,
    handler: async ({ tx, orgId, params, body }) => {
      const a = await accountOf(tx, params.id);
      if (a.system && body.active === false)
        throw new AppError('unprocessable', 'A system account can not be switched off');
      await tx
        .update(accounts)
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, a.id));
      await audit(tx, orgId, 'account.update', 'account', a.id, {
        before: { name: a.name, active: a.active },
        after: body,
      });
      return { ok: true as const };
    },
  });

  route({
    method: 'delete',
    path: '/v1/accounts/:id',
    tag: 'Accounting',
    summary: 'Delete an account that is not a system account and has no entries',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const a = await accountOf(tx, params.id);
      if (a.system) throw new AppError('unprocessable', 'A system account can not be deleted');
      const [e] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.accountId, a.id));
      if (e.n > 0)
        throw new AppError('conflict', 'This account has entries. Switch it off instead.');
      await tx.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, a.id));
      await audit(tx, orgId, 'account.delete', 'account', a.id, { before: { code: a.code } });
      return { ok: true as const };
    },
  });

  // ---- trial balance and the account ledger (P4-S7) ----
  route({
    method: 'get',
    path: '/v1/ledger/trial-balance',
    tag: 'Accounting',
    summary: 'Trial balance: every account with a balance, debits against credits',
    query: trialBalanceQuery,
    response: trialBalanceResult,
    handler: async ({ tx, query }) => {
      let asOf = query.asOf;
      if (query.fy) {
        const y = Number(query.fy.slice(0, 4));
        asOf = asOf ?? `${y + 1}-03-31`;
      }
      return trialBalanceOf(tx, query.businessId, asOf);
    },
  });

  route({
    method: 'get',
    path: '/v1/ledger/:accountId',
    tag: 'Accounting',
    summary:
      "One account's ledger: opening balance, entries with a running balance, closing balance. Reversed pairs are hidden unless all=1",
    params: z.object({ accountId: z.string().uuid() }),
    query: ledgerQuery,
    response: accountLedger,
    handler: async ({ tx, params, query }) => {
      const a = await accountOf(tx, params.accountId);
      const party = query.partyId ? eq(ledgerEntries.partyId, query.partyId) : undefined;
      const [open] = query.from
        ? await tx
            .select({
              d: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)::float8`,
              c: sql<number>`coalesce(sum(${ledgerEntries.credit}), 0)::float8`,
            })
            .from(ledgerEntries)
            .where(
              and(
                eq(ledgerEntries.accountId, a.id),
                sql`${ledgerEntries.txnDate} < ${query.from}`,
                party,
              ),
            )
        : [{ d: 0, c: 0 }];
      const rows = await tx
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.accountId, a.id),
            query.from ? sql`${ledgerEntries.txnDate} >= ${query.from}` : undefined,
            query.to ? sql`${ledgerEntries.txnDate} <= ${query.to}` : undefined,
            party,
          ),
        )
        .orderBy(asc(ledgerEntries.txnDate), asc(ledgerEntries.createdAt));
      const reversed = new Set(rows.map((r) => r.reversalOf).filter(Boolean));
      const shown =
        query.all === '1' ? rows : rows.filter((r) => !r.reversalOf && !reversed.has(r.id));
      const opening = r2(open.d - open.c);
      const run = runningBalance(shown, opening);
      const debit = r2(shown.reduce((s, r) => s + r.debit, 0));
      const credit = r2(shown.reduce((s, r) => s + r.credit, 0));
      const close = drCr(opening + debit, credit);
      return {
        account: { id: a.id, code: a.code, name: a.name, kind: a.kind as Kind },
        opening,
        debit,
        credit,
        closing: close.amount,
        closingSide: close.side,
        entries: shown.map((r, i) => ({
          id: r.id,
          txnDate: r.txnDate,
          voucherId: r.voucherId,
          refType: r.refType,
          refId: r.refId,
          partyId: r.partyId,
          narration: r.narration,
          debit: r.debit,
          credit: r.credit,
          reversalOf: r.reversalOf,
          running: run[i],
        })),
      };
    },
  });

  // ---- journals (P4-S7) ----
  const journalRows = async (tx: Tx, refId: string) => {
    const ents = await tx
      .select({ e: ledgerEntries, code: accounts.code, name: accounts.name })
      .from(ledgerEntries)
      .innerJoin(accounts, eq(accounts.id, ledgerEntries.accountId))
      .where(and(eq(ledgerEntries.refType, 'journal'), eq(ledgerEntries.refId, refId)));
    const reversed = new Set(ents.map((x) => x.e.reversalOf).filter(Boolean));
    return ents.filter((x) => !x.e.reversalOf && !reversed.has(x.e.id));
  };
  const toJournal = (rows: Awaited<ReturnType<typeof journalRows>>) => ({
    id: rows[0].e.refId,
    number: jvNumber(rows[0].e.narration),
    date: rows[0].e.txnDate,
    narration: jvText(rows[0].e.narration),
    total: r2(rows.reduce((s, x) => s + x.e.debit, 0)),
    rows: rows.map((x) => ({
      accountId: x.e.accountId,
      code: x.code,
      name: x.name,
      debit: x.e.debit,
      credit: x.e.credit,
      partyId: x.e.partyId,
    })),
  });
  const writeJournal = async (
    tx: Tx,
    orgId: string,
    id: string,
    number: string,
    body: z.infer<typeof journalInput>,
  ) => {
    const chart = await tx
      .select()
      .from(accounts)
      .where(
        and(
          inArray(
            accounts.id,
            body.rows.map((r) => r.accountId),
          ),
          eq(accounts.businessId, body.businessId),
          isNull(accounts.deletedAt),
        ),
      );
    const byId = new Map(chart.map((a) => [a.id, a]));
    for (const r of body.rows) {
      const a = byId.get(r.accountId);
      if (!a) throw notFound('Account');
      if (!a.active) throw new AppError('unprocessable', `${a.name} is switched off`);
    }
    // The journal number rides at the front of the narration; the trailing space matters when there is no text.
    const text = `${number} · ${body.narration}`;
    await repost(tx, orgId, {
      businessId: body.businessId,
      refType: 'journal',
      refId: id,
      postings: postJournal({
        id,
        date: body.date,
        narration: text,
        rows: body.rows.map((r) => ({
          account: byId.get(r.accountId)!.code,
          debit: r.debit,
          credit: r.credit,
          partyId: r.partyId,
        })),
      }),
    });
  };

  route({
    method: 'get',
    path: '/v1/journals',
    tag: 'Accounting',
    summary: 'Manual journal vouchers, newest first',
    query: journalListQuery,
    response: z.object({ data: z.array(journal) }),
    handler: async ({ tx, query }) => {
      const ids = await tx
        .selectDistinct({ id: ledgerEntries.refId, d: ledgerEntries.txnDate })
        .from(ledgerEntries)
        .where(
          and(eq(ledgerEntries.businessId, query.businessId), eq(ledgerEntries.refType, 'journal')),
        );
      const out = [];
      for (const { id } of ids) {
        const rows = await journalRows(tx, id);
        if (rows.length) out.push(toJournal(rows));
      }
      return {
        data: out.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/journals',
    tag: 'Accounting',
    summary: 'Post a journal voucher (debits must equal credits)',
    body: journalInput,
    response: journal,
    status: 201,
    handler: async ({ tx, orgId, auth, body, c }) => {
      await loadBusiness(tx, body.businessId);
      await requireLedger(tx, body.businessId);
      await guardPeriod(
        tx,
        orgId,
        auth,
        body.businessId,
        body.date,
        c.req.header('x-override-reason'),
      );
      const id = randomUUID();
      const number = await nextSeriesNumber(tx, orgId, body.businessId, 'JV');
      await writeJournal(tx, orgId, id, number, body);
      await audit(tx, orgId, 'journal.create', 'journal', id, {
        after: { number, date: body.date },
      });
      return toJournal(await journalRows(tx, id));
    },
  });

  route({
    method: 'put',
    path: '/v1/journals/:id',
    tag: 'Accounting',
    summary: 'Edit a journal: the old postings are reversed and the new ones posted',
    params: idParam,
    body: journalInput,
    response: journal,
    handler: async ({ tx, orgId, auth, params, body, c }) => {
      const before = await journalRows(tx, params.id);
      if (!before.length) throw notFound('Journal');
      const why = c.req.header('x-override-reason');
      await guardPeriod(tx, orgId, auth, body.businessId, before[0].e.txnDate, why);
      await guardPeriod(tx, orgId, auth, body.businessId, body.date, why);
      await writeJournal(
        tx,
        orgId,
        params.id,
        jvNumber(before[0].e.narration) ||
          (await nextSeriesNumber(tx, orgId, body.businessId, 'JV')),
        body,
      );
      await audit(tx, orgId, 'journal.update', 'journal', params.id, {
        after: { date: body.date },
      });
      return toJournal(await journalRows(tx, params.id));
    },
  });

  route({
    method: 'delete',
    path: '/v1/journals/:id',
    tag: 'Accounting',
    summary: 'Delete a journal: its postings are reversed (the history stays)',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const before = await journalRows(tx, params.id);
      if (!before.length) throw notFound('Journal');
      await guardPeriod(
        tx,
        orgId,
        auth,
        before[0].e.businessId,
        before[0].e.txnDate,
        c.req.header('x-override-reason'),
      );
      await repost(tx, orgId, {
        businessId: before[0].e.businessId,
        refType: 'journal',
        refId: params.id,
        postings: [],
      });
      await audit(tx, orgId, 'journal.delete', 'journal', params.id, {
        before: { number: jvNumber(before[0].e.narration) },
      });
      return { ok: true as const };
    },
  });

  // ---- financial years and the period lock (P4-S6) ----
  route({
    method: 'get',
    path: '/v1/financial-years',
    tag: 'Accounting',
    summary: 'Financial years of a business (created from its first document to today)',
    query: financialYearsQuery,
    response: z.object({ data: z.array(financialYear) }),
    handler: async ({ tx, orgId, query }) => {
      await loadBusiness(tx, query.businessId);
      await ensureFinancialYears(tx, orgId, query.businessId);
      const rows = await tx
        .select()
        .from(financialYears)
        .where(
          and(eq(financialYears.businessId, query.businessId), isNull(financialYears.deletedAt)),
        )
        .orderBy(sql`${financialYears.startDate} desc`);
      return { data: rows.map(toYear) };
    },
  });

  for (const action of ['close', 'reopen'] as const)
    route({
      method: 'post',
      path: `/v1/financial-years/:id/${action}`,
      tag: 'Accounting',
      summary:
        action === 'close'
          ? 'Close a financial year: writes dated in it are refused (the owner may override with a reason)'
          : 'Reopen a closed financial year',
      params: idParam,
      response: financialYear,
      handler: async ({ tx, orgId, auth, params }) => {
        const [y] = await tx
          .select()
          .from(financialYears)
          .where(and(eq(financialYears.id, params.id), isNull(financialYears.deletedAt)));
        if (!y) throw notFound('Financial year');
        const closed = action === 'close';
        const [row] = await tx
          .update(financialYears)
          .set({
            status: closed ? 'closed' : 'open',
            lockedAt: closed ? new Date().toISOString().slice(0, 10) : null,
            lockedBy: closed ? auth.user.id : null,
            updatedAt: new Date(),
          })
          .where(eq(financialYears.id, y.id))
          .returning();
        await audit(tx, orgId, `financial_year.${action}`, 'financial_year', y.id, {
          after: { label: y.label },
        });
        return toYear(row);
      },
    });

  route({
    method: 'get',
    path: '/v1/accounting/lock',
    tag: 'Accounting',
    summary: 'The lock date and whether a filed GST month still locks the books',
    query: ledgerStatusQuery,
    response: lockSettings,
    handler: async ({ tx, query }) => {
      const [s] = await tx
        .select({ p: businessSettings.preferences })
        .from(businessSettings)
        .where(eq(businessSettings.businessId, query.businessId));
      const t =
        (
          (s?.p ?? {}) as {
            transaction?: { lockDate?: string | null; allowEditAfterGstFiled?: boolean };
          }
        ).transaction ?? {};
      return { lockBefore: t.lockDate ?? null, allowEditAfterGstFiled: !!t.allowEditAfterGstFiled };
    },
  });

  route({
    method: 'put',
    path: '/v1/accounting/lock',
    tag: 'Accounting',
    summary:
      'Freeze transactions on or before a date; choose whether a filed GST month locks the books',
    body: lockSettingsInput,
    response: lockSettings,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const [s] = await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, body.businessId));
      const prev = (s?.preferences ?? {}) as { transaction?: Record<string, unknown> } & Record<
        string,
        unknown
      >;
      const preferences = {
        ...prev,
        transaction: {
          ...prev.transaction,
          lockDate: body.lockBefore,
          allowEditAfterGstFiled: body.allowEditAfterGstFiled,
        },
      };
      if (s)
        await tx
          .update(businessSettings)
          .set({ preferences, updatedAt: new Date() })
          .where(eq(businessSettings.id, s.id));
      else
        await tx
          .insert(businessSettings)
          .values({ orgId, businessId: body.businessId, preferences });
      await audit(tx, orgId, 'accounting.lock', 'business', body.businessId, {
        before: prev.transaction,
        after: { lockBefore: body.lockBefore, allowEditAfterGstFiled: body.allowEditAfterGstFiled },
      });
      return { lockBefore: body.lockBefore, allowEditAfterGstFiled: body.allowEditAfterGstFiled };
    },
  });
}
