import { SettingGroup, ToggleRow, SelectRow, TextRow, NumInput } from './settingControls';
import { toast } from '../../components/ui/Toast';

// ============================================================
// PDF & UNIVERSAL PRINT FEATURES (v1.9.0)
// ============================================================
// Props (explicit, from PrintSettings):
//   settings                — current print settings object
//   set                     — (patch) => merge patch into settings + save
//   isRecommendedForActive  — (recommendedList) => boolean, built from the
//                             active business preset (see businessGate.js)
//   isVisibleFor            — (relevantList) => boolean, same gate
export function PdfFeaturesSection({ settings, set, isRecommendedForActive, isVisibleFor }) {
  return (
    <div style={{ marginTop: '1.75rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: 'var(--primary)' }}>
        📄 PDF & universal print features
      </h4>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
        Applies to A4 / A5 / Letter / Legal / thermal — every option here is dynamic (turn on / off any time).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>

        {/* AUTO-PRINT */}
        <SettingGroup title="Auto-print">
          <ToggleRow label="Auto-print on save" value={settings.autoPrintOnSave} onChange={v => set({ autoPrintOnSave: v })}
            hint="Send to your default printer immediately after Save & Download PDF. Perfect for POS counters — no manual click needed." />
        </SettingGroup>

        {/* WATERMARK */}
        {/* v1.10.36 — Merged custom-watermark controls (previously in
            their own section ~450 lines below) into this master group.
            Prior split had users toggling on "Use custom text" in one
            place without realising the master "Show watermark" needed
            to be on in the other place. See the deleted duplicate
            section further down + the "warning banner" the v1.10.10
            comment described. */}
        <SettingGroup title="Watermark">
          <ToggleRow label="Show watermark" value={settings.watermarkEnabled} onChange={v => set({ watermarkEnabled: v })}
            hint="Big diagonal stamp across the PDF (e.g. PAID / DUPLICATE / DRAFT)." />
          {settings.watermarkEnabled && (
            <>
              <ToggleRow label="Use custom text instead of preset" value={settings.watermarkUseCustomText}
                onChange={v => set({ watermarkUseCustomText: v })}
                hint="Type your own text below (e.g. 'FOR INTERNAL USE'). Turn off to use the PAID/DUPLICATE/etc. preset picker." />
              {settings.watermarkUseCustomText ? (
                <TextRow label="Custom watermark text" value={settings.watermarkCustomText}
                  onChange={v => set({ watermarkCustomText: v })}
                  placeholder="e.g. FOR INTERNAL USE" />
              ) : (
                <SelectRow label="Watermark text" value={settings.watermarkText} onChange={v => set({ watermarkText: v })}
                  options={[
                    ['PAID', 'PAID'], ['DUPLICATE', 'DUPLICATE'], ['DRAFT', 'DRAFT'],
                    ['OVERDUE', 'OVERDUE'], ['COPY', 'COPY'], ['ORIGINAL', 'ORIGINAL'],
                    ['CANCELLED', 'CANCELLED'], ['REPRINT', 'REPRINT'],
                  ]} />
              )}
              <SelectRow label="Opacity" value={String(settings.watermarkOpacity)} onChange={v => set({ watermarkOpacity: parseInt(v, 10) })}
                options={[['5', 'Very faint (5%)'], ['10', 'Faint (10%)'], ['15', 'Medium (15%)'], ['25', 'Strong (25%)'], ['40', 'Very strong (40%)']]} />
            </>
          )}
        </SettingGroup>

        {/* MULTI-COPY — v1.10.36: goods-invoice-only businesses (whole-
            sale, manufacturer) see this. Freelancer / service / retail
            typically don't need GST Rule 48 multi-copy print. */}
        {isVisibleFor(['wholesale', 'manufacturer']) && (
        <SettingGroup title="Multi-copy (GST rule 48)">
          <ToggleRow label="Print multiple copies with labels" value={settings.multiCopyEnabled} onChange={v => set({ multiCopyEnabled: v })}
            tag={isRecommendedForActive(['wholesale', 'manufacturer']) ? 'Recommended for your business' : null}
            hint="Prints your invoice N times with corner labels (ORIGINAL FOR RECIPIENT / DUPLICATE FOR TRANSPORTER / etc.). GST rule 48 requires 3 copies for goods, 2 for services." />
          {settings.multiCopyEnabled && (
            <SelectRow label="Number of copies" value={String(settings.multiCopyCount)} onChange={v => set({ multiCopyCount: parseInt(v, 10) })}
              options={[['2', '2 (Original + Duplicate — services)'], ['3', '3 (Original + Duplicate + Triplicate — goods)']]} />
          )}
        </SettingGroup>
        )}

        {/* PAGE NUMBERS + HEADER */}
        <SettingGroup title="Multi-page invoices">
          {/* v1.10.74 - the PDF numbers page 2 onwards only; page 1 has no number */}
          <ToggleRow label="Page numbers on pages 2+" value={settings.pageNumbersEnabled} onChange={v => set({ pageNumbersEnabled: v })}
            hint='Shows "Page 2 of 5" bottom-right on pages 2+. The first page is not numbered.' />
          <ToggleRow label="Business name header on pages 2+" value={settings.pageHeaderEnabled} onChange={v => set({ pageHeaderEnabled: v })}
            hint="Repeats your business name at the top so multi-page invoices look professional." />
        </SettingGroup>

        {/* MARGINS */}
        <SettingGroup title="Print margins (mm)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            <NumInput label="Top" value={settings.marginTop} onChange={v => set({ marginTop: v })} />
            <NumInput label="Bottom" value={settings.marginBottom} onChange={v => set({ marginBottom: v })} />
            <NumInput label="Left" value={settings.marginLeft} onChange={v => set({ marginLeft: v })} />
            <NumInput label="Right" value={settings.marginRight} onChange={v => set({ marginRight: v })} />
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
            For users printing on pre-printed letterhead — shift content down to avoid your logo, or in from the edge to fit binding.
          </p>
        </SettingGroup>

        {/* BARCODE + QR */}
        <SettingGroup title="Verification codes">
          <ToggleRow label="Invoice number as QR" value={settings.invoiceQrEnabled} onChange={v => set({ invoiceQrEnabled: v })}
            tag={isRecommendedForActive(['manufacturer', 'wholesale']) ? 'Recommended for your business' : null}
            hint="Prints a QR of the invoice number (or verification URL if set below) in the bottom-right corner." />
          {settings.invoiceQrEnabled && (
            <TextRow label="Verification URL (optional)" value={settings.invoiceQrUrl} onChange={v => set({ invoiceQrUrl: v })}
              placeholder="https://mycompany.com/verify/{invoice_number}"
              hint="{invoice_number} gets replaced with the actual invoice #. Leave blank to encode just the number." />
          )}
          <ToggleRow label="Invoice number as barcode text" value={settings.invoiceBarcodeEnabled} onChange={v => set({ invoiceBarcodeEnabled: v })}
            hint="Prints the invoice number in large monospace at the bottom-left for warehouse scanning / filing." />
        </SettingGroup>

        {/* FEEDBACK QR — v1.10.36: consumer-facing "how was your
            service" QR only meaningful for retail counters and
            restaurants. Freelancer / service / wholesale / manufacturer
            don't send this to their B2B clients. */}
        {isVisibleFor(['retail_shop', 'restaurant']) && (
        <SettingGroup title="Customer feedback QR">
          <ToggleRow label="Feedback / review QR" value={settings.feedbackQrEnabled} onChange={v => set({ feedbackQrEnabled: v })}
            tag={isRecommendedForActive(['retail_shop', 'restaurant']) ? 'Recommended for your business' : null}
            hint="Adds a QR at the bottom-left of the PDF that opens a URL — Google Reviews, feedback form, WhatsApp chat, anything you want." />
          {settings.feedbackQrEnabled && (
            <>
              <TextRow label="URL to encode" value={settings.feedbackQrUrl} onChange={v => set({ feedbackQrUrl: v })}
                placeholder="e.g. https://g.page/r/YOUR_ID/review" />
              <TextRow label="Label above QR" value={settings.feedbackQrLabel} onChange={v => set({ feedbackQrLabel: v })}
                placeholder="Rate us · Give feedback" />
            </>
          )}
        </SettingGroup>
        )}

        {/* DIGITAL SIGNATURE */}
        <SettingGroup title="Digital signature">
          <ToggleRow label="Show signature on invoice" value={settings.signatureShow} onChange={v => set({ signatureShow: v })} />
          {settings.signatureShow && (
            <>
              {settings.signatureImage ? (
                <>
                  <div style={{ padding: '0.5rem', background: '#fff', borderRadius: 4, textAlign: 'center', marginBottom: '0.4rem' }}>
                    <img src={settings.signatureImage} alt="signature" style={{ maxHeight: 60, maxWidth: '100%' }} />
                  </div>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                    onClick={() => set({ signatureImage: '' })}>
                    Remove signature
                  </button>
                </>
              ) : (
                <>
                  <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: 3 }}>Upload signature (PNG / JPG)</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2 * 1024 * 1024) { toast('Image too large (max 2MB)', 'warning'); return; }
                      const reader = new FileReader();
                      reader.onload = (ev) => set({ signatureImage: ev.target.result });
                      reader.readAsDataURL(file);
                    }}
                    style={{ fontSize: '0.78rem' }} />
                </>
              )}
              <TextRow label="Signatory name" value={settings.signatureName} onChange={v => set({ signatureName: v })}
                placeholder="e.g. Rakesh Kumar · Director"
                hint="Falls back to business name if left blank." />
            </>
          )}
        </SettingGroup>

        {/* T&C SEPARATE PAGE */}
        <SettingGroup title="Terms &amp; Conditions">
          <ToggleRow label="Print T&amp;C on a separate page" value={settings.termsSeparatePage} onChange={v => set({ termsSeparatePage: v })}
            hint="For long terms — puts them on page 2 instead of squishing on page 1. Only affects invoices with T&amp;C enabled." />
        </SettingGroup>

        {/* FONT FAMILY (PDF) */}
        <SettingGroup title="PDF font family">
          <SelectRow label="Font used in generated PDFs" value={settings.pdfFontFamily} onChange={v => set({ pdfFontFamily: v })}
            options={[
              ['helvetica', 'Helvetica (default, cleanest)'],
              ['times', 'Times New Roman (traditional / formal)'],
              ['courier', 'Courier (monospace / retro / receipt style)'],
            ]}
            hint="Applies to the letterhead, table, and totals. Affects sheet formats (A4/A5/Letter/Legal); thermal has its own font setting above." />
        </SettingGroup>

        {/* v1.10.11 — COMPACT HEADER + THERMAL BUFFER-SAFE MODE */}
        <SettingGroup title="Layout &amp; printer compatibility">
          <ToggleRow label="Compact upper header (fit more items on page 1)"
            value={settings.headerCompact} onChange={v => set({ headerCompact: v })}
            hint="Shrinks the header, billing block, and Place-of-Supply spacing so the items table starts higher up. Best when your invoices routinely spill to page 2 because of large headers." />
          <ToggleRow label="Thermal buffer-safe mode (for old / low-memory receipt printers)"
            value={settings.thermalBufferSafe} onChange={v => set({ thermalBufferSafe: v })}
            tag={isRecommendedForActive(['retail_shop', 'restaurant']) ? 'Recommended for your business' : null}
            hint="Uses grayscale, drops render scale for thermal captures, and lowers JPEG quality. Helps ₹800–₹2000 thermal printers with small internal buffers avoid stuck B/W print jobs." />
          {/* v1.10.42 — Thermal delivery mode (Direct HTML vs PDF). */}
          <SelectRow label="Thermal print method"
            value={settings.thermalPrintMode || 'direct'}
            onChange={v => set({ thermalPrintMode: v })}
            options={[
              ['direct', 'Direct HTML — sharper, faster (recommended)'],
              ['pdf',    'Via PDF — safer fallback for finicky printers'],
            ]}
            hint="Direct sends invoice text as vector to the printer — 203-dpi thermal renders it sharply. If your printer or browser mis-handles the direct path, switch to Via PDF for the pre-v1.10.42 raster behaviour." />
        </SettingGroup>

        {/* PER-TYPE INVOICE PREFIX OVERRIDES (v1.10.10) */}
        <SettingGroup title="Custom prefix per invoice type">
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
            Leave blank to use the built-in default. Each type has its own atomic counter — changing a prefix starts a fresh count for the new one.
          </p>
          {[
            { key: 'tax-invoice',     label: 'Tax Invoice',       def: 'INV'  },
            { key: 'quotation',       label: 'Quotation',         def: 'QUO'  },
            { key: 'sales-order',     label: 'Sales Order',       def: 'SO'   },
            { key: 'proforma',        label: 'Proforma / Estimate', def: 'EST' },
            { key: 'bill-of-supply',  label: 'Bill of Supply',    def: 'BOS'  },
            { key: 'composition',     label: 'Composition',       def: 'COMP' },
            { key: 'credit-note',     label: 'Credit Note',       def: 'CN'   },
            { key: 'delivery-challan',label: 'Delivery Challan',  def: 'DC'   },
          ].map(({ key, label, def }) => (
            <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: '0.5rem', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '0.82rem' }}>{label}</span>
              <input type="text" className="form-input"
                value={settings.customPrefixes?.[key] || ''}
                onChange={e => set({ customPrefixes: { ...(settings.customPrefixes || {}), [key]: e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) } })}
                placeholder={def} maxLength={8}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem' }} />
            </div>
          ))}
        </SettingGroup>

        {/* REPRINT INDICATOR — v1.10.36: POS-reprint counter only
            meaningful for retail counters (customer wants a duplicate
            of yesterday's bill). B2B invoicing rarely reprints. */}
        {isVisibleFor(['retail_shop', 'restaurant']) && (
        <SettingGroup title="Reprint tracking">
          <ToggleRow label="Show REPRINT badge on reprints" value={settings.reprintLabelEnabled} onChange={v => set({ reprintLabelEnabled: v })}
            tag={isRecommendedForActive(['retail_shop', 'restaurant']) ? 'Recommended for your business' : null}
            hint="Automatic red badge in the top-left of the PDF when an invoice has been printed before. Tracks how many times each bill was printed." />
        </SettingGroup>
        )}

        {/* PRINT QUALITY */}
        <SettingGroup title="PDF quality vs file size">
          <SelectRow label="Print quality" value={settings.pdfQuality} onChange={v => set({ pdfQuality: v })}
            options={[
              ['draft', 'Draft — smallest file (email-friendly)'],
              ['standard', 'Standard — balanced'],
              ['hd', 'HD — sharpest, largest file (default)'],
            ]}
            hint="Draft = ~50% smaller PDFs, fine for emailing. HD = crisper text at 100% zoom, larger file, better for physical archive." />
        </SettingGroup>

        {/* DUAL CURRENCY (foreign clients) — v1.10.36: only relevant
            for freelancer / service businesses billing foreign clients
            in INR + USD/EUR/GBP. Retail/restaurant/wholesale/manuf
            are domestic-only in the vast majority of cases. */}
        {isVisibleFor(['freelancer', 'service']) && (
        <SettingGroup title="Dual currency display">
          <ToggleRow label="Show foreign-currency equivalent" value={settings.dualCurrencyEnabled} onChange={v => set({ dualCurrencyEnabled: v })}
            tag={isRecommendedForActive(['freelancer', 'service']) ? 'Recommended for your business' : null}
            hint="For INR invoices to foreign clients, shows the total in a second currency next to the ₹ amount. Uses YOUR manually set rate — no live conversion." />
          {settings.dualCurrencyEnabled && (
            <>
              <SelectRow label="Secondary currency" value={settings.dualCurrencyCode} onChange={v => set({ dualCurrencyCode: v })}
                options={[
                  ['USD', 'USD ($)'], ['EUR', 'EUR (€)'], ['GBP', 'GBP (£)'],
                  ['AED', 'AED (د.إ)'], ['SGD', 'SGD (S$)'], ['AUD', 'AUD (A$)'], ['JPY', 'JPY (¥)'],
                ]} />
              <NumInput label={`Rate (1 ${settings.dualCurrencyCode} = ? INR)`} value={settings.dualCurrencyRate}
                onChange={v => set({ dualCurrencyRate: v })} min={0.01} max={10000} />
              <SelectRow label="Display position" value={settings.dualCurrencyPosition} onChange={v => set({ dualCurrencyPosition: v })}
                options={[
                  ['below', 'On a line below the ₹ amount'],
                  ['inline', 'Inline in parentheses'],
                ]} />
            </>
          )}
        </SettingGroup>
        )}

        {/* COMPANY LETTERHEAD */}
        <SettingGroup title="Company letterhead">
          <ToggleRow label="Use pre-printed letterhead image" value={settings.letterheadEnabled} onChange={v => set({ letterheadEnabled: v })}
            hint="Upload your own designed letterhead as a full-page background. Invoice content prints on top. Best for businesses with formal branded stationery." />
          {settings.letterheadEnabled && (
            <>
              {settings.letterheadImage ? (
                <>
                  <div style={{ padding: '0.5rem', background: '#fff', borderRadius: 4, textAlign: 'center', marginBottom: '0.4rem' }}>
                    <img src={settings.letterheadImage} alt="letterhead" style={{ maxHeight: 100, maxWidth: '100%' }} />
                  </div>
                  <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                    onClick={() => set({ letterheadImage: '' })}>
                    Remove letterhead
                  </button>
                </>
              ) : (
                <>
                  {/* v1.10.10 — reported: "letterhead not working". Root
                       cause: enabling the toggle without uploading an
                       image left `letterheadImage = ''` which silently
                       does nothing at render time. Warn the user
                       instead of letting them think it's on. */}
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', color: 'var(--warn-text)', borderRadius: 6, fontSize: '0.78rem', marginBottom: '0.6rem' }}>
                    ⚠ Letterhead is enabled but no image is uploaded yet. Upload a PNG or JPG below (A4 recommended, max 3 MB) — the toggle does nothing until an image is set.
                  </div>
                  <label style={{ fontSize: '0.78rem', display: 'block', marginBottom: 3 }}>Upload letterhead (PNG / JPG, A4 recommended)</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 3 * 1024 * 1024) { toast('Image too large (max 3MB)', 'warning'); return; }
                      const reader = new FileReader();
                      reader.onload = (ev) => set({ letterheadImage: ev.target.result });
                      reader.readAsDataURL(file);
                    }}
                    style={{ fontSize: '0.78rem' }} />
                </>
              )}
              <ToggleRow label="Hide invoice header block" value={settings.letterheadHideHeader} onChange={v => set({ letterheadHideHeader: v })}
                hint="When letterhead already has your business info, hide the generated header block to avoid duplication." />
            </>
          )}
        </SettingGroup>

        {/* PDF TEMPLATE STYLE */}
        <SettingGroup title="PDF template style (visual design)">
          <SelectRow label="Template" value={settings.pdfTemplate} onChange={v => set({ pdfTemplate: v })}
            options={[
              ['modern', 'Modern (colorful header · default)'],
              ['classic', 'Classic (professional / conservative)'],
              ['minimal', 'Minimal (clean / whitespace)'],
              ['corporate', 'Corporate (formal blue/navy)'],
              ['minimalist', 'Minimalist (grayscale + Inter)'],
              ['boxed', 'Boxed grid (ruled boxes, like a quotation pad)'],
              ['tally', 'Tally style (order boxes, HSN tax summary, declaration)'],
            ]}
            hint="Changes the header block and table styling of the A4/A5 PDF. Thermal receipts use their own compact template." />
        </SettingGroup>

        {/* v1.9.2 — DARKEN ON PRINT */}
        <SettingGroup title="Print darkness">
          <ToggleRow label="Force darker text on printed PDF" value={settings.pdfDarkenOnPrint} onChange={v => set({ pdfDarkenOnPrint: v })}
            hint="Fixes light-gray labels + addresses fading on paper printers. Applies automatically when generating the PDF (screen view is unchanged). Turn off if your printer already prints greys crisply." />
        </SettingGroup>

        {/* v1.9.2 — FONT SIZE SCALE */}
        <SettingGroup title="PDF font scale">
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
            Overall size: <strong>{Math.round((settings.pdfFontScale || 1) * 100)}%</strong>
          </label>
          <input type="range" min="80" max="140" step="5"
            value={Math.round((settings.pdfFontScale || 1) * 100)}
            onChange={e => set({ pdfFontScale: parseInt(e.target.value, 10) / 100 })}
            style={{ width: '100%', accentColor: 'var(--primary)' }} />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
            80% = compact (fits more per page) · 100% = default · 140% = large. Scales the entire PDF proportionally.
          </p>
          <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', margin: '3px 0 0', fontStyle: 'italic' }}>
            v1.10.10 note: applied at PDF export time. The on-screen preview always renders at 100% — download a PDF to see the actual scale.
          </p>
        </SettingGroup>

      </div>
    </div>
  );
}
