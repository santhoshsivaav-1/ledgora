import { useState, useEffect, useRef } from 'react';
import { Save as SaveIcon, Trash2 } from 'lucide-react';
import { toast } from '../../components/ui/Toast';
import { getInvoiceDisplayOptions, saveInvoiceDisplayOptions } from '../../lib/data';

// ---- small building blocks (moved out of PrintSettings.jsx) ----------------
// These are the reusable rows / editors every settings section is built
// from. Purely presentational except RoundOffSetting, which owns its own
// dual-store persistence (same behaviour as before the move).

export function SettingGroup({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        {children}
      </div>
    </div>
  );
}

// v1.10.75 — requested: "auto round-off option". Rounding was only reachable
// from Customize -> Totals inside an open invoice. This is the same switch
// (the invoice default `showRoundOff`), kept where people look for app-wide
// settings. It writes both stores the invoice screen reads, so the next new
// invoice follows it. Saved invoices keep their own choice.
export function RoundOffSetting() {
  const read = () => {
    try { return JSON.parse(localStorage.getItem('freegstbill_invoiceOptions') || '{}').showRoundOff !== false; }
    catch { return true; }
  };
  const [on, setOn] = useState(read);
  const touched = useRef(false); // a click before the load answers must win
  useEffect(() => {
    getInvoiceDisplayOptions().then((o) => { if (!touched.current && o && typeof o.showRoundOff === 'boolean') setOn(o.showRoundOff); }).catch(() => {});
  }, []);
  const change = async (value) => {
    touched.current = true;
    setOn(value);
    try {
      const local = JSON.parse(localStorage.getItem('freegstbill_invoiceOptions') || '{}');
      localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify({ ...local, showRoundOff: value }));
    } catch { /* storage blocked: the server copy below still applies */ }
    try {
      const server = await getInvoiceDisplayOptions().catch(() => null);
      await saveInvoiceDisplayOptions({ ...(server || {}), showRoundOff: value });
      toast(value ? 'New invoices will be rounded off' : 'New invoices will not be rounded off', 'success');
    } catch { toast('Could not save the round-off setting', 'error'); }
  };
  return (
    <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
        🧮 Totals
      </h4>
      <ToggleRow label="Round off invoice totals" value={on} onChange={change}
        hint="Rounds the grand total to the nearest rupee and prints the difference as a Round-off line. Applies to new invoices; you can still change it per invoice under Customize → Totals." />
    </div>
  );
}

// v1.10.36 — ToggleRow gained an optional `tag` prop for the
// "Recommended for retail" / "Recommended for wholesale" etc. badges.
// Kept optional so unrelated toggles render exactly as before.
export function ToggleRow({ label, value, onChange, hint, tag }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem' }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: 'var(--primary)' }} />
      <span style={{ flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {tag && <span style={{
          display: 'inline-block', marginLeft: 6,
          fontSize: '0.6rem', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.04em',
          padding: '1px 6px', borderRadius: 999,
          background: 'var(--primary-light, rgba(30,64,175,0.1))',
          color: 'var(--primary)',
        }}>★ {tag}</span>}
        {hint && <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</span>}
      </span>
    </label>
  );
}

export function SelectRow({ label, value, onChange, options, hint }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 3 }}>{label}</label>
      <select className="form-input" style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
        value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

export function CustomListEditor({ values, onChange, placeholder }) {
  const [input, setInput] = useState('');
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        {(values || []).map((v, i) => (
          <span key={i} style={{ background: 'var(--primary)', color: '#fff', padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {v}%
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))}
              style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: '0.85rem', lineHeight: 1 }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          placeholder={placeholder}
          className="form-input" style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem', flex: 1 }} />
        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem' }}
          onClick={() => {
            const parsed = input.split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n) && n >= 0 && n <= 100);
            if (parsed.length === 0) return;
            const merged = Array.from(new Set([...(values || []), ...parsed])).sort((a, b) => a - b);
            onChange(merged);
            setInput('');
          }}>Add</button>
      </div>
    </div>
  );
}

export function ExtraFieldsEditor({ fields, onChange }) {
  const [label, setLabel] = useState('');
  return (
    <div>
      {(fields || []).map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem' }}>
          <input type="text" value={f.label} className="form-input"
            style={{ fontSize: '0.82rem', padding: '0.35rem', flex: 1 }}
            onChange={e => {
              const next = [...fields];
              next[i] = { ...next[i], label: e.target.value };
              onChange(next);
            }} />
          <button type="button" className="icon-btn icon-btn-red"
            onClick={() => onChange(fields.filter((_, j) => j !== i))}
            title="Remove"><Trash2 size={14} /></button>
        </div>
      ))}
      {(fields || []).length < 5 && (
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem' }}>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. PO Reference"
            className="form-input" style={{ fontSize: '0.82rem', padding: '0.35rem', flex: 1 }} />
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.78rem' }}
            onClick={() => {
              if (!label.trim()) return;
              onChange([...(fields || []), { label: label.trim(), value: '' }]);
              setLabel('');
            }}>Add field</button>
        </div>
      )}
    </div>
  );
}

export function SavedTemplatesEditor({ templates, onChange, currentSettings, onLoad }) {
  const [name, setName] = useState('');
  return (
    <div>
      {(templates || []).map((tpl, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem', alignItems: 'center', padding: '0.4rem', background: 'var(--card)', borderRadius: 5 }}>
          <span style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600 }}>{tpl.name}</span>
          <button type="button" className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
            onClick={() => onLoad(tpl)}>Load</button>
          <button type="button" className="icon-btn icon-btn-red"
            onClick={() => onChange(templates.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Template name (e.g. Retail v1)"
          className="form-input" style={{ fontSize: '0.82rem', padding: '0.35rem', flex: 1 }} />
        <button type="button" className="btn btn-primary" style={{ fontSize: '0.78rem' }}
          onClick={() => {
            if (!name.trim()) return;
            onChange([...(templates || []), { name: name.trim(), settings: { ...currentSettings } }]);
            setName('');
            toast(`Saved template "${name.trim()}"`, 'success');
          }}>
          <SaveIcon size={13} /> Save current as template
        </button>
      </div>
    </div>
  );
}

export function ColorRow({ label, value, onChange, hint }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        <input type="color" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: 42, height: 32, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} />
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="form-input" style={{ fontSize: '0.8rem', padding: '0.3rem 0.4rem', fontFamily: 'monospace' }}
          placeholder="#000000" />
      </div>
      {hint && <p style={{ margin: '3px 0 0', fontSize: '0.68rem', color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

export function NumInput({ label, value, onChange, min = 0, max = 100 }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 2 }}>{label}</label>
      <input type="number" min={min} max={max} step="0.5"
        value={value ?? 0}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="form-input" style={{ fontSize: '0.8rem', padding: '0.3rem 0.4rem', width: '100%' }} />
    </div>
  );
}

export function TextRow({ label, value, onChange, hint, placeholder }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 3 }}>{label}</label>
      <input type="text" className="form-input" style={{ fontSize: '0.82rem', padding: '0.35rem 0.55rem' }}
        value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}
