import { useEffect, useState } from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import PlanMatrix from '../billing/PlanMatrix';
import { getBilling, startCheckout, startTrial } from '../../lib/data/billing';
import { TRIAL_DAYS } from '@ledgora/contracts';

// Shown once after sign-up (mode "start") and again at sign-in when the trial or plan has ended (mode "ended"): the plans
// side by side, what each includes and what it does not, and at the bottom the way in. Starting the trial needs no card.
export default function PlansScreen({ mode = 'start', owner, onDone, onSignOut }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [interval, setInterval] = useState('year');
  const [busy, setBusy] = useState('');
  useEffect(() => { getBilling().then(setData).catch(setError); }, []);

  if (error) return <div className="auth-shell"><ErrorState message={error.message} onRetry={() => { setError(null); getBilling().then(setData).catch(setError); }} /></div>;
  if (!data) return <div className="auth-shell"><LoadingState label="Opening plans…" /></div>;

  const ended = mode === 'ended';
  const choose = async (choice) => {
    setBusy(choice);
    try { await startTrial(choice); onDone(); } catch (e) { toast(e?.message || 'Could not continue', 'error'); setBusy(''); }
  };
  const pay = async (plan) => {
    setBusy(plan);
    try { const { checkoutUrl } = await startCheckout(plan, interval); window.location.assign(checkoutUrl); }
    catch (e) { toast(e?.message || 'Could not start the payment', 'error'); setBusy(''); }
  };

  return (
    <div className="plans-shell">
      <header className="plans-head">
        <div className="auth-brand">Ledgora</div>
        <h1>{ended ? 'Your plan has ended' : 'Choose how to start'}</h1>
        <p className="auth-muted">
          {ended
            ? 'Your data is safe and you can still open everything. Pick a plan to use the paid features again, or carry on with Free.'
            : `Try every feature free for ${TRIAL_DAYS} days. No card needed. After that you pick a plan, or stay on Free.`}
        </p>
        <div role="radiogroup" aria-label="Billing period" className="plans-interval">
          {[['month', 'Monthly'], ['year', 'Yearly (about 2 months free)']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={interval === v} className={`btn ${interval === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setInterval(v)}>{l}</button>
          ))}
        </div>
      </header>

      <PlanMatrix plans={data.plans} features={data.features} interval={interval} currentPlan={ended ? null : null}
        onChoose={owner ? pay : null} busy={busy} choosable={data.checkoutAvailable} />
      {owner && !data.checkoutAvailable && <p className="auth-muted" style={{ textAlign: 'center' }}>Online payment is not switched on yet. The trial and Free work now.</p>}

      <footer className="plans-foot">
        {owner ? (
          <>
            {!ended && (
              <button type="button" className="btn btn-primary plans-cta" disabled={!!busy} onClick={() => choose('trial')}>
                <ShieldCheck size={18} /> {busy === 'trial' ? 'Starting…' : `Start ${TRIAL_DAYS}-day free trial`}
              </button>
            )}
            <button type="button" className={ended ? 'btn btn-primary plans-cta' : 'auth-link'} disabled={!!busy} onClick={() => (ended ? onDone() : choose('free'))}>
              {ended ? 'Continue on Free' : 'Skip the trial and use Free'}
            </button>
            {!ended && <p className="auth-muted">Every feature for {TRIAL_DAYS} days, then Free unless you choose a plan. Cancel nothing, there is nothing to cancel.</p>}
          </>
        ) : (
          <>
            <p className="auth-muted">The owner of this business chooses the plan.</p>
            <button type="button" className="btn btn-primary plans-cta" onClick={onDone}>Continue</button>
          </>
        )}
        <button type="button" className="auth-link" onClick={onSignOut}><LogOut size={14} /> Log out</button>
      </footer>
    </div>
  );
}
