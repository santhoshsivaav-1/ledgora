// Vyapar parity Phase 6: the report definitions the web app draws with ReportShell. A server report (GET /v1/reports/:id)
// needs only filters, columns and chips here; its rows and totals come from the API. A server report without a
// definition still opens, with columns taken from its rows (`genericDefinition`), so adding one never needs a screen.
// The Cash & Bank reports read their own endpoints.

import { apiClient } from '../../lib/apiClient';
import {
  CASH_BANK_REPORTS,
  bankStatement,
  bankStatementRows,
  cashStatement,
  cashbankRefLink,
  chequeRegisterRows,
  getLoan,
  listCheques,
  loanStatementRows,
} from '../../lib/data/cashbank';
import { localToday } from '../../utils';
import { reportQuery } from '../../lib/data/reports';
import { formatMoney } from '../../components/ui/lib/format';

const sumOf = (rows, k) =>
  Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
const EXPORTS = ['pdf', 'xlsx', 'csv', 'share'];

/** Runs a server report with the period and filters chosen (toggles go as 0/1). */
export const runServerReport = (id, businessId, params = {}) =>
  apiClient.get(`/v1/reports/${encodeURIComponent(id)}?${reportQuery(businessId, params)}`);
const server = (id, ctx) => (params) => runServerReport(id, ctx.businessId, params);

/** Where a ledger row opens: the screen of the document behind it. */
const openDocument = (r) => (r.refType ? cashbankRefLink(r.refType) : null);
/** Financial-statement money: Indian grouping, a negative figure in parentheses (P6-S1 money formats). */
export const signed = (n) => (Number(n) < 0 ? `(${formatMoney(Math.abs(n))})` : formatMoney(n));

/** Client-only reports (Cash & Bank) and the groups the hub shows them in. */
export const CLIENT_REPORTS = CASH_BANK_REPORTS.map((r) => ({
  ...r,
  group: 'cashbank',
  description: {
    'bank-statement':
      'Deposits, withdrawals and the running balance of a bank or Cash in Hand; reconciled entries ticked.',
    'loan-statement':
      'The money received and every payment of a loan with interest, charges, TDS and the balance after.',
    'cheque-register': 'Cheques received and issued, their status and days past their date.',
  }[r.id],
  needs: 'cashbank',
}));

/** Reports that already have their own screens: the hub lists them and links to those screens. */
export const LINKED_REPORTS = [
  {
    id: 'gstr1',
    title: 'GSTR-1',
    group: 'gst',
    description: 'Outward supplies for the month, with the portal JSON.',
    path: '/gst-returns/gstr1',
  },
  {
    id: 'gstr3b',
    title: 'GSTR-3B',
    group: 'gst',
    description: 'Summary return: tax payable, input credit and its reversals.',
    path: '/gst-returns/gstr3b',
  },
  {
    id: 'gstr2b',
    title: 'GSTR-2B reconciliation',
    group: 'gst',
    description: 'Your purchases against what suppliers filed.',
    path: '/gst-returns/gstr2b',
  },
  {
    id: 'tds-tcs',
    title: 'TDS / TCS',
    group: 'gst',
    description: 'TDS deducted by you, challans and due dates.',
    path: '/gst-returns/tds',
  },
  {
    id: 'itr-summary',
    title: 'ITR Summary',
    group: 'incometax',
    description: 'Income and tax for the year, old and new regime.',
    path: '/income-tax',
  },
  {
    id: 'advance-tax',
    title: 'Advance Tax',
    group: 'incometax',
    description: 'Instalments of advance tax and what is due.',
    path: '/income-tax',
  },
];

