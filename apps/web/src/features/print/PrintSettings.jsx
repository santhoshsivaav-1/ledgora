import { useState, useEffect, useRef } from 'react';
import { Printer, TestTube, RotateCcw } from 'lucide-react';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { getProfile } from '../../lib/data';
import { DEFAULT_PRINT_SETTINGS, getPrintSettings, savePrintSettings, buildSampleInvoice, BUSINESS_PRESETS, applyBusinessPreset } from './printSettingsStore';
import HelpButton from '../../components/ui/HelpButton';
import { BusinessTypeSection, HiddenOptionsBanner } from './businessTypeSection';
import { DesignStyleSection, designPresetToast } from './designStyleSection';
import { ThermalSettingsSection } from './thermalSettingsSection';
import { PdfFeaturesSection } from './pdfFeaturesSection';
import {
  PdfStyleEditorSection, SectionLabelsSection, FormattingSection,
  RowDensitySection, CustomTaxRatesSection, SavedTemplatesSection, confirmTemplateLoad,
} from './generalSections';
import { RoundOffSetting } from './settingControls';
import { PreviewPane } from './previewPane';
import { captureAndPrintThermal } from './testPrint';
import { getActiveBusinessPresetId, isRecommendedForActive, isVisibleFor } from './businessGate';

// ============================================================================
// Print Settings — app-wide defaults for the thermal printer render.
// Persisted to localStorage key `gst_printSettings`. InvoicePreview merges
// these with per-invoice overrides from invoiceOptions.
//
// Per user feedback (v1.8.3): existing thermal output had inconsistent
// darkness (some gray, some black), Large font size didn't scale properly,
// and users need dedicated controls to match their specific printer.
// Reference receipts from SMART BAZAAR / Reliance show the ideal style:
//   ALL CAPS · BOLD everywhere · consistent dark ink · monospace font
//
// v-split — the section bodies live in sibling files next to this one:
//   designPresets.js / businessTypeSection.jsx / designStyleSection.jsx /
//   thermalSettingsSection.jsx / pdfFeaturesSection.jsx / generalSections.jsx /
//   previewPane.jsx / testPrint.js / settingControls.jsx / businessGate.js
// This file keeps the state, the shared `set()` writer and the page shell.
// ============================================================================

