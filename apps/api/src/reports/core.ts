// Vyapar parity Phase 6, the core reports (P6-S2 Day Book and Cash Flow, P6-S3 Party Statement and Payable Ageing,
// P6-S7 Profit & Loss, Trial Balance and Balance Sheet). Every total is worked out here, on the server, from the whole
// period: the screen never adds up a page of rows.
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { schema } from '@ledgora/db';
import { uuid } from '@ledgora/contracts';
import {
  ACC,
  ageing,
  balanceSheet,
  cashFlow,
  drCr,
  profitAndLoss,
  trialBalance,
  type AccountKind,
} from '@ledgora/tax-engine';
import { dueOfPurchase } from '../modules/purchaseRules.ts';
import { commonParams, defineReport } from './registry.ts';
import {
  REF_LABELS,
  dayBefore,
  fyStartOf,
  liveEntries,
  moneyAccountIds,
  netOf,
  paidAsOf,
  r2,
  refNumbers,
  stockFigures,
  today,
  totalsWithGroup,
} from './shared.ts';

const { accounts, parties, purchases } = schema;
const periodOf = (p: { from?: string; to?: string }) => ({
  from: p.from ?? fyStartOf(p.to ?? today()),
  to: p.to ?? today(),
});

// ---- Day Book -----------------------------------------------------------------------------------------------------------

export const dayBook = defineReport({
  id: 'day-book',
  title: 'Day Book',
  group: 'transaction',
  description:
    'Every voucher of the period with its party and number; money in and out only where cash or a bank moved. Opening and closing cash + bank.',
  ledger: true,
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = { from: p.from ?? today(), to: p.to ?? p.from ?? today() };
    const money = new Set(await moneyAccountIds(tx, p.businessId));
    const entries = await liveEntries(tx, p.businessId, from, to);
    const vouchers = new Map<
      string,
      {
        date: string;
        refType: string;
        refId: string;
        party: string | null;
        total: number;
        moneyIn: number;
        moneyOut: number;
      }
    >();
    for (const { e } of entries) {
      const v = vouchers.get(e.voucherId) ?? {
        date: e.txnDate,
        refType: e.refType,
        refId: e.refId,
        party: null,
        total: 0,
        moneyIn: 0,
        moneyOut: 0,
      };
      v.total = r2(v.total + e.debit);
      if (money.has(e.accountId)) {
        v.moneyIn = r2(v.moneyIn + e.debit);
        v.moneyOut = r2(v.moneyOut + e.credit);
      }
      v.party ??= e.partyId;
      vouchers.set(e.voucherId, v);
    }
    const list = [...vouchers.entries()];
    const refs = await refNumbers(
      tx,
      list.map(([, v]) => v),
    );
    const partyIds = [...new Set(list.map(([, v]) => v.party).filter((x): x is string => !!x))];
    const names = new Map(
      partyIds.length
        ? (
            await tx
              .select({ id: parties.id, name: parties.name })
              .from(parties)
              .where(inArray(parties.id, partyIds))
          ).map((x) => [x.id, x.name])
        : [],
    );
    // A transfer between two money accounts moves nothing in or out of the business: show it, but net.
    const rows = list.map(([id, v]) => {
      const internal = v.refType === 'transfer';
      const net = r2(v.moneyIn - v.moneyOut);
      return {
        id,
        date: v.date,
        party: v.party ? (names.get(v.party) ?? '') : '',
        type: REF_LABELS[v.refType] ?? v.refType,
        refType: v.refType,
        refId: v.refId,
        ref: refs.get(`${v.refType}:${v.refId}`)?.number ?? '',
        total: v.total,
        moneyIn: internal ? Math.max(0, net) : v.moneyIn,
        moneyOut: internal ? Math.max(0, -net) : v.moneyOut,
      };
    });
    const opening = await netOf(tx, [...money], { before: from });
    const moneyIn = r2(rows.reduce((s, r) => s + r.moneyIn, 0));
    const moneyOut = r2(rows.reduce((s, r) => s + r.moneyOut, 0));
    return {
      rows,
      totals: { total: r2(rows.reduce((s, r) => s + r.total, 0)), moneyIn, moneyOut },
      meta: { from, to, opening, closing: r2(opening + moneyIn - moneyOut) },
    };
  },
});

