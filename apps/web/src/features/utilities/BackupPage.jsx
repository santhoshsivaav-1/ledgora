import { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { toast } from '../../components/ui/Toast';
import { backupDelete, backupList, backupNow, backupSaveSettings, downloadBackup, driveConnectUrl, driveDisconnect, fileToBase64, restoreBackup } from '../../lib/data/utilities';
import { Dialog, errText, fmtDate, fmtSize } from './shared';

// Vyapar parity P7-S4: Backup, restore and the schedule. A backup is a snapshot file of the whole account (every
// business), optionally encrypted with a password you keep: lose the password and nobody can open it. Restore asks for
// the file, shows what is inside, needs the word RESTORE, and takes a safety copy first. It adds the backup's businesses
// to an account that has no data yet; it never deletes. Backups can also be saved to your Google Drive (only files
// Ledgora makes, in a "Ledgora Backups" folder). Scheduled backups are encrypted with a key only this server holds, so
// they open from the history here; a copy downloaded from it can not be opened elsewhere.

const KIND = { manual: 'Manual', auto: 'Scheduled', safety: 'Before a restore' };
const LOCK = { none: 'No', password: 'Your password', server: 'Server key' };
const CHOICES = [['off', 'Off'], ['daily', 'Daily'], ['weekly', 'Weekly']];

export default function BackupPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [toDrive, setToDrive] = useState(true);
  const [restore, setRestore] = useState(null); // { file?, backupId?, name, password, preview, confirm }
  const load = useCallback(() => backupList().then(setData, setError), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Google sends the browser back with ?drive=connected (or denied, error)
    const r = new URLSearchParams(window.location.search).get('drive');
    if (!r) return;
    toast(r === 'connected' ? 'Google Drive connected' : r === 'denied' ? 'Google Drive was not connected' : 'Could not connect Google Drive', r === 'connected' ? 'success' : 'warning');
    window.history.replaceState({}, '', window.location.pathname);
    load();
  }, [load]);
  const connect = async () => {
    try { window.location.href = await driveConnectUrl(); } catch (e) { toast(errText(e), 'error'); }
  };
  const disconnect = async () => {
    if (!(await confirmAction({ title: 'Disconnect Google Drive?', message: 'Ledgora stops saving backups there. Copies already on your Drive stay.', confirmLabel: 'Disconnect' }))) return;
    try { await driveDisconnect(); await load(); } catch (e) { toast(errText(e), 'error'); }
  };

  const now = async () => {
    if (encrypt && password.length < 8) return toast('Use a password of at least 8 characters', 'warning');
    setBusy(true);
    try {
      const r = await backupNow({ ...(encrypt ? { password } : {}), toDrive });
      toast(r.driveError ? `Backup taken. Google Drive: ${r.driveError}` : r.onDrive ? 'Backup taken and saved to Google Drive' : 'Backup taken', r.driveError ? 'warning' : 'success', 6000);
      setPassword('');
      await load();
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const saveSettings = async (patch) => {
    const next = { ...data.settings, ...patch };
    setData({ ...data, settings: next });
    try { await backupSaveSettings(next); toast('Schedule saved', 'success'); await load(); } catch (e) { toast(errText(e), 'error'); load(); }
  };
  const remove = async (b) => {
    if (!(await confirmAction({ title: 'Delete this backup?', message: `${b.fileName} is removed from the history and from storage.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await backupDelete(b.id); await load(); } catch (e) { toast(errText(e), 'error'); }
  };
  const choose = async (file) => {
    if (!file) return;
    try { setRestore({ file: await fileToBase64(file), name: file.name, password: '', preview: null, confirm: '' }); } catch (e) { toast(errText(e), 'error'); }
  };
  const look = async (r) => {
    try {
      const preview = await restoreBackup({ ...(r.file ? { file: r.file } : { backupId: r.backupId }), ...(r.password ? { password: r.password } : {}) });
      setRestore({ ...r, preview, needsPassword: false, problem: '' });
    } catch (e) {
      setRestore({ ...r, preview: null, needsPassword: e.details?.reason === 'needs_password', problem: errText(e) });
    }
  };
  useEffect(() => { if (restore && !restore.preview && !restore.problem && !restore.looking) look({ ...restore, looking: true }); }, [restore?.file, restore?.backupId]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    setBusy(true);
    try {
      const r = await restoreBackup({ ...(restore.file ? { file: restore.file } : { backupId: restore.backupId }), ...(restore.password ? { password: restore.password } : {}), confirm: 'RESTORE' });
      setRestore({ ...restore, done: r });
      await load();
    } catch (e) { setRestore({ ...restore, problem: errText(e) }); } finally { setBusy(false); }
  };

  if (error) return <ErrorState message={errText(error)} onRetry={() => window.location.reload()} />;
  if (!data) return <LoadingState label="Opening Backup…" />;
  const s = data.settings;
  const counts = restore?.preview?.counts ?? {};

  return (
    <div className="dashboard-container">
      <PageHeader icon={<DatabaseBackup size={22} />} title="Backup & Restore" subtitle="A copy of your books you can keep, and bring back." />
      {data.reminderDue && <div className="notice notice-warn" role="alert" style={{ marginBottom: 12 }}>{data.lastBackupAt ? `Your last backup was on ${fmtDate(data.lastBackupAt)}.` : 'You have not backed up yet.'} Back up now.</div>}
      <div className="glass-panel p-4" style={{ display: 'grid', gap: 10 }}>
        <p style={{ margin: 0 }}>Last backup: <strong>{data.lastBackupAt ? fmtDate(data.lastBackupAt) : 'none'}</strong></p>
        <label><input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} /> Encrypt with a password</label>
        {encrypt && <div><input className="form-input" type="password" style={{ maxWidth: 280 }} aria-label="Backup password" placeholder="Password (8 or more characters)" value={password} onChange={(e) => setPassword(e.target.value)} /><div className="field-hint">Keep this password safe. It can not be recovered.</div></div>}
        {data.drive.connected && <label><input type="checkbox" checked={toDrive} onChange={(e) => setToDrive(e.target.checked)} /> Also save to Google Drive ({data.drive.email || 'connected'})</label>}
        <div><button className="btn btn-primary" disabled={busy} onClick={now}>{busy ? 'Backing up…' : 'Back up now'}</button></div>
      </div>

      <div className="glass-panel p-4 mt-4" aria-label="Google Drive">
        <h3 className="section-title" style={{ marginTop: 0 }}>Google Drive</h3>
        {!data.drive.available ? <p className="field-hint" style={{ margin: 0 }}>Not set up on this server. The server needs a Google client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) with the Drive API enabled.</p>
          : data.drive.connected ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>Connected{data.drive.email ? ` as ${data.drive.email}` : ''}. Backups are saved in a “Ledgora Backups” folder.</span>
              <button className="btn btn-secondary" onClick={disconnect}>Disconnect</button>
              {data.drive.lastError && <span role="alert" style={{ color: 'var(--danger, #dc2626)' }}>Last upload failed: {data.drive.lastError}</span>}
            </div>
          ) : (
            <div><button className="btn btn-secondary" onClick={connect}>Connect Google Drive</button>
              <p className="field-hint" style={{ marginBottom: 0 }}>Ledgora can only see files it makes itself, never the rest of your Drive.</p></div>
          )}
      </div>

      <div className="glass-panel p-4 mt-4" style={{ display: 'grid', gap: 8 }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>Auto backup</h3>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="form-label">How often<select className="form-input" value={s.frequency} onChange={(e) => saveSettings({ frequency: e.target.value })}>{CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="form-label">At (hour, IST)<input className="form-input" type="number" min="0" max="23" style={{ width: 90 }} value={s.hour} onChange={(e) => saveSettings({ hour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })} /></label>
          <label className="form-label">Keep the last<input className="form-input" type="number" min="1" max="60" style={{ width: 90 }} value={s.keepLast} onChange={(e) => saveSettings({ keepLast: Math.min(60, Math.max(1, Number(e.target.value) || 1)) })} /></label>
          <label><input type="checkbox" checked={s.remind} onChange={(e) => saveSettings({ remind: e.target.checked })} /> Remind me every <input className="form-input" type="number" min="1" max="90" style={{ width: 70, display: 'inline-block' }} value={s.remindDays} onChange={(e) => saveSettings({ remindDays: Math.min(90, Math.max(1, Number(e.target.value) || 1)) })} /> days</label>
        </div>
        <p className="field-hint" style={{ margin: 0 }}>Scheduled backups are encrypted with a key only this server holds (not your password), so you can restore them here from the history; a downloaded copy can not be opened on another server. {data.lastError ? `Last scheduled run failed: ${data.lastError}` : ''}</p>
      </div>

      <div className="glass-panel p-4 mt-4">
        <h3 className="section-title" style={{ marginTop: 0 }}>Restore</h3>
        <p className="field-hint">Replaces nothing. It adds the backup's businesses and documents to an account that has no business data yet, after taking a copy of what is there. Owner only.</p>
        <input type="file" accept=".ledgora" aria-label="Choose a backup file" onChange={(e) => choose(e.target.files?.[0])} />
      </div>

      <div className="glass-panel p-4 mt-4">
        <h3 className="section-title" style={{ marginTop: 0 }}>History</h3>
        <table className="data-table"><thead><tr><th>Date</th><th>Kind</th><th>Size</th><th>Encrypted</th><th>Drive</th><th>Invoices</th><th /></tr></thead>
          <tbody>
            {data.data.map((b) => (
              <tr key={b.id}><td>{fmtDate(b.createdAt)}</td><td>{KIND[b.kind]}</td><td>{fmtSize(b.sizeBytes)}</td><td>{LOCK[b.keyMode]}</td><td>{b.onDrive ? 'Yes' : ''}</td><td>{b.counts?.invoices ?? 0}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => downloadBackup(b).catch((e) => toast(errText(e), 'error'))}>Download</button>{' '}
                  <button className="btn btn-secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setRestore({ backupId: b.id, name: b.fileName, password: '', preview: null, confirm: '' })}>Restore</button>{' '}
                  <button className="btn btn-secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => remove(b)}>Delete</button></td></tr>
            ))}
            {!data.data.length && <tr><td colSpan="7" className="field-hint">No backups yet.</td></tr>}
          </tbody></table>
      </div>

      {restore && (
        <Dialog title={`Restore ${restore.name}`} onClose={() => !busy && setRestore(null)} width={560}>
          {restore.done ? (
            <>
              <p><strong>Restored.</strong> {Object.entries(restore.done.restoredCounts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}.</p>
              <p className="field-hint">A copy of what was here before is in the history ("Before a restore"). Switch to the restored business from the business menu.</p>
              <div className="flex justify-end"><button className="btn btn-primary" onClick={() => { setRestore(null); window.location.reload(); }}>Done</button></div>
            </>
          ) : (
            <>
              {restore.needsPassword && (
                <div><input className="form-input" type="password" aria-label="Backup password" placeholder="This backup is protected: enter its password" value={restore.password} onChange={(e) => setRestore({ ...restore, password: e.target.value })} />
                  <button className="btn btn-secondary mt-2" onClick={() => look(restore)}>Open</button></div>
              )}
              {restore.problem && <p role="alert" style={{ color: 'var(--danger, #dc2626)' }}>{restore.problem}</p>}
              {restore.preview && (
                <>
                  <p>Taken {fmtDate(restore.preview.manifest.createdAt)}: <strong>{counts.businesses ?? 0}</strong> business(es), <strong>{counts.invoices ?? 0}</strong> invoices, <strong>{counts.parties ?? 0}</strong> parties, <strong>{counts.items ?? 0}</strong> items, <strong>{counts.purchases ?? 0}</strong> purchases, <strong>{counts.ledgerEntries ?? 0}</strong> ledger entries.</p>
                  {!restore.preview.canRestore && <p role="alert" style={{ color: 'var(--danger, #dc2626)' }}>This account already has data ({Object.entries(restore.preview.blockers).map(([k, n]) => `${n} ${k}`).join(', ')}). Restore adds to an account with none: sign up a new account, or use a new organization, and restore there.</p>}
                  {restore.preview.canRestore && (
                    <label className="form-label">Type RESTORE to continue<input className="form-input" style={{ maxWidth: 200 }} value={restore.confirm} onChange={(e) => setRestore({ ...restore, confirm: e.target.value })} /></label>
                  )}
                </>
              )}
              <div className="flex gap-2 justify-end mt-4">
                <button className="btn btn-secondary" disabled={busy} onClick={() => setRestore(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={busy || restore.confirm !== 'RESTORE' || !restore.preview?.canRestore} onClick={run}>{busy ? 'Restoring…' : 'Restore'}</button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}
