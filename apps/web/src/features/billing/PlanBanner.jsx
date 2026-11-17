import { Link } from 'react-router';
import { GRACE_DAYS } from '@ledgora/contracts';
import { useSession } from '../auth/SessionContext';

const plural = (n) => `${n} day${n === 1 ? '' : 's'}`;

// A bar over the app: the trial's last days, the grace days after a plan ends or a payment fails, and the lock itself.
export default function PlanBanner() {
  const { me } = useSession();
  const e = me?.entitlements;
  if (!e) return null;
  const owner = me?.role === 'owner';
  let text = '';
  let tone = 'notice-info';
  if (e.locked) {
    tone = 'notice-danger';
    text = e.lockReason === 'trial_ended'
      ? 'Your free trial has ended. The account is read-only: you can view and export everything, but not add or change anything.'
      : 'Your plan has ended. The account is read-only: you can view and export everything, but not add or change anything.';
    if (!owner) text += ' Ask the owner to choose a plan.';
  } else if (e.trial && e.trialDaysLeft <= 7) text = `Your free trial ends in ${plural(e.trialDaysLeft)}. After that the account becomes read-only until you choose a plan.`;
  else if (e.graceDaysLeft > 0) {
    tone = 'notice-warn';
    text = e.graceReason === 'payment_failed'
      ? `Your last payment failed. ${plural(e.graceDaysLeft)} left (of ${GRACE_DAYS}) to fix it before the account becomes read-only.`
      : `Your plan has ended. ${plural(e.graceDaysLeft)} left (of ${GRACE_DAYS}) to renew before the account becomes read-only.`;
  } else if (e.expired && !e.needsPlan) text = 'You are on the Free plan. Paid features are locked. Your data is safe.';
  if (!text) return null;
  return (
    <div role={e.locked ? 'alert' : 'status'} className={`notice ${tone}`} style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 1rem', borderRadius: 10 }}>
      <span>{text}</span>
      {owner && <Link to="/settings/billing" className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.7rem' }}>{e.locked ? 'Choose a plan' : 'See plans'}</Link>}
    </div>
  );
}
