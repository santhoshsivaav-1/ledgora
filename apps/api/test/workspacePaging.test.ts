// Phase 3 (S6): the workspace lists page in SQL — cursor keyset on (sort key, created_at), filters on the expression
// indexes, and the order and shapes the screens already expect.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';

const h = makeHarness();
afterAll(() => h.close());
const W = '/v1/workspace';
let t: Tenant;

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

beforeAll(async () => {
  t = await h.newTenant();
  // 30 bills over three dates and two statuses, saved oldest first (insertion order matters for ties).
  for (let i = 1; i <= 30; i++) {
    const date = i <= 10 ? '2026-01-15' : i <= 20 ? '2026-02-15' : '2026-03-15';
    const status = i % 2 === 0 ? 'unpaid' : 'paid';
    const res = await t.call(
      'POST',
      `${W}/collections/bills`,
      bill(`INV-${String(i).padStart(3, '0')}`, {
        invoiceDate: date,
        status,
        clientName: i % 3 === 0 ? 'Beta Industries' : 'Acme',
      }),
    );
    expect(res.status, res.text).toBeLessThan(300);
  }
});

describe('paged workspace collections', () => {
  it('pages bills newest-first with a cursor that continues without repeating or skipping', async () => {
    const p1 = await t.call('GET', `${W}/collections/bills?limit=7`);
    expect(p1.status, p1.text).toBe(200);
    expect(p1.body.data).toHaveLength(7);
    // Newest date first; within a date, the order they were saved (the old stable sort's tie order).
    expect(p1.body.data[0].id).toBe('INV-021');
    expect(p1.body.nextCursor).toBeTruthy();
    // The whole list, page after page, is exactly the unpaged order.
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 6; i++) {
      const res = await t.call(
        'GET',
        `${W}/collections/bills?limit=7${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((b: { id: string }) => b.id));
      if (!res.body.nextCursor) break;
      cursor = res.body.nextCursor;
    }
    const all = await t.call('GET', `${W}/collections/bills`);
    expect(seen).toEqual(all.body.map((b: { id: string }) => b.id));
    // Newest date first; within one date, oldest saved first (the old stable sort's tie order).
    expect(seen.slice(0, 3)).toEqual(['INV-021', 'INV-022', 'INV-023']);
    expect(seen[9]).toBe('INV-030'); // the 2026-03-15 group ends with the last-saved of that date
  });

  it('filters by status, date range and search in SQL, and pages the filtered result', async () => {
    const unpaid = await t.call('GET', `${W}/collections/bills?limit=5&status=unpaid`);
    expect(unpaid.body.data.every((b: { status: string }) => b.status === 'unpaid')).toBe(true);
    expect(unpaid.body.data).toHaveLength(5); // 15 unpaid in total, so there is another page
    expect(unpaid.body.nextCursor).toBeTruthy();

    const feb = await t.call(
      'GET',
      `${W}/collections/bills?limit=500&from=2026-02-01&to=2026-02-28`,
    );
    expect(feb.body.data).toHaveLength(10);
    expect(
      feb.body.data.every((b: { invoiceDate: string }) => b.invoiceDate === '2026-02-15'),
    ).toBe(true);

    const beta = await t.call('GET', `${W}/collections/bills?limit=500&q=beta`);
    expect(beta.body.data).toHaveLength(10);
    expect(
      beta.body.data.every((b: { clientName: string }) => b.clientName === 'Beta Industries'),
    ).toBe(true);

    const both = await t.call(
      'GET',
      `${W}/collections/bills?limit=4&status=unpaid&q=beta&from=2026-01-01&to=2026-03-30`,
    );
    expect(
      both.body.data.every(
        (b: { status: string; clientName: string }) =>
          b.status === 'unpaid' && b.clientName === 'Beta Industries',
      ),
    ).toBe(true);
  });

  it('pages clients A→Z and profiles by business name', async () => {
    for (const name of ['Zed Ltd', 'Alpha Traders', 'Midway'])
      await t.call('POST', `${W}/collections/clients`, { name });
    const p1 = await t.call('GET', `${W}/collections/clients?limit=2`);
    expect(p1.body.data.map((c: { name: string }) => c.name)).toEqual(['Alpha Traders', 'Midway']);
    const p2 = await t.call('GET', `${W}/collections/clients?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.data.map((c: { name: string }) => c.name)).toEqual(['Zed Ltd']);
    expect(p2.body.nextCursor).toBe(null);
  });

  it('an account with "own transactions only" pages only its own bills', async () => {
    await t.call('PUT', '/v1/roles/biller', {
      permissions: ['invoice:read', 'invoice:write', 'party:read', 'item:read'],
      ownOnly: true,
    });
    const member = await h.addMember(t, 'biller');
    await member.call(
      'POST',
      `${W}/collections/bills`,
      bill('INV-MINE', { invoiceDate: '2026-04-01' }),
    );
    const page = await member.call('GET', `${W}/collections/bills?limit=5`);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0].id).toBe('INV-MINE');
    expect(page.body.nextCursor).toBe(null);
  });

  it('a 50,000 invoice list opens from the index in well under a second', async () => {
    // Rehearsal-scale insert straight into the store (the API route is one row per call); the read path under test is
    // the same one the screens use.
    await withTenant(h.db, t.orgId, async (tx) => {
      const rows: { orgId: string; collection: string; key: string; data: unknown }[] = [];
      for (let i = 0; i < 50_000; i++) {
        rows.push({
          orgId: t.orgId,
          collection: 'bills',
          key: `PERF-${i}`,
          data: {
            id: `PERF-${i}`,
            invoiceNumber: `PERF-${i}`,
            invoiceDate: `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            clientName: `Client ${i % 500}`,
            totalAmount: 118,
            status: i % 2 ? 'unpaid' : 'paid',
            payments: [],
          },
        });
      }
      for (let i = 0; i < rows.length; i += 2_000) {
        await tx.insert(schema.documents).values(rows.slice(i, i + 2_000) as never);
      }
    });
    const t0 = Date.now();
    const p1 = await t.call('GET', `${W}/collections/bills?limit=50`);
    const first = Date.now() - t0;
    expect(p1.body.data).toHaveLength(50);
    expect(first).toBeLessThan(500);
    // A filtered page is just as direct.
    const t1 = Date.now();
    const p2 = await t.call(
      'GET',
      `${W}/collections/bills?limit=50&status=unpaid&from=2026-06-01&to=2026-06-30`,
    );
    expect(Date.now() - t1).toBeLessThan(500);
    expect(p2.body.data.every((b: { status: string }) => b.status === 'unpaid')).toBe(true);
  });
});
