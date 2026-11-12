import { describe, expect, it } from 'vitest';
import { nilExemptSummary, exportSection } from '../src/features/gst-returns/gstReturnTables';

const item = (amount, rate = 0) => ({ amount, taxPercent: rate });
const split = (it) => ({ taxable: it.amount, igst: it.taxPercent ? (it.amount * it.taxPercent) / 100 : 0, cess: 0 });
// Inter-state is decided by isInter() in each test, not stored on the bill.
const bos = (client, items, type = 'bill-of-supply') => ({ invoiceType: type, data: { client, items } });

describe('GSTR-1 Table 8 (bills of supply)', () => {
  it('totals bills of supply by buyer kind and ignores every other document', () => {
    const bills = [
      bos({ gstin: '29ABCDE1234F1Z5' }, [item(1000), item(500)]),
      bos({}, [item(250)]),
      bos({}, [item(100)]),
      bos({}, [item(9999)], 'tax-invoice'),
      bos({}, [item(7777)], 'composition'),
    ];
    const r = nilExemptSummary(bills, { isInter: (b) => b === bills[2], split });
    expect(r.inv).toEqual([
      { sply_ty: 'INTRAB2B', expt_amt: 1500, nil_amt: 0, ngsup_amt: 0 },
      { sply_ty: 'INTRAB2C', expt_amt: 250, nil_amt: 0, ngsup_amt: 0 },
      { sply_ty: 'INTRB2C', expt_amt: 100, nil_amt: 0, ngsup_amt: 0 },
    ]);
    expect(r.total).toBe(1850);
  });
  it('is empty when there are no bills of supply', () => {
    expect(nilExemptSummary([], { isInter: () => false, split })).toEqual({ inv: [], total: 0 });
  });
});

describe('GSTR-1 Table 6A (exports)', () => {
  const exp = (num, rate, details = {}) => ({
    invoiceNumber: num, invoiceDate: '2026-10-05',
    data: { totals: { total: 1180, roundOff: 0 }, details, items: [item(1000, rate)] },
  });
  it('separates exports with IGST from those under LUT, and carries shipping details only when present', () => {
    const r = exportSection([exp('INV/1', 18, { shippingBillNo: '123', shippingBillDate: '2026-10-06', shippingPortCode: 'INMAA1' }), exp('INV/2', 0)],
      { split, fmtDate: (d) => d.split('-').reverse().join('-') });
    expect(r.map((g) => g.exp_typ)).toEqual(['WPAY', 'WOPAY']);
    expect(r[0].inv[0]).toMatchObject({ inum: 'INV/1', idt: '05-10-2026', val: 1180, sbnum: '123', sbdt: '06-10-2026', sbpcode: 'INMAA1' });
    expect(r[0].inv[0].itms).toEqual([{ txval: 1000, rt: 18, iamt: 180, csamt: 0 }]);
    expect(r[1].inv[0]).not.toHaveProperty('sbnum');
  });
});

// ---- Vyapar parity Phase 3: GSTR-3B Table 4 and other income, before / after ------------------------------------------
import { itcTable4, incomeAsBills, isPurchaseBill } from '../src/features/gst-returns/gstReturnTables';

