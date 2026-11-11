// Vyapar parity Phase 6: reports over HTTP. Every report registered in src/reports is listed at GET /v1/reports and run at
// GET /v1/reports/:id with its own query parameters; no route per report. Profit reports need `report:profit`, ledger
// reports need the ledger on. Also here: CSV export (streamed, up to 100,000 rows), favourites / recent / saved views,
// scheduled report e-mails, and the e-way bill register's record.
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import { can, idParam, isoDate, okBody, uuid } from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { csvStream } from '../reports/csv.ts';
import { reportDef, reportDefs } from '../reports/registry.ts';
import { runReport } from '../reports/run.ts';
import { runDueForOrg } from '../reports/schedules.ts';

const { reportPrefs, reportSchedules, ewayBills, invoices } = schema;

/** The most rows one export carries. The answer says so (`x-report-truncated`) when a report had more. */
export const MAX_EXPORT_ROWS = 100_000;

const listItem = z.object({
  id: z.string(),
  title: z.string(),
  group: z.string(),
  description: z.string(),
  profit: z.boolean(),
  ledger: z.boolean(),
  allowed: z.boolean(),
});
const result = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  totals: z.record(z.string(), z.number()),
  meta: z.record(z.string(), z.unknown()),
});
const reportId = z.string().regex(/^[a-z0-9-]{2,40}$/);

