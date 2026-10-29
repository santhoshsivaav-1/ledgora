import { afterAll, describe, expect, it } from 'vitest';
import { makeHarness } from './helpers.ts';

const h = makeHarness();
afterAll(() => h.close());

/** newTenant() fills in the state for convenience; a real new account has not. */
async function freshAccount() {
  const { cookie } = await h.signUp();
  return h.client(cookie);
}

describe('first-run onboarding', () => {
  it('starts incomplete, completes once the business form is saved, and the business shows up everywhere', async () => {
    const call = await freshAccount();
    const before = (await call('GET', '/v1/onboarding')).body;
    expect(before.complete).toBe(false);
    expect(before.business.state).toBe('');

    const saved = await call('POST', '/v1/onboarding/business', {
      name: 'Sri Lakshmi Traders',
      gstin: '33AAAAA0000A1Z5',
      state: 'Tamil Nadu',
      address: '12 Main Road',
      city: 'Salem',
      pin: '636001',
      phone: '+919876543210',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.complete).toBe(true);
    expect(saved.body.business).toMatchObject({
      name: 'Sri Lakshmi Traders',
      gstin: '33AAAAA0000A1Z5',
      city: 'Salem',
    });

    expect((await call('GET', '/v1/onboarding')).body.complete).toBe(true);
    expect((await call('GET', '/v1/me')).body.organization.name).toBe('Sri Lakshmi Traders'); // the org follows its first business
    const biz = (await call('GET', '/v1/businesses')).body.data;
    expect(biz).toHaveLength(1); // the sign-up business is updated, not duplicated
    expect(biz[0]).toMatchObject({
      name: 'Sri Lakshmi Traders',
      state: 'Tamil Nadu',
      isDefault: true,
    });
    const audit = (await call('GET', '/v1/audit?limit=20')).body.data.map((a: any) => a.action);
    expect(audit).toContain('onboarding.business');
  });

  it('refuses a GSTIN from another state, an unknown state, a malformed GSTIN and a blank name', async () => {
    const call = await freshAccount();
    const post = (b: object) =>
      call('POST', '/v1/onboarding/business', { name: 'X', state: 'Tamil Nadu', ...b });
    const wrongState = await post({ gstin: '27AAAAA0000A1Z5' }); // 27 = Maharashtra
    expect(wrongState.status).toBe(400);
    expect(wrongState.body.error.details[0].path).toBe('gstin');
    expect((await post({ state: 'Atlantis' })).status).toBe(400);
    expect((await post({ gstin: '123' })).status).toBe(400);
    expect((await post({ name: '  ' })).status).toBe(400);
    expect((await call('GET', '/v1/onboarding')).body.complete).toBe(false); // nothing was saved
  });

  it('accepts a blank GSTIN (not registered yet) and clears a saved one', async () => {
    const call = await freshAccount();
    const ok = await call('POST', '/v1/onboarding/business', {
      name: 'Small Shop',
      state: 'Kerala',
      gstin: '',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.business.gstin).toBeNull();
  });

  it('is for people who can edit the business, and needs a session', async () => {
    const t = await h.newTenant();
    const viewer = await h.addMember(t, 'viewer');
    expect((await viewer.call('GET', '/v1/onboarding')).status).toBe(200);
    expect(
      (await viewer.call('POST', '/v1/onboarding/business', { name: 'Nope', state: 'Kerala' }))
        .status,
    ).toBe(403);
    expect((await h.app.request('/v1/onboarding')).status).toBe(401);
  });
});
