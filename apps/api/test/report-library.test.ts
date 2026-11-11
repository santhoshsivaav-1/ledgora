import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenant } from '@ledgora/db';
import { line, makeHarness, type Tenant } from './helpers.ts';
import { commonParams, defineReport } from '../src/reports/registry.ts';
import { getOutbox, clearOutbox } from '../src/mail/index.ts';
import { runDueForOrg, runScheduler } from '../src/reports/schedules.ts';
import { MAX_EXPORT_ROWS } from '../src/modules/reports.ts';

// Vyapar parity Phase 6, the rest of the library (P6-S2 … P6-S8): document, party, item and stock, GST, expense, order,
// salesman and cash reports; Payable and Receivable Ageing as of a date; favourites, recent and saved views; scheduled
// e-mails; and the streamed CSV export. One business with every kind of document, then the equalities the guide asks for.
const h = makeHarness();
let t: Tenant;
const todayStr = new Date().toISOString().slice(0, 10);
const y = Number(todayStr.slice(0, 4)) - (Number(todayStr.slice(5, 7)) < 4 ? 1 : 0);
const FY = { from: `${y}-04-01`, to: todayStr };
const D = (md: string) => `${y}-${md}`;
const ids: Record<string, string> = {};
const r2 = (n: number) => Math.round(n * 100) / 100;

const run = async (id: string, q: Record<string, string> = {}, who: Pick<Tenant, 'call'> = t) =>
  who.call(
    'GET',
    `/v1/reports/${id}?${new URLSearchParams({ businessId: t.businessId, ...FY, ...q })}`,
  );
const ok = async (id: string, q: Record<string, string> = {}) => {
  const r = await run(id, q);
  expect(r.status, `${id}: ${r.text}`).toBe(200);
  return r.body as { rows: any[]; totals: Record<string, number>; meta: Record<string, any> };
};
const row = (rows: any[], pred: (r: any) => boolean) => {
  const r = rows.find(pred);
  expect(r, JSON.stringify(rows).slice(0, 400)).toBeTruthy();
  return r;
};

