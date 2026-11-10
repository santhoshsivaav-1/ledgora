// Vyapar parity P2-S3 regression gate: computeInvoiceTotals must give byte-identical output for the 20 fixtures
// captured before additional charges were added, with no charges or with an empty charges list.
// Re-capture only on purpose: CAPTURE_TOTALS_GOLDEN=1 pnpm --filter @ledgora/web test totalsGolden
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { computeInvoiceTotals } from '../src/utils.js';
import { TOTALS_FIXTURES } from './fixtures/totalsFixtures.js';

const GOLDEN = new URL('./fixtures/totals.golden.json', import.meta.url);
const outputs = () => TOTALS_FIXTURES.map((f) => JSON.stringify(computeInvoiceTotals(f.input)));

if (process.env.CAPTURE_TOTALS_GOLDEN === '1') {
  const golden = Object.fromEntries(TOTALS_FIXTURES.map((f, i) => [f.name, outputs()[i]]));
  writeFileSync(GOLDEN, `${JSON.stringify(golden, null, 2)}\n`);
}

describe('computeInvoiceTotals golden outputs (P2-S3)', () => {
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

  it('has all 20 fixtures', () => {
    expect(TOTALS_FIXTURES).toHaveLength(20);
    expect(Object.keys(golden)).toEqual(TOTALS_FIXTURES.map((f) => f.name));
  });

  for (const f of TOTALS_FIXTURES) {
    it(`unchanged without charges: ${f.name}`, () => {
      expect(JSON.stringify(computeInvoiceTotals(f.input))).toBe(golden[f.name]);
    });
    it(`unchanged with charges: []: ${f.name}`, () => {
      const input = { ...f.input, charges: [] };
      const withEmpty = JSON.parse(JSON.stringify(computeInvoiceTotals(input)));
      expect(JSON.stringify(withEmpty)).toBe(golden[f.name]);
    });
  }
});
