// X1 (docs/FEATURE_GAPS_2026-11.md): the GST return builders moved from the web screen to the engine. These files are
// what the screen downloaded BEFORE the move (apps/web/scripts/gst-golden-capture.mjs, a real browser on real workspace
// documents); the engine must build them byte for byte from the same documents.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGstReturnFiles, gstReturnsModel, periodOfReturn, returnPeriodOf } from '../src/index.ts';

const read = (n) => JSON.parse(readFileSync(new URL(`./golden/gst-returns/${n}.json`, import.meta.url), 'utf8'));
const input = read('input');
const docs = { ...input, purchases: input.purchases, otherIncome: input.otherIncome };

describe('server-side GST returns = what the screen downloaded', () => {
  const files = buildGstReturnFiles(docs, input.period);
  it('GSTR-1 JSON is identical', () => {
    expect(files.gstr1.blocked).toEqual([]);
    expect(files.gstr1.json).toEqual(read('gstr1'));
    expect(JSON.stringify(files.gstr1.json)).toBe(JSON.stringify(read('gstr1')));
  });
  it('GSTR-3B JSON is identical', () => {
    expect(JSON.stringify(files.gstr3b)).toBe(JSON.stringify(read('gstr3b')));
  });
  it('the fixture covers the cases that matter', () => {
    const g = read('gstr1');
    expect(g.b2b.length).toBe(2);
    expect(g.b2cl.length).toBe(1);
    expect(g.cdnr.length).toBe(1);
    expect(g.exp).toBeTruthy();
    expect(g.nil.inv.length).toBeGreaterThan(0);
    const inv = g.doc_issue.doc_det[0].docs.find((d) => d.from === 'INV/2026/001');
    expect(inv).toMatchObject({ totnum: 6, cancel: 1, net_issue: 5 });
  });
});

describe('periods and edge cases', () => {
  it('maps periods both ways', () => {
    expect(returnPeriodOf({ mode: 'month', year: 2026, month: 9 })).toBe('102026');
    expect(returnPeriodOf({ mode: 'quarter', year: 2026, quarter: 'Q3' })).toBe('122026');
    expect(periodOfReturn('102026')).toEqual({ mode: 'month', year: 2026, month: 9 });
    expect(periodOfReturn('122026', true)).toEqual({ mode: 'quarter', year: 2026, quarter: 'Q3' });
  });
  it('a month with nothing in it builds no file', () => {
    const f = buildGstReturnFiles(docs, { mode: 'month', year: 2026, month: 3 });
    expect(f.gstr1.empty).toBe(true);
    expect(f.gstr3b).toBeNull();
  });
  it('another GSTIN’s documents are left out', () => {
    const m = gstReturnsModel({ ...docs, profile: { ...docs.profile, gstin: '29AAPFU0939F1ZV' } }, input.period);
    expect(m.filteredBills).toEqual([]);
  });
  it('a bad invoice number blocks the file, as on the screen', () => {
    const bad = structuredClone(docs);
    bad.bills.find((b) => b.invoiceNumber === 'INV/2026/001').invoiceNumber = 'THIS-NUMBER-IS-TOO-LONG';
    const f = buildGstReturnFiles(bad, input.period);
    expect(f.gstr1.json).toBeNull();
    expect(f.gstr1.blocked[0]).toMatch(/invoice number/);
  });
});
