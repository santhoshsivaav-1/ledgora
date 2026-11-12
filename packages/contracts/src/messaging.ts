import { z } from 'zod';
import { isoDate, uuid } from './common.ts';

// Vyapar parity Phase 9 (behind the `msg.enabled` setting): messages, share links, payment and service reminders, and
// the salesman's visits with their consent.

export const MESSAGE_CHANNELS = ['whatsapp', 'sms', 'email'] as const;
export const messageChannel = z.enum(MESSAGE_CHANNELS);
export type MessageChannel = z.infer<typeof messageChannel>;

export const MESSAGE_EVENTS = [
  'sale',
  'payment_in',
  'purchase',
  'payment_out',
  'sale_order',
  'quotation',
  'reminder',
  'service_due',
] as const;
export const messageEvent = z.enum(MESSAGE_EVENTS);
export type MessageEvent = z.infer<typeof messageEvent>;

export const MESSAGE_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'failed',
  'opened',
  'cancelled',
] as const;

/** What each event says until the business edits it. The text is plain; `{name}` variables are listed in tax-engine/messaging.ts. */
export const DEFAULT_TEMPLATES: Record<MessageEvent, { subject: string; body: string }> = {
  sale: {
    subject: 'Invoice {number} from {business}',
    body: 'Dear {party}, your invoice {number} dated {date} for {amount} is ready. Balance {balance}. View: {link}\n- {business}',
  },
  payment_in: {
    subject: 'Payment received - {business}',
    body: 'Dear {party}, we received your payment of {amount} against {number}. Thank you.\n- {business}',
  },
  purchase: {
    subject: 'Purchase bill {number} - {business}',
    body: 'Dear {party}, we have recorded your bill {number} dated {date} for {amount}.\n- {business}',
  },
  payment_out: {
    subject: 'Payment made - {business}',
    body: 'Dear {party}, we have paid {amount} against {number}.\n- {business}',
  },
  sale_order: {
    subject: 'Order {number} from {business}',
    body: 'Dear {party}, your order {number} for {amount} is confirmed. View: {link}\n- {business}',
  },
  quotation: {
    subject: 'Quotation {number} from {business}',
    body: 'Dear {party}, our quotation {number} for {amount} is ready. View: {link}\n- {business}',
  },
  reminder: {
    subject: 'Payment reminder - {number}',
    body: 'Dear {party}, a gentle reminder: invoice {number} for {balance} was due on {due_date}. Please pay at your earliest. View: {link}\n- {business}',
  },
  service_due: {
    subject: 'Service due - {business}',
    body: 'Dear {party}, your {items} is due for service on {due_date}. Reply to book a slot.\n- {business}',
  },
};

// ---- templates -------------------------------------------------------------------------------------------------------------

export const msgTemplatesQuery = z.object({ businessId: uuid });
export const msgTemplateKey = z.object({
  businessId: uuid,
  event: messageEvent,
  channel: messageChannel,
  language: z.string().trim().min(2).max(8).default('en'),
});
export const msgTemplateInput = msgTemplateKey.extend({
  subject: z.string().max(200).default(''),
  body: z.string().trim().min(1).max(4096),
  active: z.boolean().default(true),
});
export const msgTemplateView = msgTemplateInput.extend({
  /** false = the built-in text; true = the business changed it. */
  custom: z.boolean(),
  unknown: z.array(z.string()),
});
export type MsgTemplateView = z.infer<typeof msgTemplateView>;
export const msgTemplateList = z.object({ data: z.array(msgTemplateView) });

// ---- sending ---------------------------------------------------------------------------------------------------------------

export const statusQuery = z.object({ businessId: uuid });
export const messagingStatus = z.object({
  enabled: z.boolean(),
  provider: z.string(),
  channels: z.object({ whatsapp: z.boolean(), email: z.boolean(), sms: z.boolean() }),
});

