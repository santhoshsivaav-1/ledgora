// Two GSTR-1 tables built from the period's bills, kept free of React so they can be tested on their own:
//   Table 8  - nil-rated, exempt and non-GST outward supplies (the bills of supply). Also GSTR-3B 3.1(c).
//   Table 6A - exports (zero-rated supply to a client outside India).
// `split(item, bill)` is the app's per-line tax split ({ taxable, igst, cess, ... }); `isInter(bill)` and `fmtDate` come from
// the page, so this file does not depend on them.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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
