// SaaS billing: the plan in force, usage against its limits, checkout and cancel (owner only), and Razorpay's webhook.
// Plans and features are contracts/plans.ts; enforcement is middleware/feature.ts.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import { schema, withTenant } from '@ledgora/db';
import { FEATURES, PLANS, TRIAL_DAYS, effectivePlan, planById } from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError } from '../errors.ts';
import type { Deps, Registrar } from '../http.ts';
import { forgetPlan, usageOf } from '../middleware/feature.ts';
import {
  invoiceNumber,
  subscriptionInvoiceFromTotal,
  subscriptionInvoiceFigures,
} from '../billing/invoice.ts';
import { paymentReceiptMail } from '../mail/templates.ts';
import { sendMail } from '../mail/index.ts';
import {
  razorpayProvider,
  subscriptionUpdate,
  verifyWebhook,
  type BillingProvider,
} from '../billing/provider.ts';

const { subscriptions, subscriptionInvoices, businesses, organizations, member, user } = schema;
const invoiceJson = (r: typeof subscriptionInvoices.$inferSelect) => ({
  id: r.id,
  number: r.number,
  issuedAt: r.issuedAt.toISOString(),
  plan: r.plan,
  interval: r.interval,
  periodStart: r.periodStart?.toISOString() ?? null,
  periodEnd: r.periodEnd?.toISOString() ?? null,
  taxable: r.taxable,
  cgst: r.cgst,
  sgst: r.sgst,
  igst: r.igst,
  total: r.total,
  buyer: r.buyer,
  seller: r.seller,
});
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
    path: '/v1/billing/free',
    tag: 'Billing',
    summary:
      'Carry on with the Free plan after the trial or a paid plan has ended (unlocks a locked account; owner only)',
    permission: null,
    handler: async ({ tx, orgId, auth }) => {
      ownerOnly(auth.role);
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      if (!sub) throw new AppError('conflict', 'This account has no subscription record');
      const eff = effectivePlan(sub);
      // Only a locked account needs this. A paid plan in its grace days must be renewed, not dropped by accident.
      if (!eff.locked) {
        if (eff.plan === 'free' && !eff.needsPlan) return { ok: true, status: sub.status };
        throw new AppError('conflict', 'Your plan is still in force');
      }
      await tx
        .update(subscriptions)
        .set({
          plan: 'free',
          status: 'active',
          currentPeriodEnd: null,
          trialEndsAt: sub.trialEndsAt,
        })
        .where(eq(subscriptions.id, sub.id));
      await audit(tx, orgId, 'subscription.free', 'subscription', null, {
        after: { from: eff.lockReason },
      });
      forgetPlan(orgId);
      return { ok: true, status: 'active' };
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
      const [current] = await tx
        .select()
        .from(subscriptions)
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      // Upgrading, downgrading or switching between monthly and yearly while a paid plan is running: the new plan is paid for
      // first; the old one is cancelled at its period end only once the new one is active (the webhook does that).
      const paid = current?.status === 'active' && !!current.providerSubscriptionId;
      if (paid && current.plan === body.plan && current.billingInterval === body.interval)
        throw new AppError('conflict', 'You are already on this plan');
      const { id, checkoutUrl } = await providerOf(deps).createSubscription({
        orgId,
        plan: body.plan,
        interval: body.interval,
        email: auth.user.email,
      });
      const sub = current;
      if (sub)
        await tx
          .update(subscriptions)
          .set({
            provider: 'razorpay',
            providerSubscriptionId: id,
            billingInterval: body.interval,
            replacesSubscriptionId: paid ? sub.providerSubscriptionId : null,
          })
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
        after: { plan: body.plan, interval: body.interval, change: paid },
      });
      return { checkoutUrl, change: paid };
    },
  });

  route({
    method: 'get',
    path: '/v1/billing/invoices',
    tag: 'Billing',
    summary:
      'The GST invoices issued to this organization for its Ledgora subscription (owner only)',
    permission: null,
    handler: async ({ tx, auth }) => {
      ownerOnly(auth.role);
      const rows = await tx
        .select()
        .from(subscriptionInvoices)
        .orderBy(desc(subscriptionInvoices.issuedAt))
        .limit(200);
      return { invoices: rows.map(invoiceJson) };
    },
  });

  route({
    method: 'get',
    path: '/v1/billing/invoices/:id',
    tag: 'Billing',
    summary:
      'One subscription invoice, with the buyer and seller as they were on the day (owner only)',
    permission: null,
    params: z.object({ id: z.string().uuid() }),
    handler: async ({ tx, auth, params }) => {
      ownerOnly(auth.role);
      const [row] = await tx
        .select()
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, params.id))
        .limit(1);
      if (!row) throw new AppError('not_found', 'No such invoice');
      return { invoice: invoiceJson(row) };
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
            current_start?: number | null;
            current_end?: number | null;
            notes?: Record<string, string>;
          };
        };
        payment?: { entity?: { id?: string; amount?: number } };
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
    let receipt: { number: string; total: number; id: string } | null = null;
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
      // A plan change: the old subscription stops at its period end now that the new one is paid and active.
      if (upd.status === 'active' && sub.replacesSubscriptionId) {
        try {
          await providerOf(deps).cancelSubscription(sub.replacesSubscriptionId);
        } catch (e) {
          console.error(
            '[billing] could not cancel the replaced subscription',
            e instanceof Error ? e.message : e,
          );
        }
        await tx
          .update(subscriptions)
          .set({ replacesSubscriptionId: null })
          .where(eq(subscriptions.id, sub.id));
      }
      if (evt.event === 'subscription.charged') {
        const paymentId = evt.payload?.payment?.entity?.id;
        if (paymentId)
          receipt = await issueInvoice(deps, tx, orgId, {
            plan: upd.plan ?? sub.plan,
            interval: entity!.notes?.interval ?? sub.billingInterval ?? 'year',
            paymentId,
            amountPaise: evt.payload?.payment?.entity?.amount,
            periodStart: entity!.current_start ? new Date(entity!.current_start * 1000) : null,
            periodEnd: upd.currentPeriodEnd,
          });
      }
      return true;
    });
    if (receipt) await mailReceipt(deps, orgId, receipt);
    forgetPlan(orgId);
    return c.json({ ok: true, applied });
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[2]>[0];

