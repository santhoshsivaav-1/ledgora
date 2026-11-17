// The platform admin page: for the people who run this installation (PLATFORM_ADMIN_EMAILS), not for customers. One read-only list
// of every organization with its owner's e-mail, plan and subscription state, and the counts by plan and status.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@ledgora/db';
import { effectivePlan } from '@ledgora/contracts';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';
import type { Registrar } from '../http.ts';
import type { SessionUser } from '../middleware/context.ts';

const { subscriptions, subscriptionInvoices, organizations, member, user, businesses } = schema;

/**
 * Only a confirmed e-mail on the list counts: where e-mail confirmation is switched off anyone could sign up with an admin's
 * address, so the page is closed there.
 */
export function isPlatformAdmin(
  env: Pick<AppEnv, 'PLATFORM_ADMIN_EMAILS' | 'REQUIRE_EMAIL_VERIFICATION'>,
  u: Pick<SessionUser, 'email' | 'emailVerified'>,
) {
  if (!env.REQUIRE_EMAIL_VERIFICATION || !u.emailVerified) return false;
  const list = env.PLATFORM_ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(u.email.trim().toLowerCase());
}

export function platformModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/platform/overview',
    tag: 'Platform',
    summary:
      'Every organization with its owner, plan and subscription state, and the counts by plan (platform admins only)',
    access: 'session',
    handler: async ({ auth, deps }) => {
      if (!isPlatformAdmin(deps.env, auth.user))
        throw new AppError('forbidden', 'This page is for the people who run the service');
      // Subscriptions and invoices are tenant tables: read them all through the scheduler policy, read-only.
      const { subs, invoices, biz } = await deps.db.transaction(async (tx) => {
        await tx.execute(sql`set local role app_user`);
        await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
        return {
          biz: await tx
            .select({
              orgId: businesses.orgId,
              name: businesses.name,
              gstin: businesses.gstin,
              state: businesses.state,
            })
            .from(businesses)
            .where(isNull(businesses.deletedAt))
            .orderBy(asc(businesses.createdAt)),
          subs: await tx.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)),
          invoices: await tx
            .select({
              orgId: subscriptionInvoices.orgId,
              n: sql<number>`count(*)::int`,
              total: sql<number>`coalesce(sum(${subscriptionInvoices.total}), 0)::float`,
            })
            .from(subscriptionInvoices)
            .groupBy(subscriptionInvoices.orgId),
        };
      });
      const latest = new Map<string, (typeof subs)[number]>();
      for (const s of subs) if (!latest.has(s.orgId)) latest.set(s.orgId, s);
      const orgIds = [...latest.keys()];
      const orgs = orgIds.length
        ? await deps.db
            .select({
              id: organizations.id,
              name: organizations.name,
              createdAt: organizations.createdAt,
            })
            .from(organizations)
            .where(inArray(organizations.id, orgIds))
            .orderBy(asc(organizations.createdAt))
        : [];
      const owners = orgIds.length
        ? await deps.db
            .select({
              orgId: member.organizationId,
              email: user.email,
              name: user.name,
              verified: user.emailVerified,
              phone: user.phoneNumber,
            })
            .from(member)
            .innerJoin(user, eq(user.id, member.userId))
            .where(and(inArray(member.organizationId, orgIds), eq(member.role, 'owner')))
        : [];
      const ownerOf = new Map(owners.map((o) => [o.orgId, o]));
      const bizOf = new Map<string, { name: string; gstin: string; state: string }[]>();
      for (const b of biz)
        bizOf.set(b.orgId, [
          ...(bizOf.get(b.orgId) ?? []),
          { name: b.name, gstin: b.gstin ?? '', state: b.state },
        ]);
      const paid = new Map(invoices.map((i) => [i.orgId, i]));
      const now = new Date();
      const rows = orgs.map((o) => {
        const s = latest.get(o.id)!;
        const eff = effectivePlan(s, now);
        const ow = ownerOf.get(o.id);
        return {
          organizationId: o.id,
          organization: o.name,
          ownerName: ow?.name ?? '',
          ownerEmail: ow?.email?.endsWith('.invalid') ? '' : (ow?.email ?? ''),
          ownerPhone: ow?.phone ?? '',
          emailConfirmed: !!ow?.verified,
          signedUp: o.createdAt.toISOString(),
          plan: eff.plan,
          planLabel: eff.label,
          status: s.status,
          trial: eff.trial,
          trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
          interval: s.billingInterval,
          locked: eff.locked,
          businessCount: bizOf.get(o.id)?.length ?? 0,
          businesses: bizOf.get(o.id) ?? [],
          invoices: paid.get(o.id)?.n ?? 0,
          paidTotal: paid.get(o.id)?.total ?? 0,
        };
      });
      const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
      return {
        totals: {
          accounts: rows.length,
          // Businesses, not organizations: one account can run several. 'withGstin' are the registered ones.
          businesses: biz.length,
          businessesWithGstin: biz.filter((b) => b.gstin).length,
          onTrial: count((r) => r.trial),
          paying: count((r) => r.status === 'active' && r.plan !== 'free' && !r.trial),
          free: count((r) => r.plan === 'free' && !r.trial && r.status !== 'pending'),
          notChosen: count((r) => r.status === 'pending'),
          pastDue: count((r) => r.status === 'past_due'),
          cancelled: count((r) => r.status === 'canceled'),
          silver: count((r) => r.plan === 'silver' && !r.trial),
          gold: count((r) => r.plan === 'gold' && !r.trial),
          revenue: rows.reduce((a, r) => a + r.paidTotal, 0),
        },
        rows: rows.reverse(),
      };
    },
  });
}
