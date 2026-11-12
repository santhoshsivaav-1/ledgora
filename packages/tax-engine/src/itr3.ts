// Vyapar parity P10-S8: the ledger's Profit & Loss (the profit-loss report) mapped onto ITR-3 Part A-P&L, for a person
// to copy into the return on incometax.gov.in. A summary to review with a CA, never a filing.

import type { Numeric } from './types.ts';
import { daysBetween } from './compliance.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;

interface PlRow {
  id: string;
  section: string;
  particulars: string;
  amount: Numeric;
}
/** Report lines are the accounts; total lines carry ids without the "section:code" form and are skipped. */
const accountLines = (rows: PlRow[], section: string) =>
  rows.filter((r) => r.section === section && r.id.startsWith(`${section}:`));
const sumOf = (rows: PlRow[]) => r2(rows.reduce((s, r) => s + n(r.amount), 0));

export const ITR3_ROWS = [
  {
    key: 'turnover',
    label: 'Revenue from operations (sale of goods and services, net of GST)',
    schedule: 'Part A-P&L 1',
  },
  { key: 'otherIncome', label: 'Other income', schedule: 'Part A-P&L 4' },
  { key: 'openingStock', label: 'Opening stock', schedule: 'Part A-P&L 5' },
  { key: 'purchases', label: 'Purchases (net of returns)', schedule: 'Part A-P&L 6' },
  {
    key: 'directExpenses',
    label: 'Direct expenses (freight, wages, power and the like)',
    schedule: 'Part A-P&L 7–21',
  },
  { key: 'closingStock', label: 'Closing stock', schedule: 'Part A-P&L 3' },
  {
    key: 'depreciation',
    label: 'Depreciation and amortisation',
    schedule: 'Part A-P&L 50 (and Schedule DEP / DOA)',
  },
  { key: 'interest', label: 'Interest paid', schedule: 'Part A-P&L 44' },
  { key: 'otherExpenses', label: 'Other indirect expenses', schedule: 'Part A-P&L 22–45' },
  { key: 'netProfit', label: 'Profit before tax', schedule: 'Part A-P&L 53 → Schedule BP' },
] as const;

/**
 * Part A-P&L figures from the profit-loss report ({ rows, totals }). `reconciled` says whether the mapped lines add up
 * to the report's net profit (within ₹1); `diff` is the report's figure less the mapped one.
 */
export function itr3Map(pl: {
  rows: PlRow[];
  totals: { openingStock?: Numeric; closingStock?: Numeric; netProfit?: Numeric };
}) {
  const cost = accountLines(pl.rows, 'Cost of sales');
  const indirect = accountLines(pl.rows, 'Indirect expenses');
  const isPurchase = (r: PlRow) => /purchase/i.test(r.particulars);
  const isDep = (r: PlRow) => /depreciation|amortis/i.test(r.particulars);
  const isInt = (r: PlRow) => /interest/i.test(r.particulars);
  const v: Record<string, number> = {
    turnover: sumOf(accountLines(pl.rows, 'Income')),
    otherIncome: sumOf(accountLines(pl.rows, 'Other income')),
    openingStock: r2(n(pl.totals.openingStock)),
    purchases: sumOf(cost.filter(isPurchase)),
    directExpenses: sumOf(cost.filter((r) => !isPurchase(r))),
    closingStock: r2(n(pl.totals.closingStock)),
    depreciation: sumOf(indirect.filter(isDep)),
    interest: sumOf(indirect.filter((r) => !isDep(r) && isInt(r))),
    otherExpenses: sumOf(indirect.filter((r) => !isDep(r) && !isInt(r))),
    netProfit: r2(n(pl.totals.netProfit)),
  };
  const computed = r2(
    v.turnover! +
      v.otherIncome! -
      v.openingStock! -
      v.purchases! -
      v.directExpenses! +
      v.closingStock! -
      v.depreciation! -
      v.interest! -
      v.otherExpenses!,
  );
  const diff = r2(v.netProfit! - computed);
  return {
    rows: ITR3_ROWS.map((r) => ({ ...r, amount: v[r.key]! })),
    reconciled: Math.abs(diff) <= 1,
    diff,
  };
}

/** Profit to date, annualised over the days of the financial year gone (for advance tax). The full year: as is. */
export function projectAnnualProfit(ytd: Numeric, fyFrom: string, asOf: string) {
  const days = daysBetween(fyFrom, asOf) + 1;
  if (days <= 0) return 0;
  if (days >= 365) return r2(n(ytd));
  return r2((n(ytd) * 365) / days);
}
