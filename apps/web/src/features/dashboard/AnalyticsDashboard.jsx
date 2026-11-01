import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronRight, Package, Plus, Settings } from 'lucide-react';
import HelpButton from '../../components/ui/HelpButton';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { getAllBills, getAllProducts, getProfile, getStockAlertSettings } from '../../lib/data';
import { belongsToProfile, formatCurrency } from '../../utils';
import { STATUS_CONFIG } from '../invoices/list/statusConfig';
import { PERIODS, buildAnalytics, currenciesIn, currencyOf, deltaPct } from './analytics';
import { RevenueChart, Sparkline } from './charts';
import { fullMoney } from './money';
import './analytics.css';

const dateText = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const shortText = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

function Delta({ value, goodWhenUp = true }) {
  if (value == null || !Number.isFinite(value)) return <span className="ad-delta ad-delta-flat">No prior period</span>;
  const up = value >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`ad-delta ${Math.abs(value) < 0.05 ? 'ad-delta-flat' : good ? 'ad-delta-good' : 'ad-delta-bad'}`}>
      <Icon size={13} aria-hidden="true" />
      {Math.abs(value).toFixed(1)}%
      <span className="ad-visually-hidden">{up ? ' higher' : ' lower'} than the previous period</span>
    </span>
  );
}

function Panel({ title, note, action, children, className = '' }) {
  return (
    <section className={`ad-panel ${className}`}>
      <header className="ad-panel-head">
        <h2>{title}</h2>
        {note && <span className="ad-panel-note">{note}</span>}
        {action}
      </header>
      {children}
    </section>
  );
}

function Kpi({ label, value, delta, goodWhenUp, spark, hint }) {
  return (
    <div className="ad-kpi">
      <div className="ad-kpi-label">{label}</div>
      <div className="ad-kpi-value">{value}</div>
      <div className="ad-kpi-foot">
        {delta !== undefined ? <Delta value={delta} goodWhenUp={goodWhenUp} /> : <span className="ad-kpi-hint">{hint}</span>}
        {spark && <Sparkline values={spark} />}
      </div>
    </div>
  );
}

function BarList({ rows, currency, total, empty }) {
  if (!rows.length) return <p className="ad-empty">{empty}</p>;
  const max = rows[0].revenue || 1;
  return (
    <ol className="ad-bars">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="ad-bars-line">
            <span className="ad-bars-name" title={r.name}>{r.name}</span>
            <span className="ad-bars-value">{fullMoney(r.revenue, currency)}</span>
          </div>
          <div className="ad-bars-track" aria-hidden="true"><span style={{ width: `${Math.max(2, (r.revenue / max) * 100)}%` }} /></div>
          {total ? <span className="ad-bars-share">{((r.revenue / total) * 100).toFixed(0)}% of sales</span> : <span className="ad-bars-share">{r.qty} sold</span>}
        </li>
      ))}
    </ol>
  );
}

