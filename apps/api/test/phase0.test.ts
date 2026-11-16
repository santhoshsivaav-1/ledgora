import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';

// Phase 0 of docs/AUDIT_2026-11.md: the calls that replaced "download every bill, client and product on every page":
// the bootstrap answer, the search and the bell, plus the Server-Timing header and the quiet Cash & Bank list.
const h = makeHarness();
afterAll(() => h.close());

const bill = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  invoiceNumber: id,
  invoiceDate: '2026-11-01',
  invoiceType: 'tax-invoice',
  status: 'unpaid',
  clientName: 'Asha Traders',
  totalAmount: 1180,
  ...over,
});
const withDue = (id: string, dueDate: string, over: Record<string, unknown> = {}) =>
  bill(id, { data: { details: { dueDate } }, ...over });
const post = (t: Tenant, collection: string, doc: unknown) =>
  t.call('POST', `/v1/workspace/collections/${collection}`, doc);

describe('GET /v1/bootstrap', () => {
  it('answers exactly what me, onboarding, preferences and businesses answer separately', async () => {
    const t = await h.newTenant();
    await t.call('POST', '/v1/workspace/local-prefs', { set: { gst_regionMode: 'india' } });
    const boot = await t.call('GET', '/v1/bootstrap');
    expect(boot.status, boot.text).toBe(200);
    const [me, onboarding, prefs, businesses] = await Promise.all([
      t.call('GET', '/v1/me'),
      t.call('GET', '/v1/onboarding'),
      t.call('GET', '/v1/workspace/local-prefs'),
      t.call('GET', '/v1/businesses'),
    ]);
    expect(boot.body.me).toEqual(me.body);
    expect(boot.body.onboarding).toEqual(onboarding.body);
    expect(boot.body.prefs).toEqual(prefs.body.value);
    expect(boot.body.prefs).toEqual({ gst_regionMode: 'india' });
    expect(boot.body.businesses).toEqual(businesses.body.data);
  });

  it('needs a session, and gives a member without any permission the same start-up answer', async () => {
    expect((await h.app.request('/v1/bootstrap')).status).toBe(401);
    const t = await h.newTenant();
    const viewer = await h.addMember(t, 'viewer');
    const boot = await viewer.call('GET', '/v1/bootstrap');
    expect(boot.status, boot.text).toBe(200);
    expect(boot.body.me.role).toBe('viewer');
  });
});

describe('Server-Timing', () => {
  it('every API answer says how long it took', async () => {
    const t = await h.newTenant();
    const r = await t.call('GET', '/v1/me');
    expect(r.headers.get('server-timing')).toMatch(/^app;dur=\d+(\.\d+)?$/);
    const bad = await t.call('GET', '/v1/accounts?businessId=nope');
    expect(bad.status).toBe(400);
    expect(bad.headers.get('server-timing')).toMatch(/^app;dur=/);
  });
});

