// P9-S6 online catalog. The owner turns it on, picks an address (/c/<slug>), a title and the WhatsApp number enquiries
// go to; items marked "Show in catalog" on the Products screen are listed. The public page needs no sign-in and shows
// only name, description, unit, picture, and (by choice) price and whether it is in stock: never costs, stock counts,
// parties or anything else. A business whose plan no longer includes the catalog stops serving it.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, withTenant } from '@ledgora/db';
import { catalogSettings, planAllows } from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { planOf } from '../middleware/feature.ts';
import { loadBusiness } from './businesses.ts';
import { listDocs } from './workspace/store.ts';

const { publicCatalogs } = schema;

export function catalogModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/catalog',
    tag: 'Grow',
    summary: "This organization's online catalog settings",
    permission: 'business:read',
    handler: async ({ deps, orgId }) => {
      const [row] = await deps.db
        .select()
        .from(publicCatalogs)
        .where(eq(publicCatalogs.orgId, orgId));
      return { catalog: row ?? null };
    },
  });

  route({
    method: 'put',
    path: '/v1/catalog',
    tag: 'Grow',
    summary: 'Turn the online catalog on or off and set its address, title and WhatsApp number',
    permission: 'settings:write',
    body: catalogSettings,
    handler: async ({ tx, deps, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const [taken] = await deps.db
        .select()
        .from(publicCatalogs)
        .where(eq(publicCatalogs.slug, body.slug));
      if (taken && taken.orgId !== orgId)
        throw new AppError('conflict', 'This address is taken. Try another');
      const values = { ...body, updatedAt: new Date() };
      await deps.db.delete(publicCatalogs).where(eq(publicCatalogs.orgId, orgId));
      await deps.db.insert(publicCatalogs).values({ ...values, orgId });
      await audit(tx, orgId, 'catalog.change', 'business', body.businessId, {
        after: { enabled: body.enabled, slug: body.slug },
      });
      return { catalog: { ...values, orgId } };
    },
  });

  route({
    method: 'get',
    path: '/v1/public/catalog/:slug',
    tag: 'Grow',
    summary: 'A public catalogue page: the business and the items it chose to show (no sign-in)',
    access: 'public',
    params: z.object({ slug: z.string().trim().toLowerCase().max(40) }),
    handler: async ({ deps, params }) => {
      const [cat] = await deps.db
        .select()
        .from(publicCatalogs)
        .where(eq(publicCatalogs.slug, params.slug));
      if (!cat || !cat.enabled) throw notFound('Catalog');
      if (!planAllows((await planOf(deps.db, cat.orgId)).plan, 'catalog_offers'))
        throw notFound('Catalog');
      const products = await withTenant(deps.db, cat.orgId, (tx) => listDocs(tx, 'products'));
      const items = products
        .filter((p) => p.showInCatalog === true)
        .map((p) => ({
          id: String(p.id),
          name: String(p.name ?? ''),
          description: String(p.description ?? ''),
          unit: String(p.unit ?? ''),
          image: typeof p.image === 'string' && p.image.startsWith('data:image/') ? p.image : null,
          ...(cat.showPrice
            ? { price: Number(p.sellingPrice ?? p.rate) || 0, mrp: Number(p.mrp) || null }
            : {}),
          ...(cat.showStock
            ? { inStock: p.trackStock === false || (Number(p.stock) || 0) > 0 }
            : {}),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { title: cat.title, whatsapp: cat.whatsapp, showPrice: cat.showPrice, items };
    },
  });
}
