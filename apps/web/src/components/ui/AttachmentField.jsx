import { useRef, useState } from 'react';
import { Paperclip, X, ExternalLink } from 'lucide-react';
import { openAttachment, uploadAttachment } from '../../lib/data/files';
import { toast } from './Toast';

// One attached file on a form (Vyapar parity Phase 3: original bill, receipt). `value` is { fileId, fileName } or null.
export default function AttachmentField({ label = 'Attachment', value, onChange, accept = 'image/*,application/pdf' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadAttachment(file));
    } catch (err) {
      toast(err.message || 'Could not attach the file', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {value?.fileId ? (
          <>
            <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
              onClick={() => openAttachment(value.fileId).catch(() => toast('Could not open the file', 'error'))}>
              <ExternalLink size={14} /> {value.fileName || 'Open'}
            </button>
            <button type="button" className="icon-btn icon-btn-red" aria-label="Remove attachment" onClick={() => onChange(null)}><X size={14} /></button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} disabled={busy}
            onClick={() => input.current?.click()}>
            <Paperclip size={14} /> {busy ? 'Uploading…' : 'Attach file'}
          </button>
        )}
        <input ref={input} type="file" accept={accept} hidden onChange={pick} aria-label={label} />
      </div>
    </div>
  );
}
