// Vyapar parity Phase 3 on the web: the purchase documents are workspace documents (collection `purchases`, told
// apart by docType), so the money and quantities that the API keeps in tables live on the documents here. The
// decisions are the tax engine's; this file only reads and writes the document shapes. No React, so it is testable.

import {
  allocatePayment,
  cashPaymentCheck,
  cleanCharges,
  getFinancialYearLabel,
  itcAging,
  itcReversalsFor,
  itcSplit,
  overConversion,
  partyStatement,
  tdsDueDate,
  tdsInterest,
  TDS_DEDUCTION_SECTIONS,
  parseLocalDate,
  tdsCalc,
  debitNoteMovesStock,
  duplicateBill,
  purchaseOrderProgress,
  returnableQtyPurchase,
} from '@ledgora/tax-engine';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export const PURCHASE_INLINE = 'purchase_inline';
export const PAYMENT_OUT = 'payment_out';

/**
 * A purchase bill's figures, the way the Purchase Bills screen has always added them up (quantity × rate, tax and cess
 * per line, round-off on the grand total), plus the Phase 3 additions: charges (before tax, at their own rate) and
 * §194Q TDS withheld from the supplier on the value before GST. Without charges or TDS the result is what it was.
 */
export function purchaseFormTotals(items, { applyRoundOff = false, charges = [], tds194QPercent = 0, roundOff } = {}) {
  const goods = (items || []).reduce((acc, item) => {
    const amount = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
    const tax = (amount * (Number(item.taxPercent) || 0)) / 100;
    const cess = (amount * (Number(item.cessPercent) || 0)) / 100;
    return { taxable: acc.taxable + amount, tax: acc.tax + tax, cess: acc.cess + cess, total: acc.total + amount + tax + cess };
  }, { taxable: 0, tax: 0, cess: 0, total: 0 });
  const extra = cleanCharges(charges);
  const chargesTaxable = extra.reduce((s, c) => s + c.amount, 0);
  const chargesTax = extra.reduce((s, c) => s + (c.taxable ? (c.amount * c.gstRate) / 100 : 0), 0);
  const raw = {
    taxable: goods.taxable + chargesTaxable,
    tax: goods.tax + chargesTax,
    cess: goods.cess,
    total: goods.total + chargesTaxable + chargesTax,
  };
  const ro = applyRoundOff ? (roundOff ?? Math.round((Math.round(raw.total) - raw.total) * 100) / 100) : 0;
  const finalTotal = raw.total + ro;
  const pct = Math.min(Math.max(0, Number(tds194QPercent) || 0), 5);
  const tdsAmount = pct > 0 ? Math.round((raw.taxable * pct) / 100) : 0;
  return { ...raw, chargesTaxable, chargesTax, roundOff: ro, finalTotal, tdsAmount, payable: r2(finalTotal - tdsAmount) };
}

/** Money paid against a bill: rows paid with it and Payment Out vouchers applied to it. */
export const purchasePaid = (p) => r2((p?.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0));

/**
 * What we owe on a bill before payments: the total less §194Q TDS we withheld, less debit notes against it that are
 * settled by adjusting what we owe.
 */
export function purchaseDue(p, debitNotes = []) {
  const adjusted = (debitNotes || [])
    .filter((d) => d.againstPurchaseId === p.id && (d.refundMode || 'adjust') === 'adjust')
    .reduce((s, d) => s + (Number(d.totalAmount) || 0), 0);
  return r2(Math.max(0, (Number(p.totalAmount) || 0) - (Number(p.tdsAmount) || 0) - adjusted));
}

export const purchasePending = (p, debitNotes = []) => r2(Math.max(0, purchaseDue(p, debitNotes) - purchasePaid(p)));

/** Unpaid / Partial / Paid from the payments, once a bill has any; until then the status the user picked stands. */
export function purchaseStatus(p, debitNotes = []) {
  if (!(p?.payments || []).length) return p?.paymentStatus || 'Unpaid';
  const due = purchaseDue(p, debitNotes);
  const paid = purchasePaid(p);
  return due > 0 && paid >= due - 0.005 ? 'Paid' : paid > 0.005 ? 'Partial' : 'Unpaid';
}

