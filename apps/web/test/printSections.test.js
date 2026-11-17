import { describe, expect, it } from 'vitest';
import { makeLineCalc, buildHsnRows } from '../src/features/print/invoiceLines';
import { getActiveBusinessPresetId, isRecommendedForActive, isVisibleFor } from '../src/features/print/businessGate';
import { DESIGN_PRESETS } from '../src/features/print/designPresets';

// v-split: pure logic pulled out of InvoicePreview.jsx / PrintSettings.jsx,
// unit-tested without rendering (node environment, no DOM).

describe('makeLineCalc', () => {
  const totals = { taxInclusive: false };
  const calc = makeLineCalc(totals, true);

  it('computes taxable value and tax from qty × rate minus discount', () => {
    const l = calc({ quantity: 2, rate: 500, discount: 100, taxPercent: 18 });
    expect(l.discount).toBe(100);
    expect(l.taxable).toBe(900);       // 2 × 500 − 100
    expect(l.tax).toBe(162);           // 18% of 900
    expect(l.rate).toBe(18);
  });

  it('divides the gross by (1 + rate) for tax-inclusive totals', () => {
    const inclusive = makeLineCalc({ taxInclusive: true }, true);
    const l = inclusive({ quantity: 1, rate: 1180, discount: 0, taxPercent: 18 });
    expect(l.taxable).toBeCloseTo(1000, 6);
    expect(l.tax).toBeCloseTo(180, 6);
  });

  it('zeroes the tax when GST display is off, and keeps the gross taxable', () => {
    const noGst = makeLineCalc(totals, false);
    const l = noGst({ quantity: 2, rate: 100, discount: 0, taxPercent: 18 });
    expect(l.tax).toBe(0);
    expect(l.taxable).toBe(200);
  });

  it('treats missing numbers as zero rather than NaN', () => {
    const l = calc({ quantity: undefined, rate: null, taxPercent: 'x' });
    expect(l.discount).toBe(0);
    expect(l.taxable).toBe(0);
    expect(l.rate).toBe(0);
  });
});

describe('buildHsnRows', () => {
  it('groups lines by HSN + rate and sums taxable/tax', () => {
    const lineCalc = (item) => ({ discount: 0, taxable: item.taxable, tax: item.tax, rate: item.taxPercent });
    const rows = buildHsnRows(
      [
        { hsn: '1234', taxPercent: 18, taxable: 100, tax: 18 },
        { hsn: '1234', taxPercent: 18, taxable: 50, tax: 9 },
        { hsn: '5678', taxPercent: 5, taxable: 200, tax: 10 },
      ],
      {},
      lineCalc,
    );
    expect(rows).toHaveLength(2);
    const hsn1234 = rows.find((r) => r.hsn === '1234');
    expect(hsn1234.taxable).toBe(150);
    expect(hsn1234.tax).toBe(27);
  });

  it('skips untaxed lines without an HSN/SAC code, like Tally does', () => {
    const lineCalc = () => ({ discount: 0, taxable: 10, tax: 0, rate: 0 });
    const rows = buildHsnRows(
      [{ hsn: '', taxPercent: 0, taxable: 10, tax: 0 }, { hsn: '99', taxPercent: 0, taxable: 10, tax: 0 }],
      {},
      lineCalc,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].hsn).toBe('99');
  });

  it('merges additional charges into the summary at their own rate and SAC', () => {
    const lineCalc = () => ({ discount: 0, taxable: 100, tax: 18, rate: 18 });
    const rows = buildHsnRows(
      [{ hsn: '1234', taxPercent: 18, taxable: 100, tax: 18 }],
      { charges: [{ hsn: '1234', taxPct: 18, taxable: 40, tax: 7.2 }] },
      lineCalc,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].taxable).toBeCloseTo(140, 6);
    expect(rows[0].tax).toBeCloseTo(25.2, 6);
  });
});

describe('business-type gates', () => {
  it('returns "" when no business preset is picked', () => {
    expect(getActiveBusinessPresetId({})).toBe('');
    expect(getActiveBusinessPresetId({ activeBusinessPresetId: 'retail_shop' })).toBe('retail_shop');
  });

  it('never recommends anything without an active preset', () => {
    expect(isRecommendedForActive('', ['retail_shop'])).toBe(false);
    expect(isRecommendedForActive('retail_shop', ['retail_shop'])).toBe(true);
    expect(isRecommendedForActive('retail_shop', ['wholesale'])).toBe(false);
  });

  it('shows every option without a preset, and only listed ones with one', () => {
    expect(isVisibleFor('', ['wholesale'])).toBe(true);
    expect(isVisibleFor('freelancer', ['wholesale'])).toBe(false);
    expect(isVisibleFor('wholesale', ['wholesale', 'manufacturer'])).toBe(true);
  });
});

describe('design presets', () => {
  it('keeps ids unique and every preset seeds a template + palette', () => {
    const ids = DESIGN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of DESIGN_PRESETS) {
      expect(preset.settings.pdfTemplate).toBeTruthy();
      expect(preset.settings.userColorsEnabled).toBe(true);
      expect(preset.settings.pdfAccent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
