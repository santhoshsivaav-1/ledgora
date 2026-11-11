import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, ListChecks, Circle } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { setupChecklist, setupDismiss } from '../../lib/data/utilities';
import { errText, useBusiness } from './shared';

// Vyapar parity P7-S5: Setup My Business. Each row ticks itself from what is in the books; the card can be hidden from
// 5 of 8 done, and the top-bar dot clears at 100%.

export function useSetup() {
  const { biz } = useBusiness();
  const [c, setC] = useState(null);
  const load = useCallback(() => { if (biz) setupChecklist(biz.id).then(setC, () => {}); }, [biz]);
  useEffect(() => { load(); }, [load]);
  return { checklist: c, biz, reload: load };
}

/** The red dot in the top bar: until every row is done (or the owner hid the card), linking to the checklist. */
export function SetupDot() {
  const { checklist } = useSetup();
  if (!checklist?.showDot) return null;
  return (
    <Link className="ui-icon-btn" to="/utilities/setup" title={`Setup your business: ${checklist.done} of ${checklist.total} done`} aria-label={`Setup your business, ${checklist.done} of ${checklist.total} done`} style={{ position: 'relative' }}>
      <ListChecks size={18} />
      <span aria-hidden="true" style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }} />
    </Link>
  );
}

export default function SetupPage() {
  const { biz, loading, error } = useBusiness();
  const [c, setC] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const load = useCallback(() => (biz ? setupChecklist(biz.id).then(setC, setLoadError) : null), [biz]);
  useEffect(() => { load(); }, [load]);
  const dismiss = async (dismissed) => {
    try { await setupDismiss(biz.id, dismissed); await load(); } catch (e) { toast(errText(e), 'error'); }
  };
  if (error || loadError) return <ErrorState message={errText(error || loadError)} onRetry={() => window.location.reload()} />;
  if (loading || !c) return <LoadingState label="Checking your setup…" />;
  return (
    <div className="dashboard-container">
      <PageHeader icon={<ListChecks size={22} />} title="Setup your business" subtitle={`${c.done} of ${c.total} done`} />
      <div className="glass-panel p-4" style={{ maxWidth: 640 }}>
        <div role="progressbar" aria-valuenow={c.percent} aria-valuemin={0} aria-valuemax={100} style={{ height: 8, borderRadius: 4, background: 'var(--bg-tertiary)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${c.percent}%`, height: '100%', background: 'var(--primary)' }} />
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {c.rows.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
              {r.done ? <Check size={18} color="var(--primary)" aria-label="Done" /> : <Circle size={18} aria-label="Not done" />}
              <span style={{ flex: 1, textDecoration: r.done ? 'line-through' : 'none', opacity: r.done ? 0.7 : 1 }}>{r.label}</span>
              <Link className="btn btn-secondary" style={{ padding: '0.15rem 0.7rem', fontSize: '0.8rem' }} to={r.to}>{r.action}</Link>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          {c.dismissed ? <button className="btn btn-secondary" onClick={() => dismiss(false)}>Show the setup card again</button>
            : c.canDismiss && c.percent < 100 && <button className="btn btn-secondary" onClick={() => dismiss(true)}>Hide the setup card</button>}
          {c.percent === 100 && <p style={{ margin: 0 }}>Everything is set up. ✨</p>}
        </div>
      </div>
    </div>
  );
}
