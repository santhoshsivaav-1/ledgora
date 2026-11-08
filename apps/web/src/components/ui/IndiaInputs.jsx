import { useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { INDIAN_STATES, decodeGstin, getStateCode, stateNameForCode } from '../../utils';
import { normalisePhone } from './lib/format';

// Indian-specific inputs (P0-S3.3): mobile number, GSTIN and state. The GSTIN rules are the tax engine's
// (packages/tax-engine/src/gstin.ts), so this box and the invoice checks can never disagree.

export function PhoneInput({ value, onChange, className = '', ...rest }) {
  return (
    <span className="ui-affix">
      <span className="ui-prefix" aria-hidden="true">
        +91
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={14}
        className={`ui-input ${className}`.trim()}
        style={{ paddingLeft: 44 }}
        value={value ?? ''}
        onChange={(e) => onChange?.(normalisePhone(e.target.value))}
        {...rest}
      />
    </span>
  );
}

/** What to say under a GSTIN box: the state as soon as two digits are in, then whether the number checks out. */
export function gstinHint(value) {
  const v = String(value || '').toUpperCase();
  if (v.length < 2) return { tone: 'muted', text: '' };
  const state = stateNameForCode(v.slice(0, 2));
  if (v.length < 15) return { tone: state ? 'muted' : 'error', text: state || 'The first two digits are not a state code' };
  const d = decodeGstin(v);
  if (!d?.checksumOk) return { tone: 'error', text: 'This GSTIN is not valid (check digit does not match)' };
  return { tone: 'ok', text: d.state || 'Valid GSTIN' };
}

/**
 * GSTIN box: uppercase, 15 characters, the state named after two digits and the check digit verified. "Get Details"
 * stays disabled until a lookup provider is chosen (see docs/DECISIONS.md); `onLookup` turns it on.
 */
export function GstinInput({ value, onChange, onLookup, className = '', ...rest }) {
  const hint = gstinHint(value);
  const describedBy = rest['aria-describedby'];
  const hintId = useId();
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="ui-affix">
        <input
          type="text"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={15}
          className={`ui-input has-suffix ${className}`.trim()}
          style={{ paddingLeft: 'var(--s-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          value={value ?? ''}
          onChange={(e) => onChange?.(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
          {...rest}
          aria-describedby={[describedBy, hint.text ? hintId : null].filter(Boolean).join(' ') || undefined}
          aria-invalid={hint.tone === 'error' || rest['aria-invalid'] || undefined}
        />
        <span className="ui-suffix">
          <button
            type="button"
            className="ui-btn ui-btn-ghost ui-btn-sm"
            disabled={!onLookup || hint.tone !== 'ok'}
            onClick={() => onLookup?.(value)}
            title={onLookup ? 'Fill name and address from the GST portal' : 'Lookup is not set up yet'}
          >
            Get Details <RefreshCw size={12} aria-hidden="true" />
          </button>
        </span>
      </span>
      {hint.text && (
        <span id={hintId} className={hint.tone === 'error' ? 'ui-error' : 'ui-help'} style={hint.tone === 'ok' ? { color: 'var(--pos)' } : undefined}>
          {hint.text}
        </span>
      )}
    </span>
  );
}

/** States and union territories with their GST state code, in the spelling the rest of the app uses. */
export const STATE_OPTIONS = INDIAN_STATES.map((name) => ({ value: name, code: getStateCode(name), label: `${getStateCode(name)} · ${name}` }));

export function StateSelect({ value, onChange, placeholder = 'Select state', className = '', ...rest }) {
  return (
    <select className={`ui-select ${className}`.trim()} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...rest}>
      <option value="">{placeholder}</option>
      {STATE_OPTIONS.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

/** Drop or pick an image or PDF (up to 5 MB by default). `onFiles` receives the files that passed. */
export function FileDrop({ onFiles, accept = 'image/*,application/pdf', maxBytes = 5 * 1024 * 1024, multiple = false, label = 'Drop a file here or click to choose', onReject }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const take = (list) => {
    const files = Array.from(list || []);
    const ok = files.filter((f) => f.size <= maxBytes);
    if (ok.length < files.length) onReject?.(files.filter((f) => f.size > maxBytes));
    if (ok.length) onFiles?.(multiple ? ok : ok.slice(0, 1));
  };
  return (
    <div
      className="ui-filedrop"
      role="button"
      tabIndex={0}
      data-over={over}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <span>{label}</span>
      <span className="ui-help">Image or PDF, up to {Math.round(maxBytes / 1024 / 1024)} MB</span>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => take(e.target.files)} />
    </div>
  );
}
