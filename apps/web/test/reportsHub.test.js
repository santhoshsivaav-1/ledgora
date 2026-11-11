// Vyapar parity Phase 6 on the web: the hub's grouping and search, and the report definitions (P6-S1).
import { describe, expect, it } from 'vitest';
import { groupReports } from '../src/features/reports/hub';
import { CLIENT_REPORTS, columnsFromRows, reportDefinition, signed } from '../src/features/reports/definitions';
import { initialParams } from '../src/components/ui/ReportShell';

const SERVER = [
  { id: 'day-book', title: 'Day Book', group: 'transaction', description: 'Every voucher' },
  { id: 'profit-loss', title: 'Profit & Loss', group: 'financial', description: 'Income and expenses' },
  { id: 'payable-ageing', title: 'Payable Ageing', group: 'party', description: 'What you owe suppliers' },
  { id: 'toy', title: 'Toy', group: 'odd', description: '' },
];

describe('reports hub', () => {
  it('groups in hub order (financial first), unknown groups last, Cash & Bank from the client list', () => {
    const g = groupReports([...SERVER, ...CLIENT_REPORTS]);
    expect(g.map((x) => x.id)).toEqual(['financial', 'transaction', 'party', 'cashbank', 'odd']);
    expect(g.find((x) => x.id === 'cashbank').reports.map((r) => r.id)).toEqual(['bank-statement', 'loan-statement', 'cheque-register']);
  });
  it('search matches title and description; empty groups drop out', () => {
    expect(groupReports(SERVER, 'suppliers').map((x) => x.reports.map((r) => r.id))).toEqual([['payable-ageing']]);
    expect(groupReports(SERVER, 'nothing like this')).toEqual([]);
  });
});

describe('report definitions', () => {
  const ctx = { businessId: 'b', parties: [{ id: 'p1', name: 'Ravi' }], banks: [{ id: 'k', label: 'HDFC' }], loans: [] };
  it('every core and Cash & Bank report has a definition with columns, filters and exports', () => {
    for (const id of ['day-book', 'cash-flow', 'party-statement', 'profit-loss', 'trial-balance', 'balance-sheet', 'payable-ageing', ...CLIENT_REPORTS.map((r) => r.id)]) {
      const d = reportDefinition(id, ctx);
      expect(d, id).toBeTruthy();
      expect(d.columns.length, id).toBeGreaterThan(1);
      expect(d.exports, id).toEqual(expect.arrayContaining(['pdf', 'xlsx', 'csv']));
      expect(typeof d.fetch, id).toBe('function');
    }
    expect(reportDefinition('no-such', ctx)).toBeNull();
  });
  it('defaults: Day Book opens on today, statements on this FY, the party select on the first party', () => {
    const today = new Date(2026, 10, 11);
    expect(initialParams(reportDefinition('day-book', ctx), { today }).period.from).toBe('2026-11-11');
    expect(initialParams(reportDefinition('profit-loss', ctx), { today }).period).toMatchObject({ from: '2026-04-01', to: '2027-03-31' });
    expect(initialParams(reportDefinition('party-statement', ctx), { today }).partyId).toBe('p1');
  });
  it('summary chips read the server totals and meta, not a sum of the rows', () => {
    const d = reportDefinition('day-book', ctx);
    const chips = d.summary([{ moneyIn: 1 }], { moneyIn: 500, moneyOut: 200 }, { opening: 1000, closing: 1300 });
    expect(chips.map((c) => c.value)).toEqual([1000, 500, 200, 1300]);
    const tb = reportDefinition('trial-balance', ctx).summary([], { debit: 10, credit: 10, difference: 0 }, { balanced: true });
    expect(tb[2]).toMatchObject({ value: 'Balanced ✔', money: false });
  });
  it('a ledger row opens its document', () => {
    expect(reportDefinition('day-book', ctx).drilldown({ refType: 'invoice' })).toBe('/invoices');
    expect(reportDefinition('day-book', ctx).drilldown({ refType: 'journal' })).toBeNull();
  });
  it('a report nobody described gets a column per key, numbers as money', () => {
    expect(columnsFromRows([{ id: 1, name: 'x', amount: 5 }])).toEqual([
      { id: 'name', header: 'name' },
      { id: 'amount', header: 'amount', format: 'money' },
    ]);
    expect(columnsFromRows([])).toEqual([]);
  });
});

describe('financial statement money', () => {
  it('Indian grouping, negatives in parentheses', () => {
    expect(signed(205000)).toBe('2,05,000.00');
    expect(signed(-9059)).toBe('(9,059.00)');
    expect(signed(1117272.21)).toBe('11,17,272.21');
  });
});


// ---- the rest of the library on the web (P6-S2 … P6-S8) ------------------------------------------------------------------
import { LINKED_REPORTS } from '../src/features/reports/definitions';
import { SPEC_IDS, specDefinition } from '../src/features/reports/serverSpecs';
import { pickReports } from '../src/features/reports/hub';
import { reportQuery } from '../src/lib/data/reports';

