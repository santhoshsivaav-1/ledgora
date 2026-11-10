import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { line, makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity Phase 2: salesman, inline payments, additional charges, save guards, Payment In upgrade, credit notes
// and sale orders (docs/VYAPAR_IMPLEMENTATION_PHASES.md, "Phase 2 test plan", API layer).
const h = makeHarness();
let t: Tenant;

const party = async (who: Tenant, extra: Record<string, unknown> = {}) => {
  const res = await who.call('POST', '/v1/parties', {
    name: `P ${Math.random()}`,
    state: 'Tamil Nadu',
    ...extra,
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
};
/** One line worth `amount` with no GST, so totals are easy to read. */
const flat = (amount: number, over: Record<string, unknown> = {}) =>
  line({ quantity: 1, rate: amount, taxPercent: 0, ...over });
const sale = (who: Tenant, body: Record<string, unknown>) =>
  who.call('POST', '/v1/invoices', {
    businessId: who.businessId,
    invoiceDate: '2026-11-05',
    items: [flat(1000)],
    ...body,
  });
const audits = async (who: Tenant, action: string) =>
  ((await who.call('GET', `/v1/audit?q=${action}&limit=50`)).body.data as any[]).filter(
    (a) => a.action === action,
  );
const setPrefs = (who: Tenant, transaction: Record<string, unknown>, extra = {}) =>
  who.call('PUT', `/v1/businesses/${who.businessId}/settings`, {
    numberSettings: {},
    printSettings: {},
    preferences: { transaction, ...extra },
  });

beforeAll(async () => {
  t = await h.newTenant();
});
afterAll(() => h.close());

// ---- P2-S1 -------------------------------------------------------------------------------------------------------------

describe('P2-S1 salesman master', () => {
  it('adds, validates, deactivates; the picker list hides inactive', async () => {
    expect((await t.call('POST', '/v1/staff', { name: 'Bad', phone: '12345' })).status).toBe(400);
    expect((await t.call('POST', '/v1/staff', { name: 'Bad', commissionPct: 101 })).status).toBe(
      400,
    );
    const k = await t.call('POST', '/v1/staff', {
      name: 'Kumar',
      phone: '9876543210',
      commissionPct: 2,
      monthlyTarget: 500000,
    });
    expect(k.status, k.text).toBe(201);
    const off = (await t.call('POST', '/v1/staff', { name: 'Old Hand' })).body.id;
    expect((await t.call('PATCH', `/v1/staff/${off}`, { active: false })).body.active).toBe(false);
    const all = (await t.call('GET', '/v1/staff')).body.data.map((s: any) => s.name);
    const active = (await t.call('GET', '/v1/staff?active=true')).body.data.map((s: any) => s.name);
    expect(all).toEqual(expect.arrayContaining(['Kumar', 'Old Hand']));
    expect(active).not.toContain('Old Hand');
    // An inactive salesman can not be put on a new invoice.
    expect((await sale(t, { salesmanId: off })).status).toBe(422);
  });

  it('performance equals the sale list filtered by salesman; a credit note lowers commission', async () => {
    const s = (
      await t.call('POST', '/v1/staff', { name: 'Ravi', commissionPct: 2, monthlyTarget: 10000 })
    ).body.id;
    const p = await party(t);
    const a = (await sale(t, { partyId: p, salesmanId: s, items: [flat(3000)] })).body;
    await sale(t, {
      partyId: p,
      salesmanId: s,
      items: [line({ quantity: 1, rate: 2000, taxPercent: 18 })],
    });
    await t.call('POST', '/v1/payments', {
      businessId: t.businessId,
      partyId: p,
      amount: 1000,
      paymentDate: '2026-11-06',
      allocations: [{ invoiceId: a.id, amount: 1000 }],
    });
    const q = `from=2026-11-01&to=2026-11-30`;
    const list = (await t.call('GET', `/v1/invoices?salesmanId=${s}&${q}`)).body.data as any[];
    const perf = (await t.call('GET', `/v1/staff/${s}/performance?${q}`)).body;
    const sum = (k: string) => list.reduce((x, i) => x + i[k], 0);
    expect(perf.sales).toBe(sum('taxableAmount'));
    expect(perf.collected).toBe(sum('paidAmount'));
    expect(perf.outstanding).toBe(Math.round((sum('total') - sum('paidAmount')) * 100) / 100);
    expect(perf.commission).toBe(100); // 2% of 5,000
    expect(perf.targetPct).toBe(50);
    expect(perf.invoices).toHaveLength(2);

    const cn = await t.call('POST', '/v1/invoices', {
      businessId: t.businessId,
      invoiceType: 'credit-note',
      invoiceDate: '2026-11-07',
      partyId: p,
      salesmanId: s,
      againstInvoiceId: a.id,
      items: [flat(1000, { quantity: 1 })],
    });
    expect(cn.status, cn.text).toBe(201);
    const after = (await t.call('GET', `/v1/staff/${s}/performance?${q}`)).body;
    expect(after.commission).toBe(80); // 2% of (5,000 - 1,000)
  });

  it('a salesman linked to a staff row sees and edits only their own invoices', async () => {
    const t2 = await h.newTenant();
    const a = await h.addMember(t2, 'salesman');
    const b = await h.addMember(t2, 'salesman');
    const sa = (await t2.call('POST', '/v1/staff', { name: 'A', userId: a.userId })).body.id;
    const sb = (await t2.call('POST', '/v1/staff', { name: 'B', userId: b.userId })).body.id;
    expect((await t2.call('POST', '/v1/staff', { name: 'A2', userId: a.userId })).status).toBe(409);
    const asA = { ...t2, call: a.call };
    const mine = await sale(asA, {});
    expect(mine.status, mine.text).toBe(201);
    expect(mine.body.salesmanId).toBe(sa); // filled in for them
    expect((await sale(asA, { salesmanId: sb })).status).toBe(403);
    const theirs = (await sale(t2, { salesmanId: sb })).body;
    const unassigned = (await sale(t2, {})).body;
    const seen = (await a.call('GET', '/v1/invoices')).body.data.map((i: any) => i.id);
    expect(seen).toEqual([mine.body.id]);
    expect((await a.call('GET', `/v1/invoices/${theirs.id}`)).status).toBe(404);
    expect((await a.call('GET', `/v1/invoices/${unassigned.id}`)).status).toBe(404);
    const edit = await a.call('PUT', `/v1/invoices/${theirs.id}`, {
      businessId: t2.businessId,
      invoiceDate: '2026-11-05',
      items: [flat(1)],
    });
    expect(edit.status).toBe(404);
    // The owner sees all of them.
    expect((await t2.call('GET', '/v1/invoices')).body.data).toHaveLength(3);
  });
});

// ---- P2-S2 -------------------------------------------------------------------------------------------------------------

describe('P2-S2 inline payments', () => {
  it('two rows create two payments and two allocations; the invoice is paid', async () => {
    const p = await party(t);
    const res = await sale(t, {
      partyId: p,
      items: [flat(900)],
      payments: [
        { mode: 'cash', amount: 500 },
        { mode: 'upi', amount: 400, reference: '3249' },
      ],
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ status: 'paid', paidAmount: 900 });
    expect(res.body.payments.map((x: any) => [x.mode, x.amount, x.source])).toEqual([
      ['cash', 500, 'invoice_inline'],
      ['upi', 400, 'invoice_inline'],
    ]);
    const pays = (await t.call('GET', `/v1/payments?partyId=${p}`)).body.data as any[];
    expect(pays).toHaveLength(2);
    expect(
      pays.every((x) => x.allocations.length === 1 && x.allocations[0].invoiceId === res.body.id),
    ).toBe(true);
  });

  it('overpaying is 422 over_allocated; a cheque needs its date', async () => {
    const over = await sale(t, { payments: [{ mode: 'cash', amount: 1000.01 }] });
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({
      code: 'over_allocated',
      message: 'Received exceeds total by ₹0.01',
    });
    const cheque = await sale(t, {
      partyId: await party(t),
      payments: [{ mode: 'cheque', amount: 100 }],
    });
    expect(cheque.status).toBe(422);
    expect(cheque.body.error.details[0]).toMatchObject({ path: 'payments.0', code: 'CHEQUE_DATE' });
  });

  it('a cash sale without a customer goes to the walk-in Cash Sale party', async () => {
    const res = await sale(t, { payments: [{ mode: 'cash', amount: 1000 }] });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ partyName: 'Cash Sale', status: 'paid' });
    const again = await sale(t, { payments: [{ mode: 'cash', amount: 1000 }] });
    expect(again.body.partyId).toBe(res.body.partyId);
  });

  it('editing the total below what was received is rejected; rows are replaced on edit', async () => {
    const p = await party(t);
    const inv = (await sale(t, { partyId: p, payments: [{ mode: 'cash', amount: 800 }] })).body;
    const base = { businessId: t.businessId, invoiceDate: '2026-11-05', partyId: p };
    const lower = await t.call('PUT', `/v1/invoices/${inv.id}`, { ...base, items: [flat(700)] });
    expect(lower.status).toBe(422);
    const lowerWithRows = await t.call('PUT', `/v1/invoices/${inv.id}`, {
      ...base,
      items: [flat(700)],
      payments: [{ mode: 'cash', amount: 800 }],
    });
    expect(lowerWithRows.body.error.code).toBe('over_allocated');
    const edited = await t.call('PUT', `/v1/invoices/${inv.id}`, {
      ...base,
      items: [flat(1000)],
      payments: [{ mode: 'upi', amount: 1000 }],
    });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body.status).toBe('paid');
    expect(edited.body.payments.map((x: any) => x.mode)).toEqual(['upi']);
    expect((await t.call('GET', `/v1/payments?partyId=${p}`)).body.data).toHaveLength(1);
  });

  it('an earlier receipt stays read-only and counts toward the cap', async () => {
    const p = await party(t);
    const inv = (await sale(t, { partyId: p })).body;
    await t.call('POST', '/v1/payments', {
      businessId: t.businessId,
      partyId: p,
      amount: 600,
      paymentDate: '2026-11-05',
      allocations: [{ invoiceId: inv.id, amount: 600 }],
    });
    const base = {
      businessId: t.businessId,
      invoiceDate: '2026-11-05',
      partyId: p,
      items: [flat(1000)],
    };
    const over = await t.call('PUT', `/v1/invoices/${inv.id}`, {
      ...base,
      payments: [{ mode: 'cash', amount: 500 }],
    });
    expect(over.body.error.code).toBe('over_allocated');
    const ok = await t.call('PUT', `/v1/invoices/${inv.id}`, {
      ...base,
      payments: [{ mode: 'cash', amount: 400 }],
    });
    expect(ok.body.status).toBe('paid');
    expect(ok.body.payments.map((x: any) => [x.source, x.amount])).toEqual([
      ['receipt', 600],
      ['invoice_inline', 400],
    ]);
  });

  it('cancelling reverses inline payments without asking; without payments nothing changes', async () => {
    const p = await party(t);
    const inv = (await sale(t, { partyId: p, payments: [{ mode: 'cash', amount: 300 }] })).body;
    const c = await t.call('POST', `/v1/invoices/${inv.id}/cancel`, {});
    expect(c.status, c.text).toBe(200);
    expect((await t.call('GET', `/v1/payments?partyId=${p}`)).body.data).toHaveLength(0);
    const plain = (await sale(t, { partyId: p })).body;
    expect(plain).toMatchObject({
      status: 'unpaid',
      paidAmount: 0,
      payments: [],
      salesmanId: null,
    });
    expect(plain.data).not.toHaveProperty('charges');
  });
});