// ---- Cash Flow ----------------------------------------------------------------------------------------------------------

export const cashFlowReport = defineReport({
  id: 'cash-flow',
  title: 'Cash Flow',
  group: 'financial',
  description:
    'Money in and out of cash and banks in the period, by kind (direct method). Opening + in − out = closing, the Cash & Bank total.',
  ledger: true,
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = periodOf(p);
    const money = new Set(await moneyAccountIds(tx, p.businessId));
    const net = new Map<string, { refType: string; net: number }>();
    for (const { e } of await liveEntries(tx, p.businessId, from, to)) {
      if (!money.has(e.accountId)) continue;
      const v = net.get(e.voucherId) ?? { refType: e.refType, net: 0 };
      v.net = r2(v.net + e.debit - e.credit);
      net.set(e.voucherId, v);
    }
    const f = cashFlow({
      opening: await netOf(tx, [...money], { before: from }),
      vouchers: [...net.values()],
    });
    const rows = [
      { id: 'opening', section: '', particulars: 'Opening cash + bank', amount: f.opening },
      ...f.moneyIn.map((x) => ({
        id: `in:${x.name}`,
        section: 'Money in',
        particulars: x.name,
        amount: x.amount,
      })),
      { id: 'in', section: 'Money in', particulars: 'Total money in', amount: f.totalIn },
      ...f.moneyOut.map((x) => ({
        id: `out:${x.name}`,
        section: 'Money out',
        particulars: x.name,
        amount: x.amount,
      })),
      { id: 'out', section: 'Money out', particulars: 'Total money out', amount: f.totalOut },
      { id: 'net', section: '', particulars: 'Net change', amount: f.net },
      { id: 'closing', section: '', particulars: 'Closing cash + bank', amount: f.closing },
    ];
    return {
      rows,
      totals: { opening: f.opening, moneyIn: f.totalIn, moneyOut: f.totalOut, closing: f.closing },
      meta: { from, to },
    };
  },
});

// ---- Party Statement ----------------------------------------------------------------------------------------------------

export const partyStatement = defineReport({
  id: 'party-statement',
  title: 'Party Statement',
  group: 'party',
  description:
    'Everything with one party, from the ledger: opening balance, each sale, purchase, payment and adjustment with a running balance (Dr = they owe you).',
  ledger: true,
  params: commonParams.extend({ partyId: uuid }),
  run: async (tx, p) => {
    const { from, to } = periodOf(p);
    const control = (
      await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.businessId, p.businessId),
            inArray(accounts.code, [ACC.RECEIVABLE, ACC.PAYABLE]),
          ),
        )
    ).map((a) => a.id);
    const [party] = await tx
      .select({ name: parties.name })
      .from(parties)
      .where(eq(parties.id, p.partyId));
    const before = (await liveEntries(tx, p.businessId, undefined, dayBefore(from))).filter(
      (x) => x.e.partyId === p.partyId && control.includes(x.e.accountId),
    );
    const opening = r2(before.reduce((s, x) => s + x.e.debit - x.e.credit, 0));
    const inPeriod = (await liveEntries(tx, p.businessId, from, to)).filter(
      (x) => x.e.partyId === p.partyId && control.includes(x.e.accountId),
    );
    const refs = await refNumbers(
      tx,
      inPeriod.map((x) => x.e),
    );
    let run = opening;
    const rows = inPeriod.map(({ e }) => {
      run = r2(run + e.debit - e.credit);
      const ref = refs.get(`${e.refType}:${e.refId}`);
      const bal = drCr(run, 0);
      return {
        id: e.id,
        date: e.txnDate,
        type: REF_LABELS[e.refType] ?? e.refType,
        refType: e.refType,
        refId: e.refId,
        ref: ref?.number ?? '',
        paymentType: ref?.mode ?? '',
        narration: e.narration,
        debit: e.debit || null,
        credit: e.credit || null,
        balance: run,
        balanceText: `${bal.amount.toFixed(2)} ${run >= 0 ? 'Dr' : 'Cr'}`,
      };
    });
    const debit = r2(rows.reduce((s, r) => s + (r.debit ?? 0), 0));
    const credit = r2(rows.reduce((s, r) => s + (r.credit ?? 0), 0));
    return {
      rows,
      totals: { opening, debit, credit, closing: r2(opening + debit - credit) },
      meta: { from, to, party: party?.name ?? '' },
    };
  },
});

