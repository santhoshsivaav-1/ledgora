import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';

// Vyapar parity P1-S1: party groups.
const h = makeHarness();
const G = '/v1/party-groups';
const W = '/v1/workspace';
let t: Tenant;

const create = async (name: string, parentId?: string | null) => {
  const res = await t.call('POST', G, { name, parentId });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
};
const list = async (who: Tenant = t) => (await who.call('GET', G)).body.data as any[];
const countOf = async (id: string) => (await list()).find((g) => g.id === id)?.partyCount;

beforeAll(async () => {
  t = await h.newTenant();
});
afterAll(() => h.close());

describe('create, rename, nest', () => {
  it('creates a top-level group with no parties', async () => {
    const id = await create('Wholesale');
    expect(await list()).toContainEqual(
      expect.objectContaining({ id, name: 'Wholesale', parentId: null, partyCount: 0 }),
    );
  });

  it('refuses a second group with the same name in any case', async () => {
    await create('Vendors');
    const res = await t.call('POST', G, { name: 'VENDORS' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'conflict', message: 'Group already exists' });
  });

  it('nests a child under a parent and renames without touching the parent', async () => {
    const retail = await create('Retail');
    const chennai = await create('Chennai', retail);
    const res = await t.call('PATCH', `${G}/${chennai}`, { name: 'Chennai City' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Chennai City', parentId: retail });
  });

  it('refuses a parent that is missing', async () => {
    const res = await t.call('POST', G, {
      name: 'Orphan',
      parentId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { path: 'parentId', message: 'Parent group not found' },
    ]);
  });

  it('refuses a blank name', async () => {
    expect((await t.call('POST', G, { name: '  ' })).status).toBe(400);
  });

  it('writes an audit row for each change', async () => {
    const id = await create('Audited');
    await t.call('PATCH', `${G}/${id}`, { name: 'Audited 2' });
    await t.call('DELETE', `${G}/${id}`);
    const rows = await withTenant(h.db, t.orgId, (tx) => tx.select().from(schema.auditLog));
    const actions = rows.filter((r) => r.entityId === id).map((r) => r.action);
    expect(actions.sort()).toEqual([
      'party_group.create',
      'party_group.delete',
      'party_group.update',
    ]);
  });
});

describe('cycle guard', () => {
  it('refuses the group itself or any descendant as its parent', async () => {
    const a = await create('Level A');
    const b = await create('Level B', a);
    const c = await create('Level C', b);
    for (const parentId of [a, b, c]) {
      const res = await t.call('PATCH', `${G}/${a}`, { parentId });
      expect(res.status, parentId).toBe(422);
      expect(res.body.error.details[0].path).toBe('parentId');
    }
    // Moving the leaf to the top is fine.
    expect((await t.call('PATCH', `${G}/${c}`, { parentId: null })).body.parentId).toBeNull();
  });
});

describe('parties in groups', () => {
  it('counts typed parties and workspace clients together; renaming keeps them', async () => {
    const g = await create('Counted');
    const p = await t.call('POST', '/v1/parties', { name: 'Ravi Traders', groupId: g });
    expect(p.status, p.text).toBe(201);
    expect(p.body.groupId).toBe(g);
    await t.call('POST', `${W}/collections/clients`, { id: 'cli_g1', name: 'Om', groupId: g });
    await t.call('POST', `${W}/collections/clients`, { id: 'cli_g2', name: 'Sri', groupId: g });
    expect(await countOf(g)).toBe(3);
    await t.call('PATCH', `${G}/${g}`, { name: 'Counted (renamed)' });
    expect((await t.call('GET', `/v1/parties/${p.body.id}`)).body.groupId).toBe(g);
    expect(await countOf(g)).toBe(3);
  });

  it('refuses a party in a group that does not exist', async () => {
    const res = await t.call('POST', '/v1/parties', {
      name: 'Lost',
      groupId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(422);
  });

  it('filters the party list by a group and its children', async () => {
    const top = await create('Filter Top');
    const sub = await create('Filter Sub', top);
    await t.call('POST', '/v1/parties', { name: 'In top', groupId: top });
    await t.call('POST', '/v1/parties', { name: 'In sub', groupId: sub });
    await t.call('POST', '/v1/parties', { name: 'In none' });
    const names = async (groupId: string) =>
      (await t.call('GET', `/v1/parties?groupId=${groupId}`)).body.data.map((p: any) => p.name);
    expect((await names(top)).sort()).toEqual(['In sub', 'In top']);
    expect(await names(sub)).toEqual(['In sub']);
  });
});

describe('delete', () => {
  it('deletes an empty group', async () => {
    const id = await create('Empty');
    expect((await t.call('DELETE', `${G}/${id}`)).body).toEqual({ ok: true });
    expect((await list()).some((g) => g.id === id)).toBe(false);
    // The name is free again once the group is in the trash.
    await create('Empty');
  });

  it('refuses a group that parties or child groups use', async () => {
    const id = await create('Busy');
    await t.call('POST', '/v1/parties', { name: 'Busy 1', groupId: id });
    await t.call('POST', `${W}/collections/clients`, { id: 'cli_b1', name: 'Busy 2', groupId: id });
    await create('Busy child', id);
    const res = await t.call('DELETE', `${G}/${id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('2 parties and 1 group use this group. Move them first');
    expect(res.body.error.details).toEqual({ partyCount: 2, childCount: 1 });
  });

  it('with moveTo, moves parties (both stores) and child groups, then deletes, in one go', async () => {
    const from = await create('Move from');
    const to = await create('Move to');
    const child = await create('Move child', from);
    const p = (await t.call('POST', '/v1/parties', { name: 'Mover', groupId: from })).body.id;
    await t.call('POST', `${W}/collections/clients`, {
      id: 'cli_m1',
      name: 'Mover 2',
      groupId: from,
    });
    const res = await t.call('DELETE', `${G}/${from}?moveTo=${to}`);
    expect(res.status, res.text).toBe(200);
    expect((await t.call('GET', `/v1/parties/${p}`)).body.groupId).toBe(to);
    const doc = (await t.call('GET', `${W}/collections/clients`)).body.find(
      (c: any) => c.id === 'cli_m1',
    );
    expect(doc.groupId).toBe(to);
    const groups = await list();
    expect(groups.find((g) => g.id === child)?.parentId).toBe(to);
    expect(groups.find((g) => g.id === to)?.partyCount).toBe(2);
    expect(groups.some((g) => g.id === from)).toBe(false);
  });

  it('refuses to move into the group being deleted or one of its children, and changes nothing', async () => {
    const from = await create('Bad move');
    const child = await create('Bad move child', from);
    await t.call('POST', '/v1/parties', { name: 'Stays', groupId: from });
    for (const moveTo of [from, child]) {
      expect((await t.call('DELETE', `${G}/${from}?moveTo=${moveTo}`)).status).toBe(422);
    }
    expect(await countOf(from)).toBe(1);
  });

  it('a deleted group is gone for PATCH and DELETE', async () => {
    const id = await create('Gone');
    await t.call('DELETE', `${G}/${id}`);
    expect((await t.call('PATCH', `${G}/${id}`, { name: 'x' })).status).toBe(404);
    expect((await t.call('DELETE', `${G}/${id}`)).status).toBe(404);
  });
});

describe('permissions', () => {
  it('a viewer can list groups but not change them', async () => {
    const viewer = await h.addMember(t, 'viewer');
    expect((await viewer.call('GET', G)).status).toBe(200);
    expect((await viewer.call('POST', G, { name: 'Nope' })).status).toBe(403);
  });
});

describe('isolation', () => {
  it("org B can not see, change, delete or use org A's groups", async () => {
    const b = await h.newTenant();
    const id = await create('Secret group');
    expect((await list(b)).some((g) => g.id === id)).toBe(false);
    expect((await b.call('PATCH', `${G}/${id}`, { name: 'Hijacked' })).status).toBe(404);
    expect((await b.call('DELETE', `${G}/${id}`)).status).toBe(404);
    expect((await b.call('POST', G, { name: 'Child', parentId: id })).status).toBe(422);
    expect((await b.call('POST', '/v1/parties', { name: 'Sneaky', groupId: id })).status).toBe(422);
    // Same name in another organization is fine.
    expect((await b.call('POST', G, { name: 'Secret group' })).status).toBe(201);
  });
});
