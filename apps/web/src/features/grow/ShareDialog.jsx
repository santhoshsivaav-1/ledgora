import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal';
import { Field } from '../../components/ui/Field';
import { toast } from '../../components/ui/Toast';
import { createLink, previewMessage, sendMessage } from '../../lib/data/messaging';

// P9-S1 / P9-S3: Share a typed invoice. WhatsApp opens the click-to-send link (nothing is sent by the server); e-mail
// goes out through the queue; Copy link makes a public read-only link. Missing phone or e-mail is fixed in the dialog.

const CHANNELS = [['whatsapp', 'WhatsApp'], ['email', 'Email'], ['link', 'Copy link']];

export default function ShareDialog({ businessId, invoice, event = 'sale', onClose }) {
  const [channel, setChannel] = useState('whatsapp');
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = { businessId, refId: invoice.id, event };

  useEffect(() => {
    if (channel === 'link') return undefined;
    let live = true;
    previewMessage({ ...base, channel, body: body || undefined, to: to || undefined })
      .then((p) => { if (live) setPreview(p); })
      .catch((e) => { if (live) setPreview({ error: e.message }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, body, to, businessId, invoice.id]);

  const missing = channel !== 'link' && preview && !preview.error && !preview.to;
  const blocked = preview?.optedOut || preview?.unknown?.length || preview?.error || missing;

  const go = async () => {
    setBusy(true);
    try {
      if (channel === 'link') {
        const l = await createLink(invoice.id);
        await navigator.clipboard?.writeText(l.url);
        toast('Link copied. It works for 30 days and can be revoked.', 'success');
        onClose();
        return;
      }
      const r = await sendMessage({ ...base, channel, body: body || undefined, to: to || undefined });
      if (r.url) {
        window.open(r.url, '_blank', 'noopener');
        toast('WhatsApp opened. Press send there.', 'success');
      } else toast(r.message.status === 'sent' ? 'Email sent' : `Email ${r.message.status}${r.message.error ? `: ${r.message.error}` : ''}`, r.message.status === 'failed' ? 'error' : 'success');
      onClose();
    } catch (e) {
      toast(e.message || 'Could not share', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Share ${invoice.number}`} onClose={onClose}>
      <div role="radiogroup" aria-label="Channel" style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        {CHANNELS.map(([v, l]) => (
          <label key={v}><input type="radio" name="share-ch" checked={channel === v} onChange={() => setChannel(v)} /> {l}</label>
        ))}
      </div>
      {channel !== 'link' && (
        <>
          <Field label={channel === 'email' ? 'To (email)' : 'To (mobile)'} help={preview?.partyName ? `Party: ${preview.partyName}` : undefined} error={missing ? (channel === 'email' ? 'Add an email address' : 'Add a valid mobile number') : undefined}>
            <input className="ui-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder={preview?.to || ''} />
          </Field>
          <Field label="Message" help={preview?.channelLimit ? `${preview.channelLimit.length}${preview.channelLimit.max ? ` / ${preview.channelLimit.max}` : ''} characters` : undefined} error={preview?.unknown?.length ? `Unknown: ${preview.unknown.map((u) => `{${u}}`).join(' ')}` : preview?.error}>
            <textarea className="ui-input" rows={6} value={body || preview?.text || ''} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {preview?.optedOut && <p role="alert" className="ui-error">This party asked not to be messaged.</p>}
        </>
      )}
      {channel === 'link' && <p className="ui-help">Makes a read-only page anyone with the link can open, for 30 days. You can revoke it later.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || (channel !== 'link' && blocked)} onClick={go}>
          {channel === 'whatsapp' ? 'Send on WhatsApp' : channel === 'email' ? 'Send email' : 'Copy link'}
        </button>
      </div>
    </Modal>
  );
}
