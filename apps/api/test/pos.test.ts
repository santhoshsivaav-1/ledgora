import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity P12 (Point of Sale), API layer: the counter bill is an invoice, so stock, payments, ledger and reports
// see it like any other sale. Every ledger-on case ends with the trial-balance check from Verify My Data.
const h = makeHarness();
let t: Tenant;
const NO_LEDGER = 'no-ledger';
afterAll(() => h.close());
beforeAll(async () => {
  t = await h.newTenant();
});

const settings = (who: Tenant, s: Record<string, unknown>) =>
  who.call('PUT', '/v1/pos/settings', { businessId: who.businessId, settings: s });
const item = async (who: Tenant, over: Record<string, unknown> = {}) => {
  const r = await who.call('POST', '/v1/items', {
    name: `Item ${Math.random().toString(36).slice(2, 7)}`,
    salePrice: 100,
    taxPercent: 18,
    openingStock: 50,
    ...over,
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
const customer = async (who: Tenant, over: Record<string, unknown> = {}) => {
  const r = await who.call('POST', '/v1/parties', {
    name: `Cust ${Math.random().toString(36).slice(2, 7)}`,
    phone: '98765' + Math.floor(10000 + Math.random() * 89999),
    state: 'Tamil Nadu',
    ...over,
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
const sell = (who: Tenant, body: Record<string, unknown>) =>
  who.call('POST', '/v1/pos/sales', { businessId: who.businessId, ...body });
const books = async (who: Tenant) => {
  const v = await who.call('GET', `/v1/verify?businessId=${who.businessId}`);
  const check = (id: string) => v.body.checks.find((c: any) => c.id === id);
  expect(check('ledger_unbalanced').count).toBe(0);
  const tb = (await who.call('GET', `/v1/ledger/trial-balance?businessId=${who.businessId}`)).body;
  expect(tb.balanced).toBe(true);
};
const stock = async (who: Tenant, id: string) =>
  (await who.call('GET', `/v1/items/${id}`)).body.stock;

describe('settings', () => {
  it('defaults, partial update, validation', async () => {
    const g = await t.call('GET', `/v1/pos/settings?businessId=${t.businessId}`);
    expect(g.status, g.text).toBe(200);
    expect(g.body.paymentModes).toContain('cash');
    const r = await settings(t, { roundOff: 'up', loyalty: { enabled: true, earnPer100: 2 } });
    expect(r.status, r.text).toBe(200);
    expect(r.body.roundOff).toBe('up');
    expect(r.body.loyalty).toMatchObject({ enabled: true, earnPer100: 2, pointValue: 1 });
    expect((await settings(t, { paper: '99mm' })).status).toBe(400);
    const back = await t.call('GET', `/v1/pos/settings?businessId=${t.businessId}`);
    expect(back.body.roundOff).toBe('up');
    await settings(t, { roundOff: 'nearest', loyalty: { enabled: false } });
  });
  it('cash can not be switched off', async () => {
    const r = await settings(t, { paymentModes: ['upi'] });
    expect(r.body.paymentModes).toEqual(['cash', 'upi']);
  });
});

describe('lookup', () => {
  it('finds by barcode and item code exactly, by name partly', async () => {
    const a = await item(t, { name: 'Lux Soap', sku: 'LUX1', extra: { barcode: '8901234567890' } });
    await item(t, { name: 'Lux Shampoo', sku: 'LUX2' });
    const byBar = (await t.call('GET', `/v1/pos/items?businessId=${t.businessId}&q=8901234567890`))
      .body.data;
    expect(byBar[0]).toMatchObject({ id: a.id, exact: true, barcode: '8901234567890', stock: 50 });
    const byCode = (await t.call('GET', `/v1/pos/items?businessId=${t.businessId}&q=lux1`)).body
      .data;
    expect(byCode[0]).toMatchObject({ id: a.id, exact: true });
    const byName = (await t.call('GET', `/v1/pos/items?businessId=${t.businessId}&q=lux`)).body
      .data;
    expect(byName.length).toBe(3 - 1); // Lux Soap, Lux Shampoo (+ the code-only match is the same item)
    expect(byName.every((x: any) => !x.exact)).toBe(true);
  });
  it('a barcode is unique among live items', async () => {
    await item(t, { extra: { barcode: 'DUP-1' } });
    const r = await t.call('POST', '/v1/items', { name: 'Other', extra: { barcode: 'dup-1' } });
    expect(r.status).toBe(409);
  });
  it('finds customers by phone with points and dues', async () => {
    const c = await customer(t, { phone: '9000011111' });
    const r = (await t.call('GET', `/v1/pos/customers?businessId=${t.businessId}&q=9000011`)).body
      .data;
    expect(r.map((x: any) => x.id)).toContain(c.id);
    expect(r.find((x: any) => x.id === c.id)).toMatchObject({ points: 0, due: 0 });
  });
});

describe('sales (ledger off)', () => {
  it('a cash bill: stock out, invoice paid, change returned, GST right', async () => {
    const it1 = await item(t);
    const r = await sell(t, {
      lines: [
        { itemId: it1.id, name: it1.name, unit: 'PCS', quantity: 2, rate: 118, taxPercent: 18 },
      ],
      tenders: [{ mode: 'cash', amount: 500 }],
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body).toMatchObject({
      total: 236,
      paid: 236,
      change: 264,
      credit: 0,
      replayed: false,
    });
    expect(await stock(t, it1.id)).toBe(48);
    const inv = (await t.call('GET', `/v1/invoices/${r.body.invoiceId}`)).body;
    expect(inv.status).toBe('paid');
    expect(inv.taxableAmount).toBe(200);
    expect(inv.totalTax).toBe(36);
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]).toMatchObject({ mode: 'cash', amount: 236 });
  });
  it('split UPI + cash; UPI over the bill is refused', async () => {
    const it1 = await item(t);
    const lines = [{ itemId: it1.id, name: it1.name, quantity: 1, rate: 118, taxPercent: 18 }];
    const over = await sell(t, { lines, tenders: [{ mode: 'upi', amount: 200 }] });
    expect(over.status).toBe(422);
    expect(await stock(t, it1.id)).toBe(50);
    await settings(t, { paymentModes: ['cash', 'upi'] });
    const ok = await sell(t, {
      lines,
      tenders: [
        { mode: 'upi', amount: 100 },
        { mode: 'cash', amount: 50 },
      ],
    });
    expect(ok.body).toMatchObject({ total: 118, paid: 118, change: 32 });
  });
  it('a mode that is off in settings is refused', async () => {
    await settings(t, { paymentModes: ['cash'] });
    const it1 = await item(t);
    const r = await sell(t, {
      lines: [{ itemId: it1.id, name: 'x', quantity: 1, rate: 118, taxPercent: 18 }],
      tenders: [{ mode: 'card', amount: 118 }],
    });
    expect(r.status).toBe(422);
  });
  it('credit needs a customer; with one it is a due on the customer', async () => {
    const it1 = await item(t);
    const lines = [{ itemId: it1.id, name: 'x', quantity: 1, rate: 118, taxPercent: 18 }];
    expect((await sell(t, { lines, tenders: [{ mode: 'cash', amount: 18 }] })).status).toBe(422);
    const c = await customer(t, { phone: '9111122222' });
    const ok = await sell(t, { lines, partyId: c.id, tenders: [{ mode: 'cash', amount: 18 }] });
    expect(ok.body).toMatchObject({ paid: 18, credit: 100 });
    const found = (await t.call('GET', `/v1/pos/customers?businessId=${t.businessId}&q=9111122`))
      .body.data[0];
    expect(found.due).toBe(100);
  });
  it('an interstate customer gets IGST', async () => {
    const c = await customer(t, { state: 'Kerala', phone: '9222233333' });
    const r = await sell(t, {
      partyId: c.id,
      lines: [{ name: 'Svc', quantity: 1, rate: 118, taxPercent: 18 }],
      tenders: [{ mode: 'cash', amount: 118 }],
    });
    const inv = (await t.call('GET', `/v1/invoices/${r.body.invoiceId}`)).body;
    expect(inv.igst).toBe(18);
    expect(inv.cgst).toBe(0);
  });
  it('bill discount, charges and round off agree with the screen', async () => {
    await settings(t, { pricing: 'without-tax', roundOff: 'nearest', billDiscount: true });
    const it1 = await item(t, { salePrice: 333 });
    const r = await sell(t, {
      lines: [{ itemId: it1.id, name: 'x', quantity: 3, rate: 333, taxPercent: 12 }],
      billDiscount: { type: 'percent', value: 10 },
      charges: [{ name: 'Packing', amount: 25, gstRate: 18 }],
      tenders: [{ mode: 'cash', amount: 2000 }],
    });
    expect(r.status, r.text).toBe(201);
    expect(Number.isInteger(r.body.total)).toBe(true);
    const inv = (await t.call('GET', `/v1/invoices/${r.body.invoiceId}`)).body;
    // 999 less 10% = 899.10 taxable +25 charge; tax 107.89 + 4.5
    expect(inv.taxableAmount).toBe(924.1);
    await settings(t, { pricing: 'with-tax' });
  });
  it('a bill discount is refused when the setting is off', async () => {
    await settings(t, { billDiscount: false });
    const r = await sell(t, {
      lines: [{ name: 'x', quantity: 1, rate: 100, taxPercent: 0 }],
      billDiscount: { type: 'amount', value: 5 },
      tenders: [{ mode: 'cash', amount: 100 }],
    });
    expect(r.status).toBe(422);
    await settings(t, { billDiscount: true });
  });
  it('a retried save with the same key returns the first bill', async () => {
    const it1 = await item(t);
    const body = {
      clientKey: 'counter-0001-abcd',
      lines: [{ itemId: it1.id, name: 'x', quantity: 1, rate: 118, taxPercent: 18 }],
      tenders: [{ mode: 'cash', amount: 120 }],
    };
    const a = await sell(t, body);
    const b = await sell(t, body);
    expect(b.body).toMatchObject({ invoiceId: a.body.invoiceId, replayed: true, change: 2 });
    expect(await stock(t, it1.id)).toBe(49);
  });
  it('free quantity leaves stock but is not charged', async () => {
    await settings(t, { freeQty: true });
    const it1 = await item(t);
    const r = await sell(t, {
      lines: [{ itemId: it1.id, name: 'x', quantity: 2, freeQty: 1, rate: 118, taxPercent: 18 }],
      tenders: [{ mode: 'cash', amount: 236 }],
    });
    expect(r.body.total).toBe(236);
    expect(await stock(t, it1.id)).toBe(47);
  });
  it('selling more than is in stock asks to confirm, like any sale', async () => {
    const who = await h.newTenant();
    await who.call('PUT', `/v1/businesses/${who.businessId}/settings`, {
      numberSettings: {},
      printSettings: {},
      preferences: { transaction: { negativeStock: 'warn' } },
    });
    const it1 = await item(who, { openingStock: 1 });
    const body = {
      lines: [{ itemId: it1.id, name: 'x', quantity: 5, rate: 118, taxPercent: 18 }],
      tenders: [{ mode: 'cash', amount: 590 }],
    };
    const r = await sell(who, body);
    expect(r.status).toBe(409);
    expect((await sell(who, { ...body, confirm: { negativeStock: true } })).status).toBe(201);
    await settings(who, { allowNegativeStock: true });
    expect((await sell(who, body)).status).toBe(201);
  });
  it('a viewer can not sell', async () => {
    const v = await h.addMember(t, 'viewer');
    const r = await v.call('POST', '/v1/pos/sales', {
      businessId: t.businessId,
      lines: [{ name: 'x', quantity: 1, rate: 1, taxPercent: 0 }],
      tenders: [],
    });
    expect(r.status).toBe(403);
  });
});

describe('loyalty', () => {
  it('earns on a bill, redeems on the next, and a cancelled bill gives points back', async () => {
    await settings(t, {
      pricing: 'with-tax',
      loyalty: { enabled: true, earnPer100: 1, pointValue: 1, minBill: 0, maxRedeemPercent: 50 },
    });
    const c = await customer(t, { phone: '9333344444' });
    const it1 = await item(t);
    const lines = [{ itemId: it1.id, name: 'x', quantity: 10, rate: 118, taxPercent: 18 }];
    const a = await sell(t, { lines, partyId: c.id, tenders: [{ mode: 'cash', amount: 1180 }] });
    expect(a.body).toMatchObject({ pointsEarned: 11, pointsBalance: 11 });
    const over = await sell(t, { lines, partyId: c.id, redeemPoints: 12, tenders: [] });
    expect(over.status).toBe(422);
    const b = await sell(t, {
      lines: [{ itemId: it1.id, name: 'x', quantity: 1, rate: 118, taxPercent: 18 }],
      partyId: c.id,
      redeemPoints: 10,
      tenders: [{ mode: 'cash', amount: 108 }],
    });
    expect(b.status, b.text).toBe(201);
    expect(b.body.total).toBe(108);
    expect(b.body.credit).toBe(0);
    // 108 earns 1 point; 10 spent
    expect(b.body.pointsBalance).toBe(2);
    const cancel = await t.call('POST', `/v1/invoices/${b.body.invoiceId}/cancel`, {});
    expect(cancel.status, cancel.text).toBe(200);
    const bal = (await t.call('GET', `/v1/pos/customers?businessId=${t.businessId}&q=9333344`)).body
      .data[0];
    expect(bal.points).toBe(11);
    await settings(t, { loyalty: { enabled: false } });
  });
  it('redeeming with no customer is refused', async () => {
    await settings(t, { loyalty: { enabled: true } });
    const r = await sell(t, {
      lines: [{ name: 'x', quantity: 1, rate: 100, taxPercent: 0 }],
      redeemPoints: 5,
      tenders: [{ mode: 'cash', amount: 100 }],
    });
    expect(r.status).toBe(422);
    await settings(t, { loyalty: { enabled: false } });
  });
});

describe('with the ledger on', () => {
  it(`${NO_LEDGER}: POS bills post to the books and the trial balance holds`, async () => {
    const who = await h.newTenant();
    const on = await who.call('POST', '/v1/accounting/backfill', {
      businessId: who.businessId,
      dryRun: false,
    });
    expect(on.body.enabled, on.text).toBe(true);
    expect(
      (
        await settings(who, {
          paymentModes: ['cash', 'upi', 'card'],
          freeQty: true,
          loyalty: { enabled: true },
        })
      ).status,
    ).toBe(200);
    const c = await customer(who);
    const it1 = await item(who, { purchasePrice: 60 });
    for (let i = 0; i < 6; i++) {
      const r = await sell(who, {
        partyId: i % 2 ? c.id : undefined,
        lines: [
          {
            itemId: it1.id,
            name: 'x',
            quantity: 1 + i,
            freeQty: i % 3 === 0 ? 1 : 0,
            rate: 118,
            taxPercent: 18,
            discount: i * 3,
          },
        ],
        billDiscount: i % 2 ? { type: 'amount', value: 7 } : undefined,
        tenders: i % 2 ? [{ mode: 'upi', amount: 100 }] : [{ mode: 'cash', amount: 2000 }],
      });
      expect(r.status, r.text).toBe(201);
    }
    await books(who);
    const gst = await who.call('GET', `/v1/reports/trial-balance?businessId=${who.businessId}`);
    expect(gst.status, gst.text).toBe(200);
  });
});
