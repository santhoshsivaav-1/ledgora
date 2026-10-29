import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, withTenant } from '@ledgora/db';
import { line, makeHarness, type Tenant } from './helpers.ts';

const h = makeHarness();
let a: Tenant;
let b: Tenant;
let partyA: string;
let invoiceA: string;
let itemA: string;

beforeAll(async () => {
  a = await h.newTenant();
  b = await h.newTenant();
  partyA = (await a.call('POST', '/v1/parties', { name: 'Alpha Customer', state: 'Tamil Nadu' }))
    .body.id;
  itemA = (await a.call('POST', '/v1/items', { name: 'Alpha Item', openingStock: 10 })).body.id;
  invoiceA = (
    await a.call('POST', '/v1/invoices', {
      businessId: a.businessId,
      partyId: partyA,
      invoiceDate: '2026-10-01',
      items: [line()],
    })
  ).body.id;
});
afterAll(() => h.close());

describe('row-level security in the database', () => {
  it('a plain owner connection without a tenant sees nothing (policies are FORCEd)', async () => {
    const rows = await h.sql`select id from parties`;
    expect(rows.length).toBe(0);
  });

  it('withTenant shows only that organization', async () => {
    const seenByA = await withTenant(h.db, a.orgId, (tx) => tx.select().from(schema.parties));
    const seenByB = await withTenant(h.db, b.orgId, (tx) => tx.select().from(schema.parties));
    expect(seenByA.map((p) => p.name)).toEqual(['Alpha Customer']);
    expect(seenByB).toEqual([]);
  });

  it('app_user without app.org_id set matches no rows', async () => {
    const rows = await h.db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return tx.select().from(schema.invoices);
    });
    expect(rows).toEqual([]);
  });

  it('writing a row for another organization is refused by the policy', async () => {
    await expect(
      withTenant(h.db, b.orgId, (tx) =>
        tx.insert(schema.parties).values({ orgId: a.orgId, name: 'Smuggled' }),
      ),
    ).rejects.toThrow();
  });

  it('an UPDATE or DELETE aimed at another organization touches zero rows', async () => {
    const touched = await withTenant(h.db, b.orgId, async (tx) => {
      const u = await tx
        .update(schema.parties)
        .set({ name: 'Hacked' })
        .returning({ id: schema.parties.id });
      const d = await tx.delete(schema.invoices).returning({ id: schema.invoices.id });
      return [u.length, d.length];
    });
    expect(touched).toEqual([0, 0]);
  });

  it('a foreign key can not point at another organization row (composite org_id keys)', async () => {
    await expect(
      withTenant(h.db, b.orgId, (tx) =>
        tx.insert(schema.invoices).values({
          orgId: b.orgId,
          businessId: b.businessId,
          partyId: partyA,
          number: 'X/1',
          invoiceDate: '2026-10-01',
        }),
      ),
    ).rejects.toThrow();
  });

  it('the setting does not leak between pooled connections', async () => {
    await withTenant(h.db, a.orgId, async () => undefined);
    const rows = await h.sql`select current_setting('app.org_id', true) as v`;
    expect(rows[0].v ?? '').toBe('');
  });

  it('withTenant refuses anything that is not a UUID', async () => {
    await expect(withTenant(h.db, "x'; drop table parties; --", async () => 1)).rejects.toThrow(
      /UUID/,
    );
  });
});

describe('isolation through the API', () => {
  it('lists never include another organization', async () => {
    for (const path of [
      '/v1/parties',
      '/v1/items',
      '/v1/invoices',
      '/v1/payments',
      '/v1/purchases',
      '/v1/expenses',
      '/v1/recurring',
    ]) {
      const res = await b.call('GET', path);
      expect(res.status, path).toBe(200);
      expect(res.body.data, path).toEqual([]);
    }
    expect((await b.call('GET', '/v1/businesses')).body.data.map((x: any) => x.id)).toEqual([
      b.businessId,
    ]);
  });

  it('reads, edits and deletes of another organization record answer 404', async () => {
    expect((await b.call('GET', `/v1/parties/${partyA}`)).status).toBe(404);
    expect((await b.call('PATCH', `/v1/parties/${partyA}`, { name: 'x' })).status).toBe(404);
    expect((await b.call('DELETE', `/v1/parties/${partyA}`)).status).toBe(404);
    expect((await b.call('GET', `/v1/invoices/${invoiceA}`)).status).toBe(404);
    expect((await b.call('POST', `/v1/invoices/${invoiceA}/cancel`, {})).status).toBe(404);
    expect((await b.call('GET', `/v1/items/${itemA}`)).status).toBe(404);
    expect((await b.call('POST', `/v1/items/${itemA}/stock`, { quantity: 5 })).status).toBe(404);
    expect((await b.call('POST', `/v1/trash/${partyA}/restore`)).status).toBe(404);
  });

  it('a new record can not reference another organization party, item or business', async () => {
    const withParty = await b.call('POST', '/v1/invoices', {
      businessId: b.businessId,
      partyId: partyA,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    expect(withParty.status).toBe(404);
    const withItem = await b.call('POST', '/v1/invoices', {
      businessId: b.businessId,
      invoiceDate: '2026-10-01',
      items: [line({ itemId: itemA })],
    });
    expect(withItem.status).toBe(404);
    const withBusiness = await b.call('POST', '/v1/invoices', {
      businessId: a.businessId,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    expect(withBusiness.status).toBe(404);
    const pay = await b.call('POST', '/v1/payments', {
      businessId: b.businessId,
      partyId: partyA,
      amount: 10,
      paymentDate: '2026-10-02',
    });
    expect(pay.status).toBe(404);
  });

  it('stock movements and number series are per organization', async () => {
    const ia = await a.call('GET', `/v1/items/${itemA}`);
    expect(ia.body.stock).toBe(10);
    const seriesB = await b.call('GET', '/v1/number-series');
    expect(seriesB.body.data).toEqual([]);
    const first = await b.call('POST', '/v1/invoices', {
      businessId: b.businessId,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    expect(first.body.number).toMatch(/\/0001$/); // org B starts at 1 no matter how many org A issued
  });

  it('files of another organization can not be completed or downloaded', async () => {
    const up = await a.call('POST', '/v1/files/upload-url', {
      kind: 'attachment',
      fileName: 'a.txt',
      contentType: 'text/plain',
      sizeBytes: 3,
    });
    expect(up.status).toBe(201);
    expect((await b.call('POST', `/v1/files/${up.body.fileId}/complete`)).status).toBe(404);
    expect((await b.call('GET', `/v1/files/${up.body.fileId}/download-url`)).status).toBe(404);
  });

  it('requests without an organization are refused', async () => {
    const res = await h.app.request('/v1/parties');
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('unauthorized');
    const bad = await h.app.request('/v1/parties', { headers: { 'x-org-id': 'not-a-uuid' } });
    expect(bad.status).toBe(400);
    const unknown = await h.app.request('/v1/parties', { headers: { 'x-org-id': randomUUID() } });
    expect(unknown.status).toBe(200);
    expect(((await unknown.json()) as any).data).toEqual([]);
  });
});
