// Return tables built from the period's documents, kept free of React so they can be tested on their own:
//   GSTR-1 Table 8  - nil-rated, exempt and non-GST outward supplies (the bills of supply). Also GSTR-3B 3.1(c).
//   GSTR-1 Table 6A - exports (zero-rated supply to a client outside India).
//   GSTR-3B Table 4 - input tax credit from purchases and expenses (Vyapar parity Phase 3).
//   GSTR-3B 3.1     - other income that is a supply (Phase 3).
// `split(item, bill)` is the app's per-line tax split ({ taxable, igst, cess, ... }); `isInter(bill)` and `fmtDate` come from
// the page, so this file does not depend on them.

import { billLinesWithCharges, debitNoteItcReversal, getStateCode, itcClaimable, itcSplit } from '@ledgora/tax-engine';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Vyapar parity P2-S3: a bill's additional charges (data.charges) are taxable supplies at their own rate and SAC, so
// every table that works line by line (B2B, B2CS rate-wise, HSN Table 12, 3B) must see them as lines. They come in as
// isCharge lines. A bill without charges is returned as it is, so the returns are unchanged for existing data.
export const withChargeLines = (bill) =>
  bill?.data?.charges?.length ? { ...bill, data: { ...bill.data, items: billLinesWithCharges(bill) } } : bill;

// Table 8 rows are split by where the buyer is and whether the buyer is registered.
export const nilSupplyType = (isInter, registered) => `${isInter ? 'INTR' : 'INTRA'}${registered ? 'B2B' : 'B2C'}`;

// A line can say what kind of supply it is when it carries no GST: 'nil' (nil-rated goods, like fresh vegetables),
// 'exempt' (exempt by notification, like health care) or 'nongst' (outside GST, like petrol or alcohol for drinking).
// Such lines are not taxable supplies: they leave B2B, B2C, the HSN summary and 3B 3.1(a), and are reported in GSTR-1
// Table 8 and 3B 3.1(c) (nil and exempt) or 3.1(e) (non-GST). A line without the mark is read exactly as before.
export const SUPPLY_KINDS = ['nil', 'exempt', 'nongst'];
export const lineKind = (item) => (SUPPLY_KINDS.includes(item?.supplyKind) ? item.supplyKind : null);
const KIND_FIELD = { nil: 'nil_amt', exempt: 'expt_amt', nongst: 'ngsup_amt' };

/**
 * A bill as the taxable tables read it: the marked lines taken out and its taxable value and total lowered by them (they
 * carry no tax), with `_kindOnly` when nothing taxable is left. Returns the bill unchanged when no line is marked.
 */
export function withoutNonTaxable(bill, split) {
  const items = bill?.data?.items || [];
  if (!items.some(lineKind)) return bill;
  let out = 0;
  const keep = [];
  for (const it of items) {
    if (lineKind(it)) out += split(it, bill).taxable;
    else keep.push(it);
  }
  const t = bill.data.totals || {};
  const taxable = t.taxableAmount ?? ((t.subtotal || 0) - (t.totalDiscount || 0));
  return {
    ...bill,
    totalAmount: round2((Number(bill.totalAmount) || 0) - out),
    _kindOnly: keep.length === 0,
    data: { ...bill.data, items: keep, totals: { ...t, taxableAmount: round2(taxable - out), total: round2((t.total || 0) - out) } },
  };
}