// ---- P2-S3 -------------------------------------------------------------------------------------------------------------

describe('P2-S3 additional charges', () => {
  it('charges are taxed at their own rate and stored on the invoice', async () => {
    const res = await sale(t, {
      partyId: await party(t),
      items: [line({ quantity: 1, rate: 1000, taxPercent: 18 })],
      charges: [{ name: 'Shipping', amount: 100, gstRate: 5, hsn: '9965' }],
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      subtotal: 1000,
      taxableAmount: 1100,
      cgst: 92.5,
      sgst: 92.5,
      total: 1285,
    });
    expect(res.body.data.charges[0]).toMatchObject({ name: 'Shipping', amount: 100, gstRate: 5 });
    expect(res.body.data.totals).toMatchObject({ chargesTotal: 100, chargesTax: 5 });
  });
});

// ---- P2-S4 -------------------------------------------------------------------------------------------------------------

describe('P2-S4 guards', () => {
  it('a credit mode needs a limit', async () => {
    const res = await t.call('POST', '/v1/parties', { name: 'No limit', creditMode: 'warn' });
    expect(res.status).toBe(422);
  });

  it('warn: refused until confirmed, with the dialog figures', async () => {
    const p = await party(t, { creditLimit: 50000, creditMode: 'warn' });
    await sale(t, { partyId: p, items: [flat(42000)] });
    const res = await sale(t, { partyId: p, items: [flat(18000)] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'credit_limit',
      details: { limit: 50000, used: 42000, after: 60000, exceededBy: 10000, mode: 'warn' },
    });
    // Money received with the sale does not count against the limit.
    expect(
      (
        await sale(t, {
          partyId: p,
          items: [flat(18000)],
          payments: [{ mode: 'upi', amount: 10000 }],
        })
      ).status,
    ).toBe(201);
    expect(
      (await sale(t, { partyId: p, items: [flat(18000)], confirm: { creditLimit: true } })).status,
    ).toBe(201);
  });

  it('block: confirming is not enough; only the owner with a reason passes, and it is audited', async () => {
    const p = await party(t, { creditLimit: 1000, creditMode: 'block' });
    const body = { partyId: p, items: [flat(1500)] };
    expect((await sale(t, { ...body, confirm: { creditLimit: true } })).body.error.code).toBe(
      'credit_limit',
    );
    const admin = await h.addMember(t, 'admin');
    const asAdmin = { ...t, call: admin.call };
    expect(
      (await sale(asAdmin, { ...body, confirm: { overrideReason: 'trusted customer' } })).status,
    ).toBe(409);
    const ok = await sale(t, { ...body, confirm: { overrideReason: 'trusted customer' } });
    expect(ok.status, ok.text).toBe(201);
    const rows = await audits(t, 'guard.override');
    expect(
      rows.some((r) => r.after.guard === 'credit_limit' && r.after.reason === 'trusted customer'),
    ).toBe(true);
  });

  it('§269ST: ₹2 lakh cash from one party in a day needs a typed acknowledgement', async () => {
    const p = await party(t);
    const body = {
      partyId: p,
      items: [flat(250000)],
      payments: [{ mode: 'cash', amount: 200000 }],
    };
    const res = await sale(t, body);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'cash_limit',
      details: { total: 200000, breached: true },
    });
    expect(
      (await sale(t, { ...body, confirm: { cashAcknowledgement: 'I understand' } })).status,
    ).toBe(201);
    expect((await audits(t, 'guard.cash_limit')).length).toBeGreaterThan(0);
  });

  it('period lock and filed months: refused, owner override with reason only', async () => {
    const t3 = await h.newTenant();
    expect(
      (await setPrefs(t3, { lockDate: '2026-09-30' }, { filedMonths: ['2026-10'] })).status,
    ).toBe(200);
    const sep = await sale(t3, { invoiceDate: '2026-09-15' });
    expect(sep.status).toBe(409);
    expect(sep.body.error).toMatchObject({
      code: 'period_locked',
      details: { reason: 'lock_date' },
    });
    expect((await sale(t3, { invoiceDate: '2026-10-15' })).body.error.details.reason).toBe(
      'filed_month',
    );
    expect((await sale(t3, { invoiceDate: '2026-11-15' })).status).toBe(201);
    const biller = await h.addMember(t3, 'biller');
    expect(
      (
        await sale(
          { ...t3, call: biller.call },
          { invoiceDate: '2026-09-15', confirm: { overrideReason: 'x' } },
        )
      ).status,
    ).toBe(409);
    expect(
      (await sale(t3, { invoiceDate: '2026-09-15', confirm: { overrideReason: 'late bill' } }))
        .status,
    ).toBe(201);
  });

  it('negative stock: block refuses, warn needs confirming, unset allows (as before)', async () => {
    const t4 = await h.newTenant();
    const item = (
      await t4.call('POST', '/v1/items', { name: 'Pen', openingStock: 5, salePrice: 10 })
    ).body;
    const body = { items: [line({ itemId: item.id, name: 'Pen', quantity: 6, rate: 10 })] };
    expect((await sale(t4, body)).status).toBe(201); // unset = allow
    await setPrefs(t4, { negativeStock: 'block' });
    const blocked = await sale(t4, { ...body, confirm: { negativeStock: true } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('negative_stock');
    await setPrefs(t4, { negativeStock: 'warn' });
    expect((await sale(t4, body)).status).toBe(409);
    expect((await sale(t4, { ...body, confirm: { negativeStock: true } })).status).toBe(201);
  });
});

