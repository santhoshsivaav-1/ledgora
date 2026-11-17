import { Info } from 'lucide-react';
import InvoicePreview from './InvoicePreview';

// v1.9.8 — Sticky preview pane. Stays in view while user scrolls
// settings on the left. Tab toggle at top switches between the
// PDF (A4) and Thermal (80mm) render. Split view shows both.
//
// Props:
//   previewMode            — 'pdf' | 'thermal' | 'both'
//   onPreviewModeChange    — (mode) => setState in the parent
//   sample                 — buildSampleInvoice(profile) result
//   previewInvoiceOptions  — the thermal-option mapping built by the parent
//   previewRef             — forwarded to the InvoicePreview that test-print captures
export function PreviewPane({ previewMode, onPreviewModeChange, sample, previewInvoiceOptions, previewRef }) {
  return (
    <div className="print-settings-preview-pane" style={{
      position: 'sticky', top: '1rem',
      maxHeight: 'calc(100vh - 2rem)',
      padding: '1rem',
      background: 'var(--bg-secondary)',
      borderRadius: 8,
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: '0.9rem' }}>
          <Info size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 5 }} />
          Live preview
        </strong>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Updates as you type</span>
      </div>

      {/* Preview mode tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--card)', padding: '0.25rem', borderRadius: 6 }}>
        {[
          ['pdf', '📄 PDF (A4)'],
          ['thermal', '🖨 Thermal (80mm)'],
          ['both', '⊞ Split view'],
        ].map(([key, label]) => (
          <button key={key} type="button"
            onClick={() => onPreviewModeChange(key)}
            style={{
              flex: 1, padding: '0.35rem', border: 'none', borderRadius: 4,
              background: previewMode === key ? 'var(--primary)' : 'transparent',
              color: previewMode === key ? '#fff' : 'var(--text)',
              fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Preview canvas — scrolls internally so left settings scroll independently.
          CSS transform: scale doesn't shrink the layout box, so we wrap the
          scaled invoice in a container sized to the post-scale dimensions.
          Otherwise the 210mm A4 pushes out of the pane and content clips. */}
      <div style={{ overflow: 'auto', flex: 1, background: '#fff', padding: '0.75rem', borderRadius: 6, minHeight: 200 }}>
        {previewMode === 'both' ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ zoom: 0.42, minWidth: 0 }}>
              <InvoicePreview
                profile={sample.profile}
                client={sample.client}
                details={sample.details}
                items={sample.items}
                totals={sample.totals}
                invoiceType={sample.invoiceType}
                options={{ ...previewInvoiceOptions, paperSize: 'a4' }}
                customTerms="" customNotes="" extraSections={[]}
              />
            </div>
            <div style={{ zoom: 0.85, minWidth: 0 }}>
              <InvoicePreview
                profile={sample.profile}
                client={sample.client}
                details={sample.details}
                items={sample.items}
                totals={sample.totals}
                invoiceType={sample.invoiceType}
                options={{ ...previewInvoiceOptions, paperSize: 'thermal80' }}
                customTerms="" customNotes="" extraSections={[]}
              />
            </div>
          </div>
        ) : previewMode === 'pdf' ? (
          <div style={{ zoom: 0.5, minWidth: 0 }}>
            <InvoicePreview
              ref={previewRef}
              profile={sample.profile}
              client={sample.client}
              details={sample.details}
              items={sample.items}
              totals={sample.totals}
              invoiceType={sample.invoiceType}
              options={{ ...previewInvoiceOptions, paperSize: 'a4' }}
              customTerms="" customNotes="" extraSections={[]}
            />
          </div>
        ) : (
          <div style={{ margin: '0 auto', width: 'fit-content' }}>
            <InvoicePreview
              ref={previewRef}
              profile={sample.profile}
              client={sample.client}
              details={sample.details}
              items={sample.items}
              totals={sample.totals}
              invoiceType={sample.invoiceType}
              options={{ ...previewInvoiceOptions, paperSize: 'thermal80' }}
              customTerms="" customNotes="" extraSections={[]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