beforeAll(async () => {
  t = await h.newTenant();
  const call = async (method: string, path: string, body?: unknown, status = 300) => {
    const r = await t.call(method, path, body);
    expect(r.status, `${method} ${path}: ${r.text}`).toBeLessThan(status);
    return r.body;
  };
  // Party groups, three levels deep: Retail > Tamil Nadu > Chennai.
  ids.gRoot = (await call('POST', '/v1/party-groups', { name: 'Retail' })).id;
  ids.gTn = (
    await call('POST', '/v1/party-groups', { name: 'Tamil Nadu', parentId: ids.gRoot })
  ).id;
  ids.gChennai = (
    await call('POST', '/v1/party-groups', { name: 'Chennai', parentId: ids.gTn })
  ).id;
  const party = async (name: string, extra: Record<string, unknown> = {}) =>
    (await call('POST', '/v1/parties', { name, state: 'Tamil Nadu', ...extra })).id as string;
  ids.A = await party('Asha Stores', { groupId: ids.gChennai });
  ids.B = await party('Bala Traders', { groupId: ids.gTn });
  ids.C = await party('Om Supplies');
  // Items: two with stock in a category, one nearly out.
  const item = async (name: string, extra: Record<string, unknown>) =>
    (await call('POST', '/v1/items', { name, taxPercent: 18, trackStock: true, ...extra }))
      .id as string;
  ids.pen = await item('Pen', {
    hsn: '96081019',
    salePrice: 20,
    purchasePrice: 6,
    openingStock: 100,
    extra: { category: 'Stationery' },
  });
  ids.paper = await item('Paper', {
    hsn: '48025590',
    taxPercent: 12,
    salePrice: 100,
    purchasePrice: 70,
    openingStock: 12,
    extra: { category: 'Stationery', minStock: 5 },
  });
  ids.staff = (
    await call('POST', '/v1/staff', { name: 'Ravi', commissionPct: 2, monthlyTarget: 100000 })
  ).id;

  const bill = (invoiceNumber: string, date: string, qty: number, rate: number) =>
    call('POST', '/v1/purchases', {
      businessId: t.businessId,
      supplierId: ids.C,
      purchaseDate: date,
      invoiceNumber,
      items: [{ name: 'Pen', itemId: ids.pen, quantity: qty, rate, taxPercent: 18 }],
    });
  ids.bill1 = (await bill('OM-1', D('05-02'), 100, 8)).id;
  ids.bill2 = (await bill('OM-2', D('06-02'), 50, 10)).id;
  const sale = (body: Record<string, unknown>) =>
    call('POST', '/v1/invoices', { businessId: t.businessId, ...body });
  // A pen line with a ₹120 discount (60 × 20 = 1200, charged 1080).
  ids.inv1 = (
    await sale({
      partyId: ids.A,
      invoiceDate: D('06-10'),
      items: [
        line({
          itemId: ids.pen,
          name: 'Pen',
          hsn: '96081019',
          quantity: 60,
          rate: 20,
          discount: 120,
          taxPercent: 18,
        }),
      ],
    })
  ).id;
  ids.inv2 = (
    await sale({
      partyId: ids.B,
      invoiceDate: D('07-10'),
      salesmanId: ids.staff,
      items: [
        line({
          itemId: ids.paper,
          name: 'Paper',
          hsn: '48025590',
          quantity: 10,
          rate: 100,
          taxPercent: 12,
        }),
      ],
      payments: [{ mode: 'cash', amount: 400 }],
    })
  ).id;
  ids.inv3 = (
    await sale({
      partyId: ids.A,
      invoiceDate: D('07-12'),
      items: [
        line({ name: 'Consulting', hsn: '998313', quantity: 1, rate: 60000, taxPercent: 18 }),
      ],
    })
  ).id;
  ids.inv4 = (
    await sale({
      partyId: ids.B,
      invoiceDate: D('07-14'),
      items: [
        line({
          itemId: ids.pen,
          name: 'Pen',
          hsn: '96081019',
          quantity: 100,
          rate: 600,
          taxPercent: 18,
        }),
      ],
    })
  ).id;
  // A sale that is cancelled, and a credit note.
  ids.inv5 = (
    await sale({
      partyId: ids.A,
      invoiceDate: D('07-20'),
      items: [
        line({
          itemId: ids.paper,
          name: 'Paper',
          hsn: '48025590',
          quantity: 1,
          rate: 100,
          taxPercent: 12,
        }),
      ],
    })
  ).id;
  await call('POST', `/v1/invoices/${ids.inv5}/cancel`, { reason: 'test' });
  await sale({
    partyId: ids.A,
    invoiceType: 'credit-note',
    invoiceDate: D('07-25'),
    items: [
      line({
        itemId: ids.pen,
        name: 'Pen',
        hsn: '96081019',
        quantity: 5,
        rate: 20,
        taxPercent: 18,
      }),
    ],
  });
  // A sale order for 20 pens (20 × 20), 5 invoiced.
  ids.so = (
    await sale({
      partyId: ids.B,
      invoiceType: 'sales-order',
      invoiceDate: D('08-01'),
      items: [
        line({
          itemId: ids.pen,
          name: 'Pen',
          hsn: '96081019',
          quantity: 20,
          rate: 20,
          taxPercent: 18,
        }),
      ],
    })
  ).id;
  await call('POST', `/v1/invoices/${ids.so}/convert`, {
    invoiceDate: D('08-05'),
    lines: [{ position: 0, quantity: 5 }],
  });
  await call('POST', '/v1/purchase-orders', {
    businessId: t.businessId,
    supplierId: ids.C,
    orderDate: D('08-02'),
    items: [{ name: 'Pen', quantity: 40, rate: 7, taxPercent: 18 }],
  });
  // Money: a receipt from Asha with discount, ₹2.5 lakh cash from Bala on one day (§269ST), a payment to the supplier.
  await call('POST', '/v1/payments', {
    businessId: t.businessId,
    partyId: ids.A,
    amount: 1000,
    discountAmount: 50,
    mode: 'bank',
    paymentDate: D('07-15'),
    autoAllocate: true,
  });
  await call('POST', '/v1/payments', {
    businessId: t.businessId,
    partyId: ids.B,
    amount: 250000,
    mode: 'cash',
    paymentDate: D('08-10'),
    cashAcknowledgement: 'test',
  });
  await call('POST', '/v1/payments', {
    businessId: t.businessId,
    partyId: ids.C,
    direction: 'out',
    amount: 900,
    mode: 'bank',
    paymentDate: D('07-20'),
    autoAllocate: true,
  });
  const cats = (await call('GET', '/v1/expense-categories?kind=expense')).data;
  const income = (await call('GET', '/v1/expense-categories?kind=income')).data[0];
  await call('POST', '/v1/expenses', {
    businessId: t.businessId,
    expenseDate: D('08-01'),
    categoryId: cats[0].id,
    amount: 10000,
    items: [{ name: 'Shop rent', quantity: 1, rate: 10000, gstRate: 0 }],
    paymentMode: 'cash',
  });
  await call('POST', '/v1/expenses', {
    businessId: t.businessId,
    expenseDate: D('08-02'),
    categoryId: cats[1].id,
    amount: 200,
    description: 'Tea and snacks',
    paymentMode: 'cash',
  });
  await call('POST', '/v1/expenses', {
    businessId: t.businessId,
    kind: 'income',
    expenseDate: D('08-03'),
    categoryId: income.id,
    amount: 500,
    paymentMode: 'cash',
  });
  // TCS on Bala's sale (the invoice screen sets this; here it is written directly, as the report only reads it).
  await withTenant(h.db, t.orgId, (tx) =>
    tx.execute(
      sql`update invoices set data = jsonb_set(data, '{totals}', coalesce(data->'totals', '{}'::jsonb) || '{"tcsAmount": 11.2}'::jsonb) where id = ${ids.inv2}`,
    ),
  );
});
afterAll(() => h.close());

