// Vyapar parity Phase 9: the pure rules behind messages, payment reminders and service reminders. No clock, no I/O: the
// job passes "today" and "now" in, so every edge (paid between runs, month ends, quiet hours) is tested without waiting.
// Dates are 'YYYY-MM-DD' strings; times are India Standard Time, like the report and backup schedulers.

import { addDays, daysBetween } from './compliance.ts';
import { addMonths } from './loan.ts';

const DAY = 86_400_000;
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

export const istParts = (now: Date) => {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return {
    date: ist.toISOString().slice(0, 10),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
};

// ---- templates ----------------------------------------------------------------------------------------------------------

export const TEMPLATE_VARIABLES = [
  'party',
  'number',
  'amount',
  'balance',
  'due_date',
  'business',
  'link',
  'date',
  'items',
] as const;

/** Text goes out as plain text; control characters (a pasted NUL or ESC) are dropped so they can not reach a provider. */
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

/** Replaces `{name}` with its value. Unknown names stay as written and are listed, so the editor can flag them. */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
) {
  const unknown: string[] = [];
  const text = body.replace(/\{([a-z_]+)\}/gi, (whole, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) {
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    }
    const v = vars[name];
    return v === null || v === undefined ? '' : clean(String(v));
  });
  return { text, unknown };
}

/** WhatsApp takes 4096 characters; SMS is 160 per segment (GSM-7) or 70 (anything else, such as ₹ or Tamil). */
export const WHATSAPP_LIMIT = 4096;
export function smsSegments(text: string) {
  if (!text) return { segments: 0, unicode: false, length: 0 };
  const length = [...text].length;
  const unicode = /[^\n\r\x20-\x7E]/.test(text);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return { segments: length <= single ? 1 : Math.ceil(length / multi), unicode, length };
}

// ---- the whatsappLink provider ---------------------------------------------------------------------------------------------

/** Digits for wa.me with the country code: 10 digits get 91, 0 + 10 gets 91, 91 + 10 stays; anything else is not a phone. */
export function normalizePhone(raw: string | null | undefined) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  return null;
}
export const whatsappUrl = (phone: string, text: string) =>
  `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

// ---- queue --------------------------------------------------------------------------------------------------------------

/** Minutes to wait before attempt n+1 after attempt n failed: 1, 5, 30. null = give up. */
export const RETRY_MINUTES = [1, 5, 30] as const;
export const retryDelayMinutes = (attemptsSoFar: number) =>
  RETRY_MINUTES[attemptsSoFar - 1] ?? null;

/** One message per (document, event, channel, day): the second try to queue it is a no-op. */
export const idempotencyKey = (o: {
  refType: string;
  refId: string;
  event: string;
  channel: string;
  scheduledDate: string;
}) => [o.refType, o.refId, o.event, o.channel, o.scheduledDate].join('|');

// ---- quiet hours -----------------------------------------------------------------------------------------------------------

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
export interface QuietHours {
  /** First minute messages may go out, 'HH:MM' IST. */
  start: string;
  /** First minute they may not, 'HH:MM' IST. */
  end: string;
}
export const DEFAULT_QUIET: QuietHours = { start: '09:00', end: '20:00' };

/** Is `now` inside the sending window? start == end means no restriction. A window that crosses midnight is allowed. */
export function inSendWindow(now: Date, w: QuietHours = DEFAULT_QUIET) {
  const a = minutesOf(w.start);
  const b = minutesOf(w.end);
  if (a === b) return true;
  const m = istParts(now).minutes;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** The first moment at or after `now` that is inside the window (now itself when it already is). */
export function nextSendTime(now: Date, w: QuietHours = DEFAULT_QUIET) {
  if (inSendWindow(now, w)) return now;
  const a = minutesOf(w.start);
  const { date, minutes } = istParts(now);
  const day = minutes < a ? date : addDays(date, 1);
  return new Date(parse(day) + a * 60_000 - 5.5 * 3_600_000);
}

// ---- payment reminders ------------------------------------------------------------------------------------------------------

export interface ReminderSettings {
  daysBefore: number;
  onDue: boolean;
  daysAfter: number[];
  maxPerInvoice: number;
}

/**
 * The offsets (today − due date) on which a reminder is due: −daysBefore, 0 when onDue, then each of daysAfter.
 * Sorted and without duplicates; a non-positive daysBefore means none before the due date.
 */
export function reminderOffsets(s: ReminderSettings) {
  const out = new Set<number>();
  if (Number.isInteger(s.daysBefore) && s.daysBefore > 0) out.add(-s.daysBefore);
  if (s.onDue) out.add(0);
  for (const d of s.daysAfter) if (Number.isInteger(d) && d > 0) out.add(d);
  return [...out].sort((a, b) => a - b);
}

export interface RemindableInvoice {
  dueDate: string | null;
  /** Total less what has been paid; 0 or less is settled. */
  pending: number;
  status: string;
}
export interface SentReminder {
  /** today − dueDate at the time it was queued. */
  offset: number;
  /** The due date it was for: a changed due date starts the schedule again. */
  dueDate: string;
}

/**
 * Should a reminder be queued today, and for which offset? Never for a settled, cancelled or undated invoice; never twice
 * for one offset of the same due date; never past the maximum. When a run was missed, the latest offset that has passed
 * and was not sent is used once (one late reminder, not three at once).
 */
export function shouldRemind(
  inv: RemindableInvoice,
  today: string,
  offsets: number[],
  sent: SentReminder[],
  max = 5,
): { remind: boolean; offset: number | null } {
  const no = { remind: false, offset: null };
  if (!inv.dueDate || inv.status === 'cancelled' || inv.status === 'paid' || inv.pending <= 0.005)
    return no;
  const now = daysBetween(inv.dueDate, today);
  const mine = sent.filter((s) => s.dueDate === inv.dueDate);
  if (mine.length >= max) return no;
  const passed = offsets.filter((o) => o <= now && !mine.some((s) => s.offset === o));
  if (!passed.length) return no;
  const offset = passed[passed.length - 1]!;
  // An older offset than one already sent is history, not something to send now.
  if (mine.some((s) => s.offset > offset)) return no;
  return { remind: true, offset };
}

// ---- service reminders ------------------------------------------------------------------------------------------------------

export type ServiceInterval = { unit: 'days' | 'months'; every: number };

/** When the next service is due after `from` (the day the last one was done or the sale was made). */
export function serviceNextDue(from: string, i: ServiceInterval) {
  if (!Number.isInteger(i.every) || i.every < 1)
    throw new RangeError('The interval must be a whole number above zero');
  return i.unit === 'days' ? addDays(from, i.every) : addMonths(from, i.every);
}

/** Days from `today` to the due date, negative once late. */
export const serviceDaysLeft = (nextDue: string, today: string) => daysBetween(today, nextDue);

/** Is the "due soon" message due: inside the lead time, not sent for this due date yet. Overdue ones still count. */
export function serviceReminderDue(
  r: { nextDue: string; remindBeforeDays: number; lastSentFor: string | null; active: boolean },
  today: string,
) {
  return (
    r.active &&
    r.lastSentFor !== r.nextDue &&
    serviceDaysLeft(r.nextDue, today) <= r.remindBeforeDays
  );
}

/** Snooze moves the due date, never the interval. */
export const snoozeUntil = (nextDue: string, days: number) => addDays(nextDue, days);

// ---- retention ------------------------------------------------------------------------------------------------------------------

/** The instant before which location rows are deleted. */
export const retentionCutoff = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