/** The bill's payments after a save: voucher entries kept, inline rows replaced by the block's rows. */
export function mergePurchasePayments(payments, rows, { date }) {
  const kept = (payments || []).filter((p) => p?.source !== PURCHASE_INLINE);
  const fresh = (rows || [])
    .filter((r) => Number(r.amount) > 0)
    .map((r, i) => ({
      id: r.id || `pin_${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 5)}`,
      amount: r2(r.amount),
      mode: r.mode || 'cash',
      reference: r.reference || '',
      chequeDate: r.mode === 'cheque' ? r.chequeDate || null : null,
      date,
      source: PURCHASE_INLINE,
    }));
  return [...kept, ...fresh];
}

export const inlineRowsOfPurchase = (p) =>
  (p?.payments || []).filter((x) => x.source === PURCHASE_INLINE).map(({ id, amount, mode, reference, chequeDate }) => ({ id, amount, mode, reference, chequeDate }));

/** The other bill with the same supplier bill number this financial year, or null (tax-engine duplicateBill). */
export const findDuplicateBill = (bills, form, excludeId) =>
  duplicateBill(bills, {
    supplierGstin: form.supplierGstin,
    supplierName: form.supplierName,
    billNo: form.invoiceNumber,
    date: form.date,
    excludeId,
  });

/** A supplier's bills still to be paid, oldest first, with what is pending on each (for Payment Out). */
export function openBillsFor(bills, supplierName, debitNotes = []) {
  return (bills || [])
    .filter((b) => sameName(b.supplierName, supplierName))
    .map((b) => ({ bill: b, pending: purchasePending(b, debitNotes) }))
    .filter((x) => x.pending > 0.005)
    .sort((a, b) => String(a.bill.date || '').localeCompare(String(b.bill.date || '')));
}

/**
 * Applies a Payment Out voucher to bills with the shared engine (allocatePayment, direction out) and returns the
 * allocations and the bills to save, each with the voucher's share on it. `manual` amounts are by bill id; without
 * them the oldest bill is paid first. Discount received and TDS deducted by us settle bills like money.
 */
export function applyPaymentOut({ bills, voucher, manual, debitNotes = [] }) {
  const open = openBillsFor(bills, voucher.supplierName, debitNotes);
  const result = allocatePayment({
    direction: 'out',
    amount: voucher.amount,
    discount: voucher.discount,
    tds: voucher.tds,
    docs: open.map((o) => ({ id: o.bill.id, date: o.bill.date, pending: o.pending })),
    strategy: manual ? 'manual' : 'oldest_first',
    manual,
  });
  const updated = result.allocations.map((a) => {
    const bill = open.find((o) => o.bill.id === a.docId).bill;
    const payments = [
      // Only this voucher's own earlier entry is replaced; a voucher not saved yet has no id and replaces nothing.
      ...(bill.payments || []).filter((p) => !(voucher.id && p.voucherId === voucher.id)),
      { id: `pout_${voucher.id}`, voucherId: voucher.id, voucherNo: voucher.voucherNo, amount: a.amount, date: voucher.date, mode: voucher.mode, source: PAYMENT_OUT },
    ];
    const next = { ...bill, payments };
    return { ...next, paymentStatus: purchaseStatus(next, debitNotes) };
  });
  return { ...result, updated };
}

/** Bills a deleted (or re-saved) voucher had paid, with its entries taken off. */
export function releasePaymentOut(bills, voucherId, debitNotes = []) {
  return (bills || [])
    .filter((b) => (b.payments || []).some((p) => p.voucherId === voucherId))
    .map((b) => {
      const next = { ...b, payments: b.payments.filter((p) => p.voucherId !== voucherId) };
      // With no money left on it the bill is unpaid again (its stored status was set from the money now taken back).
      return { ...next, paymentStatus: next.payments.length ? purchaseStatus(next, debitNotes) : 'Unpaid' };
    });
}

/** A purchase order's progress from the bills converted from it (P3-S3). */
export const orderProgress = (order, bills) =>
  purchaseOrderProgress(order?.items || [], (bills || []).filter((b) => b.poId === order?.id), order?.status === 'cancelled');

