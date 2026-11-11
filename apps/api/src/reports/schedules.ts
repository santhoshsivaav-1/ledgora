// Vyapar parity P6-S8: scheduled report e-mails. A schedule names a report, its filters, weekly or monthly and the
// recipients; each run sends the previous full week or month as a CSV. Once per period, whatever restarts: the period
// sent is recorded (`last_period`) under a row lock, and a second runner finds it already done.
import { and, asc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { schema, withTenant, type Database, type Tx } from '@ledgora/db';
import { previousPeriod } from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import type { AppEnv } from '../env.ts';
import { sendMail } from '../mail/index.ts';
import { reportCsv } from './csv.ts';
import { runReport } from './run.ts';

const { reportSchedules, businesses } = schema;

/** Today's date in India, whatever the server's clock zone is. */
export const todayIST = (now = new Date()) =>
  new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

const totalsText = (totals: Record<string, number>) =>
  Object.entries(totals)
    .map(([k, v]) => `  ${k}: ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
    .join('\n');

/**
 * Sends every schedule of the organization that has not yet sent its last full period. Each runs in a savepoint, so one
 * failing report (or a deleted business) leaves the others, and the failure is kept on the schedule for the owner to see.
 */
export async function runDueForOrg(tx: Tx, orgId: string, env: AppEnv, today = todayIST()) {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const list = await tx
    .select()
    .from(reportSchedules)
    .where(eq(reportSchedules.active, true))
    .orderBy(asc(reportSchedules.createdAt));
  for (const s0 of list) {
    const period = previousPeriod(s0.frequency as 'weekly' | 'monthly', today);
    try {
      await tx.transaction(async (sp) => {
        // Lock the row and look again: a runner that got here first has already recorded the period.
        const [s] = await sp
          .select()
          .from(reportSchedules)
          .where(eq(reportSchedules.id, s0.id))
          .for('update');
        if (!s || !s.active || s.lastPeriod === period.key) {
          out.skipped++;
          return;
        }
        const { def, result } = await runReport(sp as unknown as Tx, orgId, s.reportId, {
          ...(s.params as Record<string, string>),
          businessId: s.businessId,
          from: period.from,
          to: period.to,
        });
        const [biz] = await sp
          .select({ name: businesses.name })
          .from(businesses)
          .where(eq(businesses.id, s.businessId));
        const subject = `${def.title}: ${period.from} to ${period.to}${biz ? ` (${biz.name})` : ''}`;
        const text = [
          `${def.title}${biz ? ` for ${biz.name}` : ''}`,
          `Period: ${period.from} to ${period.to}`,
          `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} (the full report is attached as a CSV file).`,
          result.totals && Object.keys(result.totals).length
            ? `\nTotals\n${totalsText(result.totals)}`
            : '',
          '\nYou are getting this because a schedule was set up in Ledgora. Change or stop it under Reports.',
        ].join('\n');
        const file = `${def.id}-${period.from}-to-${period.to}.csv`;
        for (const to of s.recipients as string[])
          await sendMail(env, {
            to,
            subject,
            text,
            attachments: [
              { filename: file, content: reportCsv(result.rows), contentType: 'text/csv' },
            ],
          });
        await sp
          .update(reportSchedules)
          .set({
            lastPeriod: period.key,
            lastRunAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(reportSchedules.id, s.id));
        await audit(sp as unknown as Tx, orgId, 'report.schedule_sent', 'report_schedule', s.id, {
          after: {
            report: def.id,
            period: period.key,
            recipients: (s.recipients as string[]).length,
            rows: result.rows.length,
          },
        });
        out.sent++;
      });
    } catch (e) {
      out.failed++;
      await tx
        .update(reportSchedules)
        .set({
          lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300),
          updatedAt: new Date(),
        })
        .where(eq(reportSchedules.id, s0.id));
    }
  }
  return out;
}

/** Organizations that have an active schedule. Read-only: the scheduler policy on the table allows listing, nothing more. */
async function orgsWithSchedules(db: Database) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    const rows = await tx
      .selectDistinct({ orgId: reportSchedules.orgId })
      .from(reportSchedules)
      .where(and(eq(reportSchedules.active, true)));
    return rows.map((r) => r.orgId);
  });
}

/** One pass over every organization. Returns what was sent, for logs and tests. */
export async function runScheduler(db: Database, env: AppEnv, now = new Date()) {
  const total = { sent: 0, skipped: 0, failed: 0 };
  for (const orgId of await orgsWithSchedules(db)) {
    const r = await withTenant(db, orgId, (tx) => runDueForOrg(tx, orgId, env, todayIST(now)));
    total.sent += r.sent;
    total.skipped += r.skipped;
    total.failed += r.failed;
  }
  return total;
}

/** Wakes every half hour (and shortly after start) to send what is due; a stopped process picks up on the next start. */
export function startReportScheduler(db: Database, env: AppEnv) {
  if (!env.REPORT_SCHEDULER) return () => {};
  const tick = () =>
    runScheduler(db, env).then(
      (r) =>
        r.sent + r.failed > 0 &&
        console.log(`[reports] scheduled e-mails: ${r.sent} sent, ${r.failed} failed`),
      (e) => console.error('[reports] scheduler', e instanceof Error ? e.message : e),
    );
  const first = setTimeout(tick, 20_000);
  const every = setInterval(tick, 30 * 60_000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