export const DOCUMENT_TYPES = ['invoice'] as const;
export const sendInput = z.object({
  businessId: uuid,
  refType: z.enum(DOCUMENT_TYPES).default('invoice'),
  refId: uuid,
  event: messageEvent.default('sale'),
  channel: messageChannel,
  /** The edited text; omitted = the template for this event. */
  body: z.string().trim().min(1).max(4096).optional(),
  /** Overrides the party's phone / email (the dialog's mini form). */
  to: z.string().trim().max(200).optional(),
  /** Add a public link to the message. */
  includeLink: z.boolean().default(true),
});
export const previewResult = z.object({
  text: z.string(),
  subject: z.string(),
  unknown: z.array(z.string()),
  to: z.string().nullable(),
  partyName: z.string().nullable(),
  optedOut: z.boolean(),
  channelLimit: z.object({
    length: z.number(),
    max: z.number().nullable(),
    segments: z.number().nullable(),
  }),
});
export const messageRow = z.object({
  id: uuid,
  channel: messageChannel,
  to: z.string(),
  event: z.string(),
  refType: z.string(),
  refId: uuid,
  partyId: uuid.nullable(),
  body: z.string(),
  subject: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  scheduledAt: z.string(),
  sentAt: z.string().nullable(),
});
export type MessageRow = z.infer<typeof messageRow>;
export const sendResult = z.object({
  message: messageRow,
  /** whatsapp: the wa.me address to open. */
  url: z.string().nullable(),
});
export const messageListQuery = z.object({
  businessId: uuid,
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const messageList = z.object({ data: z.array(messageRow) });

// ---- links -----------------------------------------------------------------------------------------------------------------

export const linkInput = z.object({
  refType: z.enum(DOCUMENT_TYPES).default('invoice'),
  refId: uuid,
  days: z.number().int().min(1).max(365).default(30),
});
export const linkRow = z.object({
  id: uuid,
  token: z.string(),
  url: z.string(),
  refType: z.string(),
  refId: uuid,
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  views: z.number().int(),
});
export const linkListQuery = z.object({
  refType: z.enum(DOCUMENT_TYPES).default('invoice'),
  refId: uuid,
});
export const linkList = z.object({ data: z.array(linkRow) });

// ---- payment reminders --------------------------------------------------------------------------------------------------------

export const reminderListQuery = z.object({
  businessId: uuid,
  minDaysLate: z.coerce.number().int().min(0).default(1),
  partyId: uuid.optional(),
});
export const reminderRow = z.object({
  invoiceId: uuid,
  number: z.string(),
  partyId: uuid.nullable(),
  partyName: z.string(),
  phone: z.string(),
  dueDate: isoDate,
  daysLate: z.number().int(),
  pending: z.number(),
  lastReminderAt: z.string().nullable(),
  lastChannel: z.string().nullable(),
  optedOut: z.boolean(),
});
export const reminderList = z.object({
  data: z.array(reminderRow),
  totalOverdue: z.number(),
  parties: z.number().int(),
});
export const reminderSendInput = z.object({
  businessId: uuid,
  invoiceIds: z.array(uuid).min(1).max(100),
  channel: messageChannel,
});
export const reminderSendResult = z.object({
  /** One per invoice that went out: whatsapp rows carry the address to open. */
  sent: z.array(z.object({ invoiceId: uuid, messageId: uuid, url: z.string().nullable() })),
  skipped: z.array(z.object({ invoiceId: uuid, reason: z.string() })),
  preview: z.string().nullable(),
});

// ---- service reminders --------------------------------------------------------------------------------------------------------

export const serviceInput = z.object({
  businessId: uuid,
  name: z.string().trim().min(1).max(100),
  itemId: uuid.nullish(),
  partyId: uuid.nullish(),
  intervalUnit: z.enum(['days', 'months']),
  intervalEvery: z.number().int().min(1).max(3650),
  remindBeforeDays: z.number().int().min(0).max(365).default(7),
  channel: messageChannel.default('whatsapp'),
  /** First due date; omitted = today plus the interval. */
  nextDue: isoDate.optional(),
});
export const servicePatch = serviceInput
  .omit({ businessId: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export const serviceRow = z.object({
  id: uuid,
  businessId: uuid,
  name: z.string(),
  itemId: uuid.nullable(),
  partyId: uuid.nullable(),
  partyName: z.string().nullable(),
  intervalUnit: z.enum(['days', 'months']),
  intervalEvery: z.number().int(),
  remindBeforeDays: z.number().int(),
  channel: messageChannel,
  nextDue: isoDate,
  daysLeft: z.number().int(),
  lastDoneAt: z.string().nullable(),
  active: z.boolean(),
});
export const serviceListQuery = z.object({
  businessId: uuid,
  dueWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
});
export const serviceList = z.object({ data: z.array(serviceRow) });
export const snoozeInput = z.object({ days: z.number().int().min(1).max(365) });

// ---- salesman location (sensitive) -----------------------------------------------------------------------------------------------

/**
 * What a salesman agrees to. Bump the version when the wording changes: everyone is asked again. The retention is
 * stated in the text so the promise and the job are the same number (visits.retentionDays).
 */
export const LOCATION_CONSENT_VERSION = '2026-11-v1';
export const locationConsentText = (retentionDays: number) =>
  `Ledgora will record your phone's location only when you press "Check in" at a customer, together with the time and ` +
  `your note. Your owner and admins can see these check-ins. They are deleted automatically after ${retentionDays} days. ` +
  `Nothing is recorded in the background. You can withdraw at any time, and you can ask for your check-ins to be deleted.`;

export const consentView = z.object({
  staffId: uuid.nullable(),
  given: z.boolean(),
  version: z.string(),
  text: z.string(),
  retentionDays: z.number().int(),
  consentedAt: z.string().nullable(),
});
export const consentInput = z.object({ version: z.string() });
export const withdrawInput = z.object({ erase: z.boolean().default(false) });
export const visitInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  partyId: uuid.nullish(),
  note: z.string().trim().max(300).default(''),
});
export const visitRow = z.object({
  id: uuid,
  staffId: uuid,
  partyId: uuid.nullable(),
  partyName: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  at: z.string(),
  note: z.string(),
});
export const visitList = z.object({ data: z.array(visitRow), retentionDays: z.number().int() });
export const visitListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
