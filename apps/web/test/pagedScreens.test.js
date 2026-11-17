import { describe, expect, it } from 'vitest';
// Audit Phase 3: cursor-paginated lists. The Returns screen and the Clients
// screen now page through the workspace collections (50–200 docs a page) and
// scope the load to the return period, instead of loading whole collections
// and filtering in the browser. These are the pure pieces of that work — the
// period range builder, the page-accumulation loop and the query builder —
// tested the same way as the rest of the suite (vitest, node, no DOM).
import { collectPages, pagedCollectionQuery, periodDateRange } from '../src/features/gst-returns/gstHelpers';

describe('periodDateRange', () => {
  it('bounds a month period, including short and leap months', () => {
    expect(periodDateRange({ mode: 'month', year: '2026', month: '0' })).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(periodDateRange({ mode: 'month', year: '2026', month: '1' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodDateRange({ mode: 'month', year: '2024', month: '1' })).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(periodDateRange({ mode: 'month', year: '2025', month: '11' })).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('bounds a GST quarter (Q1 is April–June, Q4 spans the year end)', () => {
    expect(periodDateRange({ mode: 'quarter', year: '2026', quarter: 'Q1' })).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodDateRange({ mode: 'quarter', year: '2026', quarter: 'Q4' })).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('takes the FY option’s own from/to', () => {
    expect(periodDateRange({ mode: 'fy', fy: { value: '2025-26', from: '2025-04-01', to: '2026-03-31' } }))
      .toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('returns null for an unresolved period, which the caller fetches unfiltered', () => {
    expect(periodDateRange(null)).toBeNull();
    expect(periodDateRange({ mode: 'fy', fy: undefined })).toBeNull(); // no FY option picked yet
    expect(periodDateRange({ mode: 'quarter', year: '2026', quarter: 'Q9' })).toBeNull();
    // The screen's month filter starts empty before the defaults are applied.
    expect(periodDateRange({ mode: 'month', year: '2026', month: '' })).toBeNull();
  });
});

describe('pagedCollectionQuery', () => {
  it('emits only the params that are set', () => {
    expect(pagedCollectionQuery({})).toBe('');
    expect(pagedCollectionQuery({ limit: 50 })).toBe('?limit=50');
    expect(pagedCollectionQuery({ limit: 200, cursor: 'abc', from: '2026-04-01', to: '2026-06-30' }))
      .toBe('?limit=200&cursor=abc&from=2026-04-01&to=2026-06-30');
    expect(pagedCollectionQuery({ limit: 50, q: 'sharma' })).toBe('?limit=50&q=sharma');
    expect(pagedCollectionQuery({ limit: 50, status: 'unpaid' })).toBe('?limit=50&status=unpaid');
  });

  it('skips empty-string filters so the URL stays as short as the request needs', () => {
    expect(pagedCollectionQuery({ limit: 50, cursor: '', q: '', status: '', from: '', to: '' })).toBe('?limit=50');
  });
});

describe('collectPages', () => {
  const range = (n, start = 0) => Array.from({ length: n }, (_, i) => start + i);

  it('follows the cursor until it runs out, feeding every page through', async () => {
    const pages = [range(3), range(3, 3), range(2, 6)];
    let calls = 0;
    const fetchPage = async ({ limit, cursor }) => {
      expect(limit).toBe(200);
      expect(cursor).toBe(calls === 0 ? null : `c${calls - 1}`);
      const i = calls++;
      return { data: pages[i], nextCursor: i < pages.length - 1 ? `c${i}` : null };
    };
    await expect(collectPages(fetchPage)).resolves.toEqual(range(8));
    expect(calls).toBe(3);
  });

  it('stops after one page when the response is a plain array (server without limit/cursor)', async () => {
    let calls = 0;
    const fetchPage = async () => { calls += 1; return [1, 2, 3]; };
    await expect(collectPages(fetchPage)).resolves.toEqual([1, 2, 3]);
    expect(calls).toBe(1);
  });

  it('accepts a paged response with no nextCursor (single page, new shape)', async () => {
    const fetchPage = async () => ({ data: [1, 2], nextCursor: null });
    await expect(collectPages(fetchPage)).resolves.toEqual([1, 2]);
  });

  it('does not spin forever on a server that keeps returning the same cursor', async () => {
    const fetchPage = async () => ({ data: [1], nextCursor: 'stuck' });
    await expect(collectPages(fetchPage)).resolves.toEqual(Array(1000).fill(1));
  });

  it('handles null data pages and missing page objects', async () => {
    const fetchPage = async ({ cursor }) => (cursor ? null : { data: null, nextCursor: 'c1' });
    await expect(collectPages(fetchPage)).resolves.toEqual([]);
  });
});
