// Vyapar parity P9-S2 / S4 / S5: the jobs. Each takes `now` and the providers, so a test runs a day in one call with a
// fake provider and nothing is sent for real. They only look at organizations that switched messaging on (reminders,
// service) or that hold location rows (retention, which must run even when messaging is off).
import { and, eq, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { schema, withTenant, type Database, type Tx } from '@ledgora/db';
import {
  SALES_INVOICE_TYPES,
  addDays,
  istParts,
  nextSendTime,
  reminderOffsets,
  retentionCutoff,
  serviceNextDue,
  serviceReminderDue,
  shouldRemind,
  type SentReminder,
} from '@ledgora/tax-engine';
import type { MessageChannel } from '@ledgora/contracts';
import { audit } from '../audit.ts';
import type { AppEnv } from '../env.ts';
import { dueOf } from '../modules/saleRules.ts';
import { settingValue } from '../modules/settingsStore.ts';
import {
  addressFor,
  effectiveTemplate,
  enqueue,
  invoiceContext,
  quietHoursOf,
  renderFor,
  runMessageQueue,
  visitRetentionDays,
} from './core.ts';
import type { Providers } from './providers.ts';

const { invoices, messages, businesses, serviceReminders, parties, settingValues, staffVisits } =
  schema;

/** Limits a run to one organization (a test, or a one-off catch-up); omitted = every organization. */
export interface JobScope {
  orgId?: string;
}

async function schedulerOrgs(
  db: Database,
  find: (tx: Tx) => Promise<{ orgId: string }[]>,
  scope: JobScope = {},
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    return [...new Set((await find(tx as unknown as Tx)).map((r) => r.orgId))].filter(
      (id) => !scope.orgId || id === scope.orgId,
    );
  });
}

const orgsWithMessaging = (db: Database, scope?: JobScope) =>
  schedulerOrgs(
    db,
    (tx) =>
      tx
        .selectDistinct({ orgId: settingValues.orgId })
        .from(settingValues)
        .where(
          and(eq(settingValues.key, 'msg.enabled'), sql`${settingValues.value} = 'true'::jsonb`),
        ),
    scope,
  );

// ---- P9-S2 payment reminders -----------------------------------------------------------------------------------------------

/** Queues today's reminders for one business. Returns how many. */
export async function queueReminders(
  tx: Tx,
  env: Pick<AppEnv, 'APP_URL'>,
  orgId: string,
  businessId: string,
  now = new Date(),
) {
  const [on, before, onDue, after, max, channel] = await Promise.all([
    settingValue(tx, businessId, 'party.reminder'),
    settingValue(tx, businessId, 'reminder.daysBefore'),
    settingValue(tx, businessId, 'reminder.onDue'),
    settingValue(tx, businessId, 'reminder.daysAfter'),
    settingValue(tx, businessId, 'reminder.max'),
    settingValue(tx, businessId, 'reminder.channel'),
  ]);
  if (!on) return 0;
  const offsets = reminderOffsets({
    daysBefore: before,
    onDue,
    daysAfter: after,
    maxPerInvoice: max,
  });
  if (!offsets.length) return 0;
  const today = istParts(now).date;
  const quiet = await quietHoursOf(tx, businessId);
  const rows = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        isNull(invoices.deletedAt),
        inArray(invoices.status, ['unpaid', 'partial']),
        inArray(invoices.invoiceType, SALES_INVOICE_TYPES),
        isNotNull(invoices.dueDate),
        // Nothing before the first offset can fire, so those are not even loaded.
        lte(invoices.dueDate, addDays(today, -offsets[0]!)),
      ),
    );
  if (!rows.length) return 0;
  const history = await tx
    .select({ refId: messages.refId, meta: messages.meta })
    .from(messages)
    .where(
      and(
        eq(messages.refType, 'invoice'),
        eq(messages.event, 'reminder'),
        inArray(
          messages.refId,
          rows.map((r) => r.id),
        ),
        ne(messages.status, 'cancelled'),
        ne(messages.status, 'failed'),
      ),
    );
  const sentBy = new Map<string, SentReminder[]>();
  for (const h of history) {
    const m = h.meta as Partial<SentReminder>;
    if (typeof m.offset === 'number' && m.dueDate)
      sentBy.set(h.refId, [
        ...(sentBy.get(h.refId) ?? []),
        { offset: m.offset, dueDate: m.dueDate },
      ]);
  }
  let queued = 0;
  for (const inv of rows) {
    const pending = Math.round((dueOf(inv) - inv.paidAmount) * 100) / 100;
    const d = shouldRemind(
      { dueDate: inv.dueDate, pending, status: inv.status },
      today,
      offsets,
      sentBy.get(inv.id) ?? [],
      max,
    );
    if (!d.remind) continue;
    const ctx = await invoiceContext(tx, env, orgId, inv.id, { includeLink: true, now });
    if (ctx.optedOut) continue;
    const to = addressFor(channel, ctx);
    if (!to) continue;
    const r = renderFor(await effectiveTemplate(tx, businessId, 'reminder', channel), ctx.vars);
    const row = await enqueue(tx, orgId, {
      businessId,
      channel,
      to,
      partyId: inv.partyId,
      event: 'reminder',
      refType: 'invoice',
      refId: inv.id,
      subject: r.subject,
      body: r.text,
      scheduledAt: nextSendTime(now, quiet),
      meta: { offset: d.offset, dueDate: inv.dueDate },
    });
    if (row) queued++;
  }
  return queued;
}

