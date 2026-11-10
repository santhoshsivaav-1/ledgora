// A one-page PDF of a purchase document: bill, purchase order (P3-S3) or debit note (P3-S4). Moved here from
// PurchaseBills (v1.10.29) so all three print the same way. jsPDF's text/rect helpers only, no autotable, to keep the
// bundle small.

import { getPrintSettings } from '../print/printSettingsStore';
import { toast } from '../../components/ui/Toast';
import { purchaseFormTotals } from './purchaseExtras';

// v1.10.31 — UI-C3: the user's brand colour for the header rule and totals line.
export function getAccentRGB() {
  try {
    const ps = getPrintSettings();
    if (ps.userColorsEnabled && ps.pdfAccent) {
      const hex = String(ps.pdfAccent).replace('#', '');
      if (/^[0-9a-f]{6}$/i.test(hex)) {
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
      }
    }
  } catch { /* ignore */ }
  return [30, 64, 175];
}

const REASONS = { 'purchase-return': 'Purchase return', 'rate-difference': 'Rate difference', quality: 'Quality issue', other: 'Other' };
const REFUNDS = { adjust: 'Adjusted against payable', cash: 'Cash refund', bank: 'Bank refund' };
const dateText = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');

/** The header lines under the title, by document type. */
function headerLines(p) {
  const type = p.docType || 'bill';
  if (type === 'order') {
    return [
      `PO #: ${p.number || '-'}`,
      `Order date: ${dateText(p.date)}${p.expectedDate ? `   ·   Expected: ${dateText(p.expectedDate)}` : ''}`,
      `${p.status === 'cancelled' ? 'Cancelled' : 'Open'}${p.advance ? `   ·   Advance paid: ${Number(p.advance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : ''}`,
    ];
  }
  if (type === 'debit-note') {
    return [
      `Debit note #: ${p.number || '-'}`,
      `Date: ${dateText(p.date)}${p.againstNumber ? `   ·   Against bill: ${p.againstNumber}` : ''}`,
      `Reason: ${REASONS[p.reason] || p.reason || '-'}   ·   ${REFUNDS[p.refundMode || 'adjust']}`,
    ];
  }
  return [
    `Invoice #: ${p.invoiceNumber || '-'}${p.number ? `   ·   Our ref: ${p.number}` : ''}`,
    `Date: ${dateText(p.date)}${p.dueDate ? `   ·   Due: ${dateText(p.dueDate)}` : ''}`,
    `Payment: ${p.paymentStatus || 'Unpaid'}   ·   ${p.interstate ? 'Interstate (IGST)' : 'Intrastate (CGST+SGST)'}${p.reverseCharge ? '   ·   Reverse charge' : ''}`,
  ];
}

export async function purchaseDocPdf(purchase, { title = 'PURCHASE BILL', accent = getAccentRGB() } = {}) {
  try {
    const { jsPDF } = await import('jspdf');
    const t = purchaseFormTotals(purchase.items, { applyRoundOff: !!purchase.applyRoundOff, charges: purchase.charges, tds194QPercent: purchase.tds194QPercent });
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const marginL = 15, marginR = 195;
    let y = 20;
    const fmt = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text(title, marginL, y); y += 8;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    for (const line of headerLines(purchase)) { doc.text(line, marginL, y); y += 5; }
    y += 3;
    doc.setDrawColor(...accent); doc.setLineWidth(0.5);
    doc.line(marginL, y, marginR, y); y += 8;

    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text('Supplier', marginL, y); y += 6;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text(purchase.supplierName || '-', marginL, y); y += 5;
    // v1.10.29 — supplier address (wraps at ~110mm so it doesn't collide with anything on the right).
    if (purchase.supplierAddress) {
      const wrapped = doc.splitTextToSize(purchase.supplierAddress, 110);
      wrapped.forEach((line) => { doc.text(line, marginL, y); y += 5; });
    }
    if (purchase.supplierGstin) { doc.text(`GSTIN: ${purchase.supplierGstin}`, marginL, y); y += 5; }
    y += 4;

    // Items header
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('#', marginL, y);
    doc.text('Description', marginL + 8, y);
    doc.text('HSN', marginL + 80, y);
    doc.text('Qty', marginL + 100, y, { align: 'right' });
    doc.text('Rate', marginL + 122, y, { align: 'right' });
    doc.text('GST%', marginL + 140, y, { align: 'right' });
    doc.text('Amount', marginR, y, { align: 'right' });
    y += 2; doc.setLineWidth(0.2); doc.line(marginL, y, marginR, y); y += 5;

    doc.setFont('helvetica', 'normal');
    (purchase.items || []).forEach((item, idx) => {
      if (y > 265) { doc.addPage(); y = 20; }
      const lineTotal = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
      const withTax = lineTotal * (1 + (Number(item.taxPercent) || 0) / 100);
      // v1.10.30 — long names wrap in a 70mm column; the row grows to fit.
      const nameLines = doc.splitTextToSize(String(item.name || '-'), 70);
      const rowH = Math.max(6, nameLines.length * 4.5);
      if (y + rowH > 275) { doc.addPage(); y = 20; }
      doc.text(String(idx + 1), marginL, y);
      nameLines.forEach((line, lineIdx) => { doc.text(line, marginL + 8, y + lineIdx * 4.5); });
      doc.text(String(item.hsn || '-'), marginL + 80, y);
      doc.text(String(item.quantity || 0), marginL + 100, y, { align: 'right' });
      doc.text(fmt(item.rate), marginL + 122, y, { align: 'right' });
      doc.text(String(item.taxPercent || 0) + '%', marginL + 140, y, { align: 'right' });
      doc.text(fmt(withTax), marginR, y, { align: 'right' });
      y += rowH;
    });

    // Totals
    y += 4; doc.setDrawColor(...accent); doc.setLineWidth(0.4);
    doc.line(marginL + 100, y, marginR, y); y += 6;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
    const row = (label, value) => { doc.text(label, marginL + 100, y); doc.text(value, marginR, y, { align: 'right' }); y += 5; };
    row('Taxable', fmt(t.taxable));
    if (t.chargesTaxable > 0.005) row('incl. charges', fmt(t.chargesTaxable));
    // v1.10.74 - the tax split instead of one combined line.
    if (purchase.interstate) row('IGST', fmt(t.tax));
    else { row('CGST', fmt(t.tax / 2)); row('SGST', fmt(t.tax / 2)); }
    if (t.cess > 0.005) row('Cess', fmt(t.cess));
    if (Math.abs(t.roundOff) > 0.005) row('Round-off', (t.roundOff > 0 ? '+' : '') + fmt(t.roundOff));
    y += 2; doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(marginL + 100, y, marginR, y); y += 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
    doc.text('TOTAL', marginL + 100, y); doc.text(fmt(t.finalTotal), marginR, y, { align: 'right' });
    if (t.tdsAmount > 0) {
      y += 6; doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80);
      row('Less TDS §194Q', `- ${fmt(t.tdsAmount)}`);
      doc.setFont('helvetica', 'bold'); row('Payable', fmt(t.payable));
    }

    const note = purchase.note || purchase.notes;
    if (note) {
      y += 14; doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(90);
      doc.text('Note: ' + note, marginL, y);
    }

    const ref = purchase.docType === 'order' || purchase.docType === 'debit-note' ? purchase.number : purchase.invoiceNumber;
    const safe = String(ref || 'purchase').replace(/[^A-Za-z0-9._-]/g, '_');
    const kind = purchase.docType === 'order' ? 'PO' : purchase.docType === 'debit-note' ? 'DebitNote' : 'Purchase';
    doc.save(`${kind}-${safe}-${purchase.date || 'undated'}.pdf`);
  } catch (err) {
    console.error('Purchase PDF failed:', err);
    toast('Could not generate PDF — see console', 'error');
  }
}
