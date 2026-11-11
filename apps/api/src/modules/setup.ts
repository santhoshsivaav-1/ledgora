// Vyapar parity P7-S5: the Setup My Business checklist. Every row is a predicate over what is in the books (typed
// rows or the older screens' workspace documents, whichever the business uses), so it ticks itself. The only thing
// stored is that the owner dismissed the card (business_settings.preferences.setup.dismissed).
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import { utilityBusinessQuery } from '@ledgora/contracts';
import { DISMISS_AT, setupChecklist, type SetupFacts } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import type { Database, Tx } from '@ledgora/db';

const {
  businessSettings,
  paymentAccounts,
  items,
  parties,
  invoices,
  documents,
  member,
  backups,
  backupSettings,
} = schema;

const count = async (tx: Tx, q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
const n = sql<number>`count(*)::int`;

async function factsOf(
  tx: Tx,
  db: Database,
  orgId: string,
  biz: typeof schema.businesses.$inferSelect,
): Promise<SetupFacts> {
  const docs = (collection: string) =>
    count(
      tx,
      tx
        .select({ n })
        .from(documents)
        .where(and(eq(documents.collection, collection), isNull(documents.deletedAt))),
    );
  const members = await db.select({ n }).from(member).where(eq(member.organizationId, orgId));
  return {
    businessName: !!biz.name.trim(),
    gstinAndAddress: !!(biz.gstin && biz.address.trim()),
    bankAccount:
      (await count(
        tx,
        tx
          .select({ n })
          .from(paymentAccounts)
          .where(and(eq(paymentAccounts.businessId, biz.id), isNull(paymentAccounts.deletedAt))),
      )) > 0,
    item:
      (await count(tx, tx.select({ n }).from(items).where(isNull(items.deletedAt)))) +
        (await docs('products')) >
      0,
    party:
      (await count(tx, tx.select({ n }).from(parties).where(isNull(parties.deletedAt)))) +
        (await docs('clients')) >
      0,
    invoice:
      (await count(
        tx,
        tx
          .select({ n })
          .from(invoices)
          .where(and(eq(invoices.businessId, biz.id), isNull(invoices.deletedAt))),
      )) +
        (await docs('bills')) >
      0,
    teamMember: (members[0]?.n ?? 0) > 1,
    backup:
      (await count(
        tx,
        tx
          .select({ n })
          .from(backups)
          .where(and(ne(backups.kind, 'safety'), isNull(backups.deletedAt))),
      )) > 0 ||
      (await count(
        tx,
        tx.select({ n }).from(backupSettings).where(ne(backupSettings.frequency, 'off')),
      )) > 0,
  };
}
const dismissedIn = (s?: { preferences: unknown }) =>
  !!(s?.preferences as { setup?: { dismissed?: boolean } } | undefined)?.setup?.dismissed;

export function setupModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/setup/checklist',
    tag: 'Setup',
    summary:
      'The Setup My Business rows with what is done, the percentage and whether the card or the top-bar dot shows',
    query: utilityBusinessQuery,
    handler: async ({ tx, orgId, query, deps }) => {
      const biz = await loadBusiness(tx, query.businessId);
      const [s] = await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, biz.id));
      return setupChecklist(await factsOf(tx, deps.db, orgId, biz), dismissedIn(s));
    },
  });

  route({
    method: 'post',
    path: '/v1/setup/dismiss',
    tag: 'Setup',
    summary: `Hide the card (allowed from ${DISMISS_AT} of 8 rows done) or show it again`,
    body: z.object({ businessId: z.string().uuid(), dismissed: z.boolean() }),
    handler: async ({ tx, orgId, body, deps }) => {
      const biz = await loadBusiness(tx, body.businessId);
      if (body.dismissed && !setupChecklist(await factsOf(tx, deps.db, orgId, biz)).canDismiss)
        throw new AppError(
          'unprocessable',
          `Finish at least ${DISMISS_AT} steps before hiding the card`,
        );
      const [s] = await tx
        .select()
        .from(businessSettings)
        .where(eq(businessSettings.businessId, biz.id));
      const prev = (s?.preferences ?? {}) as Record<string, unknown>;
      const preferences = {
        ...prev,
        setup: { ...((prev.setup as object) ?? {}), dismissed: body.dismissed },
      };
      if (s)
        await tx
          .update(businessSettings)
          .set({ preferences, updatedAt: new Date() })
          .where(eq(businessSettings.id, s.id));
      else await tx.insert(businessSettings).values({ orgId, businessId: biz.id, preferences });
      await audit(tx, orgId, 'setup.dismiss', 'business', biz.id, {
        after: { dismissed: body.dismissed },
      });
      return { dismissed: body.dismissed };
    },
  });
}
