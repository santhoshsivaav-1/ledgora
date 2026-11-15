// File-ready returns, Phase 1: the checks that decide whether a pack is "100% file-ready", the status rules and IMS.
import { describe, expect, it } from 'vitest';
import {
  GSTIN_CHARS,
  arnProblem,
  canonicalJson,
  gstr1Liability,
  imsActions,
  imsPack,
  nextStatus,
  periodBoundsOf,
  retPeriodMonths,
  readiness,
  retPeriodOf,
  validateGstr1,
  validateGstr3b,
  validateIms,
} from '../src/index.ts';

/** A GSTIN with a correct check character, from its first 14. */
const gstin = (first14) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
};
const OWN = gstin('27AAPFU0939F1Z'); // Maharashtra
const BUYER_MH = gstin('27AABCU9603R1Z');
const BUYER_KA = gstin('29AABCU9603R1Z');

const item = (rt, txval, inter) => ({
  num: 1,
  itm_det: inter
    ? { rt, txval, iamt: (txval * rt) / 100, csamt: 0 }
    : { rt, txval, camt: (txval * rt) / 200, samt: (txval * rt) / 200, csamt: 0 },
});
const r1 = (over = {}) => ({
  gstin: OWN,
  fp: '102026',
  version: 'GST3.0.4',
  hash: 'hash',
  b2b: [
    { ctin: BUYER_MH, inv: [{ inum: 'INV/001', idt: '05-10-2026', val: 11800, pos: '27', inv_typ: 'R', itms: [item(18, 10000, false)] }] },
    { ctin: BUYER_KA, inv: [{ inum: 'INV/002', idt: '06-10-2026', val: 5900, pos: '29', inv_typ: 'R', itms: [item(18, 5000, true)] }] },
  ],
  b2cs: [{ sply_ty: 'INTRA', pos: '27', typ: 'OE', rt: 5, txval: 2000, camt: 50, samt: 50, csamt: 0 }],
  hsn: { data: [{ num: 1, hsn_sc: '8471', txval: 17000 }] },
  ...over,
});
const errors = (list) => list.filter((i) => i.severity === 'error').map((i) => i.code);
const warnings = (list) => list.filter((i) => i.severity === 'warning').map((i) => i.code);

