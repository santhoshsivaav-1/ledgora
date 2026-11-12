// Vyapar parity P10-S5 (receivable half): TDS customers deducted from what they paid us, compared with Form 26AS.
import { describe, expect, it } from 'vitest';
import { compare26AS, deductorKey, parse26AS } from '../src/index.ts';

const TRACES = [
  'Form 26AS',
  'PART A - Details of Tax Deducted at Source',
  'Sr. No.^Name of Deductor^TAN of Deductor^^^^^Total Amount Paid / Credited^Total Tax Deducted^Total TDS Deposited',
  '1^ACME INDIA PRIVATE LIMITED^CHEA12345B^^^^^500000.00^10000.00^10000.00',
  '^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited^Tax Deducted^TDS Deposited',
  '^1^194C^15-Apr-2026^F^20-Jul-2026^-^500000.00^10000.00^10000.00',
  '2^Bala Traders^MUMB99999C^^^^^100000.00^2000.00^2000.00',
  '',
  'PART B - Details of Tax Collected at Source',
].join('\n');

describe('parse26AS', () => {
  it('reads the deductor summary of a TRACES text download (caret separated)', () => {
    expect(parse26AS(TRACES)).toEqual([
      { deductor: 'ACME INDIA PRIVATE LIMITED', tan: 'CHEA12345B', amount: 500000, tds: 10000 },
      { deductor: 'Bala Traders', tan: 'MUMB99999C', amount: 100000, tds: 2000 },
    ]);
  });
  it('reads a CSV with the same columns, quoted names with commas', () => {
    const csv = 'Name of Deductor,TAN of Deductor,Total Amount Paid / Credited,Total Tax Deducted\n"Om Services, Chennai",CHEO11111A,"1,00,000.00",1000\n';
    expect(parse26AS(csv)).toEqual([{ deductor: 'Om Services, Chennai', tan: 'CHEO11111A', amount: 100000, tds: 1000 }]);
  });
  it('returns nothing for a file without the columns', () => {
    expect(parse26AS('hello,world\n1,2')).toEqual([]);
  });
});

describe('deductorKey', () => {
  it('matches the usual spellings of one company', () => {
    expect(deductorKey('ACME INDIA PRIVATE LIMITED')).toBe(deductorKey('Acme India Pvt. Ltd.'));
    expect(deductorKey('M/s Bala Traders')).toBe(deductorKey('bala  traders'));
  });
});

describe('compare26AS', () => {
  const book = [
    { deductor: 'Acme India Pvt Ltd', tds: 10000 },
    { deductor: 'Bala Traders', tds: 1500 },
    { deductor: 'Om Services', tds: 700 },
  ];
  it('matched, mismatched (by more than ₹1), missing either side', () => {
    const r = compare26AS(book, parse26AS(TRACES));
    expect(r.rows).toEqual([
      { deductor: 'Acme India Pvt Ltd', tan: 'CHEA12345B', book: 10000, statement: 10000, diff: 0, status: 'matched' },
      { deductor: 'Bala Traders', tan: 'MUMB99999C', book: 1500, statement: 2000, diff: 500, status: 'mismatch' },
      { deductor: 'Om Services', tan: '', book: 700, statement: 0, diff: -700, status: 'missing_in_26as' },
    ]);
    expect(r.totals).toEqual({ book: 12200, statement: 12000, diff: -200 });
  });
  it('lists a 26AS deductor we have no record of', () => {
    const r = compare26AS([], [{ deductor: 'New Co', tan: 'X', amount: 1, tds: 50 }]);
    expect(r.rows).toEqual([{ deductor: 'New Co', tan: 'X', book: 0, statement: 50, diff: 50, status: 'missing_in_books' }]);
  });
  it('a paisa of rounding is a match', () => {
    expect(compare26AS([{ deductor: 'A', tds: 100.4 }], [{ deductor: 'A', tan: '', amount: 0, tds: 100 }]).rows[0].status).toBe('matched');
  });
});
