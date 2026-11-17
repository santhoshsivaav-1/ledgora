import { useEffect, useState } from 'react';
import PageHeader from '../../components/ui/PageHeader';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { cancelPlan, getBilling, getInvoices, startCheckout } from '../../lib/data/billing';
import SubscriptionInvoice from './SubscriptionInvoice';
import { useEntitlements } from './useEntitlements';
import PlanMatrix from './PlanMatrix';
import { planSummary, fmtDate } from './planFormat';

// Settings > Plan & billing: the plan in force, the trial, usage against the limits, and upgrade / cancel (owner only).
// Payment happens on Razorpay's page; the plan changes when Razorpay's webhook confirms it.

export default function BillingPage() {
  const { role } = useEntitlements();
  const owner = role === 'owner';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [interval, setInterval] = useState('year');
  const [busy, setBusy] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [open, setOpen] = useState(null);
  const load = () => getBilling().then(setData).catch(setError);
  useEffect(() => { load(); }, []);
  useEffect(() => { if (owner) getInvoices().then(setInvoices).catch(() => setInvoices([])); }, [owner]);

  if (error) return <ErrorState message={error.message} onRetry={() => { setError(null); load(); }} />;
  if (!data) return <LoadingState label="Opening your plan…" />;
  if (open) return <SubscriptionInvoice id={open} onBack={() => setOpen(null)} />;
  const { current, usage, plans, features, checkoutAvailable } = data;
  const summary = planSummary({ ...current, features: [...(current.features || [])] });

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
        <dl className="plan-details">
          <dt>Plan</dt><dd>{current.label}</dd>
          {(current.startedAt) && <><dt>Activated on</dt><dd>{fmtDate(current.startedAt)}</dd></>}
          {summary?.endsOn && <><dt>{summary.endLabel}</dt><dd>{summary.endsOn}{summary.daysLeft != null ? ` (${summary.daysLeft} day${summary.daysLeft === 1 ? '' : 's'} left)` : ''}</dd></>}
          {current.interval && <><dt>Billing</dt><dd>{current.interval === 'year' ? 'Yearly' : 'Monthly'}</dd></>}
        </dl>
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
      <PlanMatrix plans={plans} features={features} interval={interval} currentPlan={current.trial ? null : current.plan}
        onChoose={owner ? upgrade : null} busy={busy} choosable={checkoutAvailable} />
      {!owner && <p className="ui-help" style={{ marginTop: 12 }}>Ask the owner to change the plan.</p>}
      {current.status === 'active' && owner && <p className="ui-help" style={{ marginTop: 12 }}>Changing plan: pay for the new one first; the old one then stops at the end of its period, so you are never charged twice for the same days.</p>}
      {owner && invoices.length > 0 && (
        <section className="glass-panel p-6" style={{ marginTop: 24 }} aria-labelledby="inv-h">
          <h3 className="section-title" id="inv-h" style={{ marginTop: 0 }}>Your invoices</h3>
          <div className="table-scroll">
            <table className="ui-table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Plan</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{i.number}</td><td>{fmtDate(i.issuedAt)}</td>
                    <td>{i.plan[0].toUpperCase() + i.plan.slice(1)}, {i.interval === 'year' ? 'yearly' : 'monthly'}</td>
                    <td className="num">₹{i.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td><button type="button" className="btn btn-ghost" onClick={() => setOpen(i.id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!checkoutAvailable && <p className="ui-help" style={{ marginTop: 12 }}>Online payment is not set up on this server yet. Contact support to upgrade.</p>}
    </div>
  );
}