// ---- P2-S5 -------------------------------------------------------------------------------------------------------------

describe('P2-S5 Payment In upgrade', () => {
  it('discount and TDS settle the invoice; the receipt is numbered', async () => {
    const p = await party(t);
    const inv = (await sale(t, { partyId: p, items: [flat(8260)] })).body;
    const res = await t.call('POST', '/v1/payments', {
      businessId: t.businessId,
      partyId: p,
      amount: 8000,
      discountAmount: 95,
      tdsAmount: 165,
      mode: 'bank',
      reference: 'UTR1',
      paymentDate: '2026-11-06',
      autoAllocate: true,
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      number: expect.stringMatching(/^RCT-\d+$/),
      unallocated: 0,
      tdsAmount: 165,
    });
    expect((await t.call('GET', `/v1/invoices/${inv.id}`)).body.status).toBe('paid');
  });

  it('allocations above money + discount + TDS are over_allocated; leftover is advance', async () => {
    const p = await party(t);
    const inv = (await sale(t, { partyId: p, items: [flat(5000)] })).body;
    const base = { businessId: t.businessId, partyId: p, paymentDate: '2026-11-06' };
    const over = await t.call('POST', '/v1/payments', {
      ...base,
      amount: 1000,
      discountAmount: 100,
      allocations: [{ invoiceId: inv.id, amount: 1200 }],
    });
    expect(over.body.error.code).toBe('over_allocated');
    const adv = await t.call('POST', '/v1/payments', {
      ...base,
      amount: 6000,
      autoAllocate: true,
    });
    expect(adv.body.unallocated).toBe(1000);
  });

  it('oldest first across invoices; editing a receipt re-settles old and new invoices together', async () => {
    const p = await party(t);
    const a = (await sale(t, { partyId: p, invoiceDate: '2026-10-02', items: [flat(500)] })).body;
    const b = (await sale(t, { partyId: p, invoiceDate: '2026-10-20', items: [flat(500)] })).body;
    const base = { businessId: t.businessId, partyId: p, paymentDate: '2026-11-06' };
    const r = (await t.call('POST', '/v1/payments', { ...base, amount: 700, autoAllocate: true }))
      .body;
    expect(r.allocations).toEqual([
      { invoiceId: a.id, amount: 500 },
      { invoiceId: b.id, amount: 200 },
    ]);
    const edit = await t.call('PUT', `/v1/payments/${r.id}`, {
      ...base,
      amount: 500,
      allocations: [{ invoiceId: b.id, amount: 500 }],
    });
    expect(edit.status, edit.text).toBe(200);
    expect(edit.body.number).toBe(r.number);
    expect((await t.call('GET', `/v1/invoices/${a.id}`)).body.status).toBe('unpaid');
    expect((await t.call('GET', `/v1/invoices/${b.id}`)).body.status).toBe('paid');
  });

  it('cash receipts at ₹2 lakh need acknowledging; cheques need a date', async () => {
    const p = await party(t);
    const base = { businessId: t.businessId, partyId: p, paymentDate: '2026-11-06' };
    expect(
      (await t.call('POST', '/v1/payments', { ...base, amount: 200000 })).body.error.code,
    ).toBe('cash_limit');
    expect(
      (await t.call('POST', '/v1/payments', { ...base, amount: 200000, cashAcknowledgement: 'ok' }))
        .status,
    ).toBe(201);
    expect(
      (await t.call('POST', '/v1/payments', { ...base, amount: 5, mode: 'cheque' })).status,
    ).toBe(422);
  });

  it('an inline payment can only be edited from its invoice', async () => {
    const p = await party(t);
    const inv = (await sale(t, { partyId: p, payments: [{ mode: 'cash', amount: 10 }] })).body;
    const res = await t.call('PUT', `/v1/payments/${inv.payments[0].paymentId}`, {
      businessId: t.businessId,
      partyId: p,
      amount: 20,
      paymentDate: '2026-11-06',
    });
    expect(res.status).toBe(422);
  });
});