// GSTR-3B Table 4 as GSTReturns.jsx computed it before Phase 3, copied verbatim, so every fixture states what the
// return said "before" next to what it says "after".
function before3B({ purchases, expenses }) {
  const book = (p) => (p?.items || []).reduce((acc, it) => {
    const amount = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
    const tax = amount * (Number(it.taxPercent) || 0) / 100;
    const cess = amount * (Number(it.cessPercent) || 0) / 100;
    return { taxable: acc.taxable + amount, tax: acc.tax + tax, cess: acc.cess + cess, total: acc.total + amount + tax + cess };
  }, { taxable: 0, tax: 0, cess: 0, total: 0 });
  const e = expenses.reduce((acc, x) => {
    const gst = x.gstAmount || 0;
    if (x.interstate) return { cgst: acc.cgst, sgst: acc.sgst, igst: acc.igst + gst };
    const half = Math.round((gst / 2) * 100) / 100;
    return { cgst: acc.cgst + half, sgst: acc.sgst + (gst - half), igst: acc.igst };
  }, { cgst: 0, sgst: 0, igst: 0 });
  const p = purchases.reduce((acc, x) => {
    const tax = x.totalTax || book(x).tax;
    if (x.interstate) return { cgst: acc.cgst, sgst: acc.sgst, igst: acc.igst + tax };
    const half = Math.round((tax / 2) * 100) / 100;
    return { cgst: acc.cgst + half, sgst: acc.sgst + (tax - half), igst: acc.igst };
  }, { cgst: 0, sgst: 0, igst: 0 });
  const cess = purchases.reduce((s, x) => s + book(x).cess, 0);
  return { oth: { cgst: e.cgst + p.cgst, sgst: e.sgst + p.sgst, igst: e.igst + p.igst }, cess };
}
const pick = ({ igst, cgst, sgst }) => ({ igst, cgst, sgst });
const pl = (rate, taxPercent, extra = {}) => ({ name: 'Item', quantity: 1, rate, taxPercent, ...extra });

describe('GSTR-3B Table 4 (Phase 3): purchases recorded before Phase 3 report exactly as before', () => {
  // Mixed real-world shapes: stored totalTax, missing totalTax, odd paise, cess, IGST, expenses both ways.
  const purchases = [
    { items: [pl(1000, 18), pl(333.33, 5)], totalTax: 196.6665 },
    { items: [pl(2500, 12, { quantity: 3 })], interstate: true },
    { items: [pl(100000, 28, { cessPercent: 15 })] },
    { items: [pl(0.05, 100)] },
    { items: [pl(999.99, 18, { itcStatus: 'eligible' }), pl(10, 18, { itcStatus: 'capital_goods' })] },
  ];
  const expenses = [{ gstAmount: 4500 }, { gstAmount: 180.01, interstate: true }, { gstAmount: 0.03 }, {}];

  it('4(A)(5) OTH, its cess, and the net used for set-off are identical to the paisa', () => {
    const was = before3B({ purchases, expenses });
    const now = itcTable4({ purchases, expenses });
    expect(pick(now.avl.oth)).toEqual(was.oth);
    expect(now.avl.oth.cess).toBe(was.cess);
    expect(pick(now.net)).toEqual(was.oth);
    expect(now.reversed).toBe(false);
    expect(now.avl.isrc).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });
  it('a purchase saved without docType is a bill', () => {
    expect(isPurchaseBill({})).toBe(true);
    expect(isPurchaseBill({ docType: 'order' })).toBe(false);
  });
});

