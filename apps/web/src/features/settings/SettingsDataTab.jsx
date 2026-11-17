import { useState, useEffect, useRef } from 'react';
import { Upload, Download } from 'lucide-react';
import { exportAllData, importData, inspectBackup, getProfile, getTrashedBills, restoreTrashedBill, purgeTrashedBill, saveBill, applyStockChanges } from '../../lib/data';
import { stockDelta } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { ALL_BACKUP_PARTS, autoTickFromInspection, buildRestoreSummary } from './settingsBackupParts';

export default function SettingsDataSection({ onProfileRestored, onTemplatesRestored, onProfilesRestored }) {
  const fileInputRef = useRef(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportSel, setExportSel] = useState(() => Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, true])));
  const [importSel, setImportSel] = useState(() => Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, true])));
  const [importInspection, setImportInspection] = useState(null);
  const [importJsonText, setImportJsonText] = useState('');

  const toggleExport = (id) => setExportSel(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleImport = (id) => setImportSel(prev => ({ ...prev, [id]: !prev[id] }));
  const exportToggleAll = (val) => setExportSel(Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, val])));
  // v1.10.74 - "Select all (with data)" ticks only categories that have data in the file
  const importToggleAll = (val) => setImportSel(Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, val && (importInspection?.counts?.[p.id] || 0) > 0])));

  const runExport = async () => {
    try {
      const json = await exportAllData(exportSel);
      const fileName = `freegstbill-backup-${new Date().toISOString().split('T')[0]}.json`;

      // Local download (always)
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);

      toast('Backup downloaded', 'success');
      setShowExportModal(false);
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + (err.message || 'unknown error'), 'error');
    }
  };

  const handleImportPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const inspection = inspectBackup(text);
      if (!inspection.valid) { toast("This file doesn't look like a Free GST Billing backup.", 'error'); return; }
      setImportInspection(inspection);
      setImportJsonText(text);
      // Auto-tick only the parts that actually have data in the file
      const auto = autoTickFromInspection(inspection);
      setImportSel(auto);
      setShowImportModal(true);
    } catch { toast('Could not read the file', 'error'); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runImport = async () => {
    try {
      const result = await importData(importJsonText, importSel);
      toast(buildRestoreSummary(result, importSel, importInspection), 'success');
      if (importSel.profile) { const p = await getProfile(); onProfileRestored(p); }
      if (importSel.termsTemplates) onTemplatesRestored();
      if (importSel.profiles) onProfilesRestored();
      setShowImportModal(false);
      setImportInspection(null);
      setImportJsonText('');
    } catch (err) {
      console.error(err);
      toast('Import failed: ' + (err.message || 'unknown error'), 'error');
    }
  };

  return (
    <>
      <div id="section-data" data-settings-tab="data" className="glass-panel p-6 mb-6" style={{ order: 10 }}>
        <h3 className="section-title">Data Management</h3>

        {/* Privacy notice — uses the global .notice .notice-info utility so dark/light look identical to every other info card. */}
        <div className="notice notice-info" style={{ marginBottom: '1rem' }}>
          <span className="notice-icon">🔒</span>
          <div>
            <strong>Your data is stored securely on your Ledgora account.</strong> It belongs to your
            organization: only people you invite can see it, and every change is recorded in the audit trail.
            Use <em>Export</em> below to keep your own copy.
          </div>
        </div>

        <p className="page-subtitle mb-6">
          Choose what to export or import — invoices, clients, products, settings, custom units, or just specific parts.
          Backup files are plain JSON you can keep anywhere.
        </p>
        <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => setShowExportModal(true)}><Download size={18} /> Export Backup…</button>
          <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}><Upload size={18} /> Import Backup…</button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportPick} style={{ display: 'none' }} />
        </div>
      </div>

      {/* ----------------------- Export modal ----------------------- */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="modal-content" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
            <h3 className="section-title" style={{ marginTop: 0 }}>Export Backup</h3>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '0.75rem' }}>
              Choose what to include. Everything is on by default — uncheck anything you don't want.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => exportToggleAll(true)} style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem' }}>Select all</button>
              <button type="button" className="btn btn-secondary" onClick={() => exportToggleAll(false)} style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem' }}>Clear all</button>
            </div>
            <div className="cbx-list">
              {ALL_BACKUP_PARTS.map(p => (
                <label key={p.id} className="cbx-row">
                  <input type="checkbox" checked={!!exportSel[p.id]} onChange={() => toggleExport(p.id)} />
                  <span>
                    <span className="cbx-label">{p.label}</span>
                    <span className="cbx-hint">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex gap-2 justify-end mt-4">
              <button type="button" className="btn btn-secondary" onClick={() => setShowExportModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={runExport} disabled={!Object.values(exportSel).some(Boolean)}>
                <Download size={16} /> Download Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------- Import modal ----------------------- */}
      {showImportModal && importInspection && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
            <h3 className="section-title" style={{ marginTop: 0 }}>Restore from Backup</h3>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.75rem' }}>
              File contents preview
              {importInspection.exportedAt && <span> — exported {new Date(importInspection.exportedAt).toLocaleString()}</span>}
              {importInspection.version && <span> · v{importInspection.version}</span>}
            </div>
            <div style={{
              padding: '0.6rem 0.85rem', borderRadius: '6px',
              background: 'var(--warn-bg)', border: '1px solid var(--warn-border)',
              fontSize: '0.78rem', color: 'var(--warn-text)', marginBottom: '0.75rem',
            }}>
              ⚠ Restoring will <strong>overwrite matching records by ID</strong> in the categories you select. Records you didn't tick are untouched. We recommend exporting a fresh backup of your current data first.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => importToggleAll(true)} style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem' }}>Select all (with data)</button>
              <button type="button" className="btn btn-secondary" onClick={() => importToggleAll(false)} style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem' }}>Clear all</button>
            </div>
            <div className="cbx-list">
              {ALL_BACKUP_PARTS.map(p => {
                const count = importInspection.counts[p.id] || 0;
                return (
                  <label key={p.id} className={`cbx-row${count === 0 ? ' is-disabled' : ''}`}>
                    <input type="checkbox" checked={!!importSel[p.id]} disabled={count === 0} onChange={() => toggleImport(p.id)} />
                    <span style={{ flex: 1 }}>
                      <span className="cbx-label">{p.label}</span>
                      <span className="cbx-hint">{p.hint}</span>
                    </span>
                    <span className="cbx-meta" style={count > 0 ? { color: 'var(--success)', fontWeight: 600 } : undefined}>
                      {count > 0 ? `${count} item${count !== 1 ? 's' : ''}` : 'empty'}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={runImport} disabled={!Object.values(importSel).some(Boolean)}>
                <Upload size={16} /> Restore selected
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


// ============================================================
// v1.9.5 — Backup Management + Trash Bin
// ============================================================
export function BackupAndTrashPanel() {
  const [trash, setTrash] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try { setTrash(await getTrashedBills().catch(() => [])); } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const handleRestoreTrash = async (id) => {
    try {
      await restoreTrashedBill(id);
      // Back in the books, so the stock its delete put back is taken out again.
      // Only what that delete recorded (stockReturnedOnDelete): invoices
      // deleted before it was recorded never had their stock put back.
      const { _trashedAt, ...bill } = trash.find((b) => b.id === id) || {};
      const back = bill.data?.stockReturnedOnDelete;
      if (back && Object.keys(back).length) {
        const { stockReturnedOnDelete: _gone, ...data } = bill.data;
        await saveBill({ ...bill, data: { ...data, stockApplied: back } }, { overwrite: true });
        await applyStockChanges(stockDelta({}, back)).catch(() => {});
      }
      toast('Invoice restored', 'success');
      loadAll();
    } catch (err) {
      toast('Restore failed: ' + err.message, 'error');
    }
  };

  const handlePurgeTrash = async (id) => {
    if (!await confirmAction({
      title: 'Permanently delete this invoice?',
      message: 'This bypasses the 30-day Trash grace period. The invoice is gone for good.',
      confirmLabel: 'Delete permanently',
      tone: 'danger',
    })) return;
    try {
      await purgeTrashedBill(id);
      toast('Invoice permanently deleted', 'info');
      loadAll();
    } catch (err) {
      toast('Purge failed: ' + err.message, 'error');
    }
  };

  return (
    <div className="glass-panel p-6 mb-6">
      <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem' }}>🗑 Trash bin</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
        Deleted invoices stay here for 30 days. Your data is backed up continuously on our servers; use Export above to keep your own copy.
      </p>
      <div style={{ padding: '0.85rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Deleted invoices ({trash.length})</h4>
        {loading && trash.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading…</p>}
        {!loading && trash.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No deleted invoices. Anything you delete lands here for 30 days.</p>}
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {trash.map(bill => (
            <div key={bill.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.4rem 0.6rem', marginBottom: '0.25rem',
              background: 'var(--card)', borderRadius: 4, fontSize: '0.82rem',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{bill.invoiceNumber}</strong>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {bill.clientName} · deleted {bill._trashedAt ? new Date(bill._trashedAt).toLocaleDateString('en-IN') : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                  onClick={() => handleRestoreTrash(bill.id)}>Restore</button>
                <button className="btn btn-secondary" style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', color: '#dc2626', borderColor: '#fca5a5' }}
                  onClick={() => handlePurgeTrash(bill.id)}>Delete forever</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
