import { describe, expect, it } from 'vitest';
import {
  FEATURES,
  PLANS,
  effectivePlan,
  featureForRoute,
  featureForWebPath,
  isLockExempt,
  minPlanFor,
  planAllows,
} from './plans.ts';

const day = 86_400_000;
const now = new Date('2026-11-12T10:00:00Z');

describe('plan catalogue', () => {
  it('every feature a plan lists exists, and each higher plan includes the lower one', () => {
    const ids = new Set(FEATURES.map((f) => f.id));
    for (const p of PLANS)
      for (const f of p.features) expect(ids.has(f), `${p.id}:${f}`).toBe(true);
    const [free, silver, gold] = PLANS;
    for (const f of free!.features) expect(silver!.features).toContain(f);
    for (const f of silver!.features) expect(gold!.features).toContain(f);
    expect(gold!.features.length).toBe(FEATURES.length);
  });
});

describe('effectivePlan', () => {
  it('a live trial has every feature, with the days left', () => {
    const e = effectivePlan(
      { plan: 'trial', status: 'trialing', trialEndsAt: new Date(now.getTime() + 3.5 * day) },
      now,
    );
    expect(e).toMatchObject({
      plan: 'gold',
      label: 'Trial',
      trial: true,
      trialDaysLeft: 4,
      expired: false,
    });
  });
  it('an ended trial falls back to Free, never to no access', () => {
    expect(
      effectivePlan(
        { plan: 'trial', status: 'trialing', trialEndsAt: new Date(now.getTime() - day) },
        now,
      ),
    ).toMatchObject({ plan: 'free', trial: false, expired: true });
  });
  it('a paid plan holds while active, and for 5 days of past_due grace', () => {
    const end = new Date(now.getTime() + 20 * day);
    expect(
      effectivePlan({ plan: 'silver', status: 'active', currentPeriodEnd: end }, now).plan,
    ).toBe('silver');
    expect(
      effectivePlan(
        { plan: 'gold', status: 'past_due', currentPeriodEnd: new Date(now.getTime() - 3 * day) },
        now,
      ),
    ).toMatchObject({ plan: 'gold', graceDaysLeft: 2, locked: false });
    expect(
      effectivePlan(
        { plan: 'gold', status: 'past_due', currentPeriodEnd: new Date(now.getTime() - 6 * day) },
        now,
      ),
    ).toMatchObject({ plan: 'free', locked: true, lockReason: 'plan_ended' });
  });
  it('a cancelled plan runs to the end of the period it paid for', () => {
    expect(
      effectivePlan(
        { plan: 'gold', status: 'canceled', currentPeriodEnd: new Date(now.getTime() + day) },
        now,
      ).plan,
    ).toBe('gold');
    expect(
      effectivePlan(
        { plan: 'gold', status: 'canceled', currentPeriodEnd: new Date(now.getTime() - day) },
        now,
      ),
    ).toMatchObject({ plan: 'gold', graceDaysLeft: 4 }); // the 5 grace days apply when a plan ends, cancelled or not
    expect(
      effectivePlan(
        { plan: 'gold', status: 'canceled', currentPeriodEnd: new Date(now.getTime() - 6 * day) },
        now,
      ),
    ).toMatchObject({ plan: 'free', locked: true });
  });
  it('an ended trial LOCKS the account; chosen Free never locks', () => {
    expect(
      effectivePlan(
        { plan: 'trial', status: 'trialing', trialEndsAt: new Date(now.getTime() - day) },
        now,
      ),
    ).toMatchObject({ locked: true, lockReason: 'trial_ended' });
    expect(effectivePlan({ plan: 'free', status: 'active' }, now)).toMatchObject({
      plan: 'free',
      locked: false,
      expired: false,
    });
  });
  it('an active plan whose period has ended (missed webhook) gets the grace days, then locks', () => {
    const at = (d: number) =>
      effectivePlan(
        { plan: 'silver', status: 'active', currentPeriodEnd: new Date(now.getTime() - d * day) },
        now,
      );
    expect(at(1)).toMatchObject({ plan: 'silver', graceDaysLeft: 4, graceReason: 'period_ended' });
    expect(at(4.5)).toMatchObject({ plan: 'silver', locked: false });
    expect(at(5.5)).toMatchObject({ plan: 'free', locked: true, lockReason: 'plan_ended' });
  });
  it('no subscription row (organizations made before billing) is a trial that has ended: Free', () => {
    expect(effectivePlan(null, now).plan).toBe('free');
  });
});

describe('featureForRoute', () => {
  it('names the paid feature a write needs; reads are never gated', () => {
    expect(featureForRoute('post', '/v1/pos/sales')).toBe('pos');
    expect(featureForRoute('post', '/v1/journals')).toBe('accounting');
    expect(featureForRoute('put', '/v1/cheques/x/clear')).toBe('cashbank');
    expect(featureForRoute('post', '/v1/messages/send')).toBe('messaging');
    expect(featureForRoute('post', '/v1/utilities/tally/export')).toBe('tally');
    expect(featureForRoute('put', '/v1/backups/settings')).toBe('cloud_backup');
    expect(featureForRoute('get', '/v1/ledger')).toBeNull();
    expect(featureForRoute('post', '/v1/invoices')).toBeNull();
    expect(featureForRoute('post', '/v1/backups')).toBeNull();
  });
  it('route guards: a locked account may still pay, export and sign out', () => {
    expect(isLockExempt('/v1/billing/checkout')).toBe(true);
    expect(isLockExempt('/v1/backups')).toBe(true);
    expect(isLockExempt('/v1/invoices')).toBe(false);
  });
  it('screens map to features, and a feature names its cheapest plan', () => {
    expect(featureForWebPath('/cash-bank/loans')).toBe('cashbank');
    expect(featureForWebPath('/pos')).toBe('pos');
    expect(featureForWebPath('/invoices')).toBeNull();
    expect(minPlanFor('pos').id).toBe('silver');
    expect(minPlanFor('accounting').id).toBe('gold');
  });
  it('items/:id/lots writes need inventory_pro', () => {
    expect(featureForRoute('post', '/v1/items/abc/lots')).toBe('inventory_pro');
  });
  it('planAllows', () => {
    expect(planAllows('free', 'pos')).toBe(false);
    expect(planAllows('silver', 'pos')).toBe(true);
    expect(planAllows('silver', 'accounting')).toBe(false);
    expect(planAllows('gold', 'accounting')).toBe(true);
  });
});
