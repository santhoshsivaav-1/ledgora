import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { cancelPlan, getBilling, startCheckout } from '../../lib/data/billing';
import { useEntitlements } from './useEntitlements';

// Settings > Plan & billing: the plan in force, the trial, usage against the limits, and upgrade / cancel (owner only).
// Payment happens on Razorpay's page; the plan changes when Razorpay's webhook confirms it.

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export default function BillingPage() {
  const { role } = useEntitlements();
  const owner = role === 'owner';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [interval, setInterval] = useState('year');
  const [busy, setBusy] = useState('');
  const load = () => getBilling().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  if (error) return <ErrorState message={error.message} onRetry={() => { setError(null); load(); }} />;
  if (!data) return <LoadingState label="Opening your plan…" />;
  const { current, usage, plans, features, checkoutAvailable } = data;

  const upgrade = async (plan) => {
    setBusy(plan);
    try {
      const { checkoutUrl } = await startCheckout(plan, interval);
      window.location.assign(checkoutUrl); // Razorpay's hosted page; the webhook switches the plan once paid
    } catch (e) {
      toast(e?.message || 'Could not start the payment', 'error');
      setBusy('');
    }
  };
  const cancel = async () => {
    if (!(await confirmAction({ title: 'Cancel your plan?', message: 'It stays active until the end of the period you paid for, then the business moves to Free. Your data stays.', confirmLabel: 'Cancel plan', tone: 'danger' }))) return;
    try { await cancelPlan(); toast('Cancelled at the end of the period', 'success'); load(); } catch (e) { toast(e?.message || 'Could not cancel', 'error'); }
  };
  const meter = (label, used, cap) => (
    <div style={{ minWidth: 180 }}>
      <div className="ui-help">{label}</div>
      <strong>{used}{cap === null ? '' : ` / ${cap}`}</strong>{cap === null && <span className="ui-help"> (unlimited)</span>}
    </div>
  );

  return (
    <div>
      <PageHeader icon="💳" title="Plan & billing" subtitle="Your plan, trial and usage" />
      <div className="glass-panel p-6 mb-6">
        <h3 className="section-title" style={{ marginTop: 0 }}>
          {current.trial ? `Free trial: ${current.trialDaysLeft} day${current.trialDaysLeft === 1 ? '' : 's'} left (everything included)` : `You are on ${current.label}`}
        </h3>
        {current.graceDaysLeft > 0 && <p className="ui-error">The last payment failed. {current.graceDaysLeft} days to fix it before the business moves to Free.</p>}
        {current.expired && <p className="ui-help">Your trial or paid period has ended. Your data is safe and readable; paid features need a plan.</p>}
        {current.currentPeriodEnd && !current.trial && <p className="ui-help">Paid until {new Date(current.currentPeriodEnd).toLocaleDateString('en-IN')}{current.status === 'canceled' ? ' (cancelled, will not renew)' : ''}.</p>}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
          {meter('Sale documents this month', usage.docsThisMonth, current.limits.docsPerMonth)}
          {meter('Businesses', usage.businesses, current.limits.businesses)}
          {meter('Users (incl. pending invites)', usage.users, current.limits.users)}
        </div>
        {owner && current.status === 'active' && <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={cancel}>Cancel plan</button>}
      </div>

      <div role="radiogroup" aria-label="Billing period" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['month', 'Monthly'], ['year', 'Yearly (about 2 months free)']].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={interval === v} className={`btn ${interval === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setInterval(v)}>{l}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {plans.map((p) => {
          const isCurrent = !current.trial && current.plan === p.id;
          const price = interval === 'year' ? p.priceYearly : p.priceMonthly;
          return (
            <div key={p.id} className="glass-panel p-6" style={isCurrent ? { outline: '2px solid var(--link)' } : undefined}>
              <h3 style={{ margin: 0 }}>{p.name}</h3>
              <p style={{ fontSize: '1.5rem', margin: '6px 0' }}>{price ? `${inr(price)}` : '₹0'}<span className="ui-help"> {price ? `/ ${interval} + GST` : 'forever'}</span></p>
              <p className="ui-help">{p.blurb}</p>
              <ul style={{ listStyle: 'none', padding: 0, fontSize: '0.85rem' }}>
                <li><Check size={13} /> {p.limits.businesses} business{p.limits.businesses === 1 ? '' : 'es'}, {p.limits.users} user{p.limits.users === 1 ? '' : 's'}</li>
                <li><Check size={13} /> {p.limits.docsPerMonth === null ? 'Unlimited invoices' : `${p.limits.docsPerMonth} sale documents a month`}</li>
                {features.filter((f) => p.features.includes(f.id)).map((f) => <li key={f.id}><Check size={13} /> {f.label}</li>)}
              </ul>
              {p.id !== 'free' && (isCurrent
                ? <span className="ui-help">Current plan</span>
                : owner
                  ? <button type="button" className="btn btn-primary" disabled={!!busy || !checkoutAvailable} onClick={() => upgrade(p.id)}>{busy === p.id ? 'Opening payment…' : `Choose ${p.name}`}</button>
                  : <span className="ui-help">Ask the owner to upgrade</span>)}
            </div>
          );
        })}
      </div>
      {!checkoutAvailable && <p className="ui-help" style={{ marginTop: 12 }}>Online payment is not set up on this server yet. Contact support to upgrade.</p>}
    </div>
  );
}
