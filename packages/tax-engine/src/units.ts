// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

// ========== Units of Measurement ==========
// label = display, uqc = GST portal Unit Quantity Code (used in GSTR-1 HSN summary)
// Each unit is tagged with the kind of supply it usually measures so the
// service-mode invoice can prioritise time-based units in the dropdown and
// pick a sensible default ("Hrs" instead of "Nos") for new line items.
// `kind: 'goods' | 'services' | 'both'`. `'both'` shows in either mode.
export const BUILTIN_UNITS = [
  { label: 'Pcs', uqc: 'PCS', kind: 'goods' },
  { label: 'Nos', uqc: 'NOS', kind: 'both' },
  { label: 'Kg', uqc: 'KGS', kind: 'goods' },
  { label: 'g', uqc: 'GMS', kind: 'goods' },
  { label: 'Tonne', uqc: 'TON', kind: 'goods' },
  { label: 'Ltr', uqc: 'LTR', kind: 'goods' },
  { label: 'ml', uqc: 'MLT', kind: 'goods' },
  { label: 'Mtr', uqc: 'MTR', kind: 'goods' },
  { label: 'cm', uqc: 'CMS', kind: 'goods' },
  { label: 'Ft', uqc: 'FTS', kind: 'goods' },
  { label: 'In', uqc: 'INS', kind: 'goods' },
  { label: 'Sq.ft', uqc: 'SQF', kind: 'both' }, // construction services use this too
  { label: 'Sq.m', uqc: 'SQM', kind: 'both' },
  { label: 'Hrs', uqc: 'HRS', kind: 'services' },
  { label: 'Day', uqc: 'DAY', kind: 'services' },
  { label: 'Week', uqc: 'OTH', kind: 'services' },
  { label: 'Month', uqc: 'OTH', kind: 'services' },
  { label: 'Year', uqc: 'OTH', kind: 'services' },
  { label: 'Visit', uqc: 'OTH', kind: 'services' },
  { label: 'Session', uqc: 'OTH', kind: 'services' },
  { label: 'Project', uqc: 'OTH', kind: 'services' },
  { label: 'Word', uqc: 'OTH', kind: 'services' }, // translators / writers
  { label: 'Page', uqc: 'OTH', kind: 'services' },
  { label: 'Box', uqc: 'BOX', kind: 'goods' },
  { label: 'Dozen', uqc: 'DOZ', kind: 'goods' },
  { label: 'Pair', uqc: 'PRS', kind: 'goods' },
  { label: 'Set', uqc: 'SET', kind: 'goods' },
  { label: 'Bag', uqc: 'BAG', kind: 'goods' },
  { label: 'Roll', uqc: 'ROL', kind: 'goods' },
  { label: 'Bottle', uqc: 'BTL', kind: 'goods' },
];

export interface Unit {
  label: string;
  uqc: string;
  kind?: 'goods' | 'services' | 'both';
  custom?: boolean;
}

/**
 * UQC for a unit label. `customUnits` are the business's own units; they live in browser
 * storage in the web app, so the caller passes them in (this package does no I/O).
 */
export const getUnitUQC = (
  label: string | undefined,
  customUnits: readonly Unit[] = [],
): string => {
  const u = [...BUILTIN_UNITS, ...customUnits].find((x) => x.label === label);
  return u?.uqc || 'OTH';
};

// v1.10.77 - GSTR-1 HSN summary: a service (SAC 99xxxx) has no unit; the
// portal expects UQC "NA" and quantity 0 for it (delivery charges, setup fees).
export const hsnUqc = (
  item: { hsn?: string; unit?: string } | undefined,
  customUnits: readonly Unit[] = [],
): string =>
  /^99/.test(String(item?.hsn || '').trim()) ? 'NA' : getUnitUQC(item?.unit, customUnits);
