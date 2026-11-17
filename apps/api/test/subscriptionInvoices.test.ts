import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { makeHarness, type Tenant } from './helpers.ts';
import type { BillingProvider } from '../src/billing/provider.ts';
import { forgetPlan } from '../src/middleware/feature.ts';
import {
  fyLabel,
  invoiceNumber,
  subscriptionInvoiceFigures,
  subscriptionInvoiceFromTotal,
  trialNotice,
} from '../src/billing/invoice.ts';
import { clearOutbox, getOutbox } from '../src/mail/index.ts';
import { runTrialMail } from '../src/billing/trialMail.ts';

// Phase 1: a test-mode purchase upgrades the account and issues a GST invoice; a plan change replaces the old subscription; the
// trial sequence mails once each. The fake provider stands in for Razorpay.
const calls: string[] = [];
let n = 0;
const run = Math.random().toString(36).slice(2, 8); // payment ids are unique across the shared test database
const fake: BillingProvider = {
  configured: true,
  async createSubscription({ plan, interval }) {
    n++;
    calls.push(`create:${plan}:${interval}`);
    return { id: `sub_${run}_${n}`, checkoutUrl: 'https://rzp.io/i/test' };
  },
  async cancelSubscription(id) {
    calls.push(`cancel:${id}`);
  },
};
const h = makeHarness({ billing: fake });
const SECRET = 'whsec_p1';
h.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
h.env.SELLER_STATE = 'Tamil Nadu';
let t: Tenant;
beforeAll(async () => {
  t = await h.newTenant();
});
afterAll(() => h.close());

const webhook = (body: unknown) => {
  const raw = JSON.stringify(body);
  return h.app.request('/v1/billing/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': createHmac('sha256', SECRET).update(raw).digest('hex'),
    },
    body: raw,
  });
};
const charged = (org: Tenant, subId: string, plan: string, payId: string, amountPaise?: number) =>
  webhook({
    event: 'subscription.charged',
    payload: {
      subscription: {
        entity: {
          id: subId,
          status: 'active',
          current_start: Math.floor(Date.now() / 1000),
          current_end: Math.floor(Date.now() / 1000) + 365 * 86400,
          notes: { orgId: org.orgId, plan, interval: 'year' },
        },
      },
      payment: { entity: { id: payId, ...(amountPaise ? { amount: amountPaise } : {}) } },
    },
  });

describe('invoice arithmetic', () => {
  it('splits GST into CGST+SGST within the state and IGST outside, always adding up', () => {
    expect(subscriptionInvoiceFigures(2999, 18, true)).toEqual({
      taxable: 2999,
      cgst: 269.91,
      sgst: 269.91,
      igst: 0,
      total: 3538.82,
    });
    expect(subscriptionInvoiceFigures(2999, 18, false)).toEqual({
      taxable: 2999,
      cgst: 0,
      sgst: 0,
      igst: 539.82,
      total: 3538.82,
    });
    for (const total of [3538.82, 5898.82, 1.01, 999.99]) {
      for (const same of [true, false]) {
        const f = subscriptionInvoiceFromTotal(total, 18, same);
        expect(f.total).toBe(total);
        expect(Math.round((f.taxable + f.cgst + f.sgst + f.igst) * 100)).toBe(
          Math.round(total * 100),
        );
      }
    }
  });
  it('numbers invoices by financial year', () => {
    expect(fyLabel(new Date('2027-03-31T10:00:00Z'))).toBe('2026-27');
    expect(fyLabel(new Date('2027-03-31T19:00:00Z'))).toBe('2027-28'); // 1 April in India
    expect(invoiceNumber(new Date('2026-11-16T00:00:00Z'), 42)).toBe('LS/2026-27/000042');
  });
  it('says which trial mail is due, once', () => {
    const base = { status: 'trialing', notices: [] as string[] };
    const now = new Date('2026-11-16T00:00:00Z');
    const ends = (d: number) => new Date(now.getTime() + d * 86_400_000);
    expect(trialNotice({ ...base, trialEndsAt: ends(5) }, now)).toBeNull();
    expect(trialNotice({ ...base, trialEndsAt: ends(2.5) }, now)).toBe('trial_3d');
    expect(trialNotice({ ...base, trialEndsAt: ends(0.5) }, now)).toBe('trial_1d');
    expect(trialNotice({ ...base, trialEndsAt: ends(-1) }, now)).toBe('trial_ended');
    expect(trialNotice({ ...base, notices: ['trial_1d'], trialEndsAt: ends(0.5) }, now)).toBeNull();
    expect(trialNotice({ status: 'active', notices: [], trialEndsAt: ends(-1) }, now)).toBeNull();
  });
});

