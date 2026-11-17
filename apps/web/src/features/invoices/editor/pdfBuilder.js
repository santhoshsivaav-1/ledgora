// PDF generation for the invoice editor. Lives outside the page component on purpose: it is one long pipeline
// (capture the on-screen preview, paginate at safe row boundaries, then stamp the print-settings overlays) and
// it only reads state through its arguments, so the page stays readable.
import { getPrintSettings } from '../../print/printSettingsStore';
import { getPaperSize, safePageBoundaries } from '../../../utils';
import { fitSpacersToOnePage } from './editorConstants';

// Shared PDF generation helper. v1.10.3 — wraps the whole body in
// try/finally so `scalerEl.style.transform` is always restored, even
// if html2canvas or jsPDF throws mid-render. Prior code only restored
// on the success path — an exception left the on-screen preview
// stuck at scale 1.0 until the user navigated away.
export async function buildInvoicePDF({ printRef, invoiceOptions, profile, editingBill, details, archive = false, forPrint = false }) {
  const printSettings = getPrintSettings();
  const scalerEl = printRef.current.closest('.preview-scaler');
  const spacerFit = {};
  if (scalerEl) scalerEl.style.transform = 'none';
  try {
    return await buildPDFInner(printSettings, { printRef, invoiceOptions, profile, editingBill, details }, archive, spacerFit, forPrint);
  } finally {
    spacerFit.restore?.();
    if (scalerEl) scalerEl.style.transform = '';
  }
}

