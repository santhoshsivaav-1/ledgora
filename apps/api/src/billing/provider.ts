import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppEnv } from '../env.ts';
import { AppError } from '../errors.ts';

// SaaS billing provider. Razorpay subscriptions: the server creates a subscription for a Razorpay plan and the customer
// pays on Razorpay's hosted page (short_url); Razorpay's webhook then tells us it is active, charged, halted or
// cancelled. Keys never leave the server and are never logged or returned. Tests inject a fake provider.

export type Interval = 'month' | 'year';
export interface BillingProvider {
  /** false = keys not set: checkout is refused with a clear message, plans and trials still work. */
  configured: boolean;
  createSubscription(o: {
    orgId: string;
    plan: string;
    interval: Interval;
    email?: string;
  }): Promise<{ id: string; checkoutUrl: string }>;
  cancelSubscription(id: string): Promise<void>;
}

const planIds = (raw = '') =>
  new Map(
    raw
      .split(',')
      .map((x) => x.trim().split('='))
      .filter((x) => x.length === 2 && x[0] && x[1])
      .map(([k, v]) => [k!.trim(), v!.trim()]),
  );

export function razorpayProvider(env: AppEnv, fetchImpl: typeof fetch = fetch): BillingProvider {
  const ids = planIds(env.RAZORPAY_PLAN_IDS);
  const configured = !!(
    env.RAZORPAY_KEY_ID &&
    env.RAZORPAY_KEY_SECRET &&
    env.RAZORPAY_WEBHOOK_SECRET &&
    ids.size
  );
  const auth = `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
  const call = async (path: string, body: unknown) => {
    const res = await fetchImpl(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      short_url?: string;
      error?: { description?: string };
    };
    // Razorpay's own error text only; never the request (it carries no secret, but keep the habit).
    if (!res.ok)
      throw new AppError(
        'bad_request',
        json?.error?.description || `Payment provider answered ${res.status}`,
      );
    return json;
  };
  return {
    configured,
    async createSubscription({ orgId, plan, interval }) {
      const planId = ids.get(`${plan}:${interval}`);
      if (!configured || !planId)
        throw new AppError(
          'bad_request',
          'Online payment is not set up yet. Contact support to upgrade.',
        );
      const sub = await call('/subscriptions', {
        plan_id: planId,
        total_count: interval === 'year' ? 10 : 120,
        customer_notify: 1,
        notes: { orgId, plan, interval },
      });
      return { id: String(sub.id), checkoutUrl: String(sub.short_url) };
    },
    async cancelSubscription(id) {
      await call(`/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 1 });
    },
  };
}

/** Razorpay webhook signature: hex HMAC-SHA256 of the raw body with the webhook secret, compared in constant time. */
export function verifyWebhook(
  rawBody: string,
  signature: string | undefined,
  secret: string | undefined,
) {
  if (!secret || !signature) return false;
  const want = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(want);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What a Razorpay subscription event means for our row. null = an event we do not act on. */
export function subscriptionUpdate(
  event: string,
  entity: { status?: string; current_end?: number | null; notes?: Record<string, string> },
) {
  const end = entity.current_end ? new Date(entity.current_end * 1000) : null;
  const plan = entity.notes?.plan;
  switch (event) {
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.resumed':
      return { status: 'active', plan, currentPeriodEnd: end };
    case 'subscription.pending':
    case 'subscription.halted':
      return { status: 'past_due', plan, currentPeriodEnd: end };
    case 'subscription.cancelled':
    case 'subscription.completed':
      return { status: 'canceled', plan, currentPeriodEnd: end };
    default:
      return null;
  }
}
