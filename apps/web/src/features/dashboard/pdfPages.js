// Extracted from Dashboard.jsx (audit Phase 3: no file over 800 lines).
// The canvas → A4 page slicing helpers shared by the single-bill PDF blob
// (share flows) and the bulk PDF export.

// v1.10.13 — `bg` values switched from opaque tints (#fffbeb / #f5f3ff /
// etc.) to translucent alpha versions of the accent color. Reason:
// prior hex backgrounds were LIGHT-MODE ONLY. In dark mode the status
// pills appeared as pale rectangles on the dark row background — the
// user reported "NEW ISSUE IN CASE OF DARK MODE". rgba() with 12%
// alpha lets the underlying row bg show through and works in both
// themes.
// v1.10.79 - put a captured invoice on A4 pages. It used to be drawn into one
// page whatever its height (`Math.min(h, 297)`), so a long invoice shared on
// WhatsApp or in Bulk PDF came out squashed into a single page. Now each
// 297 mm slice is its own page.
// `breaks` are canvas heights where a page may end (row and block bottoms,
// see safeBreaks): a page ends at the last one that fits, so rows and the
// signature are not cut in half.
export function addCanvasAsA4Pages(doc, canvas, startOnNewPage, breaks = []) {
  const pageW = 210;
  const pageH = 297;
  const slicePx = Math.floor((canvas.width * pageH) / pageW);
  for (let y = 0, page = 0; y < canvas.height; page++) {
    let h = Math.min(slicePx, canvas.height - y);
    if (y + h < canvas.height) {
      const cut = breaks.filter((b) => b > y + slicePx * 0.5 && b <= y + slicePx).pop();
      if (cut) h = cut - y;
    }
    if (page > 0 && h < 4) break; // a sliver of white margin is not worth a page
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    const ctx = slice.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (page > 0 || startOnNewPage) doc.addPage();
    doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (h * pageW) / canvas.width, undefined, 'FAST');
    y += h;
  }
}

// Heights (in canvas pixels) where a page may end: the bottom of each table
// row and of each block the editor's own PDF also keeps whole.
export function safeBreaks(el, canvas) {
  const top = el.getBoundingClientRect().top;
  const scale = canvas.height / Math.max(1, el.getBoundingClientRect().height);
  return [...el.querySelectorAll('tr, .inv-footer-block, [data-pdf-page-boundary], .inv-signature')]
    .map((n) => Math.round((n.getBoundingClientRect().bottom - top) * scale))
    .filter((b) => b > 0 && b < canvas.height)
    .sort((a, b) => a - b);
}
