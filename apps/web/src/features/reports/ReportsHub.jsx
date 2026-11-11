import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BarChart3, Lock, Star } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { apiClient } from '../../lib/apiClient';
import { listBusinesses, ledgerStatus } from '../../lib/data/accounting';
import { cashbankSettings } from '../../lib/data/cashbank';
import { getPrefs, setFavourite } from '../../lib/data/reports';
import { CLIENT_REPORTS, LINKED_REPORTS } from './definitions';
import { groupReports, pickReports } from './hub';

// Vyapar parity P6-S1 / P6-S8: the Reports hub. Every report the API registers, the Cash & Bank ones and links to the
// screens that already exist (GST returns, Income Tax), by group, with a search, a row of favourites and the last five
// opened. Each opens /reports/:id. The earlier analytics (sales, outstanding, clients, products) stay one click away.

const to = (r) => r.path ?? `/reports/${r.id}`;

export default function ReportsHub() {
  const [data, setData] = useState(null);
  const [prefs, setPrefs] = useState({ favourites: [], recent: [], views: [] });
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      const [list, b] = await Promise.all([apiClient.get('/v1/reports'), listBusinesses()]);
      const businessId = b[0]?.id;
      const [ledger, cashbank] = businessId
        ? await Promise.all([
            ledgerStatus(businessId)
              .then((s) => s.enabled)
              .catch(() => false),
            cashbankSettings(businessId)
              .then((s) => s.enabled)
              .catch(() => false),
          ])
        : [false, false];
      return { reports: [...list.data, ...CLIENT_REPORTS, ...LINKED_REPORTS], ledger, cashbank };
    })().then(setData, setError);
    getPrefs()
      .then(setPrefs)
      .catch(() => {});
  }, []);

  const groups = useMemo(() => (data ? groupReports(data.reports, q) : []), [data, q]);
  if (error)
    return (
      <ErrorState
        message={error?.body?.error?.message || error.message}
        onRetry={() => window.location.reload()}
      />
    );
  if (!data) return <LoadingState label="Loading reports…" />;

  const blocked = (r) =>
    r.allowed === false
      ? 'Hidden for your role'
      : r.ledger && !data.ledger
        ? 'Needs the ledger (Accounting › Ledger setup)'
        : r.needs === 'cashbank' && !data.cashbank
          ? 'Needs Cash & Bank'
          : '';
  const favourites = pickReports(data.reports, prefs.favourites);
  const recent = pickReports(data.reports, prefs.recent);
  const star = async (r) => {
    try {
      setPrefs(await setFavourite(r.id, !prefs.favourites.includes(r.id)));
    } catch (e) {
      toast(e?.body?.error?.message || e.message, 'error');
    }
  };
  const pill = (r) => (
    <Link
      key={r.id}
      to={to(r)}
      className="btn btn-secondary"
      style={{ padding: '0.2rem 0.65rem', fontSize: '0.8rem' }}
    >
      {r.title}
    </Link>
  );

  return (
    <div className="dashboard-container">
      <PageHeader
        icon={<BarChart3 size={22} />}
        title="Reports"
        subtitle="From the ledger and your documents. Every report filters, totals and exports to PDF, Excel and CSV."
      />
      <input
        className="search-input"
        style={{ width: '100%', maxWidth: 420, margin: '0 0 1rem' }}
        placeholder="Search reports…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search reports"
      />
      {!q && (favourites.length > 0 || recent.length > 0) && (
        <div className="glass-panel p-4" style={{ marginBottom: '1rem', display: 'grid', gap: 8 }}>
          {favourites.length > 0 && (
            <div
              aria-label="Favourites"
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Star size={14} fill="currentColor" aria-hidden="true" /> <strong>Favourites</strong>{' '}
              {favourites.map(pill)}
            </div>
          )}
          {recent.length > 0 && (
            <div
              aria-label="Recent"
              style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <strong>Recent</strong> {recent.map(pill)}
            </div>
          )}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '1rem',
        }}
      >
        {groups.map((g) => (
          <section key={g.id} className="glass-panel p-4" aria-label={g.label}>
            <h3 className="section-title" style={{ marginTop: 0 }}>
              {g.label}
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {g.reports.map((r) => {
                const why = blocked(r);
                const starred = prefs.favourites.includes(r.id);
                return (
                  <li key={r.id}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      {why ? (
                        <span style={{ opacity: 0.55, flex: 1 }} title={why}>
                          <Lock size={12} aria-hidden="true" /> {r.title}
                          <br />
                          <span className="field-hint">{why}</span>
                        </span>
                      ) : (
                        <Link to={to(r)} style={{ flex: 1 }}>
                          <strong>{r.title}</strong>
                        </Link>
                      )}
                      {!r.path && !why && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-pressed={starred}
                          aria-label={`${starred ? 'Unstar' : 'Star'} ${r.title}`}
                          onClick={() => star(r)}
                        >
                          <Star size={13} fill={starred ? 'currentColor' : 'none'} />
                        </button>
                      )}
                    </div>
                    {!why && <div className="field-hint">{r.description}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <section className="glass-panel p-4" aria-label="Analytics">
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Analytics
          </h3>
          <Link to="/reports/classic">
            <strong>Sales analytics</strong>
          </Link>
          <div className="field-hint">
            Profit by month, outstanding and ageing, party outstanding, clients and products, from
            your invoices.
          </div>
        </section>
      </div>
      {groups.length === 0 && <p className="field-hint">No report matches “{q}”.</p>}
    </div>
  );
}
