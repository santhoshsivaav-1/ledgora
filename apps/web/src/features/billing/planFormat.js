// How a plan's dates and state read on screen. Pure, so it is tested without a browser.

const DAY = 86_400_000;
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/**
 * The plan card shown from the header: which plan, why, when it began and when it ends or renews, and what to offer.
 * `e` is `me.entitlements`.
 */
export function planSummary(e, now = new Date()) {
  if (!e) return null;
  const left = (iso) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY)) : null);
  const base = { plan: e.plan, label: e.label, activatedOn: fmtDate(e.startedAt), tone: 'free' };
  if (e.needsPlan) return { ...base, title: 'No plan chosen yet', chip: 'Choose plan', tone: 'warn', endLabel: '', endsOn: '', action: 'choose', note: 'Start the free trial or continue on Free.' };
  if (e.trial) {
    const d = e.trialDaysLeft ?? left(e.trialEndsAt);
    return { ...base, title: 'Free trial (every feature)', chip: `Trial · ${d} day${d === 1 ? '' : 's'} left`, tone: d <= 2 ? 'warn' : 'trial', endLabel: 'Trial ends on', endsOn: fmtDate(e.trialEndsAt), daysLeft: d, action: 'upgrade', note: 'After the trial the business moves to Free unless you choose a plan.' };
  }
  if (e.graceDaysLeft > 0) return { ...base, title: `${e.label} plan (payment failed)`, chip: `${e.label} · fix payment`, tone: 'warn', endLabel: 'Access until', endsOn: fmtDate(new Date(new Date(e.currentPeriodEnd).getTime() + 7 * DAY).toISOString()), daysLeft: e.graceDaysLeft, action: 'upgrade', note: `${e.graceDaysLeft} days left to fix the payment.` };
  if (e.expired) return { ...base, title: 'Plan ended: you are on Free', chip: 'Free · plan ended', tone: 'warn', endLabel: 'Ended on', endsOn: fmtDate(e.currentPeriodEnd || e.trialEndsAt), action: 'upgrade', note: 'Your data is safe and readable. Paid features need a plan.' };
  if (e.plan === 'free') return { ...base, title: 'Free plan', chip: 'Free', tone: 'free', endLabel: '', endsOn: '', action: 'upgrade', note: 'No end date.' };
  const canceled = e.status === 'canceled';
  return {
    ...base, title: `${e.label} plan`, chip: e.label, tone: 'paid', endLabel: canceled ? 'Ends on' : 'Renews on', endsOn: fmtDate(e.currentPeriodEnd),
    daysLeft: left(e.currentPeriodEnd), action: e.plan === 'gold' ? 'manage' : 'upgrade',
    note: canceled ? 'Cancelled: it will not renew.' : e.interval ? `Billed ${e.interval === 'year' ? 'yearly' : 'monthly'}.` : '',
  };
}
