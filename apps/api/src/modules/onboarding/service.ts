import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema, seedOrgDefaults, type Database } from '@ledgora/db';

const TRIAL_DAYS = 14;

/**
 * Sign-up (change 2.6): a new user gets an organization, an owner membership, a first business and a 14-day trial,
 * all in one transaction, so a crash can never leave a user without a workspace (or a workspace without an owner).
 * Organizations and memberships are identity tables, written on the owner connection first; the rest is tenant data,
 * written after dropping to app_user with the new organization set, exactly as a request would.
 */
export async function onboardNewUser(
  db: Database,
  user: { id: string; name: string; email: string },
  now = new Date(),
) {
  const orgId = randomUUID();
  const businessId = randomUUID();
  const label = user.name.trim() || user.email.split('@')[0] || 'My';
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.organizations)
      .values({ id: orgId, name: `${label}'s Business`, slug: `org-${orgId.slice(0, 8)}` });
    await tx
      .insert(schema.member)
      .values({ id: randomUUID(), organizationId: orgId, userId: user.id, role: 'owner' });
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(sql`select set_config('app.actor_id', ${user.id}, true)`);
    await tx
      .insert(schema.businesses)
      .values({ id: businessId, orgId, name: `${label}'s Business`, isDefault: true });
    await tx.insert(schema.businessSettings).values({ orgId, businessId });
    await seedOrgDefaults(tx, orgId);
    await tx.insert(schema.subscriptions).values({
      orgId,
      plan: 'trial',
      status: 'trialing',
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
    });
    await tx.insert(schema.auditLog).values([
      {
        orgId,
        actorId: user.id,
        action: 'org.create',
        entityType: 'organization',
        entityId: orgId,
        after: { name: `${label}'s Business` },
      },
      {
        orgId,
        actorId: user.id,
        action: 'subscription.trial',
        entityType: 'subscription',
        entityId: null,
        after: { days: TRIAL_DAYS },
      },
    ]);
  });
  return { orgId, businessId };
}
