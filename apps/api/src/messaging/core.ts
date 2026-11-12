// Vyapar parity P9-S1: the parts every message path shares: the flag, templates, the context of a document, public links,
// idempotent queuing, and the worker that sends what is queued.
import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { schema, withTenant, type Database, type Tx } from '@ledgora/db';
import { DEFAULT_TEMPLATES, type MessageChannel, type MessageEvent } from '@ledgora/contracts';
import {
  DEFAULT_QUIET,
  idempotencyKey,
  istParts,
  nextSendTime,
  normalizePhone,
  renderTemplate,
  retryDelayMinutes,
  type QuietHours,
} from '@ledgora/tax-engine';
import { AppError, notFound } from '../errors.ts';
import type { AppEnv } from '../env.ts';
import { settingValue } from '../modules/settingsStore.ts';
import { dueOf } from '../modules/saleRules.ts';
import type { Providers } from './providers.ts';

const { messages, messageTemplates, documentLinks, parties, invoices, invoiceLines, businesses } =
  schema;

export async function requireMessaging(tx: Tx, businessId: string) {
  if (!(await settingValue(tx, businessId, 'msg.enabled')))
    throw new AppError(
      'conflict',
      'Messaging is off for this business. The owner can turn it on in Settings > Txn Message.',
    );
}

export async function quietHoursOf(tx: Tx, businessId: string): Promise<QuietHours> {
  const [start, end] = await Promise.all([
    settingValue(tx, businessId, 'reminder.quietStart'),
    settingValue(tx, businessId, 'reminder.quietEnd'),
  ]);
  return { start: start || DEFAULT_QUIET.start, end: end || DEFAULT_QUIET.end };
}

// ---- templates -------------------------------------------------------------------------------------------------------------

export async function effectiveTemplate(
  tx: Tx,
  businessId: string,
  event: MessageEvent,
  channel: MessageChannel,
  language = 'en',
) {
  const [row] = await tx
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.businessId, businessId),
        eq(messageTemplates.event, event),
        eq(messageTemplates.channel, channel),
        eq(messageTemplates.language, language),
        isNull(messageTemplates.deletedAt),
      ),
    );
  if (row && row.active)
    return { subject: row.subject, body: row.body, custom: true, active: true };
  return { ...DEFAULT_TEMPLATES[event], custom: false, active: row ? row.active : true };
}

// ---- public links ----------------------------------------------------------------------------------------------------------

/** 192 random bits, URL-safe. */
export const newToken = () => randomBytes(24).toString('base64url');
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const linkUrl = (env: Pick<AppEnv, 'APP_URL'>, token: string) =>
  `${env.APP_URL.replace(/\/$/, '')}/s/${token}`;

export async function createLink(
  tx: Tx,
  orgId: string,
  refType: string,
  refId: string,
  days: number,
  now = new Date(),
) {
  const [row] = await tx
    .insert(documentLinks)
    .values({
      orgId,
      token: newToken(),
      refType,
      refId,
      expiresAt: new Date(now.getTime() + days * 86_400_000),
    })
    .returning();
  return row!;
}

// ---- the context of an invoice ----------------------------------------------------------------------------------------------

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '');

export async function invoiceContext(
  tx: Tx,
  env: Pick<AppEnv, 'APP_URL'>,
  orgId: string,
  invoiceId: string,
  o: { includeLink: boolean; linkDays?: number; now?: Date } = { includeLink: true },
) {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.deletedAt)));
  if (!inv) throw notFound('Invoice');
  const [biz] = await tx.select().from(businesses).where(eq(businesses.id, inv.businessId));
  const party = inv.partyId
    ? (await tx.select().from(parties).where(eq(parties.id, inv.partyId)))[0]
    : undefined;
  const lines = await tx
    .select({ name: invoiceLines.name, quantity: invoiceLines.quantity })
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, invoiceId), isNull(invoiceLines.deletedAt)))
    .orderBy(invoiceLines.position)
    .limit(3);
  const pending = Math.max(0, Math.round((dueOf(inv) - inv.paidAmount) * 100) / 100);
  let link = '';
  if (o.includeLink)
    link = linkUrl(
      env,
      (await createLink(tx, orgId, 'invoice', inv.id, o.linkDays ?? 30, o.now)).token,
    );
  return {
    inv,
    party,
    pending,
    optedOut: !!party?.doNotMessage,
    phone: party?.phone ?? '',
    email: party?.email ?? '',
    vars: {
      party: party?.name ?? 'Customer',
      number: inv.number,
      amount: inr(inv.total),
      balance: inr(pending),
      due_date: dmy(inv.dueDate),
      business: biz?.name ?? '',
      link,
      date: dmy(inv.invoiceDate),
      items: lines.map((l) => `${l.name} x ${l.quantity}`).join(', '),
    },
  };
}

