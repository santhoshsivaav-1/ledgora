import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

// The form-and-preview layout of Add Sale and the other document forms (P0-S3.6): the form on the left, a live
// preview on the right that redraws 250 ms after typing stops (so a long invoice does not re-render per keystroke),
// a toggle to hide it, and under 1280px the preview drops below the form.
//
// `renderPreview(draft)` draws the document; the invoice editor passes InvoicePreview when Phase 2 moves onto this.

export function useDebounced(value, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const PREF = 'ledgora_preview';
const readPref = () => {
  try {
    return localStorage.getItem(PREF) !== 'off';
  } catch {
    return true;
  }
};

export default function LivePreview({ draft, renderPreview, children, title = 'Preview' }) {
  const [on, setOn] = useState(readPref);
  const settled = useDebounced(draft);
  const toggle = () => {
    setOn((v) => {
      try {
        localStorage.setItem(PREF, v ? 'off' : 'on');
      } catch {
        /* private mode */
      }
      return !v;
    });
  };
  return (
    <div className="ui-split" data-preview={on ? 'on' : 'off'}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--s-2)' }}>
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-pressed={on} onClick={toggle}>
            {on ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} {on ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
        {children}
      </div>
      {on && (
        <aside className="ui-preview" aria-label={title}>
          <div className="ui-preview-head">{title}</div>
          {renderPreview(settled)}
        </aside>
      )}
    </div>
  );
}
