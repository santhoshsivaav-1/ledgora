// Vyapar parity Phase 9: the pure rules, tested before any job runs ("Phase 9 test plan": reminderOffsets 6,
// shouldRemind 12, renderTemplate 8, serviceNextDue 8, commission 6 — commission is covered by salesmanPerformance).
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QUIET,
  idempotencyKey,
  inSendWindow,
  nextSendTime,
  normalizePhone,
  reminderOffsets,
  renderTemplate,
  retentionCutoff,
  retryDelayMinutes,
  serviceDaysLeft,
  serviceNextDue,
  serviceReminderDue,
  shouldRemind,
  smsSegments,
  snoozeUntil,
  whatsappUrl,
} from '../src/index.ts';

const S = { daysBefore: 3, onDue: true, daysAfter: [3, 7, 15], maxPerInvoice: 5 };
const OFFS = reminderOffsets(S);
const inv = (o = {}) => ({ dueDate: '2026-11-10', pending: 1000, status: 'unpaid', ...o });
// IST 10:00 on 2026-11-12 is 04:30 UTC.
const ist = (hhmm, date = '2026-11-12') => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000 - 5.5 * 3_600_000);
};

describe('reminderOffsets', () => {
  it('is before, on the day, then after, in order', () => expect(OFFS).toEqual([-3, 0, 3, 7, 15]));
  it('leaves out the day itself when onDue is off', () =>
    expect(reminderOffsets({ ...S, onDue: false })).toEqual([-3, 3, 7, 15]));
  it('leaves out "before" when daysBefore is 0', () =>
    expect(reminderOffsets({ ...S, daysBefore: 0 })).toEqual([0, 3, 7, 15]));
  it('sorts and removes duplicates', () =>
    expect(reminderOffsets({ ...S, daysAfter: [15, 3, 3, 7] })).toEqual([-3, 0, 3, 7, 15]));
  it('ignores zero, negative and fractional entries in daysAfter', () =>
    expect(reminderOffsets({ ...S, daysAfter: [0, -2, 2.5, 5] })).toEqual([-3, 0, 5]));
  it('can be empty', () =>
    expect(reminderOffsets({ daysBefore: 0, onDue: false, daysAfter: [], maxPerInvoice: 5 })).toEqual([]));
});

describe('shouldRemind', () => {
  const go = (i, today, sent = [], max = 5) => shouldRemind(i, today, OFFS, sent, max);
  it('reminds three days before the due date', () => expect(go(inv(), '2026-11-07')).toEqual({ remind: true, offset: -3 }));
  it('does not remind four days before', () => expect(go(inv(), '2026-11-06').remind).toBe(false));
  it('reminds on the due date', () => expect(go(inv(), '2026-11-10')).toEqual({ remind: true, offset: 0 }));
  it('reminds 7 days late', () => expect(go(inv(), '2026-11-17', [{ offset: 3, dueDate: '2026-11-10' }])).toEqual({ remind: true, offset: 7 }));
  it('never reminds a paid invoice, whatever else is true', () => {
    expect(go(inv({ status: 'paid', pending: 0 }), '2026-11-17').remind).toBe(false);
    expect(go(inv({ status: 'unpaid', pending: 0 }), '2026-11-17').remind).toBe(false);
  });
  it('never reminds a cancelled invoice or one with no due date', () => {
    expect(go(inv({ status: 'cancelled' }), '2026-11-17').remind).toBe(false);
    expect(go(inv({ dueDate: null }), '2026-11-17').remind).toBe(false);
  });
  it('reminds a partly paid invoice while something is pending', () => {
    expect(go(inv({ status: 'partial', pending: 300 }), '2026-11-10').remind).toBe(true);
    expect(go(inv({ status: 'partial', pending: 0.004 }), '2026-11-10').remind).toBe(false);
  });
  it('does not send the same offset twice', () =>
    expect(go(inv(), '2026-11-10', [{ offset: -3, dueDate: '2026-11-10' }, { offset: 0, dueDate: '2026-11-10' }]).remind).toBe(false));
  it('sends one late reminder, not three, when runs were missed', () =>
    expect(go(inv(), '2026-11-18')).toEqual({ remind: true, offset: 7 }));
  it('does not go back to an older offset once a later one was sent', () =>
    expect(go(inv(), '2026-11-18', [{ offset: 7, dueDate: '2026-11-10' }]).remind).toBe(false));
  it('stops at the maximum per invoice', () => {
    const sent = [-3, 0, 3].map((offset) => ({ offset, dueDate: '2026-11-10' }));
    expect(go(inv(), '2026-11-17', sent, 3).remind).toBe(false);
    expect(go(inv(), '2026-11-17', sent, 4).remind).toBe(true);
  });
  it('starts again when the due date is changed', () => {
    const sent = [{ offset: 0, dueDate: '2026-11-10' }];
    expect(go(inv({ dueDate: '2026-11-20' }), '2026-11-20', sent)).toEqual({ remind: true, offset: 0 });
  });
  it('stops reminding when the due date moves out of reach', () =>
    expect(go(inv({ dueDate: '2026-12-31' }), '2026-11-12').remind).toBe(false));
  it('stops after the last offset', () =>
    expect(go(inv(), '2026-12-30', [15].map((offset) => ({ offset, dueDate: '2026-11-10' }))).remind).toBe(false));
  it('treats a weekend day like any other', () => expect(go(inv({ dueDate: '2026-11-14' }), '2026-11-14').remind).toBe(true)); // a Saturday
});

