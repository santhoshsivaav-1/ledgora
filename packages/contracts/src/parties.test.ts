import { describe, expect, it } from 'vitest';
import {
  partyGroup,
  partyGroupDeleteQuery,
  partyGroupInput,
  partyGroupPatch,
  partyInput,
  partyPatch,
} from './index.ts';

const id = '7d3c1b8e-2f4a-4c6d-9e1f-0a2b3c4d5e6f';

describe('partyGroupInput (P1-S1)', () => {
  it('trims the name and defaults the parent to none', () => {
    expect(partyGroupInput.parse({ name: '  Wholesale ' })).toEqual({ name: 'Wholesale' });
  });
  it('accepts a parent id, or null for top level', () => {
    expect(partyGroupInput.parse({ name: 'Chennai', parentId: id }).parentId).toBe(id);
    expect(partyGroupInput.parse({ name: 'Retail', parentId: null }).parentId).toBeNull();
  });
  it('rejects an empty, blank or over-long name', () => {
    expect(partyGroupInput.safeParse({ name: '' }).success).toBe(false);
    expect(partyGroupInput.safeParse({ name: '   ' }).success).toBe(false);
    expect(partyGroupInput.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    expect(partyGroupInput.safeParse({ name: 'x'.repeat(80) }).success).toBe(true);
  });
  it('rejects a parent that is not a uuid', () => {
    expect(partyGroupInput.safeParse({ name: 'A', parentId: 'retail' }).success).toBe(false);
  });
});

describe('partyGroupPatch', () => {
  it('lets a rename leave the parent alone', () => {
    expect(partyGroupPatch.parse({ name: 'Retail (TN)' })).toEqual({ name: 'Retail (TN)' });
  });
  it('can move a group to the top level', () => {
    expect(partyGroupPatch.parse({ parentId: null })).toEqual({ parentId: null });
  });
});

describe('partyGroup', () => {
  it('carries the id, the party count and the stamps', () => {
    const g = partyGroup.parse({
      id,
      name: 'Retail',
      parentId: null,
      partyCount: 24,
      createdAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z',
    });
    expect(g.partyCount).toBe(24);
  });
});

describe('partyGroupDeleteQuery', () => {
  it('takes an optional moveTo group', () => {
    expect(partyGroupDeleteQuery.parse({})).toEqual({});
    expect(partyGroupDeleteQuery.parse({ moveTo: id })).toEqual({ moveTo: id });
    expect(partyGroupDeleteQuery.safeParse({ moveTo: 'nope' }).success).toBe(false);
  });
});

describe('partyInput.groupId', () => {
  it('is optional so old clients keep working', () => {
    expect(partyInput.parse({ name: 'Ravi Traders' }).groupId).toBeUndefined();
  });
  it('accepts a group, or null to take the party out of its group', () => {
    expect(partyInput.parse({ name: 'Ravi Traders', groupId: id }).groupId).toBe(id);
    expect(partyPatch.parse({ groupId: null })).toEqual({ groupId: null });
    expect(partyInput.safeParse({ name: 'Ravi Traders', groupId: 'retail' }).success).toBe(false);
  });
});