const view = z.object({
  id: z.string(),
  name: z.string(),
  reportId: z.string(),
  params: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
const prefs = z.object({
  favourites: z.array(z.string()),
  recent: z.array(z.string()),
  views: z.array(view),
});
type Prefs = z.infer<typeof prefs>;

const schedule = z.object({
  id: uuid,
  businessId: uuid,
  reportId: z.string(),
  title: z.string(),
  params: z.record(z.string(), z.unknown()),
  frequency: z.enum(['weekly', 'monthly']),
  recipients: z.array(z.string()),
  active: z.boolean(),
  lastPeriod: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
});
const scheduleInput = z.object({
  businessId: uuid,
  reportId,
  /** Filters apart from the period: party, side, status … */
  params: z.record(z.string(), z.string()).default({}),
  frequency: z.enum(['weekly', 'monthly']),
  recipients: z.array(z.string().trim().toLowerCase().email()).min(1).max(10),
});

const ewayInput = z.object({
  ewayNo: z.string().trim().max(20).default(''),
  vehicleNo: z.string().trim().toUpperCase().max(15).default(''),
  distanceKm: z.string().trim().max(6).default(''),
  status: z.enum(['pending', 'generated', 'cancelled']).default('generated'),
  validUntil: isoDate.nullish(),
  jsonExportedOn: isoDate.nullish(),
  notes: z.string().max(300).default(''),
});

export function reportsModule({ route }: Registrar) {
  const mine = async (
    tx: Parameters<Parameters<Registrar['route']>[0]['handler']>[0]['tx'],
    orgId: string,
    userId: string,
  ): Promise<Prefs> => {
    const [row] = await tx
      .select()
      .from(reportPrefs)
      .where(and(eq(reportPrefs.orgId, orgId), eq(reportPrefs.userId, userId)));
    return {
      favourites: (row?.favourites ?? []) as string[],
      recent: (row?.recent ?? []) as string[],
      views: (row?.views ?? []) as Prefs['views'],
    };
  };
  const save = async (
    tx: Parameters<Parameters<Registrar['route']>[0]['handler']>[0]['tx'],
    orgId: string,
    userId: string,
    p: Prefs,
  ) => {
    await tx
      .insert(reportPrefs)
      .values({ orgId, userId, ...p })
      .onConflictDoUpdate({
        target: [reportPrefs.orgId, reportPrefs.userId],
        set: { ...p, updatedAt: new Date() },
      });
    return p;
  };

  // ---- the list -------------------------------------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/reports',
    tag: 'Reports',
    summary: 'Every report the API can run, by group, and whether this role may open it',
    response: z.object({ data: z.array(listItem) }),
    handler: async ({ auth }) => {
      return {
        data: reportDefs().map((d) => ({
          id: d.id,
          title: d.title,
          group: d.group,
          description: d.description,
          profit: !!d.profit,
          ledger: !!d.ledger,
          allowed: !d.profit || can(auth.role, 'report:profit'),
        })),
      };
    },
  });

  // ---- favourites, recent, saved views (per member) ---------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/reports/prefs',
    tag: 'Reports',
    summary: 'Your starred reports, the last five you opened and your saved views',
    response: prefs,
    handler: async ({ tx, orgId, auth }) => mine(tx, orgId, auth.user.id),
  });
  route({
    method: 'put',
    path: '/v1/reports/prefs/favourites',
    tag: 'Reports',
    summary: 'Star or unstar a report',
    body: z.object({ reportId, on: z.boolean() }),
    response: prefs,
    handler: async ({ tx, orgId, auth, body }) => {
      const p = await mine(tx, orgId, auth.user.id);
      const rest = p.favourites.filter((x) => x !== body.reportId);
      return save(tx, orgId, auth.user.id, {
        ...p,
        favourites: (body.on ? [...rest, body.reportId] : rest).slice(-30),
      });
    },
  });
  route({
    method: 'post',
    path: '/v1/reports/prefs/recent',
    tag: 'Reports',
    summary: 'Note that a report was opened (kept: the last five)',
    body: z.object({ reportId }),
    response: prefs,
    handler: async ({ tx, orgId, auth, body }) => {
      const p = await mine(tx, orgId, auth.user.id);
      return save(tx, orgId, auth.user.id, {
        ...p,
        recent: [body.reportId, ...p.recent.filter((x) => x !== body.reportId)].slice(0, 5),
      });
    },
  });
  route({
    method: 'post',
    path: '/v1/reports/prefs/views',
    tag: 'Reports',
    summary:
      'Save the filters of a report under a name; the same name on the same report is replaced',
    body: z.object({
      name: z.string().trim().min(1).max(60),
      reportId,
      params: z.record(z.string(), z.unknown()),
    }),
    response: prefs,
    status: 201,
    handler: async ({ tx, orgId, auth, body }) => {
      const p = await mine(tx, orgId, auth.user.id);
      const kept = p.views.filter(
        (v) => !(v.reportId === body.reportId && v.name.toLowerCase() === body.name.toLowerCase()),
      );
      if (kept.length >= 50)
        throw new AppError('unprocessable', 'You can keep 50 saved views. Delete one first.');
      return save(tx, orgId, auth.user.id, {
        ...p,
        views: [
          ...kept,
          {
            id: crypto.randomUUID(),
            name: body.name,
            reportId: body.reportId,
            params: body.params,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    },
  });
  route({
    method: 'delete',
    path: '/v1/reports/prefs/views/:id',
    tag: 'Reports',
    summary: 'Delete a saved view',
    params: z.object({ id: z.string().min(8).max(40) }),
    response: prefs,
    handler: async ({ tx, orgId, auth, params }) => {
      const p = await mine(tx, orgId, auth.user.id);
      if (!p.views.some((v) => v.id === params.id)) throw notFound('Saved view');
      return save(tx, orgId, auth.user.id, {
        ...p,
        views: p.views.filter((v) => v.id !== params.id),
      });
    },
  });

  // ---- scheduled e-mails ------------------------------------------------------------------------------------------------
  const toSchedule = (s: typeof reportSchedules.$inferSelect) => ({
    id: s.id,
    businessId: s.businessId,
    reportId: s.reportId,
    title: reportDef(s.reportId)?.title ?? s.reportId,
    params: s.params as Record<string, unknown>,
    frequency: s.frequency as 'weekly' | 'monthly',
    recipients: s.recipients as string[],
    active: s.active,
    lastPeriod: s.lastPeriod,
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    lastError: s.lastError,
  });
  route({
    method: 'get',
    path: '/v1/reports/schedules',
    tag: 'Reports',
    summary: 'The e-mail schedules of a business',
    query: z.object({ businessId: uuid }),
    response: z.object({ data: z.array(schedule) }),
    handler: async ({ tx, query }) => {
      const rows = await tx
        .select()
        .from(reportSchedules)
        .where(
          and(eq(reportSchedules.businessId, query.businessId), isNull(reportSchedules.deletedAt)),
        )
        .orderBy(desc(reportSchedules.createdAt));
      return { data: rows.map(toSchedule) };
    },
  });
  route({
    method: 'post',
    path: '/v1/reports/schedules',
    tag: 'Reports',
    summary:
      'E-mail a report every week (the week before) or month (the month before) as a CSV. Once per period, even across restarts',
    body: scheduleInput,
    response: schedule,
    status: 201,
    permission: 'data:export',
    handler: async ({ tx, orgId, auth, body }) => {
      await loadBusiness(tx, body.businessId);
      const def = reportDef(body.reportId);
      if (!def) throw notFound('Report');
      if (def.profit && !can(auth.role, 'report:profit'))
        throw new AppError(
          'forbidden',
          'Your role can not see profit reports, so it can not send them',
          { needs: 'report:profit' },
        );
      // The filters must be ones the report accepts (the period is the schedule's, so it is not asked for).
      const probe = def.params.safeParse({
        ...body.params,
        businessId: body.businessId,
        from: '2026-04-01',
        to: '2026-04-30',
      });
      if (!probe.success)
        throw new AppError(
          'unprocessable',
          probe.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      const [row] = await tx
        .insert(reportSchedules)
        .values({
          orgId,
          businessId: body.businessId,
          reportId: body.reportId,
          params: body.params,
          frequency: body.frequency,
          recipients: body.recipients,
          createdBy: auth.user.id,
        })
        .returning();
      await audit(tx, orgId, 'report.schedule_create', 'report_schedule', row.id, {
        after: {
          report: row.reportId,
          frequency: row.frequency,
          recipients: body.recipients.length,
        },
      });
      return toSchedule(row);
    },
  });
  route({
    method: 'patch',
    path: '/v1/reports/schedules/:id',
    tag: 'Reports',
    summary: 'Pause or resume a schedule, or change its recipients',
    params: idParam,
    body: z.object({
      active: z.boolean().optional(),
      recipients: scheduleInput.shape.recipients.optional(),
    }),
    response: schedule,
    permission: 'data:export',
    handler: async ({ tx, orgId, params, body }) => {
      const [row] = await tx
        .update(reportSchedules)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(reportSchedules.id, params.id), isNull(reportSchedules.deletedAt)))
        .returning();
      if (!row) throw notFound('Schedule');
      await audit(tx, orgId, 'report.schedule_update', 'report_schedule', row.id, { after: body });
      return toSchedule(row);
    },
  });
  route({
    method: 'delete',
    path: '/v1/reports/schedules/:id',
    tag: 'Reports',
    summary: 'Stop and remove a schedule',
    params: idParam,
    response: okBody,
    permission: 'data:export',
    handler: async ({ tx, orgId, params }) => {
      const [row] = await tx
        .update(reportSchedules)
        .set({ deletedAt: new Date(), active: false })
        .where(and(eq(reportSchedules.id, params.id), isNull(reportSchedules.deletedAt)))
        .returning();
      if (!row) throw notFound('Schedule');
      await audit(tx, orgId, 'report.schedule_delete', 'report_schedule', row.id, {
        before: { report: row.reportId },
      });
      return { ok: true as const };
    },
  });
  route({
    method: 'post',
    path: '/v1/reports/schedules/run-due',
    tag: 'Reports',
    summary:
      'Send the schedules of this organization that are due now (the server does this by itself every half hour)',
    response: z.object({ sent: z.number(), skipped: z.number(), failed: z.number() }),
    permission: 'data:export',
    handler: async ({ tx, orgId, deps }) => runDueForOrg(tx, orgId, deps.env),
  });

  // ---- e-way bill register ----------------------------------------------------------------------------------------------
  route({
    method: 'put',
    path: '/v1/eway-bills/:id',
    tag: 'Reports',
    summary:
      'Record what the e-way bill portal gave for an invoice: number, vehicle, validity and status',
    params: idParam,
    body: ewayInput,
    response: okBody,
    handler: async ({ tx, orgId, params, body }) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, params.id), isNull(invoices.deletedAt)));
      if (!inv) throw notFound('Invoice');
      if (body.status === 'generated' && !body.ewayNo)
        throw new AppError('unprocessable', 'Enter the e-way bill number');
      await tx
        .insert(ewayBills)
        .values({
          orgId,
          businessId: inv.businessId,
          invoiceId: inv.id,
          ...body,
          validUntil: body.validUntil ?? null,
          jsonExportedOn: body.jsonExportedOn ?? null,
        })
        .onConflictDoUpdate({
          target: [ewayBills.orgId, ewayBills.invoiceId],
          targetWhere: isNull(ewayBills.deletedAt),
          set: {
            ...body,
            validUntil: body.validUntil ?? null,
            jsonExportedOn: body.jsonExportedOn ?? null,
            updatedAt: new Date(),
          },
        });
      await audit(tx, orgId, 'eway.record', 'invoice', inv.id, {
        after: { ewayNo: body.ewayNo, status: body.status },
      });
      return { ok: true as const };
    },
  });

  // ---- run and export ---------------------------------------------------------------------------------------------------
  route({
    method: 'get',
    path: '/v1/reports/:id/export',
    tag: 'Reports',
    summary:
      'A report as a CSV file, streamed in chunks (up to 100,000 rows; x-report-truncated says when there were more). Same filters as running it',
    params: z.object({ id: reportId }),
    handler: async ({ tx, orgId, auth, params, c }) => {
      const def = reportDef(params.id);
      if (!def) throw notFound('Report');
      if (def.profit && !can(auth.role, 'report:profit'))
        throw new AppError('forbidden', 'Your role can not see profit reports', {
          needs: 'report:profit',
        });
      const { result: r } = await runReport(tx, orgId, params.id, c.req.query());
      const rows = r.rows.slice(0, MAX_EXPORT_ROWS);
      const body = csvStream(rows);
      await audit(tx, orgId, 'report.export', 'report', null, {
        after: { report: params.id, rows: rows.length },
      });
      return new Response(body, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${params.id}.csv"`,
          'x-report-rows': String(rows.length),
          ...(r.rows.length > MAX_EXPORT_ROWS ? { 'x-report-truncated': '1' } : {}),
        },
      });
    },
  });

  route({
    method: 'get',
    path: '/v1/reports/:id',
    tag: 'Reports',
    summary:
      'Run one report: rows, totals worked out on the server for the whole period, and meta (period, opening and closing figures)',
    params: z.object({ id: reportId }),
    response: result,
    handler: async ({ tx, orgId, auth, params, c }) => {
      const d = reportDef(params.id);
      if (!d) throw notFound('Report');
      if (d.profit && !can(auth.role, 'report:profit'))
        throw new AppError('forbidden', 'Your role can not see profit reports', {
          needs: 'report:profit',
        });
      const { def, result: r } = await runReport(tx, orgId, params.id, c.req.query());
      return {
        rows: r.rows,
        totals: r.totals ?? {},
        meta: {
          ...(r.meta ?? {}),
          id: def.id,
          title: def.title,
          generatedAt: new Date().toISOString(),
        },
      };
    },
  });
}