describe('document reports (P6-S2)', () => {
  it('Sale report: invoices with received and pending, credit notes taken off, cancelled only on request', async () => {
    const s = await ok('sale');
    expect(s.rows.some((r) => r.id === ids.inv5)).toBe(false);
    // Asha's ₹1,000 receipt with ₹50 discount settles the oldest invoice first: ₹1,050 of ₹1,274.40.
    expect(row(s.rows, (r) => r.id === ids.inv1)).toMatchObject({
      party: 'Asha Stores',
      taxable: 1080,
      paymentType: 'Partial',
      received: 1050,
      balance: 224.4,
    });
    expect(row(s.rows, (r) => r.type === 'credit-note')).toMatchObject({
      taxable: -100,
      total: -118,
    });
    // 1080 + 1000 + 60000 + 60000 + 100 (converted) − 100 (credit note)
    expect(s.totals.taxable).toBe(122080);
    expect(s.totals.count).toBe(6);
    const all = await ok('sale', { includeCancelled: '1' });
    expect(all.rows.find((r) => r.id === ids.inv5)).toMatchObject({
      paymentType: 'Cancelled',
      total: 0,
    });
    expect(all.totals.taxable).toBe(122080);
    expect(
      (await ok('sale', { partyId: ids.B })).rows.every((r) => r.party === 'Bala Traders'),
    ).toBe(true);
    expect((await ok('sale', { creditNotes: '0' })).totals.taxable).toBe(122180);
  });

  it('Purchase report: bills with paid, pending and the input credit; the first bill took the ₹900', async () => {
    const p = await ok('purchase');
    expect(p.totals).toMatchObject({
      total: 1534,
      paid: 900,
      balance: 634,
      taxable: 1300,
      tax: 234,
      itcClaimed: 234,
      count: 2,
    });
    expect(row(p.rows, (r) => r.number === 'OM-1')).toMatchObject({ paid: 900, balance: 44 });
  });

  it('All Transactions lists every kind and filters by type; its sale rows are the Sale report', async () => {
    const a = await ok('all-transactions');
    const kinds = new Set(a.rows.map((r) => r.type));
    for (const k of [
      'Sale',
      'Credit note',
      'Purchase',
      'Payment in',
      'Payment out',
      'Expense',
      'Other income',
    ])
      expect(kinds.has(k), `${k} in ${[...kinds]}`).toBe(true);
    const only = await ok('all-transactions', { types: 'sale' });
    // The sale filter is the sales documents: five invoices and the credit note, as the Sale report counts them.
    expect(new Set(only.rows.map((r) => r.type))).toEqual(new Set(['Sale', 'Credit note']));
    expect(only.totals.count).toBe((await ok('sale')).totals.count);
    expect(only.totals.total).toBe((await ok('sale')).totals.total);
    const two = await ok('all-transactions', { types: 'payment-in,expense' });
    expect(new Set(two.rows.map((r) => r.type))).toEqual(new Set(['Payment in', 'Expense']));
  });

  it('Bill Wise Profit costs at the weighted average of the invoice date; Party-wise and Item-wise P&L add up to the same profit', async () => {
    const b = await ok('bill-wise-profit');
    // On 10 June the pens are 100 at ₹8 and 50 at ₹10 (the opening stock is dated the day the item was made): ₹8.6667.
    const inv1 = row(b.rows, (r) => r.id === ids.inv1);
    expect(inv1.sale).toBe(1080);
    expect(inv1.cost).toBeCloseTo(520, 0);
    expect(inv1.profit).toBeCloseTo(560, 0);
    expect(inv1.profitPct).toBeCloseTo(51.9, 0);
    // A service costs nothing.
    expect(row(b.rows, (r) => r.id === ids.inv3)).toMatchObject({
      sale: 60000,
      cost: 0,
      profit: 60000,
    });
    const party = await ok('party-pnl');
    const item = await ok('item-pnl');
    expect(party.totals.profit).toBe(b.totals.profit);
    expect(item.totals.profit).toBe(b.totals.profit);
    expect(item.totals.saleAmt).toBe(b.totals.sale);
    expect(party.totals.sale).toBe(b.totals.sale);
    expect((await ok('category-pnl')).totals.profit).toBe(b.totals.profit);
    expect(b.totals.sale).toBe((await ok('sale', { creditNotes: '0' })).totals.taxable);
    // A role that may not see profit gets 403.
    const viewer = await h.addMember(t, 'viewer');
    expect((await run('bill-wise-profit', {}, viewer)).status).toBe(403);
    expect((await run('item-pnl', {}, viewer)).status).toBe(403);
  });

  it('Receivable Ageing counts only money received by the date; Payable Ageing too (the as-of fix)', async () => {
    const before = await ok('ageing', { to: D('07-12') });
    // Asha's 10 June invoice (₹1,274.40) and Bala's 10 July one (₹1,120, ₹400 paid at once); Asha's receipt is 15 July.
    expect(row(before.rows, (r) => r.partyName === 'Asha Stores').total).toBe(1274.4 + 70800);
    const after = await ok('ageing');
    const sales = await ok('sale', { creditNotes: '0' });
    expect(after.totals.total).toBe(sales.totals.balance);
    const payBefore = await ok('payable-ageing', { to: D('07-10') });
    expect(payBefore.totals.total).toBe(1534);
    const payAfter = await ok('payable-ageing', { to: D('07-31') });
    expect(payAfter.totals.total).toBe(634);
    expect(row(payAfter.rows, (r) => r.partyName === 'Om Supplies')).toMatchObject({ '90+': 0 });
  });
});

