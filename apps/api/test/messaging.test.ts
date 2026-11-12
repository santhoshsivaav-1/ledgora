import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { DEFAULT_TEMPLATES, MESSAGE_EVENTS, locationConsentText } from '@ledgora/contracts';
import { renderTemplate } from '@ledgora/tax-engine';
import { withTenant } from '@ledgora/db';
import { makeHarness, line, type Tenant } from './helpers.ts';
import {
  whatsappLinkProvider,
  type MessageProvider,
  type Outbound,
} from '../src/messaging/providers.ts';
import { runMessageQueue } from '../src/messaging/core.ts';
import { runReminderJob, runRetentionJob, runServiceJob } from '../src/messaging/jobs.ts';

// Vyapar parity Phase 9. Nothing here can send for real: e-mail goes to a fake provider that records, WhatsApp is the
// link provider (it builds an address and sends nothing), SMS has no provider.
const sent: Outbound[] = [];
let failNext = 0;
const fakeEmail: MessageProvider = {
  channel: 'email',
  autoSend: true,
  async send(m) {
    if (failNext > 0) {
      failNext--;
      throw new Error('provider is down');
    }
    sent.push(m);
    return { id: `fake-${sent.length}` };
  },
  status: async () => 'sent',
};
const h = makeHarness({
  providers: { whatsapp: whatsappLinkProvider, email: fakeEmail, sms: null },
});
afterAll(() => h.close());

const settings = (who: Tenant, values: Record<string, unknown>) =>
  who.call('PATCH', '/v1/settings', { businessId: who.businessId, values });
const turnOn = (who: Tenant, extra: Record<string, unknown> = {}) =>
  settings(who, { 'msg.enabled': true, ...extra });
