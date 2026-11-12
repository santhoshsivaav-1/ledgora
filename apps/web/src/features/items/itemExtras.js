import { SETTINGS } from '@ledgora/contracts';
import { STOCK_SIGN, debitNoteMovesStock } from '@ledgora/tax-engine';

// The item fields that Settings > Item and Settings > Party turn on: MRP, wholesale price, secondary unit, barcode,
// batches and serial numbers, item-wise discount and party-wise rates. Pure, so every rule is tested without a browser.
//
// A product keeps them as plain fields:
//   mrp, wholesalePrice, wholesaleMinQty, altUnit, altFactor (1 primary unit = altFactor secondary units), barcode,
//   image (a small data URL), regionalName, discountPercent,
//   batches: [{ batchNo, mfgDate, expDate, qty }]   opening batches
//   serials: ['SN1', ...]                             opening serial numbers
// A bill or purchase line carries what was picked: mrp, batchNo, mfgDate, expDate, serials (array), unitFactor.
// Batch and serial stock are worked out from the documents (opening + bought − sold), never stored, so an edit or a
// delete can not leave them wrong.

const on = (s, key) => (s && key in s ? s[key] : SETTINGS[key]?.default);
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Which extra boxes the product form shows. */
export const itemExtraVisibility = (s = {}) => ({
  mrp: !!on(s, 'item.mrp'),
  wholesale: !!on(s, 'item.wholesale'),
  altUnit: !!on(s, 'item.altUnit'),
  image: !!on(s, 'item.image'),
  barcode: !!on(s, 'item.barcode') || !!on(s, 'txn.barcodeScan'),
  batch: !!on(s, 'item.batch'),
  serial: !!on(s, 'item.serial'),
  discount: !!on(s, 'item.discount'),
  regional: !!on(s, 'print.regional'),
});

/**
 * The rate a sale line starts with when a product is picked, and why:
 *   1. the party's own rate for the item (Settings > Party > Party-wise item rate),
 *   2. the wholesale price once the quantity reaches the wholesale minimum (Settings > Item > Wholesale price),
 *   3. the selling price.
 * A line in the secondary unit gets the rate divided by the conversion.
 */
export function lineRateFor(product, { qty = 1, partyRates = null, unit = null, s = {} } = {}) {
  if (!product) return { rate: 0, source: 'sale' };
  const sale = Number(product.sellingPrice ?? product.rate) || 0;
  let rate = sale;
  let source = 'sale';
  const partyRate = num(partyRates?.[product.id]);
  const wholesale = num(product.wholesalePrice);
  const minQty = num(product.wholesaleMinQty);
  const baseQty = isAltUnit(product, unit) ? (Number(qty) || 0) / Number(product.altFactor) : Number(qty) || 0;
  if (on(s, 'party.itemRates') && partyRate > 0) {
    rate = partyRate;
    source = 'party';
  } else if (on(s, 'item.wholesale') && wholesale > 0 && minQty > 0 && baseQty >= minQty) {
    rate = wholesale;
    source = 'wholesale';
  }
  if (isAltUnit(product, unit)) rate = r2(rate / Number(product.altFactor));
  return { rate, source };
}

/** Is `unit` the product's secondary unit (with a valid conversion)? */
export const isAltUnit = (product, unit) =>
  !!product?.altUnit && Number(product?.altFactor) > 0 && !!unit && norm(unit) === norm(product.altUnit) && norm(unit) !== norm(product.unit);

/** The stock factor a line in `unit` carries: 1 for the primary unit, 1/altFactor for the secondary one. */
export const unitFactorFor = (product, unit) => (isAltUnit(product, unit) ? 1 / Number(product.altFactor) : undefined);

/** The units a line of this product can be sold in: the primary one, then the secondary one when set. */
export const unitChoicesFor = (product) => {
  if (!product?.unit) return [];
  return isAltUnit(product, product.altUnit) ? [product.unit, product.altUnit] : [product.unit];
};

/** "1 BOX = 12 PCS", for hints. */
export const altUnitLabel = (product) =>
  product?.altUnit && Number(product?.altFactor) > 0 ? `1 ${product.unit || 'unit'} = ${Number(product.altFactor)} ${product.altUnit}` : '';

/** The product whose barcode is `code` (any case, spaces trimmed), else null. */
export function findByBarcode(products, code) {
  const c = norm(code);
  if (!c) return null;
  return (products || []).find((p) => norm(p.barcode) === c) || null;
}

