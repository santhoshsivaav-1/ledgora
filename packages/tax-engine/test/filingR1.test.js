// R1 (docs/FEATURE_GAPS_2026-11.md): GSTR-1A differences, GSTR-9 from the year's returns, CMP-08.
import { describe, expect, it } from 'vitest';
import {
  GSTIN_CHARS,
  buildCmp08,
  buildGstr9,
  diffGstr1,
  fyRetPeriods,
  gstr1aPack,
  packMonths,
  validateAnyPack,
  validateCmp08,
  validateGstr1a,
  validateGstr9,
} from '../src/index.ts';

const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};
const OWN = gstin('27AAPFU0939F1Z');
const B1 = gstin('27AABCU9603R1Z');
const B2 = gstin('29AABCU9603R1Z');
const intra = (txval, rt = 18) => ({ itm_det: { rt, txval, camt: (txval * rt) / 200, samt: (txval * rt) / 200, csamt: 0 } });
const inter = (txval, rt = 18) => ({ itm_det: { rt, txval, iamt: (txval * rt) / 100, csamt: 0 } });
const r1 = (fp, over = {}) => ({
  gstin: OWN,
  fp,
  version: 'GST3.0.4',
  b2b: [
    { ctin: B1, inv: [{ inum: 'A1', idt: '05-10-2026', pos: '27', inv_typ: 'R', itms: [intra(1000)] }] },
    { ctin: B2, inv: [{ inum: 'A2', idt: '06-10-2026', pos: '29', inv_typ: 'R', itms: [inter(2000)] }] },
  ],
  b2cs: [{ sply_ty: 'INTRA', pos: '27', rt: 5, txval: 400, camt: 10, samt: 10, csamt: 0 }],
  hsn: { data: [{ hsn_sc: '8471', rt: 18, uqc: 'NOS', qty: 3, txval: 3000, iamt: 360, camt: 90, samt: 90 }] },
  ...over,
});
const r3 = (ret_period, over = {}) => ({
  gstin: OWN,
  ret_period,
  version: 'GST3.0.4',
  sup_details: {
    osup_det: { txval: 3400, iamt: 360, camt: 100, samt: 100, csamt: 0 },
    osup_zero: { txval: 0, iamt: 0, csamt: 0 },
    osup_nil_exmp: { txval: 50 },
    osup_nongst: { txval: 0 },
    isup_rev: { txval: 100, iamt: 0, camt: 9, samt: 9, csamt: 0 },
  },
  itc_elg: { itc_avl: [{ ty: 'OTH', iamt: 100, camt: 40, samt: 40, csamt: 0 }], itc_rev: [{ ty: 'OTH', iamt: 10, camt: 0, samt: 0, csamt: 0 }] },
  ...over,
});
const codes = (list, sev) => list.filter((i) => i.severity === sev).map((i) => i.code);

describe('GSTR-1A: what changed after GSTR-1 was filed', () => {
  it('finds added, amended and deleted invoices and B2CS rows, and the effect on liability', () => {
    const filed = r1('102026');
    const now = r1('102026', {
      b2b: [
        { ctin: B1, inv: [{ inum: 'A1', idt: '05-10-2026', pos: '27', inv_typ: 'R', itms: [intra(1500)] }] }, // amended
        { ctin: B1, inv: [{ inum: 'A3', idt: '20-10-2026', pos: '27', inv_typ: 'R', itms: [intra(700)] }] }, // added
      ], // A2 deleted
      b2cs: [{ sply_ty: 'INTRA', pos: '27', rt: 5, txval: 400, camt: 10, samt: 10, csamt: 0 }],
    });
    const rows = diffGstr1(filed, now);
    expect(rows.map((r) => [r.table, r.key, r.change])).toEqual([
      ['b2b', `${B1} A1`, 'amended'],
      ['b2b', `${B1} A3`, 'added'],
      ['b2b', `${B2} A2`, 'deleted'],
    ]);
    const pack = gstr1aPack(OWN, '102026', filed, now);
    // +500 +700 −2000 taxable
    expect(pack.delta.txval).toBe(-800);
    expect(pack.delta.iamt).toBe(-360);
    const issues = validateGstr1a(pack, { gstin: OWN, retPeriod: '102026' });
    expect(codes(issues, 'error')).toEqual([]);
    expect(codes(issues, 'warning')).toEqual(['R1A_DELETE']);
  });
  it('a change in date or place of supply with the same amount is an amendment; nothing changed is an error', () => {
    const now = r1('102026');
    now.b2b[0].inv[0].idt = '07-10-2026';
    expect(diffGstr1(r1('102026'), now).map((r) => r.change)).toEqual(['amended']);
    expect(codes(validateGstr1a(gstr1aPack(OWN, '102026', r1('102026'), r1('102026'))), 'error')).toEqual(['NO_CHANGES']);
  });
});

