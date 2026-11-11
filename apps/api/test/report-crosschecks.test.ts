import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { line, makeHarness, type Tenant } from './helpers.ts';
import { commonParams, defineReport } from '../src/reports/registry.ts';

// Vyapar parity Phase 6 (core): the report engine and the cross-checks the guide asks for
// (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P6-S1 acceptance, "Phase 6 test plan" cross-checks, P6-S2/S3/S7 acceptance).
// One business with stock, sales, purchases, payments, an expense, a loan, a transfer and a cleared cheque; then every
// equality between reports, the ledger and the Cash & Bank screens.
const h = makeHarness();
let t: Tenant;
const today = new Date().toISOString().slice(0, 10);
const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
const FY_FROM = `${y}-04-01`;
const D = (md: string) => `${y}-${md}`; // a date in this financial year (April–December side)
const ids: Record<string, string> = {};

const report = async (
  id: string,
  q: Record<string, string> = {},
  who: Pick<Tenant, 'call'> = t,
) => {
  const r = await who.call(
    'GET',
    `/v1/reports/${id}?${new URLSearchParams({ businessId: t.businessId, ...q })}`,
  );
  return r;
};
const ok = async (id: string, q: Record<string, string> = {}) => {
  const r = await report(id, q);
  expect(r.status, `${id}: ${r.text}`).toBe(200);
  return r.body;
};
const acct = async (code: string) =>
  ((await t.call('GET', `/v1/accounts?businessId=${t.businessId}`)).body.data as any[]).find(
    (a) => a.code === code,
  );
const closing = async (code: string, partyId?: string) => {
  const a = await acct(code);
  const l = (await t.call('GET', `/v1/ledger/${a.id}${partyId ? `?partyId=${partyId}` : ''}`)).body;
  return l.closingSide === 'Dr' ? l.closing : -l.closing;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

beforeAll(async () => {
  t = await h.newTenant();
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await t.call(method, path, body);
    expect(r.status, `${method} ${path}: ${r.text}`).toBeLessThan(300);
    return r.body;
  };
  ids.customer = (
    await call('POST', '/v1/parties', { name: 'Ravi Traders', state: 'Tamil Nadu' })
  ).id;
  ids.supplier = (
    await call('POST', '/v1/parties', { name: 'Om Supplies', state: 'Tamil Nadu' })
  ).id;
  ids.pen = (
    await call('POST', '/v1/items', {
      name: 'Pen',
      salePrice: 20,
      purchasePrice: 6,
      taxPercent: 18,
      openingStock: 100,
    })
  ).id;
  // Two purchases at different prices; one sale on credit, one paid in cash.
  ids.bill1 = (
    await call('POST', '/v1/purchases', {
      businessId: t.businessId,
      supplierId: ids.supplier,
      purchaseDate: D('05-02'),
      invoiceNumber: 'OM-1',
      items: [{ name: 'Pen', itemId: ids.pen, quantity: 100, rate: 8, taxPercent: 18 }],
    })
  ).id;
  ids.bill2 = (
    await call('POST', '/v1/purchases', {
      businessId: t.businessId,
      supplierId: ids.supplier,
      purchaseDate: D('06-02'),
      invoiceNumber: 'OM-2',
      items: [{ name: 'Pen', itemId: ids.pen, quantity: 50, rate: 10, taxPercent: 18 }],
    })
  ).id;
  await call('POST', '/v1/invoices', {
    businessId: t.businessId,
    partyId: ids.customer,
    invoiceDate: D('06-10'),
    items: [line({ itemId: ids.pen, name: 'Pen', quantity: 60, rate: 20, taxPercent: 18 })],
  });
  await call('POST', '/v1/invoices', {
    businessId: t.businessId,
    partyId: ids.customer,
    invoiceDate: D('07-10'),
    items: [line({ itemId: ids.pen, name: 'Pen', quantity: 20, rate: 20, taxPercent: 18 })],
    payments: [{ mode: 'cash', amount: 472 }],
  });
  await call('POST', '/v1/accounting/backfill', { businessId: t.businessId, dryRun: false });
  await call('PUT', '/v1/cashbank/settings', { businessId: t.businessId, enabled: true });
  ids.bank = (
    await call('POST', '/v1/bank-accounts', {
      businessId: t.businessId,
      label: 'HDFC Current',
      openingBalance: 50000,
      openingDate: FY_FROM,
    })
  ).id;
  await call('POST', '/v1/payments', {
    businessId: t.businessId,
    partyId: ids.customer,
    amount: 1000,
    mode: 'bank',
    accountId: ids.bank,
    paymentDate: D('07-15'),
    autoAllocate: true,
  });
  await call('POST', '/v1/payments', {
    businessId: t.businessId,
    partyId: ids.supplier,
    direction: 'out',
    amount: 900,
    mode: 'bank',
    accountId: ids.bank,
    paymentDate: D('07-20'),
    autoAllocate: true,
  });
  const cats = (await call('GET', '/v1/expense-categories?kind=expense')).data;
  await call('POST', '/v1/expenses', {
    businessId: t.businessId,
    expenseDate: D('08-01'),
    categoryId: cats[0].id,
    amount: 300,
    taxAmount: 0,
    paymentMode: 'cash',
    paidAmount: 300,
  });
  const loan = await call('POST', '/v1/loans', {
    businessId: t.businessId,
    name: 'Term loan',
    principal: 100000,
    ratePct: 12,
    tenureMonths: 12,
    firstEmiDate: D('09-05'),
    receivedOn: D('08-05'),
    receivedAccountId: ids.bank,
  });
  await call('POST', `/v1/loans/${loan.id}/payments`, {
    kind: 'emi',
    date: D('09-05'),
    principal: loan.nextDue.principal,
    interest: loan.nextDue.interest,
    accountId: ids.bank,
  });
  const money = (await call('GET', `/v1/cashbank/accounts?businessId=${t.businessId}`)).data;
  await call('POST', '/v1/transfers', {
    businessId: t.businessId,
    fromAccountId: money.find((m: any) => m.kind === 'bank').accountId,
    toAccountId: money.find((m: any) => m.kind === 'cash').accountId,
    amount: 2000,
    fee: 10,
    date: D('09-10'),
  });
  const chq = await call('POST', '/v1/cheques', {
    businessId: t.businessId,
    direction: 'received',
    partyId: ids.customer,
    number: '123456',
    amount: 500,
    chequeDate: D('09-12'),
    receivedDate: D('09-12'),
    bankAccountId: ids.bank,
    autoAllocate: true,
  });
  await call('POST', `/v1/cheques/${chq.id}/actions`, { action: 'clear', date: D('09-14') });
});
afterAll(() => h.close());