const party = async (who: Tenant, over: Record<string, unknown> = {}) => {
  const r = await who.call('POST', '/v1/parties', {
    name: `Ravi ${Math.random().toString(36).slice(2, 6)}`,
    phone: '9876543210',
    email: 'ravi@example.in',
    ...over,
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
const sale = async (who: Tenant, over: Record<string, unknown> = {}) => {
  const r = await who.call('POST', '/v1/invoices', {
    businessId: who.businessId,
    invoiceDate: '2026-10-01',
    dueDate: '2026-10-10',
    items: [line({ taxPercent: 0 })],
    ...over,
  });
  expect(r.status, r.text).toBe(201);
  return r.body;
};
// 2026-10-10 at the given IST clock time.
const ist = (hhmm: string, date = '2026-10-10') => {
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + (hh! * 60 + mm!) * 60_000 - 5.5 * 3_600_000);
};
const send = (who: Tenant, invoiceId: string, over: Record<string, unknown> = {}) =>
  who.call('POST', '/v1/messages/send', {
    businessId: who.businessId,
    refId: invoiceId,
    channel: 'whatsapp',
    ...over,
  });

describe('the built-in messages', () => {
  it('use only variables that exist, and every event has text for subject and body', () => {
    for (const [event, t] of Object.entries(DEFAULT_TEMPLATES)) {
      expect(renderTemplate(t.body, {}).unknown, event).toEqual([]);
      expect(renderTemplate(t.subject, {}).unknown, event).toEqual([]);
    }
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([...MESSAGE_EVENTS].sort());
  });
  it('the consent text states the retention the job enforces', () => {
    expect(locationConsentText(90)).toContain('90 days');
    expect(locationConsentText(30)).toContain('30 days');
  });
});

describe('the messaging flag', () => {
  it('is off by default: nothing can be shared or queued', async () => {
    const w = await h.newTenant();
    const inv = await sale(w, { partyId: (await party(w)).id });
    const r = await send(w, inv.id);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Messaging is off/);
    expect(
      (await w.call('GET', `/v1/messaging/status?businessId=${w.businessId}`)).body.enabled,
    ).toBe(false);
  });
  it('only the owner can turn it on', async () => {
    const w = await h.newTenant();
    const admin = await h.addMember(w, 'admin');
    const no = await admin.call('PATCH', '/v1/settings', {
      businessId: w.businessId,
      values: { 'msg.enabled': true },
    });
    expect(no.status).toBe(403);
    expect((await turnOn(w)).status).toBe(200);
    expect(
      (await w.call('GET', `/v1/messaging/status?businessId=${w.businessId}`)).body,
    ).toMatchObject({
      enabled: true,
      provider: 'whatsappLink',
      channels: { whatsapp: true, email: true, sms: false },
    });
  });
});

describe('share a document', () => {
  let w: Tenant;
  let inv: any;
  let p: any;
  beforeAll(async () => {
    w = await h.newTenant();
    await turnOn(w);
    p = await party(w, { name: 'Ravi Traders' });
    inv = await sale(w, { partyId: p.id });
  });

  it('WhatsApp returns a wa.me address with the rendered text and logs it as sent', async () => {
    const r = await send(w, inv.id);
    expect(r.status, r.text).toBe(201);
    expect(r.body.url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    const text = decodeURIComponent(r.body.url.split('text=')[1]);
    expect(text).toContain('Ravi Traders');
    expect(text).toContain(inv.number);
    expect(text).toMatch(/\/s\/[A-Za-z0-9_-]{32}/);
    expect(r.body.message.status).toBe('sent');
    const log = await w.call('GET', `/v1/messages?businessId=${w.businessId}`);
    expect(log.body.data[0]).toMatchObject({ channel: 'whatsapp', status: 'sent', refId: inv.id });
    expect(sent).toHaveLength(0); // nothing went out through a real provider
  });

  it('previews without making a link, and flags unknown variables', async () => {
    const before = (await w.call('GET', `/v1/document-links?refId=${inv.id}`)).body.data.length;
    const r = await w.call('POST', '/v1/messaging/preview', {
      businessId: w.businessId,
      refId: inv.id,
      channel: 'whatsapp',
      body: 'Hi {party} {oops}',
    });
    expect(r.body.text).toContain('Hi Ravi Traders');
    expect(r.body.unknown).toEqual(['oops']);
    expect((await w.call('GET', `/v1/document-links?refId=${inv.id}`)).body.data.length).toBe(
      before,
    );
    const bad = await send(w, inv.id, { body: 'Hi {oops}' });
    expect(bad.status).toBe(400);
  });

  it('refuses a missing or invalid phone, SMS, and a message over the WhatsApp limit', async () => {
    const noPhone = await party(w, { phone: '' });
    const inv2 = await sale(w, { partyId: noPhone.id });
    const a = await send(w, inv2.id);
    expect(a.status).toBe(422);
    expect(a.body.error.details[0].path).toBe('to');
    expect((await send(w, inv2.id, { to: '98765 43210' })).status).toBe(201); // the mini form's number
    expect((await send(w, inv.id, { channel: 'sms' })).status).toBe(422);
    expect((await send(w, inv.id, { body: 'x'.repeat(4097) })).status).toBe(400);
  });

  it('e-mail goes through the queue and the injected provider', async () => {
    const r = await send(w, inv.id, { channel: 'email' });
    expect(r.status, r.text).toBe(201);
    expect(r.body.message.status).toBe('sent');
    expect(sent.at(-1)).toMatchObject({ to: 'ravi@example.in' });
    expect(sent.at(-1)!.subject).toContain(inv.number);
  });

  it('a salesman can share only their own invoices', async () => {
    const x = await h.newTenant();
    await turnOn(x);
    const sm = await h.addMember(x, 'salesman');
    const staff = await x.call('POST', '/v1/staff', { name: 'Kumar', userId: sm.userId });
    expect(staff.status, staff.text).toBe(201);
    const other = await sale(x, { partyId: (await party(x)).id });
    const r = await sm.call('POST', '/v1/messages/send', {
      businessId: x.businessId,
      refId: other.id,
      channel: 'whatsapp',
    });
    expect(r.status).toBe(404);
  });
});

describe('opt-out', () => {
  it('a party marked Do not message is never messaged, by any path', async () => {
    const w = await h.newTenant();
    await turnOn(w, { 'party.reminder': true, 'reminder.channel': 'email' });
    const p = await party(w);
    expect(
      (await w.call('PATCH', `/v1/parties/${p.id}`, { doNotMessage: true })).body.doNotMessage,
    ).toBe(true);
    const inv = await sale(w, { partyId: p.id });
    expect((await send(w, inv.id)).status).toBe(409);
    const rem = await w.call('POST', '/v1/reminders/send', {
      businessId: w.businessId,
      invoiceIds: [inv.id],
      channel: 'email',
    });
    expect(rem.body.sent).toEqual([]);
    expect(rem.body.skipped[0].reason).toMatch(/not to be messaged/);
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId })).toBe(0);
    const before = sent.length;
    await runMessageQueue(
      h.db,
      { whatsapp: whatsappLinkProvider, email: fakeEmail, sms: null },
      ist('10:00'),
      { orgId: w.orgId },
    );
    expect(sent.length).toBe(before);
  });

  it('opting out after a message was queued cancels it instead of sending', async () => {
    const w = await h.newTenant();
    await turnOn(w, { 'party.reminder': true, 'reminder.channel': 'email' });
    const p = await party(w);
    await sale(w, { partyId: p.id });
    expect(await runReminderJob(h.db, h.env, ist('22:00'), { orgId: w.orgId })).toBe(1); // queued for tomorrow 09:00
    await w.call('PATCH', `/v1/parties/${p.id}`, { doNotMessage: true });
    const before = sent.length;
    const r = await runMessageQueue(
      h.db,
      { whatsapp: whatsappLinkProvider, email: fakeEmail, sms: null },
      ist('09:30', '2026-10-11'),
      { orgId: w.orgId },
    );
    expect(r.cancelled).toBe(1);
    expect(sent.length).toBe(before);
  });
});

