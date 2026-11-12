// Vyapar parity Phase 9 (behind the `msg.enabled` setting): share a document, the message log, payment reminders,
// service reminders, public links and the salesman's consented check-ins. Providers come from Deps.providers, so a test
// injects a fake and nothing real is ever sent. See messaging/ for the provider, the queue and the jobs.
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  LOCATION_CONSENT_VERSION,
  MESSAGE_EVENTS,
  consentInput,
  consentView,
  idParam,
  linkInput,
  linkList,
  linkListQuery,
  linkRow,
  messageList,
  messageListQuery,
  messageRow,
  messagingStatus,
  msgTemplateInput,
  msgTemplateList,
  msgTemplatesQuery,
  okBody,
  previewResult,
  reminderList,
  reminderListQuery,
  reminderSendInput,
  reminderSendResult,
  sendInput,
  sendResult,
  serviceInput,
  serviceList,
  serviceListQuery,
  servicePatch,
  serviceRow,
  snoozeInput,
  statusQuery,
  visitInput,
  visitList,
  visitListQuery,
  visitRow,
  withdrawInput,
  locationConsentText,
  type MessageChannel,
  type MessageEvent,
} from '@ledgora/contracts';
import {
  SALES_INVOICE_TYPES,
  WHATSAPP_LIMIT,
  addDays,
  istParts,
  renderTemplate,
  serviceDaysLeft,
  serviceNextDue,
  smsSegments,
  snoozeUntil,
  daysBetween,
  TEMPLATE_VARIABLES,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Deps, Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { assertInScope, dueOf, salesmanScope } from './saleRules.ts';
import { settingValue } from './settingsStore.ts';
import {
  addressFor,
  anyMessaging,
  createLink,
  effectiveTemplate,
  enqueue,
  invoiceContext,
  linkUrl,
  markOpened,
  processOrgQueue,
  renderFor,
  requireMessaging,
  visitRetentionDays,
} from '../messaging/core.ts';
import { makeProviders, type Providers } from '../messaging/providers.ts';

const {
  messages,
  messageTemplates,
  documentLinks,
  invoices,
  parties,
  serviceReminders,
  staff,
  staffConsents,
  staffVisits,
} = schema;

const providersOf = (deps: Deps): Providers => deps.providers ?? makeProviders(deps.env);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toMessage = (m: typeof messages.$inferSelect) => ({
  id: m.id,
  channel: m.channel as MessageChannel,
  to: m.toAddress,
  event: m.event,
  refType: m.refType,
  refId: m.refId,
  partyId: m.partyId,
  body: m.body,
  subject: m.subject,
  status: m.status,
  error: m.error,
  attempts: m.attempts,
  scheduledAt: m.scheduledAt.toISOString(),
  sentAt: iso(m.sentAt),
});
const toLink = (deps: Deps, l: typeof documentLinks.$inferSelect) => ({
  id: l.id,
  token: l.token,
  url: linkUrl(deps.env, l.token),
  refType: l.refType,
  refId: l.refId,
  expiresAt: l.expiresAt.toISOString(),
  revokedAt: iso(l.revokedAt),
  views: l.views,
});

function channelLimit(channel: MessageChannel, text: string) {
  if (channel === 'whatsapp')
    return { length: [...text].length, max: WHATSAPP_LIMIT, segments: null };
  if (channel === 'sms') {
    const s = smsSegments(text);
    return { length: s.length, max: null, segments: s.segments };
  }
  return { length: [...text].length, max: null, segments: null };
}

function needProvider(providers: Providers, channel: MessageChannel) {
  const p = providers[channel];
  if (!p)
    throw new AppError(
      'unprocessable',
      channel === 'sms'
        ? 'SMS needs a provider that has not been set up yet. Use WhatsApp or e-mail.'
        : `No ${channel} provider is configured`,
      [{ path: 'channel', message: `${channel} is not available` }],
    );
  return p;
}

export function messagingModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/messaging/status',
    tag: 'Messaging',
    summary: 'Is messaging on for this business, and which channels can send',
    query: statusQuery,
    response: messagingStatus,
    handler: async ({ tx, query, deps }) => {
      await loadBusiness(tx, query.businessId);
      const p = providersOf(deps);
      return {
        enabled: await settingValue(tx, query.businessId, 'msg.enabled'),
        provider: 'whatsappLink',
        channels: { whatsapp: !!p.whatsapp, email: !!p.email, sms: !!p.sms },
      };
    },
  });

  // ---- templates -----------------------------------------------------------------------------------------------------------

  route({
    method: 'get',
    path: '/v1/messaging/templates',
    tag: 'Messaging',
    summary:
      'The message text for every event and channel (built-in unless the business changed it)',
    query: msgTemplatesQuery,
    response: msgTemplateList,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const data = [];
      for (const event of MESSAGE_EVENTS)
        for (const channel of ['whatsapp', 'sms', 'email'] as const) {
          const t = await effectiveTemplate(tx, query.businessId, event, channel);
          data.push({
            businessId: query.businessId,
            event,
            channel,
            language: 'en',
            subject: t.subject,
            body: t.body,
            active: t.active,
            custom: t.custom,
            unknown: renderTemplate(t.body, {}).unknown,
          });
        }
      return { data };
    },
  });

  route({
    method: 'put',
    path: '/v1/messaging/templates',
    tag: 'Messaging',
    summary: 'Change the text of one message; unknown {variables} are refused',
    body: msgTemplateInput,
    response: okBody,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const bad = [
        ...new Set([
          ...renderTemplate(body.body, {}).unknown,
          ...renderTemplate(body.subject, {}).unknown,
        ]),
      ];
      if (bad.length)
        throw new AppError('validation_failed', 'The message uses variables that do not exist', [
          {
            path: 'body',
            message: `Unknown: ${bad.map((b) => `{${b}}`).join(', ')}. Use ${TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(' ')}`,
          },
        ]);
      await tx
        .insert(messageTemplates)
        .values({ ...body, orgId })
        .onConflictDoUpdate({
          target: [
            messageTemplates.orgId,
            messageTemplates.businessId,
            messageTemplates.event,
            messageTemplates.channel,
            messageTemplates.language,
          ],
          set: {
            subject: body.subject,
            body: body.body,
            active: body.active,
            updatedAt: new Date(),
            deletedAt: null,
          },
        });
      await audit(tx, orgId, 'messaging.template', 'business', body.businessId, {
        after: { event: body.event, channel: body.channel },
      });
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/messaging/templates/reset',
    tag: 'Messaging',
    summary: 'Go back to the built-in text of one message',
    body: msgTemplateInput.pick({ businessId: true, event: true, channel: true, language: true }),
    response: okBody,
    handler: async ({ tx, body }) => {
      await loadBusiness(tx, body.businessId);
      await tx
        .delete(messageTemplates)
        .where(
          and(
            eq(messageTemplates.businessId, body.businessId),
            eq(messageTemplates.event, body.event),
            eq(messageTemplates.channel, body.channel),
            eq(messageTemplates.language, body.language),
          ),
        );
      return { ok: true };
    },
  });

  // ---- share a document -------------------------------------------------------------------------------------------------------

  const prepare = async (
    tx: Tx,
    deps: Deps,
    orgId: string,
    auth: Parameters<typeof salesmanScope>[1],
    b: z.infer<typeof sendInput>,
    includeLink: boolean,
  ) => {
    await loadBusiness(tx, b.businessId);
    await requireMessaging(tx, b.businessId);
    const ctx = await invoiceContext(tx, deps.env, orgId, b.refId, { includeLink });
    if (ctx.inv.businessId !== b.businessId) throw notFound('Invoice');
    assertInScope(await salesmanScope(tx, auth), ctx.inv);
    const t = await effectiveTemplate(tx, b.businessId, b.event as MessageEvent, b.channel);
    const r = renderFor(t, ctx.vars, b.body);
    return { ctx, r };
  };

  route({
    method: 'post',
    path: '/v1/messaging/preview',
    tag: 'Messaging',
    summary: 'The message as it would go out, who it goes to, and whether anything is missing',
    body: sendInput,
    response: previewResult,
    handler: async ({ tx, orgId, auth, body, deps }) => {
      // A preview does not make a link: the address shown is where it will be.
      const { ctx, r } = await prepare(
        tx,
        deps,
        orgId,
        auth,
        { ...body, includeLink: false },
        false,
      );
      const shown = body.includeLink
        ? renderFor(
            await effectiveTemplate(tx, body.businessId, body.event as MessageEvent, body.channel),
            { ...ctx.vars, link: linkUrl(deps.env, '(made when you send)') },
            body.body,
          )
        : r;
      const withLink = shown.text;
      return {
        text: withLink,
        subject: r.subject,
        unknown: r.unknown,
        to: addressFor(body.channel, ctx, body.to),
        partyName: ctx.party?.name ?? null,
        optedOut: ctx.optedOut,
        channelLimit: channelLimit(body.channel, withLink),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/messages/send',
    tag: 'Messaging',
    summary:
      'Share a document: WhatsApp returns the link to open; e-mail goes out through the queue',
    body: sendInput,
    response: sendResult,
    status: 201,
    handler: async ({ tx, orgId, auth, body, deps }) => {
      const providers = providersOf(deps);
      const provider = needProvider(providers, body.channel);
      const { ctx, r } = await prepare(tx, deps, orgId, auth, body, body.includeLink);
      if (ctx.optedOut)
        throw new AppError(
          'conflict',
          `${ctx.party?.name ?? 'This party'} asked not to be messaged`,
        );
      if (r.unknown.length)
        throw new AppError('validation_failed', 'The message uses variables that do not exist', [
          { path: 'body', message: `Unknown: ${r.unknown.map((u) => `{${u}}`).join(', ')}` },
        ]);
      const to = addressFor(body.channel, ctx, body.to);
      if (!to)
        throw new AppError(
          'unprocessable',
          body.channel === 'email'
            ? 'Add an e-mail address first'
            : 'Add a valid mobile number first',
          [
            {
              path: 'to',
              message: body.channel === 'email' ? 'No e-mail address' : 'No valid mobile number',
            },
          ],
        );
      const lim = channelLimit(body.channel, r.text);
      if (lim.max && lim.length > lim.max)
        throw new AppError(
          'unprocessable',
          `The message is ${lim.length} characters; ${body.channel} takes ${lim.max}`,
          [{ path: 'body', message: 'Too long' }],
        );
      const now = new Date();
      let url: string | null = null;
      let status: 'queued' | 'sent' = 'queued';
      let providerId: string | undefined;
      if (!provider.autoSend) {
        // A click-to-send provider: the person pressing the button is the send.
        const sent = await provider.send({ to, subject: r.subject, body: r.text });
        url = sent.url ?? null;
        status = 'sent';
        providerId = sent.id;
      }
      const row = await enqueue(tx, orgId, {
        businessId: body.businessId,
        channel: body.channel,
        to,
        partyId: ctx.inv.partyId,
        event: body.event as MessageEvent,
        refType: body.refType,
        refId: body.refId,
        subject: r.subject,
        body: r.text,
        scheduledAt: now,
        scheduledDate: `manual:${randomUUID()}`,
        status,
        sentAt: status === 'sent' ? now : undefined,
        providerId,
      });
      if (!row) throw new AppError('conflict', 'That message was already queued');
      await audit(tx, orgId, 'message.send', 'invoice', body.refId, {
        after: { channel: body.channel, event: body.event },
      });
      if (status === 'queued') await processOrgQueue(tx, providers, now);
      const [fresh] = await tx.select().from(messages).where(eq(messages.id, row.id));
      return { message: toMessage(fresh!), url };
    },
  });

  // ---- the log -----------------------------------------------------------------------------------------------------------------

  route({
    method: 'get',
    path: '/v1/messages',
    tag: 'Messaging',
    summary: 'The Messages log, newest first',
    query: messageListQuery,
    response: messageList,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const rows = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.businessId, query.businessId),
            isNull(messages.deletedAt),
            query.status ? eq(messages.status, query.status) : undefined,
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(query.limit);
      return { data: rows.map(toMessage) };
    },
  });

  route({
    method: 'post',
    path: '/v1/messages/:id/retry',
    tag: 'Messaging',
    summary: 'Try a failed message again',
    params: idParam,
    response: messageRow,
    handler: async ({ tx, params, deps }) => {
      const [m] = await tx.select().from(messages).where(eq(messages.id, params.id));
      if (!m) throw notFound('Message');
      if (m.status !== 'failed')
        throw new AppError('conflict', 'Only a failed message can be retried');
      await requireMessaging(tx, m.businessId);
      await tx
        .update(messages)
        .set({
          status: 'queued',
          attempts: 0,
          error: null,
          scheduledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(messages.id, m.id));
      await processOrgQueue(tx, providersOf(deps));
      const [fresh] = await tx.select().from(messages).where(eq(messages.id, m.id));
      return toMessage(fresh!);
    },
  });

  route({
    method: 'post',
    path: '/v1/messages/:id/opened',
    tag: 'Messaging',
    summary: 'The person opened the WhatsApp link: the message counts as sent',
    params: idParam,
    response: messageRow,
    handler: async ({ tx, params }) => {
      const m = await markOpened(tx, params.id);
      if (!m) throw notFound('Message');
      return toMessage(m);
    },
  });

  // ---- public links ----------------------------------------------------------------------------------------------------------

  route({
    method: 'post',
    path: '/v1/document-links',
    tag: 'Messaging',
    summary: 'Make a read-only public link to an invoice (expires; can be revoked)',
    body: linkInput,
    response: linkRow,
    status: 201,
    handler: async ({ tx, orgId, auth, body, deps }) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, body.refId), isNull(invoices.deletedAt)));
      if (!inv) throw notFound('Invoice');
      assertInScope(await salesmanScope(tx, auth), inv);
      await requireMessaging(tx, inv.businessId);
      return toLink(deps, await createLink(tx, orgId, body.refType, body.refId, body.days));
    },
  });

  route({
    method: 'get',
    path: '/v1/document-links',
    tag: 'Messaging',
    summary: 'The links made for a document, with their view counts',
    query: linkListQuery,
    response: linkList,
    handler: async ({ tx, query, deps }) => {
      const rows = await tx
        .select()
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.refType, query.refType),
            eq(documentLinks.refId, query.refId),
            isNull(documentLinks.deletedAt),
          ),
        )
        .orderBy(desc(documentLinks.createdAt));
      return { data: rows.map((l) => toLink(deps, l)) };
    },
  });

  route({
    method: 'delete',
    path: '/v1/document-links/:id',
    tag: 'Messaging',
    summary: 'Revoke a link: it stops working at once',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const r = await tx
        .update(documentLinks)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(documentLinks.id, params.id), isNull(documentLinks.revokedAt)))
        .returning({ id: documentLinks.id });
      if (!r.length) throw notFound('Link');
      await audit(tx, orgId, 'link.revoke', 'document_link', params.id);
      return { ok: true };
    },
  });

  // ---- payment reminders -------------------------------------------------------------------------------------------------------

  route({
    method: 'get',
    path: '/v1/reminders',
    tag: 'Messaging',
    summary: 'Overdue invoices with the last reminder sent for each',
    query: reminderListQuery,
    response: reminderList,
    handler: async ({ tx, auth, query }) => {
      await loadBusiness(tx, query.businessId);
      const today = istParts(new Date()).date;
      const scope = await salesmanScope(tx, auth);
      const rows = await tx
        .select({
          inv: invoices,
          partyName: parties.name,
          phone: parties.phone,
          optedOut: parties.doNotMessage,
        })
        .from(invoices)
        .leftJoin(parties, eq(parties.id, invoices.partyId))
        .where(
          and(
            eq(invoices.businessId, query.businessId),
            isNull(invoices.deletedAt),
            inArray(invoices.status, ['unpaid', 'partial']),
            inArray(invoices.invoiceType, SALES_INVOICE_TYPES),
            sql`${invoices.dueDate} is not null`,
            sql`${invoices.dueDate} <= ${addDays(today, -query.minDaysLate)}`,
            query.partyId ? eq(invoices.partyId, query.partyId) : undefined,
          ),
        )
        .orderBy(asc(invoices.dueDate));
      const mine = rows.filter(
        (r) => !scope || (r.inv.salesmanId && scope.includes(r.inv.salesmanId)),
      );
      const last = mine.length
        ? await tx
            .select({
              refId: messages.refId,
              at: sql<Date>`max(${messages.scheduledAt})`,
              channel: sql<string>`(array_agg(${messages.channel} order by ${messages.scheduledAt} desc))[1]`,
            })
            .from(messages)
            .where(
              and(
                eq(messages.event, 'reminder'),
                inArray(
                  messages.refId,
                  mine.map((r) => r.inv.id),
                ),
                inArray(messages.status, ['sent', 'delivered', 'queued']),
              ),
            )
            .groupBy(messages.refId)
        : [];
      const lastBy = new Map(last.map((l) => [l.refId, l]));
      const data = mine.map((r) => {
        const pending = Math.round((dueOf(r.inv) - r.inv.paidAmount) * 100) / 100;
        const l = lastBy.get(r.inv.id);
        return {
          invoiceId: r.inv.id,
          number: r.inv.number,
          partyId: r.inv.partyId,
          partyName: r.partyName ?? 'Walk-in customer',
          phone: r.phone ?? '',
          dueDate: r.inv.dueDate!,
          daysLate: daysBetween(r.inv.dueDate!, today),
          pending,
          lastReminderAt: l ? new Date(l.at).toISOString() : null,
          lastChannel: l?.channel ?? null,
          optedOut: !!r.optedOut,
        };
      });
      return {
        data,
        totalOverdue: Math.round(data.reduce((s, d) => s + d.pending, 0) * 100) / 100,
        parties: new Set(data.map((d) => d.partyId ?? d.invoiceId)).size,
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/reminders/send',
    tag: 'Messaging',
    summary:
      'Send reminders for the chosen invoices; parties who opted out or have no contact are skipped and listed',
    body: reminderSendInput,
    response: reminderSendResult,
    handler: async ({ tx, orgId, auth, body, deps }) => {
      await loadBusiness(tx, body.businessId);
      await requireMessaging(tx, body.businessId);
      const providers = providersOf(deps);
      const provider = needProvider(providers, body.channel);
      const scope = await salesmanScope(tx, auth);
      const now = new Date();
      const today = istParts(now).date;
      const t = await effectiveTemplate(tx, body.businessId, 'reminder', body.channel);
      const sent: z.infer<typeof reminderSendResult>['sent'] = [];
      const skipped: z.infer<typeof reminderSendResult>['skipped'] = [];
      let preview: string | null = null;
      for (const id of [...new Set(body.invoiceIds)]) {
        const [inv] = await tx
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.id, id),
              eq(invoices.businessId, body.businessId),
              isNull(invoices.deletedAt),
            ),
          );
        if (!inv || (scope && !(inv.salesmanId && scope.includes(inv.salesmanId)))) {
          skipped.push({ invoiceId: id, reason: 'Invoice not found' });
          continue;
        }
        const pending = Math.round((dueOf(inv) - inv.paidAmount) * 100) / 100;
        if (inv.status === 'cancelled' || inv.status === 'paid' || pending <= 0.005) {
          skipped.push({ invoiceId: id, reason: 'Nothing is pending' });
          continue;
        }
        const ctx = await invoiceContext(tx, deps.env, orgId, id, { includeLink: true, now });
        if (ctx.optedOut) {
          skipped.push({ invoiceId: id, reason: 'Asked not to be messaged' });
          continue;
        }
        const to = addressFor(body.channel, ctx);
        if (!to) {
          skipped.push({
            invoiceId: id,
            reason: body.channel === 'email' ? 'No e-mail address' : 'No valid phone number',
          });
          continue;
        }
        const r = renderFor(t, ctx.vars);
        preview ??= r.text;
        const offset = inv.dueDate ? daysBetween(inv.dueDate, today) : 0;
        // A reminder the automatic job already queued for WhatsApp is the one to open; do not make a second.
        const [waiting] = provider.autoSend
          ? []
          : await tx
              .select()
              .from(messages)
              .where(
                and(
                  eq(messages.refId, id),
                  eq(messages.event, 'reminder'),
                  eq(messages.channel, body.channel),
                  eq(messages.status, 'queued'),
                ),
              )
              .limit(1);
        let row = waiting ?? null;
        if (!row)
          row = await enqueue(tx, orgId, {
            businessId: body.businessId,
            channel: body.channel,
            to,
            partyId: inv.partyId,
            event: 'reminder',
            refType: 'invoice',
            refId: id,
            subject: r.subject,
            body: r.text,
            scheduledAt: now,
            scheduledDate: `manual:${randomUUID()}`,
            meta: { offset, dueDate: inv.dueDate, manual: true },
          });
        if (!row) continue;
        const url = provider.autoSend
          ? null
          : ((await provider.send({ to: row.toAddress, subject: row.subject, body: row.body }))
              .url ?? null);
        sent.push({ invoiceId: id, messageId: row.id, url });
      }
      if (providers[body.channel]?.autoSend) await processOrgQueue(tx, providers, now);
      await audit(tx, orgId, 'reminder.send', 'business', body.businessId, {
        after: { channel: body.channel, sent: sent.length, skipped: skipped.length },
      });
      return { sent, skipped, preview };
    },
  });

  // ---- service reminders -------------------------------------------------------------------------------------------------------

  const today = () => istParts(new Date()).date;
  const toService = (r: typeof serviceReminders.$inferSelect, partyName: string | null) => ({
    id: r.id,
    businessId: r.businessId,
    name: r.name,
    itemId: r.itemId,
    partyId: r.partyId,
    partyName,
    intervalUnit: r.intervalUnit as 'days' | 'months',
    intervalEvery: r.intervalEvery,
    remindBeforeDays: r.remindBeforeDays,
    channel: r.channel as MessageChannel,
    nextDue: r.nextDue,
    daysLeft: serviceDaysLeft(r.nextDue, today()),
    lastDoneAt: r.lastDoneAt,
    active: r.active,
  });
  const loadService = async (tx: Tx, id: string) => {
    const [r] = await tx
      .select()
      .from(serviceReminders)
      .where(and(eq(serviceReminders.id, id), isNull(serviceReminders.deletedAt)));
    if (!r) throw notFound('Service reminder');
    return r;
  };
  const nameOf = async (tx: Tx, partyId: string | null) =>
    partyId
      ? ((await tx.select({ n: parties.name }).from(parties).where(eq(parties.id, partyId)))[0]
          ?.n ?? null)
      : null;

  route({
    method: 'get',
    path: '/v1/service-reminders',
    tag: 'Messaging',
    summary: 'Service reminders, soonest due first',
    query: serviceListQuery,
    response: serviceList,
    handler: async ({ tx, query }) => {
      await loadBusiness(tx, query.businessId);
      const rows = await tx
        .select({ r: serviceReminders, partyName: parties.name })
        .from(serviceReminders)
        .leftJoin(parties, eq(parties.id, serviceReminders.partyId))
        .where(
          and(
            eq(serviceReminders.businessId, query.businessId),
            isNull(serviceReminders.deletedAt),
          ),
        )
        .orderBy(asc(serviceReminders.nextDue));
      const data = rows
        .map((x) => toService(x.r, x.partyName))
        .filter((s) => query.dueWithinDays === undefined || s.daysLeft <= query.dueWithinDays);
      return { data };
    },
  });

  route({
    method: 'post',
    path: '/v1/service-reminders',
    tag: 'Messaging',
    summary: 'Add a service reminder',
    body: serviceInput,
    response: serviceRow,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      await requireMessaging(tx, body.businessId);
      const nextDue =
        body.nextDue ??
        serviceNextDue(today(), { unit: body.intervalUnit, every: body.intervalEvery });
      const [r] = await tx
        .insert(serviceReminders)
        .values({
          ...body,
          orgId,
          itemId: body.itemId ?? null,
          partyId: body.partyId ?? null,
          nextDue,
        })
        .returning();
      return toService(r!, await nameOf(tx, r!.partyId));
    },
  });

  route({
    method: 'patch',
    path: '/v1/service-reminders/:id',
    tag: 'Messaging',
    summary: 'Change a service reminder',
    params: idParam,
    body: servicePatch,
    response: serviceRow,
    handler: async ({ tx, params, body }) => {
      const before = await loadService(tx, params.id);
      const [r] = await tx
        .update(serviceReminders)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(serviceReminders.id, before.id))
        .returning();
      return toService(r!, await nameOf(tx, r!.partyId));
    },
  });

  route({
    method: 'delete',
    path: '/v1/service-reminders/:id',
    tag: 'Messaging',
    summary: 'Delete a service reminder',
    params: idParam,
    response: okBody,
    handler: async ({ tx, params }) => {
      const r = await loadService(tx, params.id);
      await tx
        .update(serviceReminders)
        .set({ deletedAt: new Date() })
        .where(eq(serviceReminders.id, r.id));
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/service-reminders/:id/done',
    tag: 'Messaging',
    summary: 'The service was done today: the next one is due one interval from now',
    params: idParam,
    response: serviceRow,
    handler: async ({ tx, params }) => {
      const r = await loadService(tx, params.id);
      const done = today();
      const nextDue = serviceNextDue(done, {
        unit: r.intervalUnit as 'days' | 'months',
        every: r.intervalEvery,
      });
      const [u] = await tx
        .update(serviceReminders)
        .set({ nextDue, lastDoneAt: done, lastSentFor: null, updatedAt: new Date() })
        .where(eq(serviceReminders.id, r.id))
        .returning();
      return toService(u!, await nameOf(tx, u!.partyId));
    },
  });

  route({
    method: 'post',
    path: '/v1/service-reminders/:id/snooze',
    tag: 'Messaging',
    summary: 'Move the due date out; the interval is not changed',
    params: idParam,
    body: snoozeInput,
    response: serviceRow,
    handler: async ({ tx, params, body }) => {
      const r = await loadService(tx, params.id);
      const [u] = await tx
        .update(serviceReminders)
        .set({ nextDue: snoozeUntil(r.nextDue, body.days), updatedAt: new Date() })
        .where(eq(serviceReminders.id, r.id))
        .returning();
      return toService(u!, await nameOf(tx, u!.partyId));
    },
  });

  // ---- salesman location: consent, check-ins ----------------------------------------------------------------------------------

  /** The staff row of the signed-in member; a visit is always their own. */
  const myStaff = async (tx: Tx, userId: string) =>
    (
      await tx
        .select()
        .from(staff)
        .where(and(eq(staff.userId, userId), isNull(staff.deletedAt)))
    )[0] ?? null;
  const liveConsent = async (tx: Tx, staffId: string) =>
    (
      await tx
        .select()
        .from(staffConsents)
        .where(
          and(
            eq(staffConsents.staffId, staffId),
            isNull(staffConsents.revokedAt),
            isNull(staffConsents.deletedAt),
          ),
        )
        .orderBy(desc(staffConsents.consentedAt))
        .limit(1)
    )[0] ?? null;
  const needFlag = async (tx: Tx) => {
    if (!(await anyMessaging(tx)))
      throw new AppError(
        'conflict',
        'Salesman check-ins are part of Messaging, which is off. The owner can turn it on in Settings.',
      );
  };
  const toVisit = (v: typeof staffVisits.$inferSelect, partyName: string | null) => ({
    id: v.id,
    staffId: v.staffId,
    partyId: v.partyId,
    partyName,
    lat: v.lat,
    lng: v.lng,
    at: v.at.toISOString(),
    note: v.note,
  });

  route({
    method: 'get',
    path: '/v1/visits/consent',
    tag: 'Salesman',
    summary: 'The consent text, and whether you have agreed to it',
    response: consentView,
    handler: async ({ tx, auth }) => {
      await needFlag(tx);
      const me = await myStaff(tx, auth.user.id);
      const days = await visitRetentionDays(tx);
      const c = me ? await liveConsent(tx, me.id) : null;
      return {
        staffId: me?.id ?? null,
        given: !!c && c.textVersion === LOCATION_CONSENT_VERSION,
        version: LOCATION_CONSENT_VERSION,
        text: locationConsentText(days),
        retentionDays: days,
        consentedAt: iso(c?.consentedAt ?? null),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/visits/consent',
    tag: 'Salesman',
    summary: 'Agree to have your location recorded when you check in',
    body: consentInput,
    response: consentView,
    handler: async ({ tx, orgId, auth, body }) => {
      await needFlag(tx);
      if (body.version !== LOCATION_CONSENT_VERSION)
        throw new AppError('conflict', 'The consent wording changed. Read it again and confirm.');
      const me = await myStaff(tx, auth.user.id);
      if (!me)
        throw new AppError(
          'forbidden',
          'Your login is not linked to a salesman, so there is nothing to consent for',
        );
      if (
        !(await liveConsent(tx, me.id)) ||
        (await liveConsent(tx, me.id))!.textVersion !== body.version
      ) {
        await tx.insert(staffConsents).values({ orgId, staffId: me.id, textVersion: body.version });
        await audit(tx, orgId, 'visits.consent', 'staff', me.id, {
          after: { version: body.version },
        });
      }
      const days = await visitRetentionDays(tx);
      const c = await liveConsent(tx, me.id);
      return {
        staffId: me.id,
        given: true,
        version: body.version,
        text: locationConsentText(days),
        retentionDays: days,
        consentedAt: iso(c?.consentedAt ?? null),
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/visits/consent/withdraw',
    tag: 'Salesman',
    summary: 'Withdraw consent; optionally delete every check-in already recorded',
    body: withdrawInput,
    response: okBody,
    handler: async ({ tx, orgId, auth, body }) => {
      const me = await myStaff(tx, auth.user.id);
      if (!me) throw new AppError('forbidden', 'Your login is not linked to a salesman');
      await tx
        .update(staffConsents)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(staffConsents.staffId, me.id), isNull(staffConsents.revokedAt)));
      let erased = 0;
      if (body.erase)
        erased = (
          await tx
            .delete(staffVisits)
            .where(eq(staffVisits.staffId, me.id))
            .returning({ id: staffVisits.id })
        ).length;
      await audit(tx, orgId, 'visits.withdraw', 'staff', me.id, { after: { erased } });
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/visits',
    tag: 'Salesman',
    summary: 'Check in at a party (needs your consent; one tap, nothing in the background)',
    body: visitInput,
    response: visitRow,
    status: 201,
    handler: async ({ tx, orgId, auth, body }) => {
      await needFlag(tx);
      const me = await myStaff(tx, auth.user.id);
      const c = me ? await liveConsent(tx, me.id) : null;
      if (!me || !c || c.textVersion !== LOCATION_CONSENT_VERSION)
        throw new AppError('forbidden', 'Agree to the location consent before checking in');
      if (body.partyId) {
        const [p] = await tx
          .select({ id: parties.id })
          .from(parties)
          .where(eq(parties.id, body.partyId));
        if (!p) throw notFound('Party');
      }
      const [v] = await tx
        .insert(staffVisits)
        .values({
          orgId,
          staffId: me.id,
          partyId: body.partyId ?? null,
          lat: body.lat,
          lng: body.lng,
          note: body.note,
        })
        .returning();
      return toVisit(v!, await nameOf(tx, v!.partyId));
    },
  });

  route({
    method: 'get',
    path: '/v1/staff/:id/visits',
    tag: 'Salesman',
    summary: "A salesman's check-ins: their own, or any for an owner or admin",
    params: idParam,
    query: visitListQuery,
    response: visitList,
    handler: async ({ tx, auth, params, query }) => {
      await needFlag(tx);
      const me = await myStaff(tx, auth.user.id);
      if (!(auth.role === 'owner' || auth.role === 'admin' || me?.id === params.id))
        throw new AppError(
          'forbidden',
          'Only the owner or an admin can see another salesman’s check-ins',
        );
      const rows = await tx
        .select({ v: staffVisits, partyName: parties.name })
        .from(staffVisits)
        .leftJoin(parties, eq(parties.id, staffVisits.partyId))
        .where(
          and(
            eq(staffVisits.staffId, params.id),
            isNull(staffVisits.deletedAt),
            lt(staffVisits.at, new Date(Date.now() + 86_400_000)),
          ),
        )
        .orderBy(desc(staffVisits.at))
        .limit(query.limit);
      return {
        data: rows.map((r) => toVisit(r.v, r.partyName)),
        retentionDays: await visitRetentionDays(tx),
      };
    },
  });
}