export default function PrintSettings() {
  const [settings, setSettings] = useState(getPrintSettings);
  const [showTestPreview, setShowTestPreview] = useState(false);
  const [profile, setProfile] = useState(null);
  const previewRef = useRef(null);
  // v1.9.8 — preview mode toggle so users see the right layout for the
  // change they're making. Sticky preview on the right stays in view as
  // they scroll settings on the left.
  const [previewMode, setPreviewMode] = useState('pdf'); // 'pdf' | 'thermal' | 'both'

  useEffect(() => { getProfile().then(setProfile).catch(() => {}); }, []);

  const set = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePrintSettings(next);
  };

  const activeBiz = getActiveBusinessPresetId(settings);
  const recommendFor = (list) => isRecommendedForActive(activeBiz, list);
  const visibleFor = (list) => isVisibleFor(activeBiz, list);
  // Reusable "hidden by business type" note so users understand WHY an
  // option isn't there when their picked preset doesn't need it.
  const HIDDEN_HINT = activeBiz ? (
    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
      Some options are hidden because they don't apply to your "{BUSINESS_PRESETS[activeBiz]?.label}" workflow. Change or clear the business type above to see everything.
    </span>
  ) : null;

  const reset = () => {
    setSettings({ ...DEFAULT_PRINT_SETTINGS });
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS });
    toast('Print settings reset to defaults', 'info');
  };

  const runTestPrint = () => {
    // Render a sample invoice with current settings, then trigger browser print.
    setShowTestPreview(true);
    // Wait for React to render the preview + fonts to load, then generate PDF.
    setTimeout(async () => {
      try {
        if (!previewRef.current) { toast('Preview not ready', 'error'); return; }
        const bufSafe = !!settings.thermalBufferSafe;
        await captureAndPrintThermal(previewRef.current, bufSafe);
        toast('Test print sent to your default printer', 'success');
      } catch (e) {
        console.error('Test print failed', e);
        toast('Test print failed — try Download PDF instead', 'error');
      }
    }, 300);
  };

  // Build the invoiceOptions that flows into the InvoicePreview for the test
  // preview. All the user's chosen print settings map into the thermal-specific
  // invoiceOptions fields that InvoicePreview already reads.
  const previewInvoiceOptions = {
    paperSize: 'thermal80',
    showGST: true,
    showBankDetails: settings.showBankDetails,
    showUPI: settings.showUPI,
    showAmountWords: settings.showAmountWords,
    showTerms: false, showNotes: false,
    thermalFontSize: settings.fontSize,
    thermalCompact: !settings.showRateLine && !settings.showHSN,
    thermalCutMark: settings.cutMark,
    // Custom fields wired in the InvoicePreview thermal render
    thermalFontFamily: settings.fontFamily,
    thermalFontWeight: settings.fontWeight,
    thermalAllCaps: settings.allCaps,
    thermalLineSpacing: settings.lineSpacing,
    thermalContrast: settings.contrast,
    thermalHeaderAlign: settings.headerAlign,
    thermalHeaderCaps: settings.headerCaps,
    thermalShowLogo: settings.showLogo,
    thermalShowHSN: settings.showHSN,
    thermalShowRate: settings.showRateLine,
    thermalQrSize: settings.qrSize,
    thermalFooterMessage: settings.footerMessage,
    thermalFeedLines: settings.feedLines,
    thermalTagline: settings.showTagline ? settings.tagline : '',
  };

  const sample = buildSampleInvoice(profile);

  // v1.10.36 — applying a business preset overwrites a dozen settings at
  // once, so it asks first; undo is "Reset defaults".
  const applyBusinessType = async (key) => {
    const preset = BUSINESS_PRESETS[key];
    if (!await confirmAction({
      title: `Apply "${preset.label}" preset?`,
      message: `This will overwrite ${Object.keys(preset.patch).length} print settings on top of your current setup. You can undo by picking "Reset defaults".`,
      confirmLabel: 'Apply preset',
      tone: 'warning',
    })) return;
    const next = { ...applyBusinessPreset(settings, key), activeBusinessPresetId: key };
    setSettings(next);
    savePrintSettings(next);
    toast(`Applied "${preset.label}" preset`, 'success');
  };

  // Applying a design preset just seeds the palette/typography; everything
  // stays editable (merge semantics identical to the old inline handler).
  const applyDesignPreset = (preset) => {
    const next = { ...settings, ...preset.settings, activePresetId: preset.id };
    setSettings(next); savePrintSettings(next);
    designPresetToast(preset);
  };

  // Loading a saved template replaces the whole settings object, so it
  // bypasses `set()` and asks before clobbering.
  const loadTemplate = async (tpl) => {
    if (!await confirmTemplateLoad(tpl)) return;
    setSettings(tpl.settings);
    savePrintSettings(tpl.settings);
    toast(`Loaded "${tpl.name}"`, 'success');
  };

  return (
    <div className="glass-panel p-6 mb-6">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h3 className="section-title" style={{ marginTop: 0, marginBottom: '0.25rem' }}>
            <Printer size={18} style={{ display: 'inline', verticalAlign: -3, marginRight: 6 }} />
            Print & PDF Settings
            <span style={{ marginLeft: 6, verticalAlign: -2, display: 'inline-block' }}>
              <HelpButton title="Print & PDF settings — how to use" doc="print-settings" size={16}>
                <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
                  <li><strong>Business type</strong> sets up to a dozen settings for your kind of business in one click.</li>
                  <li><strong>Visual style</strong> picks a design; everything below fine-tunes it.</li>
                  <li>Changes save as you make them; the live preview shows the result.</li>
                  <li>Each invoice can still change its own options under Customize.</li>
                </ul>
              </HelpButton>
            </span>
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            App-wide defaults for every printed / PDF invoice. 70+ settings — every one dynamic. Each invoice can override via its Customize panel.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }}
            onClick={() => {
              const next = { ...settings, onboardingComplete: false };
              setSettings(next); savePrintSettings(next);
              toast('Setup wizard will re-open on next page reload', 'info');
            }}
            title="Show the first-run wizard again">
            🚀 Run setup wizard
          </button>
          <button className="btn btn-secondary" style={{ fontSize: '0.82rem' }} onClick={reset}>
            <RotateCcw size={14} /> Reset defaults
          </button>
          <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} onClick={runTestPrint}>
            <TestTube size={14} /> Test Print
          </button>
        </div>
      </div>

      {/* v1.9.8 — Split layout: settings scroll on the left, preview stays sticky on the right */}
      <div className="print-settings-layout" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 460px)',
        gap: '1.25rem',
        marginTop: '1.25rem',
        alignItems: 'flex-start',
      }}>
        <div className="print-settings-body" style={{ minWidth: 0 }}>

          <BusinessTypeSection settings={settings} onApply={applyBusinessType} />
          <HiddenOptionsBanner hiddenHint={HIDDEN_HINT} onShowAll={() => set({ activeBusinessPresetId: '' })} />
          <DesignStyleSection settings={settings} onApply={applyDesignPreset} />

          <ThermalSettingsSection settings={settings} set={set} />

          <PdfFeaturesSection
            settings={settings} set={set}
            isRecommendedForActive={recommendFor} isVisibleFor={visibleFor} />

          <PdfStyleEditorSection settings={settings} set={set} />

          {/* v1.10.36 — DELETED the duplicate business-type-preset block that
               lived here. Was rendering the same picker twice — once buried
               way down, once (as of v1.10.36) hoisted to the top of the
               panel where it belongs. Moved above the Visual style picker
               to establish a "first pick your business, then style" order. */}

          <SectionLabelsSection settings={settings} set={set} />

          <FormattingSection settings={settings} set={set} />

          <RoundOffSetting />

          <RowDensitySection settings={settings} set={set} />

          {/* v1.10.36 — DELETED the duplicate "Custom watermark text"
               section. Its two controls (watermarkUseCustomText + custom
               text input) are now inside the master Watermark SettingGroup
               in pdfFeaturesSection.jsx, gated by `watermarkEnabled` so users
               can't turn on custom text without also turning on the master
               toggle. Kills the cross-panel bug the v1.10.10 comment referenced. */}

          <CustomTaxRatesSection settings={settings} set={set} />

          {/* v1.10.5 — audit M25. Three unwired UI sections deleted here:
               * "Custom fields (default on every invoice)" — customInvoiceFields
                 was saved but never rendered on the invoice.
               * "Items table column widths" — columnWidths were saved but no
                 code applied them to .inv-table columns.
               * "Payment reminder scheduling" (below saved-templates) —
                 reminderTemplate + reminderDaysAfter* had no send-side wiring.
             The setting defaults stay in printSettings.js so existing
             localStorage payloads still parse (extra keys are ignored). If
             someone wants these features, the settings shape is ready — the
             missing piece is the consumer code. */}

          <SavedTemplatesSection settings={settings} set={set} onLoadTemplate={loadTemplate} />

          {/* v1.10.5 — reminder-scheduling UI removed. See M25 audit note
               above the SAVED TEMPLATES section. Notification bell still
               surfaces overdue bills using `reminderEnabled` alone. */}

        </div>{/* end .print-settings-body */}

        <PreviewPane
          previewMode={previewMode}
          onPreviewModeChange={setPreviewMode}
          sample={sample}
          previewInvoiceOptions={previewInvoiceOptions}
          previewRef={previewRef} />
      </div>{/* end .print-settings-layout */}

      {/* Hidden preview for the actual test-print rendering */}
      {showTestPreview && null}
    </div>
  );
}