describe('GSTR-3B Table 4 (Phase 3): the numbers that change, before → after', () => {
  it('§17(5) passenger car: before claimed ₹2,80,000 credit; after it is in 4(A) and reversed in 4(B)(1), net ₹0', () => {
    const purchases = [{ items: [pl(1000000, 28, { itcStatus: 'ineligible_17_5' })], interstate: true }];
    const was = before3B({ purchases, expenses: [] });
    const now = itcTable4({ purchases });
    expect(was.oth.igst).toBe(280000);
    expect(now.avl.oth.igst).toBe(280000);
    expect(now.rev.rul.igst).toBe(280000);
    expect(now.net.igst).toBe(0);
    expect(now.reversed).toBe(true);
  });

  it('mixed bill: only the blocked line is reversed (before 108 + 108, after net 90 + 90)', () => {
    const purchases = [{ items: [pl(1000, 18), pl(200, 18, { itcStatus: 'blocked' })] }];
    expect(before3B({ purchases, expenses: [] }).oth).toEqual({ igst: 0, cgst: 108, sgst: 108 });
    const now = itcTable4({ purchases });
    expect(pick(now.avl.oth)).toEqual({ igst: 0, cgst: 108, sgst: 108 });
    expect(pick(now.rev.rul)).toEqual({ igst: 0, cgst: 18, sgst: 18 });
    expect(pick(now.net)).toEqual({ igst: 0, cgst: 90, sgst: 90 });
  });

  it('reverse charge: before in 4(A)(5) OTH; after in 4(A)(3) ISRC, same net', () => {
    const purchases = [{ reverseCharge: true, items: [pl(10000, 18)] }];
    expect(before3B({ purchases, expenses: [] }).oth).toEqual({ igst: 0, cgst: 900, sgst: 900 });
    const now = itcTable4({ purchases });
    expect(pick(now.avl.oth)).toEqual({ igst: 0, cgst: 0, sgst: 0 });
    expect(pick(now.avl.isrc)).toEqual({ igst: 0, cgst: 900, sgst: 900 });
    expect(pick(now.net)).toEqual({ igst: 0, cgst: 900, sgst: 900 });
  });

  it('debit note: before its tax would have been claimed as credit; after it is reversed in 4(B)(2)', () => {
    const bill = { id: 'b1', items: [pl(6, 18, { quantity: 100, itemId: 'pen' })] };
    const dn = { docType: 'debit-note', againstPurchaseId: 'b1', items: [pl(6, 18, { quantity: 10, itemId: 'pen' })] };
    expect(before3B({ purchases: [bill, dn], expenses: [] }).oth.cgst).toBeCloseTo(59.4, 2); // 54 + 5.40 claimed
    const now = itcTable4({ purchases: [bill, dn] });
    expect(pick(now.avl.oth)).toEqual({ igst: 0, cgst: 54, sgst: 54 });
    expect(pick(now.rev.oth)).toEqual({ igst: 0, cgst: 5.4, sgst: 5.4 });
    expect(now.net.cgst).toBeCloseTo(48.6, 10);
    expect(now.net.sgst).toBeCloseTo(48.6, 10);
  });

  it('purchase orders in the same collection are never credit', () => {
    const now = itcTable4({ purchases: [{ docType: 'order', items: [pl(1000, 18)] }] });
    expect(now.net).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('expense marked not ITC-eligible: before claimed; after shown in 4(A) and reversed in 4(B)(1)', () => {
    const expenses = [{ gstAmount: 1800, itcEligible: false }, { gstAmount: 180 }];
    expect(before3B({ purchases: [], expenses }).oth).toEqual({ igst: 0, cgst: 990, sgst: 990 });
    const now = itcTable4({ expenses });
    expect(pick(now.avl.oth)).toEqual({ igst: 0, cgst: 990, sgst: 990 });
    expect(pick(now.net)).toEqual({ igst: 0, cgst: 90, sgst: 90 });
  });

  it('additional charges on a bill: before their GST was missed; after it is credit', () => {
    const purchases = [{ items: [pl(1000, 18)], charges: [{ name: 'Freight', amount: 200, gstRate: 18 }] }];
    expect(before3B({ purchases, expenses: [] }).oth).toEqual({ igst: 0, cgst: 90, sgst: 90 });
    expect(pick(itcTable4({ purchases }).net)).toEqual({ igst: 0, cgst: 108, sgst: 108 });
  });
});

describe('GSTR-1 and GSTR-3B 3.1 (Phase 3): other income, before (nothing) → after', () => {
  const profile = { state: 'Tamil Nadu' };
  const incomes = [
    // amounts include GST, as on expense records
    { id: 'a', number: 'INC-1', date: '2026-11-02', amount: 11800, gstAmount: 1800, gstPercent: 18, vendorName: 'Acme', vendorGstin: '29ABCDE1234F1Z5', interstate: true, placeOfSupply: 'Karnataka', sac: '9971', category: 'Commission' },
    { id: 'b', number: 'INC-2', date: '2026-11-03', amount: 5900, gstAmount: 900, gstPercent: 18, vendorName: 'Walk-in', category: 'Rent received' },
    { id: 'c', number: 'INC-3', date: '2026-11-04', amount: 1200, exempt: true, category: 'Interest received' },
    { id: 'd', number: 'INC-4', date: '2026-11-05', amount: 700, category: 'Misc' },
  ];
  const bills = incomeAsBills(incomes, profile);

  it('taxable income becomes a tax invoice (B2B with the payer GSTIN, B2CS without); non-supplies stay out', () => {
    expect(bills.map((b) => [b.invoiceNumber, b.invoiceType])).toEqual([['INC-1', 'tax-invoice'], ['INC-2', 'tax-invoice'], ['INC-3', 'bill-of-supply']]);
    expect(bills[0].data.client.gstin).toBe('29ABCDE1234F1Z5');
    expect(bills[0].data.totals).toMatchObject({ taxableAmount: 10000, igst: 1800, cgst: 0, sgst: 0, total: 11800, isInterstate: true });
    expect(bills[0].data.items).toEqual([expect.objectContaining({ hsn: '9971', rate: 10000, taxPercent: 18, quantity: 1 })]);
    expect(bills[1].data.client.gstin).toBe('');
    expect(bills[1].data.totals).toMatchObject({ taxableAmount: 5000, cgst: 450, sgst: 450, igst: 0 });
    expect(bills[1].data.details.placeOfSupply).toBe('Tamil Nadu');
  });
  it('exempt income lands in GSTR-1 Table 8 and 3.1(c) through the bills-of-supply table', () => {
    const r = nilExemptSummary(bills, { isInter: () => false, split: (it) => ({ taxable: it.rate * it.quantity }) });
    expect(r.inv).toEqual([{ sply_ty: 'INTRAB2C', expt_amt: 1200, nil_amt: 0, ngsup_amt: 0 }]);
    expect(incomeAsBills([], profile)).toEqual([]);
  });
});

// ---- P10-S4: the 180-day rule, before (credit kept for ever) → after (reversed, then re-claimed on payment) -------------
import { itc180ForPeriod } from '../src/features/purchases/purchaseExtras';

describe('GSTR-3B Table 4 (P10-S4): the 180-day rule', () => {
  // A bill of ₹10,000 + 18% dated 1 Jan 2026 (the supplier must be paid by 30 June); credit 900 + 900.
  const bill = (payments) => ({ id: 'b1', docType: 'bill', supplierName: 'Om', invoiceNumber: 'P-9', date: '2026-01-01', totalAmount: 11800, items: [pl(10000, 18)], payments });
  const inMonth = (ym) => (d) => String(d).startsWith(ym);
  const t4 = (month, purchases) => {
    const x = itc180ForPeriod(purchases, inMonth(month));
    return itcTable4({ purchases: purchases.filter((p) => inMonth(month)(p.date)), itc180: x.reversals.length || x.reclaims.length ? x : null });
  };
  const late = [{ amount: 3000, date: '2026-03-01' }, { amount: 8800, date: '2026-08-10' }];

  it('before: the bill kept its full credit for ever, however long the supplier went unpaid', () => {
    expect(before3B({ purchases: [bill(late)], expenses: [] }).oth).toEqual({ igst: 0, cgst: 900, sgst: 900 });
  });
  it('after, in January: the bill still claims its credit, the rule has nothing to say yet', () => {
    const t = t4('2026-01', [bill(late)]);
    expect(pick(t.avl.oth)).toEqual({ igst: 0, cgst: 900, sgst: 900 });
    expect(t.reversed).toBe(false);
    expect(pick(t.net)).toEqual({ igst: 0, cgst: 900, sgst: 900 });
  });
  it('after, in July (the first day past the deadline): credit on the unpaid ₹8,800 is reversed in 4(B)(2)', () => {
    const t = t4('2026-07', [bill(late)]);
    expect(pick(t.rev.oth)).toEqual({ igst: 0, cgst: 671.19, sgst: 671.19 }); // 1800 × 8800 / 11800 = 1342.37
    expect(t.reversed).toBe(true);
  });
  it('after, in August: the late payment brings that credit back as Re-claimed ITC', () => {
    const t = t4('2026-08', [bill(late)]);
    expect(pick(t.avl.reclaim)).toEqual({ igst: 0, cgst: 671.19, sgst: 671.19 });
    expect(pick(t.net)).toEqual({ igst: 0, cgst: 671.19, sgst: 671.19 });
  });
  it('nothing changes when the supplier is paid within 180 days, or for a bill with no payments recorded in a quiet month', () => {
    const paidInTime = [{ amount: 11800, date: '2026-06-30' }];
    expect(t4('2026-07', [bill(paidInTime)]).reversed).toBe(false);
    expect(t4('2026-08', [bill(paidInTime)]).reversed).toBe(false);
    expect(pick(t4('2026-07', [bill([])]).rev.oth)).toEqual({ igst: 0, cgst: 900, sgst: 900 }); // never paid: all of it
    expect(t4('2026-05', [bill([])]).reversed).toBe(false);
  });
  it('an inter-state bill reverses through IGST', () => {
    const b = { ...bill([]), interstate: true };
    expect(pick(t4('2026-07', [b]).rev.oth)).toEqual({ igst: 1800, cgst: 0, sgst: 0 });
  });
});

// ---- P10-S1: advances for services (D-14) ----------------------------------------------------------------------------
import { table11, table11Json, withAdvanceTax } from '@ledgora/tax-engine';
import { advanceReceiptsOf, periodBounds } from '../src/features/gst-returns/gstReturnTables';

describe('P10-S1 GSTR-1 Table 11 and GSTR-3B 3.1(a) with advances', () => {
  const profile = { gstin: '33ABCDE1234F1Z5', state: 'Tamil Nadu' };
  const receipt = (o) => ({ id: 'R1', receiptNo: 'RCP/1', date: '2026-11-10', amount: 11800, ...o });
  const invoices31a = { taxable: 50000, igst: 0, cgst: 4500, sgst: 4500, cess: 0, total: 59000 };

  it('reads only receipts marked as an advance for services', () => {
    const list = advanceReceiptsOf([
      receipt({ advance: { services: true, rate: 18, pos: '33' } }),
      receipt({ id: 'R2', advance: { services: false, rate: 18, pos: '33' } }), // goods: not taxed
      receipt({ id: 'R3' }), // an ordinary receipt
    ]);
    expect(list).toEqual([{ id: 'R1', date: '2026-11-10', amount: 11800, rate: 18, pos: '33', adjustments: [] }]);
  });

  it('before: a month without advances leaves 3.1(a) and the GSTR-1 JSON exactly as they were', () => {
    const t = table11({ receipts: [], ...periodBounds('month', { year: 2026, month: 10 }), bizState: '33' });
    expect(withAdvanceTax(invoices31a, t)).toBe(invoices31a);
    expect(table11Json(t)).toEqual({});
  });

  it('after: an ₹11,800 advance at 18% adds ₹10,000 taxable and ₹900 + ₹900 to 3.1(a), and appears in 11A', () => {
    const receipts = advanceReceiptsOf([receipt({ advance: { services: true, rate: 18, pos: '33' } })]);
    const t = table11({ receipts, ...periodBounds('month', { year: 2026, month: 10 }), bizState: '33' });
    expect(withAdvanceTax(invoices31a, t)).toEqual({ taxable: 60000, igst: 0, cgst: 5400, sgst: 5400, cess: 0, total: 59000 });
    expect(table11Json(t).at[0]).toEqual({ pos: '33', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 }] });
    expect(profile.gstin.slice(0, 2)).toBe('33');
  });

  it('after: when the advance is adjusted next month, 3.1(a) of that month is reduced by the same tax (11B)', () => {
    const receipts = advanceReceiptsOf([receipt({
      advance: { services: true, rate: 18, pos: '33', adjustments: [{ date: '2026-12-04', amount: 11800, kind: 'invoice', invoiceNumber: 'INV/9' }] },
    })]);
    const dec = table11({ receipts, ...periodBounds('month', { year: 2026, month: 11 }), bizState: '33' });
    expect(withAdvanceTax(invoices31a, dec)).toMatchObject({ taxable: 40000, cgst: 3600, sgst: 3600 });
    expect(table11Json(dec).txpd[0].itms[0]).toEqual({ rt: 18, ad_amt: 10000, iamt: 0, camt: 900, samt: 900, csamt: 0 });
  });

  it('period bounds for a month, a quarter and a financial year', () => {
    expect(periodBounds('month', { year: 2026, month: 1 })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodBounds('quarter', { year: 2026, months: [9, 10, 11] })).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodBounds('fy', { from: '2026-04-01', to: '2027-03-31' })).toEqual({ from: '2026-04-01', to: '2027-03-31' });
  });
});

