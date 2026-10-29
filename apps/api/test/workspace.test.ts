import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '@ledgora/db';
import { purgeExpired } from '../src/modules/trash.ts';
import { makeHarness } from './helpers.ts';

const h = makeHarness();
afterAll(() => h.close());
const W = '/v1/workspace';
const bill = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  invoiceNumber: id,
  invoiceDate: '2026-10-01',
  clientName: 'Acme',
  totalAmount: 118,
  status: 'unpaid',
  payments: [],
  data: {},
  ...extra,
});

describe('collections', () => {
  it('saves, lists in the order each screen expects, and returns ids', async () => {
    const t = await h.newTenant();
    expect((await t.call('POST', `${W}/collections/clients`, { name: 'Zed' })).body.id).toMatch(
      /^cli_\d+$/,
    );
    await t.call('POST', `${W}/collections/clients`, { id: 'c2', name: 'Alpha' });
    expect((await t.call('GET', `${W}/collections/clients`)).body.map((c: any) => c.name)).toEqual([
      'Alpha',
      'Zed',
    ]);
    await t.call('POST', `${W}/collections/bills`, bill('INV/1', { invoiceDate: '2026-01-01' }));
    await t.call('POST', `${W}/collections/bills`, bill('INV/2', { invoiceDate: '2026-03-01' }));
    expect((await t.call('GET', `${W}/collections/bills`)).body.map((b: any) => b.id)).toEqual([
      'INV/2',
      'INV/1',
    ]); // newest first
    expect(
      (await t.call('POST', `${W}/collections/bills`, { invoiceNumber: 'x' })).body.error.message,
    ).toMatch(/must have an id/);
    expect((await t.call('GET', `${W}/collections/nonsense`)).status).toBe(400);
  });

  it('refuses to replace a bill silently (409) and replaces it when editing', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/collections/bills`, bill('INV/9'));
    const dupe = await t.call('POST', `${W}/collections/bills`, bill('INV/9', { totalAmount: 5 }));
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.details.invoiceNumber).toBe('INV/9');
    expect(
      (
        await t.call(
          'POST',
          `${W}/collections/bills?overwrite=1`,
          bill('INV/9', { totalAmount: 5 }),
        )
      ).status,
    ).toBe(200);
    expect((await t.call('GET', `${W}/collections/bills`)).body[0].totalAmount).toBe(5);
  });

  it('other collections save over the same id and delete for good', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/collections/products`, { id: 'p1', name: 'Pen', stock: 5 });
    await t.call('POST', `${W}/collections/products`, { id: 'p1', name: 'Pen', stock: 4 });
    expect((await t.call('GET', `${W}/collections/products`)).body).toEqual([
      { id: 'p1', name: 'Pen', stock: 4 },
    ]);
    await t.call('DELETE', `${W}/collections/products/p1`);
    expect((await t.call('GET', `${W}/collections/products`)).body).toEqual([]);
    expect((await t.call('DELETE', `${W}/collections/products/never-existed`)).status).toBe(200);
  });

  it('seeds the default terms template once', async () => {
    const t = await h.newTenant();
    const first = (await t.call('GET', `${W}/collections/templates`)).body;
    expect(first).toHaveLength(1);
    expect(first[0].name).toBe('Standard Terms');
    expect((await t.call('GET', `${W}/collections/templates`)).body).toHaveLength(1);
  });
});

