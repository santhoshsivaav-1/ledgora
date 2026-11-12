import { and, count, desc, eq, gt, gte, isNull } from 'drizzle-orm';
import { schema, withTenant, type Database, type Tx } from '@ledgora/db';
import {
  effectivePlan,
  featureForRoute,
  planAllows,
  planById,
  type Effective,
  type Feature,
} from '@ledgora/contracts';
import { AppError } from '../errors.ts';
import type { OrgContext } from './context.ts';

// Fourth link: the organization's plan (SaaS plans, contracts/plans.ts). A write to a feature the plan lacks, or past a
// plan limit, answers 402 payment_required with what is needed; the web app opens the upgrade sheet. Reads are never
// gated. The effective plan is cached per organization for 30 seconds; billing changes call forgetPlan.

const TTL = 30_000;
const cache = new Map<string, { at: number; eff: Effective }>();
export const forgetPlan = (orgId: string) => cache.delete(orgId);

/** The plan in force, read inside a request's own tenant transaction (a route handler has `tx`, not the database). */
export async function planOfTx(tx: Tx, now = new Date()) {
  const [sub] = await tx
    .select()
    .from(schema.subscriptions)
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);
  return effectivePlan(sub ?? null, now);
}

export async function planOf(db: Database, orgId: string, now = new Date()) {
  const hit = cache.get(orgId);
  if (hit && now.getTime() - hit.at < TTL) return hit.eff;
  const [sub] = await withTenant(db, orgId, (tx) =>
    tx.select().from(schema.subscriptions).orderBy(desc(schema.subscriptions.createdAt)).limit(1),
  );
  const eff = effectivePlan(sub ?? null, now);
  cache.set(orgId, { at: now.getTime(), eff });
  return eff;
}

type Limit = 'docs' | 'businesses' | 'users';
function limitFor(method: string, path: string, overwrite?: string): Limit | null {
  if (method !== 'post') return null;
  if (path === '/v1/invoices' || path === '/v1/pos/sales') return 'docs';
  // A bill saved again with ?overwrite=1 is an edit, not a new document.
  if (path === '/v1/workspace/collections/bills' && overwrite !== '1' && overwrite !== 'true')
    return 'docs';
  if (path === '/v1/businesses') return 'businesses';
  if (path === '/v1/invitations') return 'users';
  return null;
}

/** The first instant of this calendar month in India. */
const monthStartIst = (now: Date) => {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3_600_000);
};

export async function usageOf(db: Database, orgId: string, now = new Date()) {
  const since = monthStartIst(now);
  const { docs, businesses } = await withTenant(db, orgId, async (tx) => {
    const [a] = await tx
      .select({ n: count() })
      .from(schema.invoices)
      .where(gte(schema.invoices.createdAt, since));
    const [b] = await tx
      .select({ n: count() })
      .from(schema.documents)
      .where(and(eq(schema.documents.collection, 'bills'), gte(schema.documents.createdAt, since)));
    const [c] = await tx
      .select({ n: count() })
      .from(schema.businesses)
      .where(isNull(schema.businesses.deletedAt));
    return { docs: Number(a!.n) + Number(b!.n), businesses: Number(c!.n) };
  });
  const [m] = await db
    .select({ n: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, orgId));
  const [i] = await db
    .select({ n: count() })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, orgId),
        eq(schema.invitation.status, 'pending'),
        gt(schema.invitation.expiresAt, now),
      ),
    );
  return { docsThisMonth: docs, businesses, users: Number(m!.n) + Number(i!.n) };
}

export async function requireFeature(
  db: Database,
  ctx: OrgContext,
  method: string,
  path: string,
  opts: { explicit?: string; overwrite?: string } = {},
) {
  const m = method.toLowerCase();
  const feature = (opts.explicit as Feature | undefined) ?? featureForRoute(m, path);
  const limit = limitFor(m, path, opts.overwrite);
  if (!feature && !limit) return;
  const eff = await planOf(db, ctx.orgId);
  if (feature && !planAllows(eff.plan, feature))
    throw new AppError(
      'payment_required',
      `Your ${eff.label} plan does not include this. Upgrade to use it.`,
      { feature, plan: eff.plan },
    );
  if (!limit) return;
  const caps = planById(eff.plan).limits;
  const cap = limit === 'docs' ? caps.docsPerMonth : caps[limit];
  if (cap === null) return;
  const use = await usageOf(db, ctx.orgId);
  const used = limit === 'docs' ? use.docsThisMonth : use[limit];
  if (used >= cap) {
    const what = {
      docs: `${cap} sale documents this month`,
      businesses: `${cap} business${cap === 1 ? '' : 'es'}`,
      users: `${cap} user${cap === 1 ? '' : 's'}`,
    }[limit];
    throw new AppError(
      'payment_required',
      `Your ${eff.label} plan allows ${what}. Upgrade for more.`,
      { limit, cap, used, plan: eff.plan },
    );
  }
}