describe('GSTR-9 from the year', () => {
  const months = fyRetPeriods(2026);
  it('lists the twelve months April to March', () => {
    expect(months[0]).toBe('042026');
    expect(months[11]).toBe('032027');
    expect(packMonths('gstr9', '032027', false)).toHaveLength(12);
    expect(packMonths('gstr9', '102026', false)).toEqual([]);
    expect(packMonths('cmp08', '122026', false)).toEqual(['2026-10', '2026-11', '2026-12']);
  });
  it('adds the year up into Tables 4, 5, 6, 7, 9 and 17, and compares ITC with 2B in Table 8', () => {
    const g = buildGstr9({
      gstin: OWN,
      fy: 2026,
      gstr1: months.map((m) => r1(m)),
      gstr3b: months.map((m) => r3(m)),
      itc2b: { iamt: 1000, camt: 480, samt: 480, csamt: 0 },
    });
    expect(g.table4.B_b2b.txval).toBe(36000);
    expect(g.table4.A_b2c.txval).toBe(4800);
    expect(g.table4.G_inward_reverse_charge.camt).toBe(108);
    expect(g.table5.D_exempt_and_nil).toBe(600);
    expect(g.table6.A_itc_as_per_3b).toEqual({ txval: 0, iamt: 1200, camt: 480, samt: 480, csamt: 0 });
    expect(g.table7.reversals_as_per_3b.iamt).toBe(120);
    expect(g.table8.D_difference.iamt).toBe(-200);
    expect(g.table17).toEqual([{ txval: 36000, iamt: 4320, camt: 1080, samt: 1080, csamt: 0, hsn_sc: '8471', rt: 18, uqc: 'NOS', qty: 36 }]);
    expect(g.missing).toEqual({ gstr1: [], gstr3b: [] });
    const issues = validateGstr9(g, { gstin: OWN });
    expect(codes(issues, 'error')).toEqual([]);
    expect(codes(issues, 'warning')).toContain('ITC_ABOVE_2B');
  });
  it('a month without its filed returns is an error', () => {
    const g = buildGstr9({ gstin: OWN, fy: 2026, gstr1: months.slice(1).map((m) => r1(m)), gstr3b: months.map((m) => r3(m)) });
    expect(g.missing.gstr1).toEqual(['042026']);
    const issues = validateAnyPack('gstr9', g, { gstin: OWN });
    expect(codes(issues, 'error')).toEqual(['R1_NOT_FILED']);
    expect(codes(issues, 'warning')).toContain('NO_2B');
  });
});

describe('CMP-08', () => {
  it('works out the quarter’s tax at the composition rate and checks it', () => {
    const c = buildCmp08(OWN, '122026', 300000, 1, { camt: 50, samt: 50 });
    expect(c.outward).toEqual({ turnover: 300000, ratePercent: 1, cgst: 1500, sgst: 1500 });
    expect(validateCmp08(c, { gstin: OWN, retPeriod: '122026' })).toEqual([]);
    expect(codes(validateCmp08({ ...c, outward: { ...c.outward, cgst: 10 } }), 'error')).toEqual(['TAX_NOT_RATE']);
    expect(codes(validateCmp08({ ...c, ret_period: '112026' }), 'error')).toEqual(['PERIOD_INVALID']);
    expect(codes(validateCmp08(buildCmp08(OWN, '122026', 1000, 4)), 'warning')).toEqual(['RATE_UNUSUAL']);
  });
});
