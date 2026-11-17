import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { LoadingState, ErrorState } from '../../components/ui/States';
import { apiClient } from '../../lib/apiClient';
import { useSession } from '../auth/SessionContext';
import { fmtDate } from '../billing/planFormat';
import './admin.css';

// Platform admin: for the people who run this installation (PLATFORM_ADMIN_EMAILS on the server). Every subscriber with the owner's
// e-mail, plan and state, and how many are on each. Read-only. The server refuses anyone else, so hiding the page is only a courtesy.
const STATE = { trialing: 'Trial', active: 'Active', past_due: 'Payment failed', canceled: 'Cancelled', pending: 'Not chosen yet', none: 'None' };
const money = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const FILTERS = [
  ['all', 'All', () => true],
  ['trial', 'On trial', (r) => r.trial],
  ['paying', 'Paying', (r) => r.status === 'active' && r.plan !== 'free' && !r.trial],
  ['free', 'Free', (r) => r.plan === 'free' && !r.trial && r.status !== 'pending'],
  ['pending', 'Not chosen yet', (r) => r.status === 'pending'],
  ['trouble', 'Payment failed or cancelled', (r) => r.status === 'past_due' || r.status === 'canceled'],
];

function csv(rows) {
  const head = ['Organization', 'Businesses', 'Business names', 'Owner', 'E-mail', 'Phone', 'E-mail confirmed', 'Signed up', 'Plan', 'Status', 'Trial ends', 'Paid until', 'Billing', 'Invoices', 'Paid total'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head, ...rows.map((r) => [r.organization, r.businessCount, r.businesses.map((b) => `${b.name}${b.gstin ? ` (${b.gstin})` : ''}`).join('; '), r.ownerName, r.ownerEmail, r.ownerPhone, r.emailConfirmed ? 'yes' : 'no', r.signedUp.slice(0, 10), r.planLabel, STATE[r.status] || r.status, r.trialEndsAt?.slice(0, 10), r.currentPeriodEnd?.slice(0, 10), r.interval, r.invoices, r.paidTotal])]
    .map((l) => l.map(esc).join(',')).join('\n');
}

export default function AdminPage({ standalone = false }) {
  const { me, signOut } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const load = () => apiClient.get('/v1/platform/overview').then(setData).catch(setError);
  useEffect(() => { if (me?.platformAdmin) load(); }, [me?.platformAdmin]);

  const rows = useMemo(() => {
    const test = FILTERS.find((f) => f[0] === filter)[2];
    const needle = q.trim().toLowerCase();
    return (data?.rows || []).filter((r) => test(r) && (!needle || `${r.organization} ${r.businesses.map((b) => `${b.name} ${b.gstin}`).join(' ')} ${r.ownerEmail} ${r.ownerName} ${r.ownerPhone}`.toLowerCase().includes(needle)));
  }, [data, filter, q]);

  if (!me?.platformAdmin) return <ErrorState message="This page is for the people who run the service." />;
  if (error) return <ErrorState message={error.message} onRetry={() => { setError(null); load(); }} />;
  if (!data) return <LoadingState label="Opening the subscriber list…" />;
  const t = data.totals;
  const cards = [
    ['Businesses registered', t.businesses], ['With a GSTIN', t.businessesWithGstin], ['Accounts (subscribers)', t.accounts], ['On trial', t.onTrial], ['Paying', t.paying], ['Silver', t.silver], ['Gold', t.gold],
    ['Free', t.free], ['Not chosen yet', t.notChosen], ['Payment failed', t.pastDue], ['Cancelled', t.cancelled], ['Collected (with GST)', money(t.revenue)],
  ];
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'subscribers.csv' });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={standalone ? 'adm-standalone' : undefined}>
      {standalone && (
        <header className="adm-bar">
          <b>Ledgora owner console</b>
          <span><span className="ui-help">{me.user.email}</span> <button type="button" className="btn btn-secondary btn-sm" onClick={signOut}>Sign out</button></span>
        </header>
      )}
      <PageHeader icon="🛡" title="Platform admin" subtitle="Every business registered, and every subscriber with plan and e-mail"
        actions={<button type="button" className="btn btn-secondary" onClick={download}><Download size={14} /> Download CSV</button>} />
      <section className="adm-cards" aria-label="Totals">
        {cards.map(([label, value]) => <div key={label} className="adm-card"><span>{label}</span><b>{value}</b></div>)}
      </section>
      <div className="glass-panel p-4">
        <div className="adm-tools">
          <div role="group" aria-label="Show" className="adm-filters">
            {FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} className={`btn btn-sm ${filter === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
          <input className="form-input adm-search" type="search" placeholder="Search e-mail, name, business or GSTIN" aria-label="Search subscribers" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="table-scroll">
          <table className="ui-table adm-table">
            <thead><tr><th>Owner e-mail</th><th>Account</th><th className="num">Businesses</th><th>Plan</th><th>Status</th><th>Signed up</th><th>Trial ends</th><th>Paid until</th><th className="num">Invoices</th><th className="num">Paid</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.organizationId}>
                  <td>
                    {r.ownerEmail ? <a href={`mailto:${r.ownerEmail}`}>{r.ownerEmail}</a> : <span className="ui-help">{r.ownerPhone || 'no e-mail'}</span>}
                    {r.ownerEmail && !r.emailConfirmed && <span className="adm-flag"> unconfirmed</span>}
                    {r.ownerName && <div className="ui-help">{r.ownerName}</div>}
                  </td>
                  <td>{r.organization}</td>
                  <td className="num" title={r.businesses.map((b) => `${b.name}${b.gstin ? ` · ${b.gstin}` : ''}${b.state ? ` · ${b.state}` : ''}`).join('\n')}>{r.businessCount}{r.businesses.length > 0 && <div className="ui-help adm-biz">{r.businesses.map((b) => b.name).join(', ')}</div>}</td>
                  <td><span className={`adm-plan adm-plan-${r.trial ? 'trial' : r.plan}`}>{r.trial ? 'Trial (all)' : r.planLabel}</span>{r.interval && !r.trial && <div className="ui-help">{r.interval === 'year' ? 'Yearly' : 'Monthly'}</div>}</td>
                  <td>{STATE[r.status] || r.status}{r.locked && <div className="ui-help">read-only</div>}</td>
                  <td>{fmtDate(r.signedUp)}</td>
                  <td>{r.trialEndsAt ? fmtDate(r.trialEndsAt) : ''}</td>
                  <td>{r.currentPeriodEnd ? fmtDate(r.currentPeriodEnd) : ''}</td>
                  <td className="num">{r.invoices || ''}</td>
                  <td className="num">{r.paidTotal ? money(r.paidTotal) : ''}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="ui-help">No one matches.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="ui-help">{rows.length} of {data.rows.length} shown. Read-only; to change someone&rsquo;s plan, use the payment provider.</p>
      </div>
    </div>
  );
}
