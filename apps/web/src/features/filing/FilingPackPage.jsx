import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CheckCircle2, Circle, ClipboardCheck, Download, XCircle } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import Modal from '../../components/ui/Modal';
import AttachmentField from '../../components/ui/AttachmentField';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { Field } from '../../components/ui/Field';
import { promptAction } from '../../components/ui/ConfirmModal';
import { toast } from '../../components/ui/Toast';
import { useEntitlements } from '../billing/useEntitlements';
import { useSession } from '../auth/SessionContext';
import { StepList } from '../gst-returns/gstHelpers';
import * as api from '../../lib/data/filing';
import { localToday } from '../../utils';

// File-ready returns: one filing pack. What the app checked, what is still open, the CA's review, the file to upload
// and the record of filing. The person uploads the file on the portal themselves; this screen never files anything.

const err = (e) => e?.message || 'Something went wrong';
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
// Uploading the pack's file. Both GSTR-1 and GSTR-3B take a JSON upload on the return's tile ("Prepare Offline"),
// per GSTN's GSTR-3B offline utility manual (updated 22-12-2025); the file can be uploaded again until submission.
const GSTR1_UPLOAD_STEPS = [
  { title: 'Open GSTR-1', details: 'gst.gov.in → Login → Services → Returns → Returns Dashboard → pick the financial year and the period of this pack → Search. On the GSTR-1 tile click “Prepare Offline”.' },
  { title: 'Upload this file', details: 'Under Upload, choose the file you downloaded here and upload it. Wait until the upload history shows “Processed”. If it shows errors, open the error report, fix the invoices in the app and save the pack again (a new version).' },
  { title: 'Check and submit', details: 'Back on the tile click “Prepare Online”, open the summary and compare it with this pack. Then “Generate GSTR-1 summary”, tick the declaration and file with EVC (OTP) or DSC.' },
  { title: 'Record it here', details: 'Copy the ARN from the success message and press “Record as filed”. Attach the acknowledgement if you downloaded it.' },
];
const GSTR3B_UPLOAD_STEPS = [
  { title: 'File GSTR-1 first', details: 'Table 3.1 of GSTR-3B is filled from your GSTR-1 / GSTR-1A and locked. File GSTR-1 for the period before 3B, and act on IMS so 2B (Table 4) is final.' },
  { title: 'Upload this file', details: 'Returns Dashboard → same period → on the GSTR-3B tile click “Prepare Offline” → Choose File → upload the file downloaded here. You can upload again until you submit; each upload replaces the last.' },
  { title: 'Review on the portal', details: 'Click “Prepare Online”. Compare each table with this pack. Where the portal shows locked figures from GSTR-1/1A or 2B that differ, the portal’s figures stand: correct the source (GSTR-1A, supplier, IMS), not the 3B.' },
  { title: 'Pay and file', details: 'Save, “Proceed to payment”, offset liability with credit and cash, then file with EVC (OTP) or DSC.' },
  { title: 'Record it here', details: 'Copy the ARN and press “Record as filed”.' },
];
// R1 returns. These packs are worksheets in the portal's table order: the person enters (or, for GSTR-9, uses the
// offline tool for) the figures shown under “Show the file”.
const GSTR1A_STEPS = [
  { title: 'Check the window', details: 'GSTR-1A is open only after GSTR-1 of the period is filed and until GSTR-3B of the same period is filed.' },
  { title: 'Enter the changes', details: 'Returns Dashboard → same period → GSTR-1A tile → Prepare Online. For every row of this pack: add the “added” records, edit the “amended” ones to the values shown, and delete the “deleted” ones (only if they were never a supply).' },
  { title: 'File', details: 'Generate the summary, check that the change in liability matches this pack, then file with EVC (OTP) or DSC. GSTR-3B of the period picks the change up.' },
  { title: 'Record it here', details: 'Copy the ARN and press “Record as filed”.' },
];
const GSTR9_STEPS = [
  { title: 'Open GSTR-9', details: 'Services → Returns → Annual Return → pick the financial year → GSTR-9 → Prepare Online (or the GSTR-9 offline tool for more than 500 HSN rows).' },
  { title: 'Compare the auto-filled tables', details: 'Tables 4–9 are filled from your GSTR-1/1A and 3B. Compare them with this pack (Tables 4, 5, 6A, 7, 8, 9, 17). Differences usually mean a month was amended after filing.' },
  { title: 'Fill what only you know', details: 'Every “Fill on the portal” warning of this pack: the ITC split into inputs, capital goods and services (6B–6H), tax paid (9), next-year amendments (10–14), refunds and demands (15–16).' },
  { title: 'Compute and file', details: '“Compute liabilities”, pay any extra tax with DRC-03, then file with EVC or DSC. Record the ARN here.' },
];
const CMP08_STEPS = [
  { title: 'Open CMP-08', details: 'Services → Returns → Returns Dashboard → the quarter → CMP-08 → Prepare Online.' },
  { title: 'Enter the figures', details: 'Outward supplies (turnover) with the CGST and SGST of this pack, and tax on inward supplies under reverse charge.' },
  { title: 'Pay and file', details: 'Pay the tax from the cash ledger, file with EVC or DSC, and record the ARN here.' },
];
const IMS_STEPS = [
  { title: 'Open IMS', details: 'gst.gov.in → Services → Returns → Invoice Management System (IMS) → Inward supplies.' },
  { title: 'Act on each invoice', details: 'For each supplier invoice below, choose Accept, Reject or Pending as listed. Reject only what you never bought: rejecting removes the credit.' },
  { title: 'Recompute GSTR-2B', details: 'After the actions, use “Compute GSTR-2B” so 3B Table 4 picks up the accepted credit.' },
  { title: 'Record it here', details: 'Press “Record as done”. Then prepare GSTR-3B with the 2B you just computed.' },
];

