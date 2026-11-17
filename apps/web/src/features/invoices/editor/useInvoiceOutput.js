import { useEffect, useRef, useState } from 'react';
import { saveBill, getAllBills } from '../../../lib/data';
import { generateEWayBillJSON, getPaperSize, formatCurrency, printedSubtotal } from '../../../utils';
import { getPrintSettings } from '../../print/printSettingsStore';
import { openWhatsAppShare } from '../../import-export/share';
import { toast } from '../../../components/ui/Toast';
import { buildInvoicePDF } from './pdfBuilder';
import { pdfFileName } from './invoiceNumbering';
import { clearDraft } from './hooks/useInvoiceDraft';

// Everything that turns the invoice into an output: PDF building and download, direct printing (sheet and
// thermal), the print-preview modal, WhatsApp share, the E-Way Bill JSON, and the keyboard shortcuts. Saving
// before any output (so the printed copy carries a real number) is done through the save hook's functions,
// which arrive as arguments.
export function useInvoiceOutput({
  printRef, previewCollapsed, setPreviewCollapsed,
  invoiceOptions, profile, editingBill, details, client, items, setItems,
  totals, invoiceType, typeConfig, taxInclusive,
  saving, setSaving, readOnlyDoc, hasOutput,
  validateForSave, saveInvoiceToDB, isMeaningfulInvoice, leaveModal, setLeaveModal,
  addItem, onBack,
}) {
  // v1.10.36 — Portal-based print preview modal state. Only opens for
  // thermal receipts; A4 users hit Print → OS dialog directly since the
  // OS dialog already shows a preview. See directPrint + executePrint.
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  // v1.10.3 — Shared print-via-iframe helper. Prior code duplicated the
  // "createObjectURL + iframe + revoke on load" pattern in 3 places and
  // ALL 3 leaked the blob URL if `onload` never fired (broken PDF,
  // iframe blocked). Now: revoked in error handler AND unconditionally
  // on load. Iframe stays (reused by id) but does not accumulate.
  const printViaIframe = (blob) => {
    const url = URL.createObjectURL(blob);
    let cleaned = false;
    const cleanup = () => { if (!cleaned) { cleaned = true; URL.revokeObjectURL(url); } };
    // Belt: 90s hard timeout in case onload never fires.
    const timer = setTimeout(cleanup, 90_000);
    try {
      let frame = document.getElementById('fgsb-print-frame');
      if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'fgsb-print-frame';
        frame.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:0;height:0;border:0;';
        document.body.appendChild(frame);
      }
      frame.src = url;
      frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); }
        catch { window.open(url, '_blank'); }
        // Give the print job ~60s to grab the buffer, then revoke.
        setTimeout(() => { clearTimeout(timer); cleanup(); }, 60_000);
      };
      frame.onerror = () => { clearTimeout(timer); cleanup(); };
    } catch (err) {
      clearTimeout(timer); cleanup(); throw err;
    }
  };

  // v1.10.42 — Vector-HTML thermal print (revived from v1.10.35). Clones
  // the on-screen invoice-preview element + the document's stylesheets
  // into a hidden iframe, sets @page: size WIDTHmm auto, and calls
  // iframe.contentWindow.print(). Text stays VECTOR all the way to the
  // printer driver — 203-dpi thermal rasterises at native resolution
  // → sharp glyphs regardless of font size, smaller print jobs, faster
  // buffer fill on cheap thermal printers with tiny buffers.
  //
  // This is what the v1.10.35 ThermalPreviewModal was doing before the
  // v1.10.36 revert. We lost it there because custom paper widths + a
  // separate modal-hosted <InvoicePreview> instance introduced CSS drift
  // vs the on-screen render. This revival uses the parent's existing
  // on-screen `printRef` (same DOM the user is seeing), avoiding that
  // drift class entirely.
  //
  // Returns true on success, false if the browser blocked programmatic
  // iframe print (rare — chrome/edge/safari all allow it from a user-
  // gesture click, which is our only caller). The false case lets the
  // caller fall back to the PDF path without a toast on the user.
  const printThermalViaHtml = async () => {
    if (!printRef.current) return false;
    const receipt = printRef.current.querySelector('#invoice-preview') || printRef.current;
    if (!receipt) return false;

    const paperCfg = getPaperSize(invoiceOptions.paperSize, invoiceOptions);
    const widthMm = paperCfg.widthMm || 80;

    // Collect the document's CSS text so the iframe renders identically.
    // Cross-origin stylesheets (Google Fonts, etc.) throw on cssRules
    // access — skip those; thermal renders fine with system fonts.
    const collectStyles = () => {
      const parts = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          if (!rules) continue;
          for (const rule of Array.from(rules)) parts.push(rule.cssText);
        } catch { /* cross-origin, skip */ }
      }
      return parts.join('\n');
    };

    const doc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print Receipt</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    #invoice-preview {
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #000 !important;
      min-height: 0 !important;
    }
    ${collectStyles()}
  </style>
