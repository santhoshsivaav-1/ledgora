// Vyapar parity P7-S1: EAN-13 vectors, Code 128 structure, and the label sheet maths.
import { describe, expect, it } from 'vitest';
import {
  CODE128_PATTERNS, LABEL_SHEETS, barcodeFor, barsOf, code128Modules, code128Values, ean13, ean13CheckDigit, ean13Modules,
  internalEan13, internalSeqOf, isValidEan13, layoutLabels, nextInternalCodes, sheetById, sheetProblem, slotPosition,
} from '../src/index.ts';

describe('EAN-13', () => {
  // Published example codes (GS1 / Wikipedia / retail packs).
  it.each([
    ['400638133393', 1], ['590123412345', 7], ['978020137962', 4], ['501234567890', 0], ['629104150021', 3],
  ])('check digit of %s is %i', (first12, d) => {
    expect(ean13CheckDigit(first12)).toBe(d);
    expect(ean13(first12)).toBe(first12 + d);
  });
  it('refuses a wrong check digit and bad lengths', () => {
    expect(() => ean13('4006381333930')).toThrow(/check digit/);
    expect(() => ean13('12345')).toThrow();
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });
  it('draws 95 modules with the guard bars', () => {
    const m = ean13Modules('4006381333931');
    expect(m).toHaveLength(95);
    expect(m.startsWith('101')).toBe(true);
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.endsWith('101')).toBe(true);
  });
  it('in-store codes: 200 prefix, sequential, valid, and read back', () => {
    expect(internalEan13(1)).toBe('2000000000015'.slice(0, 12) + ean13CheckDigit('200000000001'));
    const codes = nextInternalCodes(41, 3);
    expect(codes.map((c) => c.seq)).toEqual([42, 43, 44]);
    expect(new Set(codes.map((c) => c.code)).size).toBe(3);
    codes.forEach((c) => { expect(isValidEan13(c.code)).toBe(true); expect(internalSeqOf(c.code)).toBe(c.seq); });
    expect(internalSeqOf('4006381333931')).toBeNull();
    expect(() => internalEan13(1, '300')).toThrow();
  });
});

describe('Code 128', () => {
  it('every pattern is 11 modules wide (the stop 13), alternating bar and space', () => {
    expect(CODE128_PATTERNS).toHaveLength(106);
    CODE128_PATTERNS.forEach((p, i) => expect([...p].reduce((s, d) => s + Number(d), 0), `symbol ${i}`).toBe(11));
    expect(new Set(CODE128_PATTERNS).size).toBe(106);
  });
  it('checksum: start B + Σ value × position, mod 103', () => {
    // "A": 104 + 33×1 = 137 → 34;  "PJJ123": known 128B example checksum
    expect(code128Values('A').checksum).toBe(34);
    const { values } = code128Values('PJJ123C');
    expect(values[0]).toBe(104);
    expect(values.at(-1)).toBe((104 + [...'PJJ123C'].reduce((s, c, i) => s + (c.charCodeAt(0) - 32) * (i + 1), 0)) % 103);
  });
  it('module count is 11 per symbol plus the 13-module stop; starts and ends on a bar', () => {
    const m = code128Modules('LUX1');
    expect(m).toHaveLength((1 + 4 + 1) * 11 + 13);
    expect(m[0]).toBe('1');
    expect(m.at(-1)).toBe('1');
    expect(barsOf(m).every((b) => b.w >= 1 && b.w <= 4)).toBe(true);
  });
  it('refuses characters it can not encode', () => {
    expect(() => code128Modules('₹10')).toThrow();
    expect(barcodeFor('12345', 'ean13').type).toBe('code128');
    expect(barcodeFor('4006381333931', 'ean13').type).toBe('ean13');
  });
});

describe('label sheets', () => {
  it('every preset sheet fits on its page', () => LABEL_SHEETS.forEach((s) => expect(sheetProblem(s), s.id).toBe('')));
  it('A4 65-up: 5 × 13, first and last label positions, aligned to the pitch within 0.5 mm', () => {
    const s = sheetById('a4-65');
    expect(s.cols * s.rows).toBe(65);
    expect(slotPosition(s, 0)).toEqual({ x: 4.65, y: 10.7 });
    const last = slotPosition(s, 64);
    expect(last.x).toBeCloseTo(4.65 + 4 * 40.6, 6);
    expect(last.y).toBeCloseTo(10.7 + 12 * 21.2, 6);
    expect(last.x + s.labelW).toBeLessThanOrEqual(210);
    expect(last.y + s.labelH).toBeLessThanOrEqual(297);
    // pitch error vs the Avery spec (40.6 × 21.2)
    expect(Math.abs(slotPosition(s, 1).x - slotPosition(s, 0).x - 40.6)).toBeLessThan(0.5);
  });
  it('a custom sheet that runs off the page is refused', () => {
    expect(sheetProblem({ ...sheetById('a4-65'), cols: 6 })).toMatch(/right edge/);
    expect(sheetProblem({ ...sheetById('a4-65'), rows: 14 })).toMatch(/bottom edge/);
    expect(sheetProblem({ ...sheetById('a4-65'), gapX: -1 })).toMatch(/negative/);
  });
  const items = [{ id: 'a', name: 'Pen', code: 'P01', stock: 3 }, { id: 'b', name: 'Pencil', code: 'P02', stock: 0 }];
  it('copies, = stock, the 1000 cap', () => {
    expect(layoutLabels(items, { sheet: sheetById('a4-65'), copies: 2 }).labels).toBe(4);
    expect(layoutLabels(items, { sheet: sheetById('a4-65'), copies: 'stock' }).labels).toBe(3 + 1);
    expect(layoutLabels(items, { sheet: sheetById('a4-65'), copies: 5000 }).labels).toBe(2000);
  });
  it('start-at skips used positions and paginates', () => {
    const r = layoutLabels(items, { sheet: sheetById('a4-24'), copies: 30, startAt: 20 });
    expect(r.skipped).toBe(19);
    expect(r.pages[0][0].slot).toBe(19);
    expect(r.pages[0]).toHaveLength(5);
    expect(r.pages[1][0].slot).toBe(0);
    expect(r.pages.flat()).toHaveLength(60);
  });
  it('a roll is one label per page and ignores start-at', () => {
    const r = layoutLabels(items, { sheet: sheetById('roll-50x25'), copies: 2, startAt: 9 });
    expect(r.skipped).toBe(0);
    expect(r.pages).toHaveLength(4);
  });
});