describe('periods', () => {
  it('monthly and quarterly months and bounds', () => {
    expect(retPeriodOf('2026-10')).toBe('102026');
    expect(retPeriodMonths('102026')).toEqual(['2026-10']);
    expect(retPeriodMonths('122026', true)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(retPeriodMonths('112026', true)).toEqual([]); // a quarter ends in Mar, Jun, Sep, Dec
    expect(retPeriodMonths('132026')).toEqual([]);
    expect(periodBoundsOf(['2026-02'])).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('GSTR-1', () => {
  it('a clean file has no issues', () => {
    expect(validateGstr1(r1(), { gstin: OWN, retPeriod: '102026' })).toEqual([]);
  });
  it('catches the errors the portal rejects a file for', () => {
    const bad = r1({
      version: undefined,
      b2b: [
        { ctin: OWN, inv: [{ inum: 'INVOICE-NUMBER-TOO-LONG', idt: '31-11-2026', pos: '27', itms: [item(17, 100, false)] }] },
        { ctin: BUYER_KA, inv: [{ inum: 'A1', idt: '01-10-2026', pos: '29', itms: [item(18, 100, false)] }] },
        { ctin: '29AABCU9603R1ZZ', inv: [{ inum: 'A1', idt: '02-10-2026', pos: '29', itms: [item(18, 100, true)] }] },
      ],
    });
    const codes = errors(validateGstr1(bad, { gstin: OWN, retPeriod: '102026' }));
    expect(codes).toEqual(
      expect.arrayContaining([
        'VERSION_MISSING',
        'CTIN_SELF',
        'DOC_NO_INVALID',
        'DATE_INVALID',
        'RATE_INVALID',
        'HEAD_INTER',
        'CTIN_INVALID',
        'DOC_NO_DUPLICATE',
      ]),
    );
  });
  it('rejects a file for another business or period, and a date after the period', () => {
    const other = gstin('29AAPFU0939F1Z');
    expect(errors(validateGstr1(r1(), { gstin: other }))).toContain('GSTIN_OTHER');
    expect(errors(validateGstr1(r1(), { retPeriod: '092026' }))).toContain('PERIOD_OTHER');
    const late = r1({ b2b: [{ ctin: BUYER_MH, inv: [{ inum: 'X1', idt: '01-11-2026', pos: '27', itms: [item(18, 100, false)] }] }] });
    expect(errors(validateGstr1(late))).toContain('DATE_AFTER_PERIOD');
  });
  it('SEZ supplies are IGST even inside the state', () => {
    const sez = r1({ b2b: [{ ctin: BUYER_MH, inv: [{ inum: 'S1', idt: '01-10-2026', pos: '27', inv_typ: 'SEWP', itms: [item(18, 100, true)] }] }] });
    expect(errors(validateGstr1(sez))).toEqual([]);
  });
  it('warns about an empty HSN table and a nil period', () => {
    expect(warnings(validateGstr1(r1({ hsn: { data: [] } })))).toContain('HSN_EMPTY');
    expect(warnings(validateGstr1(r1({ b2b: [], b2cs: [], hsn: { data: [] } })))).toContain('NIL_RETURN');
  });
  it('liability subtracts credit notes and adds debit notes', () => {
    const withNotes = r1({
      cdnr: [{ ctin: BUYER_MH, nt: [
        { nt_num: 'CN1', nt_dt: '10-10-2026', ntty: 'C', pos: '27', itms: [item(18, 1000, false)] },
        { nt_num: 'DN1', nt_dt: '11-10-2026', ntty: 'D', pos: '27', itms: [item(18, 200, false)] },
      ] }],
    });
    expect(gstr1Liability(withNotes)).toEqual({ txval: 16200, iamt: 900, camt: 878, samt: 878, csamt: 0 });
  });
});

describe('GSTR-3B', () => {
  const r3 = (over = {}) => ({
    gstin: OWN,
    ret_period: '102026',
    version: 'GST3.0.4',
    hash: 'hash',
    sup_details: {
      osup_det: { txval: 17000, iamt: 900, camt: 950, samt: 950, csamt: 0 },
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
    },
    itc_elg: { itc_avl: [{ ty: 'OTH', iamt: 100, camt: 200, samt: 200, csamt: 0 }] },
    ...over,
  });
  it('agrees with the GSTR-1 of the period', () => {
    expect(validateGstr3b(r3(), { gstin: OWN, retPeriod: '102026' }, { gstr1: r1() })).toEqual([]);
  });
  it('flags a liability that differs from GSTR-1, by head', () => {
    const list = validateGstr3b(r3({ sup_details: { osup_det: { txval: 17000, iamt: 0, camt: 950, samt: 950, csamt: 0 } } }), {}, { gstr1: r1() });
    expect(list.filter((i) => i.code === 'R1_3B_MISMATCH').map((i) => i.path)).toEqual(['iamt']);
  });
  it('asks for the GSTR-1 when there is none, and caps ITC at 2B', () => {
    expect(warnings(validateGstr3b(r3()))).toContain('R1_NOT_SAVED');
    const list = validateGstr3b(r3(), {}, { gstr1: r1(), itc2b: { iamt: 100, camt: 150, samt: 200 } });
    expect(list.filter((i) => i.code === 'ITC_OVER_2B').map((i) => i.path)).toEqual(['camt']);
  });
  it('rejects negative and non-numeric amounts, but not a negative net ITC', () => {
    const list = validateGstr3b(r3({
      itc_elg: { itc_avl: [{ ty: 'OTH', iamt: -1, camt: 'x', samt: 0, csamt: 0 }], itc_net: { iamt: -5, camt: 0, samt: 0, csamt: 0 } },
    }), {}, { gstr1: r1() });
    expect(errors(list)).toEqual(['AMOUNT_NEGATIVE', 'AMOUNT_INVALID']);
  });
});

describe('IMS', () => {
  const rows = [
    { status: 'matched', ctin: BUYER_MH, supplier: 'A', invoiceNumber: 'P-1', twoBVal: 118, twoBTaxable: 100, twoBCgst: 9, twoBSgst: 9 },
    { status: 'amount_mismatch', ctin: BUYER_KA, supplier: 'B', invoiceNumber: 'P/2', twoBVal: 590, twoBIgst: 90, valDiff: 50 },
    { status: 'twob_only', ctin: BUYER_KA, supplier: 'B', invoiceNumber: 'P3', twoBVal: 100, twoBIgst: 18 },
    { status: 'book_only', ctin: BUYER_KA, invoiceNumber: 'P4' },
  ];
  it('accepts matches, keeps the rest pending, skips bills the supplier has not reported', () => {
    const list = imsActions(rows);
    expect(list.map((r) => r.action)).toEqual(['accept', 'pending', 'pending']);
    expect(list[0].tax).toBe(18);
  });
  it('the person can decide a row, and the pack totals follow', () => {
    const list = imsActions(rows, { [`${BUYER_KA}::P3`]: 'reject' });
    const pack = imsPack(OWN, '102026', list);
    expect(pack.totals).toEqual({ accept: 18, reject: 18, pending: 90, count: 3 });
    const issues = validateIms(pack, { gstin: OWN });
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)).toEqual(['IMS_PENDING']);
  });
});

describe('readiness and status', () => {
  it('ready only with no errors and every warning acknowledged', () => {
    const list = validateGstr1(r1({ hsn: { data: [] } }));
    expect(readiness(list).ready).toBe(false);
    expect(readiness(list, list.map((i) => i.id)).ready).toBe(true);
    expect(readiness([{ id: 'X', severity: 'error', code: 'X', message: '' }], ['X']).ready).toBe(false);
  });
  it('a reviewed pack needs approval before it is filed; an unreviewed one does not', () => {
    expect(nextStatus('ready', 'record_filed', { ready: true })).toBe('filed');
    expect(nextStatus('ready', 'record_filed', { ready: true, reviewed: true })).toHaveProperty('error');
    expect(nextStatus('draft', 'submit_review', { ready: false })).toHaveProperty('error');
    expect(nextStatus('ready', 'submit_review', { ready: true })).toBe('in_review');
    expect(nextStatus('in_review', 'request_changes', { ready: true })).toBe('changes_requested');
    expect(nextStatus('changes_requested', 'submit_review', { ready: true })).toBe('in_review');
    expect(nextStatus('in_review', 'approve', { ready: true })).toBe('approved');
    expect(nextStatus('approved', 'record_filed', { ready: true, reviewed: true })).toBe('filed');
    expect(nextStatus('filed', 'reopen', { ready: true, approved: true })).toBe('approved');
    expect(nextStatus('approved', 'reopen', { ready: true })).toHaveProperty('error');
  });
  it('ARN checks and a stable hash input', () => {
    expect(arnProblem('AA271026123456Z', OWN)).toBeNull();
    expect(arnProblem('AA291026123456Z', OWN)).toMatch(/state 29/);
    expect(arnProblem('BB271026123456Z', OWN)).toMatch(/AA/);
    expect(arnProblem('AA27', OWN)).toMatch(/15/);
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined, e: null }] })).toBe('{"a":[{"d":2,"e":null}],"b":1}');
  });
});
