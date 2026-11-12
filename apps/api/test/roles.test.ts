import { afterAll, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@ledgora/contracts';
import { makeHarness } from './helpers.ts';

// Account Access matrix (P8-S13): the owner edits what a role may do; it applies on the next request.
const h = makeHarness();
afterAll(() => h.close());

describe('roles', () => {
  it('lists every role with its preset, and the owner is fixed', async () => {
    const t = await h.newTenant();
    const r = await t.call('GET', '/v1/roles');
    expect(r.status, r.text).toBe(200);
    const biller = r.body.roles.find((x: any) => x.role === 'biller');
    expect(biller).toMatchObject({ customised: false, editable: true });
    expect(biller.permissions).toEqual([...ROLE_PERMISSIONS.biller]);
    expect(r.body.roles.find((x: any) => x.role === 'owner').editable).toBe(false);
    expect(r.body.groups.length).toBeGreaterThan(5);
  });

  it('a change applies on the next request, only in this organization, and reset restores the preset', async () => {
    const t = await h.newTenant();
    const other = await h.newTenant();
    const biller = await h.addMember(t, 'biller');
    const otherBiller = await h.addMember(other, 'biller');
    expect((await biller.call('GET', '/v1/purchases')).status).toBe(403);
    const put = await t.call('PUT', '/v1/roles/biller', {
      permissions: ['purchase:write', 'invoice:read'],
    });
    expect(put.status, put.text).toBe(200);
    expect(put.body.permissions).toEqual(
      expect.arrayContaining(['purchase:write', 'purchase:read', 'invoice:read']),
    );
    expect((await biller.call('GET', '/v1/purchases')).status).toBe(200);
    expect((await biller.call('GET', '/v1/parties')).status).toBe(403);
    expect((await biller.call('GET', '/v1/me')).body.permissions).toContain('purchase:read');
    expect((await otherBiller.call('GET', '/v1/purchases')).status).toBe(403);
    expect(
      (await t.call('GET', '/v1/roles')).body.roles.find((x: any) => x.role === 'biller')
        .customised,
    ).toBe(true);
    expect((await t.call('DELETE', '/v1/roles/biller')).status).toBe(200);
    expect((await biller.call('GET', '/v1/purchases')).status).toBe(403);
    expect((await biller.call('GET', '/v1/parties')).status).toBe(200);
  });

  it('only the owner edits roles; the owner role and billing permission can not be handed out', async () => {
    const t = await h.newTenant();
    const admin = await h.addMember(t, 'admin');
    expect(
      (await admin.call('PUT', '/v1/roles/viewer', { permissions: ['invoice:read'] })).status,
    ).toBe(403);
    expect((await t.call('PUT', '/v1/roles/owner', { permissions: [] })).status).toBe(403);
    const r = await t.call('PUT', '/v1/roles/viewer', {
      permissions: ['billing:manage', 'invoice:read', 'bogus:x'],
    });
    expect(r.body.permissions).toEqual(['invoice:read']);
    expect((await t.call('PUT', '/v1/roles/nobody', { permissions: [] })).status).toBe(403);
  });
});

describe('custom roles and the two rules', () => {
  it('a custom role is made from another, can be given to a member, and can be deleted only when nobody has it', async () => {
    const t = await h.newTenant();
    const made = await t.call('POST', '/v1/roles', { label: 'Counter staff', copyFrom: 'biller' });
    expect(made.status, made.text).toBe(200);
    expect(made.body.role).toBe('custom_counter_staff');
    expect(made.body.permissions).toEqual(expect.arrayContaining(['invoice:write']));
    expect((await t.call('POST', '/v1/roles', { label: 'Counter staff' })).status).toBe(409);
    const list = (await t.call('GET', '/v1/roles')).body.roles;
    expect(list.find((r: any) => r.role === 'custom_counter_staff')).toMatchObject({
      custom: true,
      label: 'Counter staff',
    });
    const inv = await t.call('POST', '/v1/invitations', {
      email: 'cs@example.com',
      role: 'custom_counter_staff',
      businessIds: [],
    });
    expect(inv.status, inv.text).toBe(201);
    expect(
      (
        await t.call('POST', '/v1/invitations', {
          email: 'x@example.com',
          role: 'custom_nope',
          businessIds: [],
        })
      ).status,
    ).toBe(400);
    expect((await t.call('DELETE', '/v1/roles/custom_counter_staff')).status).toBe(409);
    expect((await t.call('DELETE', `/v1/invitations/${inv.body.id}`)).status).toBeLessThan(300);
    expect((await t.call('DELETE', '/v1/roles/custom_counter_staff')).status).toBe(200);
  });

  it('a member with a custom role gets exactly its permissions and name', async () => {
    const t = await h.newTenant();
    await t.call('POST', '/v1/roles', { label: 'Stock checker', copyFrom: 'viewer' });
    await t.call('PUT', '/v1/roles/custom_stock_checker', { permissions: ['item:read'] });
    const m = await h.addMember(t, 'custom_stock_checker');
    const me = (await m.call('GET', '/v1/me')).body;
    expect(me.permissions).toEqual(['item:read']);
    expect(me.roleLabel).toBe('Stock checker');
    expect((await m.call('GET', '/v1/items')).status).toBe(200);
    expect((await m.call('GET', '/v1/invoices')).status).toBe(403);
  });

  it("own transactions only: invoices and the screens' documents made by others are invisible and untouchable", async () => {
    const t = await h.newTenant();
    await t.call('PUT', '/v1/roles/biller', {
      permissions: ['invoice:read', 'invoice:write', 'party:read', 'item:read'],
      ownOnly: true,
    });
    const b = await h.addMember(t, 'biller');
    const line = { name: 'Thing', quantity: 1, rate: 100, taxPercent: 18 };
    const ownerInv = await t.call('POST', '/v1/invoices', {
      businessId: t.businessId,
      invoiceDate: '2026-10-01',
      items: [line],
    });
    const mineInv = await b.call('POST', '/v1/invoices', {
      businessId: t.businessId,
      invoiceDate: '2026-10-02',
      items: [line],
    });
    expect(mineInv.status, mineInv.text).toBe(201);
    const listed = (await b.call('GET', '/v1/invoices')).body.data.map((i: any) => i.id);
    expect(listed).toEqual([mineInv.body.id]);
    expect((await b.call('GET', `/v1/invoices/${ownerInv.body.id}`)).status).toBe(404);
    expect((await t.call('GET', '/v1/invoices')).body.data).toHaveLength(2); // the owner sees both
    // workspace bills
    await t.call('POST', '/v1/workspace/collections/bills', {
      id: 'INV-OWN-1',
      clientName: 'A',
      invoiceDate: '2026-10-01',
    });
    await b.call('POST', '/v1/workspace/collections/bills', {
      id: 'INV-B-1',
      clientName: 'B',
      invoiceDate: '2026-10-01',
    });
    const bills = (await b.call('GET', '/v1/workspace/collections/bills')).body.map(
      (x: any) => x.id,
    );
    expect(bills).toEqual(['INV-B-1']);
    expect(
      (
        await b.call('POST', '/v1/workspace/collections/bills?overwrite=1', {
          id: 'INV-OWN-1',
          clientName: 'Z',
        })
      ).status,
    ).toBe(403);
    expect((await b.call('DELETE', '/v1/workspace/collections/bills/INV-OWN-1')).status).toBe(403);
    // the stamp can not be forged
    await b.call('POST', '/v1/workspace/collections/bills', {
      id: 'INV-B-2',
      clientName: 'B',
      _createdBy: 'someone-else',
    });
    expect(
      (await b.call('GET', '/v1/workspace/collections/bills')).body.map((x: any) => x.id),
    ).toContain('INV-B-2');
  });

  it('hide purchase prices: costs read as hidden and a save keeps the stored cost', async () => {
    const t = await h.newTenant();
    await t.call('PUT', '/v1/roles/stock_keeper', {
      permissions: [...ROLE_PERMISSIONS.stock_keeper],
      hideCost: true,
    });
    const s = await h.addMember(t, 'stock_keeper');
    expect((await s.call('GET', '/v1/me')).body.restrictions).toEqual({
      ownOnly: false,
      hideCost: true,
    });
    await t.call('POST', '/v1/workspace/collections/products', {
      id: 'p1',
      name: 'Pen',
      purchasePrice: 7,
      sellingPrice: 10,
    });
    const seen = (await s.call('GET', '/v1/workspace/collections/products')).body.find(
      (p: any) => p.id === 'p1',
    );
    expect(seen.purchasePrice).toBeUndefined();
    expect(seen.sellingPrice).toBe(10);
    await s.call('POST', '/v1/workspace/collections/products', {
      id: 'p1',
      name: 'Pen (blue)',
      purchasePrice: 0,
      sellingPrice: 11,
    });
    const stored = (await t.call('GET', '/v1/workspace/collections/products')).body.find(
      (p: any) => p.id === 'p1',
    );
    expect(stored).toMatchObject({ name: 'Pen (blue)', purchasePrice: 7, sellingPrice: 11 });
    const item = await t.call('POST', '/v1/items', {
      name: 'Ink',
      purchasePrice: 30,
      salePrice: 50,
    });
    expect((await s.call('GET', `/v1/items/${item.body.id}`)).body.purchasePrice).toBe(0);
    expect((await t.call('GET', `/v1/items/${item.body.id}`)).body.purchasePrice).toBe(30);
  });
});