describe('P6-S1 report engine', () => {
  it('a definition alone is enough: a toy report shows in the list and runs, no route or hub change', async () => {
    defineReport({
      id: 'toy-count',
      title: 'Toy',
      group: 'transaction',
      description: 'test',
      params: commonParams.extend({ n: z.coerce.number().int().default(2) }),
      run: async (_tx, p) => ({
        rows: Array.from({ length: p.n }, (_, i) => ({ id: i, value: i * 10 })),
        totals: { value: (p.n * (p.n - 1) * 10) / 2 },
      }),
    });
    const list = (await t.call('GET', '/v1/reports')).body.data;
    expect(list.map((r: any) => r.id)).toEqual(
      expect.arrayContaining([
        'toy-count',
        'day-book',
        'cash-flow',
        'party-statement',
        'profit-loss',
        'trial-balance',
        'balance-sheet',
        'payable-ageing',
      ]),
    );
    const r = await ok('toy-count', { n: '4' });
    expect(r).toMatchObject({ totals: { value: 60 }, meta: { id: 'toy-count', title: 'Toy' } });
    expect(r.rows).toHaveLength(4);
    expect((await report('toy-count', { n: 'x' })).status).toBe(400);
    expect((await report('no-such-report')).status).toBe(404);
  });

  it('permissions: a viewer reads reports but not profit ones; a salesman reads none', async () => {
    const viewer = await h.addMember(t, 'viewer');
    expect((await report('day-book', {}, viewer)).status).toBe(200);
    expect((await report('trial-balance', {}, viewer)).status).toBe(200);
    expect((await report('profit-loss', {}, viewer)).status).toBe(403);
    expect((await report('balance-sheet', {}, viewer)).status).toBe(403);
    const list = (await viewer.call('GET', '/v1/reports')).body.data;
    expect(list.find((r: any) => r.id === 'profit-loss').allowed).toBe(false);
    const acc = await h.addMember(t, 'accountant');
    expect((await report('profit-loss', {}, acc)).status).toBe(200);
    const sm = await h.addMember(t, 'salesman');
    expect((await report('day-book', {}, sm)).status).toBe(403);
  });

  it('a ledger report on a business without the ledger is refused, not empty', async () => {
    const other = await h.newTenant();
    const r = await other.call('GET', `/v1/reports/day-book?businessId=${other.businessId}`);
    expect(r.status).toBe(409);
  });
});