// Bills of supply carry no GST: they are exempt supplies. (Composition dealers' bills are reported in CMP-08, not here.)
// Lines marked nil / exempt / non-GST on tax invoices join them, each in its own column; a credit note takes its marked
// lines back out.
export function nilExemptSummary(bills, { isInter, split }) {
  const rows = {};
  const row = (bill) => {
    const ty = nilSupplyType(isInter(bill), !!bill.data.client?.gstin);
    if (!rows[ty]) rows[ty] = { sply_ty: ty, expt_amt: 0, nil_amt: 0, ngsup_amt: 0 };
    return rows[ty];
  };
  for (const bill of bills) {
    if (!bill.data) continue;
    const type = bill.invoiceType || 'tax-invoice';
    if (type === 'bill-of-supply') {
      const r = row(bill);
      for (const item of bill.data.items || []) {
        const k = lineKind(item);
        r[k ? KIND_FIELD[k] : 'expt_amt'] += split(item, bill).taxable;
      }
      continue;
    }
    if (type !== 'tax-invoice' && type !== 'credit-note') continue;
    const sign = type === 'credit-note' ? -1 : 1;
    for (const item of bill.data.items || []) {
      const k = lineKind(item);
      if (k) row(bill)[KIND_FIELD[k]] += sign * split(item, bill).taxable;
    }
  }
  const inv = Object.values(rows)
    .map((r) => ({ ...r, expt_amt: round2(r.expt_amt), nil_amt: round2(r.nil_amt), ngsup_amt: round2(r.ngsup_amt) }))
    .filter((r) => r.expt_amt || r.nil_amt || r.ngsup_amt)
    .sort((a, b) => a.sply_ty.localeCompare(b.sply_ty));
  const sum = (f) => round2(inv.reduce((t, r) => t + r[f], 0));
  return {
    inv,
    total: round2(inv.reduce((t, r) => t + r.expt_amt + r.nil_amt + r.ngsup_amt, 0)),
    /** 3B 3.1(c): nil-rated and exempt. */
    nilExempt: round2(sum('expt_amt') + sum('nil_amt')),
    /** 3B 3.1(e): non-GST. */
    nonGst: sum('ngsup_amt'),
  };
}

// Table 6A. WPAY = export with IGST paid, WOPAY = under LUT / bond. The shipping bill is filed with customs and is not
// kept in the invoice, so those three fields go in only when the invoice carries them (the portal accepts them blank).
export function exportSection(bills, { split, fmtDate }) {
  const groups = { WPAY: [], WOPAY: [] };
  for (const bill of bills) {
    const { totals, items, details } = bill.data;
    const rates = {};
    for (const item of items || []) {
      const rt = Number(item.taxPercent) || 0;
      const s = split(item, bill);
      const r = (rates[rt] = rates[rt] || { txval: 0, iamt: 0, csamt: 0 });
      r.txval += s.taxable;
      r.iamt += s.igst;
      r.csamt += s.cess;
    }
    const withTax = Object.values(rates).some((r) => r.iamt > 0);
    const inv = {
      inum: bill.invoiceNumber,
      idt: fmtDate(bill.invoiceDate),
      val: round2((totals?.total || 0) - (totals?.roundOff || 0)),
      ...(details?.shippingPortCode ? { sbpcode: details.shippingPortCode } : {}),
      ...(details?.shippingBillNo ? { sbnum: details.shippingBillNo } : {}),
      ...(details?.shippingBillDate ? { sbdt: fmtDate(details.shippingBillDate) } : {}),
      itms: Object.entries(rates).map(([rt, d]) => ({
        txval: round2(d.txval), rt: Number(rt), iamt: round2(d.iamt), csamt: round2(d.csamt),
      })),
    };
    groups[withTax ? 'WPAY' : 'WOPAY'].push(inv);
  }
  return Object.entries(groups)
    .filter(([, inv]) => inv.length)
    .map(([exp_typ, inv]) => ({ exp_typ, inv }));
}

// ---- GSTR-3B Table 4 (Vyapar parity Phase 3) -------------------------------------------------------------------------

const heads0 = () => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const addHeads = (a, b) => ({ igst: a.igst + (b.igst || 0), cgst: a.cgst + (b.cgst || 0), sgst: a.sgst + (b.sgst || 0), cess: a.cess + (b.cess || 0) });
// The split GSTReturns has always used: all IGST across states, else CGST = half rounded to paise and SGST the rest.
const splitTax = (tax, interstate) => {
  if (interstate) return { igst: tax, cgst: 0, sgst: 0 };
  const half = round2(tax / 2);
  return { igst: 0, cgst: half, sgst: tax - half };
};
// purchaseBookTotals (gstHelpers) without the React module around it: taxable, tax and cess of a purchase's lines.
const bookTax = (p) => (p?.items || []).reduce((acc, it) => {
  const amount = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  return { tax: acc.tax + amount * (Number(it.taxPercent) || 0) / 100, cess: acc.cess + amount * (Number(it.cessPercent) || 0) / 100 };
}, { tax: 0, cess: 0 });

/** A purchase document that is a bill (purchase orders and debit notes share the collection). Missing = bill. */
export const isPurchaseBill = (p) => !p?.docType || p.docType === 'bill';
export const isDebitNote = (p) => p?.docType === 'debit-note';

