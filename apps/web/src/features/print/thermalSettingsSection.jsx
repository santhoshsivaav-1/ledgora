import { BUSINESS_PRESETS } from './printSettingsStore';
import { getActiveBusinessPresetId, isVisibleFor } from './businessGate';
import { SettingGroup, SelectRow, ToggleRow, TextRow } from './settingControls';

// v1.10.36 — Reported: "if I have selected freelance why it is
// still showing me retails or other option ... thermal etc
// should also hide according to business type". This entire
// thermal-typography/layout/content/footer block is hidden for
// A4-first businesses (freelancer / service / manufacturer /
// wholesale). Retail + restaurant see it. When no biz preset is
// picked, everyone sees it.
//
// Props:
//   settings — current print settings object
//   set      — (patch) => merge patch into settings + save
export function ThermalSettingsSection({ settings, set }) {
  const activeBiz = getActiveBusinessPresetId(settings);
  return (
    <>
      {isVisibleFor(activeBiz, ['retail_shop', 'restaurant']) ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {/* TYPOGRAPHY — thermal-only since v1.10.9 */}
          <SettingGroup title="Typography (Thermal receipts)">
            <SelectRow label="Font family" value={settings.fontFamily} onChange={v => set({ fontFamily: v })}
              options={[
                ['mono', 'Monospace (Courier) — thermal-optimized'],
                ['sans', 'Sans-serif (Arial-like)'],
              ]}
              hint="Applies to THERMAL receipts only. For A4/A5 PDFs use the 'PDF FONT FAMILY' section below." />
            <SelectRow label="Font size" value={settings.fontSize} onChange={v => set({ fontSize: v })}
              options={[
                ['small', 'Small (fits more per receipt)'],
                ['medium', 'Medium (recommended)'],
                ['large', 'Large'],
                ['xlarge', 'Extra Large (easier for older customers)'],
              ]} />
            <SelectRow label="Font weight" value={settings.fontWeight} onChange={v => set({ fontWeight: v })}
              options={[
                ['normal', 'Normal'],
                ['bold', 'Bold (recommended)'],
                ['ultra', 'Ultra bold (darkest print)'],
              ]}
              hint="Thermal print heads render bold weights much darker than normal — pick bold or ultra for consistent legibility." />
            <ToggleRow label="ALL CAPS mode" value={settings.allCaps} onChange={v => set({ allCaps: v })}
              hint="Renders every text element in UPPERCASE — matches the SMART BAZAAR / Reliance receipt style. Best for high legibility." />
          </SettingGroup>

          {/* LAYOUT */}
          <SettingGroup title="Layout">
            <SelectRow label="Line spacing" value={settings.lineSpacing} onChange={v => set({ lineSpacing: v })}
              options={[
                ['compact', 'Compact (save paper)'],
                ['normal', 'Normal'],
                ['comfortable', 'Comfortable (easier to read)'],
              ]} />
            <SelectRow label="Header alignment" value={settings.headerAlign} onChange={v => set({ headerAlign: v })}
              options={[
                ['center', 'Center (default)'],
                ['left', 'Left-aligned'],
              ]} />
            {/* v1.10.36 — renamed from "Print contrast" — the internal
                `contrast` label + normal/high/ultra options were jargon.
                Users think of thermal fade as "darkness", not "contrast",
                so the label + option names now match the mental model. */}
            <SelectRow label="Thermal ink darkness" value={settings.contrast} onChange={v => set({ contrast: v })}
              options={[
                ['normal', 'Standard'],
                ['high', 'Dark (recommended for older printers)'],
                ['ultra', 'Extra-dark (max)'],
              ]}
              hint="Applies grayscale + contrast filter to logo / QR so faded prints come out darker." />
            <ToggleRow label="Force ALL CAPS in header" value={settings.headerCaps} onChange={v => set({ headerCaps: v })}
              hint="Business name always uppercase (independent of ALL CAPS mode)." />
          </SettingGroup>

          {/* CONTENT */}
          <SettingGroup title="Content">
            <ToggleRow label="Show business logo" value={settings.showLogo} onChange={v => set({ showLogo: v })} />
            <ToggleRow label="Show HSN code per item" value={settings.showHSN} onChange={v => set({ showHSN: v })}
              hint="Required for GST compliance if you're printing tax invoices. Turn off for informal counter receipts." />
            <ToggleRow label='Show "Qty × Rate" line per item' value={settings.showRateLine} onChange={v => set({ showRateLine: v })} />
            <ToggleRow label="Show amount in words" value={settings.showAmountWords} onChange={v => set({ showAmountWords: v })} />
            <ToggleRow label="Show bank details" value={settings.showBankDetails} onChange={v => set({ showBankDetails: v })} />
            <ToggleRow label="Show UPI QR code" value={settings.showUPI} onChange={v => set({ showUPI: v })} />
            {settings.showUPI && (
              <SelectRow label="UPI QR size" value={settings.qrSize} onChange={v => set({ qrSize: v })}
                options={[
                  ['small', 'Small (60 × 60 px)'],
                  ['medium', 'Medium (90 × 90 px)'],
                  ['large', 'Large (120 × 120 px)'],
                ]} />
            )}
          </SettingGroup>

          {/* FOOTER */}
          <SettingGroup title="Footer">
            <TextRow label="Custom footer message" value={settings.footerMessage} onChange={v => set({ footerMessage: v })}
              placeholder="Thank you for your business!"
              hint='Appears above the cut mark. Leave blank to hide.' />
            <ToggleRow label='Show cut mark ("✂ cut here")' value={settings.cutMark} onChange={v => set({ cutMark: v })}
              hint="For thermal printers without auto-cutters. Turn off if your printer feeds paper automatically." />
            <SelectRow label="Feed lines after cut" value={String(settings.feedLines)} onChange={v => set({ feedLines: parseInt(v, 10) })}
              options={[['0', 'No extra feed'], ['1', '1 line'], ['2', '2 lines (default)'], ['3', '3 lines'], ['4', '4 lines'], ['6', '6 lines']]}
              hint="Extra blank lines after the cut mark so the tear is clean." />
            <ToggleRow label="Show tagline" value={settings.showTagline} onChange={v => set({ showTagline: v })}
              hint="Optional tagline printed below business name." />
            {settings.showTagline && (
              <TextRow label="Tagline text" value={settings.tagline} onChange={v => set({ tagline: v })}
                placeholder="e.g. Fresh & Local Since 2010" />
            )}
          </SettingGroup>
        </div>
      ) : (
        /* v1.10.36 — Thermal block hidden for non-thermal presets.
           Show a subtle note so the user knows it's not missing. */
        <div style={{ padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          🖨 Thermal receipt settings (font, cut mark, feed lines, contrast) are hidden — the <strong>{BUSINESS_PRESETS[activeBiz]?.label}</strong> preset uses A4/A5 PDFs. Switch business type above if you also print thermal receipts.
        </div>
      )}
    </>
  );
}
