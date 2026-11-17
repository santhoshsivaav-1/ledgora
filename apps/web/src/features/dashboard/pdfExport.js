// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// PDF generation for the share flows and the bulk export. The single-bill
// blob is a plain async function; the bulk exporter is a factory because it
// reads the Dashboard's selection and filtered list.

import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { addCanvasAsA4Pages, safeBreaks } from './pdfPages';

// v1.10.22 — Generate a single-bill PDF as a Blob. Split out of the
// bulk-export path so the WhatsApp / native share flows can attach the
// actual PDF via navigator.share (with a text-only URL fallback on
// desktop / browsers that don't support file sharing yet).
export const generateSingleBillPdfBlob = async (bill) => {
  const data = bill.data || {};
  const { jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;
  const InvoicePreviewMod = await import('../print/InvoicePreview');
  const { createRoot } = await import('react-dom/client');
  const { createElement } = await import('react');
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;background:#fff;';
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await new Promise((resolve) => {
      root.render(createElement(InvoicePreviewMod.default, {
        profile: data.profile, client: data.client, details: data.details, items: data.items,
        totals: data.totals, invoiceType: data.invoiceType, customTerms: data.customTerms,
        customNotes: data.customNotes, extraSections: data.extraSections, options: data.invoiceOptions,
        cancelled: bill.status === 'cancelled',
      }));
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)));
    });
    const capScale = Math.min(4, Math.max(2, Math.round((window.devicePixelRatio || 1) * 1.2)));
    const canvas = await html2canvas(container.firstElementChild || container, {
      scale: capScale, backgroundColor: '#ffffff', useCORS: false, logging: false,
    });
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    addCanvasAsA4Pages(doc, canvas, false, safeBreaks(container.firstElementChild || container, canvas));
    return doc.output('blob');
  } finally {
    root.unmount();
    document.body.removeChild(container);
  }
};

export function createPdfExportActions({ getSelectedBills, filtered, setBulkBusy }) {
  // Bulk PDF export — feature C from the v1.6.7 audit ("All March invoices
  // as one zip"). Renders each selected bill through the existing
  // InvoicePreview → jsPDF pipeline and stitches them into a single
  // multi-page PDF. Zip would be cleaner but pulling in JSZip inflates the
  // bundle by ~140KB; one big PDF is what CAs want anyway (one file to
  // archive).
  // v1.10.35 — `billsOverride` skips the selectedIds read entirely. Used
  // by the "Quick print" filter buttons (bulkPrintByFilter) which need
  // to export a computed set WITHOUT waiting for a React state commit
  // — the old code called `setSelectedIds(new Set(target))` then
  // `setTimeout(bulkExportPDF, 20)`, but the setTimeout captured the
  // stale bulkExportPDF closure whose getSelectedBills read the OLD
  // (empty) selectedIds → silent no-op. Reported: "Paid button blinks,
  // shows nothing."
  const bulkExportPDF = async (billsOverride = null) => {
    const sel = billsOverride || getSelectedBills();
    if (sel.length === 0) return;
    if (sel.length > 100 && !await confirmAction({
      title: `Export ${sel.length} invoices?`,
      message: `This may take a minute and produce a large PDF file.`,
      confirmLabel: 'Continue',
      tone: 'warning',
    })) return;
    setBulkBusy(true);
    try {
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      // Build each bill in a hidden container, snap it, add as a page.
      // Reuses InvoicePreview via a dynamic import so its CSS + fonts
      // are hydrated once, then reused for each iteration.
      const InvoicePreviewMod = await import('../print/InvoicePreview');
      const { createRoot } = await import('react-dom/client');
      const { createElement } = await import('react');
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;background:#fff;';
      document.body.appendChild(container);
      const root = createRoot(container);
      // v1.10.3 — Audit H18/H19: bulk export used to freeze the tab
      // silently (no progress UI). On a 3× DPR Android, scale went to
      // 4.5× → 16MP canvas per invoice × 50 invoices retained as JPEG
      // data URLs = OOM before doc.save() fired. Now: capped scale,
      // per-invoice progress toast, immediate abort via
      // window.__fgsbBulkAbort.
      const capScale = Math.min(4, Math.max(2, Math.round((window.devicePixelRatio || 1) * 1.2)));
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch { /* non-fatal */ }
      }
      window.__fgsbBulkAbort = false;
      let ok = 0;
      for (let i = 0; i < sel.length; i++) {
        if (window.__fgsbBulkAbort) break;
        const bill = sel[i];
        const data = bill.data || {};
        // Progress every 5 invoices (or every one for very small batches).
        if (sel.length > 5 && (i % 5 === 0)) {
          toast(`Exporting ${i + 1} of ${sel.length}…`, 'info', 1500);
        }
        await new Promise((resolve) => {
          root.render(createElement(InvoicePreviewMod.default, {
            profile: data.profile, client: data.client, details: data.details, items: data.items,
            totals: data.totals, invoiceType: data.invoiceType, customTerms: data.customTerms,
            customNotes: data.customNotes, extraSections: data.extraSections, options: data.invoiceOptions,
            cancelled: bill.status === 'cancelled',
          }));
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100)));
        });
        try {
          const canvas = await html2canvas(container.firstElementChild || container, {
            scale: capScale,
            backgroundColor: '#ffffff', useCORS: false, logging: false,
          });
          addCanvasAsA4Pages(doc, canvas, ok > 0, safeBreaks(container.firstElementChild || container, canvas));
          ok++;
        } catch (e) { /* skip broken bill silently */ }
        // Yield to the event loop between invoices so the browser can
        // paint the progress toast and handle any user click on Abort.
        await new Promise(r => setTimeout(r, 0));
      }
      root.unmount();
      document.body.removeChild(container);
      if (window.__fgsbBulkAbort) { toast(`Aborted after ${ok} of ${sel.length}`, 'warning'); }
      window.__fgsbBulkAbort = false;
      if (ok === 0) { toast('Could not generate any PDFs', 'error'); return; }
      const filename = `freegstbill-invoices-${ok}-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(filename);
      toast(`Exported ${ok} of ${sel.length} invoices`, 'success');
    } catch (e) {
      toast('Bulk PDF export failed — see console', 'error');
      console.error('bulkExportPDF', e);
    }
    setBulkBusy(false);
  };

  // v1.9.1 — Quick bulk-print by filter. Reuses the existing bulkExportPDF
  // engine by temporarily overriding the selection with a computed set.
  // Selection is restored afterwards.
  const bulkPrintByFilter = async (filterKind) => {
    const targetBills = filterKind === 'all'
      ? filtered
      : filtered.filter(b => (filterKind === 'unpaid' ? (b.status || 'unpaid') === 'unpaid' : b.status === filterKind));
    if (targetBills.length === 0) {
      toast(`No ${filterKind === 'all' ? '' : filterKind + ' '}invoices to print`, 'warning');
      return;
    }
    // v1.10.35 — Pass the computed bill set directly. Prior code briefly
    // mutated selectedIds via setState then setTimeout(...bulkExportPDF)
    // which read stale state through the setTimeout closure and printed
    // nothing. Now the export runs immediately with the correct set and
    // the user's selection is left untouched.
    await bulkExportPDF(targetBills);
  };

  return { bulkExportPDF, bulkPrintByFilter };
}