/** The ReportShell definition of report `id`, given what the page loaded (`ctx`: businessId, banks, loans, parties). */
export function reportDefinition(id, ctx) {
  const base = { id, exports: EXPORTS };
  switch (id) {
    case 'day-book':
      return {
        ...base,
        title: 'Day Book',
        description:
          'Every voucher of the period. Money in and out only where cash or a bank moved; a credit sale shows its total and no money.',
        filters: [{ kind: 'period', default: 'today' }, { kind: 'search' }],
        columns: [
          { id: 'date', header: 'Date', sortable: true },
          { id: 'party', header: 'Party', sortable: true },
          { id: 'type', header: 'Txn type' },
          { id: 'ref', header: 'Ref no.' },
          { id: 'total', header: 'Total', format: 'money', total: 'sum' },
          { id: 'moneyIn', header: 'Money in', format: 'money', total: 'sum' },
          { id: 'moneyOut', header: 'Money out', format: 'money', total: 'sum' },
        ],
        summary: (_r, t, m) => [
          { label: 'Opening cash + bank', value: m.opening ?? 0 },
          { label: 'Money in', value: t.moneyIn ?? 0, tone: 'pos' },
          { label: 'Money out', value: t.moneyOut ?? 0, tone: 'neg' },
          { label: 'Closing cash + bank', value: m.closing ?? 0 },
        ],
        drilldown: openDocument,
        fetch: server(id, ctx),
      };
    case 'cash-flow':
      return {
        ...base,
        title: 'Cash Flow',
        description:
          'Money in and out of cash and banks by kind. Opening + in − out = closing, the Cash & Bank total.',
        filters: [{ kind: 'period', default: 'this-fy' }],
        columns: [
          { id: 'section', header: 'Section' },
          { id: 'particulars', header: 'Particulars' },
          { id: 'amount', header: 'Amount (₹)', format: 'money' },
        ],
        summary: (_r, t) => [
          { label: 'Opening', value: t.opening ?? 0 },
          { label: 'Money in', value: t.moneyIn ?? 0, tone: 'pos' },
          { label: 'Money out', value: t.moneyOut ?? 0, tone: 'neg' },
          { label: 'Closing', value: t.closing ?? 0 },
        ],
        fetch: server(id, ctx),
      };
    case 'party-statement':
      return {
        ...base,
        title: 'Party Statement',
        description:
          'Everything with one party from the ledger, with a running balance (Dr = they owe you). Print or share it as a statement.',
        filters: [
          {
            kind: 'select',
            id: 'partyId',
            label: 'Party',
            options: (ctx.parties || []).map((p) => ({ value: p.id, label: p.name })),
          },
          { kind: 'period', default: 'this-fy' },
        ],
        columns: [
          { id: 'date', header: 'Date' },
          { id: 'type', header: 'Txn type' },
          { id: 'ref', header: 'Ref' },
          { id: 'paymentType', header: 'Pmt type' },
          { id: 'debit', header: 'Debit', format: 'money', total: 'sum' },
          { id: 'credit', header: 'Credit', format: 'money', total: 'sum' },
          { id: 'balanceText', header: 'Balance', align: 'right' },
        ],
        summary: (_r, t) => [
          { label: 'Opening', value: t.opening ?? 0 },
          { label: 'Total debit', value: t.debit ?? 0 },
          { label: 'Total credit', value: t.credit ?? 0 },
          {
            label: 'Closing',
            value: `₹${Math.abs(t.closing ?? 0).toFixed(2)} ${(t.closing ?? 0) >= 0 ? 'Dr' : 'Cr'}`,
            money: false,
          },
        ],
        drilldown: openDocument,
        fetch: (params) =>
          params.partyId
            ? runServerReport(id, ctx.businessId, params)
            : Promise.resolve({ rows: [] }),
      };
    case 'profit-loss':
      return {
        ...base,
        title: 'Profit & Loss',
        description:
          'Income and expenses of the period with opening and closing stock (weighted average). Before tax.',
        filters: [{ kind: 'period', default: 'this-fy' }],
        columns: [
          { id: 'section', header: 'Section' },
          { id: 'particulars', header: 'Particulars' },
          {
            id: 'amount',
            header: 'Amount (₹)',
            align: 'right',
            accessor: (r) => r.amount,
            render: (r) => signed(r.amount),
          },
        ],
        summary: (_r, t) => [
          { label: 'Sales (net)', value: t.directIncome ?? 0 },
          {
            label: 'Gross profit',
            value: t.grossProfit ?? 0,
            tone: (t.grossProfit ?? 0) >= 0 ? 'pos' : 'neg',
          },
          {
            label: 'Net profit',
            value: t.netProfit ?? 0,
            tone: (t.netProfit ?? 0) >= 0 ? 'pos' : 'neg',
          },
          { label: 'Closing stock', value: t.closingStock ?? 0 },
        ],
        fetch: server(id, ctx),
      };
    case 'trial-balance':
      return {
        ...base,
        title: 'Trial Balance',
        description:
          'Every account with a balance on the last day of the period; debits must equal credits.',
        filters: [{ kind: 'period', default: 'this-fy' }, { kind: 'search' }],
        columns: [
          { id: 'code', header: 'Code', sortable: true },
          { id: 'name', header: 'Account', sortable: true },
          { id: 'group', header: 'Group', sortable: true },
          { id: 'debit', header: 'Debit', format: 'money', total: 'sum' },
          { id: 'credit', header: 'Credit', format: 'money', total: 'sum' },
        ],
        summary: (_r, t, m) => [
          { label: 'Debit', value: t.debit ?? 0 },
          { label: 'Credit', value: t.credit ?? 0 },
          {
            label: 'Balance check',
            value: m.balanced
              ? 'Balanced ✔'
              : `Differs by ₹${Math.abs(t.difference ?? 0).toFixed(2)}`,
            money: false,
            tone: m.balanced ? 'pos' : 'neg',
          },
        ],
        fetch: server(id, ctx),
      };
    case 'balance-sheet':
      return {
        ...base,
        title: 'Balance Sheet',
        description:
          'On the last day of the period: assets with closing stock against capital, profit and liabilities.',
        filters: [{ kind: 'period', default: 'this-fy' }],
        columns: [
          { id: 'side', header: 'Side' },
          { id: 'heading', header: 'Heading' },
          { id: 'particulars', header: 'Particulars' },
          {
            id: 'amount',
            header: 'Amount (₹)',
            align: 'right',
            accessor: (r) => r.amount,
            render: (r) => signed(r.amount),
          },
        ],
        summary: (_r, t, m) => [
          { label: 'Total assets', value: t.assets ?? 0 },
          { label: 'Liabilities + capital', value: t.liabilities ?? 0 },
          {
            label: 'Check',
            value: m.balanced ? 'Balanced ✔' : `Difference ₹${(t.difference ?? 0).toFixed(2)}`,
            money: false,
            tone: m.balanced ? 'pos' : 'neg',
          },
        ],
        fetch: server(id, ctx),
      };
    case 'payable-ageing':
      return {
        ...base,
        title: 'Payable Ageing',
        description:
          'What you still owe each supplier on the last day of the period, by the age of the bills.',
        filters: [{ kind: 'period', default: 'this-fy' }, { kind: 'search' }],
        columns: [
          { id: 'partyName', header: 'Supplier', sortable: true },
          { id: '0-30', header: '0–30 days', format: 'money', total: 'sum' },
          { id: '31-60', header: '31–60', format: 'money', total: 'sum' },
          { id: '61-90', header: '61–90', format: 'money', total: 'sum' },
          { id: '90+', header: '90+', format: 'money', total: 'sum' },
          { id: 'total', header: 'Total', format: 'money', total: 'sum', sortable: true },
        ],
        summary: (_r, t) => [
          { label: 'Total payable', value: t.total ?? 0, tone: 'neg' },
          { label: '90+ days', value: t['90+'] ?? 0 },
        ],
        fetch: server(id, ctx),
      };
    case 'bank-statement':
      return {
        ...base,
        title: 'Bank Statement',
        description:
          'Every deposit and withdrawal of an account with its running balance; ✔ marks entries reconciled with the bank.',
        filters: [
          {
            kind: 'select',
            id: 'account',
            label: 'Account',
            options: [
              ...(ctx.banks || []).map((b) => ({ value: b.id, label: b.label })),
              { value: 'cash', label: 'Cash in Hand' },
            ],
          },
          { kind: 'period', default: 'this-fy' },
          { kind: 'search' },
        ],
        columns: [
          { id: 'date', header: 'Date', sortable: true },
          { id: 'description', header: 'Description' },
          { id: 'reference', header: 'Type' },
          { id: 'party', header: 'Party' },
          { id: 'withdrawal', header: 'Withdrawal', format: 'money', total: 'sum' },
          { id: 'deposit', header: 'Deposit', format: 'money', total: 'sum' },
          { id: 'balance', header: 'Balance', format: 'money' },
          { id: 'reconciled', header: 'Rec', align: 'center' },
        ],
        summary: (rows) => [
          { label: 'Opening', value: rows[0]?.id === 'opening' ? rows[0].balance : 0 },
          { label: 'Deposits', value: sumOf(rows, 'deposit') },
          { label: 'Withdrawals', value: sumOf(rows, 'withdrawal') },
          { label: 'Closing', value: rows.at(-1)?.balance ?? 0 },
        ],
        fetch: async ({ account, period }) => {
          if (!account) return { rows: [] };
          const range = { from: period?.from, to: period?.to };
          const st =
            account === 'cash'
              ? await cashStatement(ctx.businessId, range)
              : await bankStatement(account, range);
          return { rows: bankStatementRows(st) };
        },
      };
    case 'loan-statement':
      return {
        ...base,
        title: 'Loan Statement',
        description:
          'The money received and every payment with principal, interest, charges and TDS, and what is still owed after each.',
        filters: [
          {
            kind: 'select',
            id: 'loan',
            label: 'Loan',
            options: (ctx.loans || []).map((l) => ({ value: l.id, label: l.name })),
          },
        ],
        columns: [
          { id: 'date', header: 'Date' },
          { id: 'type', header: 'Type' },
          { id: 'principal', header: 'Principal', format: 'money' },
          { id: 'interest', header: 'Interest', format: 'money', total: 'sum' },
          { id: 'charges', header: 'Charges', format: 'money', total: 'sum' },
          { id: 'tds', header: 'TDS (194A)', format: 'money', total: 'sum' },
          { id: 'balance', header: 'Balance', format: 'money' },
        ],
        summary: (rows) => [
          { label: 'Outstanding', value: rows.at(-1)?.balance ?? 0 },
          { label: 'Interest', value: sumOf(rows, 'interest') },
          { label: 'TDS deducted', value: sumOf(rows, 'tds') },
        ],
        fetch: async ({ loan }) =>
          loan ? { rows: loanStatementRows(await getLoan(loan)) } : { rows: [] },
      };
    case 'cheque-register':
      return {
        ...base,
        title: 'Cheque Register',
        description:
          'Cheques received and issued by cheque date, with how many days an uncleared one is past its date.',
        filters: [
          {
            kind: 'select',
            id: 'direction',
            label: 'Direction',
            options: [
              { value: '', label: 'Received and issued' },
              { value: 'received', label: 'Received' },
              { value: 'issued', label: 'Issued' },
            ],
          },
          {
            kind: 'select',
            id: 'status',
            label: 'Status',
            options: [
              { value: '', label: 'All statuses' },
              ...['open', 'deposited', 'cleared', 'bounced', 'cancelled'].map((s) => ({
                value: s,
                label: s,
              })),
            ],
          },
          { kind: 'period', default: 'this-fy' },
          { kind: 'search' },
        ],
        columns: [
          { id: 'direction', header: 'Direction' },
          { id: 'number', header: 'Cheque no' },
          { id: 'party', header: 'Party', sortable: true },
          { id: 'amount', header: 'Amount', format: 'money', total: 'sum', sortable: true },
          { id: 'date', header: 'Cheque date', sortable: true },
          { id: 'status', header: 'Status' },
          { id: 'daysOverdue', header: 'Days overdue', align: 'right', sortable: true },
        ],
        summary: (rows) => [
          { label: 'Cheques', value: rows.length, money: false },
          { label: 'Amount', value: sumOf(rows, 'amount') },
          {
            label: 'Overdue',
            value: rows.filter((r) => r.daysOverdue).length,
            money: false,
            tone: 'neg',
          },
        ],
        fetch: async ({ direction, status, period }) => ({
          rows: chequeRegisterRows(
            await listCheques(ctx.businessId, {
              direction,
              status,
              from: period?.from,
              to: period?.to,
            }),
            localToday(),
          ),
        }),
      };
    default:
      return null;
  }
}

/** A server report with no definition here: period filter, columns from the keys of its first row. */
export function genericDefinition(meta, ctx) {
  return {
    id: meta.id,
    title: meta.title,
    description: meta.description,
    exports: EXPORTS,
    filters: [{ kind: 'period', default: 'this-fy' }, { kind: 'search' }],
    columns: [],
    fetch: async (params) => {
      const r = await runServerReport(meta.id, ctx.businessId, params);
      return r;
    },
  };
}

/** Columns for rows nobody described: one per key, numbers as money. */
export const columnsFromRows = (rows) =>
  Object.keys(rows[0] || {})
    .filter((k) => k !== 'id' && k !== 'refId')
    .map((k) => ({
      id: k,
      header: k,
      ...(typeof rows[0][k] === 'number' ? { format: 'money' } : {}),
    }));
