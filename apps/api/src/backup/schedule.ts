// Vyapar parity P7-S4: when a scheduled backup is due. Pure, so "once per schedule slot" is tested without a clock.
// Times are India Standard Time, like the report scheduler.

export const toIST = (now: Date) => new Date(now.getTime() + 5.5 * 3_600_000);

/** ISO week of an (already IST-shifted) date: '2026-W46'. */
function weekKey(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

/** The slot a moment belongs to: the day for daily, the week for weekly. A slot is backed up at most once. */
export function backupSlot(frequency: 'daily' | 'weekly', now: Date) {
  const ist = toIST(now);
  return frequency === 'daily' ? ist.toISOString().slice(0, 10) : weekKey(ist);
}

/** Is a backup due: the schedule is on, today's hour has come, and this slot has not been done. */
export function backupDue(o: {
  frequency: 'off' | 'daily' | 'weekly';
  hour: number;
  lastSlot: string | null;
  now: Date;
}) {
  if (o.frequency === 'off') return false;
  if (toIST(o.now).getUTCHours() < o.hour) return false;
  return o.lastSlot !== backupSlot(o.frequency, o.now);
}

/** The red reminder on the Backup screen: the last backup is older than `days`, or there is none. */
export function reminderDue(o: {
  remind: boolean;
  remindDays: number;
  lastBackupAt: string | null;
  now: Date;
}) {
  if (!o.remind) return false;
  if (!o.lastBackupAt) return true;
  return o.now.getTime() - new Date(o.lastBackupAt).getTime() > o.remindDays * 86_400_000;
}