// archive: the copy kept in Saved Invoices, which carries no REPRINT stamp.
async function buildPDFInner(printSettings, { printRef, invoiceOptions, profile, editingBill, details }, archive = false, spacerFit = {}, forPrint = false) {
  // P11-S2: jsPDF and html2canvas (~170 KB gzip) load on the first PDF, not with the app.
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);

  // v1.10.46 — Hoisted from line ~2133 to fix the v1.10.45 regression
  // where `isHeaderOn` / `isFooterOn` (introduced in v1.10.45 for the
  // page-2+ header/footer reserves) referenced this constant BEFORE
  // its declaration → Temporal Dead Zone ReferenceError → every
  // buildPDF() call threw → both `Print` and `Save & Download PDF`
  // buttons silently failed with the generic "Print failed" /
  // "Failed to generate PDF" toasts (reported in issue #20). Every
  // subsequent guard in this function that already referenced
  // isThermalPdf keeps working — this is a pure hoist.
  const isThermalPdf = getPaperSize(invoiceOptions.paperSize, invoiceOptions).kind === 'thermal';

  // PDF quality / size trade-off:
  //   - `compress: true` deflate-compresses PDF streams (incl. embedded images).
  //     Adds ~50-150ms but typically shrinks output by 15-30%.
  //   - Render scale = max(3, devicePixelRatio * 2). Bumping from 2 to 3 makes text
  //     visibly sharper without much file-size increase, because JPEG compresses
  //     clean line-art / glyphs efficiently. On Retina/4K screens we go higher.
  //   - JPEG quality 0.95 vs old 0.92: gain in legibility for small text outweighs
  //     the modest size bump.
  // Paper size (v1.8.1) — read from invoiceOptions. A4 default; A5 uses
  // jsPDF's built-in format; thermal 80mm/58mm use custom [width, height].
  // Thermal formats use a tall single-column layout — the InvoicePreview
  // component branches on options.paperSize CSS class to render compact.
  const paperCfg = getPaperSize(invoiceOptions.paperSize, invoiceOptions);
  // jsPDF orientation defaults to 'portrait' if the paper config doesn't
  // specify it, so pre-v1.8.3 saved bills keep rendering portrait.
  // Note: `let pdf` (not const) so the thermal path can replace it with
  // a content-height-sized instance after html2canvas returns — thermal
  // receipts were previously always 297mm tall regardless of actual
  // content, wasting 15-20cm of blank paper per receipt when the PDF
  // was reprinted.
  let pdf = new jsPDF({
    orientation: paperCfg.jsPdfOrientation || 'portrait',
    unit: 'mm',
    format: paperCfg.jsPdfFormat,
    compress: true,
  });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfPageHeight = pdf.internal.pageSize.getHeight();
  const extraPages = printRef.current.querySelectorAll('[data-pdf-page]');
  // v1.9.1 — quality-driven render scale + JPEG quality:
  //   draft   → scale 2, JPEG 0.85 → ~50% smaller PDF, email-friendly
  //   standard→ scale 3, JPEG 0.95 → default (existing behaviour)
  //   hd      → scale max(4, dpr*3), JPEG 0.98 → archival quality, larger
  // v1.10.3 — Scale is now capped at 6× on any device. Prior code
  // `Math.max(4, dpr * 3)` on a 4× DPR Android phone hit 12× → an
  // A4 canvas at 100 megapixels → OOM crash before jsPDF ever ran.
  // Also: PNG for HD (crisp text edges — invoices are line-art),
  // JPEG for draft/standard (file size wins). Prior always-JPEG
  // smudged glyph edges on high-DPI screens.
  const capScale = (n) => Math.min(6, Math.max(2, Math.round(n)));
  const qualityCfg = {
    draft:    { scale: 2, imgFormat: 'JPEG', quality: 0.85 },
    standard: { scale: capScale(Math.max(3, (window.devicePixelRatio || 1) * 2)), imgFormat: 'JPEG', quality: 0.95 },
    hd:       { scale: capScale(Math.max(4, (window.devicePixelRatio || 1) * 2.5)), imgFormat: 'PNG', quality: 1.0 },
  };
  // v1.10.77 (#86) - printing always uses HD: a print is not emailed, so file
  // size does not matter, and the JPEG of "standard" (what most business
  // presets set) printed visibly softer than the downloaded PDF looked.
  const q = forPrint ? qualityCfg.hd : (qualityCfg[printSettings.pdfQuality] || qualityCfg.standard);
  const renderScale = q.scale;
  const jpegQuality = q.quality;
  const imgFormat = q.imgFormat;   // 'JPEG' or 'PNG'
  // v1.10.3 — Await webfonts before rasterising. On a cold load,
  // html2canvas fired before Inter finished downloading → the capture
  // used fallback fonts with wrong glyph metrics → table columns
  // overflowed. `document.fonts.ready` resolves once every declared
  // font has loaded (or failed).
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* non-fatal */ }
  }

  // v1.10.60 — reported (#51, @sguptagzb): "when I try to print the
  // Invoice, the format is not coming as it comes in Preview", with a
  // sample PDF attached.
  //
  // Decoding that PDF showed the page rendered with NO layout CSS —
  // no table borders, no cards, no flex rows, so labels ran straight into
  // values ("Subtotal(rupee)1,78,000.00"). Inline styles survived, class
  // rules did not. Generating the same invoice here produced a correctly
  // styled PDF on the identical version, so the code was fine and their
  // environment was not.
  //
  // Root cause of the whole class: html2canvas clones the invoice into a
  // detached document, and that clone has to RE-FETCH the stylesheet by
  // URL. Any reason that fetch fails — a CSP source expression that does
  // not match the origin in use, a service worker (this is a PWA) serving
  // a stale or failed response, a clone document with a null origin —
  // produces a silently unstyled PDF. v1.10.48 widened the CSP, which
  // fixed one cause; this removes the dependency altogether.
  //
  // Now the document's own CSS rules are read out and injected into the
  // clone as a plain <style> element, so the clone never fetches anything.
  // The thermal print path has done exactly this since v1.10.42 — the PDF
  // path simply never adopted it.
  const collectDocumentStyles = () => {
    const parts = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        for (const rule of Array.from(rules)) parts.push(rule.cssText);
      } catch { /* cross-origin (Google Fonts) — skip; system fonts suffice */ }
    }
    return parts.join(String.fromCharCode(10));
  };

  const captureOptions = (el) => ({
    scale: renderScale,
    // v1.10.3 — useCORS was `true` but every image source is a base64
    // data URL (profile.logo, generated QR). `useCORS: true` triggers
    // a CORS preflight on any relative URL that slips in and silently
    // fails; today it's a dead flag but was flagged as fragile.
    useCORS: false,
    logging: false,
    letterRendering: true,
    backgroundColor: '#ffffff',
    // v1.10.3 — was `0` (disable). A broken image (bad logo, stale
    // QR) hung the capture indefinitely, giving the user a stuck
    // "Generating…" spinner. 15s is enough for real images + a
    // fallback for corrupt ones.
    imageTimeout: 15_000,
    width: el.scrollWidth,
    height: el.scrollHeight,
  });

  // Hide extra pages, capture main invoice.
  // v1.10.8 — audit M21 real fix. Prior code stamped the same tall
  // canvas at successive negative-Y offsets. Any row straddling a
  // pdfPageHeight boundary was cut mid-content on the PDF seam.
  // Now: pre-measure the DOM row boundaries so we can crop each
  // virtual page at a safe row-boundary instead of blindly slicing
  // every pdfPageHeight mm.
  //
  // Elements collected as "no-split-inside" anchors:
  //  • Every <tr> in the items table  → keep rows whole.
  //  • .inv-header / .inv-parties     → keep title + billing block whole.
  //  • .inv-footer-block              → keep bank / T&C / notes whole.
  //  • [data-pdf-page-boundary]       → escape hatch for future needs.
  //
  // The set collected here is DOM pixels relative to printRef.current.
  // We convert to canvas pixels below (× domToCanvasScale) once html2canvas
  // has returned and we know the true canvas.width.
  //
  // v1.10.70 - an edge is only offered if no row, footer block, signature
  // block or image straddles it (see safePageBoundaries). The footer is two
  // columns, and the gap between bank details and terms on the left ran
  // straight through the stamp on the right: the stamp printed half on
  // page 1 and half on page 2 (ERR-024).
  const collectRowBoundaries = (container) => {
    const top = container.getBoundingClientRect().top;
    const span = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.max(0, r.top - top), Math.max(0, r.bottom - top)];
    };
    const edges = [0];
    container.querySelectorAll(
      '.inv-table tbody tr, .inv-table thead tr, .inv-header, .inv-parties, ' +
      '.inv-footer, .inv-footer-block, .inv-signature, .inv-totals, [data-pdf-page-boundary]'
    ).forEach(el => edges.push(...span(el)));
    const keepWhole = [...container.querySelectorAll(
      '.inv-table tbody tr, .inv-table thead tr, .inv-header, .inv-parties, ' +
      // v1.10.73 - [data-pdf-page-boundary] too: the Boxed grid and Tally
      // designs mark every block with it (signature included), and a page
      // must end at those blocks' edges, never through one.
      '.inv-footer-block, .inv-signature, .inv-totals, [data-pdf-page-boundary], img'
    )].map(span);
    return safePageBoundaries(edges, keepWhole);
  };
  // v1.10.70 - hide the extra pages BEFORE measuring, not after. The
  // separate-terms page sits inside the footer row, so measuring with it
  // still visible laid the footer out differently from the capture.
  extraPages.forEach(el => el.style.display = 'none');
  // v1.10.77 (#88) - trim the Tally / Boxed padding if it alone pushes the
  // invoice onto a second page; put back right after the capture.
  if (paperCfg.kind !== 'thermal') spacerFit.restore = fitSpacersToOnePage(printRef.current, pdfWidth, pdfPageHeight, printSettings);
  const domBoundariesPx = collectRowBoundaries(printRef.current);
  const domContainerWidth = printRef.current.getBoundingClientRect().width;

  const mainCanvas = await html2canvas(printRef.current, {
    ...captureOptions(printRef.current),
    onclone: (clonedDoc) => {
      // v1.10.60 (#51) — embed the stylesheet rather than letting the
      // clone re-fetch it. Without this, any fetch failure yields a
      // completely unstyled PDF with no error shown to the user.
      try {
        const css = collectDocumentStyles();
        if (css) {
          const styleEl = clonedDoc.createElement('style');
          styleEl.setAttribute('data-fgsb-inlined', '1');
          styleEl.textContent = css;
          (clonedDoc.head || clonedDoc.documentElement).appendChild(styleEl);
        }
      } catch { /* never block the capture over styling */ }
      clonedDoc.querySelectorAll('*').forEach(n => { n.style.letterSpacing = '0px'; n.style.wordSpacing = '0px'; });
      const inv = clonedDoc.getElementById('invoice-preview');
      if (inv) {
        // Match the target paper width so html2canvas captures at the right
        // aspect ratio. jsPDF will scale to fit the page width; we set the
        // HTML width to widthMm so glyphs land where CSS put them.
        inv.style.width = `${paperCfg.widthMm}mm`;
        inv.style.overflow = 'visible'; inv.style.minHeight = 'unset';
        inv.style.border = 'none'; inv.style.boxShadow = 'none'; inv.style.borderRadius = '0';
        // v1.9.2 — add printing-mode class so CSS rules force darker colours
        // in the PDF capture. Fixes user complaint that A4/A5 output had
        // very-light gray text that faded on paper printers. Users can
        // turn this off in Print Settings if their printer is fine with
        // lighter greys.
        if (printSettings.pdfDarkenOnPrint !== false) {
          inv.classList.add('printing-mode');
        }
      }
      clonedDoc.querySelectorAll('[data-pdf-page]').forEach(el => el.style.display = 'none');
    }
  });
  extraPages.forEach(el => el.style.display = '');
  spacerFit.restore?.();
  spacerFit.restore = null;

  // v1.10.3 — Record each original page as a "recipe" so multi-copy
  // (GST Rule 48) can duplicate multi-page invoices correctly.
  // v1.10.8 — Each recipe is now its own cropped image (was: one
  // shared tall image with negative-Y offsets). See M21 note above.
  const pageRecipes = [];

  // v1.10.9 — Wire print margins. Prior code ignored `marginTop/Bottom/
  // Left/Right` from printSettings entirely — the UI existed, defaults
  // were in printSettings.js, but no consumer read them. Now: margins
  // shift the invoice image inside each PDF page. Useful for
  // pre-printed letterheads where content must clear the top logo,
  // or for printers with built-in edge margins.
  const mTop = Math.max(0, Number(printSettings.marginTop) || 0);
  const mBottom = Math.max(0, Number(printSettings.marginBottom) || 0);
  const mLeft = Math.max(0, Number(printSettings.marginLeft) || 0);
  const mRight = Math.max(0, Number(printSettings.marginRight) || 0);

  // v1.10.10 — PDF Font Scale now applies at the PDF-placement layer,
  // not just via CSS on the preview. Prior fix (v1.10.9) set an inline
  // `font-size: 80%` on the container, which correctly changed the
  // preview because parent-relative sizing cascaded to a few text
  // nodes — but html2canvas captures the DOM at its natural size, and
  // most children use `rem`/`px` (not `em`), so the raster came out
  // at 100% and the "80% compact" setting silently did nothing in the
  // real PDF. Now: multiply BOTH placement width AND height by the
  // scale. The invoice image lands smaller on the page → text is
  // proportionally smaller → more content fits per PDF page. This
  // matches how MS Word / LibreOffice "shrink to fit" works.
  const rawScale = Number(printSettings.pdfFontScale);
  const pdfScale = isFinite(rawScale) && rawScale > 0
    ? Math.max(0.5, Math.min(1.4, rawScale))
    : 1.0;
  // v1.10.45 — Reserve vertical space for page-2+ header band and the
  // page-number footer band, so content never overlaps them.
  // Reported: business name "Hem E..." collided with the "TERMS &
  // CONDITIONS" heading on page 2 of a multi-page invoice because
  // contentYOffset was `mTop` (usually 0) on every page while the
  // header was drawn at Y=6mm. Now: shrink the multi-page content
  // area by the header + footer bands and shift the image down on
  // page 2+ to sit BELOW the header. Single-page invoices are
  // unaffected — page-header + footer aren't drawn on page 1.
  //
  // 14mm ≈ 9pt bold text (2mm cap) + 2mm gap + 2mm underline offset
  //         + 8mm safety pad (glyph descenders + page-scale slop).
  //  9mm ≈ 8pt footer text at Y = pageHeight - 4mm + safety pad above.
  const isHeaderOn = !isThermalPdf && !!printSettings.pageHeaderEnabled;
  const isFooterOn = !isThermalPdf && !!printSettings.pageNumbersEnabled;
  const pageHeaderReserve = isHeaderOn ? 14 : 0;
  const pageFooterReserve = isFooterOn ? 9  : 0;

  const availWidth  = Math.max(20, pdfWidth      - mLeft - mRight);
  // "Full" = single-page availability (no reserve — page 1 has no header/footer bands).
  // "Multi" = per-page availability during pagination (reserves both bands).
  const availHeightFull  = Math.max(20, pdfPageHeight - mTop - mBottom);
  const availHeightMulti = Math.max(20, availHeightFull - pageHeaderReserve - pageFooterReserve);
  const contentWidth        = availWidth        * pdfScale;
  const contentHeightFull   = availHeightFull   * pdfScale;
  const contentHeightMulti  = availHeightMulti  * pdfScale;
  // Centre the scaled invoice inside the available margin box so
  // shrunk PDFs don't hug the left edge.
  const contentXOffset = mLeft + (availWidth - contentWidth) / 2;
  const contentYOffset = mTop; // top-aligned; bottom margin absorbs slack
  // Recompute the image's rendered height using the reduced content width
  // so aspect ratio stays correct after margins are applied.
  const scaledImgHeight = (mainCanvas.height * contentWidth) / mainCanvas.width;

  // Test hook for tests/smoke.mjs (ERR-024): where each PDF page ends, and
  // where the things a page must never cut through sit - all in the same
  // DOM pixels. Read-only, and costs nothing to anyone else.
  try {
    const t = printRef.current.getBoundingClientRect().top;
    const rel = (el) => { const r = el.getBoundingClientRect(); return [r.top - t, r.bottom - t]; };
    const firstRow = printRef.current.querySelector('.inv-table tbody tr');
    const sig = printRef.current.querySelector('.inv-signature, [data-pdf-signature]');
    window.__lastPdfLayout = {
      pageHeight: contentHeightMulti * domContainerWidth / contentWidth,
      fullHeight: contentHeightFull * domContainerWidth / contentWidth,
      total: mainCanvas.height * domContainerWidth / mainCanvas.width,
      ends: [],
      rowHeight: firstRow ? rel(firstRow)[1] - rel(firstRow)[0] : 0,
      signature: sig ? rel(sig) : null,
      blocks: [...printRef.current.querySelectorAll('.inv-footer-block')].map(rel).filter(([a, b]) => b - a > 2),
      atoms: [...printRef.current.querySelectorAll('.inv-signature, img, [data-pdf-page-boundary]')].map(rel).filter(([a, b]) => b - a > 2),
    };
  } catch { /* test hook only */ }

  // v1.10.77 (#88) - a page that is only slightly too tall (up to 6%) is
  // shrunk to fit, instead of sending the footer to a page of its own: a
  // 4px overflow used to move the terms, bank details and signature to page 2.
  const fitsOnePage = scaledImgHeight <= contentHeightFull + 2
    || (paperCfg.kind !== 'thermal' && scaledImgHeight <= contentHeightFull * 1.06);
  if (window.__lastPdfLayout) window.__lastPdfLayout.onePage = fitsOnePage;
  if (fitsOnePage) {
    // Single-page fits — no cropping needed. Page 1 has no header/footer
    // bands so we can use the full page height (no v1.10.45 reserve).
    const mainImg = mainCanvas.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
    const fit = paperCfg.kind === 'thermal' ? 1 : Math.min(1, contentHeightFull / scaledImgHeight);
    const finalH = paperCfg.kind === 'thermal' ? Math.min(scaledImgHeight, contentHeightFull) : scaledImgHeight * fit;
    const finalW = contentWidth * fit;
    const finalX = contentXOffset + (contentWidth - finalW) / 2;
    // v1.10.33 — Thermal receipts: replace the padded 72×297mm page
    // with one exactly tall enough for the actual receipt content.
    // Prior behaviour: a 40-line receipt on thermal80 produced a PDF
    // with the receipt in the top ~130mm and 165mm of blank paper
    // below — visible in Chrome's Save-as-PDF preview as the huge
    // dark area below the "cut here" line the user reported. Now
    // the PDF page height matches the receipt height (+ margins),
    // so the PDF looks like the on-screen preview.
    //
    // Only fires for the single-page path — multi-page thermal
    // (extremely long receipts) still uses paperCfg.heightMm as a
    // reasonable page-break unit.
    if (paperCfg.kind === 'thermal') {
      const thermalHeightMm = Math.max(30, Math.ceil(finalH + mTop + mBottom + 2));
      pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [paperCfg.widthMm, thermalHeightMm],
        compress: true,
      });
    }
    pdf.addImage(mainImg, imgFormat, finalX, contentYOffset, finalW, finalH, undefined, 'MEDIUM');
    pageRecipes.push({ img: mainImg, y: contentYOffset, h: finalH, x: finalX, w: finalW });
  } else {
    // v1.10.8 multi-page path — snap page breaks to safe DOM row boundaries.
    //
    // 1. Convert DOM-pixel boundaries → canvas-pixel boundaries.
    const domToCanvasScale = mainCanvas.width / domContainerWidth;
    const canvasBoundariesPx = domBoundariesPx.map(y => y * domToCanvasScale);
    const totalCanvasHeightPx = mainCanvas.height;
    if (!canvasBoundariesPx.includes(totalCanvasHeightPx)) {
      canvasBoundariesPx.push(totalCanvasHeightPx);
    }
    canvasBoundariesPx.sort((a, b) => a - b);

    // 2. How many canvas pixels correspond to one CONTENT height?
    // v1.10.9 — was pdfPageHeight * (mainCanvas.width / pdfWidth). Now
    // uses contentHeight (page - top - bottom margins) so page breaks
    // respect the margin band.
    // v1.10.45 — uses contentHeightMulti so page splits also
    // reserve room for the header/footer bands drawn on page 2+.
    const pdfPageHeightCanvasPx = contentHeightMulti * (mainCanvas.width / contentWidth);

    // 3. Walk the canvas top-to-bottom, allocating pages. For each
    //    page: find the largest boundary ≤ naive end, but > current
    //    page start (progress guarantee).
    const pageSplits = [];
    let pageStart = 0;
    let safety = 0;
    while (pageStart < totalCanvasHeightPx && safety++ < 100) {
      const naiveEnd = pageStart + pdfPageHeightCanvasPx;
      if (naiveEnd >= totalCanvasHeightPx) {
        pageSplits.push({ start: pageStart, end: totalCanvasHeightPx });
        break;
      }
      // Prefer the LAST boundary at or before naiveEnd; must exceed pageStart.
      let safeEnd = null;
      for (let i = canvasBoundariesPx.length - 1; i >= 0; i--) {
        const b = canvasBoundariesPx[i];
        if (b <= naiveEnd + 1 && b > pageStart + 20) {   // +20px min progress
          safeEnd = b;
          break;
        }
      }
      // No safe boundary found in range (a single "row" bigger than a page,
      // e.g. a huge terms block). Fall back to a hard slice — but still
      // print SOMETHING rather than looping forever.
      if (safeEnd === null) safeEnd = naiveEnd;
      pageSplits.push({ start: pageStart, end: safeEnd });
      pageStart = safeEnd;
    }

    if (window.__lastPdfLayout) {
      window.__lastPdfLayout.ends = pageSplits.slice(0, -1).map(s => s.end / domToCanvasScale);
    }

    // 4. For each page, crop mainCanvas → temp canvas → data URL → PDF.
    // v1.10.9 — margins; v1.10.10 — pdfFontScale via centred placement.
    // v1.10.45 — page 2+ shifts down by pageHeaderReserve so the
    // business-name header drawn later never overlaps the invoice.
    for (let i = 0; i < pageSplits.length; i++) {
      const { start, end } = pageSplits[i];
      const cropHeight = end - start;
      if (cropHeight < 1) continue;
      const tmp = document.createElement('canvas');
      tmp.width = mainCanvas.width;
      tmp.height = cropHeight;
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tmp.width, cropHeight);
      ctx.drawImage(mainCanvas, 0, -start);
      const pageImg = tmp.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
      const pageMmHeight = (cropHeight * contentWidth) / mainCanvas.width;
      if (i > 0) pdf.addPage();
      const yForThisPage = contentYOffset + (i > 0 ? pageHeaderReserve : 0);
      pdf.addImage(pageImg, imgFormat, contentXOffset, yForThisPage, contentWidth, pageMmHeight, undefined, 'MEDIUM');
      pageRecipes.push({ img: pageImg, y: yForThisPage, h: pageMmHeight, x: contentXOffset, w: contentWidth });
    }
  }

  // Capture each extra section as a separate PDF page (also recipe-tracked).
  // v1.10.45 — Extra pages are always page 2+ so they must reserve room
  // for the header/footer bands too. Otherwise attached rich-text pages
  // hit the same "business name overlaps content" bug as multi-page
  // splits. yOffset shifts the image below the header band; the max
  // height clamps to the reduced available area.
  const extraYOffset = pageHeaderReserve;
  const extraMaxH = Math.max(20, pdfPageHeight - extraYOffset - pageFooterReserve);
  for (const pageEl of extraPages) {
    const c = await html2canvas(pageEl, {
      ...captureOptions(pageEl),
      onclone: (cd) => { cd.querySelectorAll('*').forEach(n => { n.style.letterSpacing = '0px'; n.style.wordSpacing = '0px'; }); }
    });
    const extraImg = c.toDataURL(imgFormat === 'PNG' ? 'image/png' : 'image/jpeg', jpegQuality);
    const extraH = Math.min((c.height * pdfWidth) / c.width, extraMaxH);
    pdf.addPage();
    pdf.addImage(extraImg, imgFormat, 0, extraYOffset, pdfWidth, extraH, undefined, 'MEDIUM');
    pageRecipes.push({ img: extraImg, y: extraYOffset, h: extraH });
  }

  // v1.10.3 — scalerEl restoration moved to buildInvoicePDF's `finally`
  // block so it runs even if a later step throws.

  // ============================================================
  // v1.9.0 post-processing — every step below is toggleable via
  // printSettings. Priority order is:
  //   1. Add margins (visual white border, if user set them)
  //   2. Multi-copy expansion (Original / Duplicate / Triplicate)
  //   3. Watermark overlay
  //   4. Reprint indicator
  //   5. Barcode / QR of invoice number
  //   6. Feedback QR
  //   7. Page numbers + business header on subsequent pages
  // ============================================================
  const ps = printSettings; // captured from closure below

  // ----- Multi-copy (Original / Duplicate / Triplicate) -----
  // GST Rule 48 for goods: 3 copies. For services: 2 copies.
  // v1.10.3 — Rebuilt to correctly duplicate multi-page invoices. See
  // pageRecipes comment above for background.
  if (ps.multiCopyEnabled && ps.multiCopyCount > 1) {
    const labels = ps.multiCopyLabels || ['ORIGINAL', 'DUPLICATE', 'TRIPLICATE'];
    const originalPageCount = pageRecipes.length;   // correct: 1 recipe per original page
    // Replay every original page for each additional copy.
    for (let copyIdx = 1; copyIdx < ps.multiCopyCount; copyIdx++) {
      for (const recipe of pageRecipes) {
        pdf.addPage();
        // v1.10.9 — margins carry through to duplicated copies via
        // recipe.x/w (fallback to 0/pdfWidth for legacy shapes).
        pdf.addImage(recipe.img, imgFormat,
          recipe.x ?? 0, recipe.y,
          recipe.w ?? pdfWidth, recipe.h,
          undefined, 'MEDIUM');
      }
    }
    // Now stamp corner labels using a math that actually corresponds
    // to which copy each page belongs to (was wrong before too).
    const totalCopies = ps.multiCopyCount;
    for (let copyIdx = 0; copyIdx < totalCopies; copyIdx++) {
      const label = labels[Math.min(copyIdx, labels.length - 1)] || `COPY ${copyIdx + 1}`;
      for (let p = 1; p <= originalPageCount; p++) {
        const absolutePage = copyIdx * originalPageCount + p;
        pdf.setPage(absolutePage);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(80, 80, 80);
        const labelWidth = pdf.getTextWidth(label) + 6;
        pdf.setDrawColor(80, 80, 80);
        pdf.setLineWidth(0.3);
        pdf.rect(pdfWidth - labelWidth - 4, 4, labelWidth, 6, 'S');
        pdf.text(label, pdfWidth - labelWidth - 1, 8);
        pdf.setTextColor(0);
      }
    }
  }

  // v1.10.3 — free the multi-megabyte base64 image strings once
  // multi-copy replay is done. Post-processing steps below only
  // mutate the PDF pages, they don't need the source images. Prior
  // code held mainImg + pageRecipes in closure through the whole
  // watermark/QR/page-number loop, doubling peak memory.
  pageRecipes.length = 0;

  // v1.10.12 — Gate the A4/A5-only post-processing on thermal paper.
  // Reports: (a) "watermark coming for thermal also — it should not
  // come", (b) page numbers "Page 2 of 3" don't make sense on a
  // continuous receipt roll, (c) invoice QR / feedback QR crowd out
  // the actual print on 58mm rolls. All post-processing steps below
  // are skipped when the paper is thermal.
  // v1.10.33 note: isThermalPdf is now hoisted to the top of
  // buildPDFInner (see v1.10.46 comment). Original rationale
  // for the check: `.startsWith('thermal')` missed the `custom`
  // preset at sub-100mm widths, so a Custom 76mm PDF got the
  // sheet-only watermark / page numbers / QR overlays that
  // don't belong on a thermal roll.

  // ----- Watermark overlay -----
  // v1.10.12 — Cleaned up the preset ↔ custom decision:
  //   • Custom mode ON  + custom text FILLED   → use custom text.
  //   • Custom mode ON  + custom text EMPTY    → skip (no silent
  //     fallback to preset — that was the confusing behavior
  //     reported as "after selecting predefined then customer
  //     watermark or else it is not working").
  //   • Custom mode OFF → use preset.
  //   • Master toggle OFF or thermal paper       → skip entirely.
  let rawText = null;
  if (!isThermalPdf && ps.watermarkEnabled) {
    if (ps.watermarkUseCustomText) {
      rawText = ps.watermarkCustomText ? ps.watermarkCustomText : null;
    } else {
      rawText = ps.watermarkText || null;
    }
  }
  if (rawText) {
    const text = String(rawText).toUpperCase();
    const opacity = Math.max(0, Math.min(1, (Number(ps.watermarkOpacity) || 15) / 100));
    const angle = Number(ps.watermarkAngle) || -35;
    const size = Number(ps.watermarkFontSize) || 90;
    const finalPages = pdf.getNumberOfPages();
    for (let p = 1; p <= finalPages; p++) {
      pdf.setPage(p);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(size);
      // jsPDF opacity via GState (setGState)
      try {
        const gState = new pdf.GState({ opacity });
        pdf.setGState(gState);
      } catch { /* older jsPDF versions — fallback to grey text */ }
      pdf.setTextColor(200, 200, 200);
      // Center the watermark on the page
      const cx = pdfWidth / 2;
      const cy = pdfPageHeight / 2;
      pdf.text(text, cx, cy, { align: 'center', angle });
      try {
        const gState = new pdf.GState({ opacity: 1 });
        pdf.setGState(gState);
      } catch { /* no-op */ }
      pdf.setTextColor(0);
    }
  }

  // ----- Reprint indicator (automatic when this bill has been printed before) -----
  // v1.10.41 — Reported: "REPRINT · Copy #2" badge was overlapping the
  // business logo in the top-left of the PDF. Root cause: badge was
  // pinned at x=4, y=4 which is exactly where every template's logo
  // sits. Two fixes:
  //   1. Move the badge to the TOP-RIGHT corner (pageWidth - w - 4)
  //      so it never fights the logo for space.
  //   2. Default reprintLabelEnabled = false (see printSettings.js) so
  //      users don't get the surprise stamp on every second download.
  //      Only retail/restaurant users who genuinely need POS reprint
  //      tracking will turn it on — the Print Settings toggle is
  //      already gated to those business types.
  if (!archive && !isThermalPdf && ps.reprintLabelEnabled && Number(editingBill?.printedCount) > 0) {
    const label = `REPRINT · Copy #${(Number(editingBill.printedCount) || 0) + 1}`;
    const finalPages = pdf.getNumberOfPages();
    const pageWidthMm = pdf.internal.pageSize.getWidth();
    for (let p = 1; p <= finalPages; p++) {
      pdf.setPage(p);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(220, 38, 38);
      const w = pdf.getTextWidth(label) + 4;
      const x = pageWidthMm - w - 4;  // top-right corner
      pdf.setDrawColor(220, 38, 38);
      pdf.rect(x, 4, w, 6, 'S');
      pdf.text(label, x + 2, 8);
      pdf.setTextColor(0);
    }
  }

  // ----- Barcode / QR of invoice number -----
  if (!isThermalPdf && (ps.invoiceQrEnabled || ps.invoiceBarcodeEnabled)) {
    // Use the qrcode library that's already a dep for UPI QR
    const QRCode = (await import('qrcode')).default;
    const qrPayload = ps.invoiceQrUrl
      ? ps.invoiceQrUrl.replace(/\{invoice_number\}/g, encodeURIComponent(details.invoiceNumber))
      : details.invoiceNumber;
    if (ps.invoiceQrEnabled) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 0, width: 200 });
        pdf.setPage(pdf.getNumberOfPages());
        const size = 18; // mm
        pdf.addImage(qrDataUrl, 'PNG', pdfWidth - size - 6, pdfPageHeight - size - 12, size, size);
        pdf.setFontSize(6); pdf.setTextColor(80);
        pdf.text('Verify invoice', pdfWidth - size - 6, pdfPageHeight - 6);
        pdf.setTextColor(0);
      } catch { /* skip on error */ }
    }
    // "Barcode" — jsPDF can't render true Code128 without a lib, so we render
    // a big monospace text version of the invoice number that scans as OCR-able
    // and is legible for humans + warehouse workflows.
    if (ps.invoiceBarcodeEnabled) {
      pdf.setPage(pdf.getNumberOfPages());
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(14);
      pdf.setTextColor(0);
      pdf.text(String(details.invoiceNumber), 8, pdfPageHeight - 6);
    }
  }

  // ----- Feedback / Review QR -----
  if (!isThermalPdf && ps.feedbackQrEnabled && ps.feedbackQrUrl) {
    const QRCode = (await import('qrcode')).default;
    try {
      const dataUrl = await QRCode.toDataURL(ps.feedbackQrUrl, { errorCorrectionLevel: 'M', margin: 0, width: 200 });
      pdf.setPage(pdf.getNumberOfPages());
      const size = 16;
      pdf.addImage(dataUrl, 'PNG', 6, pdfPageHeight - size - 12, size, size);
      pdf.setFontSize(6); pdf.setTextColor(80);
      pdf.text(ps.feedbackQrLabel || 'Rate us', 6, pdfPageHeight - 6);
      pdf.setTextColor(0);
    } catch { /* skip */ }
  }

  // ----- Page numbers + business header on subsequent pages -----
  if (!isThermalPdf && (ps.pageNumbersEnabled || ps.pageHeaderEnabled) && pdf.getNumberOfPages() > 1) {
    const finalPages = pdf.getNumberOfPages();
    for (let p = 2; p <= finalPages; p++) {
      pdf.setPage(p);
      if (ps.pageHeaderEnabled && profile?.businessName) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(80);
        pdf.text(profile.businessName, 8, 6);
        pdf.setDrawColor(200); pdf.setLineWidth(0.2);
        pdf.line(8, 8, pdfWidth - 8, 8);
        pdf.setTextColor(0);
      }
      if (ps.pageNumbersEnabled) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(120);
        pdf.text(`Page ${p} of ${finalPages}`, pdfWidth - 8, pdfPageHeight - 4, { align: 'right' });
        pdf.setTextColor(0);
      }
    }
  }

  return pdf;
}
