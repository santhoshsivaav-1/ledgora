// P7-S1: draws barcode labels as SVG (in millimetres) and lays them on a sheet as a printable HTML page. Pure: it
// returns strings from the tax engine's barcode maths, so label contents and positions are testable without a browser.
import QRCode from 'qrcode';
import { barcodeFor, barsOf, layoutLabels } from '@ledgora/tax-engine';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n) || 0)}`;
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const DEFAULT_SHOW = { name: true, price: true, mrp: false, code: true, business: false };

/** A QR code as rows of dark modules: [{ x, y, w }] runs, in module units, plus the side length. Medium error correction. */
export function qrRuns(text) {
  const { size, data } = QRCode.create(String(text), { errorCorrectionLevel: 'M' }).modules;
  const runs = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) { x++; continue; }
      let w = 0;
      while (x + w < size && data[y * size + x + w]) w++;
      runs.push({ x, y, w });
      x += w;
    }
  }
  return { size, runs };
}

/** One label as an <svg> sized in mm. The barcode takes the middle; text above and below as the toggles ask. */
export function labelSvg(item, o) {
  const { sheet, type, show = DEFAULT_SHOW, businessName = '' } = o;
  const w = sheet.labelW;
  const h = sheet.labelH;
  const code = item.code || '';
  let bc;
  const isQr = type === 'qr' && !!code;
  try { bc = code && !isQr ? barcodeFor(code, type) : null; } catch { bc = null; }
  const pad = 1.2;
  const topLines = [show.business && businessName && fit(businessName, 28), show.name && fit(item.name, w > 45 ? 34 : 24)].filter(Boolean);
  const bottomLeft = [show.code && (bc?.text ?? (isQr ? code : '')), show.price && money(item.price), show.mrp && item.mrp ? `MRP ${money(item.mrp)}` : ''].filter(Boolean).join('  ');
  const topH = topLines.length * 3.2;
  const bottomH = bottomLeft ? 3.4 : 0;
  const barsTop = pad + topH;
  const barsH = Math.max(4, h - barsTop - bottomH - pad);
  const quiet = 2; // modules of quiet zone each side
  const modules = bc ? bc.modules.length + quiet * 2 : 1;
  const unit = (w - pad * 2) / modules;
  let qr = '';
  if (isQr) {
    const q = qrRuns(code);
    const side = Math.min(barsH, w - pad * 2);
    const u = side / (q.size + 4); // 2 modules of quiet zone each side
    const left = (w - side) / 2;
    qr = q.runs.map((r) => `<rect x="${(left + (r.x + 2) * u).toFixed(3)}" y="${(barsTop + (r.y + 2) * u).toFixed(3)}" width="${(r.w * u).toFixed(3)}" height="${u.toFixed(3)}"/>`).join('');
  }
  const rects = isQr ? qr : bc ? barsOf(bc.modules).map((b) => `<rect x="${(pad + (b.x + quiet) * unit).toFixed(3)}" y="${barsTop.toFixed(2)}" width="${(b.w * unit).toFixed(3)}" height="${barsH.toFixed(2)}"/>`).join('') : '';
  const texts = topLines.map((t, i) => `<text x="${w / 2}" y="${(pad + 2.6 + i * 3.2).toFixed(2)}" text-anchor="middle" font-size="2.7" font-weight="${i === topLines.length - 1 && show.name ? 700 : 400}">${esc(t)}</text>`).join('');
  const bottom = bottomLeft ? `<text x="${w / 2}" y="${(h - pad - 0.4).toFixed(2)}" text-anchor="middle" font-size="2.6">${esc(bottomLeft)}</text>` : '';
  const none = !bc && !isQr ? `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="2.4">No code</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif" fill="#000">${texts}${rects}${bottom}${none}</svg>`;
}

/** The whole job as a printable page: one absolutely placed label per slot, a CSS page per sheet. */
export function labelsHtml(items, o) {
  const { sheet, copies, startAt } = o;
  const laid = layoutLabels(items, { sheet, copies, startAt });
  const roll = sheet.cols * sheet.rows === 1;
  const pages = laid.pages
    .map((page) => `<section class="page">${page.map((p) => `<div class="lbl" style="left:${p.x}mm;top:${p.y}mm">${labelSvg(p.item, o)}</div>`).join('')}</section>`)
    .join('');
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels</title><style>
@page{size:${roll ? `${sheet.pageW}mm ${sheet.pageH}mm` : 'A4'};margin:0}
html,body{margin:0;padding:0}
.page{position:relative;width:${sheet.pageW}mm;height:${sheet.pageH}mm;overflow:hidden;page-break-after:always;break-after:page}
.lbl{position:absolute;width:${sheet.labelW}mm;height:${sheet.labelH}mm;overflow:hidden}
.lbl svg{display:block}
@media screen{body{background:#eee}.page{background:#fff;margin:8px auto;box-shadow:0 1px 6px rgba(0,0,0,.2)}}
</style></head><body>${pages}</body></html>`,
    pages: laid.pages.length,
    labels: laid.labels,
  };
}

/** Prints through a hidden frame (nothing to be blocked as a pop-up); the browser's print dialog also saves as PDF. */
export function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 3000); };
  if (doc.readyState === 'complete') go(); else frame.onload = go;
}