/** The address a message goes to on this channel, or why there is none. */
export function addressFor(
  channel: MessageChannel,
  ctx: { phone: string; email: string },
  override?: string,
) {
  if (channel === 'email') {
    const v = (override ?? ctx.email).trim();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
  }
  return normalizePhone(override ?? ctx.phone);
}

// ---- queue -------------------------------------------------------------------------------------------------------------------

export interface NewMessage {
  businessId: string;
  channel: MessageChannel;
  to: string;
  partyId: string | null;
  event: MessageEvent;
  refType: string;
  refId: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  /** Part of the idempotency key; defaults to the day (IST) of scheduledAt. */
  scheduledDate?: string;
  meta?: Record<string, unknown>;
  status?: 'queued' | 'sent';
  sentAt?: Date;
  providerId?: string;
}

/** Queues a message once: the same (document, event, channel, day) a second time returns null. */
export async function enqueue(tx: Tx, orgId: string, m: NewMessage) {
  const key = idempotencyKey({
    refType: m.refType,
    refId: m.refId,
    event: m.event,
    channel: m.channel,
    scheduledDate: m.scheduledDate ?? istParts(m.scheduledAt).date,
  });
  const [row] = await tx
    .insert(messages)
    .values({
      orgId,
      businessId: m.businessId,
      channel: m.channel,
      toAddress: m.to,
      partyId: m.partyId,
      event: m.event,
      refType: m.refType,
      refId: m.refId,
      subject: m.subject,
      body: m.body,
      status: m.status ?? 'queued',
      scheduledAt: m.scheduledAt,
      sentAt: m.sentAt ?? null,
      providerId: m.providerId ?? null,
      idempotencyKey: key,
      meta: m.meta ?? {},
    })
    .onConflictDoNothing({ target: [messages.orgId, messages.idempotencyKey] })
    .returning();
  return row ?? null;
}

/** Renders a template for a document: the text, the subject, and the variable names nobody knows. */
export function renderFor(
  t: { subject: string; body: string },
  vars: Record<string, string>,
  body?: string,
) {
  const text = renderTemplate(body ?? t.body, vars);
  const subject = renderTemplate(t.subject, vars);
  return {
    text: text.text,
    subject: subject.text,
    unknown: [...new Set([...text.unknown, ...subject.unknown])],
  };
}

// ---- the worker --------------------------------------------------------------------------------------------------------------

async function orgsWithQueued(db: Database, now: Date) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    const rows = await tx
      .selectDistinct({ orgId: messages.orgId })
      .from(messages)
      .where(and(eq(messages.status, 'queued'), lte(messages.scheduledAt, now)));
    return rows.map((r) => r.orgId);
  });
}

const AUTOMATIC_EVENTS = new Set<string>(['reminder', 'service_due']);

/**
 * Sends what is due in one organization. Rows are taken with FOR UPDATE SKIP LOCKED, so two workers never send the same
 * message. A channel whose provider needs a click (WhatsApp link) is left queued for the person to open.
 */
