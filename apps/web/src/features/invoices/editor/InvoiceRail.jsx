import { Check, Download, Eye, Loader, MessageCircle, Plus, Printer, Settings, Truck } from 'lucide-react';
import { formatCurrency, printedSubtotal } from '../../../utils';

// The right-hand rail of the invoice sheet: the running total, the breakdown of what makes it up, the actions
// (save / download / print / share), the section outline and the Customize / Preview toggles.

// The sheet's sections, in order. The rail lists them with a tick once each has what it needs.
const DOC_STEPS = [
  { key: 'customer', label: 'Customer' },
  { key: 'details', label: 'Details' },
  { key: 'items', label: 'Items' },
  { key: 'terms', label: 'Terms & notes' },
];

/** The rail's breakdown: only the lines that have something in them, so a plain bill shows two rows, not ten. */
export function railRows({ totals, discountTotal, taxTotal, taxLabel, showGST, profitNow }) {
  return [
    ['Subtotal', printedSubtotal(totals), true],
    ['Discount', -discountTotal, discountTotal > 0],
    ['Charges', totals.chargesTotal, totals.chargesTotal > 0],
    [taxLabel || 'Tax', taxTotal, showGST],
    ['Cess', totals.cess, totals.cess > 0],
    ['TCS', totals.tcsAmount, totals.tcsAmount > 0],
    ['Round-off', totals.roundOff, !!totals.roundOff],
    // Settings > Transaction > Show profit while billing (owner only)
    ['Estimated profit', profitNow, profitNow !== null],
    ['Less TDS', -(totals.tdsAmount || 0), totals.tdsAmount > 0],
  ].filter(([, , show]) => show);
}

// Auto-save state, shown as a chip in the header. On a draft it is a button that focuses the first missing field.
export function EditorStatusChip({ autoSaveStatus, readOnlyDoc, isExisting, savedYet, isMeaningful, clientName, clientNameRef }) {
  const isSaving = autoSaveStatus === 'saving';
  const isSaved = autoSaveStatus === 'saved';
  const isDraft = autoSaveStatus === 'idle' && !isMeaningful;
  const tone = readOnlyDoc ? 'locked' : isSaving ? 'saving' : isSaved ? 'saved' : isDraft ? 'draft' : 'idle';
  const label = readOnlyDoc ? 'Read-only'
    : isSaving ? 'Saving…'
    : isSaved ? 'All changes saved'
    : isDraft ? 'Draft — click to complete'
    : (!isExisting && !savedYet) ? 'Not saved yet'
    : 'Ready';
  const onClick = () => {
    if (!isDraft) return;
    if (!clientName?.trim()) {
      clientNameRef.current?.focus();
      clientNameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const emptyRow = document.querySelector('.line-item-row input.form-input:placeholder-shown, .line-item-row input.form-input[value=""]');
    if (emptyRow) {
      emptyRow.focus();
      emptyRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  return (
    <button type="button" className={`canvas-status canvas-status--${tone}`} onClick={onClick} disabled={!isDraft}
      title={isDraft ? 'Click to focus the first missing field' : label}>
      {isSaving ? <Loader size={12} className="spin" /> : isSaved ? <Check size={12} /> : <span className="canvas-status-dot" />}
      {label}
    </button>
  );
}

export default function InvoiceRail({
  invoiceType, totals, currency, filledLines, clientName,
  discountTotal, taxTotal, taxLabel, showGST, profitNow,
  saving, readOnlyDoc, typeLabel, showSaveAndNew, thermal,
  isMeaningful, isExisting, savedYet, autoSaveStatus, clientNameRef,
  stepDone, partyLabel, jumpTo,
  saveOnly, saveAndNew, generatePDF, directPrint, shareWhatsApp, exportEWayBill,
  previewCollapsed, setPreviewCollapsed, showOptions, setShowOptions,
}) {
  const money = (v) => formatCurrency(Number(v) || 0, currency);
  const breakdown = railRows({ totals, discountTotal, taxTotal, taxLabel, showGST, profitNow });
  return (
    <aside className="canvas-rail" aria-label="Total and actions">
      <div className="rail-total">
        <span className="rail-label">{invoiceType === 'credit-note' ? 'Credit amount' : 'Amount due'}</span>
        <strong className="rail-amount">{money(totals.total)}</strong>
        <span className="rail-sub">
          {filledLines} {filledLines === 1 ? 'line' : 'lines'}{clientName?.trim() ? ` · ${clientName.trim()}` : ''}
        </span>
      </div>

      <dl className="rail-breakdown">
        {breakdown.map(([label, value]) => (
          <div key={label} className="rail-row">
            <dt>{label}</dt>
            <dd>{money(value)}</dd>
          </div>
        ))}
        {totals.tdsAmount > 0 && (
          <div className="rail-row rail-row-strong">
            <dt>Net receivable</dt>
            <dd>{money(totals.netReceivable)}</dd>
          </div>
        )}
      </dl>

      <div className="rail-actions">
        <button type="button" className="rail-btn rail-btn-primary" onClick={saveOnly} disabled={saving || readOnlyDoc}
          title="Save without downloading (Ctrl+S)">
          <Check size={17} /> {saving ? 'Saving…' : `Save ${typeLabel || ''}`.trim()}
        </button>
        <div className="rail-pair">
          {showSaveAndNew && (
            <button type="button" className="rail-btn" onClick={saveAndNew} disabled={saving || readOnlyDoc}
              title="Save, then start a blank one of the same type">
              <Plus size={16} /> Save &amp; New
            </button>
          )}
          <button type="button" className="rail-btn" onClick={generatePDF} disabled={saving} title="Save + download the PDF">
            <Download size={16} /> {saving ? 'Working…' : 'Download'}
          </button>
        </div>
        <div className="rail-quick">
          <button type="button" className="rail-icon" onClick={directPrint} disabled={saving}
            title={thermal ? 'Send directly to your thermal printer' : 'Open the print dialog (no PDF download)'}>
            <Printer size={17} /><span>Print</span>
          </button>
          <button type="button" className="rail-icon rail-icon-wa" onClick={shareWhatsApp} disabled={saving} title="Share on WhatsApp">
            <MessageCircle size={17} /><span>WhatsApp</span>
          </button>
          {(invoiceType === 'tax-invoice' || invoiceType === 'delivery-challan') && (
            <button type="button" className="rail-icon" onClick={exportEWayBill} disabled={saving} title="Download E-Way Bill JSON for NIC portal upload">
              <Truck size={17} /><span>E-Way</span>
            </button>
          )}
        </div>
      </div>

      <ol className="rail-outline" aria-label="Sections">
        {DOC_STEPS.map((st, i) => (
          <li key={st.key}>
            <button type="button" className={stepDone[i] ? 'done' : ''} onClick={() => jumpTo(st.key)}>
              <span className="rail-outline-mark">{stepDone[i] ? <Check size={11} /> : String(i + 1).padStart(2, '0')}</span>
              {st.key === 'customer' ? partyLabel : st.label}
            </button>
          </li>
        ))}
      </ol>

      <div className="rail-tools">
        <button type="button" className={`rail-tool${previewCollapsed ? '' : ' on'}`} onClick={() => setPreviewCollapsed((v) => !v)}
          title="Open the printed document in a drawer">
          <Eye size={16} /> Preview
        </button>
        <button type="button" className={`rail-tool${showOptions ? ' on' : ''}`} onClick={() => setShowOptions(!showOptions)}
          title="Choose columns, sections, paper size and PDF style">
          <Settings size={16} /> Customize
        </button>
      </div>
    </aside>
  );
}