describe('renderTemplate', () => {
  const vars = { party: 'Ravi Traders', number: 'INV-12', amount: '₹8,260', balance: '₹8,260', business: 'Sri Traders', link: 'https://x/s/abc' };
  it('fills known variables', () =>
    expect(renderTemplate('Dear {party}, {number} for {amount}.', vars)).toEqual({ text: 'Dear Ravi Traders, INV-12 for ₹8,260.', unknown: [] }));
  it('repeats a variable', () => expect(renderTemplate('{party}/{party}', vars).text).toBe('Ravi Traders/Ravi Traders'));
  it('leaves unknown names as written and lists them once', () => {
    const r = renderTemplate('Hi {nope} {nope} {party}', vars);
    expect(r.text).toBe('Hi {nope} {nope} Ravi Traders');
    expect(r.unknown).toEqual(['nope']);
  });
  it('turns a missing or null value into nothing', () => expect(renderTemplate('[{due_date}][{date}]', { date: null }).text).toBe('[][]'));
  it('renders numbers', () => expect(renderTemplate('{amount}', { amount: 100 }).text).toBe('100'));
  it('does not read variables out of values (no second pass)', () =>
    expect(renderTemplate('{party}', { party: '{amount}', amount: 'X' }).text).toBe('{amount}'));
  it('drops control characters but keeps new lines and tabs', () =>
    expect(renderTemplate('{party}', { party: 'a\u0000b\u001bc\nd\te' }).text).toBe('abc\nd\te'));
  it('leaves text without braces alone', () => expect(renderTemplate('Hello', vars)).toEqual({ text: 'Hello', unknown: [] }));
});

describe('serviceNextDue', () => {
  it('adds days', () => expect(serviceNextDue('2026-11-12', { unit: 'days', every: 90 })).toBe('2027-02-10'));
  it('adds months', () => expect(serviceNextDue('2026-11-12', { unit: 'months', every: 12 })).toBe('2027-11-12'));
  it('Jan 31 + 1 month is the last day of February', () => {
    expect(serviceNextDue('2026-01-31', { unit: 'months', every: 1 })).toBe('2026-02-28');
    expect(serviceNextDue('2028-01-31', { unit: 'months', every: 1 })).toBe('2028-02-29');
  });
  it('Aug 31 + 1 month is Sep 30', () => expect(serviceNextDue('2026-08-31', { unit: 'months', every: 1 })).toBe('2026-09-30'));
  it('crosses the year end', () => expect(serviceNextDue('2026-12-15', { unit: 'months', every: 3 })).toBe('2027-03-15'));
  it('a leap day plus a year is Feb 28', () => expect(serviceNextDue('2028-02-29', { unit: 'months', every: 12 })).toBe('2029-02-28'));
  it('refuses a zero, negative or fractional interval', () => {
    for (const every of [0, -1, 1.5]) expect(() => serviceNextDue('2026-01-01', { unit: 'days', every })).toThrow(RangeError);
  });
  it('is not stepwise: three monthly steps from the 31st are not 28th-based', () =>
    expect(serviceNextDue('2026-01-31', { unit: 'months', every: 3 })).toBe('2026-04-30'));
});

