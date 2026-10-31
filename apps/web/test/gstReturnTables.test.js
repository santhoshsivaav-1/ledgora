import { describe, expect, it } from 'vitest';
import { nilExemptSummary, exportSection } from '../src/features/gst-returns/gstReturnTables';

const item = (amount, rate = 0) => ({ amount, taxPercent: rate });
const split = (it) => ({ taxable: it.amount, igst: it.taxPercent ? (it.amount * it.taxPercent) / 100 : 0, cess: 0 });
const bos = (client, items, inter = false, type = 'bill-of-supply') => ({ invoiceType: type, data: { client, items } });

describe('GSTR-1 Table 8 (bills of supply)', () => {
  it('totals bills of supply by buyer kind and ignores every other document', () => {
    const bills = [
      bos({ gstin: '29ABCDE1234F1Z5' }, [item(1000), item(500)]),
      bos({}, [item(250)]),
      bos({}, [item(100)], true),
      bos({}, [item(9999)], false, 'tax-invoice'),
      bos({}, [item(7777)], false, 'composition'),
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
