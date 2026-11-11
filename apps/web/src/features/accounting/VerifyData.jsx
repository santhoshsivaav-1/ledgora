import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, RefreshCw } from 'lucide-react';
import { fixCheck, runVerify } from '../../lib/data/accounting';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import Can from '../../components/ui/Can';
import { LoadingState, ErrorState } from '../../components/ui/States';

// Vyapar parity P4-S5: Verify My Data. Runs every check on the server and lists what is wrong; a fixable check has a
// "Fix automatically" button (rebuilds the ledger of the documents, or trims over-allocated payments).

const ICON = { error: XCircle, warn: AlertTriangle, info: Info };
const COLOR = { error: '#dc2626', warn: '#d97706', info: '#2563eb' };
const cell = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));

export default function VerifyData({ businessId }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const run = async () => {
    setBusy(true);
    try {
      setResult(await runVerify(businessId));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [businessId]);

  const fix = async (c) => {
    if (!(await confirmAction({ title: `Fix: ${c.title}`, message: c.fix === 'repost' ? 'The ledger of the documents is rebuilt. The old postings are reversed, nothing is deleted.' : c.fix === 'reclose' ? 'The year-end closing entry is posted again from the books as they are now (the old one is reversed). The year stays closed.' : 'Allocations that exceed what a payment is, or what an invoice owes, are trimmed.', confirmLabel: 'Fix automatically' }))) return;
    try {
      const r = await fixCheck(c.id, businessId);
      toast(r.fixed ? `Fixed ${r.fixed}` : 'Nothing needed fixing', 'success');
      run();
    } catch (e) {
      toast(e.message || 'Could not fix', 'error');
    }
  };

  if (error) return <ErrorState message={error.message} onRetry={run} />;
  if (!result) return <LoadingState label="Checking your data…" />;
  const { passed, warnings, errors } = result.summary;
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span className="field-hint">Last run {new Date(result.ranAt).toLocaleString('en-IN')}</span>
        <span style={{ color: '#059669', fontWeight: 600 }}>✔ {passed} passed</span>
        <span style={{ color: '#d97706', fontWeight: 600 }}>⚠ {warnings} warnings</span>
        <span style={{ color: '#dc2626', fontWeight: 600 }}>✖ {errors} errors</span>
        <button className="btn btn-secondary" style={{ marginLeft: 'auto' }} onClick={run} disabled={busy}><RefreshCw size={14} /> {busy ? 'Running…' : 'Run again'}</button>
      </div>
      <div className="glass-panel">
        {result.checks.map((c) => {
          const Icon = c.count === 0 ? CheckCircle2 : ICON[c.severity];
          const color = c.count === 0 ? '#059669' : COLOR[c.severity];
          return (
            <div key={c.id} style={{ borderBottom: '1px solid var(--border)', padding: '0.7rem 1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon size={18} color={color} aria-hidden="true" />
                <span style={{ flex: 1, color: c.count ? undefined : 'var(--text-muted)' }}>{c.title}{c.count ? ` (${c.count})` : ''}</span>
                {c.count > 0 && <button className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide' : 'View'}</button>}
                {c.count > 0 && c.fix && <Can do="accounting:manage"><button className="btn btn-primary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} onClick={() => fix(c)}>Fix automatically</button></Can>}
              </div>
              {open === c.id && (
                <div className="table-scroll" style={{ marginTop: '0.5rem' }}>
                  <table className="data-table" style={{ minWidth: 0 }}>
                    <thead><tr>{Object.keys(c.rows[0] || {}).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                    <tbody>{c.rows.slice(0, 50).map((r, i) => <tr key={i}>{Object.keys(c.rows[0]).map((k) => <td key={k}>{cell(r[k])}</td>)}</tr>)}</tbody>
                  </table>
                  {c.rows.length > 50 && <p className="field-hint">First 50 of {c.rows.length}.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