describe('GET /v1/workspace/search', () => {
  it('finds invoices, parties and items by what was typed, at most 8 of each', async () => {
    const t = await h.newTenant();
    await post(t, 'bills', bill('INV-100', { clientName: 'Meena Textiles' }));
    await post(t, 'bills', bill('INV-200', { clientName: 'Ravi Stores' }));
    await post(t, 'clients', {
      id: 'c1',
      name: 'Meena Textiles',
      phone: '9876543210',
      gstin: '33ABCDE1234F1Z7',
    });
    await post(t, 'clients', { id: 'c2', name: 'Ravi Stores', phone: '9000000001' });
    await post(t, 'products', { id: 'p1', name: 'Cotton Shirt', hsn: '6205', stock: 4 });
    await post(t, 'products', { id: 'p2', name: 'Denim Jeans', hsn: '6203', stock: 9 });
    const q = (text: string) => t.call('GET', `/v1/workspace/search?q=${encodeURIComponent(text)}`);
    const meena = (await q('meena')).body;
    expect(meena.bills.map((b: any) => b.id)).toEqual(['INV-100']);
    expect(meena.clients.map((c: any) => c.id)).toEqual(['c1']);
    expect(meena.products).toEqual([]);
    expect((await q('INV-2')).body.bills.map((b: any) => b.id)).toEqual(['INV-200']);
    expect((await q('987654')).body.clients.map((c: any) => c.id)).toEqual(['c1']); // by phone
    expect((await q('6205')).body.products.map((p: any) => p.id)).toEqual(['p1']); // by HSN
    expect((await q('33ABCDE')).body.clients.map((c: any) => c.id)).toEqual(['c1']); // by GSTIN
    // the full document comes back (the editor opens it)
    expect((await q('INV-100')).body.bills[0]).toMatchObject({
      id: 'INV-100',
      clientName: 'Meena Textiles',
    });
  });

  it('caps each list at 8, newest invoices first, and treats % and _ as plain characters', async () => {
    const t = await h.newTenant();
    for (let i = 1; i <= 11; i++)
      await post(
        t,
        'bills',
        bill(`INV-${String(i).padStart(3, '0')}`, {
          invoiceDate: `2026-10-${String(i).padStart(2, '0')}`,
        }),
      );
    await post(t, 'clients', { id: 'c1', name: '100% Cotton Co' });
    await post(t, 'clients', { id: 'c2', name: 'Cotton Mills' });
    const q = (text: string) => t.call('GET', `/v1/workspace/search?q=${encodeURIComponent(text)}`);
    const found = (await q('INV')).body.bills.map((b: any) => b.id);
    expect(found).toHaveLength(8);
    expect(found[0]).toBe('INV-011'); // newest first
    expect((await q('0% C')).body.clients.map((c: any) => c.id)).toEqual(['c1']); // a literal percent sign
    expect((await q('%%')).body.clients).toHaveLength(0); // not "everything"
    expect((await q('__')).body.clients).toHaveLength(0);
  });

  it('refuses a one-letter search, and respects "own transactions only" and "hide purchase prices"', async () => {
    const t = await h.newTenant();
    expect((await t.call('GET', '/v1/workspace/search?q=a')).status).toBe(400);
    await t.call('PUT', '/v1/roles/biller', {
      permissions: ['invoice:read', 'invoice:write', 'party:read', 'item:read'],
      ownOnly: true,
      hideCost: true,
    });
    const b = await h.addMember(t, 'biller');
    await post(t, 'bills', bill('INV-OWNER', { clientName: 'Zed' }));
    await b.call(
      'POST',
      '/v1/workspace/collections/bills',
      bill('INV-MINE', { clientName: 'Zed' }),
    );
    await post(t, 'products', { id: 'p1', name: 'Zed Pen', purchasePrice: 7, sellingPrice: 10 });
    const seen = (await b.call('GET', '/v1/workspace/search?q=zed')).body;
    expect(seen.bills.map((x: any) => x.id)).toEqual(['INV-MINE']);
    expect(seen.products[0].name).toBe('Zed Pen');
    expect(seen.products[0].purchasePrice).toBeUndefined();
    expect((await t.call('GET', '/v1/workspace/search?q=zed')).body.bills).toHaveLength(2); // the owner sees both
  });

  it('is invisible across organizations', async () => {
    const t = await h.newTenant();
    const other = await h.newTenant();
    await post(t, 'clients', { id: 'c1', name: 'Secretive Traders' });
    expect((await other.call('GET', '/v1/workspace/search?q=secretive')).body.clients).toEqual([]);
  });
});

