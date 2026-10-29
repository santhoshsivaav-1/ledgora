// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

import type { Numeric } from './types.ts';
// Compute the per-item tax breakdown.
// `taxInclusive=true` means rate already includes tax (MRP-style) — back-calculate the
// taxable value. This matches the bill form's "Prices include tax" toggle.
//
// Inputs are defensively coerced: `Number(...)` turns strings (from CSV import) into
// numbers; `isFinite` filters out NaN/Infinity; `Math.max(0, ...)` clamps negatives.
// The form clamps these at input time via `clampNonNeg`, but anyone calling the
// helper directly (e.g. CSV import, recurring template materialisation) gets the
// same safety net here.
export const finiteNonNeg = (n: Numeric) => {
  const x = Number(n);
  return isFinite(x) && x > 0 ? x : 0;
};

// Sum of an array of numbers, coercing safely.
export const sum = (arr: Numeric[]) => arr.reduce((s: number, n) => s + (Number(n) || 0), 0);

export const r2 = (n: Numeric) => Math.round((Number(n) || 0) * 100) / 100;

// v1.10.6 — audit L3: getTDSSection / getTCSSection had no importers.
// Components filter TDS_SECTIONS / TCS_SECTIONS directly.

// ========== Round-off helper ==========
// Returns the delta needed to round the total to the nearest whole unit.
// e.g. 1234.67 → -0.67 (subtract); 1234.40 → +0.60 (add).
export const calculateRoundOff = (total: Numeric) => {
  if (typeof total !== 'number' || isNaN(total)) return 0;
  const rounded = Math.round(total);
  return Math.round((rounded - total) * 100) / 100;
};

// v1.10.79 (#96) - a quantity that was added up (6356.96 kg over many
// invoices) comes out of floating point as 6356.959999999999. Round it once,
// where it is shown or exported: 3 decimals on screen (grams, millilitres),
// 2 for the GST portal (its quantity field takes 2).
export const roundQty = (n: Numeric, places = 3) => {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
};
