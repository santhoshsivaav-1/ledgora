// Vyapar parity P7-S4: the backup scheduler. Wakes every half hour, lists the organizations whose schedule is on
// (read-only, through the scheduler policy on backup_settings), and runs each due backup inside its own tenant under a
// row lock, so two servers never both back up the same slot.
import { and, eq, ne } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { schema, withTenant, type Database, type Tx } from '@ledgora/db';
import type { AppEnv } from '../env.ts';
import { backupDue, backupSlot } from './schedule.ts';
import { takeBackup, type StoreDeps } from './store.ts';

const { backupSettings } = schema;

/** Runs this organization's backup if it is due. Returns whether one was taken. */
export async function runBackupIfDue(tx: Tx, orgId: string, deps: StoreDeps, now = new Date()) {
  const [s] = await tx
    .select()
    .from(backupSettings)
    .where(eq(backupSettings.orgId, orgId))
    .for('update');
  if (!s) return false;
  const f = s.frequency as 'off' | 'daily' | 'weekly';
  if (!backupDue({ frequency: f, hour: s.hour, lastSlot: s.lastSlot, now })) return false;
  try {
    await tx.transaction((sp) =>
      takeBackup(sp as unknown as Tx, orgId, deps, {
        kind: 'auto',
        keyMode: 'server',
        toDrive: true,
        keepLast: s.keepLast,
        note: `Scheduled ${f} backup`,
      }),
    );
    await tx
      .update(backupSettings)
      .set({
        lastSlot: backupSlot(f as 'daily' | 'weekly', now),
        lastRunAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(backupSettings.id, s.id));
    return true;
  } catch (e) {
    // Do not retry every half hour; the slot is marked and the error is shown on the Backup screen.
    await tx
      .update(backupSettings)
      .set({
        lastSlot: backupSlot(f as 'daily' | 'weekly', now),
        lastError: e instanceof Error ? e.message.slice(0, 300) : 'failed',
        updatedAt: now,
      })
      .where(eq(backupSettings.id, s.id));
    return false;
  }
}

async function orgsWithSchedules(db: Database) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    const rows = await tx
      .selectDistinct({ orgId: backupSettings.orgId })
      .from(backupSettings)
      .where(and(ne(backupSettings.frequency, 'off')));
    return rows.map((r) => r.orgId);
  });
}

export async function runBackupScheduler(db: Database, deps: StoreDeps, now = new Date()) {
  let taken = 0;
  for (const orgId of await orgsWithSchedules(db))
    if (await withTenant(db, orgId, (tx) => runBackupIfDue(tx, orgId, deps, now))) taken++;
  return taken;
}

export function startBackupScheduler(
  db: Database,
  deps: StoreDeps,
  env: Pick<AppEnv, 'REPORT_SCHEDULER'>,
) {
  if (!env.REPORT_SCHEDULER) return () => {};
  const tick = () =>
    runBackupScheduler(db, deps).then(
      (n) => n > 0 && console.log(`[backup] ${n} scheduled backup(s) taken`),
      (e) => console.error('[backup] scheduler', e instanceof Error ? e.message : e),
    );
  const first = setTimeout(tick, 20_000);
  const timer = setInterval(tick, 30 * 60_000);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