describe('party reports (P6-S3)', () => {
  it('All Parties: what each owes and is owed, with group and a balance filter', async () => {
    const a = await ok('all-parties');
    expect(row(a.rows, (r) => r.name === 'Asha Stores').group).toBe('Chennai');
    expect(row(a.rows, (r) => r.name === 'Om Supplies').toPay).toBe(634);
    expect((await ok('all-parties', { balance: 'payable' })).rows.map((r) => r.name)).toEqual([
      'Om Supplies',
    ]);
    const tn = await ok('all-parties', { groupId: ids.gTn });
    expect(tn.rows.map((r) => r.name).sort()).toEqual(['Asha Stores', 'Bala Traders']); // Chennai is under Tamil Nadu
  });

  it('By Party and By Party Group: three levels, children rolled into their parents', async () => {
    const byParty = await ok('by-party');
    expect(byParty.totals.amount).toBe(122080);
    const g = await ok('by-party-group');
    const amount = (name: string) => row(g.rows, (r) => r.group === name).amount;
    const asha = row(byParty.rows, (r) => r.party === 'Asha Stores').amount;
    const bala = row(byParty.rows, (r) => r.party === 'Bala Traders').amount;
    expect(amount('Chennai')).toBe(asha);
    expect(amount('Tamil Nadu')).toBe(r2(asha + bala));
    expect(amount('Retail')).toBe(r2(asha + bala));
    expect(row(g.rows, (r) => r.group === 'Tamil Nadu')).toMatchObject({ depth: 1, own: bala });
    expect(g.totals.amount).toBe(122080); // each party once
    expect((await ok('by-party', { side: 'purchase' })).totals.amount).toBe(1300);
  });

  it('Party Report by Item and Item Report by Party agree', async () => {
    const pi = await ok('party-by-item', { partyId: ids.A });
    expect(row(pi.rows, (r) => r.item === 'Pen')).toMatchObject({ saleQty: 55, saleAmt: 980 }); // 60 sold − 5 returned
    const ip = await ok('item-by-party', { itemId: ids.pen });
    expect(row(ip.rows, (r) => r.party === 'Asha Stores').saleQty).toBe(55);
    expect(row(ip.rows, (r) => r.party === 'Om Supplies').purchaseQty).toBe(150);
  });

  it('Salesman: net sales, collections, commission and the target', async () => {
    const s = await ok('salesman');
    expect(row(s.rows, (r) => r.salesman === 'Ravi')).toMatchObject({
      sales: 1000,
      collected: 400,
      outstanding: 720,
      commission: 20,
      targetPct: 1,
    });
  });
});