export async function processOrgQueue(tx: Tx, providers: Providers, now = new Date(), limit = 50) {
  const due = await tx
    .select()
    .from(messages)
    .where(and(eq(messages.status, 'queued'), lte(messages.scheduledAt, now)))
    .orderBy(asc(messages.scheduledAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  const out = { sent: 0, retried: 0, failed: 0, cancelled: 0, deferred: 0 };
  const quiet = new Map<string, QuietHours>();
  for (const m of due) {
    const provider = providers[m.channel as MessageChannel];
    if (!provider) {
      await tx
        .update(messages)
        .set({ status: 'failed', error: `No ${m.channel} provider is configured`, updatedAt: now })
        .where(eq(messages.id, m.id));
      out.failed++;
      continue;
    }
    if (!provider.autoSend) continue;
    // The party may have opted out since this was queued.
    if (m.partyId) {
      const [p] = await tx
        .select({ no: parties.doNotMessage })
        .from(parties)
        .where(eq(parties.id, m.partyId));
      if (p?.no) {
        await tx
          .update(messages)
          .set({ status: 'cancelled', error: 'The party asked not to be messaged', updatedAt: now })
          .where(eq(messages.id, m.id));
        out.cancelled++;
        continue;
      }
    }
    // Automatic messages keep to the quiet hours even when they were queued earlier.
    if (AUTOMATIC_EVENTS.has(m.event)) {
      if (!quiet.has(m.businessId)) quiet.set(m.businessId, await quietHoursOf(tx, m.businessId));
      const at = nextSendTime(now, quiet.get(m.businessId));
      if (at.getTime() > now.getTime()) {
        await tx
          .update(messages)
          .set({ scheduledAt: at, updatedAt: now })
          .where(eq(messages.id, m.id));
        out.deferred++;
        continue;
      }
    }
    try {
      const r = await provider.send({ to: m.toAddress, subject: m.subject, body: m.body });
      await tx
        .update(messages)
        .set({
          status: 'sent',
          sentAt: now,
          providerId: r.id,
          error: null,
          attempts: m.attempts + 1,
          updatedAt: now,
        })
        .where(eq(messages.id, m.id));
      out.sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      const wait = retryDelayMinutes(attempts);
      const error = (e instanceof Error ? e.message : 'Could not send').slice(0, 300);
      await tx
        .update(messages)
        .set(
          wait === null
            ? { status: 'failed', error, attempts, updatedAt: now }
            : {
                error,
                attempts,
                scheduledAt: new Date(now.getTime() + wait * 60_000),
                updatedAt: now,
              },
        )
        .where(eq(messages.id, m.id));
      if (wait === null) out.failed++;
      else out.retried++;
    }
  }
  return out;
}

export async function runMessageQueue(
  db: Database,
  providers: Providers,
  now = new Date(),
  scope: { orgId?: string } = {},
) {
  const total = { sent: 0, retried: 0, failed: 0, cancelled: 0, deferred: 0 };
  for (const orgId of (await orgsWithQueued(db, now)).filter(
    (id) => !scope.orgId || id === scope.orgId,
  )) {
    const r = await withTenant(db, orgId, (tx) => processOrgQueue(tx, providers, now));
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r[k];
  }
  return total;
}

/** A WhatsApp-link message the person has opened: marks it sent. */
export async function markOpened(tx: Tx, id: string, now = new Date()) {
  const [m] = await tx
    .update(messages)
    .set({ status: 'sent', sentAt: now, updatedAt: now })
    .where(and(eq(messages.id, id), inArray(messages.status, ['queued', 'sent'])))
    .returning();
  return m ?? null;
}

/** How long check-in locations are kept: the shortest window any business of the organization chose (90 by default). */
export async function visitRetentionDays(tx: Tx) {
  let days = 90;
  for (const b of await tx.select({ id: businesses.id }).from(businesses))
    days = Math.min(days, await settingValue(tx, b.id, 'visits.retentionDays'));
  return days;
}

/** Has any business of the organization switched messaging on? Gates the salesman location pages. */
export async function anyMessaging(tx: Tx) {
  for (const b of await tx
    .select({ id: businesses.id })
    .from(businesses)
    .where(isNull(businesses.deletedAt)))
    if (await settingValue(tx, b.id, 'msg.enabled')) return true;
  return false;
}