describe('service reminders and snooze', () => {
  const r = (o = {}) => ({ nextDue: '2026-12-02', remindBeforeDays: 7, lastSentFor: null, active: true, ...o });
  it('is due inside the lead time', () => expect(serviceReminderDue(r(), '2026-11-25')).toBe(true));
  it('is not due before it', () => expect(serviceReminderDue(r(), '2026-11-24')).toBe(false));
  it('stays due when overdue', () => expect(serviceReminderDue(r(), '2026-12-20')).toBe(true));
  it('is not due once sent for this due date, and is again for the next one', () => {
    expect(serviceReminderDue(r({ lastSentFor: '2026-12-02' }), '2026-11-30')).toBe(false);
    expect(serviceReminderDue(r({ lastSentFor: '2026-12-02', nextDue: '2027-12-02' }), '2027-11-30')).toBe(true);
  });
  it('is never due when switched off', () => expect(serviceReminderDue(r({ active: false }), '2026-12-01')).toBe(false));
  it('counts days left, negative when late', () => {
    expect(serviceDaysLeft('2026-12-02', '2026-11-25')).toBe(7);
    expect(serviceDaysLeft('2026-12-02', '2026-12-05')).toBe(-3);
  });
  it('snooze moves the due date only', () => expect(snoozeUntil('2026-12-02', 7)).toBe('2026-12-09'));
});

describe('quiet hours', () => {
  it('9:00 to 20:00 by default', () => {
    expect(inSendWindow(ist('08:59'), DEFAULT_QUIET)).toBe(false);
    expect(inSendWindow(ist('09:00'), DEFAULT_QUIET)).toBe(true);
    expect(inSendWindow(ist('19:59'), DEFAULT_QUIET)).toBe(true);
    expect(inSendWindow(ist('20:00'), DEFAULT_QUIET)).toBe(false);
  });
  it('queues to the next window start: same morning, or tomorrow', () => {
    expect(nextSendTime(ist('06:30'), DEFAULT_QUIET).getTime()).toBe(ist('09:00').getTime());
    expect(nextSendTime(ist('21:15'), DEFAULT_QUIET).getTime()).toBe(ist('09:00', '2026-11-13').getTime());
  });
  it('returns now when already inside the window', () => {
    const n = ist('12:00');
    expect(nextSendTime(n, DEFAULT_QUIET)).toBe(n);
  });
  it('rolls over a month end', () => expect(nextSendTime(ist('22:00', '2026-11-30'), DEFAULT_QUIET).getTime()).toBe(ist('09:00', '2026-12-01').getTime()));
  it('start equal to end means always', () => expect(inSendWindow(ist('03:00'), { start: '00:00', end: '00:00' })).toBe(true));
  it('a window across midnight', () => {
    const w = { start: '22:00', end: '06:00' };
    expect(inSendWindow(ist('23:00'), w)).toBe(true);
    expect(inSendWindow(ist('05:59'), w)).toBe(true);
    expect(inSendWindow(ist('12:00'), w)).toBe(false);
  });
});

describe('queue helpers', () => {
  it('backs off 1, 5, 30 minutes then gives up', () => {
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([1, 5, 30, null]);
  });
  it('the idempotency key names document, event, channel and day', () =>
    expect(idempotencyKey({ refType: 'invoice', refId: 'a', event: 'reminder', channel: 'whatsapp', scheduledDate: '2026-11-12' })).toBe('invoice|a|reminder|whatsapp|2026-11-12'));
  it('the retention cutoff is N days back', () =>
    expect(retentionCutoff(new Date('2026-11-12T00:00:00Z'), 90).toISOString()).toBe('2026-08-14T00:00:00.000Z'));
});

describe('whatsapp link and text size', () => {
  it('adds 91 to a 10-digit mobile', () => expect(normalizePhone('98765 43210')).toBe('919876543210'));
  it('accepts +91, 91 and a leading 0', () => {
    for (const p of ['+91 98765-43210', '919876543210', '09876543210']) expect(normalizePhone(p)).toBe('919876543210');
  });
  it('refuses short numbers, landlines and blanks', () => {
    for (const p of ['12345', '044 2345 6789', '', null, undefined, '5876543210']) expect(normalizePhone(p)).toBeNull();
  });
  it('encodes the text', () => expect(whatsappUrl('919876543210', 'Hi & ₹5\nok')).toBe('https://wa.me/919876543210?text=Hi%20%26%20%E2%82%B95%0Aok'));
  it('counts SMS segments: plain 160, unicode 70', () => {
    expect(smsSegments('a'.repeat(160))).toMatchObject({ segments: 1, unicode: false });
    expect(smsSegments('a'.repeat(161)).segments).toBe(2);
    expect(smsSegments('₹' + 'a'.repeat(69))).toMatchObject({ segments: 1, unicode: true });
    expect(smsSegments('₹' + 'a'.repeat(70)).segments).toBe(2);
    expect(smsSegments('').segments).toBe(0);
  });
});