describe('item and stock reports (P6-S4)', () => {
  it('Stock Summary value = Σ Stock Detail value, and quantity = the running stock of each item', async () => {
    const sum = await ok('stock-summary');
    let value = 0;
    for (const r of sum.rows) {
      const d = await ok('stock-detail', { itemId: r.id });
      expect(d.totals.value, r.item).toBe(r.value);
      expect(d.totals.closing, r.item).toBe(r.qty);
      value = r2(value + d.totals.value);
    }
    expect(sum.totals.value).toBe(value);
    // Pen: 100 opening + 150 bought − 60 − 100 − 5 + 5 returned in − 5 invoiced from the order.
    expect(row(sum.rows, (r) => r.item === 'Pen').qty).toBe(100 + 150 - 60 - 100 + 5 - 5);
    expect((await ok('stock-summary', { hideZero: '1' })).rows.length).toBeGreaterThan(0);
  });

  it('Stock Detail and Item Detail list the movements with their documents and a running balance', async () => {
    const d = await ok('item-detail', { itemId: ids.pen });
    expect(d.meta.item).toBe('Pen');
    const purchase = row(d.rows, (r) => r.number === 'OM-1');
    expect(purchase).toMatchObject({
      type: 'Purchase',
      qtyIn: 100,
      price: 8,
      party: 'Om Supplies',
    });
    expect(row(d.rows, (r) => r.refId === ids.inv1)).toMatchObject({
      type: 'Sale',
      qtyOut: 60,
      price: 20,
      party: 'Asha Stores',
    });
    let run = d.totals.opening;
    for (const r of d.rows) {
      run = Math.round((run + (r.qtyIn ?? 0) - (r.qtyOut ?? 0)) * 1000) / 1000;
      expect(r.balance).toBe(run);
    }
  });

  it('Low Stock: an item’s own minimum, else the limit given', async () => {
    const low = await ok('low-stock');
    // Paper: 12 − 10 sold = 2, below its own minimum of 5. Pen has 140 and no minimum of its own (the limit is 5).
    expect(row(low.rows, (r) => r.item === 'Paper')).toMatchObject({
      current: 2,
      minStock: 5,
      shortfall: 3,
    });
    expect(low.rows.map((r) => r.item)).not.toContain('Pen');
    expect((await ok('low-stock', { threshold: '200' })).rows.map((r) => r.item).sort()).toEqual([
      'Paper',
      'Pen',
    ]);
  });

  it('categories add up: stock by category = summary, sale by category = the Sale report', async () => {
    const sum = await ok('stock-summary');
    const cat = await ok('stock-by-category');
    expect(cat.totals.value).toBe(sum.totals.value);
    expect(row(cat.rows, (r) => r.category === 'Stationery').qty).toBe(sum.totals.qty);
    expect((await ok('by-category')).totals.amount).toBe((await ok('sale')).totals.taxable);
    expect((await ok('by-category', { side: 'purchase' })).totals.amount).toBe(1300);
  });

  it('Item-wise Discount: the ₹120 given on the pens', async () => {
    const d = await ok('item-discount');
    // ₹120 on ₹61,300 of pens at the undiscounted value (1,080 + 60,000 + 100 charged, plus the 120).
    expect(row(d.rows, (r) => r.item === 'Pen')).toMatchObject({ discount: 120, discountPct: 0.2 });
  });
});

