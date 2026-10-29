import { Lock } from 'lucide-react';

// Shown instead of a screen the plan does not include (changes 3.18, 3.22).
export default function LockedFeature({ name }) {
  return (
    <div className="settings-container" style={{ maxWidth: 520 }}>
      <div className="glass-panel p-6">
        <h1 style={{ marginTop: 0, fontSize: '1.3rem' }}><Lock size={20} style={{ verticalAlign: '-3px' }} /> {name} is an add-on</h1>
        <p>Your plan does not include it right now. It comes back when your plan is active again, or ask the owner of this organization.</p>
      </div>
    </div>
  );
}