describe('a test-mode purchase', () => {
  it('Silver upgrades the account and issues one GST invoice, even when Razorpay repeats the event', async () => {
    await t.call('POST', '/v1/billing/trial', { choice: 'trial' });
    const co = await t.call('POST', '/v1/billing/checkout', { plan: 'silver', interval: 'year' });
    expect(co.status, co.text).toBe(200);
    expect(co.body).toMatchObject({ checkoutUrl: 'https://rzp.io/i/test', change: false });
    const id = calls.filter((c) => c.startsWith('create')).length;
    expect(id).toBe(1);
    const first = await charged(t, `sub_${run}_1`, 'silver', `pay_A_${run}`, 353882);
    expect(await first.text()).toContain('"applied":true');
    await charged(t, `sub_${run}_1`, 'silver', `pay_A_${run}`, 353882); // repeated
    expect((await t.call('GET', '/v1/me')).body.entitlements).toMatchObject({
      plan: 'silver',
      trial: false,
    });
    const list = await t.call('GET', '/v1/billing/invoices');
    expect(list.status, list.text).toBe(200);
    expect(list.body.invoices).toHaveLength(1);
    const inv = list.body.invoices[0];
    expect(inv).toMatchObject({ plan: 'silver', interval: 'year', total: 3538.82, taxable: 2999 });
    expect(inv.number).toMatch(/^LS\/\d{4}-\d{2}\/\d{6}$/);
    expect(inv.cgst + inv.sgst + inv.igst).toBeCloseTo(539.82, 2);
    expect(inv.seller.sac).toBe('998431');
    const one = await t.call('GET', `/v1/billing/invoices/${inv.id}`);
    expect(one.body.invoice.id).toBe(inv.id);
    expect(getOutbox().some((m) => m.kind === 'mail' && m.subject.includes(inv.number))).toBe(true);
  });

  it('another organization can not read this invoice', async () => {
    const other = await h.newTenant();
    const id = (await t.call('GET', '/v1/billing/invoices')).body.invoices[0].id;
    expect((await other.call('GET', `/v1/billing/invoices/${id}`)).status).toBe(404);
    expect((await other.call('GET', '/v1/billing/invoices')).body.invoices).toHaveLength(0);
  });

  it('moving to Gold is a plan change: the old subscription is cancelled only after the new one is active', async () => {
    const same = await t.call('POST', '/v1/billing/checkout', { plan: 'silver', interval: 'year' });
    expect(same.status).toBe(409);
    const co = await t.call('POST', '/v1/billing/checkout', { plan: 'gold', interval: 'year' });
    expect(co.body.change).toBe(true);
    expect(calls).not.toContain(`cancel:sub_${run}_1`);
    await charged(t, `sub_${run}_2`, 'gold', `pay_B_${run}`, 589882);
    expect(calls).toContain(`cancel:sub_${run}_1`);
    expect((await t.call('GET', '/v1/me')).body.entitlements.plan).toBe('gold');
    expect((await t.call('GET', '/v1/billing/invoices')).body.invoices).toHaveLength(2);
  });

  it('only the owner sees invoices', async () => {
    const staff = await h.addMember(t, 'admin');
    const res = await staff.call('GET', '/v1/billing/invoices');
    expect(res.status).toBe(403);
  });
});

describe('the trial mail sequence', () => {
  it('sends 3-day, 1-day and ended mails to the owner, once each', async () => {
    const o = await h.newTenant();
    await o.call('POST', '/v1/billing/trial', { choice: 'trial' });
    const setEnd = async (hoursFromNow: number) => {
      await withTenant(h.db, o.orgId, (tx) =>
        tx.execute(
          sql.raw(
            `update subscriptions set trial_ends_at = now() + interval '${hoursFromNow} hours'`,
          ),
        ),
      );
      forgetPlan(o.orgId);
    };
    const mine = () => getOutbox().filter((m) => m.kind === 'mail' && m.to === o.email);
    clearOutbox();
    await setEnd(24 * 5);
    await runTrialMail(h.db, h.env, new Date(), o.orgId);
    expect(mine()).toHaveLength(0);
    await setEnd(24 * 2);
    await runTrialMail(h.db, h.env, new Date(), o.orgId);
    await runTrialMail(h.db, h.env, new Date(), o.orgId); // again: nothing more
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({ subject: expect.stringContaining('ends in') });
    await setEnd(10);
    await runTrialMail(h.db, h.env, new Date(), o.orgId);
    expect(mine().at(-1)).toMatchObject({ subject: 'Your Ledgora trial ends tomorrow' });
    await setEnd(-5);
    await runTrialMail(h.db, h.env, new Date(), o.orgId);
    expect(mine().at(-1)).toMatchObject({ subject: 'Your Ledgora trial has ended' });
    expect(mine()).toHaveLength(3);
  });
});
