import { SETTINGS } from '@ledgora/contracts';

// Settings > Print / Transaction / GST / Taxes decide what a NEW bill starts with. Only a value the owner changed from the
// registry default is applied, so a business that never opened Settings sees exactly what it saw before. A bill that is
// already saved keeps its own options, and every choice can still be changed per bill in the editor.

const PAPER = { a4: 'a4', a5: 'a5', thermal2: 'thermal58', thermal3: 'thermal80' };
const LANDSCAPE = { a4: 'a4Landscape', a5: 'a5Landscape' };

/** The invoice options a new bill starts with, from the business's settings object. */
export function optionDefaultsFrom(s = {}) {
  const changed = (key) => key in s && s[key] !== SETTINGS[key].default;
  const out = {};
  const map = {
    'print.show.hsn': 'showHSN',
    'print.show.upiQr': 'showUPI',
    'print.show.bank': 'showBankDetails',
    'print.show.amountInWords': 'showAmountWords',
    'print.show.signature': 'showSignature',
    'gst.pos': 'showPlaceOfSupply',
  };
  for (const [key, opt] of Object.entries(map)) if (changed(key)) out[opt] = s[key];
  if (changed('print.template')) out.pdfStyle = s['print.template'];
  if (changed('print.paper') || changed('print.orientation')) {
    const paper = s['print.paper'] ?? SETTINGS['print.paper'].default;
    out.paperSize =
      s['print.orientation'] === 'landscape' && LANDSCAPE[paper] ? LANDSCAPE[paper] : PAPER[paper];
  }
  if (changed('gst.enabled') && s['gst.enabled'] === false) out.showGST = false;
  if (changed('txn.roundOff')) out.showRoundOff = s['txn.roundOff'] !== 'off';
  if (changed('gst.tcs') && s['gst.tcs'] === true) out.showTCS = true;
  if (changed('txn.discountMode') && s['txn.discountMode'] === 'transaction') out.showDiscount = false;
  return out;
}

/** Which discount boxes the editor shows: on each line, on the whole bill, in percent, in rupees. */
export function discountRules(s = {}) {
  const mode = s['txn.discountMode'] ?? 'both';
  const unit = s['txn.discountUnit'] ?? 'both';
  return {
    line: mode !== 'transaction',
    bill: mode !== 'line',
    percent: unit !== 'amount',
    amount: unit !== 'percent',
  };
}

/**
 * What Settings > Print layers over the print-settings store (thermal and PDF options kept per business): copies with
 * their GST rule 48 labels, and the footer line. An untouched setting adds nothing, so a saved layout is never overridden
 * by a default.
 */
export function printOverlayFrom(s = {}) {
  const out = {};
  const count = { duplicate: 2, triplicate: 3 }[s['print.copies']];
  if (count) Object.assign(out, { multiCopyEnabled: true, multiCopyCount: count });
  const footer = (s['print.footer'] ?? '').trim();
  if (footer) out.footerMessage = footer;
  return out;
}

/** The default terms text as the rich editor's HTML (one paragraph per line, markup escaped). */
export function termsHtmlFrom(text) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');
}

const PO_FIELDS = ['buyerOrderNo', 'buyerOrderDate', 'referenceNo', 'otherReferences', 'revisionNo'];
const TRANSPORT_FIELDS = ['vehicleNo', 'dispatchedThrough', 'destination', 'dispatchDocNo', 'deliveryNote', 'deliveryNoteDate', 'deliveryTerms'];

/** The order/dispatch boxes to show: PO ones follow "Customer PO details", transport ones "Transport details". A box that already holds text stays visible. */
export function visibleOrderFields(fields, s = {}, details = {}) {
  const po = s['txn.poDetails'] ?? true;
  const transport = s['txn.transport'] ?? true;
  return fields.filter((f) => {
    if (String(details[f.key] ?? '').trim()) return true;
    if (PO_FIELDS.includes(f.key)) return po;
    if (TRANSPORT_FIELDS.includes(f.key)) return transport;
    return true;
  });
}

/** Selling less buying on the bill's lines whose product has a purchase price (before tax, ignoring line discounts). Null when no line has one. */
export function estimatedProfit(items = [], products = []) {
  const byId = new Map(products.map((p) => [p.id, p]));
  let any = false;
  let profit = 0;
  for (const it of items) {
    const buy = Number(byId.get(it.productId)?.purchasePrice);
    if (!Number.isFinite(buy) || buy <= 0) continue;
    any = true;
    profit += (Number(it.quantity) || 0) * ((Number(it.rate) || 0) - buy);
  }
  return any ? Math.round(profit * 100) / 100 : null;
}
