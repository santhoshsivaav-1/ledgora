import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@ledgora/db';
import {
  generateResult,
  idParam,
  okBody,
  page,
  pageQuery,
  recurring,
  recurringInput,
  recurringPatch,
  type Recurring,
} from '@ledgora/contracts';
import { localToday } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import { listPage, stamps, type Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { createInvoice } from './invoices.ts';

const { recurringSchedules } = schema;
type Row = typeof recurringSchedules.$inferSelect;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
export const addDays = (s: string, n: number) => {
  const d = parseDay(s);
  if (!d) return s;
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};

/**
 * Next run date. Monthly, quarterly and yearly steps keep the day of month the schedule started on (`anchorDay`),
 * clamped to short months: 31 Jan -> 28 Feb -> 31 Mar.
 */
export function advanceDate(
  date: string,
  frequency: string,
  interval: number,
  anchorDay?: number | null,
) {
  const d = parseDay(date);
  if (!d) return date;
  const n = Math.max(1, interval || 1);
  if (frequency === 'weekly') return addDays(date, 7 * n);
  const months = frequency === 'quarterly' ? 3 * n : frequency === 'yearly' ? 12 * n : n;
  const day = Math.min(31, Math.max(1, anchorDay || d.getUTCDate()));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return isoDay(target);
}

const hasEnded = (r: Row, today: string) =>
  (r.endMode === 'onDate' && !!r.endDate && today > r.endDate) ||
  (r.endMode === 'afterN' && !!r.maxOccurrences && r.occurrencesCreated >= r.maxOccurrences);

const toRecurring = (r: Row): Recurring => ({
  id: r.id,
  businessId: r.businessId,
  partyId: r.partyId,
  name: r.name,
  frequency: r.frequency as Recurring['frequency'],
  interval: r.interval,
  nextDate: r.nextDate,
  endMode: r.endMode as Recurring['endMode'],
  endDate: r.endDate,
  maxOccurrences: r.maxOccurrences,
  dueDays: r.dueDays,
  active: r.active,
  template: r.template as Recurring['template'],
  occurrencesCreated: r.occurrencesCreated,
  lastGenerated: r.lastGenerated,
  ...stamps(r),
});

export function recurringModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/recurring',
    tag: 'Recurring',
    summary: 'Recurring invoice schedules',
    query: pageQuery,
    response: page(recurring),
    handler: async ({ tx, query }) => {
      const res = await listPage(tx, recurringSchedules, {
        ...query,
        searchColumns: [recurringSchedules.name],
      });
      return { data: res.data.map(toRecurring), nextCursor: res.nextCursor };
    },
  });

  route({
    method: 'post',
    path: '/v1/recurring',
    tag: 'Recurring',
    summary: 'Create a schedule',
    body: recurringInput,
    response: recurring,
    status: 201,
    handler: async ({ tx, orgId, body }) => {
      await loadBusiness(tx, body.businessId);
      const [row] = await tx
        .insert(recurringSchedules)
        .values({ ...body, orgId, anchorDay: Number(body.nextDate.slice(8, 10)) || null })
        .returning();
      await audit(tx, orgId, 'recurring.create', 'recurring', row.id);
      return toRecurring(row);
    },
  });

  route({
    method: 'patch',
    path: '/v1/recurring/:id',
    tag: 'Recurring',
    summary: 'Change or pause a schedule',
    params: idParam,
    body: recurringPatch,
    response: recurring,
    handler: async ({ tx, orgId, params, body }) => {
      const [row] = await tx
        .update(recurringSchedules)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(recurringSchedules.id, params.id), isNull(recurringSchedules.deletedAt)))
        .returning();
      if (!row) throw notFound('Recurring schedule');
      await audit(tx, orgId, 'recurring.update', 'recurring', row.id);
      return toRecurring(row);
    },
  });

  route({
    method: 'delete',
    path: '/v1/recurring/:id',
    tag: 'Recurring',
    summary: 'Move a schedule to the trash',
    params: idParam,
    response: okBody,
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(recurringSchedules)
        .set({ deletedAt: new Date() })
        .where(and(eq(recurringSchedules.id, params.id), isNull(recurringSchedules.deletedAt)))
        .returning();
      if (!row) throw notFound('Recurring schedule');
      await audit(tx, orgId, 'recurring.delete', 'recurring', row.id);
      return { ok: true };
    },
  });

  route({
    method: 'post',
    path: '/v1/recurring/:id/generate',
    tag: 'Recurring',
    summary: 'Generate the next invoice now (the daily scheduler arrives in change 6.7)',
    params: idParam,
    response: generateResult,
    status: 201,
    handler: async ({ tx, orgId, params }) => {
      const [sch] = await tx
        .select()
        .from(recurringSchedules)
        .where(and(eq(recurringSchedules.id, params.id), isNull(recurringSchedules.deletedAt)));
      if (!sch) throw notFound('Recurring schedule');
      const today = localToday();
      if (hasEnded(sch, today))
        throw new AppError(
          'conflict',
          'This schedule has reached its end date or number of invoices',
        );
      const t = sch.template as Recurring['template'];
      const { row } = await createInvoice(
        tx,
        orgId,
        {
          ...t,
          businessId: sch.businessId,
          partyId: sch.partyId,
          invoiceDate: today,
          dueDate: sch.dueDays != null ? addDays(today, sch.dueDays) : null,
          terms: t.terms ?? '',
          notes: t.notes ?? '',
        },
        { generatedFromId: sch.id },
      );
      const anchor = sch.anchorDay ?? (Number((sch.nextDate || today).slice(8, 10)) || null);
      await tx
        .update(recurringSchedules)
        .set({
          nextDate: advanceDate(sch.nextDate || today, sch.frequency, sch.interval, anchor),
          anchorDay: anchor,
          lastGenerated: today,
          occurrencesCreated: sch.occurrencesCreated + 1,
          updatedAt: new Date(),
        })
        .where(eq(recurringSchedules.id, sch.id));
      await audit(tx, orgId, 'recurring.generate', 'recurring', sch.id, {
        after: { invoiceId: row.id, number: row.number },
      });
      return { invoiceId: row.id, invoiceNumber: row.number };
    },
  });
}
