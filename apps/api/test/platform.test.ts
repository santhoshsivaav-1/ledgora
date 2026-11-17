import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';

// The platform admin page: only a confirmed address on PLATFORM_ADMIN_EMAILS sees every subscriber, plan and e-mail.
const h = makeHarness();
let admin: Tenant;
let customer: Tenant;
beforeAll(async () => {
  admin = await h.newTenant();
  customer = await h.newTenant();
  h.env.REQUIRE_EMAIL_VERIFICATION = true; // sign-ups above skipped the e-mail step, as every test does
  h.env.PLATFORM_ADMIN_EMAILS = ` ${admin.email.toUpperCase()} , someone-else@example.com`;
  // The harness signs people up with their e-mail confirmed; make that explicit for the admin.
  await h.sql`update "user" set email_verified = true where email = ${admin.email}`;
  await customer.call('POST', '/v1/billing/trial', { choice: 'trial' });
});
afterAll(() => h.close());

describe('platform overview', () => {
  it('shows the admin every account with its owner e-mail and plan, and the counts', async () => {
    const res = await admin.call('GET', '/v1/platform/overview');
    expect(res.status, res.text).toBe(200);
    const row = res.body.rows.find((r: any) => r.ownerEmail === customer.email);
    expect(row).toMatchObject({
      status: 'trialing',
      trial: true,
      plan: 'gold',
      emailConfirmed: true,
    });
    expect(res.body.totals.accounts).toBeGreaterThanOrEqual(2);
    expect(res.body.totals.businesses).toBeGreaterThanOrEqual(res.body.totals.accounts);
    expect(row.businessCount).toBe(1);
    expect(row.businesses[0].name).toBeTruthy();
    expect(res.body.totals.onTrial).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.totals.revenue).toBe('number');
  });
  it('counts businesses, not only accounts: a second business in one account is counted', async () => {
    const before = (await admin.call('GET', '/v1/platform/overview')).body;
    await customer.call('POST', '/v1/businesses', { name: 'Second Shop', state: 'Kerala' });
    const after = (await admin.call('GET', '/v1/platform/overview')).body;
    expect(after.totals.accounts).toBe(before.totals.accounts);
    expect(after.totals.businesses).toBe(before.totals.businesses + 1);
    expect(after.rows.find((r: any) => r.ownerEmail === customer.email).businessCount).toBe(2);
  });
  it('tells the admin they are one in /v1/me, and nobody else', async () => {
    expect((await admin.call('GET', '/v1/me')).body.platformAdmin).toBe(true);
    expect((await customer.call('GET', '/v1/me')).body.platformAdmin).toBe(false);
  });
  it('refuses a customer, even the owner of their own organization', async () => {
    const res = await customer.call('GET', '/v1/platform/overview');
    expect(res.status).toBe(403);
  });
  it('refuses an unconfirmed address even when it is on the list', async () => {
    await h.sql`update "user" set email_verified = false where email = ${admin.email}`;
    expect((await admin.call('GET', '/v1/platform/overview')).status).toBe(403);
    await h.sql`update "user" set email_verified = true where email = ${admin.email}`;
  });
  it('is closed when e-mail confirmation is off, since anyone could sign up with the address', async () => {
    h.env.REQUIRE_EMAIL_VERIFICATION = false;
    expect((await admin.call('GET', '/v1/platform/overview')).status).toBe(403);
    h.env.REQUIRE_EMAIL_VERIFICATION = true;
  });
  it('needs a session', async () => {
    const res = await h.app.request('/v1/platform/overview');
    expect(res.status).toBe(401);
  });
});