/** Another product already using this barcode (for the product form), else null. */
export const barcodeTaken = (products, code, ownId) => {
  const c = norm(code);
  if (!c) return null;
  return (products || []).find((p) => p.id !== ownId && norm(p.barcode) === c) || null;
};

/** The item-wise discount a new line starts with (percent), or 0. */
export const itemDiscountFor = (product, s = {}) => {
  const d = num(product?.discountPercent);
  return on(s, 'item.discount') && d > 0 && d <= 100 ? d : 0;
};

// ---- batches -------------------------------------------------------------------------------------------------------

const sameProduct = (product) => {
  const name = norm(product?.name);
  return (line) => (line?.productId ? line.productId === product?.id : !!name && norm(line?.name) === name);
};
const billSign = (b) => {
  const status = b?.status ?? b?.data?.status;
  if (status === 'cancelled') return 0;
  return STOCK_SIGN[b?.invoiceType || b?.data?.invoiceType || 'tax-invoice'] ?? -1;
};
const billLines = (b) => b?.data?.items || b?.items || [];
const lineQty = (it) => (Number(it?.quantity) || 0) * (Number(it?.unitFactor) > 0 ? Number(it.unitFactor) : 1);
// A purchase bill brings stock in; a debit note that returns goods takes it out; an order does neither.
const purchaseSign = (p) => {
  if (!p?.docType || p.docType === 'bill') return 1;
  return p.docType === 'debit-note' && debitNoteMovesStock(p.reason) ? -1 : 0;
};

/**
 * Stock of each batch of a product: opening batches, plus purchase-bill lines with that batch, less sale lines (credit
 * notes put it back). Sorted first-expiring first, so the first batch with stock is the one to sell. `excludeBillId`
 * leaves out the bill being edited, so its own lines do not count against it.
 */
export function batchStock(product, { bills = [], purchases = [], excludeBillId = null } = {}) {
  const map = new Map();
  const touch = (b) => {
    const key = norm(b.batchNo);
    if (!key) return null;
    if (!map.has(key)) map.set(key, { batchNo: String(b.batchNo).trim(), mfgDate: b.mfgDate || '', expDate: b.expDate || '', qty: 0 });
    const row = map.get(key);
    if (!row.expDate && b.expDate) row.expDate = b.expDate;
    if (!row.mfgDate && b.mfgDate) row.mfgDate = b.mfgDate;
    return row;
  };
  for (const b of product?.batches || []) {
    const row = touch(b);
    if (row) row.qty += Number(b.qty) || 0;
  }
  const mine = sameProduct(product);
  for (const p of purchases) {
    const sign = purchaseSign(p);
    if (!sign) continue;
    for (const it of p.items || []) {
      if (!mine(it)) continue;
      const row = touch(it);
      if (row) row.qty += sign * lineQty(it);
    }
  }
  for (const b of bills) {
    if (excludeBillId && b.id === excludeBillId) continue;
    const sign = billSign(b);
    if (!sign) continue;
    for (const it of billLines(b)) {
      if (!mine(it)) continue;
      const row = touch(it);
      if (row) row.qty += sign * lineQty(it);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, qty: r3(r.qty) }))
    .sort((a, c) => (a.expDate || '9999').localeCompare(c.expDate || '9999') || a.batchNo.localeCompare(c.batchNo));
}

/** The batch to suggest for a new line: the first-expiring one with stock that has not expired, else null. */
export function suggestBatch(batches, today) {
  return (batches || []).find((b) => b.qty > 0 && !(b.expDate && b.expDate < today)) || null;
}

/** 'expired', 'soon' (within `days`) or null. */
export function expiryState(expDate, today, days = 30) {
  if (!expDate || !today) return null;
  if (expDate < today) return 'expired';
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return expDate <= t.toISOString().slice(0, 10) ? 'soon' : null;
}

// ---- serial numbers ------------------------------------------------------------------------------------------------

