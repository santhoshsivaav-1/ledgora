import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDb, type Database } from './client.ts';
import { withTenant } from './tenant.ts';
import * as s from './schema/index.ts';

/** Fixed ids so the web app, the tests and the docs can all point at the same demo organization. */
export const DEMO_ORG_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_BUSINESS_ID = '00000000-0000-4000-8000-0000000000b1';

const UNITS: [string, string][] = [
  ['PCS', 'Pieces'],
  ['NOS', 'Numbers'],
  ['KGS', 'Kilograms'],
  ['LTR', 'Litres'],
  ['MTR', 'Metres'],
  ['BOX', 'Boxes'],
  ['HRS', 'Hours'],
  ['SET', 'Sets'],
];

/** Idempotent for the demo org. Any other org id gets a fresh business each call (tests make many orgs). */
export async function seed(
  db: Database,
  orgId = DEMO_ORG_ID,
  businessId = orgId === DEMO_ORG_ID ? DEMO_BUSINESS_ID : randomUUID(),
) {
  await withTenant(db, orgId, async (tx) => {
    await tx
      .insert(s.organizations)
      .values({
        id: orgId,
        name: orgId === DEMO_ORG_ID ? 'Demo Organization' : `Org ${orgId.slice(0, 8)}`,
      })
      .onConflictDoNothing();
    await tx
      .insert(s.businesses)
      .values({
        id: businessId,
        orgId,
        name: 'Demo Traders',
        gstin: '33AAAAA0000A1Z5',
        state: 'Tamil Nadu',
        address: '1 Main Road, Salem',
        city: 'Salem',
        pin: '636001',
        isDefault: true,
      })
      .onConflictDoNothing();
    await tx.insert(s.businessSettings).values({ orgId, businessId }).onConflictDoNothing();
    await tx
      .insert(s.units)
      .values(UNITS.map(([code, name]) => ({ orgId, code, name })))
      .onConflictDoNothing();
    await tx
      .insert(s.expenseCategories)
      .values(
        ['Rent', 'Salaries', 'Utilities', 'Travel', 'Office supplies'].map((name) => ({
          orgId,
          name,
        })),
      )
      .onConflictDoNothing();
    const [{ n }] = (await tx.execute(
      sql`select count(*)::int as n from terms_templates where deleted_at is null`,
    )) as unknown as { n: number }[];
    if (!n) {
      await tx.insert(s.termsTemplates).values({
        orgId,
        name: 'Standard Terms',
        isDefault: true,
        content:
          '1. Payment is due within 15 days of the invoice date unless agreed otherwise.\n2. Goods once sold are not returnable.',
      });
    }
  });
  return { orgId, businessId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { db, close } = createDb(undefined, { max: 1 });
  try {
    const r = await seed(db);
    console.log(`Seeded demo organization ${r.orgId} with business ${r.businessId}.`);
  } finally {
    await close();
  }
}