describe('the bill trash', () => {
  it('deleting a bill trashes it, restore brings it back, and purge removes it for good', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/collections/bills`, bill('INV/T1'));
    expect(
      (await t.call('DELETE', `${W}/collections/bills/INV/T1`.replace('/INV/T1', '/INV%2FT1'))).body
        .trashed,
    ).toBe(true);
    expect((await t.call('GET', `${W}/collections/bills`)).body).toEqual([]);
    const trash = (await t.call('GET', `${W}/trash`)).body;
    expect(trash).toHaveLength(1);
    expect(trash[0]._trashedAt).toBeTruthy();
    // The number is free again while it is in the trash, so restoring over a new one is refused.
    await t.call('POST', `${W}/collections/bills`, bill('INV/T1', { totalAmount: 7 }));
    expect((await t.call('POST', `${W}/trash/INV%2FT1/restore`)).status).toBe(409);
    await t.call('DELETE', `${W}/collections/bills/INV%2FT1?permanent=1`);
    expect((await t.call('POST', `${W}/trash/INV%2FT1/restore`)).status).toBe(200);
    expect((await t.call('GET', `${W}/collections/bills`)).body).toHaveLength(1);
    await t.call('DELETE', `${W}/collections/bills/INV%2FT1`);
    expect((await t.call('DELETE', `${W}/trash/INV%2FT1`)).status).toBe(200);
    expect((await t.call('GET', `${W}/trash`)).body).toEqual([]);
  });

  it('keeps a bill that another bill was paid from, unless forced', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/collections/bills`, bill('SRC'));
    await t.call(
      'POST',
      `${W}/collections/bills`,
      bill('TGT', {
        payments: [{ mode: 'credit-applied', amount: 50, creditSourceBillIds: ['SRC'] }],
      }),
    );
    const blocked = await t.call('DELETE', `${W}/collections/bills/SRC`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('credit_dependency');
    expect(blocked.body.error.details.dependents[0]).toMatchObject({ id: 'TGT', amount: 50 });
    expect((await t.call('DELETE', `${W}/collections/bills/SRC?force=1`)).status).toBe(200);
  });

  it('trashed bills are purged after 30 days with the rest of the trash', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/collections/bills`, bill('OLD'));
    await t.call('DELETE', `${W}/collections/bills/OLD`);
    expect(await withTenant(h.db, t.orgId, (tx) => purgeExpired(tx))).toBe(0);
    expect(
      await withTenant(h.db, t.orgId, (tx) =>
        purgeExpired(tx, new Date(Date.now() + 31 * 86_400_000)),
      ),
    ).toBe(1);
    expect((await t.call('GET', `${W}/trash`)).body).toEqual([]);
  });
});

describe('settings and counters', () => {
  it('profile defaults, settings round trip, and null for unknown keys', async () => {
    const t = await h.newTenant();
    expect((await t.call('GET', `${W}/profile`)).body.googleDriveFolder).toBe(
      'GST Billing Invoices',
    );
    await t.call('POST', `${W}/profile`, { businessName: 'Shop', state: 'Kerala' });
    expect((await t.call('GET', `${W}/profile`)).body).toEqual({
      businessName: 'Shop',
      state: 'Kerala',
    });
    expect((await t.call('GET', `${W}/meta/regionMode`)).body.value).toBeNull();
    await t.call('POST', `${W}/meta/regionMode`, { value: 'india' });
    expect((await t.call('GET', `${W}/meta/regionMode`)).body.value).toBe('india');
    expect((await t.call('POST', `${W}/meta/x`, {})).status).toBe(400); // a setting needs a value
  });

  it('counters hand out 15 different numbers to 15 simultaneous saves, and honour a start number', async () => {
    const t = await h.newTenant();
    const res = await Promise.all(
      Array.from({ length: 15 }, () => t.call('POST', `${W}/meta/counter_INV/increment`, {})),
    );
    expect(res.map((r) => r.body.value).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    expect(
      (await t.call('POST', `${W}/meta/counter_QUO/increment`, { start: 1001 })).body.value,
    ).toBe(1001);
    expect(
      (await t.call('POST', `${W}/meta/counter_QUO/increment`, { start: 1001 })).body.value,
    ).toBe(1002);
    expect((await t.call('GET', `${W}/meta/counter_QUO`)).body.value).toBe(1002);
  });

  it('screen preferences belong to the person: two members of one organization do not share them', async () => {
    const t = await h.newTenant();
    const other = await h.addMember(t, 'biller');
    await t.call('POST', `${W}/local-prefs`, { set: { theme: 'dark', a: '1' } });
    await t.call('POST', `${W}/local-prefs`, { set: { b: '2' }, remove: ['a'] });
    expect((await t.call('GET', `${W}/local-prefs`)).body.value).toEqual({ theme: 'dark', b: '2' });
    expect((await other.call('GET', `${W}/local-prefs`)).body.value).toEqual({});
    expect((await t.call('POST', `${W}/local-prefs`, { set: { bad: 1 } })).status).toBe(400); // values are strings
  });

  it('moves a number series to a renamed business with its counters', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/meta/invoiceNumberSeries`, {
      value: { OLD: { brandPrefix: 'OLD' } },
    });
    await t.call('POST', `${W}/meta/counter_INV@OLD`, { value: 7 });
    expect(
      (await t.call('POST', `${W}/number-series/rename`, { from: 'OLD', to: 'NEW' })).body.moved,
    ).toBe(true);
    expect((await t.call('GET', `${W}/meta/invoiceNumberSeries`)).body.value).toEqual({
      NEW: { brandPrefix: 'OLD' },
    });
    expect((await t.call('GET', `${W}/meta/counter_INV@NEW`)).body.value).toBe(7);
    expect((await t.call('GET', `${W}/meta/counter_INV@OLD`)).body.value).toBeNull();
    expect(
      (await t.call('POST', `${W}/number-series/rename`, { from: 'OLD', to: 'NEW' })).body.moved,
    ).toBe(false);
  });
});

