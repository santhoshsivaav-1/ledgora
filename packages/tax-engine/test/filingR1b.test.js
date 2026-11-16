// R1, second half: GSTR-4, GSTR-9C, late fee and interest, e-invoice coverage, 3B against the portal.
import { describe, expect, it } from 'vitest';
import {
  GSTIN_CHARS,
  buildCmp08,
  buildGstr4,
  buildGstr9c,
  comparePortal3b,
  einvoiceChecks,
  gstInterest,
  gstLateFee,
  packMonths,
  validateAnyPack,
  validateGstr4,
  validateGstr9c,
} from '../src/index.ts';

const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};
const OWN = gstin('33AAPFU0939F1Z');
const SUP = gstin('33AABCU9603R1Z');
const codes = (list, sev) => list.filter((i) => i.severity === sev).map((i) => i.code);

describe('late fee and interest', () => {
  it('GSTR-3B: ₹50 a day capped by turnover, ₹20 a day capped ₹500 when nil', () => {
    expect(gstLateFee('GSTR-3B', '2026-11-20', '2026-11-30')).toEqual({ days: 10, fee: 500, cap: 2000 });
    expect(gstLateFee('GSTR-3B', '2026-01-20', '2026-11-30').fee).toBe(2000);
    expect(gstLateFee('GSTR-1', '2026-01-11', '2026-11-30', { aato: 3e7 }).fee).toBe(5000);
    expect(gstLateFee('GSTR-1', '2026-01-11', '2026-11-30', { aato: 6e7 }).fee).toBe(10000);
    expect(gstLateFee('GSTR-3B', '2026-11-20', '2026-12-20', { nil: true })).toEqual({ days: 30, fee: 500, cap: 500 });
    expect(gstLateFee('GSTR-3B', '2026-11-20', '2026-11-19').fee).toBe(0);
    expect(gstLateFee('GSTR-9', '2026-12-31', '2027-01-10')).toBeNull();
  });
  it('interest is 18% a year by the day on the cash paid late', () => {
    expect(gstInterest(100000, '2026-11-20', '2026-12-20')).toBe(1479.45);
  });
});

describe('e-invoice coverage', () => {
  const b = (no, date, over = {}) => ({
    invoiceNumber: no,
    invoiceDate: date,
    invoiceType: 'tax-invoice',
    data: { client: { gstin: SUP }, invoiceOptions: {} },
    ...over,
  });
  it('nothing below ₹5 crore', () => {
    expect(einvoiceChecks([b('A1', '2026-10-01')], { aato: 4e7, asOf: '2026-11-15' })).toEqual([]);
  });
  it('above ₹5 crore every B2B invoice needs an IRN; at ₹10 crore the 30-day window applies', () => {
    const bills = [
      b('A1', '2026-11-10'),
      b('A2', '2026-09-01'),
      b('A3', '2026-11-01', { data: { client: { gstin: SUP }, invoiceOptions: { einvoice: { irn: 'x' } } } }),
      b('B1', '2026-11-01', { data: { client: {} } }), // B2C: not covered
      b('A4', '2026-11-01', { status: 'cancelled' }),
    ];
    expect(einvoiceChecks(bills, { aato: 6e7, asOf: '2026-11-15' }).map((i) => [i.code, i.path])).toEqual([
      ['EINV_MISSING', 'A1'],
      ['EINV_MISSING', 'A2'],
    ]);
    expect(einvoiceChecks(bills, { aato: 1.2e8, asOf: '2026-11-15' }).map((i) => i.code)).toEqual([
      'EINV_MISSING',
      'EINV_PAST_30_DAYS',
    ]);
  });
});

describe('GSTR-3B against the portal', () => {
  const r3 = { sup_details: { osup_det: { txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 } } };
  it('compares 3.1(a) only: exports in 3.1(b) do not count as a difference', () => {
    const withExport = { sup_details: { ...r3.sup_details, osup_zero: { txval: 5000, iamt: 900, csamt: 0 } } };
    expect(comparePortal3b(withExport, { txval: 1000, iamt: 0, camt: 90, samt: 90 })).toEqual([]);
  });
  it('flags only the heads that differ by more than ₹1', () => {
    expect(comparePortal3b(r3, { txval: 1000, camt: 90.5, samt: 95 }).map((i) => i.path)).toEqual(['samt']);
  });
});