// ---- Profit & Loss ------------------------------------------------------------------------------------------------------

async function pnlOf(
  tx: Parameters<typeof dayBook.run>[0],
  businessId: string,
  from: string,
  to: string,
) {
  const accts = await totalsWithGroup(tx, businessId, from, to);
  const stock = await stockFigures(tx, to, dayBefore(from));
  return profitAndLoss({
    accounts: accts,
    openingStock: stock.before,
    closingStock: stock.closing,
  });
}

export const profitLoss = defineReport({
  id: 'profit-loss',
  title: 'Profit & Loss',
  group: 'financial',
  description:
    'Income and expenses of the period from the ledger, with opening and closing stock at weighted-average cost: gross profit, then net profit. Before tax.',
  ledger: true,
  profit: true,
  params: commonParams,
  run: async (tx, p) => {
    const { from, to } = periodOf(p);
    const pl = await pnlOf(tx, p.businessId, from, to);
    const t = pl.totals;
    const rows: Record<string, unknown>[] = [];
    const section = (name: string, list: { code?: string; name: string; amount: number }[]) =>
      list.forEach((l, i) =>
        rows.push({
          id: `${name}:${l.code ?? i}`,
          section: name,
          particulars: l.name,
          code: l.code ?? '',
          amount: l.amount,
        }),
      );
    const line = (id: string, sectionName: string, particulars: string, amount: number) =>
      rows.push({ id, section: sectionName, particulars, code: '', amount });
    section('Income', pl.directIncome);
    line('directIncome', 'Income', 'Total income', t.directIncome);
    line('openingStock', 'Cost of sales', 'Opening stock', t.openingStock);
    section('Cost of sales', pl.directExpenses);
    line('closingStock', 'Cost of sales', 'Less: closing stock', -t.closingStock);
    line('costOfSales', 'Cost of sales', 'Cost of sales', t.costOfSales);
    line('grossProfit', '', t.grossProfit >= 0 ? 'Gross profit' : 'Gross loss', t.grossProfit);
    section('Other income', pl.indirectIncome);
    section('Indirect expenses', pl.indirectExpenses);
    line('indirectExpenses', 'Indirect expenses', 'Total indirect expenses', t.indirectExpenses);
    line('netProfit', '', t.netProfit >= 0 ? 'Net profit' : 'Net loss', t.netProfit);
    return { rows, totals: t, meta: { from, to } };
  },
});

// ---- Trial Balance ------------------------------------------------------------------------------------------------------

export const trialBalanceReport = defineReport({
  id: 'trial-balance',
  title: 'Trial Balance',
  group: 'financial',
  description:
    'Every account with a balance on the date, debits against credits; the totals must agree.',
  ledger: true,
  params: commonParams,
  run: async (tx, p) => {
    const asOf = p.to ?? today();
    const accts = await totalsWithGroup(tx, p.businessId, undefined, asOf);
    const tb = trialBalance(accts.map((a) => ({ ...a, kind: a.kind as AccountKind })));
    const groupOf = new Map(accts.map((a) => [a.code, a.group]));
    return {
      rows: tb.lines.map((l) => ({ id: l.code, group: groupOf.get(l.code) ?? '', ...l })),
      totals: { debit: tb.debit, credit: tb.credit, difference: r2(tb.debit - tb.credit) },
      meta: { asOf, balanced: tb.balanced },
    };
  },
});

// ---- Balance Sheet ------------------------------------------------------------------------------------------------------