export async function runReminderJob(
  db: Database,
  env: Pick<AppEnv, 'APP_URL'>,
  now = new Date(),
  scope: JobScope = {},
) {
  let queued = 0;
  for (const orgId of await orgsWithMessaging(db, scope))
    queued += await withTenant(db, orgId, async (tx) => {
      let n = 0;
      for (const b of await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(isNull(businesses.deletedAt))) {
        if (await settingValue(tx, b.id, 'msg.enabled'))
          n += await queueReminders(tx, env, orgId, b.id, now);
      }
      return n;
    });
  return queued;
}

// ---- P9-S5 service reminders -----------------------------------------------------------------------------------------------

export async function queueServiceReminders(
  tx: Tx,
  orgId: string,
  businessId: string,
  now = new Date(),
) {
  const today = istParts(now).date;
  const quiet = await quietHoursOf(tx, businessId);
  const [biz] = await tx
    .select({ name: businesses.name })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  const rows = await tx
    .select()
    .from(serviceReminders)
    .where(
      and(
        eq(serviceReminders.businessId, businessId),
        eq(serviceReminders.active, true),
        isNull(serviceReminders.deletedAt),
        isNotNull(serviceReminders.partyId),
      ),
    );
  let queued = 0;
  for (const r of rows) {
    if (
      !serviceReminderDue(
        {
          nextDue: r.nextDue,
          remindBeforeDays: r.remindBeforeDays,
          lastSentFor: r.lastSentFor,
          active: r.active,
        },
        today,
      )
    )
      continue;
    const [p] = await tx.select().from(parties).where(eq(parties.id, r.partyId!));
    // Mark it handled either way: an opted-out party or one with no contact must not be retried every hour.
    await tx
      .update(serviceReminders)
      .set({ lastSentFor: r.nextDue, updatedAt: now })
      .where(eq(serviceReminders.id, r.id));
    if (!p || p.doNotMessage) continue;
    const channel = r.channel as MessageChannel;
    const to = addressFor(channel, { phone: p.phone, email: p.email });
    if (!to) continue;
    const t = await effectiveTemplate(tx, businessId, 'service_due', channel);
    const out = renderFor(t, {
      party: p.name,
      items: r.name,
      due_date: r.nextDue.split('-').reverse().join('-'),
      business: biz?.name ?? '',
    });
    const row = await enqueue(tx, orgId, {
      businessId,
      channel,
      to,
      partyId: p.id,
      event: 'service_due',
      refType: 'service_reminder',
      refId: r.id,
      subject: out.subject,
      body: out.text,
      scheduledAt: nextSendTime(now, quiet),
      scheduledDate: r.nextDue,
    });
    if (row) queued++;
  }
  return queued;
}

export async function runServiceJob(db: Database, now = new Date(), scope: JobScope = {}) {
  let queued = 0;
  for (const orgId of await orgsWithMessaging(db, scope))
    queued += await withTenant(db, orgId, async (tx) => {
      let n = 0;
      for (const b of await tx
        .select({ id: businesses.id })
        .from(businesses)
        .where(isNull(businesses.deletedAt))) {
        if (await settingValue(tx, b.id, 'msg.enabled'))
          n += await queueServiceReminders(tx, orgId, b.id, now);
      }
      return n;
    });
  return queued;
}

/** Marks a service done: the next one is due one interval after today. */
export const nextServiceDate = (done: string, unit: 'days' | 'months', every: number) =>
  serviceNextDue(done, { unit, every });

// ---- P9-S4 location retention ----------------------------------------------------------------------------------------------

/** Deletes check-ins older than the retention window (the shortest any business of the organization set; 90 by default). */
export async function purgeVisits(tx: Tx, orgId: string, now = new Date()) {
  const days = await visitRetentionDays(tx);
  const gone = await tx
    .delete(staffVisits)
    .where(lt(staffVisits.at, retentionCutoff(now, days)))
    .returning({ id: staffVisits.id });
  if (gone.length)
    await audit(tx, orgId, 'visits.purge', 'staff_visit', null, {
      after: { deleted: gone.length, olderThanDays: days },
    });
  return gone.length;
}

export async function runRetentionJob(db: Database, now = new Date(), scope: JobScope = {}) {
  const orgs = await schedulerOrgs(
    db,
    (tx) => tx.selectDistinct({ orgId: staffVisits.orgId }).from(staffVisits),
    scope,
  );
  let deleted = 0;
  for (const orgId of orgs)
    deleted += await withTenant(db, orgId, (tx) => purgeVisits(tx, orgId, now));
  return deleted;
}

// ---- the scheduler ----------------------------------------------------------------------------------------------------------

export function startMessagingScheduler(
  db: Database,
  providers: Providers,
  env: Pick<AppEnv, 'REPORT_SCHEDULER' | 'APP_URL'>,
) {
  if (!env.REPORT_SCHEDULER) return () => {};
  const log = (what: string) => (e: unknown) =>
    console.error(`[messaging] ${what}`, e instanceof Error ? e.message : e);
  const queue = () => runMessageQueue(db, providers).catch(log('queue'));
  const daily = () =>
    Promise.all([
      runReminderJob(db, env).catch(log('reminders')),
      runServiceJob(db).catch(log('service reminders')),
      runRetentionJob(db).catch(log('retention')),
    ]).then(queue);
  const timers = [
    setInterval(queue, 30_000),
    setInterval(daily, 60 * 60_000),
    setTimeout(daily, 25_000),
  ];
  timers.forEach((t) => t.unref?.());
  return () => timers.forEach((t) => (clearInterval(t), clearTimeout(t)));
}
