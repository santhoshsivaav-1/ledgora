// Settings that turned live after Phase 8: amount in words in Hindi and Tamil, GST due dates by frequency and
// registration, the book year start month, and stock for lines sold in a secondary unit.
import { describe, expect, it } from 'vitest';
import {
  amountInWordsLang, bookYearBounds, compositionTax, sectionsWith, TDS_SECTIONS, remapPostings, DEFAULT_ACCOUNT_ROLES, ACC, bookYearStart, gstDueSummary, gstDuesForPeriod, numberToWords, qrmp3bDay, stockEffect,
} from '../src/index.ts';

describe('amount in words by language', () => {
  it('English is unchanged', () => {
    expect(amountInWordsLang(1234.5, 'en')).toBe(numberToWords(1234.5));
    expect(amountInWordsLang(10, 'xx')).toBe(numberToWords(10));
  });
  it('Hindi', () => {
    expect(amountInWordsLang(0, 'hi')).toBe('शून्य रुपये मात्र');
    expect(amountInWordsLang(99, 'hi')).toBe('निन्यानवे रुपये मात्र');
    expect(amountInWordsLang(1500, 'hi')).toBe('एक हज़ार पाँच सौ रुपये मात्र');
    expect(amountInWordsLang(12345678, 'hi')).toBe('एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर रुपये मात्र');
    expect(amountInWordsLang(10.25, 'hi')).toBe('दस रुपये और पच्चीस पैसे मात्र');
    expect(amountInWordsLang(1500000000, 'hi')).toBe('एक सौ पचास करोड़ रुपये मात्र');
  });
  it('Hindi table has one word per number to 99', () => {
    for (let n = 1; n < 100; n++) expect(amountInWordsLang(n, 'hi')).not.toMatch(/undefined/);
  });
  it('Tamil', () => {
    expect(amountInWordsLang(21, 'ta')).toBe('இருபத்து ஒன்று ரூபாய் மட்டும்');
    expect(amountInWordsLang(100, 'ta')).toBe('நூறு ரூபாய் மட்டும்');
    expect(amountInWordsLang(105, 'ta')).toBe('நூற்று ஐந்து ரூபாய் மட்டும்');
    expect(amountInWordsLang(1500, 'ta')).toBe('ஆயிரத்து ஐந்நூறு ரூபாய் மட்டும்');
    expect(amountInWordsLang(2000, 'ta')).toBe('இரண்டு ஆயிரம் ரூபாய் மட்டும்');
    expect(amountInWordsLang(100000, 'ta')).toBe('ஒரு இலட்சம் ரூபாய் மட்டும்');
    expect(amountInWordsLang(10000000, 'ta')).toBe('ஒரு கோடி ரூபாய் மட்டும்');
    expect(amountInWordsLang(12.5, 'ta')).toBe('பன்னிரண்டு ரூபாய் ஐம்பது பைசா மட்டும்');
    for (let n = 1; n < 1000; n++) expect(amountInWordsLang(n, 'ta')).not.toMatch(/undefined|\s{2}/);
  });
});

describe('GST due dates', () => {
  it('monthly filer: R1 on the 11th, 3B on the 20th', () => {
    expect(gstDuesForPeriod('2026-10').map((d) => [d.form, d.due])).toEqual([
      ['GSTR-1', '2026-11-11'],
      ['GSTR-3B', '2026-11-20'],
    ]);
    expect(gstDuesForPeriod('2026-12').map((d) => d.due)).toEqual(['2027-01-11', '2027-01-20']);
  });
  it('QRMP: IFF and PMT-06 in the first two months, quarterly R1 and 3B by state', () => {
    expect(gstDuesForPeriod('2026-04', { frequency: 'qrmp' }).map((d) => [d.form, d.due, !!d.optional])).toEqual([
      ['IFF', '2026-05-13', true],
      ['PMT-06', '2026-05-25', false],
    ]);
    expect(gstDuesForPeriod('2026-06', { frequency: 'qrmp', stateCode: '33' }).map((d) => [d.form, d.due])).toEqual([
      ['GSTR-1', '2026-07-13'],
      ['GSTR-3B', '2026-07-22'],
    ]);
    expect(gstDuesForPeriod('2026-06', { frequency: 'qrmp', stateCode: '07' })[1].due).toBe('2026-07-24');
    expect(qrmp3bDay('9')).toBe(24);
    expect(qrmp3bDay(null)).toBe(24);
  });
  it('composition: CMP-08 after each quarter, GSTR-4 after the year; unregistered: nothing', () => {
    expect(gstDuesForPeriod('2026-05', { regType: 'composition' })).toEqual([]);
    expect(gstDuesForPeriod('2026-09', { regType: 'composition' }).map((d) => [d.form, d.due])).toEqual([['CMP-08', '2026-10-18']]);
    expect(gstDuesForPeriod('2027-03', { regType: 'composition' }).map((d) => [d.form, d.due])).toEqual([
      ['CMP-08', '2027-04-18'],
      ['GSTR-4', '2027-04-30'],
    ]);
    expect(gstDuesForPeriod('2026-09', { regType: 'unregistered' })).toEqual([]);
    expect(gstDueSummary()).toMatch(/11th/);
    expect(gstDueSummary({ frequency: 'qrmp', stateCode: '33' })).toMatch(/22nd/);
  });
});

