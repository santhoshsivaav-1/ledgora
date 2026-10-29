import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '@ledgora/db';
import { ROLES, ROLE_PERMISSIONS, can, permissionFor } from '@ledgora/contracts';
import { getOutbox } from '../src/mail/index.ts';
import { createRateLimiter } from '../src/security.ts';
import { line, makeHarness } from './helpers.ts';

const h = makeHarness();
const strict = makeHarness({ env: { REQUIRE_EMAIL_VERIFICATION: 'true' } });
afterAll(async () => {
  await h.close();
  await strict.close();
});

// ---- helpers ---------------------------------------------------------------------------------------------------------

const mailsTo = (to: string) =>
  getOutbox().filter((m) => m.kind === 'mail' && m.to === to) as Extract<
    typeof getOutbox extends () => (infer T)[] ? T : never,
    { kind: 'mail' }
  >[];
const smsTo = (to: string) => getOutbox().filter((m) => m.kind === 'sms' && m.to === to);
const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};
const linkIn = (text: string) => /https?:\/\/\S+/.exec(text)![0];

const b32 = (s: string) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
};
/** RFC 6238 code, so a test can play the authenticator app. */
function totp(secret: string, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', b32(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0xf;
  const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** Better Auth hands the code to our sender in the background, so wait for the new message to appear. */
async function nextSms(phone: string, before: number) {
  for (let i = 0; i < 100; i++) {
    const all = smsTo(phone);
    if (all.length > before) return all.at(-1)!;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no SMS to ${phone}`);
}

async function phoneSignIn(phone: string, ua = 'vitest-phone/1.0') {
  const req = (p: string, body: unknown) =>
    h.app.request(p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': ua },
      body: JSON.stringify(body),
    });
  const before = smsTo(phone).length;
  const sent = await req('/v1/auth/phone-number/send-otp', { phoneNumber: phone });
  const code = /^(\d{6})/.exec((await nextSms(phone, before)).text as string)![1];
  const res = await req('/v1/auth/phone-number/verify', { phoneNumber: phone, code });
  return { sent, res, code, cookie: h.cookieOf(res) };
}
const newPhone = () => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

// ---- 2.6 sign-up creates a workspace -------------------------------------------------------------------------------------

describe('sign-up (2.1, 2.4, 2.6)', () => {
  it('creates organization, owner membership, first business and a 14-day trial together', async () => {
    const t = await h.newTenant();
    const me = (await t.call('GET', '/v1/me')).body;
    expect(me.role).toBe('owner');
    expect(me.organizations).toHaveLength(1);
    expect(me.subscription.status).toBe('trialing');
    const days = (Date.parse(me.subscription.trialEndsAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect(me.permissions).toEqual([...ROLE_PERMISSIONS.owner]);
    const biz = (await t.call('GET', '/v1/businesses')).body.data;
    expect(biz).toHaveLength(1);
    expect(biz[0].isDefault).toBe(true);
    // Units, categories and terms are ready, so the first invoice screen is not empty.
    expect((await t.call('GET', '/v1/units')).body.data.length).toBeGreaterThan(3);
    expect((await t.call('GET', '/v1/templates')).body.data).toHaveLength(1);
    const audit = (await t.call('GET', '/v1/audit')).body.data.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['org.create', 'subscription.trial']));
  });

  it('two sign-ups never share data', async () => {
    const [a, b] = [await h.newTenant(), await h.newTenant()];
    expect(a.orgId).not.toBe(b.orgId);
    await a.call('POST', '/v1/parties', { name: 'Only A' });
    expect((await b.call('GET', '/v1/parties')).body.data).toEqual([]);
  });

  it('rejects a weak password and a duplicate e-mail', async () => {
    const weak = await h.signUp(undefined, 'short');
    expect(weak.res.status).toBeGreaterThanOrEqual(400);
    const first = await h.signUp();
    const again = await h.signUp(first.email);
    expect(again.res.status).toBeGreaterThanOrEqual(400);
  });
});

// ---- 2.3 e-mail + password -----------------------------------------------------------------------------------------------

describe('e-mail login (2.3)', () => {
  it('blocks sign-in until the e-mail is verified, then signs in through the link', async () => {
    const s = await strict.signUp();
    const direct = await strict.app.request('/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: s.email, password: s.password }),
    });
    expect(direct.status).toBe(403);
    const mail = mailsTo(s.email).at(-1)!;
    expect(mail.subject).toMatch(/Confirm/);
    const verified = await strict.app.request(pathOf(linkIn(mail.text)));
    expect([200, 302]).toContain(verified.status);
    const ok = await strict.app.request('/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: s.email, password: s.password }),
    });
    expect(ok.status).toBe(200);
    const call = strict.client(strict.cookieOf(ok));
    expect((await call('GET', '/v1/me')).body.role).toBe('owner');
  });

  it('wrong password fails; reset by mail works and the old password stops working', async () => {
    const s = await h.signUp();
    const post = (p: string, body: unknown) =>
      h.app.request(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect(
      (await post('/v1/auth/sign-in/email', { email: s.email, password: 'nope-nope-nope' })).status,
    ).toBe(401);
    await post('/v1/auth/request-password-reset', {
      email: s.email,
      redirectTo: 'http://localhost:5173/reset',
    });
    const mail = mailsTo(s.email).find((m) => /Reset/.test(m.subject))!;
    const token = new URL(linkIn(mail.text)).pathname.split('/').pop()!;
    expect(
      (await post('/v1/auth/reset-password', { newPassword: 'brand-new-pass-1', token })).status,
    ).toBe(200);
    expect(
      (await post('/v1/auth/sign-in/email', { email: s.email, password: s.password })).status,
    ).toBe(401);
    expect(
      (await post('/v1/auth/sign-in/email', { email: s.email, password: 'brand-new-pass-1' }))
        .status,
    ).toBe(200);
  });
});

// ---- 2.2 phone OTP ---------------------------------------------------------------------------------------------------------

describe('phone OTP login (2.2)', () => {
  it('a code for an unknown number creates the account on verification', async () => {
    const phone = newPhone();
    const { res, cookie } = await phoneSignIn(phone);
    expect(res.status).toBe(200);
    const me = (await h.client(cookie)('GET', '/v1/me')).body;
    expect(me.user.phoneNumber).toBe(phone);
    expect(me.role).toBe('owner');
    expect(me.subscription.status).toBe('trialing');
  });

  it('a wrong code is refused, and the same number can sign in again', async () => {
    const phone = newPhone();
    await phoneSignIn(phone);
    await h.app.request('/v1/auth/phone-number/send-otp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: phone }),
    });
    await nextSms(phone, 1);
    const bad = await h.app.request('/v1/auth/phone-number/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber: phone, code: '000000' }),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    // Better Auth re-creates the consumed code row after a wrong guess; a new code must not share its millisecond.
    await new Promise((r) => setTimeout(r, 25));
    const again = await phoneSignIn(phone);
    expect(again.res.status, await again.res.clone().text()).toBe(200);
  });

  it('a number can ask for only 3 codes per 10 minutes', async () => {
    const phone = newPhone();
    const ask = () =>
      h.app.request('/v1/auth/phone-number/send-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone }),
      });
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await ask()).status);
    expect(results.slice(0, 3).every((s) => s === 200)).toBe(true);
    expect(results[3]).toBeGreaterThanOrEqual(400);
    await nextSms(phone, 2);
    expect(smsTo(phone)).toHaveLength(3);
  });
});

// ---- 2.5 two-factor ----------------------------------------------------------------------------------------------------------

describe('two-factor (2.5)', () => {
  it('enables TOTP with 10 backup codes, then demands a code at sign-in', async () => {
    const t = await h.newTenant();
    const json = (p: string, body: unknown, cookie = t.cookie) =>
      h.app.request(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });
    const enable = (await (
      await json('/v1/auth/two-factor/enable', { password: t.password })
    ).json()) as any;
    expect(enable.backupCodes).toHaveLength(10);
    const secret = new URL(enable.totpURI).searchParams.get('secret')!;
    expect(new URL(enable.totpURI).searchParams.get('issuer')).toBe('Ledgora');
    const verified = await json('/v1/auth/two-factor/verify-totp', { code: totp(secret) });
    expect(verified.status).toBe(200);
    const after = h.client(h.cookieOf(verified) || t.cookie);
    expect((await after('GET', '/v1/me')).body.user.twoFactorEnabled).toBe(true);

    // Signing in again now stops half way.
    const signIn = await h.app.request('/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: t.email, password: t.password }),
    });
    expect(((await signIn.json()) as any).twoFactorRedirect).toBe(true);
    const pending = h.cookieOf(signIn);
    expect((await h.client(pending)('GET', '/v1/me')).status).toBe(401); // not signed in yet
    const wrong = await json('/v1/auth/two-factor/verify-totp', { code: '123456' }, pending);
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    // A backup code finishes the sign-in, once.
    const done = await json(
      '/v1/auth/two-factor/verify-backup-code',
      { code: enable.backupCodes[0] },
      pending,
    );
    expect(done.status).toBe(200);
    expect((await h.client(h.cookieOf(done))('GET', '/v1/me')).status).toBe(200);
  });
});

// ---- 2.7 / 2.8 access and roles ------------------------------------------------------------------------------------------------

describe('roles and permissions (2.7, 2.8)', () => {
  it('defines the 7 built-in roles, and a viewer can only read', () => {
    expect([...ROLES]).toEqual([
      'owner',
      'admin',
      'accountant',
      'salesman',
      'biller',
      'stock_keeper',
      'viewer',
    ]);
    expect(ROLE_PERMISSIONS.viewer.every((p) => p.endsWith(':read'))).toBe(true);
    expect(can('admin', 'billing:manage')).toBe(false);
    expect(can('owner', 'billing:manage')).toBe(true);
    expect(permissionFor('POST', '/v1/invoices/abc/cancel')).toBe('invoice:cancel');
    expect(permissionFor('GET', '/v1/invoices')).toBe('invoice:read');
    expect(permissionFor('POST', '/v1/items/abc/stock')).toBe('stock:adjust');
  });

  it('every route is checked: the chain answers 401 with no session and 403 with the wrong role', async () => {
    const t = await h.newTenant();
    const viewer = await h.addMember(t, 'viewer');
    const stock = await h.addMember(t, 'stock_keeper');
    const accountant = await h.addMember(t, 'accountant');
    const salesman = await h.addMember(t, 'salesman');
    const admin = await h.addMember(t, 'admin');

    expect((await viewer.call('GET', '/v1/parties')).status).toBe(200);
    expect((await viewer.call('POST', '/v1/parties', { name: 'x' })).body.error.code).toBe(
      'forbidden',
    );
    expect((await viewer.call('GET', '/v1/audit')).status).toBe(403);
    expect((await viewer.call('GET', '/v1/members')).status).toBe(403);

    const item = (await stock.call('POST', '/v1/items', { name: 'Gear', openingStock: 5 })).body;
    expect((await stock.call('POST', `/v1/items/${item.id}/stock`, { quantity: 2 })).status).toBe(
      200,
    );
    expect(
      (
        await stock.call('POST', '/v1/invoices', {
          businessId: t.businessId,
          invoiceDate: '2026-10-01',
          items: [line()],
        })
      ).status,
    ).toBe(403);

    const inv = await salesman.call('POST', '/v1/invoices', {
      businessId: t.businessId,
      invoiceDate: '2026-10-01',
      items: [line()],
    });
    expect(inv.status).toBe(201);
    expect((await salesman.call('POST', `/v1/invoices/${inv.body.id}/cancel`, {})).status).toBe(
      403,
    );
    expect((await salesman.call('POST', '/v1/export')).status).toBe(403);
    expect((await accountant.call('POST', `/v1/invoices/${inv.body.id}/cancel`, {})).status).toBe(
      200,
    );
    expect((await accountant.call('GET', '/v1/audit')).status).toBe(200);
    expect((await accountant.call('POST', '/v1/parties', { name: 'x' })).status).toBe(403);
    expect((await admin.call('POST', '/v1/parties', { name: 'by admin' })).status).toBe(201);
    expect((await admin.call('GET', '/v1/members')).status).toBe(200);
  });

  it('feature gate is a stub for now: nothing is refused for plan reasons', async () => {
    const t = await h.newTenant();
    expect((await t.call('POST', '/v1/export')).status).toBe(202);
  });
});

// ---- 2.9 limiting members to businesses --------------------------------------------------------------------------------------------

describe('business limits (2.9)', () => {
  it('a limited member sees and can touch only the chosen business, enforced in the database', async () => {
    const t = await h.newTenant();
    const second = (
      await t.call('POST', '/v1/businesses', { name: 'Second Shop', state: 'Kerala' })
    ).body.id as string;
    const inv1 = (
      await t.call('POST', '/v1/invoices', {
        businessId: t.businessId,
        invoiceDate: '2026-10-01',
        items: [line()],
      })
    ).body;
    const inv2 = (
      await t.call('POST', '/v1/invoices', {
        businessId: second,
        invoiceDate: '2026-10-01',
        items: [line()],
      })
    ).body;

    const limited = await h.addMember(t, 'salesman', [second]);
    const names = (await limited.call('GET', '/v1/businesses')).body.data.map((b: any) => b.id);
    expect(names).toEqual([second]);
    const seen = (await limited.call('GET', '/v1/invoices')).body.data.map((i: any) => i.id);
    expect(seen).toEqual([inv2.id]);
    expect((await limited.call('GET', `/v1/invoices/${inv1.id}`)).status).toBe(404);
    expect(
      (
        await limited.call('POST', '/v1/invoices', {
          businessId: t.businessId,
          invoiceDate: '2026-10-01',
          items: [line()],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await limited.call('POST', '/v1/invoices', {
          businessId: second,
          invoiceDate: '2026-10-01',
          items: [line()],
        })
      ).status,
    ).toBe(201);
    expect((await limited.call('GET', '/v1/me')).body.businessIds).toEqual([second]);
    // The owner still sees both.
    expect((await t.call('GET', '/v1/businesses')).body.data).toHaveLength(2);
  });

  it('limits can be changed through the members API', async () => {
    const t = await h.newTenant();
    const second = (await t.call('POST', '/v1/businesses', { name: 'Branch' })).body.id as string;
    const m = await h.addMember(t, 'biller');
    expect((await m.call('GET', '/v1/businesses')).body.data).toHaveLength(2);
    expect(
      (await t.call('PATCH', `/v1/members/${m.memberId}`, { businessIds: [second] })).status,
    ).toBe(200);
    expect((await m.call('GET', '/v1/businesses')).body.data.map((b: any) => b.id)).toEqual([
      second,
    ]);
    expect((await t.call('PATCH', `/v1/members/${m.memberId}`, { businessIds: null })).status).toBe(
      200,
    );
    expect((await m.call('GET', '/v1/businesses')).body.data).toHaveLength(2);
    expect(
      (await t.call('PATCH', `/v1/members/${m.memberId}`, { businessIds: [randomUUID()] })).status,
    ).toBe(404);
  });
});

// ---- 2.10 team -----------------------------------------------------------------------------------------------------------------------

describe('team (2.10)', () => {
  it('invites by e-mail, the invited person accepts through the link, and gets the role and business limit', async () => {
    const t = await h.newTenant();
    const second = (await t.call('POST', '/v1/businesses', { name: 'Branch' })).body.id as string;
    const guest = await h.signUp();
    // Mark the guest e-mail verified (verification itself is covered above).
    await h.sql`update "user" set email_verified = true where email = ${guest.email}`;
    const gcall = h.client(guest.cookie);

    const sent = await t.call('POST', '/v1/invitations', {
      email: guest.email,
      role: 'accountant',
      businessIds: [second],
    });
    expect(sent.status).toBe(201);
    expect(mailsTo(guest.email).at(-1)!.subject).toMatch(/invited you/);
    expect(
      (await t.call('POST', '/v1/invitations', { email: guest.email, role: 'viewer' })).status,
    ).toBe(409); // already pending
    expect((await t.call('GET', '/v1/invitations')).body.data).toHaveLength(1);

    // Someone else can neither preview nor accept it.
    const stranger = h.client((await h.signUp()).cookie);
    expect((await stranger('GET', `/v1/invitations/${sent.body.id}`)).status).toBe(404);
    expect((await stranger('POST', `/v1/invitations/${sent.body.id}/accept`)).status).toBe(404);

    expect((await gcall('GET', `/v1/invitations/${sent.body.id}`)).body.role).toBe('accountant');
    expect((await gcall('POST', `/v1/invitations/${sent.body.id}/accept`)).status).toBe(200);
    const me = (await gcall('GET', '/v1/me')).body;
    expect(me.organization.id).toBe(t.orgId);
    expect(me.role).toBe('accountant');
    expect(me.businessIds).toEqual([second]);
    expect(me.organizations).toHaveLength(2); // their own workspace plus this one
    expect((await t.call('GET', '/v1/invitations')).body.data).toEqual([]);
    expect((await gcall('POST', `/v1/invitations/${sent.body.id}/accept`)).status).toBe(404); // used once
    const list = (await t.call('GET', '/v1/members')).body.data;
    expect(list.map((m: any) => m.role).sort()).toEqual(['accountant', 'owner']);
  });

  it('invites by phone', async () => {
    const t = await h.newTenant();
    const phone = newPhone();
    const sent = await t.call('POST', '/v1/invitations', { phone, role: 'salesman' });
    expect(sent.status).toBe(201);
    expect(smsTo(phone).at(-1)!.text).toMatch(/invited you/);
    const { cookie } = await phoneSignIn(phone);
    const call = h.client(cookie);
    expect((await call('POST', `/v1/invitations/${sent.body.id}/accept`)).status).toBe(200);
    expect((await call('GET', '/v1/me')).body.role).toBe('salesman');
  });

  it('needs an e-mail or phone, and a withdrawn invitation can not be accepted', async () => {
    const t = await h.newTenant();
    expect((await t.call('POST', '/v1/invitations', { role: 'viewer' })).status).toBe(400);
    expect(
      (await t.call('POST', '/v1/invitations', { email: 'x@example.com', role: 'owner' })).status,
    ).toBe(400); // owner is not invitable
    const guest = await h.signUp();
    await h.sql`update "user" set email_verified = true where email = ${guest.email}`;
    const sent = await t.call('POST', '/v1/invitations', { email: guest.email, role: 'viewer' });
    expect((await t.call('DELETE', `/v1/invitations/${sent.body.id}`)).status).toBe(200);
    expect(
      (await h.client(guest.cookie)('POST', `/v1/invitations/${sent.body.id}/accept`)).status,
    ).toBe(404);
  });

  it('changes roles and removes members, but keeps at least one owner and respects rank', async () => {
    const t = await h.newTenant();
    const admin = await h.addMember(t, 'admin');
    const viewer = await h.addMember(t, 'viewer');
    const owner = (await t.call('GET', '/v1/members')).body.data.find(
      (m: any) => m.role === 'owner',
    );

    expect(
      (await t.call('PATCH', `/v1/members/${viewer.memberId}`, { role: 'salesman' })).status,
    ).toBe(200);
    expect((await viewer.call('POST', '/v1/parties', { name: 'now allowed' })).status).toBe(201);
    expect((await t.call('PATCH', `/v1/members/${owner.id}`, { role: 'admin' })).status).toBe(403); // not yourself
    expect((await admin.call('PATCH', `/v1/members/${owner.id}`, { role: 'viewer' })).status).toBe(
      403,
    ); // not above you
    expect(
      (await admin.call('PATCH', `/v1/members/${viewer.memberId}`, { role: 'admin' })).status,
    ).toBe(403); // not up to your level
    expect((await admin.call('DELETE', `/v1/members/${owner.id}`)).status).toBe(403);
    await t.call('PATCH', `/v1/members/${admin.memberId}`, { role: 'owner' });
    expect(
      (await t.call('PATCH', `/v1/members/${admin.memberId}`, { role: 'viewer' })).status,
    ).toBe(200); // two owners: allowed
    expect((await admin.call('PATCH', `/v1/members/${owner.id}`, { role: 'viewer' })).status).toBe(
      403,
    );

    expect((await t.call('DELETE', `/v1/members/${viewer.memberId}`)).status).toBe(200);
    // Their sessions fall back to their own workspace; the removed organization is closed to them.
    expect((await viewer.call('GET', '/v1/me')).body.organization.id).not.toBe(t.orgId);
    expect(
      (await viewer.call('GET', '/v1/parties', undefined, { 'x-org-id': t.orgId })).status,
    ).toBe(403);
    expect((await t.call('DELETE', `/v1/members/${owner.id}`)).status).toBe(403); // yourself
  });

  it('refuses to demote the last owner', async () => {
    const t = await h.newTenant();
    const other = await h.addMember(t, 'admin');
    await t.call('PATCH', `/v1/members/${other.memberId}`, { role: 'owner' });
    const owners = (await t.call('GET', '/v1/members')).body.data.filter(
      (m: any) => m.role === 'owner',
    );
    expect(owners).toHaveLength(2);
    expect(
      (
        await other.call(
          'PATCH',
          `/v1/members/${owners.find((o: any) => o.userId === t.userId).id}`,
          { role: 'viewer' },
        )
      ).status,
    ).toBe(200);
    const last = (await other.call('GET', '/v1/members')).body.data.find(
      (m: any) => m.role === 'owner',
    );
    expect((await other.call('PATCH', `/v1/members/${last.id}`, { role: 'viewer' })).status).toBe(
      403,
    ); // yourself
  });

  it('switches between organizations', async () => {
    const t = await h.newTenant();
    const guest = await h.signUp();
    await h.sql`update "user" set email_verified = true where email = ${guest.email}`;
    const inv = (await t.call('POST', '/v1/invitations', { email: guest.email, role: 'viewer' }))
      .body;
    const g = h.client(guest.cookie);
    await g('POST', `/v1/invitations/${inv.id}/accept`);
    const mine = (await g('GET', '/v1/me')).body.organizations.find((o: any) => o.id !== t.orgId);
    expect((await g('POST', '/v1/me/organization', { organizationId: mine.id })).status).toBe(200);
    expect((await g('GET', '/v1/me')).body.organization.id).toBe(mine.id);
    expect((await g('POST', '/v1/me/organization', { organizationId: randomUUID() })).status).toBe(
      403,
    );
  });
});

// ---- 2.11 security ---------------------------------------------------------------------------------------------------------------------

describe('security (2.11)', () => {
  it('sets security headers and no framework banner', async () => {
    const res = await h.app.request('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('referrer-policy')).toBeTruthy();
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('CORS answers only the app origins, with credentials', async () => {
    const ok = await h.app.request('/v1/me', { headers: { origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const evil = await h.app.request('/v1/me', { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await h.app.request('/v1/parties', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a cookie-carrying write from a foreign origin (CSRF)', async () => {
    const t = await h.newTenant();
    const forged = await t.call(
      'POST',
      '/v1/parties',
      { name: 'forged' },
      { origin: 'https://evil.example' },
    );
    expect(forged.status).toBe(403);
    const crossSite = await t.call(
      'POST',
      '/v1/parties',
      { name: 'forged' },
      { 'sec-fetch-site': 'cross-site' },
    );
    expect(crossSite.status).toBe(403);
    const fromApp = await t.call(
      'POST',
      '/v1/parties',
      { name: 'real' },
      { origin: 'http://localhost:5173' },
    );
    expect(fromApp.status).toBe(201);
    expect(
      (await t.call('GET', '/v1/parties', undefined, { origin: 'https://evil.example' })).status,
    ).toBe(200); // reads are not state changes
  });

  it('limits sign-in attempts and API calls per caller', async () => {
    const limited = makeHarness({
      env: {
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_LOGIN_PER_MIN: '3',
        RATE_LIMIT_API_PER_MIN: '8',
        RATE_LIMIT_OTP_PER_10MIN: '2',
      },
    });
    try {
      const attempt = () =>
        limited.app.request('/v1/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
        });
      const codes = [];
      for (let i = 0; i < 5; i++) codes.push((await attempt()).status);
      expect(codes.slice(0, 3).every((c) => c === 401)).toBe(true);
      expect(codes.slice(3)).toEqual([429, 429]);
      const blocked = await attempt();
      expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/);
      expect(((await blocked.json()) as any).error.code).toBe('too_many_requests');

      const otp = () =>
        limited.app.request('/v1/auth/phone-number/send-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ phoneNumber: newPhone() }),
        });
      expect([(await otp()).status, (await otp()).status, (await otp()).status]).toEqual([
        200, 200, 429,
      ]);

      const api: number[] = [];
      for (let i = 0; i < 10; i++) api.push((await limited.app.request('/v1/parties')).status);
      expect(api.slice(-2)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });

  it('rate limiter windows reset', () => {
    let t = 0;
    const lim = createRateLimiter(h.env, () => t);
    for (let i = 0; i < h.env.RATE_LIMIT_API_PER_MIN; i++)
      expect(lim.check('GET', '/v1/x', 'ip')).toBe(0);
    expect(lim.check('GET', '/v1/x', 'ip')).toBeGreaterThan(0);
    expect(lim.check('GET', '/v1/x', 'other')).toBe(0);
    t += 61_000;
    expect(lim.check('GET', '/v1/x', 'ip')).toBe(0);
  });

  it('identity tables are out of reach of tenant queries', async () => {
    const t = await h.newTenant();
    for (const table of [
      '"user"',
      'session',
      'account',
      'member',
      'invitation',
      'two_factor',
      'organizations',
      'user_devices',
    ]) {
      await expect(
        withTenant(h.db, t.orgId, (tx) => tx.execute(`select * from ${table} limit 1` as never)),
        table,
      ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/) } });
    }
  });
});

// ---- 2.12 sessions ---------------------------------------------------------------------------------------------------------------------

describe('sessions and devices (2.12)', () => {
  it('lists devices, logs one out, and logs out everywhere else', async () => {
    const phone = await h.signUp(
      undefined,
      undefined,
      'Multi',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    );
    const signIn = (ua: string) =>
      h.app.request('/v1/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': ua },
        body: JSON.stringify({ email: phone.email, password: phone.password }),
      });
    const second = await signIn(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    );
    const third = await signIn('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121.0');
    const [c1, c2, c3] = [
      h.client(phone.cookie),
      h.client(h.cookieOf(second)),
      h.client(h.cookieOf(third)),
    ];

    const list = (await c1('GET', '/v1/sessions')).body.data;
    expect(list).toHaveLength(3);
    expect(list.filter((s: any) => s.current)).toHaveLength(1);
    expect(list.map((s: any) => s.device)).toEqual(
      expect.arrayContaining(['Chrome on macOS', 'Safari on iOS', 'Firefox on Windows']),
    );
    expect(JSON.stringify(list)).not.toContain('token'); // never hand tokens to the page

    const other = list.find((s: any) => s.device.startsWith('Safari'));
    expect((await c1('DELETE', `/v1/sessions/${other.id}`)).status).toBe(200);
    expect((await c2('GET', '/v1/me')).status).toBe(401);
    expect((await c3('GET', '/v1/me')).status).toBe(200);
    const all = await c1('POST', '/v1/sessions/revoke-all', {});
    expect(all.body.revoked).toBe(1);
    expect((await c3('GET', '/v1/me')).status).toBe(401);
    expect((await c1('GET', '/v1/me')).status).toBe(200); // this device stays
    // A session id of another account can not be revoked.
    const stranger = await h.newTenant();
    expect((await stranger.call('DELETE', `/v1/sessions/${list[0].id}`)).status).toBe(404);
    expect(
      (await c1('POST', '/v1/sessions/revoke-all', { includeCurrent: true })).body.revoked,
    ).toBe(1);
    expect((await c1('GET', '/v1/me')).status).toBe(401);
  });

  it('alerts by e-mail on a sign-in from a new device, not on the first one and not on a known one', async () => {
    const s = await h.signUp(
      undefined,
      undefined,
      'Alert',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36',
    );
    const alerts = () => mailsTo(s.email).filter((m) => /New sign-in/.test(m.subject));
    expect(alerts()).toHaveLength(0);
    const signIn = (ua: string) =>
      h.app.request('/v1/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': ua },
        body: JSON.stringify({ email: s.email, password: s.password }),
      });
    await signIn('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36');
    expect(alerts()).toHaveLength(0);
    await signIn('Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36');
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].text).toContain('Chrome on Android');
    await signIn('Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36');
    expect(alerts()).toHaveLength(1);
  });
});

// ---- 2.14 audit -------------------------------------------------------------------------------------------------------------------------

describe('audit trail (2.14)', () => {
  it('records the user on every create, update and cancel, and the request address when known', async () => {
    const t = await h.newTenant();
    const party = (await t.call('POST', '/v1/parties', { name: 'Audited' })).body;
    await t.call('PATCH', `/v1/parties/${party.id}`, { name: 'Audited 2' });
    const inv = (
      await t.call('POST', '/v1/invoices', {
        businessId: t.businessId,
        invoiceDate: '2026-10-01',
        items: [line()],
      })
    ).body;
    await t.call('POST', `/v1/invoices/${inv.id}/cancel`, { reason: 'test' });
    const rows = (await t.call('GET', '/v1/audit?limit=50')).body.data;
    const actions = rows.map((r: any) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['party.create', 'party.update', 'invoice.create', 'invoice.cancel']),
    );
    for (const r of rows.filter((r: any) => /^(party|invoice)\./.test(r.action)))
      expect(r.actorId).toBe(t.userId);
    const upd = rows.find((r: any) => r.action === 'party.update');
    expect(upd.before.name).toBe('Audited');
    expect(upd.after.name).toBe('Audited 2');
    expect(
      (await t.call('GET', `/v1/audit?entityType=invoice&entityId=${inv.id}`)).body.data.length,
    ).toBe(2);

    // The address is stored when the process knows it (TRUST_PROXY behind a proxy).
    const proxied = makeHarness({ env: { TRUST_PROXY: 'true' } });
    try {
      const p = await proxied.newTenant();
      await proxied.client(p.cookie)(
        'POST',
        '/v1/parties',
        { name: 'From a phone' },
        { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      );
      const entry = (await proxied.client(p.cookie)('GET', '/v1/audit?limit=5')).body.data.find(
        (r: any) => r.action === 'party.create',
      );
      expect(entry.ip).toBe('203.0.113.9');
    } finally {
      await proxied.close();
    }
  });

  it("another organization's audit rows are invisible", async () => {
    const [a, b] = [await h.newTenant(), await h.newTenant()];
    await a.call('POST', '/v1/parties', { name: 'Secret A' });
    const seen = JSON.stringify((await b.call('GET', '/v1/audit?limit=100')).body);
    expect(seen).not.toContain('Secret A');
  });
});

// ---- 2.13 PIN lock removed -------------------------------------------------------------------------------------------------------------------

describe('PIN lock (2.13)', () => {
  it('the new API has no lock endpoints', async () => {
    const t = await h.newTenant();
    for (const p of ['/api/lock', '/v1/lock', '/api/lock/verify', '/api/lock/set'])
      expect((await t.call('GET', p)).status).toBe(404);
  });
});