describe('GST reports (P6-S5)', () => {
  it('GST Rate Report totals equal the Sale report’s taxable value and tax', async () => {
    const sale = await ok('sale');
    const g = await ok('gst-rate');
    expect(g.totals.taxable).toBe(sale.totals.taxable);
    expect(g.totals.totalTax).toBe(sale.totals.tax);
    expect(row(g.rows, (r) => r.rate === 12).taxable).toBe(1000);
    const both = await ok('gst-rate', { side: 'both' });
    expect(new Set(both.rows.map((r) => r.side))).toEqual(new Set(['Sale', 'Purchase']));
    expect((await ok('gst-rate', { creditNotes: '0' })).totals.taxable).toBe(122180);
  });

  it('HSN and SAC split goods and services; together they are the Rate Report; digits cut the code', async () => {
    const hsn = await ok('hsn');
    const sac = await ok('sac');
    expect(sac.rows.map((r) => r.code)).toEqual(['998313']);
    expect(hsn.totals.taxable + sac.totals.taxable).toBe((await ok('gst-rate')).totals.taxable);
    expect(row(hsn.rows, (r) => r.code === '96081019').qty).toBe(60 + 100 + 5 - 5);
    const four = await ok('hsn', { digits: '4' });
    expect(four.rows.map((r) => r.code)).toEqual(['4802', '9608']);
    expect(four.totals.taxable).toBe(hsn.totals.taxable);
  });

  it('Sale with GST and Purchase with GST: one row per document and rate, same totals', async () => {
    const s = await ok('sale-gst');
    expect(s.totals.taxable).toBe((await ok('sale')).totals.taxable);
    expect(row(s.rows, (r) => r.id.startsWith(ids.inv2))).toMatchObject({
      party: 'Bala Traders',
      rate: 12,
      cgst: 60,
      sgst: 60,
      igst: 0,
    });
    const p = await ok('purchase-gst');
    expect(p.totals.taxable).toBe(1300);
    expect(p.rows.every((r) => r.itc === 'eligible')).toBe(true);
  });

  it('Form 27EQ: TCS by the day the money came in, a missing PAN flagged', async () => {
    const q = await ok('form-27eq');
    expect(q.meta.beta).toBe(true);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0]).toMatchObject({
      collectee: 'Bala Traders',
      received: 400,
      tcs: 4,
      rate: 1,
      date: D('07-10'),
      pan: 'PANNOTAVBL',
      panMissing: true,
    });
    expect(q.totals).toMatchObject({ received: 400, tcs: 4, missingPan: 1 });
    expect((await ok('form-27eq', { from: D('08-01'), to: D('08-31') })).rows).toHaveLength(0);
  });

  it('E-way Bill Register: goods invoices of ₹50,000 or more, pending until recorded', async () => {
    const r = await ok('eway-register');
    expect(r.rows.map((x) => x.id)).toEqual([ids.inv4]); // the ₹70,800 consulting invoice is a service
    expect(r.rows[0]).toMatchObject({ status: 'pending', value: 70800 });
    expect(r.totals.pending).toBe(1);
    expect(
      (await t.call('PUT', `/v1/eway-bills/${ids.inv4}`, { status: 'generated' })).status,
    ).toBe(422);
    const rec = await t.call('PUT', `/v1/eway-bills/${ids.inv4}`, {
      ewayNo: '281001234567',
      vehicleNo: 'tn09ab1234',
      status: 'generated',
      validUntil: D('07-16'),
    });
    expect(rec.status, rec.text).toBe(200);
    const after = await ok('eway-register');
    expect(after.rows[0]).toMatchObject({
      ewayNo: '281001234567',
      vehicle: 'TN09AB1234',
      status: 'generated',
    });
    expect((await ok('eway-register', { status: 'pending' })).rows).toHaveLength(0);
    expect(
      (
        await t.call('PUT', `/v1/eway-bills/${ids.inv4}`, {
          ewayNo: '281001234567',
          status: 'cancelled',
        })
      ).status,
    ).toBe(200); // updates in place
    expect((await ok('eway-register')).rows[0].status).toBe('cancelled');
  });
});

describe('expense, order and cash reports (P6-S6)', () => {
  it('Expense reports: list, categories with shares, items, other income', async () => {
    const e = await ok('expense');
    expect(e.totals.total).toBe(10200);
    const cat = await ok('expense-category');
    expect(cat.totals.total).toBe(10200);
    expect(Math.round(cat.rows.reduce((s, r) => s + r.share, 0))).toBe(100);
    const item = await ok('expense-item');
    expect(row(item.rows, (r) => r.item === 'Shop rent').amount).toBe(10000);
    expect(row(item.rows, (r) => r.item === 'Tea and snacks').amount).toBe(200);
    expect((await ok('other-income')).totals.total).toBe(500);
    expect(
      (
        await ok('expense', {
          categoryId:
            cat.rows[0].id === 'Uncategorised' ? ids.A : '00000000-0000-4000-8000-000000000000',
        })
      ).rows,
    ).toHaveLength(0);
  });

  it('Discount Report: sales-line discount and payment discount given', async () => {
    const d = await ok('discount');
    expect(row(d.rows, (r) => r.party === 'Asha Stores')).toMatchObject({
      saleDiscount: 120,
      paymentDiscountGiven: 50,
    });
  });

  it('Sale Order and Order Item: status from the invoices made, advance, pending quantity', async () => {
    const o = await ok('sale-order');
    expect(o.rows).toHaveLength(1);
    expect(o.rows[0]).toMatchObject({
      party: 'Bala Traders',
      status: 'partially-invoiced',
      total: 472,
    });
    expect((await ok('sale-order', { status: 'closed' })).rows).toHaveLength(0);
    const it2 = await ok('sale-order-item');
    expect(it2.rows).toMatchObject([
      { item: 'Pen', ordered: 20, invoiced: 5, pending: 15, amount: 400 },
    ]);
  });

  it('Purchase Order report', async () => {
    const o = await ok('purchase-order');
    expect(o.rows).toHaveLength(1);
    expect(o.rows[0]).toMatchObject({ supplier: 'Om Supplies', status: 'open', taxable: 280 });
  });

  it('Cash Watch (§269ST): the ₹2.5 lakh cash day, and a higher limit hides it', async () => {
    const c = await ok('cash-watch');
    expect(c.rows).toMatchObject([
      { party: 'Bala Traders', total: 250000, over: 50000, date: D('08-10') },
    ]);
    expect((await ok('cash-watch', { limit: '300000' })).rows).toHaveLength(0);
  });
});

