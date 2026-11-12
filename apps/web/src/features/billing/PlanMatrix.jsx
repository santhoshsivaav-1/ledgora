import { Check, Minus } from 'lucide-react';
import { inr } from './planFormat';

// The plans side by side: price, limits, and every feature with a tick or a dash, so it is clear what each plan has and
// what it does not. Used on the plans page after sign-up, on the trial-ended page and in Settings › Plan & billing.

const CORE = ['GST invoices, quotations, challans and credit notes', 'Parties, items, stock and purchases', 'Expenses, GST returns and reports', 'Download your data any time'];

export default function PlanMatrix({ plans, features, interval, currentPlan = null, onChoose = null, busy = '', choosable = true }) {
  const limitRows = [
    ['Businesses', (p) => p.limits.businesses],
    ['Users', (p) => p.limits.users],
    ['Sale documents a month', (p) => (p.limits.docsPerMonth === null ? 'Unlimited' : p.limits.docsPerMonth)],
  ];
  return (
    <div className="plan-matrix-wrap">
      <table className="plan-matrix">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Feature</span></th>
            {plans.map((p) => {
              const price = interval === 'year' ? p.priceYearly : p.priceMonthly;
              return (
                <th key={p.id} scope="col" className={currentPlan === p.id ? 'is-current' : ''}>
                  <div className="pm-name">{p.name}{currentPlan === p.id && <span className="pm-badge">Your plan</span>}</div>
                  <div className="pm-price">{price ? inr(price) : '₹0'}<small>{price ? ` / ${interval === 'year' ? 'year' : 'month'} + GST` : ' forever'}</small></div>
                  <div className="pm-blurb">{p.blurb}</div>
                  {onChoose && p.id !== 'free' && currentPlan !== p.id && (
                    <button type="button" className="btn btn-primary" disabled={!choosable || !!busy} onClick={() => onChoose(p.id)}>
                      {busy === p.id ? 'Opening payment…' : `Choose ${p.name}`}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {limitRows.map(([label, get]) => (
            <tr key={label}><th scope="row">{label}</th>{plans.map((p) => <td key={p.id}>{get(p)}</td>)}</tr>
          ))}
          {CORE.map((label) => (
            <tr key={label}><th scope="row">{label}</th>{plans.map((p) => <td key={p.id}><Check size={16} aria-label="Included" className="pm-yes" /></td>)}</tr>
          ))}
          {features.map((f) => (
            <tr key={f.id}>
              <th scope="row">{f.label}</th>
              {plans.map((p) => (p.features.includes(f.id)
                ? <td key={p.id}><Check size={16} aria-label="Included" className="pm-yes" /></td>
                : <td key={p.id}><Minus size={16} aria-label="Not included" className="pm-no" /></td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
