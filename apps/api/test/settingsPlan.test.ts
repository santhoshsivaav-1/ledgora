import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTenant } from '@ledgora/db';
import { SETTING_FEATURE, SETTINGS } from '@ledgora/contracts';
import { makeHarness } from './helpers.ts';
import { forgetPlan } from '../src/middleware/feature.ts';

// Settings that belong to a paid feature follow the plan: a trial has them all, Free reads them as off and can not
// switch them on, and what was saved comes back on upgrade. Settings managed on another screen refuse a change here.
const h = makeHarness();
afterAll(() => h.close());

const setSub = async (orgId: string, set: string) => {
  await withTenant(h.db, orgId, (tx) => tx.execute(sql.raw(`update subscriptions set ${set}`)));
  forgetPlan(orgId);
};
const get = (t: { call: any; businessId: string }) =>
  t.call('GET', `/v1/settings?businessId=${t.businessId}`);
const patch = (t: { call: any; businessId: string }, values: Record<string, unknown>) =>
  t.call('PATCH', '/v1/settings', { businessId: t.businessId, values });

describe('plan-gated settings', () => {
  it('every gated key is a real setting', () => {
    for (const k of Object.keys(SETTING_FEATURE))
      expect(SETTINGS[k as keyof typeof SETTINGS], k).toBeDefined();
  });

  it('a trial can switch batch tracking on, and it reads on', async () => {
    const t = await h.newTenant();
    const r = await patch(t, { 'item.batch': true, 'party.itemRates': true });
    expect(r.status, r.text).toBe(200);
    expect(r.body.settings['item.batch']).toBe(true);
    expect(r.body.locked ?? {}).toEqual({});
  });

  it('Free reads gated keys as off, lists them as locked, and refuses to switch them on', async () => {
    const t = await h.newTenant();
    await patch(t, { 'item.batch': true });
    await setSub(t.orgId, `trial_ends_at = now() - interval '1 day'`);
    const g = await get(t);
    expect(g.body.settings['item.batch']).toBe(false); // saved value kept, read as the default
    expect(g.body.locked['item.batch']).toBe('inventory_pro');
    const on = await patch(t, { 'item.serial': true });
    expect(on.status).toBe(402);
    expect(on.body.error.code).toBe('payment_required');
    expect(on.body.error.details.keys).toEqual(['item.serial']);
    // switching one off is always allowed
    expect((await patch(t, { 'item.batch': false })).status).toBe(200);
    // a setting outside the plan table still works
    expect((await patch(t, { 'txn.quickEntry': true })).status).toBe(200);
  });

  it('what was saved returns on upgrade', async () => {
    const t = await h.newTenant();
    await patch(t, { 'item.wholesale': true });
    await setSub(t.orgId, `trial_ends_at = now() - interval '1 day'`);
    expect((await get(t)).body.settings['item.wholesale']).toBe(false);
    await setSub(
      t.orgId,
      `status = 'active', plan = 'silver', current_period_end = now() + interval '30 days'`,
    );
    expect((await get(t)).body.settings['item.wholesale']).toBe(true);
  });
});

describe('settings with their own screen', () => {
  it('the ledger switch is shown but refused here', async () => {
    const t = await h.newTenant();
    const g = await get(t);
    expect(g.body.settings['acct.enabled']).toBe(false);
    const r = await patch(t, { 'acct.enabled': true });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/Accounting/);
  });

  it('the ledger switch follows the real flag', async () => {
    const t = await h.newTenant();
    const dry = await t.call('POST', '/v1/accounting/backfill', {
      businessId: t.businessId,
      dryRun: false,
    });
    expect(dry.status, dry.text).toBe(200);
    expect((await get(t)).body.settings['acct.enabled']).toBe(dry.body.enabled);
  });
});

describe('the new live keys', () => {
  it('accept their values and refuse bad ones', async () => {
    const t = await h.newTenant();
    const ok = await patch(t, {
      'fy.startMonth': 1,
      'fmt.qtyDecimals': 3,
      'fmt.wordsLang': 'ta',
      'gst.regType': 'composition',
      'gst.compRate': 1,
      'gst.frequency': 'qrmp',
      'gst.hsnDigits': 6,
      'gst.itcDefault': 'ineligible',
      'mc.showBoth': true,
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.settings['gst.frequency']).toBe('qrmp');
    expect((await patch(t, { 'fy.startMonth': 13 })).status).toBe(400);
    expect((await patch(t, { 'gst.hsnDigits': 5 })).status).toBe(400);
  });
});
