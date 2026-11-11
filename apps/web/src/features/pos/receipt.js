// The POS receipt (P12): built from the saved invoice so it always shows what the books hold. 80 mm and 58 mm thermal,
// or A4. Pure: returns an HTML string; printReceipt() puts it in a hidden frame and prints it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const qtyText = (n) => String(Math.round((Number(n) || 0) * 1000) / 1000);
const WIDTH = { '80mm': '76mm', '58mm': '54mm', a4: '190mm' };

export function receiptHtml({ business = {}, invoice, customer = null, change = 0, settings = {}, pointsEarned = 0, pointsBalance = null }) {
  const paper = settings.paper || '80mm';
  const t = invoice?.data?.totals || {};
  const lines = (invoice?.lines || [])
    .map(
      (l) => `<tr><td class="nm" colspan="3">${esc(l.name)}${l.description ? `<br><small>${esc(l.description)}</small>` : ''}</td></tr>
<tr><td>${qtyText(l.quantity)} ${esc(l.unit)} × ${money(l.rate)}</td><td class="c">${l.taxPercent ? `${l.taxPercent}%` : ''}</td><td class="r">${money(l.lineTotal)}</td></tr>`,
    )
    .join('');
  const tax = [
    ['CGST', invoice?.cgst],
    ['SGST', invoice?.sgst],
    ['IGST', invoice?.igst],
    ['Cess', invoice?.cess],
  ]
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `<tr><td>${k}</td><td class="r">${money(v)}</td></tr>`)
    .join('');
  const pays = (invoice?.payments || []).map((p) => `<tr><td>${esc(String(p.mode).toUpperCase())}</td><td class="r">${money(p.amount)}</td></tr>`).join('');
  const due = Math.max(0, (Number(invoice?.total) || 0) - (Number(invoice?.paidAmount) || 0));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoice?.number)}</title><style>
@page{size:${paper === 'a4' ? 'A4' : `${paper} auto`};margin:${paper === 'a4' ? '12mm' : '2mm'}}
body{font:${paper === '58mm' ? '10px' : '12px'}/1.35 ui-monospace,Menlo,Consolas,monospace;width:${WIDTH[paper] || WIDTH['80mm']};margin:0 auto;color:#000}
h1{font-size:1.25em;text-align:center;margin:0}.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}
td{padding:1px 0;vertical-align:top}.nm{font-weight:600}hr{border:0;border-top:1px dashed #000;margin:4px 0}.big td{font-size:1.2em;font-weight:700}small{font-weight:400}
</style></head><body>
<h1>${esc(business.businessName || business.name || '')}</h1>
<div class="c">${esc(business.address || '')}${business.phone ? `<br>Ph ${esc(business.phone)}` : ''}${business.gstin ? `<br>GSTIN ${esc(business.gstin)}` : ''}</div>
<hr><div class="c"><b>TAX INVOICE</b></div>
<table><tr><td>Bill ${esc(invoice?.number)}</td><td class="r">${esc(invoice?.invoiceDate)}</td></tr>${customer?.name ? `<tr><td colspan="2">${esc(customer.name)}${customer.phone ? ` · ${esc(customer.phone)}` : ''}</td></tr>` : ''}</table>
<hr><table>${lines}</table><hr>
<table><tr><td>Taxable</td><td class="r">${money(invoice?.taxableAmount)}</td></tr>${tax}${Number(t.roundOff) ? `<tr><td>Round off</td><td class="r">${money(t.roundOff)}</td></tr>` : ''}
<tr class="big"><td>TOTAL</td><td class="r">₹${money(invoice?.total)}</td></tr></table><hr>
<table>${pays}${change > 0 ? `<tr><td>Change returned</td><td class="r">${money(change)}</td></tr>` : ''}${due > 0.004 ? `<tr><td><b>Balance due</b></td><td class="r"><b>${money(due)}</b></td></tr>` : ''}</table>
${pointsEarned > 0 || pointsBalance ? `<div class="c">Points earned ${pointsEarned} · balance ${pointsBalance ?? 0}</div>` : ''}
${invoice?.notes ? `<div>${esc(invoice.notes)}</div>` : ''}<hr><div class="c">${esc(settings.receiptFooter || '')}</div>
</body></html>`;
}

/** Prints the receipt through a hidden frame (no pop-up window to be blocked). */
export function printReceipt(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 2000);
  };
  if (doc.readyState === 'complete') go();
  else frame.onload = go;
}