export const balanceSheetReport = defineReport({
  id: 'balance-sheet',
  title: 'Balance Sheet',
  group: 'financial',
  description:
    'What the business owns and owes on the date: assets with closing stock against liabilities, capital and profit. Both sides must be equal.',
  ledger: true,
  profit: true,
  params: commonParams,
  run: async (tx, p) => {
    const asOf = p.to ?? today();
    const accts = await totalsWithGroup(tx, p.businessId, undefined, asOf);
    const stock = await stockFigures(tx, asOf);
    const current = await pnlOf(tx, p.businessId, fyStartOf(asOf), asOf);
    const bs = balanceSheet({
      accounts: accts,
      closingStock: stock.closing,
      openingStock: stock.initial,
      currentProfit: current.totals.netProfit,
    });
    const rows: Record<string, unknown>[] = [];
    const put = (
      side: string,
      heading: string,
      list: { code?: string; name: string; amount: number }[],
    ) =>
      list.forEach((l, i) =>
        rows.push({
          id: `${heading}:${l.code ?? l.name}:${i}`,
          side,
          heading,
          particulars: l.name,
          code: l.code ?? '',
          amount: l.amount,
        }),
      );
    put('Liabilities', 'Capital', bs.capital);
    put('Liabilities', 'Profit', bs.profit);
    put('Liabilities', 'Liabilities', bs.liabilities);
    put('Liabilities', 'Suspense', bs.suspense);
    rows.push({
      id: 'totalL',
      side: 'Liabilities',
      heading: '',
      particulars: 'Total liabilities and capital',
      code: '',
      amount: bs.totals.liabilities,
    });
    put('Assets', 'Assets', bs.assets);
    rows.push({
      id: 'totalA',
      side: 'Assets',
      heading: '',
      particulars: 'Total assets',
      code: '',
      amount: bs.totals.assets,
    });
    return {
      rows,
      totals: {
        assets: bs.totals.assets,
        liabilities: bs.totals.liabilities,
        difference: bs.totals.difference,
      },
      meta: {
        asOf,
        balanced: bs.totals.balanced,
        netProfit: current.totals.netProfit,
        closingStock: stock.closing,
      },
    };
  },
});

// ---- Payable Ageing -----------------------------------------------------------------------------------------------------

export const payableAgeing = defineReport({
  id: 'payable-ageing',
  title: 'Payable Ageing',
  group: 'party',
  description:
    'What you still owe each supplier on the date, split by how old the bills are (0–30, 31–60, 61–90, 90+ days).',
  params: commonParams,
  run: async (tx, p) => {
    const asOf = p.to ?? today();
    const bills = await tx
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.businessId, p.businessId),
          eq(purchases.docType, 'bill'),
          isNull(purchases.deletedAt),
          lte(purchases.purchaseDate, asOf),
        ),
      );
    // What was still owed on `asOf`: the payable of each bill (after TDS and any debit note taken against it) less what
    // had been paid by then, not what is paid today.
    const paid = await paidAsOf(
      tx,
      'purchase',
      bills.map((b) => b.id),
      asOf,
    );
    const docs = [];
    for (const b of bills)
      docs.push({
        partyId: b.supplierId ?? b.supplierName,
        partyName: b.supplierName,
        date: b.purchaseDate,
        due: r2((await dueOfPurchase(tx, b)) - (paid.get(b.id) ?? 0)),
      });
    const rows = ageing(docs, asOf).map((r) => ({ id: r.partyId, ...r }));
    const sum = (k: '0-30' | '31-60' | '61-90' | '90+' | 'total') =>
      r2(rows.reduce((s, r) => s + r[k], 0));
    return {
      rows,
      totals: {
        '0-30': sum('0-30'),
        '31-60': sum('31-60'),
        '61-90': sum('61-90'),
        '90+': sum('90+'),
        total: sum('total'),
      },
      meta: { asOf },
    };
  },
});

export const CORE_REPORTS = [
  dayBook,
  cashFlowReport,
  partyStatement,
  profitLoss,
  trialBalanceReport,
  balanceSheetReport,
  payableAgeing,
];