// ---- P2-S6 -------------------------------------------------------------------------------------------------------------

describe('P2-S6 credit notes and sale orders', () => {
  it('cannot over-return; restock off moves no stock; a cash refund is money out', async () => {
    const t5 = await h.newTenant();
    const p = await party(t5);
    const item = (
      await t5.call('POST', '/v1/items', { name: 'Pen', openingStock: 100, salePrice: 10 })
    ).body;
    const pen = (q: number) =>
      line({ itemId: item.id, name: 'Pen', quantity: q, rate: 10, taxPercent: 0 });
    const inv = (await sale(t5, { partyId: p, items: [pen(10)] })).body;
    const cn = (q: number, extra = {}) =>
      t5.call('POST', '/v1/invoices', {
        businessId: t5.businessId,
        invoiceType: 'credit-note',
        invoiceDate: '2026-11-08',
        againstInvoiceId: inv.id,
        returnReason: 'sales-return',
        items: [pen(q)],
        ...extra,
      });
    expect((await cn(11)).body.error.code).toBe('over_return');
    const first = await cn(4, { refund: { mode: 'cash' } });
    expect(first.status, first.text).toBe(201);
    expect(first.body.partyId).toBe(p); // taken from the invoice
    expect(first.body.data).toMatchObject({ returnReason: 'sales-return', restock: true });
    const left = (await t5.call('GET', `/v1/invoices/${inv.id}/returnable`)).body;
    expect(left.lines).toEqual([{ key: `id:${item.id}`, name: 'Pen', sold: 10, returnable: 6 }]);
    expect((await cn(7)).body.error.code).toBe('over_return');
    const stockBefore = (await t5.call('GET', `/v1/items/${item.id}`)).body.stock;
    expect((await cn(6, { restock: false })).status).toBe(201);
    expect((await t5.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(stockBefore);
    const pays = (await t5.call('GET', `/v1/payments?partyId=${p}`)).body.data as any[];
    expect(pays.map((x) => [x.direction, x.source, x.amount])).toEqual([
      ['out', 'credit_note_refund', 40],
    ]);
  });

  it('sale order: advance, partial conversion, statuses, and no over-conversion', async () => {
    const p = await party(t);
    const order = await t.call('POST', '/v1/invoices', {
      businessId: t.businessId,
      invoiceType: 'sales-order',
      invoiceDate: '2026-11-01',
      partyId: p,
      expectedDeliveryDate: '2026-11-20',
      items: [line({ name: 'Pen Blue', quantity: 100, rate: 10, taxPercent: 0 })],
      payments: [{ mode: 'upi', amount: 300 }],
    });
    expect(order.status, order.text).toBe(201);
    expect(order.body.status).toBe('unpaid'); // an advance does not pay an order
    const id = order.body.id;
    expect((await t.call('GET', `/v1/invoices/${id}/progress`)).body.status).toBe('open');
    const part = await t.call('POST', `/v1/invoices/${id}/convert`, {
      invoiceDate: '2026-11-10',
      lines: [{ position: 0, quantity: 40 }],
    });
    expect(part.status, part.text).toBe(201);
    expect(part.body).toMatchObject({ total: 400, paidAmount: 300, status: 'partial' });
    const prog = (await t.call('GET', `/v1/invoices/${id}/progress`)).body;
    expect(prog).toMatchObject({
      status: 'partially-invoiced',
      lines: [{ ordered: 100, invoiced: 40, pending: 60 }],
    });
    expect(
      (
        await t.call('POST', `/v1/invoices/${id}/convert`, {
          invoiceDate: '2026-11-11',
          lines: [{ position: 0, quantity: 61 }],
        })
      ).status,
    ).toBe(422);
    const rest = await t.call('POST', `/v1/invoices/${id}/convert`, { invoiceDate: '2026-11-12' });
    expect(rest.body.total).toBe(600);
    expect((await t.call('GET', `/v1/invoices/${id}/progress`)).body.status).toBe('closed');
    expect((await t.call('GET', `/v1/invoices/${id}`)).body.data.orderStatus).toBe('closed');
  });
});

describe('isolation', () => {
  it("another organization can not see or use this one's salesmen", async () => {
    const mine = (await t.call('POST', '/v1/staff', { name: 'Private' })).body.id;
    const other = await h.newTenant();
    expect((await other.call('GET', '/v1/staff')).body.data).toEqual([]);
    expect((await other.call('GET', `/v1/staff/${mine}`)).status).toBe(404);
    expect((await sale(other, { salesmanId: mine })).status).toBe(422);
  });
});