describe('GET /v1/workspace/notifications', () => {
  const get = (t: Tenant, today = '2026-11-16', soon = 3) =>
    t.call('GET', `/v1/workspace/notifications?today=${today}&soon=${soon}`);

  it('lists overdue and due-soon unpaid invoices, and leaves out paid, cancelled and non-sales documents', async () => {
    const t = await h.newTenant();
    await post(t, 'bills', withDue('OVER-1', '2026-11-10'));
    await post(t, 'bills', withDue('SOON-1', '2026-11-18'));
    await post(t, 'bills', withDue('SOON-EDGE', '2026-11-19')); // today + 3 days is included
    await post(t, 'bills', withDue('LATER', '2026-11-20')); // outside the window
    await post(t, 'bills', withDue('PAID', '2026-11-01', { status: 'paid' }));
    await post(t, 'bills', withDue('QUOTE', '2026-11-01', { invoiceType: 'quotation' }));
    await post(t, 'bills', withDue('CANCELLED', '2026-11-01', { status: 'cancelled' }));
    await post(t, 'bills', bill('NODUE')); // no due date
    const n = (await get(t)).body;
    expect(n.overdue.map((b: any) => b.id)).toEqual(['OVER-1']);
    expect(n.dueSoon.map((b: any) => b.id).sort()).toEqual(['SOON-1', 'SOON-EDGE']);
    expect(n.overdue[0]).toMatchObject({
      invoiceNumber: 'OVER-1',
      clientName: 'Asha Traders',
      dueDate: '2026-11-10',
    });
    // the browser's own date decides what is overdue: an invoice due 16 Nov is not overdue on the 16th, it is on the 17th
    await post(t, 'bills', withDue('TODAY', '2026-11-16'));
    expect((await get(t, '2026-11-16')).body.overdue.map((b: any) => b.id)).not.toContain('TODAY');
    expect((await get(t, '2026-11-17')).body.overdue.map((b: any) => b.id)).toContain('TODAY');
  });

  it('lists products at or below the stock threshold or their own minimum, and nothing when the alert is off', async () => {
    const t = await h.newTenant();
    await post(t, 'products', { id: 'low', name: 'Low', stock: 3 });
    await post(t, 'products', { id: 'edge', name: 'Edge', stock: 5 });
    await post(t, 'products', { id: 'fine', name: 'Fine', stock: 40 });
    await post(t, 'products', { id: 'own', name: 'Own minimum', stock: 12, minStock: 20 });
    await post(t, 'products', { id: 'nostock', name: 'Service' });
    await post(t, 'products', { id: 'bad', name: 'Odd', stock: 'many' });
    const n = (await get(t)).body;
    expect(n.stockAlert).toEqual({ enabled: true, threshold: 5 });
    expect(n.lowStock.map((p: any) => p.id).sort()).toEqual(['edge', 'low', 'own']);
    expect(n.lowStock.find((p: any) => p.id === 'own')).toMatchObject({ stock: 12, minStock: 20 });
    await t.call('POST', '/v1/workspace/meta/stockAlertSettings', {
      value: { enabled: true, threshold: 50 },
    });
    expect((await get(t)).body.lowStock.map((p: any) => p.id)).toContain('fine');
    await t.call('POST', '/v1/workspace/meta/stockAlertSettings', {
      value: { enabled: false, threshold: 5 },
    });
    const off = (await get(t)).body;
    expect(off.stockAlert.enabled).toBe(false);
    expect(off.lowStock).toEqual([]);
  });

  it('carries the recurring auto-fire note, and refuses a bad date', async () => {
    const t = await h.newTenant();
    expect((await get(t)).body.autoFire).toBeNull();
    await t.call('POST', '/v1/workspace/meta/lastRecurringAutoFire', {
      value: { date: '2026-11-16', count: 2 },
    });
    expect((await get(t)).body.autoFire).toEqual({ date: '2026-11-16', count: 2 });
    expect((await t.call('GET', '/v1/workspace/notifications?today=16-11-2026')).status).toBe(400);
  });

  it('shows a member only their own invoices when that is their role, and nothing of another organization', async () => {
    const t = await h.newTenant();
    await t.call('PUT', '/v1/roles/biller', {
      permissions: ['invoice:read', 'invoice:write', 'item:read'],
      ownOnly: true,
    });
    const b = await h.addMember(t, 'biller');
    await post(t, 'bills', withDue('OWNER-OVER', '2026-11-01'));
    await b.call('POST', '/v1/workspace/collections/bills', withDue('MINE-OVER', '2026-11-01'));
    expect((await get(b as unknown as Tenant)).body.overdue.map((x: any) => x.id)).toEqual([
      'MINE-OVER',
    ]);
    expect((await get(t)).body.overdue).toHaveLength(2);
    const other = await h.newTenant();
    expect((await get(other)).body.overdue).toEqual([]);
  });
});

describe('Cash & Bank list for a screen that only offers banks when there are some', () => {
  it('answers an empty list, not a 409, with ifOn=1 while Cash & Bank is off; without it the 409 stays', async () => {
    const t = await h.newTenant();
    expect((await t.call('GET', `/v1/bank-accounts?businessId=${t.businessId}`)).status).toBe(409);
    const quiet = await t.call('GET', `/v1/bank-accounts?businessId=${t.businessId}&ifOn=1`);
    expect(quiet.status).toBe(200);
    expect(quiet.body.data).toEqual([]);
  });
});
