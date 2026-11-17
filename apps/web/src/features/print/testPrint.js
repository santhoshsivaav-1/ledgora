// Test-print pipeline for PrintSettings' "Test Print" button.
//
// Moved verbatim out of PrintSettings.jsx (v-split): the capture +
// raster + jsPDF + hidden-iframe print flow is self-contained once the
// caller hands over the preview DOM node and the buffer-safe flag.
// The caller keeps the timing (300ms render delay), the "Preview not
// ready" toast and the catch/toast error path.

// v1.10.3 — await fonts + capped scale + blob leak fix.
// v1.10.11 — buffer-safe mode lowers the scale + JPEG quality
// and grayscales the capture so old thermal printers with
// small buffers can accept it.
export async function captureAndPrintThermal(node, bufSafe) {
  const { jsPDF } = await import('jspdf');
  const html2canvas = (await import('html2canvas')).default;

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* non-fatal */ }
  }
  const capScale = bufSafe
    ? 2
    : Math.min(6, Math.max(2, Math.round((window.devicePixelRatio || 1) * 1.5)));
  const canvas = await html2canvas(node, {
    scale: capScale,
    backgroundColor: '#ffffff', useCORS: false, logging: false,
  });
  // Grayscale the canvas in-place when buffer-safe is on. This
  // simplifies the raster the printer driver needs to process.
  if (bufSafe) {
    try {
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        // Luminosity method; also boost contrast so grays snap to B/W.
        const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const v = gray < 180 ? 0 : 255;   // hard threshold for dot-matrix feel
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(img, 0, 0);
    } catch { /* CORS-tainted canvas can't be read; fall back to raw */ }
  }
  const width = 80;
  const height = (canvas.height * width) / canvas.width;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, Math.max(150, height)] });
  const jpegQ = bufSafe ? 0.72 : 0.95;
  pdf.addImage(canvas.toDataURL('image/jpeg', jpegQ), 'JPEG', 0, 0, width, height, undefined, 'FAST');

  // v1.10.3 — blob URL revoked in `finally`-equivalent (timer +
  // load handler both trigger cleanup once). Prior code only
  // revoked in onload; if the iframe never loaded (blocked, bad
  // PDF), the blob URL leaked forever.
  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { cleaned = true; URL.revokeObjectURL(url); } };
  const timer = setTimeout(cleanup, 90_000);
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
    setTimeout(() => { clearTimeout(timer); cleanup(); }, 60_000);
  };
  frame.onerror = () => { clearTimeout(timer); cleanup(); };
}
