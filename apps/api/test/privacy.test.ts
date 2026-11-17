import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeHarness, type Tenant } from './helpers.ts';
import { clearOutbox, getOutbox } from '../src/mail/index.ts';

const h = makeHarness();
h.env.SUPPORT_EMAIL = 'privacy@example.com';
let t: Tenant;
beforeAll(async () => {
  t = await h.newTenant();
});
afterAll(() => h.close());

describe('consent and data requests', () => {
  it('records consent in the audit log', async () => {
    const res = await t.call('POST', '/v1/privacy/consent', { version: '2026-11-16' });
    expect(res.status, res.text).toBe(200);
    const log = await t.call('GET', '/v1/audit');
    expect(JSON.stringify(log.body)).toContain('consent.accepted');
  });
  it('an erasure request is recorded, mailed to support and acknowledged', async () => {
    clearOutbox();
    const res = await t.call('POST', '/v1/privacy/requests', {
      kind: 'erasure',
      note: 'Close and delete my account',
    });
    expect(res.status, res.text).toBe(200);
    const mails = getOutbox().filter((m) => m.kind === 'mail');
    expect(mails.some((m) => m.to === 'privacy@example.com' && m.subject.includes('erasure'))).toBe(
      true,
    );
    expect(
      mails.some((m) => m.to === t.email && m.subject === 'We received your data request'),
    ).toBe(true);
    expect(JSON.stringify((await t.call('GET', '/v1/audit')).body)).toContain('privacy.request');
  });
  it('refuses an unknown kind and a signed-out caller', async () => {
    expect((await t.call('POST', '/v1/privacy/requests', { kind: 'sell' })).status).toBe(400);
    const res = await h.app.request('/v1/privacy/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"version":"2026-11-16"}',
    });
    expect(res.status).toBe(401);
  });
});
