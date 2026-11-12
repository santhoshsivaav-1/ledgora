import { Link } from 'react-router';
import { useSession } from '../auth/SessionContext';

// A thin bar over the app while on trial (last 7 days), in payment grace, or after the trial has ended.
export default function PlanBanner() {
  const e = useSession().me?.entitlements;
  if (!e) return null;
  let text = '';
  if (e.trial && e.trialDaysLeft <= 7) text = `Your free trial ends in ${e.trialDaysLeft} day${e.trialDaysLeft === 1 ? '' : 's'}.`;
  else if (e.graceDaysLeft > 0) text = `Your last payment failed. ${e.graceDaysLeft} days left to fix it.`;
  else if (e.expired) text = 'Your trial has ended: you are on Free. Your data is safe.';
  if (!text) return null;
  return (
    <div role="status" className="notice notice-info" style={{ display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center', margin: 0, borderRadius: 0 }}>
      <span>{text}</span>
      <Link to="/settings/billing" className="btn btn-primary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.7rem' }}>See plans</Link>
    </div>
  );
}