export default function AnalyticsDashboard({ onNew, onEdit, onOpenProducts, onOpenSettings, activeProfile }) {
  const navigate = useNavigate();
  const [allBills, setAllBills] = useState(null);
  const [failed, setFailed] = useState(false);
  const [profileState, setProfileState] = useState(null);
  const [productCount, setProductCount] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [period, setPeriod] = useState(() => {
    try { const p = localStorage.getItem('ledgora_dashPeriod'); return PERIODS.some((x) => x.id === p) ? p : '30d'; } catch { return '30d'; }
  });
  const [pickedCurrency, setPickedCurrency] = useState(null);
  const profile = activeProfile ?? profileState;

  const fetchBills = () => getAllBills().then((b) => setAllBills(Array.isArray(b) ? b : [])).catch(() => setFailed(true));
  const retry = () => { setFailed(false); fetchBills(); };
  useEffect(() => {
    fetchBills();
    getProfile().then(setProfileState).catch(() => {});
    Promise.all([
      getAllProducts().catch(() => []),
      getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
    ]).then(([prods, cfg]) => {
      setProductCount(prods.length);
      const threshold = Number(cfg?.threshold ?? 5);
      setLowStock(cfg?.enabled === false ? [] : prods.filter((p) => (p.stock ?? 0) <= threshold));
    });
  }, []);

  const choosePeriod = (id) => {
    setPeriod(id);
    try { localStorage.setItem('ledgora_dashPeriod', id); } catch { /* private mode */ }
  };

  // Same rule as the Invoices page: a document that cannot be tied to a business is shown, never hidden.
  const bills = useMemo(() => (allBills || []).filter((b) => belongsToProfile(b, profile)), [allBills, profile]);
  const currencies = useMemo(() => currenciesIn(bills), [bills]);
  const currency = currencies.includes(pickedCurrency) ? pickedCurrency : currencies[0];
  const a = useMemo(() => (allBills ? buildAnalytics(bills, { period, currency }) : null), [allBills, bills, period, currency]);

  if (failed) return <div className="ad"><ErrorState title="Could not load your invoices" message="Check your connection and try again." onRetry={retry} /></div>;
  if (!a) return <div className="ad"><LoadingState label="Loading your numbers…" /></div>;

  const money = (n) => formatCurrency(n, currency);
  const hasData = bills.length > 0;
  const setupMissing = [];
  if (profile && !profile.businessName?.trim()) setupMissing.push({ text: 'Add your business name and GSTIN so they print on invoices', cta: 'Open settings', go: onOpenSettings });
  if (productCount === 0) setupMissing.push({ text: 'Add products or services to pick them on invoices', cta: 'Add products', go: onOpenProducts });
  const attention = [
    a.overdueCount > 0 && { key: 'od', tone: 'bad', icon: AlertTriangle, text: `${a.overdueCount} overdue invoice${a.overdueCount === 1 ? '' : 's'} · ${money(a.overdue)} to chase`, cta: 'Review', go: () => navigate('/invoices') },
    lowStock.length > 0 && { key: 'ls', tone: 'warn', icon: Package, text: `${lowStock.length} product${lowStock.length === 1 ? ' is' : 's are'} low on stock`, cta: 'Restock', go: onOpenProducts },
    ...setupMissing.map((s, i) => ({ key: `s${i}`, tone: 'info', icon: Settings, text: s.text, cta: s.cta, go: s.go })),
  ].filter(Boolean);

  const agingMax = a.outstanding || 1;
  const statusTotal = Object.values(a.statusCount).reduce((t, n) => t + n, 0);
  const rangeText = `${shortText(a.range.from)} – ${dateText(a.range.to)}`;

  return (
    <div className="ad">
      <header className="ad-top">
        <div>
          <h1>Overview</h1>
          <p className="ad-sub">{profile?.businessName ? `${profile.businessName} · ` : ''}{rangeText}</p>
        </div>
        <div className="ad-controls">
          <div className="ad-seg" role="group" aria-label="Time period">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} className={period === p.id ? 'is-on' : ''} onClick={() => choosePeriod(p.id)}>{p.label}</button>
            ))}
          </div>
          {currencies.length > 1 && (
            <select className="ad-select" aria-label="Currency" value={currency} onChange={(e) => setPickedCurrency(e.target.value)}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <HelpButton title="Overview — how to read it" doc="dashboard">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Revenue</strong> is the total of your sales invoices in the period, less credit notes. Cancelled documents, quotations, proformas and challans are not counted.</li>
              <li><strong>Collected</strong> is money received in the period, counted on the day the payment was recorded.</li>
              <li><strong>Outstanding</strong> and <strong>Receivables by age</strong> show what is unpaid today, whatever period is selected.</li>
              <li>The faint line on the chart is the equally long period just before, so you can see whether you are ahead or behind.</li>
              <li>The full list of invoices, with filters and bulk actions, is on the Invoices page.</li>
            </ul>
          </HelpButton>
          <button className="btn btn-primary" onClick={() => onNew()}><Plus size={16} /> New invoice</button>
        </div>
      </header>

      {attention.length > 0 && (
        <ul className="ad-attn" aria-label="Needs your attention">
          {attention.map((n) => (
            <li key={n.key} className={`ad-attn-${n.tone}`}>
              <n.icon size={15} aria-hidden="true" />
              <span>{n.text}</span>
              <button type="button" onClick={n.go}>{n.cta}<ChevronRight size={14} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}

      {!hasData ? (
        <section className="ad-panel ad-blank">
          <h2>Your numbers will show up here</h2>
          <p>Create your first invoice and this page fills in with revenue, collections, GST and who owes you what.</p>
          <button className="btn btn-primary" onClick={() => onNew()}><Plus size={16} /> Create an invoice</button>
        </section>
      ) : (
        <>
          <section className="ad-panel ad-hero" aria-label="Revenue">
            <div className="ad-hero-head">
              <div>
                <div className="ad-kpi-label">Revenue</div>
                <div className="ad-hero-value">{money(a.now.revenue)}</div>
              </div>
              <div className="ad-hero-meta">
                <Delta value={a.revenueDelta} />
                {a.before && <span className="ad-hero-prev">vs {money(a.before.revenue)} before</span>}
              </div>
              <div className="ad-legend" aria-hidden="true">
                <span><i className="ad-key ad-key-cur" />This period</span>
                {a.range.compared && <span><i className="ad-key ad-key-prev" />Previous</span>}
              </div>
            </div>
            <RevenueChart series={a.series.revenue} currency={currency} compared={a.range.compared} />
          </section>

          <div className="ad-kpis">
            <Kpi label="Collected" value={money(a.now.collected)} delta={a.before ? deltaPct(a.now.collected, a.before.collected) : null} spark={a.series.collected.map((p) => p.value)} />
            <Kpi label="GST charged" value={money(a.now.tax)} delta={a.before ? deltaPct(a.now.tax, a.before.tax) : null} goodWhenUp spark={a.series.tax.map((p) => p.value)} />
            <Kpi label="Invoices raised" value={a.now.count} delta={a.before ? deltaPct(a.now.count, a.before.count) : null} spark={a.series.count.map((p) => p.value)} />
            <Kpi label="Days to get paid" value={a.avgDaysToPay == null ? '—' : `${a.avgDaysToPay.toFixed(0)} days`} hint={a.avgDaysToPay == null ? 'No paid invoices yet' : 'Average, paid invoices'} />
          </div>

          <div className="ad-grid-2">
            <Panel title="Receivables by age" note="Unpaid today">
              <div className="ad-recv-total">
                <span className="ad-hero-value ad-hero-value-sm">{money(a.outstanding)}</span>
                <span className="ad-kpi-hint">across {a.openCount} invoice{a.openCount === 1 ? '' : 's'}</span>
              </div>
              {a.outstanding > 0 ? (
                <>
                  <div className="ad-stack" role="img" aria-label={a.aging.map((g) => `${g.label}: ${money(g.amount)}`).join(', ')}>
                    {a.aging.map((g) => g.amount > 0 && <span key={g.id} className={`ad-age-${g.id}`} style={{ flexGrow: g.amount / agingMax }} />)}
                  </div>
                  <ul className="ad-age-list">
                    {a.aging.map((g) => (
                      <li key={g.id}>
                        <i className={`ad-dot-key ad-age-${g.id}`} />
                        <span>{g.label}</span>
                        <em>{g.count} invoice{g.count === 1 ? '' : 's'}</em>
                        <b>{money(g.amount)}</b>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="ad-empty">Nothing is owed to you. Every invoice is settled.</p>}
            </Panel>

            <Panel title="How invoices are being paid" note={`${statusTotal} invoice${statusTotal === 1 ? '' : 's'} this period`}>
              <div className="ad-recv-total">
                <span className="ad-hero-value ad-hero-value-sm">{a.collectionRate == null ? '—' : `${a.collectionRate.toFixed(0)}%`}</span>
                <span className="ad-kpi-hint">of revenue collected in the period</span>
              </div>
              {statusTotal > 0 ? (
                <>
                  <div className="ad-stack" role="img" aria-label={Object.entries(a.statusCount).map(([k, n]) => `${STATUS_CONFIG[k].label}: ${n}`).join(', ')}>
                    {Object.entries(a.statusCount).map(([k, n]) => n > 0 && <span key={k} className={`ad-st-${k}`} style={{ flexGrow: n }} />)}
                  </div>
                  <ul className="ad-age-list">
                    {Object.entries(a.statusCount).map(([k, n]) => (
                      <li key={k}><i className={`ad-dot-key ad-st-${k}`} /><span>{STATUS_CONFIG[k].label}</span><b>{n}</b></li>
                    ))}
                  </ul>
                </>
              ) : <p className="ad-empty">No sales invoices were raised in this period.</p>}
            </Panel>
          </div>

          <div className="ad-grid-2">
            <Panel title="Top customers" note="By sales in period">
              <BarList rows={a.topClients} currency={currency} total={a.clientTotal} empty="No customer sales in this period." />
            </Panel>
            <Panel title="Top products" note="By taxable value">
              <BarList rows={a.topProducts} currency={currency} empty="No product sales in this period." />
            </Panel>
          </div>

          <Panel title="Recent activity" action={<button type="button" className="ad-link" onClick={() => navigate('/invoices')}>All invoices<ChevronRight size={14} aria-hidden="true" /></button>} className="ad-recent">
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead>
                  <tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th className="ad-num">Amount</th></tr>
                </thead>
                <tbody>
                  {a.recent.map((b) => {
                    const st = STATUS_CONFIG[b.status] || STATUS_CONFIG.unpaid;
                    return (
                      <tr key={b.id} className={b.data ? 'is-link' : ''} onClick={() => b.data && onEdit(b)}>
                        <td>{b.data
                          ? <button type="button" className="ad-row-btn" onClick={(e) => { e.stopPropagation(); onEdit(b); }}>{b.invoiceNumber}</button>
                          : b.invoiceNumber}</td>
                        <td className="ad-clip">{b.clientName || '—'}</td>
                        <td>{dateText(b.invoiceDate)}</td>
                        <td><span className="ad-pill" style={{ color: st.color, background: st.bg }}><st.icon size={12} aria-hidden="true" />{st.label}</span></td>
                        <td className="ad-num">{formatCurrency(b.totalAmount, currencyOf(b))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