// ---- P10-S2: reverse charge end to end (D-13) ------------------------------------------------------------------------
import { rcmItcForPeriod } from '@ledgora/tax-engine';
import { purchaseItcHeads, rcmBillsOf } from '../src/features/gst-returns/gstReturnTables';
import { purchaseDue } from '../src/features/purchases/purchaseExtras';

describe('P10-S2 GSTR-3B with reverse charge: credit in the month the RCM tax is paid', () => {
  const NOV = { from: '2026-11-01', to: '2026-11-30' };
  const DEC = { from: '2026-12-01', to: '2026-12-31' };
  const pl2 = (amount, rate) => ({ quantity: 1, rate: amount, taxPercent: rate });
  const gta = (o = {}) => ({ id: 'P17', date: '2026-11-08', reverseCharge: true, interstate: false, items: [pl2(10000, 5)], totalTax: 500, totalAmount: 10500, ...o });
  const heads = (h) => ({ igst: h.igst, cgst: h.cgst, sgst: h.sgst });

  it('the RCM tax of a bill is its own tax, split like any purchase', () => {
    expect(heads(purchaseItcHeads(gta()).all)).toEqual({ igst: 0, cgst: 250, sgst: 250 });
  });

  it('before payment: liable in 3.1(d), nothing in 4(A)(3), the bill is on the unpaid list', () => {
    const rcm = rcmItcForPeriod(rcmBillsOf([gta()]), NOV);
    expect(heads(rcm.liability)).toEqual({ igst: 0, cgst: 250, sgst: 250 });
    const t = itcTable4({ purchases: [gta()], rcm });
    expect(pick(t.avl.isrc)).toEqual({ igst: 0, cgst: 0, sgst: 0 });
    expect(pick(t.net)).toEqual({ igst: 0, cgst: 0, sgst: 0 });
    expect(rcm.unpaid.map((b) => b.id)).toEqual(['P17']);
  });

  it('after payment in December: November keeps the liability only; December claims 4(A)(3)', () => {
    const paid = gta({ rcmPayment: { date: '2026-12-05', amount: 500, mode: 'Bank Transfer' } });
    const nov = itcTable4({ purchases: [paid], rcm: rcmItcForPeriod(rcmBillsOf([paid]), NOV) });
    expect(pick(nov.avl.isrc)).toEqual({ igst: 0, cgst: 0, sgst: 0 });
    const dec = itcTable4({ purchases: [], rcm: rcmItcForPeriod(rcmBillsOf([paid]), DEC) });
    expect(pick(dec.avl.isrc)).toEqual({ igst: 0, cgst: 250, sgst: 250 });
    expect(pick(dec.net)).toEqual({ igst: 0, cgst: 250, sgst: 250 });
  });

  it('no double count: an RCM bill never adds to 4(A)(5) and an ordinary bill never to 4(A)(3)', () => {
    const ordinary = { id: 'P18', date: '2026-11-09', items: [pl2(1000, 18)], totalTax: 180 };
    const paid = gta({ rcmPayment: { date: '2026-11-20', amount: 500 } });
    const t = itcTable4({ purchases: [paid, ordinary], rcm: rcmItcForPeriod(rcmBillsOf([paid, ordinary]), NOV) });
    expect(pick(t.avl.isrc)).toEqual({ igst: 0, cgst: 250, sgst: 250 });
    expect(pick(t.avl.oth)).toEqual({ igst: 0, cgst: 90, sgst: 90 });
  });

  it('D-13: the supplier of an RCM bill is owed the bill without the tax (before: ₹10,500, after: ₹10,000)', () => {
    expect(purchaseDue(gta())).toBe(10000);
    expect(purchaseDue({ id: 'X', totalAmount: 11800, totalTax: 1800 })).toBe(11800);
  });

  it('without the rcm argument Table 4 reads exactly as before (in-period RCM bills in 4(A)(3))', () => {
    expect(pick(itcTable4({ purchases: [gta()] }).avl.isrc)).toEqual({ igst: 0, cgst: 250, sgst: 250 });
  });
});