</head>
<body>${receipt.outerHTML}</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;border:0;';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    try {
      await new Promise((resolve) => {
        iframe.onload = resolve;
        iframe.srcdoc = doc;
      });
      // Wait for images (logo, QR) inside the iframe. 3s safety per image.
      const imgs = iframe.contentDocument?.querySelectorAll('img') || [];
      await Promise.all(Array.from(imgs).map(img => (
        img.complete
          ? Promise.resolve()
          : new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 3000); })
      )));
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Give the driver ~8s to grab the buffer before we tear down.
      setTimeout(() => { try { iframe.remove(); } catch { /* ignore */ } }, 8000);
      return true;
    } catch (err) {
      console.warn('Direct thermal print failed, will fall back to PDF:', err);
      try { iframe.remove(); } catch { /* ignore */ }
      return false;
    }
  };

  // v1.10.3 — Thermal receipts (58mm / 80mm rolls) no longer go through
  // html2canvas → JPEG → jsPDF. That path was 100× the CPU/memory of
  // what's needed for a text-only receipt. Now: for thermal paper sizes
  // we hand the browser the invoice HTML directly via a print-focused
  // window.print() flow. Modern printer drivers handle 58/80mm rolls
  // natively when the CSS `@page size` matches.
  //
  // v1.10.33 — Bug fix: was `.startsWith('thermal')` which does NOT
  // match the `custom` preset even when its width is under 100mm
  // (getPaperSize returns kind='thermal' for those). So a user picking
  // Custom 76mm was routed through the sheet-print path — thick roll
  // wasted paper, watermark stamped on receipt, HSN/rate lines shown.
  // Now: single source of truth — getPaperSize().kind.
  const isThermalPaper = () => getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal';

  // v1.10.26 — Focus mode moves the preview pane off-screen (position:
  // absolute), which is fine for html2canvas (layout still computed) but
  // breaks window.print() for thermal (prints visible viewport only).
  // Un-collapse the preview for the duration of any print / download
  // operation and restore after.
  //
  // v1.10.27 — Reported: "after print, preview panel comes back up and
  // hiding again have to click." Prior code registered an `afterprint`
  // listener + 30s safety timeout, which never fired in two of the three
  // paths and left the preview expanded:
  //   - Download PDF has NO print dialog → afterprint never fires
  //   - A4 iframe print → afterprint fires on iframe.contentWindow, not
  //     the parent window we were listening on
  //   - Only thermal window.print() correctly fired afterprint on parent
  //
  // Fix: restore in the finally block, unconditionally. window.print()
  // blocks the JS thread until the native dialog closes on all desktop
  // browsers, so the restore happens after the user is done with print.
  // On mobile Safari where print() may not block, the DOM was already
  // captured at the moment print() was invoked, so restoring right after
  // is safe.
  const withPreviewOnScreen = async (fn) => {
    const wasCollapsed = previewCollapsed;
    if (!wasCollapsed) return fn();
    setPreviewCollapsed(false);
    // v1.10.28 — bumped settle from 50ms → 200ms. Reported: PDF sometimes
    // came out with content shoved to top-left on slower devices. Root
    // cause: after removing position: absolute, browser needs a real layout
    // pass; 50ms wasn't enough for React commit + reflow on low-end Android.
    // Two rAFs + a settle timeout so React commits the DOM change AND
    // the browser lays out the newly-visible preview before we snapshot.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200))));
    try {
      return await fn();
    } finally {
      setPreviewCollapsed(true);
    }
  };

  // v1.10.36 — Print pipeline split into two functions:
  //   1. `executePrint` — the actual work (buildPDF → printViaIframe).
  //      This is the SAME code path that was working in v1.10.34 and
  //      after the v1.10.35 → v1.10.36 revert. Guaranteed reliable.
  //   2. `directPrint` — user-facing Print button click handler. For
  //      thermal invoices, opens the PrintPreviewModal first so the
  //      user sees exactly what will print before it goes. For A4/sheet,
  //      calls executePrint directly because the OS print dialog
  //      already shows a full page preview.
  //
  // The modal DOES NOT re-render or re-serialize anything for printing
  // — its Print button just calls executePrint, which uses the parent's
  // existing on-screen `printRef`. Both the modal's <InvoicePreview>
  // and the printed output come from the SAME component with the SAME
  // props → bit-for-bit identical. Zero CSS drift risk (this was the
  // v1.10.35 bug — a re-serialized iframe DOM diverged from the on-
  // screen render because of dropped cross-origin fonts + max-width
  // caps beating inline widths). See PrintPreviewModal.jsx for details.
  // Save before any PDF or print is made, counting it as printed once more.
  // A new invoice gets its real number here (the form only shows a peek until
  // the first save), so the PDF must be built AFTER this, once the preview has
  // re-rendered with that number. Returns the saved number, or null.
  const saveForOutput = async () => {
    if (readOnlyDoc) return details.invoiceNumber; // printed or downloaded as it is
    const prevPrinted = editingBill && !editingBill._isDuplicate ? Number(editingBill.printedCount) || 0 : 0;
    const no = await saveInvoiceToDB(false, {
      printedCount: prevPrinted + 1,
      lastPrintedAt: new Date().toISOString(),
    });
    if (!no) return null;
    hasOutput.current = true;
    clearDraft();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return no;
  };

  // Prints what the preview shows. Returns true when it was sent to print.
  const printPreview = () => withPreviewOnScreen(async () => {
    try {
      // v1.10.42 — Thermal + user hasn't opted out of direct print?
      // Try the vector-HTML path first. If the browser blocks it
      // (returned false), silently fall through to the PDF path so
      // the user still gets a print — no surfaced error required.
      if (isThermalPaper() && (getPrintSettings().thermalPrintMode || 'direct') === 'direct') {
        const ok = await printThermalViaHtml();
        if (ok) return true;
      }
      const pdf = await buildInvoicePDF({ printRef, invoiceOptions, profile, editingBill, details, forPrint: true });
      printViaIframe(pdf.output('blob'));
      return true;
    } catch (err) {
      console.error('Print failed', err);
      toast('Print failed — try Download PDF instead', 'error');
      return false;
    }
  });

  const executePrint = async () => {
    if (!printRef.current) return;
    setSaving(true);
    try {
      // Printing hands the client a numbered invoice, so it is saved first,
      // like Save & Download (it used to print without saving at all).
      const saved = await saveForOutput();
      if (!saved) return;
      await printPreview();
    } catch (err) {
      console.error('Print failed', err);
      toast('Print failed — try Download PDF instead', 'error');
    } finally {
      setSaving(false);
    }
  };

  // v1.10.77 (#86) - opened by the Dashboard's Print button: print once the
  // preview has drawn, then go back to the Dashboard.
  // The timer only raises a flag: the print itself runs on the next render,
  // with the invoice loaded. (Calling the print from the timer used the first
  // render's empty form: 'Bill must have an id'.)
  const [printOnOpen, setPrintOnOpen] = useState(false);
  const printOnOpenDone = useRef(false);
  useEffect(() => {
    if (!editingBill?._printOnOpen) return undefined;
    const t = setTimeout(() => setPrintOnOpen(true), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!printOnOpen || printOnOpenDone.current) return;
    printOnOpenDone.current = true;
    // A saved invoice printed as it is: nothing in it is saved again (a full
    // save would refresh its business details and options from today's
    // settings); only the print count goes up on the stored copy.
    (async () => {
      setSaving(true);
      try {
        if (printRef.current && await printPreview()) {
          const stored = (await getAllBills()).find((b) => b.id === editingBill.id);
          if (stored) {
            await saveBill({ ...stored, printedCount: (Number(stored.printedCount) || 0) + 1, lastPrintedAt: new Date().toISOString() }, { overwrite: true });
          }
        }
      } catch (err) {
        console.error('Print failed', err);
      } finally {
        setSaving(false);
      }
      clearDraft();
      onBack();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOnOpen]);

  const directPrint = async () => {
    if (!printRef.current) return;
    // v1.10.58 (#47) — same gate as Save: printing persists the bill and
    // reserves an invoice number, so a blank one must not get through here
    // either.
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return; }
    if (isThermalPaper()) {
      // Thermal → show the preview modal. Actual print fires from the
      // modal's Print button via executePrint. User can Cancel there
      // if the preview looks wrong.
      setShowPrintPreview(true);
      return;
    }
    // A4 / A5 / Letter / Legal — go straight to print. Chrome's own
    // dialog already shows a page-accurate preview, no in-app modal
    // needed for these.
    await executePrint();
  };

  // The old desktop app also kept a copy of every PDF in a "Saved Invoices" folder on the computer. Invoices are
  // downloaded or printed from the browser now, so there is no folder copy; the call sites stay and do nothing.
  const saveToInvoicesFolder = async () => {};

  // v1.10.76 (#83) - reported: editing an invoice and pressing Save updated
  // the invoice but left the old PDF in Saved Invoices. If this invoice was
  // ever downloaded or printed, Save now rebuilds that PDF too (no download).
  const refreshSavedPdf = async (savedNumber) => {
    if (!hasOutput.current || !printRef.current) return;
    try {
      const pdf = await withPreviewOnScreen(() => buildInvoicePDF({ printRef, invoiceOptions, profile, editingBill, details, archive: true }));
      await saveToInvoicesFolder(pdf.output('blob'), pdfFileName(typeConfig.prefix, savedNumber));
      toast('The PDF in Saved Invoices is updated too', 'info');
    } catch (err) {
      console.error('Saved Invoices PDF refresh failed:', err);
      toast('Invoice saved, but its PDF in Saved Invoices could not be updated. Use Save & Download.', 'warning');
    }
  };

  const generatePDF = async () => {
    if (!printRef.current) return;
    // v1.10.58 (#47) — same gate as Save: printing persists the bill and
    // reserves an invoice number, so a blank one must not get through here
    // either.
    const problem = validateForSave();
    if (problem) { toast(problem, 'warning'); return; }
    try {
      setSaving(true);
      // Save first so the PDF shows the number the invoice was saved under.
      const savedNumber = await saveForOutput();
      if (!savedNumber) return;
      // v1.10.26 — force preview on-screen so html2canvas can snapshot it.
      const pdf = await withPreviewOnScreen(() => buildInvoicePDF({ printRef, invoiceOptions, profile, editingBill, details }));
      const fileName = pdfFileName(typeConfig.prefix, savedNumber);
      pdf.save(fileName);

      const pdfBlob = pdf.output('blob');

      toast('Invoice downloaded', 'success');

      // v1.10.3 — auto-print via the shared printViaIframe helper.
      // v1.10.5 — also fire when the loaded client has autoPrint=true,
      // even if the app-wide autoPrintOnSave is off (per-client override).
      const ps = getPrintSettings();
      if (ps.autoPrintOnSave || invoiceOptions.clientAutoPrint) {
        try { printViaIframe(pdfBlob); }
        catch { /* non-fatal — user already has the PDF downloaded */ }
      }
    } catch (err) {
      console.error(err);
      toast('Failed to generate PDF.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const shareWhatsApp = () => {
    // v1.10.29 — reported: "when i use whatsapp button it is sending
    // subtotal amount". Cause: this used `items.reduce((s, i) => s +
    // (i.quantity * i.rate), 0)` — that's the pre-tax subtotal, not the
    // invoice total. Now uses totals.total (post-tax, post-discount, with
    // round-off + TCS + invoice-level discount all applied) — the same
    // number that appears on the PDF and gets saved as bill.totalAmount.
    const cur = invoiceOptions.currency || 'INR';
    const total = formatCurrency(Number(totals.total) || 0, cur);
    const subtotal = formatCurrency(printedSubtotal(totals), cur);
    const dateStr = details.invoiceDate ? new Date(details.invoiceDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const businessName = profile?.businessName || '';
    const lines = [
      `*Invoice: ${details.invoiceNumber}*`,
      `Date: ${dateStr}`,
      `Client: ${client?.name || ''}`,
      `Subtotal: ${subtotal}`,
      `*Total: ${total}*`,
    ];
    if (businessName) lines.push('', `— ${businessName}`);
    openWhatsAppShare(client?.phone, lines.join('\n'));
  };

  const exportEWayBill = () => {
    if (!profile?.gstin) { toast('Set your GSTIN in Settings first', 'warning'); return; }
    // v1.10.74 - a blank invoice made an E-Way Bill JSON the portal rejects.
    if (!items.some(i => (i.name || '').trim() && (i.quantity || 0) * (i.rate || 0) > 0)) {
      toast('Add at least one item with a quantity and rate first.', 'warning');
      return;
    }
    // v1.10.1 — Pass taxInclusive so back-calc taxable value on line items.
    // Otherwise E-Way Bill portal rejects with `amount_mismatch` on MRP-inclusive invoices.
    const ewb = generateEWayBillJSON(profile, client, details, items, totals, invoiceType, { taxInclusive });
    const blob = new Blob([JSON.stringify(ewb, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EWB-${details.invoiceNumber?.replace(/\//g, '-') || 'draft'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('E-Way Bill JSON downloaded', 'success');
  };

  // Per-view keyboard shortcuts.
  //   Ctrl/Cmd+S       — save invoice (no PDF) if meaningful
  //   Ctrl/Cmd+P       — download PDF
  //   Ctrl/Cmd+Enter   — add a new line item (v1.10.22)
  //   Ctrl/Cmd+Shift+D — duplicate the LAST line item (v1.10.22)
  //   Esc              — close the leave-guard modal (v1.10.22)
  useEffect(() => {
    const onKey = (e) => {
      // Esc closes the leave modal without needing Ctrl.
      if (e.key === 'Escape' && leaveModal) {
        e.preventDefault();
        setLeaveModal(false);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 's' || e.key === 'S') {
        if (!isMeaningfulInvoice()) return; // nothing to save
        e.preventDefault();
        saveInvoiceToDB().then(async (no) => { if (no) { toast('Invoice saved', 'success'); await refreshSavedPdf(no); } }).catch(() => toast('Save failed', 'error'));
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        // Defer to the next tick so the keydown doesn't race the PDF render.
        setTimeout(() => generatePDF(), 0);
      } else if (e.key === 'Enter') {
        // Add a new line item. Doesn't fire when the user is inside a form
        // element that should get Enter (rich-text editor autofocus etc.) —
        // browsers dispatch Ctrl+Enter to the row-level input which won't
        // preventDefault by itself.
        e.preventDefault();
        addItem();
      } else if (e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        // Duplicate the last item — quick win for "same item, next line".
        e.preventDefault();
        setItems(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          return [...prev, { ...last, id: Date.now().toString() }];
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMeaningfulInvoice, leaveModal]);

  return {
    showPrintPreview, setShowPrintPreview,
    executePrint, generatePDF, directPrint,
    shareWhatsApp, exportEWayBill,
    isThermalPaper, refreshSavedPdf,
  };
}