/** What is left to return on each line of a bill, given the earlier debit notes against it (P3-S4). */
export const returnableOf = (bill, debitNotes) =>
  returnableQtyPurchase(bill?.items || [], (debitNotes || []).filter((d) => d.againstPurchaseId === bill?.id && d.status !== 'cancelled'));

/**
 * TDS we should deduct on a Payment Out (tax-engine tdsCalc). The year-to-date base is what earlier vouchers paid this
 * supplier under the same section in the same financial year (gross: money + TDS + discount); `ytdDeducted` is true once
 * any of them deducted TDS, so a crossed threshold is not caught up twice.
 */
export function tdsSuggestion({ vouchers, voucher, panAvailable = true }) {
  if (!voucher?.tdsSection) return null;
  const fy = voucher.date ? getFinancialYearLabel(parseLocalDate(voucher.date)) : null;
  const earlier = (vouchers || []).filter((v) =>
    v.id !== voucher.id && v.tdsSection === voucher.tdsSection && sameName(v.supplierName, voucher.supplierName)
    && (!fy || (v.date && getFinancialYearLabel(parseLocalDate(v.date)) === fy)));
  const gross = (v) => (Number(v.amount) || 0) + (Number(v.tds) || 0) + (Number(v.discount) || 0);
  return tdsCalc({
    section: voucher.tdsSection,
    base: (Number(voucher.amount) || 0) + (Number(voucher.tds) || 0),
    ytdToDeductee: earlier.reduce((s, v) => s + gross(v), 0),
    ytdDeducted: earlier.some((v) => Number(v.tds) > 0),
    alt: !!voucher.tdsAlt,
    deducteeType: voucher.deducteeType || 'other',
    panAvailable,
  });
}

/** §40A(3): cash paid to one supplier in a day above ₹10,000 is not deductible. A warning, not a block. */
export function cashOutWarning({ vouchers, voucher }) {
  if (String(voucher?.mode || '').toLowerCase() !== 'cash') return null;
  const day = (vouchers || [])
    .filter((v) => v.id !== voucher.id && v.date === voucher.date && sameName(v.supplierName, voucher.supplierName) && String(v.mode).toLowerCase() === 'cash')
    .reduce((s, v) => s + (Number(v.amount) || 0), 0);
  const c = cashPaymentCheck({ dayCashTotal: day, newCash: voucher.amount });
  return c.breached ? c : null;
}

export { debitNoteMovesStock };

// ---- LinesGrid (P0-S3.6) <-> purchase lines ---------------------------------------------------------------------------

/** Purchase-document lines from LinesGrid rows. The grid's ITC tick off reads as `blocked` credit. */
export const gridToItems = (lines) =>
  (lines || [])
    .filter((l) => String(l.item || '').trim())
    .map((l) => ({
      name: String(l.item).trim(),
      hsn: String(l.hsn || '').trim(),
      quantity: Number(l.qty) || 0,
      unit: l.unit || 'NOS',
      rate: Number(l.rate) || 0,
      taxPercent: Number(l.gst) || 0,
      cessPercent: Number(l.cess) || 0,
      ...(l.itcStatus ? { itcStatus: l.itcStatus } : l.itc === false ? { itcStatus: 'blocked' } : {}),
      ...(l.productId ? { productId: l.productId } : {}),
    }));

export const itemsToGrid = (items) =>
  (items || []).map((i) => ({
    item: i.name || '',
    hsn: i.hsn || '',
    qty: i.quantity ?? 1,
    unit: i.unit || 'NOS',
    rate: i.rate ?? '',
    discount: '',
    gst: Number(i.taxPercent) || 0,
    cess: i.cessPercent || 0,
    itc: !i.itcStatus || i.itcStatus === 'eligible' || i.itcStatus === 'capital_goods',
    ...(i.itcStatus ? { itcStatus: i.itcStatus } : {}),
    ...(i.productId ? { productId: i.productId } : {}),
  }));

/** Taxable + GST of one LinesGrid row (what the grid shows in Amount). */
export const gridLineAmount = (l) => {
  const taxable = (Number(l.qty) || 0) * (Number(l.rate) || 0) * (1 - Math.min(Number(l.discount) || 0, 100) / 100);
  return r2(taxable * (1 + (Number(l.gst) || 0) / 100));
};

// ---- P3-S3 convert a purchase order: Add Purchase opens pre-filled ---------------------------------------------------

