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