describe('GSTR-4', () => {
  const cmp = (p, t) => buildCmp08(OWN, p, t, 1, { camt: 9, samt: 9 });
  const purchases = [
    { docType: 'bill', date: '2026-05-01', supplierGstin: SUP, taxableAmount: 1000, totalTax: 180, interstate: false },
    { docType: 'bill', date: '2026-06-01', supplierGstin: SUP, taxableAmount: 500, totalTax: 90, interstate: false },
    { docType: 'bill', date: '2026-07-01', supplierGstin: '', reverseCharge: true, taxableAmount: 100, totalTax: 18, interstate: false },
    { docType: 'bill', date: '2027-04-01', supplierGstin: SUP, taxableAmount: 9999, totalTax: 1, interstate: false }, // next year
  ];
  it('adds the year’s CMP-08s and purchases into Tables 4, 5 and 6', () => {
    const g = buildGstr4({ gstin: OWN, fy: 2026, cmp08: [cmp('062026', 100000), cmp('092026', 200000), cmp('122026', 0), cmp('032027', 50000)], purchases });
    expect(g.table5.map((q) => [q.ret_period, q.cgst])).toEqual([['062026', 500], ['092026', 1000], ['122026', 0], ['032027', 250]]);
    expect(g.table6).toEqual([{ rate: 1, turnover: 350000, cgst: 1750, sgst: 1750 }]);
    expect(g.table4.A_registered_suppliers).toEqual([{ ctin: SUP, txval: 1500, iamt: 0, camt: 135, samt: 135 }]);
    expect(g.table4.C_reverse_charge_unregistered).toEqual({ txval: 100, iamt: 0, camt: 9, samt: 9 });
    expect(codes(validateGstr4(g, { gstin: OWN }), 'error')).toEqual([]);
    expect(packMonths('gstr4', '032027', false)).toHaveLength(12);
  });
  it('a quarter without its CMP-08 is an error', () => {
    const g = buildGstr4({ gstin: OWN, fy: 2026, cmp08: [cmp('062026', 1)], purchases: [] });
    expect(g.missing).toEqual(['092026', '122026', '032027']);
    expect(codes(validateAnyPack('gstr4', g, { gstin: OWN }), 'error')).toEqual(['CMP08_NOT_FILED', 'CMP08_NOT_FILED', 'CMP08_NOT_FILED']);
  });
});

describe('GSTR-9C', () => {
  const gstr9 = {
    gstin: OWN,
    table4: { net_after_credit_notes: { txval: 900000 } },
    table5: { A_exports_without_tax: 50000, B_sez_without_tax: 0, D_exempt_and_nil: 10000, F_non_gst: 0 },
    table6: { A_itc_as_per_3b: { iamt: 1000, camt: 5000, samt: 5000, csamt: 0 } },
    table9: { tax_payable_as_per_3b: { iamt: 18000, camt: 72000, samt: 72000, csamt: 0 } },
  };
  const books = {
    turnover: 965000,
    taxable: 900000,
    tax: { iamt: 18000, camt: 72000, samt: 72000, csamt: 0 },
    itc: { iamt: 1000, camt: 5200, samt: 5000, csamt: 0 },
  };
  it('reconciles turnover with adjustments and shows what stays unreconciled', () => {
    const c = buildGstr9c({ gstin: OWN, fy: 2026, gstr9, books, adjustments: [{ label: 'Unbilled revenue at year end', amount: -5000 }] });
    expect(c.table5).toMatchObject({ A_turnover_in_books: 965000, O_turnover_after_adjustments: 960000, P_turnover_in_gstr9: 960000, Q_unreconciled: 0 });
    expect(c.table7.unreconciled).toBe(0);
    expect(c.table12.unreconciled.camt).toBe(200);
    const issues = validateGstr9c(c, { gstin: OWN });
    expect(codes(issues, 'error')).toEqual([]);
    expect(issues.map((i) => i.path)).toEqual(['table12:camt']);
  });
  it('without the adjustment the turnover gap is a warning', () => {
    const c = buildGstr9c({ gstin: OWN, fy: 2026, gstr9, books });
    expect(c.table5.Q_unreconciled).toBe(5000);
    expect(codes(validateAnyPack('gstr9c', c, { gstin: OWN }), 'warning')).toContain('R9C_TURNOVER');
  });
});