describe('Phase 6 cross-checks', () => {
  it('Day Book and Cash Flow close at the Cash & Bank total', async () => {
    const money = (await t.call('GET', `/v1/cashbank/accounts?businessId=${t.businessId}`)).body
      .data;
    const cashBank = r2(money.reduce((s: number, m: any) => s + m.balance, 0));
    const db = await ok('day-book', { from: FY_FROM, to: today });
    expect(db.meta.closing).toBe(cashBank);
    expect(db.meta.opening).toBe(0);
    const cf = await ok('cash-flow', { from: FY_FROM, to: today });
    expect(cf.totals.closing).toBe(cashBank);
    expect(cf.rows.find((r: any) => r.id === 'closing').amount).toBe(cashBank);
    // The transfer moved nothing in or out except its fee.
    const transfer = db.rows.find((r: any) => r.refType === 'transfer');
    expect([transfer.moneyIn, transfer.moneyOut]).toEqual([0, 10]);
    // A credit sale is in the Day Book with its total but no money.
    const credit = db.rows.find((r: any) => r.refType === 'invoice' && r.date === D('06-10'));
    expect(credit).toMatchObject({ total: 1416, moneyIn: 0, moneyOut: 0, party: 'Ravi Traders' });
  });

  it('Party Statement closes at the party’s ledger balance, for a customer and a supplier', async () => {
    for (const [party, code] of [
      [ids.customer, '1300'],
      [ids.supplier, '2000'],
    ]) {
      const st = await ok('party-statement', { partyId: party, from: FY_FROM, to: today });
      expect(st.totals.closing, code).toBe(await closing(code, party));
      expect(st.rows.at(-1).balance).toBe(st.totals.closing);
    }
    const v = (await t.call('GET', `/v1/verify?businessId=${t.businessId}`)).body;
    expect(v.checks.find((c: any) => c.id === 'party_balance_mismatch').count).toBe(0);
  });

  it('Trial Balance balances and matches the ledger’s trial balance', async () => {
    const tb = await ok('trial-balance', { to: today });
    const ledger = (
      await t.call('GET', `/v1/ledger/trial-balance?businessId=${t.businessId}&asOf=${today}`)
    ).body;
    expect(tb.meta.balanced).toBe(true);
    expect(tb.totals).toMatchObject({ debit: ledger.debit, credit: ledger.credit, difference: 0 });
  });

  it('P&L net profit = income − expenses from the Trial Balance + closing − opening stock', async () => {
    const pl = await ok('profit-loss', { from: FY_FROM, to: today });
    const tb = await ok('trial-balance', { to: today });
    const inc = tb.rows
      .filter((r: any) => r.kind === 'income')
      .reduce((s: number, r: any) => s + r.credit - r.debit, 0);
    const exp = tb.rows
      .filter((r: any) => r.kind === 'expense')
      .reduce((s: number, r: any) => s + r.debit - r.credit, 0);
    expect(pl.totals.netProfit).toBe(
      r2(inc - exp + pl.totals.closingStock - pl.totals.openingStock),
    );
    // Weighted average, in the order the stock moved: 100 bought at ₹8, 50 at ₹10 (average ₹8.6667), 60 and 20 sold
    // (70 left), then the 100 opening units at ₹6 (dated today, when the item was created): 70 × 8.6667 + 600.
    expect(pl.totals.closingStock).toBe(1206.67);
    expect(pl.rows.find((r: any) => r.id === 'netProfit').amount).toBe(pl.totals.netProfit);
  });

  it('Balance Sheet balances; its current-year profit and closing stock are the P&L’s', async () => {
    const bs = await ok('balance-sheet', { to: today });
    const pl = await ok('profit-loss', { from: FY_FROM, to: today });
    expect(bs.meta.balanced).toBe(true);
    expect(bs.totals.difference).toBe(0);
    expect(bs.totals.assets).toBe(bs.totals.liabilities);
    expect(bs.meta.netProfit).toBe(pl.totals.netProfit);
    expect(bs.meta.closingStock).toBe(pl.totals.closingStock);
    expect(bs.rows.find((r: any) => r.particulars === 'Net profit (current year)').amount).toBe(
      pl.totals.netProfit,
    );
    expect(bs.rows.find((r: any) => r.particulars === 'Closing stock').amount).toBe(
      pl.totals.closingStock,
    );
  });

  it('Payable Ageing totals what is still due on the bills, which is what the supplier’s ledger says', async () => {
    const ag = await ok('payable-ageing', { to: today });
    expect(ag.rows).toHaveLength(1);
    expect(ag.totals.total).toBe(-(await closing('2000', ids.supplier)));
    expect(ag.rows[0].partyName).toBe('Om Supplies');
  });

  it('Bank Statement (Cash & Bank) closes at the bank balance (P6-S6 acceptance)', async () => {
    const st = (await t.call('GET', `/v1/bank-accounts/${ids.bank}/transactions`)).body;
    const b = (await t.call('GET', `/v1/bank-accounts/${ids.bank}`)).body;
    expect(st.closing).toBe(b.balance);
  });
});