describe('book year start', () => {
  it('April is the Indian FY', () => {
    expect(bookYearStart(new Date(2027, 0, 15), 4)).toBe(2026);
    expect(bookYearStart(new Date(2027, 3, 1), 4)).toBe(2027);
    expect(bookYearBounds(2026, 4)).toEqual({ from: '2026-04-01', to: '2027-03-31', label: '2026-27' });
  });
  it('January is the calendar year; other months run into the next year', () => {
    expect(bookYearStart(new Date(2027, 0, 15), 1)).toBe(2027);
    expect(bookYearBounds(2027, 1)).toEqual({ from: '2027-01-01', to: '2027-12-31', label: '2027' });
    expect(bookYearBounds(2026, 7)).toEqual({ from: '2026-07-01', to: '2027-06-30', label: '2026-27' });
    expect(bookYearBounds(2027, 3).to).toBe('2028-02-29'); // leap year
  });
});

describe('stock for a secondary unit', () => {
  it('a line in the secondary unit moves stock by its unit factor', () => {
    const items = [
      { productId: 'a', quantity: 24, unitFactor: 1 / 12 }, // 24 PCS of a BOX = 12 PCS item
      { productId: 'a', quantity: 1 },
      { productId: 'b', quantity: 3 },
    ];
    expect(stockEffect(items, 'tax-invoice', 'unpaid')).toEqual({ a: -3, b: -3 });
  });
});

describe('composition tax', () => {
  it('rate on turnover, split between central and state', () => {
    expect(compositionTax(250000, 1)).toEqual({ total: 2500, central: 1250, state: 1250 });
    expect(compositionTax(1001, 1)).toEqual({ total: 10.01, central: 5.01, state: 5 });
    expect(compositionTax(-5, 1).total).toBe(0);
  });
});

describe('TDS / TCS rate masters', () => {
  it('current statutory rates for commission and e-commerce', () => {
    expect(TDS_SECTIONS.find((s) => s.code === '194H').rate).toBe(2);
    expect(TDS_SECTIONS.find((s) => s.code === '194O').rate).toBe(0.1);
  });
  it('an override changes a rate, an unknown code is added before Custom, nonsense is ignored', () => {
    const list = sectionsWith(TDS_SECTIONS, [{ code: '194j', rate: 2 }, { code: '194T', rate: 10 }, { code: 'x', rate: 400 }, { code: '', rate: 1 }]);
    expect(list.find((s) => s.code === '194J')).toMatchObject({ rate: 2 });
    expect(list.find((s) => s.code === '194J').label).toMatch(/your rate 2%/);
    const i = list.findIndex((s) => s.code === '194T');
    expect(list[i + 1].code).toBe('custom');
    expect(list.some((s) => s.code === 'x')).toBe(false);
    expect(TDS_SECTIONS.find((s) => s.code === '194J').rate).toBe(10); // the built-in list is untouched
    expect(sectionsWith(TDS_SECTIONS, null)).toHaveLength(TDS_SECTIONS.length);
  });
});

describe('default accounts', () => {
  const p = [{ date: '2026-11-01', refType: 'invoice', refId: '1', lines: [
    { account: ACC.RECEIVABLE, debit: 118 }, { account: ACC.SALES, credit: 100 }, { account: ACC.OUT_CGST, credit: 9 }, { account: ACC.OUT_SGST, credit: 9 },
  ] }];
  it('moves only the chosen built-in accounts, keeping the voucher balanced', () => {
    const out = remapPostings(p, { sales: '4005' });
    expect(out[0].lines.map((l) => l.account)).toEqual([ACC.RECEIVABLE, '4005', ACC.OUT_CGST, ACC.OUT_SGST]);
    const dr = out[0].lines.reduce((n, l) => n + (l.debit || 0), 0);
    const cr = out[0].lines.reduce((n, l) => n + (l.credit || 0), 0);
    expect(dr).toBe(cr);
    expect(remapPostings(p, {})).toBe(p);
    expect(remapPostings(p, { sales: ACC.SALES })).toBe(p);
  });
  it('covers only income and expense postings', () => {
    for (const r of DEFAULT_ACCOUNT_ROLES) expect(['income', 'expense']).toContain(r.kind);
  });
});
