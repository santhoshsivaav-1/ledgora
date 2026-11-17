import { useState } from 'react';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { apiClient } from '../../lib/apiClient';

// Data and privacy: ask to see, correct or erase your personal data (India's DPDP Act, 2023). The request is recorded and
// mailed to the operator, who answers within 30 days (apps/api/src/modules/privacy.ts).
const KINDS = [
  ['access', 'Send me a copy of my data'],
  ['correction', 'Correct my personal data'],
  ['erasure', 'Delete my account and my data'],
];

export default function PrivacyRequests() {
  const [kind, setKind] = useState('access');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const send = async (e) => {
    e.preventDefault();
    if (kind === 'erasure' && !(await confirmAction({ title: 'Ask for your data to be deleted?', message: 'We will contact you to confirm before anything is erased. Download a backup first if you want to keep your records.', confirmLabel: 'Send request', tone: 'danger' }))) return;
    setBusy(true);
    try {
      await apiClient.post('/v1/privacy/requests', { kind, note });
      setSent(kind); setNote('');
      toast('Request sent. We answer within 30 days.', 'success');
    } catch (err) {
      toast(err?.message || 'Could not send the request', 'error');
    } finally { setBusy(false); }
  };
  return (
    <section id="section-privacy" data-settings-tab="data" className="glass-panel p-6 mb-6" style={{ order: 11 }} aria-labelledby="privacy-h">
      <h3 className="section-title" id="privacy-h">Your data and privacy</h3>
      <p className="ui-help">You can ask to see, correct or erase your personal data at any time. Read the <a href="/privacy" target="_blank" rel="noreferrer">privacy policy</a>.</p>
      <form onSubmit={send} style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
        <label>
          <span className="ui-help">What do you need?</span>
          <select className="form-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          <span className="ui-help">Anything we should know (optional)</span>
          <textarea className="form-input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div><button className="btn btn-secondary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button></div>
        {sent && <p className="ui-help" role="status">Your {sent} request is with us.</p>}
      </form>
    </section>
  );
}