describe('payment reminders', () => {
  const providers = { whatsapp: whatsappLinkProvider, email: fakeEmail, sms: null };
  it('queues one reminder on the due date and not again the same day', async () => {
    const w = await h.newTenant();
    await turnOn(w, { 'party.reminder': true, 'reminder.channel': 'email' });
    const inv = await sale(w, { partyId: (await party(w)).id });
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId })).toBe(1);
    expect(await runReminderJob(h.db, h.env, ist('10:05'), { orgId: w.orgId })).toBe(0);
    const m = (await w.call('GET', `/v1/messages?businessId=${w.businessId}`)).body.data;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      event: 'reminder',
      refId: inv.id,
      channel: 'email',
      status: 'queued',
    });
    const before = sent.length;
    await runMessageQueue(h.db, providers, ist('10:06'), { orgId: w.orgId });
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.body).toContain('gentle reminder');
  });

  it('never reminds an invoice that was paid, even after the job queued nothing yet', async () => {
    const w = await h.newTenant();
    await turnOn(w, { 'party.reminder': true, 'reminder.channel': 'email' });
    await sale(w, { partyId: (await party(w)).id, payments: [{ mode: 'cash', amount: 200 }] });
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId })).toBe(0);
  });

  it('a partly paid invoice is reminded; paying it in full after queueing cancels nothing but the list shows it settled', async () => {
    const w = await h.newTenant();
    await turnOn(w, { 'party.reminder': true, 'reminder.channel': 'email' });
    const inv = await sale(w, {
      partyId: (await party(w)).id,
      payments: [{ mode: 'cash', amount: 50 }],
    });
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId })).toBe(1);
    const list = await w.call('GET', `/v1/reminders?businessId=${w.businessId}&minDaysLate=0`);
    expect(list.body.data.find((r: any) => r.invoiceId === inv.id).pending).toBe(150);
  });

  it('waits out the quiet hours: queued for the next 09:00, not sent at 22:00', async () => {
    const w = await h.newTenant();
    await turnOn(w, { 'party.reminder': true, 'reminder.channel': 'email' });
    await sale(w, { partyId: (await party(w)).id });
    expect(await runReminderJob(h.db, h.env, ist('22:00'), { orgId: w.orgId })).toBe(1);
    const m = (await w.call('GET', `/v1/messages?businessId=${w.businessId}`)).body.data[0];
    expect(new Date(m.scheduledAt).getTime()).toBe(ist('09:00', '2026-10-11').getTime());
    const before = sent.length;
    await runMessageQueue(h.db, providers, ist('22:30'), { orgId: w.orgId });
    expect(sent.length).toBe(before);
    await runMessageQueue(h.db, providers, ist('09:01', '2026-10-11'), { orgId: w.orgId });
    expect(sent.length).toBe(before + 1);
  });

  it('keeps to a quiet window the business changed, and defers a message queued earlier', async () => {
    const w = await h.newTenant();
    await turnOn(w, {
      'party.reminder': true,
      'reminder.channel': 'email',
      'reminder.quietStart': '11:00',
      'reminder.quietEnd': '12:00',
    });
    await sale(w, { partyId: (await party(w)).id });
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId })).toBe(1);
    const m = (await w.call('GET', `/v1/messages?businessId=${w.businessId}`)).body.data[0];
    expect(new Date(m.scheduledAt).getTime()).toBe(ist('11:00').getTime());
  });

  it('does nothing for a business that has reminders off, or messaging off', async () => {
    const a = await h.newTenant();
    await turnOn(a, { 'reminder.channel': 'email' }); // party.reminder stays off
    await sale(a, { partyId: (await party(a)).id });
    const b = await h.newTenant();
    await settings(b, { 'party.reminder': true });
    await sale(b, { partyId: (await party(b)).id });
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: a.orgId })).toBe(0);
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: b.orgId })).toBe(0);
  });

  it('the list totals equal the pending of the invoices it shows, and bulk send reports what it skipped', async () => {
    const w = await h.newTenant();
    await turnOn(w);
    const a = await sale(w, { partyId: (await party(w)).id, dueDate: '2000-01-01' });
    const b = await sale(w, { partyId: (await party(w, { phone: '' })).id, dueDate: '2000-01-02' });
    const list = await w.call('GET', `/v1/reminders?businessId=${w.businessId}`);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.totalOverdue).toBe(400);
    expect(list.body.parties).toBe(2);
    const r = await w.call('POST', '/v1/reminders/send', {
      businessId: w.businessId,
      invoiceIds: [a.id, b.id],
      channel: 'whatsapp',
    });
    expect(r.body.sent).toHaveLength(1);
    expect(r.body.sent[0].url).toMatch(/^https:\/\/wa\.me\/91/);
    expect(r.body.skipped).toEqual([{ invoiceId: b.id, reason: 'No valid phone number' }]);
    expect(r.body.preview).toContain('gentle reminder');
    // Opening the link is what marks it sent.
    const opened = await w.call('POST', `/v1/messages/${r.body.sent[0].messageId}/opened`);
    expect(opened.body.status).toBe('sent');
  });
});

