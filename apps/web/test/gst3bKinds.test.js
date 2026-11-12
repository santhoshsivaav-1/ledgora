import { describe, expect, it } from 'vitest';
import { itcTable4, nilExemptSummary, rcmBillsOf, withoutNonTaxable } from '../src/features/gst-returns/gstReturnTables';

// GSTR-3B 3.1(c)/(e) and 4(A)(1)/(2): lines marked nil-rated, exempt or non-GST, and purchase bills that are imports.
const split = (item) => ({ taxable: (Number(item.quantity) || 0) * (Number(item.rate) || 0) });
const bill = (items, over = {}) => ({
  id: 'b', invoiceType: 'tax-invoice', totalAmount: 0,
  data: { client: { gstin: '' }, items, totals: { taxableAmount: items.reduce((n, i) => n + i.quantity * i.rate, 0), total: 0 } },
  ...over,
});

describe('marked lines leave the taxable tables', () => {
  it('a bill without marks is returned as it is', () => {
    const b = bill([{ quantity: 1, rate: 100, taxPercent: 18 }]);
    expect(withoutNonTaxable(b, split)).toBe(b);
  });
  it('marked lines come out and lower the taxable value', () => {
    const b = bill([{ quantity: 1, rate: 100, taxPercent: 18 }, { quantity: 2, rate: 10, taxPercent: 0, supplyKind: 'nil' }], { totalAmount: 138 });
    b.data.totals.total = 138;
    const t = withoutNonTaxable(b, split);
    expect(t.data.items).toHaveLength(1);
    expect(t.data.totals.taxableAmount).toBe(100);
    expect(t.data.totals.total).toBe(118);
    expect(t.totalAmount).toBe(118);
    expect(t._kindOnly).toBe(false);
    expect(withoutNonTaxable(bill([{ quantity: 1, rate: 5, supplyKind: 'nongst' }]), split)._kindOnly).toBe(true);
  });
});

describe('Table 8 and 3.1(c)/(e)', () => {
  it('splits nil, exempt and non-GST; adds bills of supply; credit notes take theirs back', () => {
    const bills = [
      bill([{ quantity: 1, rate: 100, supplyKind: 'nil' }, { quantity: 1, rate: 50, supplyKind: 'exempt' }, { quantity: 1, rate: 30, supplyKind: 'nongst' }, { quantity: 1, rate: 999, taxPercent: 18 }]),
      bill([{ quantity: 1, rate: 40 }], { invoiceType: 'bill-of-supply' }),
      bill([{ quantity: 1, rate: 10, supplyKind: 'nil' }], { invoiceType: 'credit-note' }),
      bill([{ quantity: 1, rate: 7, supplyKind: 'nil' }], { invoiceType: 'quotation' }),
    ];
    const s = nilExemptSummary(bills, { isInter: () => false, split });
    expect(s.inv).toEqual([{ sply_ty: 'INTRAB2C', expt_amt: 90, nil_amt: 90, ngsup_amt: 30 }]);
    expect(s.nilExempt).toBe(180);
    expect(s.nonGst).toBe(30);
    expect(s.total).toBe(210);
  });
});

describe('imports in Table 4', () => {
  const pur = (over) => ({ docType: 'bill', totalTax: 180, interstate: true, items: [{ quantity: 1, rate: 1000, taxPercent: 18 }], ...over });
  it('goods to 4(A)(1), services to 4(A)(2), never also in 4(A)(3) or (5); the net includes them', () => {
    const t = itcTable4({ purchases: [pur({ importType: 'goods' }), pur({ importType: 'services', reverseCharge: true }), pur({})] });
    expect(t.avl.impg.igst).toBe(180);
    expect(t.avl.imps.igst).toBe(180);
    expect(t.avl.isrc.igst).toBe(0);
    expect(t.avl.oth.igst).toBe(180);
    expect(t.net.igst).toBe(540);
  });
  it('an import of goods keyed as CGST + SGST is still IGST', () => {
    const t = itcTable4({ purchases: [pur({ importType: 'goods', interstate: false })] });
    expect(t.avl.impg).toMatchObject({ igst: 180, cgst: 0, sgst: 0 });
  });
  it('import of services stays out of the reverse-charge payment list (its credit is 4(A)(2))', () => {
    expect(rcmBillsOf([pur({ importType: 'services', reverseCharge: true }), pur({ reverseCharge: true, id: 'x' })]).map((b) => b.id)).toEqual(['x']);
  });
});