function Check({ ok, pending, children }) {
  const Icon = ok ? CheckCircle2 : pending ? Circle : XCircle;
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '6px 0', color: ok ? 'var(--text-primary)' : pending ? 'var(--text-muted)' : 'var(--danger, #dc2626)' }}>
      <Icon size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </li>
  );
}

function RecordFiledModal({ pack, onClose, onDone }) {
  const [arn, setArn] = useState('');
  const [filedOn, setFiledOn] = useState(localToday());
  const [ack, setAck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsArn = pack.kind !== 'ims';
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.recordFiled(pack.id, { arn: needsArn ? arn.trim().toUpperCase() : undefined, filedOn, ackFileId: ack?.fileId ?? null });
      toast(needsArn ? `Recorded as filed. ARN ${arn.trim().toUpperCase()}` : 'Recorded as done', 'success');
      onDone();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={needsArn ? 'Record as filed' : 'Record IMS actions as done'}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || (needsArn && arn.trim().length !== 15)}>{busy ? 'Saving…' : 'Record'}</button>
        </>
      }
    >
      <p className="ui-help" style={{ marginTop: 0 }}>
        Do this after the portal shows the return as filed. The app does not file it; this is your record, and it locks the
        period's sales and purchases against changes.
      </p>
      {needsArn && (
        <Field label="ARN (from the portal)" required help="15 characters, starts with AA and your state code" error={error && /ARN|state|15/.test(error) ? error : ''}>
          <input className="ui-input" value={arn} onChange={(e) => setArn(e.target.value)} maxLength={15} autoFocus placeholder="AA3310261234567" style={{ textTransform: 'uppercase', fontFamily: 'monospace' }} />
        </Field>
      )}
      <Field label="Filed on" required>
        <input className="ui-input" type="date" value={filedOn} max={localToday()} onChange={(e) => setFiledOn(e.target.value)} />
      </Field>
      <AttachmentField label="Acknowledgement from the portal (optional)" value={ack} onChange={setAck} />
      {error && !/ARN|state|15/.test(error) && <p className="ui-error" role="alert">{error}</p>}
    </Modal>
  );
}