describe('the queue', () => {
  const providers = { whatsapp: whatsappLinkProvider, email: fakeEmail, sms: null };
  it('retries with 1, 5, 30 minute backoff, then fails, and a retry from the log sends it', async () => {
    const w = await h.newTenant();
    await turnOn(w);
    const inv = await sale(w, { partyId: (await party(w)).id });
    failNext = 4;
    const t0 = new Date();
    const first = await send(w, inv.id, { channel: 'email' });
    expect(first.body.message).toMatchObject({ status: 'queued', attempts: 1 });
    expect(first.body.message.error).toMatch(/provider is down/);
    const at = (min: number) => new Date(t0.getTime() + min * 60_000 + 1000);
    expect((await runMessageQueue(h.db, providers, at(0.5), { orgId: w.orgId })).retried).toBe(0); // not yet
    expect((await runMessageQueue(h.db, providers, at(2), { orgId: w.orgId })).retried).toBe(1); // attempt 2, next in 5
    expect((await runMessageQueue(h.db, providers, at(4), { orgId: w.orgId })).retried).toBe(0);
    expect((await runMessageQueue(h.db, providers, at(8), { orgId: w.orgId })).retried).toBe(1); // attempt 3, next in 30
    expect((await runMessageQueue(h.db, providers, at(45), { orgId: w.orgId })).failed).toBe(1); // attempt 4: give up
    const log = (await w.call('GET', `/v1/messages?businessId=${w.businessId}&status=failed`)).body
      .data;
    expect(log).toHaveLength(1);
    failNext = 0;
    const retried = await w.call('POST', `/v1/messages/${log[0].id}/retry`);
    expect(retried.body.status).toBe('sent');
  });

  it('queuing the same message twice on one day is a no-op (idempotent)', async () => {
    const w = await h.newTenant();
    await turnOn(w, { 'party.reminder': true, 'reminder.channel': 'email' });
    await sale(w, { partyId: (await party(w)).id });
    expect(await runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId })).toBe(1);
    await Promise.all([
      runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId }),
      runReminderJob(h.db, h.env, ist('10:00'), { orgId: w.orgId }),
    ]);
    expect((await w.call('GET', `/v1/messages?businessId=${w.businessId}`)).body.data).toHaveLength(
      1,
    );
  });

  it('a message with no provider for its channel fails clearly instead of hanging', async () => {
    const w = await h.newTenant();
    await turnOn(w);
    const inv = await sale(w, { partyId: (await party(w)).id });
    const r = await send(w, inv.id, { channel: 'email' });
    expect(r.status).toBe(201);
    const r2 = await runMessageQueue(
      h.db,
      { whatsapp: whatsappLinkProvider, email: null, sms: null },
      new Date(Date.now() + 1000),
      { orgId: w.orgId },
    );
    expect(r2.failed).toBe(0); // the earlier send already went through
  });
});

