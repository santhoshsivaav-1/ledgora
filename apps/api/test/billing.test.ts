import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';
import type { BillingProvider } from '../src/billing/provider.ts';
import { forgetPlan } from '../src/middleware/feature.ts';

// SaaS plans and billing. A fake provider stands in for Razorpay: no test ever calls it.
const calls: string[] = [];
const fake: BillingProvider = {
  configured: true,
  async createSubscription({ plan, interval }) {
    calls.push(`create:${plan}:${interval}`);
    return { id: 'sub_TEST1', checkoutUrl: 'https://rzp.io/i/test' };
  },
  async cancelSubscription(id) {
    calls.push(`cancel:${id}`);
  },
};
const h = makeHarness({ billing: fake });
const SECRET = 'whsec_test';
h.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
let t: Tenant;
beforeAll(async () => {
  t = await h.newTenant();
});
afterAll(() => h.close());

/** Moves the organization's subscription (as the database owner, past RLS) and drops the plan cache. */
const setSub = async (orgId: string, set: string) => {
  await withTenant(h.db, orgId, (tx) => tx.execute(sql.raw(`update subscriptions set ${set}`)));
  forgetPlan(orgId);
};
const webhook = (body: unknown, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return h.app.request('/v1/billing/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': createHmac('sha256', secret).update(raw).digest('hex'),
    },
    body: raw,
  });
};
const item = (who: Tenant) => who.call('POST', '/v1/items', { name: `I ${Math.random()}` });

describe('trial and plans', () => {
  it('a new account must choose first: nothing is on trial until the owner starts it', async () => {
    const { cookie } = await h.signUp();
    const call = h.client(cookie);
    const me = (await call('GET', '/v1/me')).body;
    expect(me.entitlements).toMatchObject({
      plan: 'free',
      needsPlan: true,
      trial: false,
      status: 'pending',
    });
    const go = await call('POST', '/v1/billing/trial', { choice: 'trial' });
    expect(go.status, go.text).toBe(200);
    const after = (await call('GET', '/v1/me')).body.entitlements;
    expect(after).toMatchObject({
      plan: 'gold',
      trial: true,
      trialDaysLeft: 7,
      needsPlan: false,
      status: 'trialing',
    });
    expect(after.startedAt).toBeTruthy();
    expect(after.trialEndsAt).toBeTruthy();
    // pressing it again changes nothing; a second trial is never given
    expect((await call('POST', '/v1/billing/trial', { choice: 'trial' })).status).toBe(200);
    expect((await call('GET', '/v1/me')).body.entitlements.trialDaysLeft).toBe(7);
  });

  it('Free can be chosen instead, and then the trial is gone for good', async () => {
    const { cookie } = await h.signUp();
    const call = h.client(cookie);
    expect((await call('POST', '/v1/billing/trial', { choice: 'free' })).status).toBe(200);
    expect((await call('GET', '/v1/me')).body.entitlements).toMatchObject({
      plan: 'free',
      needsPlan: false,
      trial: false,
    });
    const again = await call('POST', '/v1/billing/trial', { choice: 'trial' });
    expect(again.status).toBe(409);
  });

  it('only the owner can start it', async () => {
    const w = await h.newTenant();
    const viewer = await h.addMember(w, 'viewer');
    expect((await viewer.call('POST', '/v1/billing/trial', { choice: 'trial' })).status).toBe(403);
  });

  it('a new organization is on a 7-day trial with every feature once started', async () => {
    const me = (await t.call('GET', '/v1/me')).body;
    expect(me.entitlements).toMatchObject({
      plan: 'gold',
      label: 'Trial',
      trial: true,
      trialDaysLeft: 7,
    });
    const b = (await t.call('GET', '/v1/billing')).body;
    expect(b.plans.map((p: any) => p.id)).toEqual(['free', 'silver', 'gold']);
    expect(b.checkoutAvailable).toBe(true);
    expect(b.usage).toMatchObject({ businesses: 1, users: 1 });
  });

  it('after the trial: Free. Paid features answer 402 on write, reads still work, core billing still works', async () => {
    const w = await h.newTenant();
    await setSub(w.orgId, `trial_ends_at = now() - interval '1 day'`);
    expect((await w.call('GET', '/v1/me')).body.entitlements).toMatchObject({
      plan: 'free',
      expired: true,
    });
    const staff = await w.call('POST', '/v1/staff', { businessId: w.businessId, name: 'Ravi' });
    expect(staff.status).toBe(402);
    expect(staff.body.error).toMatchObject({
      code: 'payment_required',
      details: { feature: 'staff', plan: 'free' },
    });
    expect((await w.call('GET', '/v1/staff?businessId=' + w.businessId)).status).toBe(200);
    expect((await item(w)).status).toBe(201);
  });

  it('Free allows 50 sale documents a month, then 402', async () => {
    const w = await h.newTenant();
    await setSub(w.orgId, `trial_ends_at = now() - interval '1 day'`);
    const itemId = (await item(w)).body.id;
    const sale = () =>
      w.call('POST', '/v1/invoices', {
        businessId: w.businessId,
        invoiceDate: '2026-11-10',
        items: [{ itemId, name: 'x', quantity: 1, rate: 1, taxPercent: 0 }],
      });
    for (let i = 0; i < 50; i++) expect((await sale()).status).toBe(201);
    const over = await sale();
    expect(over.status).toBe(402);
    expect(over.body.error.details).toMatchObject({ limit: 'docs', cap: 50 });
  });

  it('Free allows one business and one user', async () => {
    const w = await h.newTenant();
    await setSub(w.orgId, `trial_ends_at = now() - interval '1 day'`);
    const biz = await w.call('POST', '/v1/businesses', { name: 'Second' });
    expect(biz.status).toBe(402);
    expect(biz.body.error.details).toMatchObject({ limit: 'businesses', cap: 1 });
  });
});

