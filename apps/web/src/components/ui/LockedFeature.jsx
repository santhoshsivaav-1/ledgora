import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import { FEATURES, minPlanFor } from '@ledgora/contracts';
import { useEntitlements } from '../../features/billing/useEntitlements';

// Shown instead of a screen the plan does not include: a card that says which feature, which plan unlocks it, and what
// to do. Reads are never blocked by the server, so this is the only thing that stops a screen the plan lacks.
export default function LockedFeature({ name, feature }) {
  const { role, entitlements } = useEntitlements();
  const label = name || FEATURES.find((f) => f.id === feature)?.label || 'This feature';
  const need = feature ? minPlanFor(feature) : null;
  const owner = role === 'owner';
  const locked = !!entitlements?.locked;
  return (
    <div className="settings-container" style={{ maxWidth: 520 }}>
      <div className="glass-panel p-6" role="region" aria-label={`${label} is locked`} style={{ textAlign: 'center' }}>
        <Lock size={32} aria-hidden="true" style={{ opacity: 0.7 }} />
        <h1 style={{ margin: '0.5rem 0', fontSize: '1.3rem' }}>{label} is locked</h1>
        <p>
          {locked
            ? 'Your account is read-only until a plan is chosen.'
            : need
              ? `Your ${entitlements?.label ?? 'current'} plan does not include this. It is available from the ${need.name} plan (₹${need.priceMonthly} a month).`
              : 'Your plan does not include this right now.'}
        </p>
        {owner ? (
          <Link to="/settings/billing" className="btn btn-primary">See plans</Link>
        ) : (
          <p className="auth-muted">Ask the owner of this organization to upgrade the plan.</p>
        )}
      </div>
    </div>
  );
}