describe('export and import', () => {
  it('exports everything and imports it into another organization, merging by default and replacing on request', async () => {
    const a = await h.newTenant();
    await a.call('POST', `${W}/collections/bills`, bill('INV/2026-27/0003'));
    await a.call('POST', `${W}/collections/clients`, { id: 'c1', name: 'Acme' });
    await a.call('POST', `${W}/profile`, { businessName: 'A Shop' });
    await a.call('POST', `${W}/meta/counter_INV`, { value: 3 });
    const file = (await a.call('GET', `${W}/export`)).body;
    expect(file.bills).toHaveLength(1);
    expect(file.meta.counter_INV).toBe(3);

    const b = await h.newTenant();
    await b.call('POST', `${W}/collections/clients`, { id: 'c1', name: 'Already here' });
    const first = (await b.call('POST', `${W}/import`, file)).body;
    expect(first).toMatchObject({
      billCount: 1,
      clientCount: 0,
      clientSkipped: 1,
      hasProfile: true,
    });
    expect((await b.call('GET', `${W}/collections/clients`)).body[0].name).toBe('Already here');
    expect((await b.call('POST', `${W}/import?overwrite=1`, file)).body).toMatchObject({
      clientCount: 1,
    });
    expect((await b.call('GET', `${W}/collections/clients`)).body[0].name).toBe('Acme');
    // The counter is at least the highest number in the imported bills, so the next invoice can not collide.
    expect((await b.call('GET', `${W}/meta/counter_INV`)).body.value).toBeGreaterThanOrEqual(3);
  });

  it('drops a PIN hash from an old backup', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/import`, { meta: { appLock: { hash: 'x' }, regionMode: 'india' } });
    expect((await t.call('GET', `${W}/meta/appLock`)).body.value).toBeNull();
    expect((await t.call('GET', `${W}/meta/regionMode`)).body.value).toBe('india');
  });
});

describe('recurring', () => {
  it('"Generate now" makes a numbered invoice with the right totals and moves the template on', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/profile`, {
      businessName: 'Seller',
      state: 'Tamil Nadu',
      country: 'India',
      gstin: '33AAAAA0000A1Z5',
    });
    await t.call('POST', `${W}/collections/recurring`, {
      id: 'r1',
      clientName: 'Retainer Co',
      clientState: 'Tamil Nadu',
      frequency: 'monthly',
      interval: 1,
      nextDate: '2026-11-05',
      dueDays: 10,
      items: [{ name: 'Retainer', quantity: 1, rate: 1000, taxPercent: 18 }],
    });
    const gen = await t.call('POST', `${W}/recurring/r1/generate`);
    expect(gen.status).toBe(200);
    expect(gen.body.invoiceNumber).toMatch(/^INV\/\d{4}-\d{2}\/0001$/);
    const made = (await t.call('GET', `${W}/collections/bills`)).body[0];
    expect(made).toMatchObject({
      clientName: 'Retainer Co',
      totalAmount: 1180,
      autoGenerated: true,
      generatedFrom: 'r1',
    });
    expect(made.data.totals).toMatchObject({ cgst: 90, sgst: 90 });
    const tpl = (await t.call('GET', `${W}/collections/recurring`)).body[0];
    expect(tpl).toMatchObject({ nextDate: '2026-12-05', occurrencesCreated: 1 });
    expect((await t.call('POST', `${W}/recurring/r1/generate`)).body.invoiceNumber).toMatch(
      /0002$/,
    );
    expect((await t.call('POST', `${W}/recurring/missing/generate`)).status).toBe(404);
    await t.call('POST', `${W}/collections/recurring`, {
      id: 'r2',
      clientName: 'Done',
      endMode: 'afterN',
      maxOccurrences: 1,
      occurrencesCreated: 1,
      items: [],
    });
    expect((await t.call('POST', `${W}/recurring/r2/generate`)).status).toBe(409);
  });
});

