import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { editLog, editLogCsvUrl } from '../../lib/data/filing';

// R1.5 Companies Act edit log: every insert, change and delete of the books, written by the database and never
// changeable. This screen only reads it; the CSV is what the company's auditor asks for (Rule 11(g)).

const err = (e) => e?.message || 'Something went wrong';
const when = (iso) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });
const TONE = { INSERT: 'success', UPDATE: 'info', DELETE: 'danger' };
const LABEL = { INSERT: 'Created', UPDATE: 'Changed', DELETE: 'Deleted' };
const show = (v) => (v === null || v === undefined ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Changes({ row }) {
  if (row.action !== 'UPDATE') {
    const values = row.after ?? row.before ?? {};
    return (
      <details>
        <summary style={{ cursor: 'pointer' }}>All values</summary>
        <pre style={{ fontSize: '0.72rem', maxHeight: 220, overflow: 'auto', margin: '4px 0' }}>{JSON.stringify(values, null, 2)}</pre>
      </details>
    );
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {row.changed.map((k) => (
        <li key={k} style={{ fontSize: '0.8rem', wordBreak: 'break-word' }}>
          <code>{k}</code>: <s style={{ color: 'var(--text-muted)' }}>{show(row.before?.[k]).slice(0, 120)}</s> → {show(row.after?.[k]).slice(0, 120)}
        </li>
      ))}
    </ul>
  );
}

export default function EditLogPage() {
  const [filter, setFilter] = useState({ table: '', action: '', from: '', to: '' });
  const [rows, setRows] = useState(null);
  const [tables, setTables] = useState({});
  const [next, setNext] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((before = null) => {
    setError(null);
    setBusy(true);
    editLog({ ...filter, before, limit: 100 })
      .then((r) => {
        setTables(r.tables || {});
        setRows((cur) => (before ? [...(cur || []), ...r.data] : r.data));
        setNext(r.nextBefore);
      }, setError)
      .finally(() => setBusy(false));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="dashboard-container">
      <PageHeader
        icon={<History size={22} />}
        title="Edit Log"
        subtitle="Every change to your books with who made it and when. It is kept by the database and can not be edited, deleted or switched off (Companies Act audit trail)."
        actions={<a className="btn btn-secondary" href={editLogCsvUrl(filter)}>Export CSV for the auditor</a>}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Record" value={filter.table} onChange={set('table')}>
          <option value="">All records</option>
          {Object.entries(tables).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Action" value={filter.action} onChange={set('action')}>
          <option value="">All actions</option>
          <option value="INSERT">Created</option>
          <option value="UPDATE">Changed</option>
          <option value="DELETE">Deleted</option>
        </select>
        <label className="ui-help" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>From <input className="ui-input" type="date" value={filter.from} onChange={set('from')} /></label>
        <label className="ui-help" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>To <input className="ui-input" type="date" value={filter.to} onChange={set('to')} /></label>
      </div>
      {error ? <ErrorState message={err(error)} onRetry={() => load()} />
        : !rows ? <LoadingState label="Loading the edit log…" />
        : rows.length === 0 ? <EmptyState title="Nothing in this range" hint="Change the filters, or the dates." />
        : (
          <>
            <div className="ui-table-wrap" style={{ overflowX: 'auto' }}>
              <table className="ui-table" style={{ width: '100%', minWidth: 720 }}>
                <thead><tr><th>When</th><th>Record</th><th>What</th><th>By</th><th>Details</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                      <td>{r.what}<div className="ui-help"><code>{r.rowId.slice(0, 8)}</code></div></td>
                      <td><StatusChip tone={TONE[r.action]}>{LABEL[r.action]}</StatusChip></td>
                      <td>{r.actorName || r.actorId || 'System'}{r.ip ? <div className="ui-help">{r.ip}</div> : null}</td>
                      <td><Changes row={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {next && <button className="btn btn-secondary" style={{ marginTop: 12 }} disabled={busy} onClick={() => load(next)}>{busy ? 'Loading…' : 'Load older'}</button>}
          </>
        )}
    </div>
  );
}
