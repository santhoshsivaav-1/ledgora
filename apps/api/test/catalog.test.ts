import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { makeHarness } from './helpers.ts';
import { forgetPlan } from '../src/middleware/feature.ts';

// P9-S6 online catalog: owner settings, the public page, and what it never shows.
const h = makeHarness();
afterAll(() => h.close());
const pub = (slug: string) =>
  h.app
    .request(`/v1/public/catalog/${slug}`)
    .then(async (r) => ({ status: r.status, body: await r.json() }));

describe('online catalog', () => {
  it('lists only the items marked for it, without costs; off or unknown answers 404; addresses are unique', async () => {
    const t = await h.newTenant();
    const slug = `shop-${t.orgId.slice(0, 8)}`;
    await t.call('POST', '/v1/workspace/collections/products', {
      id: 'p1',
      name: 'Kurta',
      sellingPrice: 799,
      purchasePrice: 400,
      stock: 3,
      showInCatalog: true,
    });
    await t.call('POST', '/v1/workspace/collections/products', {
      id: 'p2',
      name: 'Secret',
      sellingPrice: 10,
      stock: 9,
    });
    expect((await pub(slug)).status).toBe(404);
    const put = await t.call('PUT', '/v1/catalog', {
      businessId: t.businessId,
      enabled: true,
      slug,
      title: 'Asha Fashions',
      whatsapp: '+919876543210',
    });
    expect(put.status, put.text).toBe(200);
    const page = await pub(slug);
    expect(page.status).toBe(200);
    expect(page.body.title).toBe('Asha Fashions');
    expect(page.body.items).toEqual([
      {
        id: 'p1',
        name: 'Kurta',
        description: '',
        unit: '',
        image: null,
        price: 799,
        mrp: null,
        inStock: true,
      },
    ]);
    expect(JSON.stringify(page.body)).not.toMatch(/400|purchasePrice|Secret/);
    const other = await h.newTenant();
    expect(
      (
        await other.call('PUT', '/v1/catalog', {
          businessId: other.businessId,
          enabled: true,
          slug,
        })
      ).status,
    ).toBe(409);
    await t.call('PUT', '/v1/catalog', {
      businessId: t.businessId,
      enabled: true,
      slug,
      showPrice: false,
      showStock: false,
    });
    expect((await pub(slug)).body.items[0]).toEqual({
      id: 'p1',
      name: 'Kurta',
      description: '',
      unit: '',
      image: null,
    });
    await t.call('PUT', '/v1/catalog', { businessId: t.businessId, enabled: false, slug });
    expect((await pub(slug)).status).toBe(404);
  });

  it('a plan without the catalog stops serving it and can not turn it on', async () => {
    const t = await h.newTenant();
    const slug = `free-${t.orgId.slice(0, 8)}`;
    await t.call('PUT', '/v1/catalog', { businessId: t.businessId, enabled: true, slug });
    expect((await pub(slug)).status).toBe(200);
    await withTenant(h.db, t.orgId, (tx) =>
      tx.execute(sql.raw(`update subscriptions set trial_ends_at = now() - interval '1 day'`)),
    );
    forgetPlan(t.orgId);
    expect((await pub(slug)).status).toBe(404);
    expect(
      (await t.call('PUT', '/v1/catalog', { businessId: t.businessId, enabled: true, slug }))
        .status,
    ).toBe(402);
  });
});
