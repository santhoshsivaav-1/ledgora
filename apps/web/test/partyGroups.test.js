import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPartyGroup,
  deletePartyGroup,
  fieldError,
  groupPath,
  groupRows,
  listPartyGroups,
  moveTargets,
  parentChoices,
  updatePartyGroup,
} from '../src/lib/data/partyGroups';

// Vyapar parity P1-S1: the Party Groups data layer and the helpers the modal and picker use.

const g = (id, name, parentId = null, partyCount = 0) => ({ id, name, parentId, partyCount });
const groups = [
  g('r', 'Retail', null, 24),
  g('c', 'Chennai', 'r', 10),
  g('m', 'Madurai', 'r', 14),
  g('w', 'Wholesale', null, 12),
];

describe('groupRows', () => {
  it('lists the tree with depths', () => {
    expect(groupRows(groups).map((x) => `${x.depth}${x.name}`)).toEqual([
      '0Retail',
      '1Chennai',
      '1Madurai',
      '0Wholesale',
    ]);
  });
  it('a search keeps each match with the groups above it', () => {
    expect(groupRows(groups, 'madu').map((x) => x.name)).toEqual(['Retail', 'Madurai']);
    expect(groupRows(groups, 'WHOLE').map((x) => x.name)).toEqual(['Wholesale']);
    expect(groupRows(groups, 'zzz')).toEqual([]);
  });
});

describe('groupPath, parentChoices, moveTargets', () => {
  it('names a group with its parents', () => {
    expect(groupPath(groups, 'c')).toBe('Retail › Chennai');
    expect(groupPath(groups, 'w')).toBe('Wholesale');
    expect(groupPath(groups, 'missing')).toBe('');
  });
  it('never offers a group or its children as its own parent', () => {
    expect(parentChoices(groups, 'r').map((x) => x.id)).toEqual(['w']);
    expect(parentChoices(groups, 'c').map((x) => x.id)).toEqual(['r', 'm', 'w']);
    expect(parentChoices(groups, null)).toHaveLength(4);
  });
  it('moves parties only outside the group being deleted', () => {
    expect(moveTargets(groups, 'r').map((x) => x.id)).toEqual(['w']);
  });
});

describe('fieldError', () => {
  it('reads the message for one field from zod-style details', () => {
    const err = { details: [{ path: 'parentId', message: 'Parent group not found' }] };
    expect(fieldError(err, 'parentId')).toBe('Parent group not found');
    expect(fieldError(err, 'name')).toBe('');
    expect(fieldError({ details: { partyCount: 2 } }, 'name')).toBe('');
  });
});

describe('API calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (status, body) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const call = (fetch) => {
    const [url, init] = fetch.mock.calls[0];
    return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
  };

  it('lists, creates, renames and deletes on /v1/party-groups', async () => {
    let f = stub(200, { data: groups, nextCursor: null });
    expect(await listPartyGroups()).toEqual(groups);
    expect(call(f)).toMatchObject({ url: '/v1/party-groups', method: 'GET' });

    f = stub(201, g('n', 'New'));
    await createPartyGroup({ name: 'New', parentId: null });
    expect(call(f)).toEqual({
      url: '/v1/party-groups',
      method: 'POST',
      body: { name: 'New', parentId: null },
    });

    f = stub(200, g('n', 'Renamed'));
    await updatePartyGroup('n', { name: 'Renamed' });
    expect(call(f)).toEqual({
      url: '/v1/party-groups/n',
      method: 'PATCH',
      body: { name: 'Renamed' },
    });

    f = stub(200, { ok: true });
    await deletePartyGroup('n');
    expect(call(f)).toMatchObject({ url: '/v1/party-groups/n', method: 'DELETE' });

    f = stub(200, { ok: true });
    await deletePartyGroup('n', 'w');
    expect(call(f).url).toBe('/v1/party-groups/n?moveTo=w');
  });

  it('surfaces the in-use refusal with its message and status', async () => {
    stub(409, {
      error: {
        code: 'conflict',
        message: '12 parties use this group. Move them first',
        details: { partyCount: 12, childCount: 0 },
      },
    });
    await expect(deletePartyGroup('r')).rejects.toMatchObject({
      status: 409,
      message: '12 parties use this group. Move them first',
    });
  });
});
