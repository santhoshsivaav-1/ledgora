import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETTING_KEYS, SETTINGS } from '@ledgora/contracts';
import { line } from './helpers.ts';
import { makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity P8-S1: the settings registry over HTTP.
const h = makeHarness();
let t: Tenant;
afterAll(() => h.close());
beforeAll(async () => {
  t = await h.newTenant();
});

type Caller = Pick<Tenant, 'call'> & { businessId?: string };
const get = (who: Caller, businessId = who.businessId ?? t.businessId) =>
  who.call('GET', `/v1/settings?businessId=${businessId}`);
const patch = (
  who: Caller,
  values: Record<string, unknown>,
  businessId = who.businessId ?? t.businessId,
) => who.call('PATCH', '/v1/settings', { businessId, values });

describe('GET /v1/settings', () => {
  it('returns every registry key with its default', async () => {
    const r = await get(t);
    expect(r.status, r.text).toBe(200);
    expect(Object.keys(r.body.settings).sort()).toEqual([...SETTING_KEYS].sort());
    expect(r.body.settings['txn.negativeStock']).toBe('allow');
    expect(r.body.settings['txn.roundOff']).toBe('nearest');
    expect(r.body.settings['txn.lockBefore']).toBeNull();
  });
});

describe('GET /v1/settings/gstin-usage', () => {
  it('counts the invoices that carry the GSTIN', async () => {
    const w = await h.newTenant();
    const before = await w.call('GET', `/v1/settings/gstin-usage?businessId=${w.businessId}`);
    expect(before.status, before.text).toBe(200);
    expect(before.body.invoices).toBe(0);
    await w.call('POST', '/v1/invoices', {
      businessId: w.businessId,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    const after = await w.call('GET', `/v1/settings/gstin-usage?businessId=${w.businessId}`);
    expect(after.body.invoices).toBe(1);
  });
});

describe('PATCH /v1/settings', () => {
  it('changes a live key and merges it with the rest', async () => {
    const r = await patch(t, { 'txn.negativeStock': 'block' });
    expect(r.status, r.text).toBe(200);
    expect(r.body.settings['txn.negativeStock']).toBe('block');
    expect((await get(t)).body.settings['txn.negativeStock']).toBe('block');
  });

  it('writes where the older reader looks, so rollback loses nothing', async () => {
    await patch(t, { 'txn.negativeStock': 'warn' });
    const old = await t.call('GET', `/v1/businesses/${t.businessId}/settings`);
    expect(old.body.preferences.transaction.negativeStock).toBe('warn');
    // …and a change through the older writer shows up in the new reader.
    await t.call('PUT', '/v1/accounting/lock', {
      businessId: t.businessId,
      lockBefore: '2026-03-31',
      allowEditAfterGstFiled: false,
    });
    expect((await get(t)).body.settings['txn.lockBefore']).toBe('2026-03-31');
  });

  it('is actually obeyed: blocking negative stock stops an oversell', async () => {
    const item = (
      await t.call('POST', '/v1/items', { name: 'Nut', salePrice: 10, openingStock: 1 })
    ).body;
    await patch(t, { 'txn.negativeStock': 'block' });
    const sale = await t.call('POST', '/v1/invoices', {
      businessId: t.businessId,
      invoiceDate: '2026-10-01',
      items: [{ itemId: item.id, name: 'Nut', quantity: 5, rate: 10, taxPercent: 0 }],
    });
    expect(sale.status).toBe(409);
    expect(sale.body.error.code).toBe('negative_stock');
  });

  it('answers unknown keys and bad values with a field error per key, and saves nothing', async () => {
    const r = await patch(t, { 'nope.x': 1, 'txn.negativeStock': 'maybe' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_failed');
    expect(r.body.error.details.map((d: any) => d.path).sort()).toEqual([
      'nope.x',
      'txn.negativeStock',
    ]);
    expect((await get(t)).body.settings['txn.negativeStock']).toBe('block');
  });

  it('keeps a setting without an older home in setting_values, per business', async () => {
    const other = await h.newTenant();
    const p15 = await patch(t, { 'txn.terms.days': 15 });
    expect(p15.status, p15.text).toBe(200);
    expect(p15.body.settings['txn.terms.days']).toBe(15);
    expect((await get(t)).body.settings['txn.terms.days']).toBe(15);
    expect((await get(other)).body.settings['txn.terms.days']).toBe(0);
    await patch(t, { 'txn.terms.days': 0 });
    expect((await get(t)).body.settings['txn.terms.days']).toBe(0);
  });

  it('refuses a key whose behaviour is not built yet, for every key that is not live', async () => {
    for (const k of SETTING_KEYS.filter((k) => !SETTINGS[k].live)) {
      const r = await patch(t, { [k]: SETTINGS[k].default });
      expect(r.status, k).toBe(400);
      expect(r.body.error.details[0].message, k).toMatch(/coming soon/i);
    }
  });

  it('lets an admin change an ordinary key but not an owner-only one', async () => {
    const admin = await h.addMember(t, 'admin');
    const ok = await patch(admin, { 'txn.negativeStock': 'allow' });
    expect(ok.status, ok.text).toBe(200);
    const no = await patch(admin, { 'txn.lockBefore': '2026-04-01', 'txn.negativeStock': 'warn' });
    expect(no.status).toBe(403);
    expect(no.body.error.details.keys).toEqual(['txn.lockBefore']);
    const after = (await get(t)).body.settings;
    expect(after['txn.lockBefore']).toBe('2026-03-31');
    expect(after['txn.negativeStock']).toBe('allow');
  });

  it('lets the owner change an owner-only key and clear it again', async () => {
    expect(
      (await patch(t, { 'txn.lockBefore': '2026-06-30' })).body.settings['txn.lockBefore'],
    ).toBe('2026-06-30');
    expect((await patch(t, { 'txn.lockBefore': null })).body.settings['txn.lockBefore']).toBeNull();
  });

  it('lets a viewer read but not change', async () => {
    const v = await h.addMember(t, 'viewer');
    expect((await get(v)).status).toBe(200);
    expect((await patch(v, { 'txn.negativeStock': 'allow' })).status).toBe(403);
  });

  it('records a change in the audit log', async () => {
    await patch(t, { 'txn.negativeStock': 'warn' });
    const log = await t.call('GET', '/v1/audit?limit=20');
    expect(JSON.stringify(log.body)).toContain('settings.change');
  });

  it("does not reach into another organization's business", async () => {
    const other = await h.newTenant();
    const r = await t.call('PATCH', '/v1/settings', {
      businessId: other.businessId,
      values: { 'txn.negativeStock': 'block' },
    });
    expect(r.status).toBe(404);
    expect((await get(other)).body.settings['txn.negativeStock']).toBe('allow');
  });
});

describe('behaviour of the settings that are live', () => {
  const sale = (who: Tenant, over: Record<string, unknown> = {}) =>
    who.call('POST', '/v1/invoices', {
      businessId: who.businessId,
      invoiceDate: '2026-10-01',
      items: [line()],
      ...over,
    });

  it('default payment terms give a sale a due date, and an explicit one wins', async () => {
    const w = await h.newTenant();
    expect((await sale(w)).body.dueDate).toBeNull();
    await patch(w, { 'txn.terms.days': 30 });
    expect((await sale(w)).body.dueDate).toBe('2026-10-31');
    expect((await sale(w, { dueDate: '2026-10-05' })).body.dueDate).toBe('2026-10-05');
    const quote = await sale(w, { invoiceType: 'quotation' });
    expect(quote.status, quote.text).toBe(201);
    expect(quote.body.dueDate).toBeNull();
  });

  it('editing after payment can be turned off', async () => {
    const w = await h.newTenant();
    const inv = (await sale(w, { payments: [{ mode: 'cash', amount: 50 }] })).body;
    expect(inv.paidAmount).toBe(50);
    const edit = () =>
      w.call('PUT', `/v1/invoices/${inv.id}`, {
        businessId: w.businessId,
        invoiceDate: '2026-10-01',
        items: [line()],
        notes: 'x',
      });
    expect((await edit()).status).toBe(200);
    await patch(w, { 'txn.editAfterPay': false });
    const blocked = await edit();
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.message).toMatch(/payments recorded/);
    await patch(w, { 'txn.editAfterPay': true });
    expect((await edit()).status).toBe(200);
  });

  it('a delivery challan moves stock unless that is turned off', async () => {
    const w = await h.newTenant();
    const item = (
      await w.call('POST', '/v1/items', { name: 'Bolt', salePrice: 10, openingStock: 20 })
    ).body;
    const challan = (n: number) =>
      sale(w, {
        invoiceType: 'delivery-challan',
        items: [line({ itemId: item.id, name: 'Bolt', quantity: n, taxPercent: 0 })],
      });
    expect((await challan(3)).status).toBe(201);
    expect((await w.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(17);
    await patch(w, { 'txn.challanStock': false });
    expect((await challan(5)).status).toBe(201);
    expect((await w.call('GET', `/v1/items/${item.id}`)).body.stock).toBe(17);
  });

  it('credit-limit checks can be turned off for a business (limits on parties are kept)', async () => {
    const w = await h.newTenant();
    const p = (
      await w.call('POST', '/v1/parties', {
        name: 'Slow payer',
        creditLimit: 100,
        creditMode: 'block',
      })
    ).body;
    const big = () => sale(w, { partyId: p.id, items: [line({ rate: 1000, taxPercent: 0 })] });
    const blocked = await big();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('credit_limit');
    await patch(w, { 'party.credit': false });
    expect((await big()).status).toBe(201);
    await patch(w, { 'party.credit': true });
    expect((await big()).status).toBe(409);
  });

  it('the old lock-date route is owner-only too', async () => {
    const admin = await h.addMember(t, 'admin');
    const r = await admin.call('PUT', '/v1/accounting/lock', {
      businessId: t.businessId,
      lockBefore: '2026-01-01',
      allowEditAfterGstFiled: false,
    });
    expect(r.status).toBe(403);
  });
});

describe('settings that reports obey', () => {
  it('the e-way bill register uses the threshold set in Settings', async () => {
    const w = await h.newTenant();
    const goods = await w.call('POST', '/v1/invoices', {
      businessId: w.businessId,
      invoiceDate: '2026-10-01',
      items: [line({ quantity: 1, rate: 30000, taxPercent: 0, hsn: '8501' })],
    });
    expect(goods.status, goods.text).toBe(201);
    const register = () =>
      w.call(
        'GET',
        `/v1/reports/eway-register?businessId=${w.businessId}&from=2026-04-01&to=2027-03-31`,
      );
    expect((await register()).body.rows).toHaveLength(0); // ₹30,000 is under the ₹50,000 default
    expect((await patch(w, { 'txn.ewayThreshold': 25000 })).status).toBe(200);
    const after = await register();
    expect(after.status, after.text).toBe(200);
    expect(after.body.rows).toHaveLength(1);
    expect(after.body.meta.limit).toBe(25000);
  });
});
