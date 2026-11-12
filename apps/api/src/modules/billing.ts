// SaaS billing: the plan in force, usage against its limits, checkout and cancel (owner only), and Razorpay's webhook.
// Plans and features are contracts/plans.ts; enforcement is middleware/feature.ts.
import { desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import { schema, withTenant } from '@ledgora/db';
import { FEATURES, PLANS, TRIAL_DAYS, effectivePlan, planById } from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError } from '../errors.ts';
import type { Deps, Registrar } from '../http.ts';
import { forgetPlan, usageOf } from '../middleware/feature.ts';
import {
  razorpayProvider,
  subscriptionUpdate,
  verifyWebhook,
  type BillingProvider,
} from '../billing/provider.ts';

const { subscriptions } = schema;
const providerOf = (deps: Deps): BillingProvider => deps.billing ?? razorpayProvider(deps.env);
const ownerOnly = (role: string) => {
  if (role !== 'owner') throw new AppError('forbidden', 'Only the owner can change the plan');
};

export function billingModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/billing',
    tag: 'Billing',
    summary: 'The plan in force, the trial, usage against the plan limits, and the plan catalogue',
    permission: null,
    handler: async ({ tx, orgId, deps }) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      const eff = effectivePlan(sub ?? null);
      return {
        current: {
          ...eff,
          subscribedPlan: sub?.plan ?? null,
          trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
          startedAt: sub?.startedAt?.toISOString() ?? null,
          currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
          interval: sub?.billingInterval ?? null,
          features: planById(eff.plan).features,
          limits: planById(eff.plan).limits,
        },
        usage: await usageOf(deps.db, orgId),
        plans: PLANS,
        features: FEATURES,
        checkoutAvailable: providerOf(deps).configured,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/billing/trial',
    tag: 'Billing',
    summary:
      'Pick how to begin: the 7-day free trial (every feature) or Free. Once only, owner only; answering again is harmless',
    permission: null,
    body: z.object({ choice: z.enum(['trial', 'free']) }),
    handler: async ({ tx, orgId, auth, body }) => {
      ownerOnly(auth.role);
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      const now = new Date();
      if (!sub) throw new AppError('conflict', 'This account has no subscription record');
      if (sub.status !== 'pending') {
        // Already begun: asking for the trial again just reports where things stand. A second trial is never given.
        if (body.choice === 'trial' && sub.status !== 'trialing')
          throw new AppError('conflict', 'The free trial has already been used on this account');
        return {
          ok: true,
          status: sub.status,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
        };
      }
      const patch =
        body.choice === 'trial'
          ? {
              plan: 'trial',
              status: 'trialing',
              startedAt: now,
              trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
            }
          : { plan: 'free', status: 'active', startedAt: now };
      await tx.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id));
      await audit(tx, orgId, `subscription.${body.choice}`, 'subscription', null, {
        after: { days: body.choice === 'trial' ? TRIAL_DAYS : 0 },
      });
      forgetPlan(orgId);
      return {
        ok: true,
        status: patch.status,
        trialEndsAt: patch.trialEndsAt?.toISOString() ?? null,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/billing/checkout',
    tag: 'Billing',
    summary: 'Start paying for a plan: returns the provider page to pay on (owner only)',
    permission: null,
    body: z.object({ plan: z.enum(['silver', 'gold']), interval: z.enum(['month', 'year']) }),
    handler: async ({ tx, orgId, auth, body, deps }) => {
      ownerOnly(auth.role);
      const { id, checkoutUrl } = await providerOf(deps).createSubscription({
        orgId,
        plan: body.plan,
        interval: body.interval,
        email: auth.user.email,
      });
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      if (sub)
        await tx
          .update(subscriptions)
          .set({ provider: 'razorpay', providerSubscriptionId: id, billingInterval: body.interval })
          .where(eq(subscriptions.id, sub.id));
      else
        await tx.insert(subscriptions).values({
          orgId,
          plan: 'free',
          status: 'none',
          provider: 'razorpay',
          providerSubscriptionId: id,
          billingInterval: body.interval,
        });
      await audit(tx, orgId, 'subscription.checkout', 'subscription', null, {
        after: { plan: body.plan, interval: body.interval },
      });
      return { checkoutUrl };
    },
  });

  route({
    method: 'post',
    path: '/v1/billing/cancel',
    tag: 'Billing',
    summary: 'Cancel at the end of the paid period (owner only)',
    permission: null,
    handler: async ({ tx, orgId, auth, deps }) => {
      ownerOnly(auth.role);
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      if (!sub?.providerSubscriptionId || sub.status !== 'active')
        throw new AppError('conflict', 'There is no paid plan to cancel');
      await providerOf(deps).cancelSubscription(sub.providerSubscriptionId);
      await audit(tx, orgId, 'subscription.cancel', 'subscription', null, {
        after: { plan: sub.plan },
      });
      return { ok: true };
    },
  });
}

/**
 * POST /v1/billing/webhook: Razorpay's subscription events. The signature is checked over the raw body before anything
 * is read; the organization comes from the notes we set at checkout and must own that subscription id.
 */
export function billingWebhook(app: Hono, deps: Deps) {
  app.post('/v1/billing/webhook', async (c) => {
    const raw = await c.req.text();
    if (!verifyWebhook(raw, c.req.header('x-razorpay-signature'), deps.env.RAZORPAY_WEBHOOK_SECRET))
      return c.json({ error: { code: 'unauthorized', message: 'Bad signature' } }, 401);
    let evt: {
      event?: string;
      payload?: {
        subscription?: {
          entity?: {
            id?: string;
            status?: string;
            current_end?: number | null;
            notes?: Record<string, string>;
          };
        };
      };
    };
    try {
      evt = JSON.parse(raw);
    } catch {
      return c.json({ error: { code: 'bad_request', message: 'Not JSON' } }, 400);
    }
    const entity = evt.payload?.subscription?.entity;
    const upd = entity && evt.event ? subscriptionUpdate(evt.event, entity) : null;
    const orgId = entity?.notes?.orgId as string | undefined;
    if (!upd || !orgId || !/^[0-9a-f-]{36}$/i.test(orgId))
      return c.json({ ok: true, ignored: true });
    const applied = await withTenant(deps.db, orgId, async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.providerSubscriptionId, String(entity!.id)))
        .limit(1);
      if (!sub) return false;
      await tx
        .update(subscriptions)
        .set({
          status: upd.status,
          // The day a paid plan first became active is the day it was activated.
          ...(upd.status === 'active' && sub.status !== 'active' ? { startedAt: new Date() } : {}),
          ...(upd.plan && PLANS.some((p) => p.id === upd.plan) ? { plan: upd.plan } : {}),
          ...(upd.currentPeriodEnd ? { currentPeriodEnd: upd.currentPeriodEnd } : {}),
        })
        .where(eq(subscriptions.id, sub.id));
      await audit(tx, orgId, `subscription.${upd.status}`, 'subscription', null, {
        after: { event: evt.event, plan: upd.plan },
      });
      return true;
    });
    forgetPlan(orgId);
    return c.json({ ok: true, applied });
  });
}
