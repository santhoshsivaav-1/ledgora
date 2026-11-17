import { confirmAction } from '../../components/ui/ConfirmModal';
import { LABEL_PRESETS } from './printSettingsStore';
import { ToggleRow, SelectRow, TextRow, ColorRow, CustomListEditor, SavedTemplatesEditor } from './settingControls';

// ============================================================
// v1.9.2 — PDF STYLE EDITOR (full color control)
// ============================================================
export function PdfStyleEditorSection({ settings, set }) {
  return (
    <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--primary)' }}>
            🎨 PDF Style Editor — full control over every colour
          </h4>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            Match your brand. Every colour you change updates the live preview instantly and gets baked into your PDFs.
          </p>
        </div>
        <ToggleRow label="Use custom colours" value={settings.userColorsEnabled} onChange={v => set({ userColorsEnabled: v })} />
      </div>

      {settings.userColorsEnabled && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
          <ColorRow label="Primary text" value={settings.pdfPrimaryText || '#0f172a'} onChange={v => set({ pdfPrimaryText: v })}
            hint="Main body text — client name, item names, totals." />
          <ColorRow label="Muted text" value={settings.pdfMutedText || '#334155'} onChange={v => set({ pdfMutedText: v })}
            hint="Labels, addresses, meta info (Date, Invoice #)." />
          <ColorRow label="Accent colour" value={settings.pdfAccent || '#1e40af'} onChange={v => set({ pdfAccent: v })}
            hint="Section titles + table header background." />
          <ColorRow label="Accent text" value={settings.pdfAccentText || '#ffffff'} onChange={v => set({ pdfAccentText: v })}
            hint="Text on the accent colour (usually white on a coloured header)." />
          <ColorRow label="Header background" value={settings.pdfHeaderBg || '#f8fafc'} onChange={v => set({ pdfHeaderBg: v })}
            hint="Header block behind the business name / invoice title." />
          <ColorRow label="Divider lines" value={settings.pdfDividerColor || '#334155'} onChange={v => set({ pdfDividerColor: v })}
            hint="Hairlines between sections + table row borders." />
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              onClick={() => set({
                pdfPrimaryText: '#0f172a', pdfMutedText: '#334155',
                pdfAccent: '#1e40af', pdfAccentText: '#ffffff',
                pdfHeaderBg: '#f8fafc', pdfDividerColor: '#334155',
              })}>
              Reset colours to defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// v1.9.3 — Full user control: label language + per-label overrides
// ============================================================
// -- SECTION LABELS (multi-language + custom text) --
export function SectionLabelsSection({ settings, set }) {
  return (
    <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
        🌐 Section labels — multi-language + custom text
      </h4>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
        Pick a language preset OR override any individual label. Custom text overrides the language preset for that field.
      </p>
      <SelectRow label="Language preset" value={settings.labelLanguage} onChange={v => set({ labelLanguage: v })}
        options={[
          ['en', 'English'],
          ['hi', 'हिन्दी (Hindi)'],
          ['ta', 'தமிழ் (Tamil)'],
          ['mr', 'मराठी (Marathi)'],
          ['bn', 'বাংলা (Bengali)'],
        ]} />
      <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
        <TextRow label='"BILL TO" label' value={settings.labelBillTo} onChange={v => set({ labelBillTo: v })}
          placeholder={LABEL_PRESETS[settings.labelLanguage]?.billTo || LABEL_PRESETS.en.billTo} />
        <TextRow label='"PLACE OF SUPPLY" label' value={settings.labelPlaceOfSupply} onChange={v => set({ labelPlaceOfSupply: v })}
          placeholder={LABEL_PRESETS[settings.labelLanguage]?.placeOfSupply || LABEL_PRESETS.en.placeOfSupply} />
        <TextRow label='"BANK DETAILS" label' value={settings.labelBankDetails} onChange={v => set({ labelBankDetails: v })}
          placeholder={LABEL_PRESETS[settings.labelLanguage]?.bankDetails || LABEL_PRESETS.en.bankDetails} />
        <TextRow label='"AMOUNT IN WORDS" label' value={settings.labelAmountInWords} onChange={v => set({ labelAmountInWords: v })}
          placeholder={LABEL_PRESETS[settings.labelLanguage]?.amountInWords || LABEL_PRESETS.en.amountInWords} />
        <TextRow label='"TERMS & CONDITIONS" label' value={settings.labelTerms} onChange={v => set({ labelTerms: v })}
          placeholder={LABEL_PRESETS[settings.labelLanguage]?.terms || LABEL_PRESETS.en.terms} />
        <TextRow label='"NOTES" label' value={settings.labelNotes} onChange={v => set({ labelNotes: v })}
          placeholder={LABEL_PRESETS[settings.labelLanguage]?.notes || LABEL_PRESETS.en.notes} />
        {/* v1.10.36 — Removed "Authorized Signatory" override row.
            InvoicePreview.jsx never calls getLabel(_, 'authorizedSignatory')
            — the signature block uses a hardcoded label. Row was
            silently doing nothing when users typed in it. */}
      </div>
    </div>
  );
}

// -- FORMATTING (date, number, currency) --
export function FormattingSection({ settings, set }) {
  return (
    <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
        📅 Formatting — date, number, currency
      </h4>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
        <SelectRow label="Date format" value={settings.dateFormat} onChange={v => set({ dateFormat: v })}
          options={[
            ['dd-mon-yyyy', '02 Apr 2026 (Indian)'],
            ['dd-mmm-yyyy', '02-Apr-2026'],
            ['dd-mm-yyyy', '02/04/2026'],
            ['mm-dd-yyyy', '04/02/2026 (US)'],
            ['yyyy-mm-dd', '2026-04-02'],
            ['iso', 'ISO 8601'],
          ]} />
        <SelectRow label="Number grouping" value={settings.numberFormat} onChange={v => set({ numberFormat: v })}
          options={[
            ['indian', '1,00,000.00 (Indian)'],
            ['western', '100,000.00 (Western)'],
            ['european', '100.000,00 (European)'],
          ]} />
        <SelectRow label="Decimal places" value={String(settings.decimalPlaces)} onChange={v => set({ decimalPlaces: parseInt(v, 10) })}
          options={[['0', '0 (no decimals)'], ['2', '2 (default)'], ['3', '3'], ['4', '4']]} />
        <SelectRow label="Currency symbol position" value={settings.currencyPosition} onChange={v => set({ currencyPosition: v })}
          options={[['before', '₹100 (before number)'], ['after', '100₹ (after number)']]} />
      </div>
    </div>
  );
}

// -- ROW DENSITY --
export function RowDensitySection({ settings, set }) {
  return (
    <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
        📏 Row density
      </h4>
      <SelectRow label="Vertical spacing in tables + sections" value={settings.rowDensity} onChange={v => set({ rowDensity: v })}
        options={[
          ['compact', 'Compact — fit more per page'],
          ['normal', 'Normal (default)'],
          ['comfortable', 'Comfortable — easier to read'],
        ]}
        hint="Affects both A4/A5 PDFs and the on-screen preview." />
    </div>
  );
}

// -- CUSTOM TAX RATES --
export function CustomTaxRatesSection({ settings, set }) {
  return (
    <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
        💯 Custom tax rate presets
      </h4>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>
        Built-in rates: 0% · 5% · 12% · 18% · 28%. Add your own (e.g. 3% jewellery, 0.25% diamond, 7.5% custom).
      </p>
      <CustomListEditor
        values={settings.customTaxRates || []}
        onChange={v => set({ customTaxRates: v })}
        placeholder="e.g. 3, 0.25, 7.5"
        hint="Comma-separated numbers. Between 0 and 100." />
    </div>
  );
}

// -- SAVED CUSTOM TEMPLATES --
// `onLoadTemplate` is owned by the parent (it needs the confirm modal +
// direct setSettings/savePrintSettings access to replace the whole object).
export function SavedTemplatesSection({ settings, set, onLoadTemplate }) {
  return (
    <div style={{ marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
        💾 My saved templates
      </h4>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>
        Save your current setup as a named template. Recall any time.
      </p>
      <SavedTemplatesEditor
        templates={settings.savedTemplates || []}
        onChange={v => set({ savedTemplates: v })}
        currentSettings={settings}
        onLoad={onLoadTemplate} />
    </div>
  );
}

// The confirm-dialog text lives here (next to the section that renders the
// button) so the parent only wires the actual load.
export async function confirmTemplateLoad(tpl) {
  return confirmAction({
    title: `Load template "${tpl.name}"?`,
    message: 'This overwrites your current print settings. Save the current setup as a template first if you want to be able to go back.',
    confirmLabel: 'Load template',
    tone: 'warning',
  });
}