export default function FilingPackPage() {
  const { id } = useParams();
  const { can, role } = useEntitlements();
  const { me } = useSession();
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [recording, setRecording] = useState(false);
  const [showFile, setShowFile] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.getPack(id).then((p) => { setPack(p); setPicked(new Set(p.acknowledged)); }, setError);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const errors = useMemo(() => (pack?.issues ?? []).filter((i) => i.severity === 'error'), [pack]);
  const warnings = useMemo(() => (pack?.issues ?? []).filter((i) => i.severity === 'warning'), [pack]);

  if (error) return <div className="dashboard-container"><ErrorState message={err(error)} onRetry={load} /></div>;
  if (!pack) return <div className="dashboard-container"><LoadingState label="Opening the return…" /></div>;

  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done, 'success');
      load();
    } catch (e) {
      toast(err(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const isPreparer = me?.user?.id && me.user.id === pack.preparedBy;
  const current = pack.current;
  const canEditAcks = current && can('filing:prepare') && ['draft', 'ready', 'changes_requested'].includes(pack.status);
  const approvalValid = pack.approvedSha256 && pack.approvedSha256 === pack.sha256;
  const [tone, label] = api.STATUS_TONES[pack.status] ?? ['neutral', pack.status];
  const title = `${api.KIND_LABELS[pack.kind]} · ${api.periodLabel(pack.period, pack.quarterly)}`;

  const download = () => act(() => api.downloadPack(pack.id), null);
  const sendForReview = async () => {
    const note = await promptAction({ title: `Send to ${reviewer} for approval`, message: `A note for ${reviewer} (optional)`, defaultValue: '', confirmLabel: 'Send for review' });
    if (note === null || note === undefined) return;
    act(() => api.submitReview(pack.id, note), role === 'ca' ? 'Sent to the business for approval. The owner is e-mailed.' : 'Sent to your CA. They are e-mailed and see it on their CA Dashboard.');
  };
  const approve = async () => {
    const note = await promptAction({ title: 'Approve this return', message: 'You approve this exact file (fingerprint below). Any later change needs your approval again. Note (optional):', defaultValue: '', confirmLabel: 'Approve' });
    if (note === null || note === undefined) return;
    act(() => api.approvePack(pack.id, note), 'Approved');
  };
  const sendBack = async () => {
    const note = await promptAction({ title: 'Send back for changes', message: 'What needs to change?', defaultValue: '', confirmLabel: 'Send back' });
    if (!note) return;
    act(() => api.requestChanges(pack.id, note), 'Sent back with your note');
  };
  const reopen = async () => {
    const reason = await promptAction({ title: 'Reopen this filed return', message: 'This only corrects the record here; it does not change anything on the portal. Why?', defaultValue: '', confirmLabel: 'Reopen' });
    if (!reason) return;
    act(() => api.reopenPack(pack.id, reason), 'Reopened');
  };
  const saveAcks = () => act(() => api.acknowledge(pack.id, [...picked]), 'Saved');
  const postComment = () => {
    if (!comment.trim()) return;
    act(() => api.commentOn(pack.id, comment.trim()).then(() => setComment('')), null);
  };

  const canFile = current && can('filing:record') && (pack.status === 'approved' || (pack.status === 'ready' && !pack.reviewRequired));
  const steps = { gstr1: GSTR1_UPLOAD_STEPS, gstr3b: GSTR3B_UPLOAD_STEPS, gstr1a: GSTR1A_STEPS, gstr9: GSTR9_STEPS, cmp08: CMP08_STEPS }[pack.kind] ?? IMS_STEPS;
  // A CA sends its own work to the business for approval; anyone else sends it to the CA.
  const reviewer = role === 'ca' ? 'the business' : 'your CA';

  return (
    <div className="dashboard-container">
      <PageHeader
        compact
        breadcrumb={[{ label: 'Return Register', to: '/filing' }, { label: title }]}
        title={title}
        meta={`${pack.business.name} · GSTIN ${pack.business.gstin} · version ${pack.version}`}
        actions={<StatusChip tone={tone}>{label}</StatusChip>}
      />
      {!current && (
        <div className="glass-panel p-4" role="status" style={{ marginBottom: 12 }}>
          This is an older version. <Link to={`/filing/${pack.versions.find((v) => v.current)?.id}`}>Open the current one</Link>.
        </div>
      )}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <section className="glass-panel p-4" aria-labelledby="ready-h">
          <h3 id="ready-h" className="section-title" style={{ marginTop: 0 }}>Is it ready to upload?</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            <Check ok>File in the portal's own format ({(pack.sizeBytes / 1024).toFixed(1)} KB)</Check>
            <Check ok={!errors.length}>{errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'} to fix in your books` : 'Passes the portal checks the app knows'}</Check>
            <Check ok={!pack.open.warnings}>{pack.open.warnings ? `${pack.open.warnings} warning${pack.open.warnings === 1 ? '' : 's'} to read and accept` : 'Every warning read and accepted'}</Check>
            {pack.reviewRequired && <Check ok={!!approvalValid} pending={!approvalValid}>{approvalValid ? 'Approved by the reviewer' : 'Waiting for approval'}</Check>}
            <Check ok={pack.status === 'filed'} pending={pack.status !== 'filed'}>{pack.status === 'filed' ? `Filed${pack.arn ? `, ARN ${pack.arn}` : ''} on ${pack.filedOn}` : 'Upload on the portal, then record it here'}</Check>
          </ul>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <button className="btn btn-primary" onClick={download} disabled={busy}><Download size={15} /> Download file</button>
            {current && can('filing:prepare') && ['ready', 'changes_requested'].includes(pack.status) && (
              <button className="btn btn-secondary" onClick={sendForReview} disabled={busy || !pack.ready}>
                {role === 'ca' ? 'Send to business for approval' : 'Send to CA for review'}
              </button>
            )}
            {current && pack.status === 'in_review' && can('filing:approve') && !isPreparer && (
              <>
                <button className="btn btn-primary" onClick={approve} disabled={busy}><ClipboardCheck size={15} /> Approve</button>
                <button className="btn btn-secondary" onClick={sendBack} disabled={busy}>Send back</button>
              </>
            )}
            {canFile && <button className="btn btn-primary" onClick={() => setRecording(true)} disabled={busy}>{pack.kind === 'ims' ? 'Record as done' : 'Record as filed'}</button>}
            {pack.status === 'filed' && (role === 'owner' || role === 'admin') && (
              <button className="btn btn-secondary" onClick={reopen} disabled={busy}>Reopen</button>
            )}
          </div>
          {pack.status === 'ready' && pack.reviewRequired && (
            <p className="ui-help">This return went to review once, so it needs the CA's approval before it is recorded as filed.</p>
          )}
          {pack.status === 'in_review' && isPreparer && (
            <p className="ui-help">You prepared it, so {role === 'ca' ? 'the business owner' : 'your CA'} approves it. Nobody approves their own return.</p>
          )}
          <p className="ui-help" style={{ wordBreak: 'break-all' }}>
            Fingerprint (SHA-256): <code>{pack.sha256}</code>
            {approvalValid && <> · approved {when(pack.reviewedAt)}</>}
          </p>
        </section>

        <StepList steps={steps} title="Upload it on the portal" />
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="glass-panel p-4 mt-4" aria-labelledby="issues-h">
          <h3 id="issues-h" className="section-title" style={{ marginTop: 0 }}>What the checks found</h3>
          {errors.length > 0 && (
            <>
              <p className="ui-help">Errors stop the upload. Fix them in the invoices or bills, then save the pack again from GST Returns.</p>
              <ul style={{ paddingLeft: 18 }}>
                {errors.map((i) => (
                  <li key={i.id} style={{ color: 'var(--danger, #dc2626)', marginBottom: 4 }}>
                    {i.message}{i.path ? <span className="ui-help"> — {i.path}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          {warnings.length > 0 && (
            <>
              <p className="ui-help">Warnings do not stop the portal, but read each one. Tick it once you accept it.</p>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {warnings.map((i) => (
                  <li key={i.id} style={{ marginBottom: 6 }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <input
                        type="checkbox"
                        checked={picked.has(i.id)}
                        disabled={!canEditAcks}
                        onChange={() => setPicked((s) => { const n = new Set(s); n.has(i.id) ? n.delete(i.id) : n.add(i.id); return n; })}
                      />
                      <span>{i.message}{i.path ? <span className="ui-help"> — {i.path}</span> : null}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {canEditAcks && <button className="btn btn-secondary" onClick={saveAcks} disabled={busy}>Save accepted warnings</button>}
            </>
          )}
        </section>
      )}

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start', marginTop: 16 }}>
        <section className="glass-panel p-4" aria-labelledby="time-h">
          <h3 id="time-h" className="section-title" style={{ marginTop: 0 }}>Timeline and comments</h3>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {pack.events.map((e) => (
              <li key={e.id} style={{ borderLeft: '2px solid var(--border)', padding: '2px 0 10px 10px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {when(e.at)} · {e.actorName}{e.actorRole === 'ca' ? ' (CA)' : ''}
                </div>
                {e.kind === 'status' ? (
                  <div><strong>{api.STATUS_TONES[e.to]?.[1] ?? e.to}</strong>{e.body ? ` — ${e.body}` : ''}</div>
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{e.body}</div>
                )}
              </li>
            ))}
          </ol>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <textarea className="ui-input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment for the owner, the accountant or the CA" aria-label="Comment" style={{ flex: 1 }} />
            <button className="btn btn-secondary" onClick={postComment} disabled={busy || !comment.trim()}>Post</button>
          </div>
        </section>

        <section className="glass-panel p-4" aria-labelledby="ver-h">
          <h3 id="ver-h" className="section-title" style={{ marginTop: 0 }}>Versions</h3>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {pack.versions.map((v) => (
              <li key={v.id}>
                {v.id === pack.id ? <strong>Version {v.version}</strong> : <Link to={`/filing/${v.id}`}>Version {v.version}</Link>}{' '}
                <span className="ui-help">{api.STATUS_TONES[v.status]?.[1]} · {when(v.createdAt)}{v.current ? ' · current' : ''}</span>
              </li>
            ))}
          </ul>
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => setShowFile((s) => !s)} aria-expanded={showFile}>
            {showFile ? 'Hide the file' : 'Show the file'}
          </button>
          {showFile && (
            <pre style={{ maxHeight: 360, overflow: 'auto', fontSize: '0.72rem', background: 'var(--surface-2, rgba(0,0,0,0.04))', padding: 10, borderRadius: 8, marginTop: 8 }}>
              {JSON.stringify(pack.payload, null, 2)}
            </pre>
          )}
        </section>
      </div>

      {recording && <RecordFiledModal pack={pack} onClose={() => setRecording(false)} onDone={() => { setRecording(false); load(); }} />}
    </div>
  );
}