/** The tax on a purchase bill by head, and the part not eligible as credit (zero for a bill without line flags). */
export function purchaseItcHeads(p) {
  const legacy = !p.charges?.length && (p.items || []).every(itcClaimable);
  if (legacy) {
    const book = bookTax(p);
    return { all: { ...splitTax(p.totalTax || book.tax, !!p.interstate), cess: book.cess }, ineligible: heads0() };
  }
  const s = itcSplit(p.items || [], { interstate: !!p.interstate, charges: p.charges });
  return { all: s.total, ineligible: s.ineligible };
}

/** Purchase bills as tax-engine's rcmItcForPeriod reads them (P10-S2): date, flag, tax heads and the RCM payment. */
// An import of services is reverse charge too, but its credit is 4(A)(2), not 4(A)(3), so it is left out here.
export const rcmBillsOf = (purchases = []) =>
  purchases.filter((p) => isPurchaseBill(p) && p.importType !== 'services').map((p) => ({
    id: p.id, date: p.date, reverseCharge: !!p.reverseCharge, heads: purchaseItcHeads(p).all, rcmPayment: p.rcmPayment || null,
    number: p.invoiceNumber || p.number, supplier: p.supplierName, taxable: Number(p.taxableAmount) || 0,
  }));

/**
 * Table 4 of GSTR-3B from the period's purchase documents and expenses.
 *   4(A)(3) ISRC  credit on reverse-charge purchases (we paid the tax in 3.1(d), so we claim it here); with `rcm`, in
 *                 the period the RCM tax was paid (P10-S2), not the bill's
 *   4(A)(5) OTH   all other credit: purchases and expenses
 *   4(B)(1) RUL   credit reversed: §17(5), blocked, used for exempt supply (lines flagged on the bill) and expenses
 *                 marked not ITC-eligible. Per CBIC Circular 170/02/2022 such credit is shown in 4(A) and reversed here.
 *   4(B)(2) OTH   credit reversed by debit notes (goods sent back, rate difference) and by the 180-day rule (a supplier
 *                 still unpaid 180 days after the invoice, P10-S4)
 *   4(A)(5) reclaim  "Re-claimed ITC": credit reversed under the 180-day rule that comes back when the supplier is paid
 *   net           4(A) − 4(B): what the set-off uses.
 * A bill whose lines carry no flag and that has no charges is read exactly as before Phase 3 (its stored totalTax,
 * split the same way), so the return is unchanged for every purchase recorded before.
 */
export function itcTable4({ purchases = [], expenses = [], itc180 = null, rcm = null } = {}) {
  let fromExpenses = heads0();
  let fromPurchases = heads0();
  let isrc = heads0();
  let rul = heads0();
  let dnRev = heads0();
  for (const e of expenses) {
    const h = { ...splitTax(e.gstAmount || 0, !!e.interstate), cess: 0 };
    fromExpenses = addHeads(fromExpenses, h);
    if (e.itcEligible === false) rul = addHeads(rul, h);
  }
  const bills = purchases.filter(isPurchaseBill);
  // 4(A)(1) import of goods: the IGST paid to customs on the bill of entry. 4(A)(2) import of services: the IGST paid under
  // reverse charge on services bought from abroad (its liability is in 3.1(d) like any reverse-charge bill).
  let impg = heads0();
  let imps = heads0();
  for (const p of bills) {
    const { all, ineligible } = purchaseItcHeads(p);
    rul = addHeads(rul, ineligible);
    if (p.importType === 'goods' || p.importType === 'services') {
      const igst = { igst: all.igst + all.cgst + all.sgst, cgst: 0, sgst: 0, cess: all.cess };
      if (p.importType === 'goods') impg = addHeads(impg, igst);
      else imps = addHeads(imps, igst);
      continue;
    }
    // P10-S2: with `rcm` (rcmItcForPeriod) the credit on reverse charge is claimed in the period its tax was paid,
    // below; without it, as before, in the bill's own period.
    if (p.reverseCharge) { if (!rcm) isrc = addHeads(isrc, all); }
    else fromPurchases = addHeads(fromPurchases, all);
  }
  if (rcm) isrc = addHeads(isrc, rcm.claim);
  for (const dn of purchases.filter(isDebitNote)) {
    const bill = bills.find((b) => b.id && b.id === dn.againstPurchaseId);
    const r = debitNoteItcReversal(dn.items || [], { billLines: bill?.items, interstate: !!(bill?.interstate ?? dn.interstate) });
    dnRev = addHeads(dnRev, r.reversal);
  }
  // P10-S4: the 180-day rule. Reversals join 4(B)(2); a late payment's credit comes back as "Re-claimed ITC".
  let reclaim = heads0();
  if (itc180) {
    dnRev = addHeads(dnRev, itc180.reversal || heads0());
    reclaim = addHeads(reclaim, itc180.reclaim || heads0());
  }
  // Expenses first, then purchases: the order GSTReturns has always added them in, so the float sums match too.
  const oth = { igst: fromExpenses.igst + fromPurchases.igst, cgst: fromExpenses.cgst + fromPurchases.cgst, sgst: fromExpenses.sgst + fromPurchases.sgst, cess: fromPurchases.cess };
  const net = {};
  for (const k of ['igst', 'cgst', 'sgst', 'cess']) net[k] = Math.max(0, impg[k] + imps[k] + isrc[k] + oth[k] + reclaim[k] - rul[k] - dnRev[k]);
  const reversed = rul.igst + rul.cgst + rul.sgst + rul.cess + dnRev.igst + dnRev.cgst + dnRev.sgst + dnRev.cess > 0 || reclaim.igst + reclaim.cgst + reclaim.sgst + reclaim.cess > 0;
  return { avl: { impg, imps, isrc, oth, reclaim }, rev: { rul, oth: dnRev }, net, reversed };
}

