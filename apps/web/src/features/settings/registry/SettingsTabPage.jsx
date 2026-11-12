import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Lock } from 'lucide-react';
import { SETTINGS, SETTINGS_TABS } from '@ledgora/contracts';
import { SettingRow, SettingsSection } from '../../../components/ui/SettingRow';
import { LoadingState, ErrorState } from '../../../components/ui/States';
import { toast } from '../../../components/ui/Toast';
import PageHeader from '../../../components/ui/PageHeader';
import { listBusinesses } from '../../../lib/data/accounting';
import { useEntitlements } from '../../billing/useEntitlements';
import { comingSoonLabel, plannedOf, searchSettings, sectionsOf } from './model';
import { useSettings } from './useSettings';
import BusinessProfile from './BusinessProfile';
import { confirmAction } from '../../../components/ui/ConfirmModal';

// Vyapar parity P8-S1: one page per tab of the registry. A row whose behaviour is not built is shown disabled with a
// "Coming soon" badge, never as a working control. Owner-only rows show a lock for everyone else; the API enforces it.

const soon = { fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999, background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)', marginLeft: 8 };

// "3, 7, 15" in a box; the value is committed when the box loses focus, so half-typed text is never sent.
function NumList({ id, value, disabled, onChange }) {
  const [text, setText] = useState((value || []).join(', '));
  useEffect(() => setText((value || []).join(', ')), [value]);
  const commit = () => {
    const nums = text.split(/[,\s]+/).filter(Boolean).map(Number);
    if (nums.some((n) => !Number.isInteger(n))) return setText((value || []).join(', '));
    if (nums.join(',') !== (value || []).join(',')) onChange(nums);
  };
  return <input id={id} className="ui-input" disabled={disabled} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />;
}

// Rows of a list setting (additional charges, custom fields): edited in place, saved together with Save.
const LIST_COLUMNS = {
  'txn.charges': { add: { name: '', gst: 18, sac: '' }, cols: [{ k: 'name', label: 'Name' }, { k: 'gst', label: 'GST %', type: 'number' }, { k: 'sac', label: 'SAC' }] },
  'party.custom': { add: { label: '', printOnInvoice: false }, cols: [{ k: 'label', label: 'Field name' }, { k: 'printOnInvoice', label: 'Print on invoice', type: 'checkbox' }] },
  'item.custom': { add: { label: '', printOnInvoice: false }, cols: [{ k: 'label', label: 'Field name' }, { k: 'printOnInvoice', label: 'Print on invoice', type: 'checkbox' }] },
};
function ListEditor({ settingKey, value, disabled, onChange }) {
  const spec = LIST_COLUMNS[settingKey];
  const [rows, setRows] = useState(value || []);
  useEffect(() => setRows(value || []), [value]);
  if (!spec) return <span className="ui-help">{Array.isArray(value) ? `${value.length} configured` : ''}</span>;
  const dirty = JSON.stringify(rows) !== JSON.stringify(value || []);
  const edit = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {spec.cols.map((c) =>
            c.type === 'checkbox' ? (
              <label key={c.k} className="ui-help" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" disabled={disabled} checked={!!r[c.k]} onChange={(e) => edit(i, c.k, e.target.checked)} /> {c.label}
              </label>
            ) : (
              <input key={c.k} className="ui-input" style={{ width: c.type === 'number' ? 80 : 160 }} aria-label={`${c.label} ${i + 1}`} placeholder={c.label} type={c.type || 'text'} disabled={disabled}
                value={r[c.k] ?? ''} onChange={(e) => edit(i, c.k, c.type === 'number' ? Number(e.target.value) : e.target.value)} />
            ),
          )}
          <button type="button" className="btn btn-ghost" disabled={disabled} aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => setRows([...rows, { ...spec.add }])}>Add</button>
        {dirty && <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onChange(rows)}>Save</button>}
      </div>
    </div>
  );
}

