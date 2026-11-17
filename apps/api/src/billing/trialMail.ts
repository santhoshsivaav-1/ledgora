// The trial mail sequence: "3 days left", "ends tomorrow" and "has ended", each sent once to the owner. Wakes every hour, lists the
// organizations on a trial (read-only, through the scheduler policy on subscriptions), and records what it sent in the
// subscription's `notices` so a restart or a second server never repeats a mail.
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { schema, withTenant, type Database } from '@ledgora/db';
import type { AppEnv } from '../env.ts';
import { sendMail } from '../mail/index.ts';
import { trialEndedMail, trialEndingMail } from '../mail/templates.ts';
import { trialNotice } from './invoice.ts';

const { subscriptions, member, user } = schema;

async function trialingOrgs(db: Database, now: Date, only?: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.scheduler', 'on', true)`);
    const rows = await tx
      .select({ orgId: subscriptions.orgId })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, 'trialing'),
          // Nothing is due until three days before the end, so most trials are not even opened.
          lte(subscriptions.trialEndsAt, new Date(now.getTime() + 3 * 86_400_000)),
          // An old trial that was never answered is not mailed about, and not looked at again.
          gte(subscriptions.trialEndsAt, new Date(now.getTime() - 3 * 86_400_000)),
          ...(only ? [eq(subscriptions.orgId, only)] : []),
        ),
      );
    return [...new Set(rows.map((r) => r.orgId))];
  });
}

/** Sends whatever trial mail is due. Returns how many were sent. */
export async function runTrialMail(db: Database, env: AppEnv, now = new Date(), only?: string) {
  let sent = 0;
  for (const orgId of await trialingOrgs(db, now, only)) {
    const kind = await withTenant(db, orgId, async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      if (!sub) return null;
      const k = trialNotice(
        { status: sub.status, trialEndsAt: sub.trialEndsAt, notices: sub.notices ?? [] },
        now,
      );
      if (!k) return null;
      // Mark first: a failed mail is lost rather than repeated every hour.
      await tx
        .update(subscriptions)
        .set({ notices: [...(sub.notices ?? []), k] })
        .where(eq(subscriptions.id, sub.id));
      return { k, endsAt: sub.trialEndsAt! };
    });
    if (!kind) continue;
    const [owner] = await db
      .select({ email: user.email, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')))
      .limit(1);
    if (!owner) continue;
    const url = `${env.APP_URL}/settings/billing`;
    const days = Math.max(1, Math.ceil((kind.endsAt.getTime() - now.getTime()) / 86_400_000));
    await sendMail(
      env,
      kind.k === 'trial_ended'
        ? trialEndedMail(owner.email, owner.name, url)
        : trialEndingMail(owner.email, owner.name, kind.k === 'trial_1d' ? 1 : days, url),
    );
    sent++;
  }
  return sent;
}

export function startTrialMailScheduler(db: Database, env: AppEnv) {
  if (!env.REPORT_SCHEDULER) return () => {};
  const tick = () =>
    runTrialMail(db, env).then(
      (n) => n > 0 && console.log(`[billing] ${n} trial mail(s) sent`),
      (e) => console.error('[billing] trial mail', e instanceof Error ? e.message : e),
    );
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, 60 * 60_000);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
