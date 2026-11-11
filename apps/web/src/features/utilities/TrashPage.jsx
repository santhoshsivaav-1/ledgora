import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { confirmAction, promptAction } from '../../components/ui/ConfirmModal';
import { toast } from '../../components/ui/Toast';
import { trashEmpty, trashList, trashRestore, trashRestoreMany } from '../../lib/data/utilities';
import { errText, fmtDate } from './shared';

// Vyapar parity P7-S6: the Trash. Filter by type, restore one or many (a restored purchase or expense is posted to the
// ledger again, and refused inside a locked period unless the owner gives a reason), and the owner can empty what has
// been here more than 30 days. Tax invoices are cancelled, never trashed, so they are not here.

const TYPES = [['', 'Everything'], ['purchase', 'Purchases'], ['expense', 'Expenses'], ['party', 'Parties'], ['item', 'Items'], ['recurring', 'Recurring'], ['template', 'Templates'], ['invoice', 'Quotations & orders']];

export default function TrashPage() {
  const [type, setType] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const load = useCallback(() => trashList(type || undefined).then((r) => { setRows(r); setPicked(new Set()); }, setError), [type]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const restoreMany = async () => {
    try {
      const r = await trashRestoreMany([...picked]);
      toast(`${r.restored} restored${r.failed.length ? `, ${r.failed.length} could not be: ${r.failed[0].message}` : ''}`, r.failed.length ? 'warning' : 'success', 6000);
      load();
    } catch (e) { toast(errText(e), 'error'); }
  };
  const restoreOne = async (row) => {
    try { await trashRestore(row.id); toast(`${row.label} restored`, 'success'); load(); }
    catch (e) {
      if (!/lock|closed|period/i.test(e.message)) return toast(errText(e), 'error');
      const reason = await promptAction({ title: 'This period is locked', message: `${e.message} The owner can restore it with a reason.`, placeholder: 'Reason' });
      if (!reason) return;
      try { await trashRestore(row.id, reason); toast(`${row.label} restored`, 'success'); load(); } catch (e2) { toast(errText(e2), 'error'); }
    }
  };
  const empty = async () => {
    if (!(await confirmAction({ title: 'Empty the trash?', message: 'Everything that has been in the trash for more than 30 days is deleted for good. Owner only.', confirmLabel: 'Empty', tone: 'danger' }))) return;
    try { const r = await trashEmpty(); toast(`${r.purged} removed for good`, 'success'); load(); } catch (e) { toast(errText(e), 'error'); }
  };

  if (error) return <ErrorState message={errText(error)} onRetry={load} />;
  if (!rows) return <LoadingState label="Opening the trash…" />;
  return (
    <div className="dashboard-container">
      <PageHeader icon={<Trash2 size={22} />} title="Trash" subtitle="Deleted records stay here for 30 days." />
      <div className="glass-panel p-4">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label className="form-label" style={{ margin: 0 }}>Type <select className="form-input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <button className="btn btn-secondary" disabled={!picked.size} onClick={restoreMany}>Restore selected ({picked.size})</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={empty}>Empty trash older than 30 days</button>
        </div>
        <table className="data-table"><thead><tr><th><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && picked.size === rows.length} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th><th>What</th><th>Type</th><th>Deleted</th><th>Removed for good</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td><input type="checkbox" aria-label={`Select ${r.label}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td><td>{r.label}</td><td>{r.entityType}</td><td>{fmtDate(r.deletedAt)}</td><td>{r.purgeAt.slice(0, 10)}</td>
                <td><button className="btn btn-secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => restoreOne(r)}>Restore</button></td></tr>
            ))}
            {!rows.length && <tr><td colSpan="6" className="field-hint">The trash is empty.</td></tr>}
          </tbody></table>
      </div>
    </div>
  );
}
