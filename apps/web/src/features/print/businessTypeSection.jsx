import { BUSINESS_PRESETS } from './printSettingsStore';

// v1.10.36 — Business-type preset was buried below 25 other
// sections at line ~883. It's actually the FIRST decision a user
// should make — picking Retail / Restaurant / Freelancer / etc.
// auto-configures 15+ downstream settings AND (per this update)
// gates recommended/relevant options in the rest of the panel.
// So it comes first now. Also tracks `activeBusinessPresetId` so
// downstream sections can conditionally show "Recommended for
// your business" tags without asking the user again.
//
// Props (explicit, from PrintSettings):
//   settings   — the current print settings object
//   onApply    — async (presetKey) => applies the preset (confirm + save + toast)
//   onClear    — () => clears the active business preset
export function BusinessTypeSection({ settings, onApply, onClear }) {
  return (
    <div style={{
      padding: '0.85rem 1rem',
      background: 'linear-gradient(135deg, var(--primary-light, rgba(30,64,175,0.06)), var(--card))',
      border: '1px solid var(--border)',
      borderRadius: 10,
      marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.9rem' }}>⚡ Business type <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>sets up to a dozen settings to match your workflow</span></strong>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Pick this first. Every setting below is still editable.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
        {Object.entries(BUSINESS_PRESETS).map(([key, preset]) => {
          const active = settings.activeBusinessPresetId === key;
          return (
            <button key={key} type="button"
              onClick={() => onApply(key)}
              style={{
                padding: '0.65rem 0.7rem',
                border: active ? '2px solid var(--primary)' : '1px solid var(--border)',
                borderRadius: 8,
                background: active ? 'var(--primary-light, rgba(30,64,175,0.08))' : 'var(--card)',
                cursor: 'pointer', textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: '3px',
                transition: 'all 0.15s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                <strong style={{ fontSize: '0.82rem' }}>{preset.label}</strong>
                {active && <span style={{ fontSize: '0.62rem', color: 'var(--primary)', fontWeight: 700 }}>ACTIVE</span>}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>{preset.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// v1.10.36 — Info banner shown when a business preset is active,
// explaining that some options are hidden as irrelevant to the
// picked workflow. Users can un-pick the preset to see the full
// menu.
//
// Props:
//   hiddenHint — the pre-built hint JSX (built by the parent, which owns
//                the BUSINESS_PRESETS lookup for the label)
//   onShowAll  — clears the active business preset
export function HiddenOptionsBanner({ hiddenHint, onShowAll }) {
  if (!hiddenHint) return null;
  return (
    <div style={{ padding: '0.55rem 0.85rem', background: 'var(--primary-light, rgba(30,64,175,0.06))', border: '1px solid var(--border)', borderRadius: 8, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.85rem' }}>ℹ</span>
      {hiddenHint}
      <button type="button" className="btn btn-secondary"
        style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', marginLeft: 'auto' }}
        onClick={onShowAll}
        title="Clear business type to see every option regardless of relevance">
        Show all options
      </button>
    </div>
  );
}