/**
 * Other Income that is a supply (P3-S6), as bills the returns already know how to read: income with GST becomes a tax
 * invoice (GSTR-1 B2B when the payer has a GSTIN, else B2CS; HSN summary by its SAC; GSTR-3B 3.1(a)), exempt income a
 * bill of supply (GSTR-1 Table 8, GSTR-3B 3.1(c)). Income with no GST that is not marked exempt is left out: it is not
 * a supply (agricultural income, gifts). `amount` includes GST, as on every expense record. Itemised income keeps its
 * lines; a single amount becomes one line at the GST rate it implies.
 */
export function incomeAsBills(incomes = [], profile = {}) {
  const out = [];
  for (const i of incomes) {
    const amount = Number(i.amount) || 0;
    const gst = i.exempt ? 0 : Number(i.gstAmount) || 0;
    if (!i.exempt && gst <= 0) continue;
    if (amount <= 0) continue;
    // A place of supply in another state makes it inter-state even if the box was not ticked.
    const own = String(profile?.state || '').trim().toLowerCase();
    const pos = String(i.placeOfSupply || '').trim().toLowerCase();
    const interstate = !!i.interstate || (!!pos && !!own && pos !== own);
    const taxable = round2(amount - gst);
    const rate = taxable > 0 ? Math.round((gst / taxable) * 10000) / 100 : 0;
    const items = i.items?.length
      ? i.items.map((l) => ({ name: l.name, hsn: l.hsn || l.sac || i.sac || '', quantity: Number(l.quantity) || 1, unit: 'OTH', rate: Number(l.rate) || 0, taxPercent: i.exempt ? 0 : Number(l.taxPercent) || 0, cessPercent: 0 }))
      : [{ name: i.description || i.category || 'Other income', hsn: i.sac || '', quantity: 1, unit: 'OTH', rate: taxable, taxPercent: i.exempt ? 0 : Number(i.gstPercent) || rate, cessPercent: 0 }];
    const half = round2(gst / 2);
    const state = i.placeOfSupply || (interstate ? '' : profile?.state || '');
    out.push({
      id: `income:${i.id}`,
      fromOtherIncome: true,
      invoiceNumber: i.number || i.invoiceNo || '',
      invoiceDate: i.date,
      invoiceType: i.exempt ? 'bill-of-supply' : 'tax-invoice',
      clientName: i.vendorName || '',
      totalAmount: amount,
      data: {
        client: { name: i.vendorName || '', gstin: i.vendorGstin || '', state, country: 'India' },
        details: { placeOfSupply: state },
        profile,
        items,
        totals: {
          taxableAmount: taxable,
          subtotal: taxable,
          igst: interstate ? gst : 0,
          cgst: interstate ? 0 : half,
          sgst: interstate ? 0 : round2(gst - half),
          cess: 0,
          roundOff: 0,
          total: amount,
          isInterstate: interstate,
        },
      },
    });
  }
  return out;
}

