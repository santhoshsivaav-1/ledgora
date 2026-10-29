import { Settings } from 'lucide-react';
import { TERMS_PRESETS, htmlHasText } from '../../../utils';
import { confirmAction } from '../../../components/ui/ConfirmModal';
import InvoicePreview from '../../print/InvoicePreview';
import { toast } from '../../../components/ui/Toast';
import RichEditor from './RichEditor';

// Terms and conditions, with templates and presets.
export default function TermsPanel({
  _psPrintForRates, customNotes, customTerms, handleTermsSelect, internalNote, invoiceOptions, selectedTermsId, setCustomNotes, setCustomTerms, setInternalNote, setInvoiceOptions, setSelectedTermsId, termsTemplates,
}) {
  return (
          <div className="glass-panel p-6 mb-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Terms & Conditions</h3>
              {/* v1.10.37 — Terms rendering mode picker. Reported: PDF was
                  showing terms as compact all-caps run-together block —
                  users wanted an option for normal formatted output too.
                  Compact = tiny 0.6rem, honours global allCaps, saves
                  paper on invoices where terms are boilerplate.
                  Formatted = 0.78rem, mixed case, list styles preserved,
                  reads like a document paragraph. */}
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>PDF layout</span>
                {[
                  { id: 'compact', label: 'Compact', hint: 'Tiny footer text — saves paper' },
                  { id: 'formatted', label: 'Formatted', hint: 'Larger readable paragraphs' },
                ].map(mode => {
                  // v1.10.74 - same rule InvoicePreview prints with: per-invoice
                  // choice, then Print Settings, then services -> formatted.
                  const effectiveMode = invoiceOptions.termsFormatMode || _psPrintForRates.termsFormatMode
                    || ((invoiceOptions.invoiceMode || 'goods') === 'services' ? 'formatted' : 'compact');
                  const active = effectiveMode === mode.id;
                  return (
                    <button key={mode.id} type="button"
                      onClick={() => setInvoiceOptions(prev => ({ ...prev, termsFormatMode: mode.id }))}
                      title={mode.hint}
                      style={{
                        fontSize: '0.72rem', fontWeight: 600,
                        padding: '0.28rem 0.65rem', borderRadius: 999,
                        background: active
                          ? 'linear-gradient(135deg, var(--primary), var(--primary-darker))'
                          : 'var(--bg-secondary)',
                        color: active ? '#fff' : 'var(--text)',
                        border: active ? '1px solid transparent' : '1px solid var(--border)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}>
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: termsTemplates.length > 0 ? '1fr 1fr' : '1fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Insert preset (by business type)</label>
                <select className="form-input" defaultValue=""
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    const preset = TERMS_PRESETS.find(p => p.id === e.target.value);
                    if (!preset) return;
                    // P2 #33 — "never ask again" via sessionStorage flag.
                    // Users iterating through 3 presets to compare shouldn't
                    // see 3 confirm dialogs. Ask once per session; subsequent
                    // presets swap silently until they close the tab.
                    if (htmlHasText(customTerms)) {
                      const skipConfirm = sessionStorage.getItem('gst_termsPresetConfirmed') === '1';
                      if (!skipConfirm) {
                        const proceed = await confirmAction({
                          title: 'Replace current Terms?',
                          message: 'Your existing Terms text will be lost. Subsequent preset swaps this session will happen silently — this confirmation is shown once.',
                          confirmLabel: 'Replace',
                          tone: 'warning',
                        });
                        if (!proceed) { e.target.value = ''; return; }
                        try { sessionStorage.setItem('gst_termsPresetConfirmed', '1'); } catch { /* ignore */ }
                      }
                    }
                    setCustomTerms(preset.body);
                    setSelectedTermsId('');
                    e.target.value = '';
                    if (preset.body) toast(`Inserted "${preset.label}" preset`, 'success');
                  }}>
                  <option value="">— Pick a business type —</option>
                  {TERMS_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <small style={{ color: '#94a3b8', fontSize: '0.7rem' }}>India-specific starter wording. Edit freely.</small>
              </div>
              {termsTemplates.length > 0 && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Load saved template</label>
                  <select className="form-input" value={selectedTermsId} onChange={(e) => handleTermsSelect(e.target.value)}>
                    <option value="">— Custom —</option>
                    {termsTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Terms (appears on invoice — supports rich formatting)</label>
              <RichEditor toolbar value={customTerms}
                onChange={(v) => { setCustomTerms(v); setSelectedTermsId(''); }}
                placeholder="Enter or paste your terms & conditions..." />
            </div>
            <div className="form-group">
              <label className="form-label">Notes / Remarks (optional)</label>
              <RichEditor toolbar value={customNotes}
                onChange={(v) => setCustomNotes(v)}
                placeholder="Project details, special instructions, additional notes..." />
            </div>
            <div className="form-group" style={{ background: '#fefce8', border: '1px dashed #ca8a04', borderRadius: 8, padding: '0.75rem 1rem' }}>
              <label className="form-label" style={{ color: '#92400e', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v4m0 4h.01"/></svg>
                Private Note (not shown on invoice)
              </label>
              <textarea rows="2" className="form-input note-textarea" value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                style={{ fontSize: '0.82rem' }}
                placeholder="e.g. Client asked for 15-day credit, follow up on 20th, referred by Ravi..." />
            </div>
          </div>
  );
}