export const PURCHASE_PREFILL_KEY = 'ledgora_purchasePrefill';

/** The bill form a conversion opens with: the order's supplier and, per line, what is still pending. */
export function billPrefillFromOrder(order, bills) {
  const progress = orderProgress(order, bills);
  const items = (order.items || [])
    .map((l, i) => ({ ...l, quantity: progress.lines[i]?.pending ?? 0, itcStatus: 'eligible' }))
    .filter((l) => l.quantity > 0);
  return {
    poId: order.id,
    poNumber: order.number,
    supplierName: order.supplierName || '',
    supplierGstin: order.supplierGstin || '',
    interstate: !!order.interstate,
    charges: order.charges || [],
    items,
  };
}

/** Lines of a bill that receive more than is pending on its order. Empty = fine. */
export function overConversionOf(order, bills, items, excludeBillId) {
  const progress = orderProgress(order, (bills || []).filter((b) => b.id !== excludeBillId));
  return overConversion(progress.lines, items);
}

/**
 * The order's advance still unused, applied to the bill that receives the goods (up to what the bill asks): returns
 * the payment entry to put on the bill, or null.
 */
export function advanceEntryFor(order, bills, payable, billId) {
  const advance = Number(order?.advance) || 0;
  if (advance <= 0) return null;
  const used = (bills || [])
    .filter((b) => b.poId === order.id && b.id !== billId)
    .flatMap((b) => b.payments || [])
    .filter((p) => p.source === 'po_advance')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const take = r2(Math.min(advance - used, payable));
  return take > 0
    ? { id: `pad_${order.id}`, amount: take, mode: order.advanceMode || 'cash', date: order.date, source: 'po_advance', voucherNo: order.number }
    : null;
}

// ---- supplier statement (P3 acceptance 3) -------------------------------------------------------------------------------

/**
 * A supplier's statement: every bill, payment, advance and return, oldest first, with what we owe after each. The
 * closing balance is tax-engine partyStatement (bills − payments − returns). Bills count at what we owe on them
 * (total less §194Q TDS we keep). A Payment Out counts at what it settled (money + discount + TDS). An order advance
 * counts once, whether or not a bill has used it yet. A debit note refunded in cash or bank appears twice (the return,
 * then the money coming back), which nets to nothing, as it should.
 */
export function supplierStatementOf({ supplierName, bills = [], vouchers = [], debitNotes = [], orders = [] }) {
  const mine = (d) => sameName(d.supplierName, supplierName);
  const rows = [];
  for (const b of bills.filter(mine)) {
    rows.push({ date: b.date, type: 'Bill', ref: b.invoiceNumber || b.number, payable: r2((Number(b.totalAmount) || 0) - (Number(b.tdsAmount) || 0)) });
    for (const p of (b.payments || []).filter((x) => x.source === PURCHASE_INLINE))
      rows.push({ date: p.date || b.date, type: 'Paid with bill', ref: b.invoiceNumber, payable: -r2(p.amount) });
  }
  for (const o of orders.filter(mine))
    if (Number(o.advance) > 0) rows.push({ date: o.date, type: 'Order advance', ref: o.number, payable: -r2(o.advance) });
  for (const v of vouchers.filter(mine))
    rows.push({ date: v.date, type: 'Payment Out', ref: v.voucherNo, payable: -r2((Number(v.amount) || 0) + (Number(v.discount) || 0) + (Number(v.tds) || 0)) });
  for (const d of debitNotes.filter(mine)) {
    rows.push({ date: d.date, type: 'Debit note', ref: d.number, payable: -r2(d.totalAmount) });
    if ((d.refundMode || 'adjust') !== 'adjust') rows.push({ date: d.date, type: 'Refund received', ref: d.number, payable: r2(d.totalAmount) });
  }
  const order = { Bill: 0, 'Paid with bill': 1, 'Order advance': 2, 'Payment Out': 3, 'Debit note': 4, 'Refund received': 5 };
  rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || order[a.type] - order[b.type]);
  let running = 0;
  for (const r of rows) { running = r2(running + r.payable); r.balance = running; }
  // A refunded debit note is a return the supplier paid back: net against the returns, so it lowers nothing.
  const sumOf = (types) => rows.filter((r) => types.includes(r.type)).reduce((t, r) => t - r.payable, 0);
  const total = partyStatement({
    documents: rows.filter((r) => r.type === 'Bill').map((r) => ({ total: r.payable })),
    payments: rows.filter((r) => ['Paid with bill', 'Order advance', 'Payment Out'].includes(r.type)).map((r) => ({ amount: -r.payable })),
    returns: [{ total: r2(sumOf(['Debit note', 'Refund received'])) }],
  });
  return { rows, ...total };
}