// ---- P10-S3: GSTR-3B 3.1(b) SEZ, 3.2 and 5 ---------------------------------------------------------------------------
import { exemptInward, interStateUnregistered, moveSezToZeroRated } from '@ledgora/tax-engine';
import { sezSupplies, unregisteredInterRows } from '../src/features/gst-returns/gstReturnTables';

describe('P10-S3 GSTR-3B cells: before → after', () => {
  const inv = (o) => ({
    invoiceType: 'tax-invoice', invoiceDate: '2026-11-05',
    data: { client: { gstin: '', state: 'Karnataka' }, details: { placeOfSupply: 'Karnataka' }, totals: { taxableAmount: 10000, igst: 1800, cgst: 0, sgst: 0, cess: 0, total: 11800, isInterstate: true } },
    ...o,
  });
  const sez = inv({ data: { client: { gstin: '29AAAAA0000A1Z5', isSEZ: true }, details: {}, totals: { taxableAmount: 50000, igst: 9000, cess: 0, total: 59000, isInterstate: true } } });
  const local = inv({ data: { client: { gstin: '', state: 'Tamil Nadu' }, details: { placeOfSupply: 'Tamil Nadu' }, totals: { taxableAmount: 4000, cgst: 360, sgst: 360, igst: 0, cess: 0, total: 4720, isInterstate: false } } });

  it('3.1(a)/(b): before, an SEZ invoice sat in 3.1(a); after, it is in 3.1(b) with the same IGST payable', () => {
    const before31a = { taxable: 50000, igst: 9000, cgst: 0, sgst: 0, cess: 0, total: 59000 };
    const r = moveSezToZeroRated(before31a, { taxable: 0, igst: 0, cess: 0 }, sezSupplies([sez, local]));
    expect(r.a).toMatchObject({ taxable: 0, igst: 0 });
    expect(r.b).toEqual({ taxable: 50000, igst: 9000, cess: 0 });
    expect(r.a.igst + r.b.igst).toBe(before31a.igst); // output tax unchanged
  });

  it('3.2: before, not in the JSON at all; after, unregistered inter-state sales by place of supply', () => {
    const cn = inv({ invoiceType: 'credit-note', data: { ...inv().data, totals: { taxableAmount: 1000, igst: 180, total: 1180, isInterstate: true } } });
    const rows = unregisteredInterRows([inv(), inv(), local, sez, cn]);
    expect(interStateUnregistered(rows)).toEqual([{ pos: '29', txval: 19000, iamt: 3420 }]);
  });

  it('5: before, zero-filled; after, 0% purchases by inter / intra', () => {
    expect(exemptInward([{ interstate: false, items: [{ quantity: 1, rate: 2500, taxPercent: 0 }] }]).gst).toEqual({ inter: 0, intra: 2500 });
  });
});

// ---- P10-S5: TDS receivable (customers deducted) for the 26AS comparison -----------------------------------------------
import { tdsBookByCustomer } from '../src/features/gst-returns/gstReturnTables';

describe('P10-S5 TDS receivable by customer', () => {
  const bill = (no, client, tds) => ({ invoiceNumber: no, clientName: client, data: { client: { name: client }, totals: { tdsAmount: tds } } });
  it('adds TDS on invoices and TDS kept on receipts, without counting one deduction twice', () => {
    const bills = [bill('INV/1', 'Acme', 1000), bill('INV/2', 'Bala', 0)];
    const receipts = [
      { clientName: 'Acme', tds: 1000, againstInvoice: 'INV/1' }, // the same deduction as on INV/1
      { clientName: 'Bala', tds: 200, againstInvoice: 'INV/2' },
      { clientName: 'Bala', tds: 0 },
    ];
    expect(tdsBookByCustomer(bills, receipts)).toEqual([
      { deductor: 'Acme', tds: 1000 },
      { deductor: 'Bala', tds: 200 },
    ]);
  });
});