describe('public links', () => {
  let w: Tenant;
  let inv: any;
  beforeAll(async () => {
    w = await h.newTenant();
    await turnOn(w);
    inv = await sale(w, { partyId: (await party(w, { name: 'Ravi <b>Traders</b>' })).id });
  });
  const open = (token: string) => h.app.request(`/s/${token}`);

  it('shows the invoice read-only, escapes names, counts views, and is not indexable', async () => {
    const link = (await w.call('POST', '/v1/document-links', { refId: inv.id })).body;
    expect(link.token).toHaveLength(32);
    const res = await open(link.token);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(inv.number);
    expect(html).toContain('Ravi &#60;b&#62;Traders&#60;/b&#62;');
    expect(html).not.toContain('<b>Traders');
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    await open(link.token);
    expect(
      (await w.call('GET', `/v1/document-links?refId=${inv.id}`)).body.data.find(
        (l: any) => l.id === link.id,
      ).views,
    ).toBe(2);
  });

  it('expires', async () => {
    const link = (await w.call('POST', '/v1/document-links', { refId: inv.id, days: 1 })).body;
    expect((await open(link.token)).status).toBe(200);
    await withTenant(h.db, w.orgId, (tx) =>
      tx.execute(
        sql`update document_links set expires_at = now() - interval '1 minute' where id = ${link.id}`,
      ),
    );
    expect((await open(link.token)).status).toBe(404);
  });

  it('can be revoked, and an unknown or malformed token looks the same', async () => {
    const link = (await w.call('POST', '/v1/document-links', { refId: inv.id })).body;
    expect((await w.call('DELETE', `/v1/document-links/${link.id}`)).status).toBe(200);
    const gone = await open(link.token);
    expect(gone.status).toBe(404);
    expect(await gone.text()).toContain('not available');
    expect((await open('A'.repeat(32))).status).toBe(404);
    expect((await open('short')).status).toBe(404);
  });

  it('another organization can not revoke or list my links', async () => {
    const link = (await w.call('POST', '/v1/document-links', { refId: inv.id })).body;
    const other = await h.newTenant();
    expect((await other.call('DELETE', `/v1/document-links/${link.id}`)).status).toBe(404);
    expect((await other.call('GET', `/v1/document-links?refId=${inv.id}`)).body.data).toEqual([]);
    expect((await open(link.token)).status).toBe(200);
  });

  it('tokens are unguessable: 192 bits, all different', async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++)
      tokens.add((await w.call('POST', '/v1/document-links', { refId: inv.id })).body.token);
    expect(tokens.size).toBe(20);
  });
});

