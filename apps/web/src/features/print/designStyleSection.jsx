import { toast } from '../../components/ui/Toast';
import { DESIGN_PRESETS } from './designPresets';

// v1.9.9 — Design preset picker. One-click starting point; every
// setting below still fully editable. Shows a filled swatch strip
// so the user can eyeball the vibe before committing.
//
// Props:
//   settings — current print settings (activePresetId drives the highlight)
//   onApply  — (preset) => parent merges preset.settings + saves + toasts
export function DesignStyleSection({ settings, onApply }) {
  return (
    <div style={{
      padding: '0.85rem 1rem',
      background: 'linear-gradient(135deg, var(--bg-secondary), var(--card))',
      border: '1px solid var(--border)',
      borderRadius: 10,
      marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.9rem' }}>🎨 Visual style <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 }}>colours + typography for PDF & thermal</span></strong>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Click a design to start. Edit anything below.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
        {DESIGN_PRESETS.map(preset => {
          // v1.9.13 — Multiple presets share the same pdfTemplate value
          // (e.g. Modern, Colorful, and Enterprise all use pdfTemplate:
          // 'modern'). Comparing on pdfTemplate lit up all of them at
          // once. Track a distinct activePresetId instead.
          const active = settings.activePresetId === preset.id;
          // v1.10.36 — Mini-invoice mockup instead of the old 3-color
          // bar. Uses the actual palette + font family the preset would
          // apply, so users can eyeball the vibe (header band, business
          // name in accent/primary, body rows in muted, total pill) in
          // the preset's own colour language before clicking. Font
          // family switches between mono + sans matching the preset so
          // Editorial and Monoline read like receipts, Aurora + Nordic
          // read like SaaS invoices.
          const s = preset.settings;
          const isMono = s.fontFamily === 'mono';
          const mockupFont = isMono
            ? '"Courier New", ui-monospace, monospace'
            : 'system-ui, -apple-system, "Segoe UI", sans-serif';
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApply(preset)}
              style={{
                padding: 0,
                border: active ? '2px solid var(--primary)' : '1px solid var(--border)',
                borderRadius: 10,
                background: active ? 'var(--primary-light, rgba(30,64,175,0.06))' : 'var(--card)',
                cursor: 'pointer',
                textAlign: 'left',
                overflow: 'hidden',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                boxShadow: active ? '0 4px 14px rgba(30,64,175,0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
              title={preset.description}
            >
              {/* Mini invoice mockup — actual palette + font family */}
              <div style={{
                height: 110,
                background: s.pdfHeaderBg || '#ffffff',
                padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 6,
                fontFamily: mockupFont,
                borderBottom: `1px solid ${s.pdfDividerColor || '#e5e5e5'}`,
              }}>
                {/* Header row: business name + INVOICE label */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: s.pdfPrimaryText || '#0f172a',
                    letterSpacing: s.allCaps || s.headerCaps ? '0.05em' : '0',
                    textTransform: (s.allCaps || s.headerCaps) ? 'uppercase' : 'none',
                  }}>BUSINESS</span>
                  <span style={{
                    fontSize: 8, fontWeight: 700,
                    color: s.pdfAccent || '#1e40af',
                    letterSpacing: '0.08em',
                  }}>INVOICE</span>
                </div>
                {/* Accent divider */}
                <div style={{ height: 2, background: s.pdfAccent || '#1e40af', width: '35%' }} />
                {/* Body rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ height: 4, background: s.pdfMutedText || '#94a3b8', width: '55%', borderRadius: 1, opacity: 0.6 }} />
                    <div style={{ height: 4, background: s.pdfMutedText || '#94a3b8', width: '18%', borderRadius: 1, opacity: 0.6 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ height: 4, background: s.pdfMutedText || '#94a3b8', width: '45%', borderRadius: 1, opacity: 0.4 }} />
                    <div style={{ height: 4, background: s.pdfMutedText || '#94a3b8', width: '15%', borderRadius: 1, opacity: 0.4 }} />
                  </div>
                </div>
                {/* Total pill — accent bg + accentText for legibility */}
                <div style={{
                  marginTop: 'auto', alignSelf: 'flex-end',
                  background: s.pdfAccent || '#1e40af',
                  color: s.pdfAccentText || '#ffffff',
                  fontSize: 8, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 3,
                  letterSpacing: '0.04em',
                }}>TOTAL ₹1,250</div>
              </div>

              {/* Label + tag row */}
              <div style={{ padding: '0.55rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                    <span style={{ marginRight: 5, opacity: 0.7 }}>{preset.icon}</span>
                    {preset.name}
                  </span>
                  {active && <span style={{ fontSize: '0.6rem', color: 'var(--primary)', fontWeight: 700, letterSpacing: '0.04em' }}>ACTIVE</span>}
                </div>
                {preset.tag && (
                  <span style={{
                    fontSize: '0.6rem', color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
                  }}>{preset.tag}</span>
                )}
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>{preset.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The success toast text is part of the section's contract (the parent's
// onApply would otherwise need to know preset names); kept here so the
// parent's apply stays a plain merge + save.
export const designPresetToast = (preset) => toast(`Applied "${preset.name}" design — every setting still editable below`, 'success');