// ---- P10-S1: advances for services (D-14) ----------------------------------------------------------------------------

/** Receipts saved as "Advance for services" (receipt.advance), in the shape tax-engine's table11 reads. Advances for goods carry no GST and are left out. */
export const advanceReceiptsOf = (receipts = []) =>
  receipts
    .filter((r) => r?.advance?.services === true && Number(r.amount) > 0)
    .map((r) => ({
      id: r.id,
      date: r.date,
      amount: Number(r.amount),
      rate: Number(r.advance.rate) || 0,
      pos: String(r.advance.pos || ''),
      adjustments: r.advance.adjustments || [],
    }));

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate(); // m is 0-based

/** The first and last day of the return period picked on the screen (months are 0-based, like the screen's filters). */
export function periodBounds(mode, o) {
  if (mode === 'fy') return { from: o.from, to: o.to };
  const months = mode === 'quarter' ? o.months : [o.month];
  const first = Math.min(...months);
  const last = Math.max(...months);
  return { from: `${o.year}-${pad(first + 1)}-01`, to: `${o.year}-${pad(last + 1)}-${pad(lastDay(o.year, last))}` };
}

// ---- P10-S3: GSTR-3B 3.1(b) SEZ and 3.2 ------------------------------------------------------------------------------

const taxableOf = (t) => t?.taxableAmount ?? ((t?.subtotal || 0) - (t?.totalDiscount || 0));

/** Supplies to SEZ units and developers in the period (zero-rated, 3.1(b)), net of credit notes: taxable value, IGST and cess. */
export function sezSupplies(bills = []) {
  const out = { taxable: 0, igst: 0, cess: 0 };
  for (const b of bills) {
    if (!b.data?.client?.isSEZ) continue;
    const sign = (b.invoiceType || 'tax-invoice') === 'credit-note' ? -1 : 1; // a credit note to an SEZ nets out of 3.1(b)
    const t = b.data.totals || {};
    out.taxable += sign * taxableOf(t);
    out.igst += sign * (t.igst || 0);
    out.cess += sign * (t.cess || 0);
  }
  return { taxable: round2(out.taxable), igst: round2(out.igst), cess: round2(out.cess) };
}

/**
 * 3.2 rows: inter-state invoices and credit notes (negative) to buyers without a GSTIN, with their place of supply as a
 * state code. Exports (no Indian place of supply) and SEZ units are not "unregistered persons" and are left out.
 */
export function unregisteredInterRows(bills = []) {
  const rows = [];
  for (const b of bills) {
    const c = b.data?.client || {};
    const t = b.data?.totals || {};
    if (c.gstin || c.isSEZ || t.isInterstate !== true) continue;
    const pos = getStateCode(String(b.data?.details?.placeOfSupply || c.state || '').trim());
    if (!pos) continue;
    const sign = (b.invoiceType || 'tax-invoice') === 'credit-note' ? -1 : 1;
    rows.push({ pos, txval: sign * taxableOf(t), iamt: sign * (t.igst || 0) });
  }
  return rows;
}

// ---- P10-S5: TDS receivable ------------------------------------------------------------------------------------------

/**
 * TDS customers deducted, per customer, for the Form 26AS comparison: TDS declared on invoices, plus TDS kept on
 * receipts (P2-S5) unless the receipt is against an invoice that already declares TDS (one deduction, counted once).
 */
export function tdsBookByCustomer(bills = [], receipts = []) {
  const by = new Map();
  const add = (name, v) => {
    const k = String(name || '').trim();
    if (!k || !(v > 0)) return;
    by.set(k, round2((by.get(k) || 0) + v));
  };
  const declared = new Set();
  for (const b of bills) {
    const tds = Number(b.data?.totals?.tdsAmount) || 0;
    if (tds > 0) declared.add(b.invoiceNumber);
    add(b.data?.client?.name || b.clientName, tds);
  }
  for (const r of receipts) {
    if (r.againstInvoice && declared.has(String(r.againstInvoice).trim())) continue;
    add(r.clientName, Number(r.tds) || 0);
  }
  return [...by.entries()].map(([deductor, tds]) => ({ deductor, tds }));
}