describe('who may do what, and isolation', () => {
  it('another organization never sees these documents', async () => {
    const [a, b] = [await h.newTenant(), await h.newTenant()];
    await a.call('POST', `${W}/collections/bills`, bill('SECRET/1'));
    await a.call('POST', `${W}/meta/counter_INV`, { value: 9 });
    expect(JSON.stringify((await b.call('GET', `${W}/collections/bills`)).body)).not.toContain(
      'SECRET',
    );
    expect((await b.call('GET', `${W}/meta/counter_INV`)).body.value).toBeNull();
    expect((await b.call('DELETE', `${W}/collections/bills/SECRET%2F1`)).status).toBe(200); // nothing to delete in B
    expect((await a.call('GET', `${W}/collections/bills`)).body).toHaveLength(1);
    expect((await h.app.request(`${W}/collections/bills`)).status).toBe(401);
  });

  it('roles apply: a viewer reads but cannot save; a biller saves invoices but not settings or exports', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/collections/bills`, bill('R/1'));
    const viewer = await h.addMember(t, 'viewer');
    const biller = await h.addMember(t, 'biller');
    expect((await viewer.call('GET', `${W}/collections/bills`)).status).toBe(200);
    expect((await viewer.call('POST', `${W}/collections/bills`, bill('R/2'))).body.error.code).toBe(
      'forbidden',
    );
    expect((await viewer.call('POST', `${W}/meta/counter_INV/increment`, {})).status).toBe(403);
    expect((await biller.call('POST', `${W}/collections/bills`, bill('R/3'))).status).toBe(200);
    expect((await biller.call('POST', `${W}/meta/counter_INV/increment`, {})).status).toBe(200);
    expect((await biller.call('GET', `${W}/profile`)).status).toBe(200); // needed to print an invoice
    expect((await biller.call('POST', `${W}/profile`, { businessName: 'x' })).status).toBe(403);
    expect((await biller.call('POST', `${W}/meta/regionMode`, { value: 'x' })).status).toBe(403);
    expect((await biller.call('GET', `${W}/export`)).status).toBe(403);
    expect((await biller.call('POST', `${W}/collections/clients`, { name: 'c' })).status).toBe(200);
    expect((await biller.call('POST', `${W}/collections/products`, { name: 'p' })).status).toBe(
      403,
    );
  });

  it('every save is in the audit trail', async () => {
    const t = await h.newTenant();
    await t.call('POST', `${W}/collections/bills`, bill('AUD/1'));
    await t.call('DELETE', `${W}/collections/bills/AUD%2F1`);
    const actions = (await t.call('GET', '/v1/audit?limit=20')).body.data.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['bills.create', 'bills.trash']));
  });
});