/** Serial numbers typed in a box: separated by commas, spaces or new lines; repeats removed, case kept. */
export function parseSerials(text) {
  if (Array.isArray(text)) return [...new Set(text.map((x) => String(x).trim()).filter(Boolean))];
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    const s = raw.trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

/** Serial numbers of a product in stock: opening and bought, less sold (a credit note puts one back). */
export function serialsInStock(product, { bills = [], purchases = [], excludeBillId = null } = {}) {
  const count = new Map();
  const label = new Map();
  const add = (sn, d) => {
    const k = sn.toLowerCase();
    label.set(k, label.get(k) || sn);
    count.set(k, (count.get(k) || 0) + d);
  };
  for (const sn of parseSerials(product?.serials || [])) add(sn, 1);
  const mine = sameProduct(product);
  for (const p of purchases) {
    const sign = purchaseSign(p);
    if (!sign) continue;
    for (const it of p.items || []) if (mine(it)) for (const sn of parseSerials(it.serials || [])) add(sn, sign);
  }
  for (const b of bills) {
    if (excludeBillId && b.id === excludeBillId) continue;
    const sign = billSign(b);
    if (!sign) continue;
    for (const it of billLines(b)) if (mine(it)) for (const sn of parseSerials(it.serials || [])) add(sn, sign);
  }
  return [...count.entries()].filter(([, c]) => c > 0).map(([k]) => label.get(k));
}

/** What is wrong with the serial numbers on a sale line, as short messages (empty = fine). */
export function serialProblems(line, inStock) {
  const list = parseSerials(line?.serials || []);
  const out = [];
  const qty = Number(line?.quantity) || 0;
  if (list.length !== qty) out.push(`${qty} unit${qty === 1 ? '' : 's'} need${qty === 1 ? 's' : ''} ${qty} serial number${qty === 1 ? '' : 's'}; ${list.length} entered`);
  if (inStock) {
    const have = new Set(inStock.map((x) => x.toLowerCase()));
    const missing = list.filter((sn) => !have.has(sn.toLowerCase()));
    if (missing.length) out.push(`Not in stock: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
  }
  return out;
}

// ---- GST -----------------------------------------------------------------------------------------------------------

/**
 * Settings > GST > HSN digits: a code shorter than the digits the business must report is a problem (turnover above
 * ₹5 crore reports 6 digits on every invoice, up to ₹5 crore 4 on B2B). Empty codes are left to the other checks.
 */
export function hsnDigitsProblem(hsn, digits) {
  const code = String(hsn ?? '').replace(/\s/g, '');
  const need = Number(digits) || 4;
  if (!code) return null;
  if (!/^\d+$/.test(code)) return 'HSN / SAC is digits only';
  return code.length < need ? `HSN / SAC needs at least ${need} digits (Settings › GST)` : null;
}

/** The ITC box a new purchase line starts with (Settings > GST > ITC default). */
export const defaultItcEligible = (s = {}) => on(s, 'gst.itcDefault') !== 'ineligible';

// ---- print ---------------------------------------------------------------------------------------------------------

/**
 * The small lines under an item's name on a printed bill, as Settings > Print decides: the description, the name in a
 * second language, MRP, and batch with its dates and serial numbers. `fmtMoney` formats the MRP.
 */
export function itemSubLines(item, s = {}, fmtMoney = (n) => String(n)) {
  const out = [];
  if (on(s, 'print.regional') && item?.regionalName) out.push(item.regionalName);
  if (on(s, 'print.show.description') && item?.description) out.push(item.description);
  if (on(s, 'print.show.mrp') && Number(item?.mrp) > 0) out.push(`MRP ${fmtMoney(item.mrp)}`);
  if (on(s, 'print.show.batch')) {
    const dates = [item?.mfgDate && `Mfg ${item.mfgDate}`, item?.expDate && `Exp ${item.expDate}`].filter(Boolean).join(', ');
    if (item?.batchNo) out.push(`Batch ${item.batchNo}${dates ? ` (${dates})` : ''}`);
    const sn = parseSerials(item?.serials || []);
    if (sn.length) out.push(`Serial ${sn.join(', ')}`);
  }
  return out;
}

/**
 * What Settings > Print > Payment mode / Party balance / PAID stamp print on a bill: the modes it was paid by, whether it
 * is fully paid, and what the party owed before this bill and owes after it. `others` are the party's other saved
 * bills (`due` = what is still unpaid on each).
 */
export function paymentInfo({ total = 0, payments = [], others = [] } = {}) {
  const paid = payments.reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const modes = [...new Set(payments.filter((p) => Number(p.amount) > 0 && p.mode).map((p) => String(p.mode)))];
  const before = r2(others.reduce((n, b) => n + Math.max(0, Number(b.due) || 0), 0));
  const t = Number(total) || 0;
  return { fullyPaid: t > 0 && paid >= t - 0.005, modes, paid: r2(paid), balanceBefore: before, balanceAfter: r2(before + Math.max(0, t - paid)) };
}
