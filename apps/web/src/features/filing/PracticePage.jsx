import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { toast } from '../../components/ui/Toast';
import { switchOrganization } from '../../services/session';
import { KIND_LABELS, periodLabel, practiceClients } from '../../lib/data/filing';

// File-ready returns: the CA Dashboard, the CA's live work screen across every client organization where they are the
// CA. For each client: returns waiting for the CA's review, returns the CA prepared that wait for the client's approval,
// returns to file (approved) or fix (sent back), and overdue returns. Opening a client switches the session into that
// organization, so everything after it is the client's own data under the CA's role.

const err = (e) => e?.message || 'Something went wrong';
const dmy = (iso) => (iso ? iso.split('-').reverse().join('-') : '–');
const FILTERS = [
  { id: 'all', label: 'All clients' },
  { id: 'waiting', label: 'Waiting for me' },
  { id: 'toAct', label: 'To file or fix' },
  { id: 'overdue', label: 'Overdue' },
];

function PackLinks({ list, verb, onOpen }) {
  if (!list.length) return null;
  return (
    <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
      {list.map((p) => (
        <li key={p.id}>
          <button type="button" className="btn-link" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', cursor: 'pointer', textAlign: 'left' }} onClick={() => onOpen(p.id)}>
            {verb(p)} {KIND_LABELS[p.kind]} · {periodLabel(p.period, p.quarterly)}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function PracticePage() {
  const [clients, setClients] = useState(null);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState('');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    setError(null);
    practiceClients().then(setClients, setError);
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = async (orgId, to) => {
    setOpening(orgId);
    try {
      await switchOrganization(orgId);
      // A full load, so every screen starts from the client's organization and the CA's role in it.
      window.location.assign(to);
    } catch (e) {
      toast(err(e), 'error');
      setOpening('');
    }
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (clients ?? []).filter((c) => {
      if (filter !== 'all' && !c[filter]) return false;
      if (!term) return true;
      return c.orgName.toLowerCase().includes(term) || c.businesses.some((b) => `${b.name} ${b.gstin ?? ''}`.toLowerCase().includes(term));
    });
  }, [clients, filter, q]);

  const header = (
    <PageHeader
      icon={<Briefcase size={22} />}
      title="CA Dashboard"
      subtitle="Every client where you are the CA: returns to review, to file, and overdue"
    />
  );
  if (error) return <div className="dashboard-container">{header}<ErrorState message={err(error)} onRetry={load} /></div>;
  if (!clients) return <div className="dashboard-container">{header}<LoadingState label="Loading your clients…" /></div>;
  if (!clients.length)
    return (
      <div className="dashboard-container">
        {header}
        <EmptyState
          title="No clients yet"
          hint="A business adds you from Settings › Team with the role “CA (review and approve)”. Accept the e-mail invitation with this account and the business appears here. The CA seat is free for the business on every plan."
        />
      </div>
    );

  const total = (k) => clients.reduce((s, c) => s + (c[k] || 0), 0);
  return (
    <div className="dashboard-container">
      {header}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <StatusChip tone="neutral">{clients.length} client{clients.length === 1 ? '' : 's'}</StatusChip>
        <StatusChip tone={total('waiting') ? 'warn' : 'neutral'}>{total('waiting')} waiting for your review</StatusChip>
        <StatusChip tone="info">{total('withClient')} with clients for approval</StatusChip>
        <StatusChip tone={total('toAct') ? 'success' : 'neutral'}>{total('toAct')} to file or fix</StatusChip>
        <StatusChip tone={total('overdue') ? 'danger' : 'neutral'} outline>{total('overdue')} overdue</StatusChip>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <input className="ui-input" style={{ maxWidth: 280 }} placeholder="Search client, business or GSTIN" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {shown.length === 0 && <p className="ui-help">No client matches.</p>}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {shown.map((c) => (
          <section key={c.orgId} className="glass-panel p-4" aria-label={c.orgName}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <h3 className="section-title" style={{ margin: 0, flex: 1 }}>{c.orgName}</h3>
              <button className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} disabled={!!opening} onClick={() => open(c.orgId, '/filing')}>
                {opening === c.orgId ? 'Opening…' : 'Open'}
              </button>
            </div>
            {c.businesses.map((b) => (
              <div key={b.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                <div style={{ fontWeight: 600 }}>{b.name}</div>
                <div className="ui-help">{b.gstin ? `GSTIN ${b.gstin}` : 'No GSTIN yet'} · {b.counts.filed} filed</div>
                <PackLinks list={b.waiting} verb={() => 'Review'} onOpen={(id) => open(c.orgId, `/filing/${id}`)} />
                <PackLinks list={b.toAct} verb={(p) => (p.status === 'approved' ? 'File' : 'Fix')} onOpen={(id) => open(c.orgId, `/filing/${id}`)} />
                <PackLinks list={b.withClient} verb={() => 'With client:'} onOpen={(id) => open(c.orgId, `/filing/${id}`)} />
                {b.overdue.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ color: 'var(--danger, #dc2626)', cursor: 'pointer' }}>{b.overdue.length} overdue</summary>
                    <ul style={{ paddingLeft: 18, margin: '4px 0' }}>
                      {b.overdue.map((o) => <li key={`${o.form}:${o.due}`}>{o.label} — due {dmy(o.due)}</li>)}
                    </ul>
                  </details>
                )}
                {!b.waiting.length && !b.toAct.length && !b.withClient.length && !b.overdue.length && <div className="ui-help">Nothing pending</div>}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
