// Return tables built from the period's documents, kept free of React so they can be tested on their own:
//   GSTR-1 Table 8  - nil-rated, exempt and non-GST outward supplies (the bills of supply). Also GSTR-3B 3.1(c).
//   GSTR-1 Table 6A - exports (zero-rated supply to a client outside India).
//   GSTR-3B Table 4 - input tax credit from purchases and expenses (Vyapar parity Phase 3).
//   GSTR-3B 3.1     - other income that is a supply (Phase 3).
// `split(item, bill)` is the app's per-line tax split ({ taxable, igst, cess, ... }); `isInter(bill)` and `fmtDate` come from
// the page, so this file does not depend on them.

import { billLinesWithCharges, debitNoteItcReversal, itcClaimable, itcSplit } from '@ledgora/tax-engine';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Vyapar parity P2-S3: a bill's additional charges (data.charges) are taxable supplies at their own rate and SAC, so
// every table that works line by line (B2B, B2CS rate-wise, HSN Table 12, 3B) must see them as lines. They come in as
// isCharge lines. A bill without charges is returned as it is, so the returns are unchanged for existing data.
export const withChargeLines = (bill) =>
  bill?.data?.charges?.length ? { ...bill, data: { ...bill.data, items: billLinesWithCharges(bill) } } : bill;

// Table 8 rows are split by where the buyer is and whether the buyer is registered.
export const nilSupplyType = (isInter, registered) => `${isInter ? 'INTR' : 'INTRA'}${registered ? 'B2B' : 'B2C'}`;

// Bills of supply carry no GST: they are exempt supplies. (Composition dealers' bills are reported in CMP-08, not here.)
export function nilExemptSummary(bills, { isInter, split }) {
  const rows = {};
  for (const bill of bills) {
    if ((bill.invoiceType || 'tax-invoice') !== 'bill-of-supply' || !bill.data) continue;
    const ty = nilSupplyType(isInter(bill), !!bill.data.client?.gstin);
    if (!rows[ty]) rows[ty] = { sply_ty: ty, expt_amt: 0, nil_amt: 0, ngsup_amt: 0 };
    for (const item of bill.data.items || []) rows[ty].expt_amt += split(item, bill).taxable;
  }
  const inv = Object.values(rows)
    .map((r) => ({ ...r, expt_amt: round2(r.expt_amt) }))
    .filter((r) => r.expt_amt > 0)
    .sort((a, b) => a.sply_ty.localeCompare(b.sply_ty));
  return { inv, total: round2(inv.reduce((t, r) => t + r.expt_amt + r.nil_amt + r.ngsup_amt, 0)) };
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

/**
 * Table 4 of GSTR-3B from the period's purchase documents and expenses.
 *   4(A)(3) ISRC  credit on reverse-charge purchases (we paid the tax in 3.1(d), so we claim it here)
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
export function itcTable4({ purchases = [], expenses = [], itc180 = null } = {}) {
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
  for (const p of bills) {
    const legacy = !p.charges?.length && (p.items || []).every(itcClaimable);
    let all;
    if (legacy) {
      const book = bookTax(p);
      all = { ...splitTax(p.totalTax || book.tax, !!p.interstate), cess: book.cess };
    } else {
      const s = itcSplit(p.items || [], { interstate: !!p.interstate, charges: p.charges });
      all = s.total;
      rul = addHeads(rul, s.ineligible);
    }
    if (p.reverseCharge) isrc = addHeads(isrc, all);
    else fromPurchases = addHeads(fromPurchases, all);
  }
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
  for (const k of ['igst', 'cgst', 'sgst', 'cess']) net[k] = Math.max(0, isrc[k] + oth[k] + reclaim[k] - rul[k] - dnRev[k]);
  const reversed = rul.igst + rul.cgst + rul.sgst + rul.cess + dnRev.igst + dnRev.cgst + dnRev.sgst + dnRev.cess > 0 || reclaim.igst + reclaim.cgst + reclaim.sgst + reclaim.cess > 0;
  return { avl: { isrc, oth, reclaim }, rev: { rul, oth: dnRev }, net, reversed };
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