// ---- TDS deducted by us, deductee-wise and section-wise (P3-S2 acceptance 2; the quarterly TDS return) --------------

/** PAN is characters 3–12 of a GSTIN. */
export const panFromGstin = (gstin) => (/^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(String(gstin || '').toUpperCase()) ? String(gstin).toUpperCase().slice(2, 12) : '');

/**
 * Every Payment Out with TDS in the period (`from`/`to` inclusive, YYYY-MM-DD), and the totals per deductee and
 * section. The PAN comes from the supplier's GSTIN on their bills when there is one. Amount paid is gross: the money
 * plus the TDS kept back.
 */
export function tdsRegister(vouchers, { from = '', to = '9999-12-31', bills = [] } = {}) {
  const gstinOf = new Map();
  for (const b of bills) if (b.supplierGstin) gstinOf.set(String(b.supplierName || '').trim().toLowerCase(), b.supplierGstin);
  const rows = (vouchers || [])
    .filter((v) => Number(v.tds) > 0 && v.tdsSection && (v.date || '') >= from && (v.date || '') <= to)
    .map((v) => ({
      date: v.date,
      voucherNo: v.voucherNo || '',
      deductee: v.supplierName || '',
      pan: panFromGstin(gstinOf.get(String(v.supplierName || '').trim().toLowerCase())),
      section: v.tdsSection,
      nature: TDS_DEDUCTION_SECTIONS[v.tdsSection]?.label || '',
      paid: r2((Number(v.amount) || 0) + (Number(v.tds) || 0)),
      tds: r2(v.tds),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.deductee.toLowerCase()}|${r.section}`;
    const g = groups.get(k) || { deductee: r.deductee, pan: r.pan, section: r.section, nature: r.nature, paid: 0, tds: 0, count: 0 };
    g.paid = r2(g.paid + r.paid);
    g.tds = r2(g.tds + r.tds);
    g.count += 1;
    groups.set(k, g);
  }
  return { rows, summary: [...groups.values()], total: r2(rows.reduce((s, r) => s + r.tds, 0)) };
}

// ---- ITC 180-day rule on the web (P10-S4) -------------------------------------------------------------------------------

/**
 * The bills and payments of the purchase documents in the engine's terms. Credit is the eligible GST (and cess) on the
 * bill's lines and charges; payable is the total less §194Q TDS; a payment counts on its own date (decision D-12: a
 * cheque counts on its date until Phase 5 records clearing).
 */
export function itcInputsOf(purchases) {
  const bills = [];
  const payments = [];
  for (const p of purchases || []) {
    if (!p?.id || (p.docType && p.docType !== 'bill')) continue;
    const e = itcSplit(p.items || [], { interstate: !!p.interstate, charges: p.charges }).eligible;
    const itc = r2(e.cgst + e.sgst + e.igst + e.cess);
    bills.push({ id: p.id, supplier: p.supplierName, number: p.invoiceNumber || p.number, date: p.date, payable: r2((Number(p.totalAmount) || 0) - (Number(p.tdsAmount) || 0)), itc, _heads: e });
    for (const x of p.payments || []) payments.push({ billId: p.id, amount: x.amount, date: x.date || p.date });
  }
  return { bills, payments };
}

/** Where every bill stands on `asOf`: credit at risk (150+ days, unpaid) and credit past the deadline. */
export function itcAtRisk(purchases, asOf) {
  const { bills, payments } = itcInputsOf(purchases);
  return itcAging(bills, payments, asOf);
}

const scaleHeads = (h, k) => ({ igst: r2(h.igst * k), cgst: r2(h.cgst * k), sgst: r2(h.sgst * k), cess: r2(h.cess * k) });
const addHeads = (a, b) => ({ igst: a.igst + b.igst, cgst: a.cgst + b.cgst, sgst: a.sgst + b.sgst, cess: a.cess + b.cess });
const zero = () => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });

/**
 * What the return of one period shows for the rule: credit reversed (GSTR-3B 4(B)(2), with the bills to review) and
 * credit re-claimed after a late payment (4(A)(5), "Re-claimed ITC"), each split into the tax heads of its bill.
 * `inPeriod(date)` is the return screen's own period test.
 */
export function itc180ForPeriod(purchases, inPeriod) {
  const { bills, payments } = itcInputsOf(purchases);
  const all = itcReversalsFor(bills, payments, '0000-01-01', '9999-12-31');
  const byId = new Map(bills.map((b) => [b.id, b]));
  const heads = (billId, amount) => {
    const b = byId.get(billId);
    return b && b.itc > 0 ? scaleHeads(b._heads, amount / b.itc) : zero();
  };
  let reversal = zero();
  let reclaim = zero();
  const reversals = all.reversals.filter((r) => inPeriod(r.date));
  const reclaims = all.reclaims.filter((r) => inPeriod(r.paidOn));
  for (const r of reversals) reversal = addHeads(reversal, heads(r.billId, r.itc));
  for (const r of reclaims) reclaim = addHeads(reclaim, heads(r.billId, r.itc));
  return { reversal, reclaim, reversals, reclaims };
}

/**
 * TDS payable (P10-S5) from the web documents: every Payment Out with TDS and every purchase bill with §194Q TDS in the
 * period, each with its due date (the 7th of the next month; 30 April for March), whether it is overdue, the §201(1A)
 * interest to date (1.5% a month or part) and the challan once entered. `tdsChallan` ({ no, bsr, date }) lives on the
 * source document. PAN comes from the supplier's GSTIN; no PAN is flagged (TDS goes up to 20%).
 */
export function tdsPayableRows(vouchers, bills, { from = '', to = '9999-12-31', asOf }) {
  const gstinOf = new Map();
  for (const b of bills || []) if (b.supplierGstin) gstinOf.set(String(b.supplierName || '').trim().toLowerCase(), b.supplierGstin);
  const rows = [];
  const add = (r) => {
    if (!(r.tds > 0) || r.date < from || r.date > to) return;
    const dueDate = tdsDueDate(r.date);
    const i = tdsInterest({ tds: r.tds, deductedOn: r.date, dueDate, depositedOn: r.challan?.date || null, asOf });
    rows.push({ ...r, dueDate, overdue: i.overdue, interest: i.interest, status: r.challan?.no ? 'deposited' : 'accrued', panMissing: !r.pan });
  };
  for (const v of vouchers || []) {
    if (!v.tdsSection) continue;
    add({ key: `voucher:${v.id}`, kind: 'voucher', id: v.id, date: v.date, voucherNo: v.voucherNo || '', deductee: v.supplierName || '', pan: panFromGstin(gstinOf.get(String(v.supplierName || '').trim().toLowerCase())), section: v.tdsSection, nature: TDS_DEDUCTION_SECTIONS[v.tdsSection]?.label || '', paid: r2((Number(v.amount) || 0) + (Number(v.tds) || 0)), tds: r2(v.tds), challan: v.tdsChallan || null });
  }
  for (const b of bills || []) {
    if ((b.docType && b.docType !== 'bill') || !(Number(b.tdsAmount) > 0)) continue;
    add({ key: `bill:${b.id}`, kind: 'bill', id: b.id, date: b.date, voucherNo: b.invoiceNumber || '', deductee: b.supplierName || '', pan: panFromGstin(b.supplierGstin), section: '194Q', nature: TDS_DEDUCTION_SECTIONS['194Q'].label, paid: r2(b.taxableAmount), tds: r2(b.tdsAmount), challan: b.tdsChallan || null });
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const sum = (f) => r2(rows.filter(f).reduce((t, r) => t + r.tds, 0));
  return { rows, total: sum(() => true), deposited: sum((r) => r.status === 'deposited'), pending: sum((r) => r.status === 'accrued'), interest: r2(rows.reduce((t, r) => t + (r.status === 'accrued' ? r.interest : 0), 0)) };
}