function Control({ id, settingKey, def, value, disabled, onChange }) {
  const common = { id, disabled, 'aria-disabled': disabled || undefined };
  if (def.control === 'switch')
    return <input type="checkbox" role="switch" {...common} checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  if (def.control === 'select')
    return (
      <select className="ui-select" {...common} value={String(value)} onChange={(e) => onChange(typeof def.options[0].value === 'number' ? Number(e.target.value) : e.target.value)}>
        {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  if (def.control === 'radio')
    return (
      <div role="radiogroup" aria-labelledby={`${id}-label`} style={{ display: 'flex', gap: 12 }}>
        {def.options.map((o) => (
          <label key={o.value} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="radio" name={id} disabled={disabled} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
          </label>
        ))}
      </div>
    );
  if (def.control === 'date')
    return <input type="date" className="ui-input" {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
  if (def.control === 'number' || def.control === 'money')
    return <input type="number" className="ui-input ui-input-num" {...common} value={value ?? ''} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />;
  if (def.control === 'numlist')
    return <NumList id={id} value={value} disabled={disabled} onChange={onChange} />;
  if (def.control === 'list')
    return <ListEditor settingKey={settingKey} value={value} disabled={disabled} onChange={onChange} />;
  if (def.control === 'textarea')
    return <textarea className="ui-input" rows={2} {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  return <input className="ui-input" {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

function Row({ k, value, canEdit, isOwner, onChange, highlight }) {
  const def = SETTINGS[k];
  const id = `setting-${k}`;
  const locked = def.ownerOnly && !isOwner;
  const disabled = !def.live || !canEdit || locked;
  return (
    <div id={id} style={highlight ? { outline: '2px solid var(--link)', borderRadius: 8, transition: 'outline-color .3s' } : undefined}>
      <SettingRow
        htmlFor={`${id}-control`}
        label={
          <span id={`${id}-label`}>
            {def.label}
            {def.ownerOnly && <span title="Owner only" aria-label="Owner only" style={{ marginLeft: 6 }}><Lock size={12} /></span>}
            {!def.live && <span style={soon} title="The screens do not use this yet">{comingSoonLabel(k)}</span>}
          </span>
        }
        help={locked && def.live ? `${def.help}. Only the owner can change this.` : def.help}
      >
        <Control id={`${id}-control`} settingKey={k} def={def} value={value} disabled={disabled} onChange={(v) => onChange(k, v)} />
      </SettingRow>
    </div>
  );
}

export default function SettingsTabPage({ tab }) {
  const { can, role } = useEntitlements();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [litDone, setLitDone] = useState(null);
  const { settings, loading, error: loadError, set, refetch } = useSettings(businessId);
  const info = SETTINGS_TABS.find((t) => t.id === tab);
  const sections = useMemo(() => sectionsOf(tab), [tab]);
  const hits = useMemo(() => searchSettings(q), [q]);
  const timer = useRef();

  useEffect(() => {
    listBusinesses().then((b) => { setBusinesses(b); setBusinessId((cur) => cur || (b.find((x) => x.isDefault) || b[0])?.id || ''); }).catch(setError);
  }, []);

  // Search result or deep link: scroll to the row and mark it for two seconds.
  useEffect(() => {
    if (!focus || !settings) return undefined;
    const el = document.getElementById(`setting-${focus}`);
    if (!el) return undefined;
    el.scrollIntoView({ block: 'center' });
    timer.current = setTimeout(() => setLitDone(focus), 2000);
    return () => clearTimeout(timer.current);
  }, [focus, settings, tab]);

  const change = async (key, value) => {
    // Switches that are hard to undo say what they will do first.
    if (SETTINGS[key].confirm && value !== settings[key]) {
      const ok = await confirmAction({ title: `Change “${SETTINGS[key].label}”?`, message: SETTINGS[key].confirm, confirmLabel: 'Change', tone: 'warning' });
      if (!ok) return;
    }
    try {
      await set(key, value);
      toast('Saved', 'success', 1500);
    } catch (e) {
      toast(e?.status === 403 ? 'Only the owner can change this setting' : e?.message || 'Could not save', 'error');
    }
  };

  if (error || loadError) return <ErrorState message={(error || loadError).message} onRetry={() => (loadError ? refetch() : window.location.reload())} />;
  if (!businesses || loading || !settings) return <LoadingState label="Opening settings…" />;

  return (
    <div>
      <PageHeader icon="⚙️" title={info.label} subtitle={info.hint} />
      <div style={{ display: 'flex', gap: 12, margin: '0 0 12px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <input className="ui-input" type="search" placeholder="Search settings…" aria-label="Search settings" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim() && (
            <ul role="listbox" aria-label="Matching settings" className="ui-card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: '4px 0 0', padding: 4, listStyle: 'none', maxHeight: 280, overflow: 'auto' }}>
              {hits.length === 0 && <li className="ui-help" style={{ padding: 8 }}>No setting matches “{q}”</li>}
              {hits.map((h) => (
                <li key={h.key}>
                  <button type="button" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => { setQ(''); navigate(`/settings/${h.tab}?focus=${encodeURIComponent(h.key)}`); }}>
                    <span>{h.label}</span>
                    <span className="ui-help">{SETTINGS_TABS.find((t) => t.id === h.tab).label}{h.live ? '' : ' · coming soon'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {businesses.length > 1 && (
          <select className="ui-select" aria-label="Business" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {tab === 'general' && businessId && <BusinessProfile key={businessId} businessId={businessId} canEdit={can('business:write')} />}

      {sections.map((s) => (
        <SettingsSection key={s.title} title={s.title}>
          {s.keys.map((k) => (
            <Row key={k} k={k} value={settings[k]} canEdit={can('settings:write')} isOwner={role === 'owner'} onChange={change} highlight={focus === k && litDone !== focus} />
          ))}
        </SettingsSection>
      ))}

      {plannedOf(tab).map((p) => (
        <SettingsSection key={p.title} title={p.title}>
          {p.href ? <Link to={p.href}>Open</Link> : <span style={soon}>Coming soon</span>} <span className="ui-help">{p.note}</span>
        </SettingsSection>
      ))}
    </div>
  );
}
