import { useCallback, useEffect, useRef, useState } from 'react';
import { getPrintSettings, savePrintSettings } from '../../print/printSettingsStore';

// The preview drawer: zoom, fit-to-width and the open/closed state, plus the measurement that reserves exactly
// the preview's natural size × zoom so the scaled preview never overflows its pane.
export function usePreviewDrawer({ printRef }) {
  // v1.9.1 — preview zoom (session-only). Reads from printSettings for the
  // initial value so the user's preference carries across bill switches.
  // v1.10.33 — Was READ-ONLY: the initial-load line pulled from
  // printSettings.previewZoom but nothing ever wrote it back. Every fresh
  // session started at 100% regardless of "sticky" comment. Now persists
  // on every change through the useEffect below. Also added a ref +
  // handleFitToWidth for the "Fit" button that actually fits.
  const previewPaneRef = useRef(null);
  const [previewZoom, setPreviewZoom] = useState(() => {
    try { return Number(getPrintSettings().previewZoom) || 100; } catch { return 100; }
  });
  useEffect(() => {
    try {
      const s = getPrintSettings();
      if (Number(s.previewZoom) !== previewZoom) {
        savePrintSettings({ ...s, previewZoom });
      }
    } catch { /* sandboxed localStorage — session-only degradation ok */ }
  }, [previewZoom]);
  // v1.10.33 — Actual fit-to-width. A4 preview renders at 794px @ 96dpi;
  // narrower paper sizes (A5, thermal, custom) can be smaller so we honor
  // the preview element's natural offsetWidth when possible. Fallback to
  // 794 covers the moment before InvoicePreview has mounted. Scale is
  // clamped 50-200% (matches the +/- limits so users don't get a "Fit"
  // that falls outside the range they can then tweak from).
  //
  // v1.10.33 (v2) — offsetWidth is LAYOUT width, unaffected by
  // `transform: scale(...)`. First cut divided by currentScale which
  // over-corrected on every click ("Fit → 44% → Fit → 24% → …").
  // Just read offsetWidth as-is — it's already the natural (unscaled)
  // width of the preview at the current paper size.
  const handleFitToWidth = useCallback(() => {
    if (!previewPaneRef.current) { setPreviewZoom(100); return; }
    const pane = previewPaneRef.current;
    const scaler = pane.querySelector('.preview-scaler');
    const preview = scaler?.querySelector('.invoice-preview-container');
    const paneWidth = pane.clientWidth - 16; // 8px inset breathing room on each side
    const naturalWidth = preview?.offsetWidth || 794;
    if (!(paneWidth > 0 && naturalWidth > 0)) { setPreviewZoom(100); return; }
    const ratio = paneWidth / naturalWidth;
    const nextZoom = Math.max(50, Math.min(200, Math.round(ratio * 100)));
    setPreviewZoom(nextZoom);
  }, []);
  // v1.10.22 — reported: "sidebar menu toggle option so customer will get
  // a close view for entries because quantity entry u see space is like
  // that we have to see in invoice preview what we are entering". Focus
  // mode: hide the preview so the editor gets the full width during
  // heavy data entry.
  // Document canvas: the preview is a drawer over the sheet, closed by default so the sheet has the page. Esc closes it.
  const [previewCollapsed, setPreviewCollapsed] = useState(() => {
    try { return localStorage.getItem('ledgora_previewDrawerOpen') !== '1'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('ledgora_previewDrawerOpen', previewCollapsed ? '0' : '1'); } catch { /* sandboxed */ }
    if (previewCollapsed) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') setPreviewCollapsed(true); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [previewCollapsed]);
  // v1.10.48 — reported: "live preview show full when browser zoom on 50%".
  // `transform: scale()` shrinks what is PAINTED but never the element's
  // layout box, so the preview kept reserving its full natural width
  // (.invoice-preview-container is a hard `width: 210mm` ≈ 794px) at every
  // zoom level. On a pane narrower than that the sheet overflowed
  // horizontally, and because .preview-pane centres its children the LEFT
  // overflow scrolled out of reach entirely — the user saw a permanently
  // clipped invoice. Dropping the browser to 50% zoom "fixed" it only
  // because it doubles the viewport in CSS px, clearing 794px. That makes
  // this bug purely a function of pane width, so it is invisible on wide
  // monitors and reproduces every time on a 1366px laptop.
  //
  // Fix: measure the preview's natural size and reserve exactly
  // natural × zoom on a wrapper element, so the layout box tracks what is
  // actually painted. The container's width is intrinsic (mm, not %), so
  // sizing an ancestor cannot feed back into it — no observer loop.
  const [previewNatural, setPreviewNatural] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = printRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setPreviewNatural((prev) => (
      prev.w === el.offsetWidth && prev.h === el.offsetHeight
        ? prev
        : { w: el.offsetWidth, h: el.offsetHeight }
    ));
    // No explicit first call: observe() delivers an initial callback with
    // the current size, so the mount measurement comes for free without a
    // synchronous setState in the effect body.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewCollapsed]);
  return { previewPaneRef, previewZoom, setPreviewZoom, previewCollapsed, setPreviewCollapsed, previewNatural, handleFitToWidth };
}