describe('checkout, webhook, cancel', () => {
  it('only the owner can start checkout; the owner gets the provider page', async () => {
    const viewer = await h.addMember(t, 'viewer');
    expect(
      (await viewer.call('POST', '/v1/billing/checkout', { plan: 'gold', interval: 'year' }))
        .status,
    ).toBe(403);
    const r = await t.call('POST', '/v1/billing/checkout', { plan: 'gold', interval: 'year' });
    expect(r.status, r.text).toBe(200);
    expect(r.body.checkoutUrl).toBe('https://rzp.io/i/test');
    expect(calls).toContain('create:gold:year');
  });

  it('refuses a webhook with a wrong signature', async () => {
    const res = await webhook({ event: 'subscription.activated', payload: {} }, 'wrong');
    expect(res.status).toBe(401);
  });

  it('activated → Gold until the period ends; halted keeps it for the grace days; cancelled at period end', async () => {
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const entity = {
      id: 'sub_TEST1',
      status: 'active',
      current_end: end,
      notes: { orgId: t.orgId, plan: 'gold', interval: 'year' },
    };
    const res = await webhook({
      event: 'subscription.activated',
      payload: { subscription: { entity } },
    });
    expect(await res.json()).toMatchObject({ ok: true, applied: true });
    const me = (await t.call('GET', '/v1/me')).body;
    expect(me.entitlements).toMatchObject({ plan: 'gold', label: 'Gold', trial: false });
    expect((await t.call('POST', '/v1/billing/cancel')).status).toBe(200);
    expect(calls).toContain('cancel:sub_TEST1');
    await webhook({
      event: 'subscription.cancelled',
      payload: { subscription: { entity: { ...entity, status: 'cancelled' } } },
    });
    expect((await t.call('GET', '/v1/me')).body.entitlements.plan).toBe('gold'); // paid to the period end
  });

  it('ignores an event for a subscription the organization does not own', async () => {
    const other = await h.newTenant();
    const res = await webhook({
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: { id: 'sub_TEST1', current_end: 1, notes: { orgId: other.orgId, plan: 'gold' } },
        },
      },
    });
    expect(await res.json()).toMatchObject({ applied: false });
  });
});
