// P1-S1: the tree behind Party Groups (and, in P1-S4, Item Categories).
import { describe, it, expect } from 'vitest';
import { descendantIds, flattenTree, wouldCycle } from '../src/index.ts';

const g = (id, name, parentId = null) => ({ id, name, parentId });
const groups = [
  g('r', 'Retail'),
  g('c', 'Chennai', 'r'),
  g('m', 'Madurai', 'r'),
  g('t', 'T. Nagar', 'c'),
  g('w', 'Wholesale'),
  g('v', 'Vendors'),
];

describe('descendantIds', () => {
  it('collects children at every depth, not the node itself', () => {
    expect([...descendantIds(groups, 'r')].sort()).toEqual(['c', 'm', 't']);
    expect([...descendantIds(groups, 'c')]).toEqual(['t']);
    expect(descendantIds(groups, 'w').size).toBe(0);
  });

  it('stops on a cycle already in the data instead of looping', () => {
    const bad = [g('a', 'A', 'b'), g('b', 'B', 'a')];
    expect([...descendantIds(bad, 'a')].sort()).toEqual(['b']);
  });
});

describe('wouldCycle', () => {
  it('rejects the group itself as parent', () => {
    expect(wouldCycle(groups, 'r', 'r')).toBe(true);
  });
  it('rejects a descendant as parent', () => {
    expect(wouldCycle(groups, 'r', 't')).toBe(true);
    expect(wouldCycle(groups, 'c', 't')).toBe(true);
  });
  it('allows top level, a sibling, or an unrelated branch', () => {
    expect(wouldCycle(groups, 'c', null)).toBe(false);
    expect(wouldCycle(groups, 'c', 'm')).toBe(false);
    expect(wouldCycle(groups, 'r', 'w')).toBe(false);
  });
  it('allows anything for a group that does not exist yet', () => {
    expect(wouldCycle(groups, undefined, 'r')).toBe(false);
  });
});

describe('flattenTree', () => {
  it('lists parents before children, siblings by name, with a depth', () => {
    expect(flattenTree(groups).map((n) => `${n.depth}:${n.name}`)).toEqual([
      '0:Retail',
      '1:Chennai',
      '2:T. Nagar',
      '1:Madurai',
      '0:Vendors',
      '0:Wholesale',
    ]);
  });

  it('marks which rows have children', () => {
    const byId = Object.fromEntries(flattenTree(groups).map((n) => [n.id, n.hasChildren]));
    expect(byId).toMatchObject({ r: true, c: true, t: false, w: false });
  });

  it('shows an orphan (parent deleted or missing) at the top level', () => {
    const rows = flattenTree([g('x', 'Orphan', 'gone'), g('a', 'Alpha')]);
    expect(rows.map((n) => [n.name, n.depth])).toEqual([
      ['Alpha', 0],
      ['Orphan', 0],
    ]);
  });

  it('never drops a row caught in a cycle', () => {
    const rows = flattenTree([g('a', 'A', 'b'), g('b', 'B', 'a'), g('z', 'Z')]);
    expect(rows.map((n) => n.id).sort()).toEqual(['a', 'b', 'z']);
  });

  it('handles 200 groups three levels deep in well under 50 ms', () => {
    const many = [];
    for (let i = 0; i < 10; i++) {
      many.push(g(`a${i}`, `A ${i}`));
      for (let j = 0; j < 4; j++) {
        many.push(g(`a${i}b${j}`, `B ${j}`, `a${i}`));
        for (let k = 0; k < 4; k++) many.push(g(`a${i}b${j}c${k}`, `C ${k}`, `a${i}b${j}`));
      }
    }
    expect(many.length).toBe(210);
    const t0 = performance.now();
    const rows = flattenTree(many);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(rows).toHaveLength(210);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(2);
  });
});