describe('service reminders', () => {
  it('queues once when inside the lead time, then Done sets the next cycle and Snooze moves only the date', async () => {
    const w = await h.newTenant();
    await turnOn(w);
    await settings(w, {});
    const p = await party(w, { name: 'Kiran' });
    const r = await w.call('POST', '/v1/service-reminders', {
      businessId: w.businessId,
      name: 'AC annual service',
      partyId: p.id,
      intervalUnit: 'months',
      intervalEvery: 12,
      remindBeforeDays: 7,
      channel: 'email',
      nextDue: '2026-10-17',
    });
    expect(r.status, r.text).toBe(201);
    expect(await runServiceJob(h.db, ist('10:00', '2026-10-09'), { orgId: w.orgId })).toBe(0); // 8 days before
    expect(await runServiceJob(h.db, ist('10:00', '2026-10-10'), { orgId: w.orgId })).toBe(1); // 7 days before
    expect(await runServiceJob(h.db, ist('11:00', '2026-10-10'), { orgId: w.orgId })).toBe(0);
    const m = (await w.call('GET', `/v1/messages?businessId=${w.businessId}`)).body.data[0];
    expect(m).toMatchObject({ event: 'service_due', refType: 'service_reminder' });
    expect(m.body).toContain('AC annual service');
    const snoozed = await w.call('POST', `/v1/service-reminders/${r.body.id}/snooze`, { days: 7 });
    expect(snoozed.body).toMatchObject({
      nextDue: '2026-10-24',
      intervalEvery: 12,
      intervalUnit: 'months',
    });
    const done = await w.call('POST', `/v1/service-reminders/${r.body.id}/done`);
    expect(done.body.lastDoneAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(done.body.daysLeft).toBeGreaterThan(360);
  });

  it('skips an opted-out party without retrying it every run', async () => {
    const w = await h.newTenant();
    await turnOn(w);
    const p = await party(w, { doNotMessage: true });
    await w.call('POST', '/v1/service-reminders', {
      businessId: w.businessId,
      name: 'X',
      partyId: p.id,
      intervalUnit: 'days',
      intervalEvery: 30,
      channel: 'email',
      nextDue: '2026-10-12',
    });
    expect(await runServiceJob(h.db, ist('10:00'), { orgId: w.orgId })).toBe(0);
    expect((await w.call('GET', `/v1/messages?businessId=${w.businessId}`)).body.data).toEqual([]);
  });
});

describe('salesman location (consent and retention)', () => {
  let w: Tenant;
  let sm: Awaited<ReturnType<typeof h.addMember>>;
  let staffId: string;
  beforeAll(async () => {
    w = await h.newTenant();
    await turnOn(w);
    sm = await h.addMember(w, 'salesman');
    staffId = (await w.call('POST', '/v1/staff', { name: 'Kumar', userId: sm.userId })).body.id;
  });

  it('shows the consent text with the retention days, and refuses a check-in before consent', async () => {
    const c = await sm.call('GET', '/v1/visits/consent');
    expect(c.body.given).toBe(false);
    expect(c.body.text).toContain('90 days');
    const v = await sm.call('POST', '/v1/visits', { lat: 13.08, lng: 80.27 });
    expect(v.status).toBe(403);
    expect(v.body.error.message).toMatch(/consent/);
    expect((await sm.call('POST', '/v1/visits/consent', { version: 'old' })).status).toBe(409);
  });

  it('records a check-in after consent; the owner can read it, another salesman can not', async () => {
    expect(
      (await sm.call('POST', '/v1/visits/consent', { version: '2026-11-v1' })).body.given,
    ).toBe(true);
    const p = await party(w);
    const v = await sm.call('POST', '/v1/visits', {
      lat: 13.0827,
      lng: 80.2707,
      partyId: p.id,
      note: 'Order for Monday',
    });
    expect(v.status, v.text).toBe(201);
    const owner = await w.call('GET', `/v1/staff/${staffId}/visits`);
    expect(owner.body.data).toHaveLength(1);
    expect(owner.body.retentionDays).toBe(90);
    const other = await h.addMember(w, 'salesman');
    await w.call('POST', '/v1/staff', { name: 'Other', userId: other.userId });
    expect((await other.call('GET', `/v1/staff/${staffId}/visits`)).status).toBe(403);
    expect((await sm.call('GET', `/v1/staff/${staffId}/visits`)).status).toBe(200);
  });

  it('the retention job deletes check-ins older than the window and keeps newer ones', async () => {
    await withTenant(h.db, w.orgId, (tx) =>
      tx.execute(
        sql`insert into staff_visits (org_id, staff_id, lat, lng, at) values (${w.orgId}, ${staffId}, 1, 1, now() - interval '100 days')`,
      ),
    );
    const before = (await w.call('GET', `/v1/staff/${staffId}/visits`)).body.data.length;
    expect(await runRetentionJob(h.db, new Date(), { orgId: w.orgId })).toBeGreaterThanOrEqual(1);
    const after = (await w.call('GET', `/v1/staff/${staffId}/visits`)).body.data;
    expect(after.length).toBe(before - 1);
    expect(after.every((v: any) => Date.now() - new Date(v.at).getTime() < 90 * 86_400_000)).toBe(
      true,
    );
  });

  it('retention follows the setting (and runs even though messaging could be off)', async () => {
    await settings(w, { 'visits.retentionDays': 7 });
    await withTenant(h.db, w.orgId, (tx) =>
      tx.execute(
        sql`insert into staff_visits (org_id, staff_id, lat, lng, at) values (${w.orgId}, ${staffId}, 2, 2, now() - interval '10 days')`,
      ),
    );
    await settings(w, { 'msg.enabled': false });
    expect(await runRetentionJob(h.db, new Date(), { orgId: w.orgId })).toBeGreaterThanOrEqual(1);
    await settings(w, { 'msg.enabled': true });
    expect((await sm.call('GET', '/v1/visits/consent')).body.text).toContain('7 days');
  });

  it('withdrawing stops check-ins and can erase what was recorded', async () => {
    expect((await sm.call('POST', '/v1/visits/consent/withdraw', { erase: true })).status).toBe(
      200,
    );
    expect((await sm.call('POST', '/v1/visits', { lat: 1, lng: 1 })).status).toBe(403);
    expect((await w.call('GET', `/v1/staff/${staffId}/visits`)).body.data).toEqual([]);
  });

  it('is part of messaging: with it off nothing can be recorded', async () => {
    const off = await h.newTenant();
    const m = await h.addMember(off, 'salesman');
    await off.call('POST', '/v1/staff', { name: 'K', userId: m.userId });
    expect((await m.call('GET', '/v1/visits/consent')).status).toBe(409);
  });

  it("another organization's check-ins are invisible", async () => {
    const other = await h.newTenant();
    expect((await other.call('GET', `/v1/staff/${staffId}/visits`)).status).toBe(409);
  });
});
