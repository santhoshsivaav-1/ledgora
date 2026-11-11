// Vyapar parity Phase 7 (web): label drawing and layout for the barcode generator.
import { describe, expect, it } from 'vitest';
import { LABEL_SHEETS, ean13 } from '@ledgora/tax-engine';
import { labelSvg, labelsHtml, qrRuns } from '../src/features/utilities/labels';

const sheet = (id) => LABEL_SHEETS.find((s) => s.id === id);
const item = { id: 'a', name: 'Lux Soap <Big>', code: '4006381333931', price: 118.5, mrp: 130, stock: 3 };

describe('labelSvg', () => {
  it('draws the bars of the code, the name (escaped), the code and the price', () => {
    const svg = labelSvg(item, { sheet: sheet('a4-65'), type: 'ean13' });
    expect(svg).toContain('width="38.1mm"');
    expect(svg).toContain('Lux Soap &lt;Big&gt;');
    expect(svg).toContain('4006381333931');
    expect(svg).toContain('₹118.5');
    // EAN-13 draws 30 bars: 3 guard bars at each end and the middle, plus the digit bars
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(20);
  });
  it('the toggles take things off', () => {
    const svg = labelSvg(item, { sheet: sheet('a4-65'), type: 'ean13', show: { name: false, price: false, mrp: false, code: false, business: false } });
    expect(svg).not.toContain('Lux Soap');
    expect(svg).not.toContain('₹');
    expect(svg).toContain('<rect ');
  });
  it('shows the business name and MRP when asked; no code says so instead of drawing', () => {
    const svg = labelSvg(item, { sheet: sheet('a4-24'), type: 'code128', show: { name: true, price: true, mrp: true, code: true, business: true }, businessName: 'Corner Store' });
    expect(svg).toContain('Corner Store');
    expect(svg).toContain('MRP ₹130');
    expect(labelSvg({ ...item, code: '' }, { sheet: sheet('a4-24'), type: 'code128' })).toContain('No code');
  });
  it('bars stay inside the label', () => {
    const s = sheet('a4-65');
    const svg = labelSvg(item, { sheet: s, type: 'ean13' });
    for (const m of svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)) expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(s.labelW);
  });
});

describe('labelsHtml', () => {
  it('places each label at its slot, skips used positions and pages', () => {
    const r = labelsHtml([item, { ...item, id: 'b', name: 'Pen', code: ean13('590123412345') }], { sheet: sheet('a4-65'), type: 'ean13', copies: 40, startAt: 60 });
    expect(r.labels).toBe(80);
    expect(r.pages).toBe(3); // 59 skipped + 80 = 139 slots over 65-up sheets
    expect(r.html).toContain('@page{size:A4;margin:0}');
    expect(r.html).toContain('left:4.65mm;top:10.7mm'); // slot 0 on page 2
    expect(r.html).toContain('page-break-after:always');
    // 6 labels fit after skipping 59 positions on page 1, then a full sheet of 65, then 9
    const counts = r.html.split('<section class="page">').slice(1).map((p) => (p.match(/class="lbl"/g) ?? []).length);
    expect(counts).toEqual([6, 65, 9]);
  });
  it('a roll prints one label per page at the label size', () => {
    const r = labelsHtml([item], { sheet: sheet('roll-50x25'), type: 'code128', copies: 3 });
    expect(r.pages).toBe(3);
    expect(r.html).toContain('@page{size:50mm 25mm;margin:0}');
  });
});

describe('QR labels', () => {
  it('draws a QR code inside the label with the finder squares in three corners', () => {
    const { size, runs } = qrRuns('2000000000015');
    expect(size).toBe(21); // version 1
    // each finder pattern starts with a 7-module dark row at its corner
    expect(runs.some((r) => r.x === 0 && r.y === 0 && r.w === 7)).toBe(true);
    expect(runs.some((r) => r.x === size - 7 && r.y === 0 && r.w === 7)).toBe(true);
    expect(runs.some((r) => r.x === 0 && r.y === size - 7 && r.w === 7)).toBe(true);
    const s = sheet('a4-24');
    const svg = labelSvg(item, { sheet: s, type: 'qr' });
    expect(svg).toContain('<rect ');
    for (const m of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      expect(Number(m[1]) + Number(m[3])).toBeLessThanOrEqual(s.labelW + 0.001);
      expect(Number(m[2]) + Number(m[4])).toBeLessThanOrEqual(s.labelH + 0.001);
    }
    expect(svg).toContain('4006381333931');
  });
  it('different codes make different pictures', () => {
    expect(JSON.stringify(qrRuns('A1'))).not.toBe(JSON.stringify(qrRuns('A2')));
  });
});