const SERVER_IDS = [
  'sale', 'purchase', 'all-transactions', 'bill-wise-profit', 'ageing', 'all-parties', 'party-pnl', 'party-by-item', 'by-party',
  'by-party-group', 'salesman', 'stock-summary', 'stock-by-category', 'stock-detail', 'item-detail', 'low-stock', 'item-by-party',
  'item-pnl', 'category-pnl', 'by-category', 'item-discount', 'gst-rate', 'hsn', 'sac', 'sale-gst', 'purchase-gst', 'form-27eq',
  'eway-register', 'expense', 'expense-category', 'expense-item', 'other-income', 'discount', 'sale-order', 'sale-order-item',
  'purchase-order', 'cash-watch',
];

describe('every server report has a web spec', () => {
  const ctx = { businessId: 'b', parties: [{ id: 'p', name: 'Ravi' }], items: [{ id: 'i', name: 'Pen' }], groups: [{ id: 'g', name: 'Retail' }], categories: [{ id: 'c', name: 'Rent' }] };
  it('each of the 37 specs has filters, columns and a fetch', () => {
    expect(new Set(SPEC_IDS)).toEqual(new Set(SERVER_IDS));
    for (const id of SERVER_IDS) {
      const d = specDefinition({ id, title: id, description: '' }, ctx);
      expect(d.columns.length, id).toBeGreaterThan(1);
      expect(d.filters.length, id).toBeGreaterThan(0);
      expect(typeof d.fetch, id).toBe('function');
      expect(d.exports, id).toEqual(expect.arrayContaining(['pdf', 'xlsx', 'csv']));
    }
    expect(specDefinition({ id: 'nope' }, ctx)).toBeNull();
  });
  it('a report that needs an item or a party waits until one is chosen, then asks the server', async () => {
    const d = specDefinition({ id: 'stock-detail', title: 'x' }, { ...ctx, items: [] });
    expect(await d.fetch({ itemId: '' })).toEqual({ rows: [] });
    expect(initialParams(specDefinition({ id: 'stock-detail', title: 'x' }, ctx), { today: new Date(2026, 10, 11) }).itemId).toBe('i');
  });
  it('toggles reach the server as 0 and 1, the period as from and to, empty filters not at all', () => {
    const q = new URLSearchParams(reportQuery('biz', { period: { from: '2026-04-01', to: '2026-04-30', label: 'x' }, includeCancelled: true, creditNotes: false, partyId: '', side: 'purchase', q: 'ignored' }));
    expect(Object.fromEntries(q)).toEqual({ businessId: 'biz', from: '2026-04-01', to: '2026-04-30', includeCancelled: '1', creditNotes: '0', side: 'purchase' });
  });
  it('the e-way register, Form 27EQ and the party-group roll-up have the columns the guide names', () => {
    const cols = (id) => specDefinition({ id, title: id }, ctx).columns.map((c) => c.header);
    expect(cols('eway-register')).toEqual(expect.arrayContaining(['Invoice', 'E-way bill no', 'Vehicle', 'Status', 'JSON exported']));
    expect(cols('form-27eq')).toEqual(expect.arrayContaining(['Collectee PAN', 'Nature of collection', 'TCS collected']));
    const g = specDefinition({ id: 'by-party-group', title: 'x' }, ctx).columns[0];
    expect(g.render({ group: 'Chennai', depth: 2 })).toBe('      Chennai');
  });
  it('the summary chips read server totals: Bill Wise Profit margin, Low Stock count', () => {
    const bw = specDefinition({ id: 'bill-wise-profit', title: 'x' }, ctx).summary([], { sale: 1000, cost: 600, profit: 400, profitPct: 40 }, {});
    expect(bw.map((c) => c.value)).toEqual([1000, 600, 400, '40%']);
    expect(specDefinition({ id: 'low-stock', title: 'x' }, ctx).summary([], { count: 3 }, {})[0]).toMatchObject({ value: 3, money: false });
  });
});

describe('hub favourites and links', () => {
  it('favourites and recent follow the order kept and skip reports that no longer exist', () => {
    const all = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(pickReports(all, ['c', 'gone', 'a']).map((r) => r.id)).toEqual(['c', 'a']);
  });
  it('the existing GST and income-tax screens are listed and link to their own pages', () => {
    expect(LINKED_REPORTS.map((r) => r.id)).toEqual(expect.arrayContaining(['gstr1', 'gstr3b', 'gstr2b', 'tds-tcs', 'itr-summary', 'advance-tax']));
    expect(LINKED_REPORTS.every((r) => r.path.startsWith('/'))).toBe(true);
    const groups = groupReports([...SERVER_IDS.map((id) => ({ id, title: id, group: id === 'cash-watch' ? 'incometax' : 'gst', description: '' })), ...LINKED_REPORTS]);
    expect(groups.map((g) => g.label)).toEqual(['GST', 'Income Tax']);
  });
});