/**
 * One GST tax invoice for one successful charge. The charge is taken as GST-inclusive (the Razorpay plan amount is the price plus
 * GST); without an amount the catalogue price plus GST is used. Same state as the seller = CGST and SGST, else IGST. Idempotent on
 * the payment id: Razorpay repeats webhooks.
 */
async function issueInvoice(
  deps: Deps,
  tx: Tx,
  orgId: string,
  o: {
    plan: string;
    interval: string;
    paymentId: string;
    amountPaise?: number;
    periodStart: Date | null;
    periodEnd: Date | null;
  },
) {
  const [dup] = await tx
    .select({ id: subscriptionInvoices.id })
    .from(subscriptionInvoices)
    .where(eq(subscriptionInvoices.providerPaymentId, o.paymentId))
    .limit(1);
  if (dup) return null;
  const [biz] = await tx.select().from(businesses).orderBy(businesses.createdAt).limit(1);
  const [org] = await deps.db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const rate = deps.env.SELLER_GST_RATE;
  const sellerState = deps.env.SELLER_STATE.trim().toLowerCase();
  const sameState = !!biz?.state && biz.state.trim().toLowerCase() === sellerState;
  const plan = PLANS.find((p) => p.id === o.plan);
  const price = o.interval === 'month' ? plan?.priceMonthly : plan?.priceYearly;
  const f = o.amountPaise
    ? subscriptionInvoiceFromTotal(o.amountPaise / 100, rate, sameState)
    : subscriptionInvoiceFigures(price ?? 0, rate, sameState);
  const now = new Date();
  const seq = Number(
    (
      (await tx.execute(sql`select nextval('subscription_invoice_seq') as n`)) as unknown as {
        n: string;
      }[]
    )[0]?.n ?? 1,
  );
  const [row] = await tx
    .insert(subscriptionInvoices)
    .values({
      orgId,
      number: invoiceNumber(now, seq),
      issuedAt: now,
      plan: o.plan,
      interval: o.interval,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      providerPaymentId: o.paymentId,
      ...f,
      buyer: {
        name: biz?.name || org?.name || '',
        gstin: biz?.gstin ?? '',
        state: biz?.state ?? '',
        address: biz?.address ?? '',
      },
      seller: {
        name: deps.env.SELLER_NAME,
        gstin: deps.env.SELLER_GSTIN ?? '',
        state: deps.env.SELLER_STATE,
        address: deps.env.SELLER_ADDRESS,
        sac: '998431',
        rate: String(rate),
      },
    })
    .returning();
  await audit(tx, orgId, 'subscription.invoice', 'subscription_invoice', row!.id, {
    after: { number: row!.number, total: f.total },
  });
  return { id: row!.id, number: row!.number, total: f.total };
}

async function mailReceipt(
  deps: Deps,
  orgId: string,
  r: { id: string; number: string; total: number },
) {
  try {
    const [owner] = await deps.db
      .select({ email: user.email, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')))
      .limit(1);
    if (owner)
      await sendMail(
        deps.env,
        paymentReceiptMail(
          owner.email,
          owner.name,
          r.number,
          r.total,
          `${deps.env.APP_URL}/settings/billing`,
        ),
      );
  } catch (e) {
    console.error('[billing] receipt mail', e instanceof Error ? e.message : e);
  }
}
