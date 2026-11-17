import { Save } from 'lucide-react';
import { FEATURE_GROUPS, isModuleEnabled } from '../../utils';

export function StockAlertsSection({ stockAlerts, setStockAlerts, stockAlertsSaving, saveStockAlerts }) {
  return (
    <>
      {/* ---- Stock Alerts ---- */}
      {/* v1.10.36 — Redesign: prior layout had an awkward grid with the
           threshold input crammed next to inline "Common picks: 0, 3,
           5, 10" text — hard to scan, hard to click. Now: master toggle
           + one big Threshold row with clickable preset chips ABOVE the
           input so users can pick a common value in one click, then a
           number field for fine-tuning. Save button gets a subtle live
           status text next to it. */}
      <div id="section-stock" data-settings-tab="features" className="glass-panel p-6 mb-6" style={{ order: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.9rem', marginBottom: '0.9rem' }}>
          <div style={{
            width: 40, height: 40, flexShrink: 0,
            borderRadius: 10,
            background: 'rgba(245, 158, 11, 0.18)',
            color: '#d97706',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.15rem',
          }}>🔔</div>
          <div>
            <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem' }}>Low-stock alerts</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              Powers the 🔔 sidebar badge and the Dashboard low-stock list. The Inventory page colour-codes products against this threshold too.
            </p>
          </div>
        </div>

        {/* Master toggle row */}
        <div style={{
          padding: '0.75rem 0.9rem',
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
          marginBottom: stockAlerts.enabled ? '0.85rem' : 0,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 }}>
            <input type="checkbox" checked={!!stockAlerts.enabled}
              onChange={e => setStockAlerts(prev => ({ ...prev, enabled: e.target.checked }))}
              style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
            Show low-stock alerts
          </label>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1, minWidth: 200 }}>
            {stockAlerts.enabled
              ? 'Notifications fire when a product\'s stock falls to or below the threshold.'
              : 'Alerts are silenced. Inventory still tracks stock; it just doesn\'t nag you.'}
          </span>
        </div>

        {/* Threshold — chip presets + fine-tune input, only shown when enabled */}
        {stockAlerts.enabled && (
          <div style={{ marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Threshold</label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Alert when stock ≤ <strong style={{ color: 'var(--text)' }}>{stockAlerts.threshold}</strong>
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                { val: 0, label: '0', hint: 'Only when fully out' },
                { val: 3, label: '3', hint: 'Very tight' },
                { val: 5, label: '5', hint: 'Recommended' },
                { val: 10, label: '10', hint: 'Loose' },
              ].map(p => {
                const active = stockAlerts.threshold === p.val;
                return (
                  <button key={p.val} type="button"
                    onClick={() => setStockAlerts(prev => ({ ...prev, threshold: p.val }))}
                    title={p.hint}
                    style={{
                      padding: '0.45rem 0.85rem',
                      borderRadius: 999,
                      background: active
                        ? 'linear-gradient(135deg, var(--primary), var(--primary-darker))'
                        : 'var(--bg-secondary)',
                      color: active ? '#fff' : 'var(--text)',
                      border: active ? '1px solid transparent' : '1px solid var(--border)',
                      fontSize: '0.85rem', fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      minWidth: 44,
                      boxShadow: active ? '0 4px 10px rgba(var(--primary-rgb), 0.35)' : 'none',
                    }}>
                    {p.label}
                    <span style={{ display: 'block', fontSize: '0.6rem', fontWeight: 500, opacity: 0.85, marginTop: 1 }}>{p.hint}</span>
                  </button>
                );
              })}
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>or</span>
              <input type="number" min="0" max="9999" step="1"
                className="form-input" style={{ width: 90 }}
                value={stockAlerts.threshold}
                onChange={e => setStockAlerts(prev => ({ ...prev, threshold: Math.max(0, parseInt(e.target.value, 10) || 0) }))} />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Changes take effect after saving
          </span>
          <button type="button" className="btn btn-primary"
            disabled={stockAlertsSaving}
            onClick={saveStockAlerts}>
            <Save size={16} /> {stockAlertsSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}


export function ModulesSection({ enabledModules, toggleModule, resetModules, regionMode }) {
  return (
    <>
      {/* ---- Modules / Features ---- */}
      <div id="section-modules" data-settings-tab="features" className="glass-panel p-6 mb-6" style={{ order: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem' }}>Modules</h3>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
              Turn off the features you don't need. They disappear from the sidebar and forms — your data stays untouched.
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={resetModules} style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem' }}>
            Reset to default
          </button>
        </div>
        <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
          {FEATURE_GROUPS.map(group => (
            <div key={group.id} className="surface-card">
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '0.15rem' }}>{group.label}</div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>{group.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {group.modules.map(mod => {
                  const enabled = isModuleEnabled(mod.id, enabledModules);
                  // Hide India-only modules entirely when region is "international" — toggling
                  // them on wouldn't have any effect.
                  if (mod.indiaOnly && regionMode === 'international') return null;
                  return (
                    <label key={mod.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.78rem', cursor: mod.core ? 'not-allowed' : 'pointer', opacity: mod.core ? 0.55 : 1 }}>
                      <input type="checkbox" checked={enabled} disabled={mod.core}
                        onChange={() => !mod.core && toggleModule(mod.id)}
                        style={{ width: 15, height: 15, accentColor: 'var(--primary)', marginTop: '2px' }} />
                      <span style={{ lineHeight: 1.35 }}>
                        {mod.label}
                        {mod.core && <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginLeft: '0.4rem' }}>(always on)</span>}
                        {mod.indiaOnly && <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginLeft: '0.4rem' }} title="India-only feature">🇮🇳</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}


export function RegionSection({ regionMode, handleRegionChange }) {
  return (
    <>
      {/* ---- Region Preference ---- */}
      <div id="section-region" data-settings-tab="business" className="glass-panel p-6 mb-6" style={{ order: 7 }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>Region Preference</h3>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.85rem' }}>
          Choose how the app behaves. You can change this any time without losing data.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { id: 'india', label: '🇮🇳 India only', desc: 'GST flows, INR-first, GSTR-1/3B, E-Way Bill, UPI QR' },
            { id: 'international', label: '🌍 International', desc: 'VAT/SST/TVA labels, multi-currency, no India-only flows' },
            { id: 'both', label: '🌐 Both / Auto', desc: 'Show all countries — pick per invoice (default)' },
          ].map(opt => (
            <button key={opt.id} type="button"
              onClick={() => handleRegionChange(opt.id)}
              className={`type-chip ${regionMode === opt.id ? 'type-chip-active' : ''}`}
              title={opt.desc}
              style={{ flex: '1 1 200px', minWidth: '200px', textAlign: 'left', padding: '0.6rem 0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem' }}>
              <span style={{ fontWeight: 600 }}>{opt.label}</span>
              <span style={{ fontSize: '0.72rem', color: regionMode === opt.id ? 'inherit' : '#94a3b8', fontWeight: 400 }}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