describe('favourites, recent and saved views (P6-S8)', () => {
  it('star and unstar; recent keeps the last five, newest first, no repeats', async () => {
    await t.call('PUT', '/v1/reports/prefs/favourites', { reportId: 'sale', on: true });
    await t.call('PUT', '/v1/reports/prefs/favourites', { reportId: 'day-book', on: true });
    let p = (await t.call('PUT', '/v1/reports/prefs/favourites', { reportId: 'sale', on: false }))
      .body;
    expect(p.favourites).toEqual(['day-book']);
    for (const id of ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6', 'a-3'])
      p = (await t.call('POST', '/v1/reports/prefs/recent', { reportId: id })).body;
    expect(p.recent).toEqual(['a-3', 'a-6', 'a-5', 'a-4', 'a-2']);
  });

  it('a saved view restores its filters exactly, the same name replaces it, and others do not see it', async () => {
    const params = {
      period: { from: '2026-04-01', to: '2026-09-30', label: 'H1' },
      partyId: ids.A,
      includeCancelled: '1',
    };
    const saved = (
      await t.call('POST', '/v1/reports/prefs/views', { name: 'Asha H1', reportId: 'sale', params })
    ).body;
    expect(saved.views[0]).toMatchObject({ name: 'Asha H1', reportId: 'sale', params });
    const again = (
      await t.call('POST', '/v1/reports/prefs/views', {
        name: 'asha h1',
        reportId: 'sale',
        params: { partyId: ids.B },
      })
    ).body;
    expect(again.views).toHaveLength(1);
    expect(again.views[0].params).toEqual({ partyId: ids.B });
    const other = await h.addMember(t, 'accountant');
    expect((await other.call('GET', '/v1/reports/prefs')).body.views).toEqual([]);
    const id = again.views[0].id;
    expect((await t.call('DELETE', `/v1/reports/prefs/views/${id}`)).body.views).toEqual([]);
    expect((await t.call('DELETE', `/v1/reports/prefs/views/${id}`)).status).toBe(404);
  });
});

describe('scheduled report e-mails (P6-S8)', () => {
  it('sends the previous week once, however often the runner wakes; the next week sends again', async () => {
    const accountant = await h.addMember(t, 'accountant');
    const created = await accountant.call('POST', '/v1/reports/schedules', {
      businessId: t.businessId,
      reportId: 'sale',
      params: { partyId: ids.A },
      frequency: 'weekly',
      recipients: ['Owner@Example.com', 'ca@example.com'],
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({
      title: 'Sale Report',
      recipients: ['owner@example.com', 'ca@example.com'],
      lastPeriod: null,
    });
    clearOutbox();
    const go = (day: string) =>
      withTenant(h.db, t.orgId, (tx) => runDueForOrg(tx, t.orgId, h.env, day));
    expect(await go('2026-11-11')).toEqual({ sent: 1, skipped: 0, failed: 0 });
    const mails = getOutbox().filter((m) => m.kind === 'mail') as any[];
    expect(mails.map((m) => m.to).sort()).toEqual(['ca@example.com', 'owner@example.com']);
    expect(mails[0].subject).toMatch(/Sale Report: 2026-11-02 to 2026-11-08/);
    expect(mails[0].attachments[0].filename).toBe('sale-2026-11-02-to-2026-11-08.csv');
    expect(await go('2026-11-11')).toEqual({ sent: 0, skipped: 1, failed: 0 }); // a second runner the same day
    expect(await go('2026-11-14')).toEqual({ sent: 0, skipped: 1, failed: 0 }); // still the same week
    expect(await go('2026-11-16')).toEqual({ sent: 1, skipped: 0, failed: 0 }); // a new week
    const list = (await t.call('GET', `/v1/reports/schedules?businessId=${t.businessId}`)).body
      .data;
    expect(list[0]).toMatchObject({ lastPeriod: '2026-11-09..2026-11-15', lastError: null });
  });

  it('the scheduler finds due schedules across organizations itself, and a monthly one sends the month before', async () => {
    const m = await h.newTenant();
    await m.call('POST', '/v1/reports/schedules', {
      businessId: m.businessId,
      reportId: 'payable-ageing',
      frequency: 'monthly',
      recipients: ['boss@example.com'],
    });
    clearOutbox();
    const r = await runScheduler(h.db, h.env, new Date('2026-12-01T09:00:00Z'));
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(r.failed).toBe(0);
    const mail = (getOutbox() as any[]).find((x) => x.to === 'boss@example.com');
    expect(mail.subject).toMatch(/Payable Ageing: 2026-11-01 to 2026-11-30/);
    expect((await runScheduler(h.db, h.env, new Date('2026-12-02T09:00:00Z'))).sent).toBe(0);
  });

  it('a schedule is checked: report, filters, recipients, role; a failing report keeps its error and tries again', async () => {
    const bad = (body: Record<string, unknown>) =>
      t.call('POST', '/v1/reports/schedules', {
        businessId: t.businessId,
        frequency: 'weekly',
        recipients: ['a@example.com'],
        reportId: 'sale',
        ...body,
      });
    expect((await bad({ reportId: 'no-such' })).status).toBe(404);
    expect((await bad({ recipients: ['not-an-email'] })).status).toBe(400);
    expect((await bad({ params: { partyId: 'x' } })).status).toBe(422);
    const viewer = await h.addMember(t, 'viewer');
    expect(
      (
        await viewer.call('POST', '/v1/reports/schedules', {
          businessId: t.businessId,
          frequency: 'weekly',
          recipients: ['a@example.com'],
          reportId: 'sale',
        })
      ).status,
    ).toBe(403);
    const failing = await t.call('POST', '/v1/reports/schedules', {
      businessId: t.businessId,
      reportId: 'sale',
      params: {},
      frequency: 'weekly',
      recipients: ['x@example.com'],
    });
    await withTenant(h.db, t.orgId, (tx) =>
      tx.execute(
        sql`update report_schedules set params = '{"partyId":"not-a-uuid"}'::jsonb where id = ${failing.body.id}`,
      ),
    );
    const out = await withTenant(h.db, t.orgId, (tx) =>
      runDueForOrg(tx, t.orgId, h.env, '2027-02-01'),
    );
    expect(out.failed).toBe(1);
    const row2 = (
      await t.call('GET', `/v1/reports/schedules?businessId=${t.businessId}`)
    ).body.data.find((s: any) => s.id === failing.body.id);
    expect(row2.lastPeriod).toBeNull();
    expect(row2.lastError).toBeTruthy();
    const paused = await t.call('PATCH', `/v1/reports/schedules/${failing.body.id}`, {
      active: false,
    });
    expect(paused.body.active).toBe(false);
    expect((await t.call('DELETE', `/v1/reports/schedules/${failing.body.id}`)).status).toBe(200);
  });
});

describe('CSV export (P6-S1)', () => {
  it('a report as a CSV file, formula-safe, behind the export permission', async () => {
    const r = await t.call(
      'GET',
      `/v1/reports/sale/export?${new URLSearchParams({ businessId: t.businessId, ...FY })}`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/csv/);
    const lines = r.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe(
      'Date,Number,Party,Type,Payment type,Total,Received,Balance,Taxable,Tax,Salesman',
    );
    expect(lines).toHaveLength(1 + 6);
    expect(r.headers.get('x-report-rows')).toBe('6');
    const viewer = await h.addMember(t, 'viewer');
    expect(
      (await viewer.call('GET', `/v1/reports/sale/export?businessId=${t.businessId}`)).status,
    ).toBe(403);
    expect(
      (await t.call('GET', `/v1/reports/profit-loss/export?businessId=${t.businessId}`)).status,
    ).toBe(409); // ledger is off here
  });

  it('streams 100,000 rows without growing memory by a report’s worth, and says when it was cut', async () => {
    defineReport({
      id: 'toy-big',
      title: 'Toy big',
      group: 'transaction',
      description: 'test',
      params: commonParams.extend({ n: z.coerce.number().int().default(120000) }),
      run: async (_tx, p) => ({
        rows: Array.from({ length: p.n }, (_, i) => ({
          id: i,
          n: i,
          text: `row ${i}, "quoted"`,
          f: i === 0 ? '=1+1' : 'ok',
        })),
      }),
    });
    const before = process.memoryUsage().heapUsed;
    const r = await t.call('GET', `/v1/reports/toy-big/export?businessId=${t.businessId}`);
    const grew = (process.memoryUsage().heapUsed - before) / 1_048_576;
    expect(r.status).toBe(200);
    expect(r.headers.get('x-report-truncated')).toBe('1');
    expect(r.headers.get('x-report-rows')).toBe(String(MAX_EXPORT_ROWS));
    const lines = r.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines).toHaveLength(MAX_EXPORT_ROWS + 1);
    expect(lines[1]).toBe('0,"row 0, ""quoted""",\'=1+1');
    expect(grew).toBeLessThan(250);
    const small = await t.call('GET', `/v1/reports/toy-big/export?businessId=${t.businessId}&n=10`);
    expect(small.headers.get('x-report-truncated')).toBeNull();
  });
});
