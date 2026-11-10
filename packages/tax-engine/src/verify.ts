// Vyapar parity P4-S5: Verify My Data. Each check is a pure function over rows the API has already read (set-based
// queries in apps/api/src/modules/verify.ts) and answers { id, severity, count, rows, fix? }. A check that finds nothing
// has count 0, which is how the screen shows "passed".

import type { Numeric } from './types.ts';
import { r2 } from './money.ts';
import { gstinChecksumOk } from './gstin.ts';
import { getFinancialYearLabel, parseLocalDate } from './dates.ts';
import { addDays } from './compliance.ts';

export type Severity = 'error' | 'warn' | 'info';
export interface Check {
  id: string;
  title: string;
  severity: Severity;
  count: number;
  rows: Record<string, unknown>[];
  /** What "Fix automatically" does: repost = rebuild the ledger of the documents; trim = trim allocations. */
  fix?: 'repost' | 'trim_allocations';
}
const n = (v: Numeric) => Number(v) || 0;
const make = (
  id: string,
  title: string,
  severity: Severity,
  rows: Record<string, unknown>[],
  fix?: Check['fix'],
): Check => ({ id, title, severity, count: rows.length, rows, ...(fix ? { fix } : {}) });

export interface VerifyData {
  today: string;
  ledgerOn: boolean;
  items?: { id: string; name: string; stock: number; trackStock: boolean }[];
  invoices?: {
    id: string;
    number: string;
    invoiceType: string;
    invoiceDate: string;
    total: number;
    status: string;
    lineTotal: number;
    extras: number;
    invoiceDiscount: number;
  }[];
  payments?: { id: string; number: string; settled: number; allocated: number }[];
  invoiceDue?: { id: string; number: string; due: number; allocated: number }[];
  parties?: { id: string; name: string; gstin: string }[];
  hsnLines?: {
    invoiceId: string;
    invoiceNumber: string;
    name: string;
    taxPercent: number;
    hsn: string;
  }[];
  vouchers?: { voucherId: string; debit: number; credit: number }[];
  documentsWithoutLedger?: { kind: string; id: string; label: string }[];
  orphanMovements?: { id: string; refType: string; refId: string }[];
  partyMismatches?: { partyId: string; name: string; ledger: number; documents: number }[];
  documentDates?: { kind: string; id: string; label: string; date: string }[];
}

/** Last whole number in a document number and what comes before it: INV/2026-27/0012 → ['INV/2026-27/', 12]. */
export const numberParts = (num: string): [string, number] | null => {
  const m = /^(.*?)(\d+)$/.exec(String(num || '').trim());
  return m ? [m[1], Number(m[2])] : null;
};

export function runVerify(d: VerifyData): Check[] {
  const checks: Check[] = [];

  checks.push(
    make(
      'negative_stock',
      'Items with negative stock',
      'warn',
      (d.items || [])
        .filter((i) => i.trackStock && i.stock < 0)
        .map((i) => ({ id: i.id, name: i.name, stock: i.stock })),
    ),
  );

  // Expected total = lines + additional charges (with their GST) + TCS + round-off − discount on the whole bill.
  checks.push(
    make(
      'invoice_total_mismatch',
      'Invoices whose total is not what their lines add up to',
      'error',
      (d.invoices || [])
        .filter(
          (i) =>
            i.status !== 'cancelled' &&
            !['quotation', 'sales-order', 'delivery-challan', 'proforma'].includes(i.invoiceType),
        )
        .map((i) => ({ i, expected: r2(n(i.lineTotal) + n(i.extras) - n(i.invoiceDiscount)) }))
        .filter(({ i, expected }) => Math.abs(expected - n(i.total)) > 1)
        .map(({ i, expected }) => ({ id: i.id, number: i.number, stored: n(i.total), expected })),
    ),
  );

  const overPaid = (d.payments || [])
    .filter((p) => n(p.allocated) > n(p.settled) + 0.005)
    .map((p) => ({ id: p.id, number: p.number, settled: p.settled, allocated: p.allocated }));
  const overDue = (d.invoiceDue || [])
    .filter((x) => n(x.allocated) > n(x.due) + 0.005)
    .map((x) => ({ id: x.id, number: x.number, due: x.due, allocated: x.allocated }));
  checks.push(
    make(
      'payment_over_allocated',
      'Payments applied for more than they are or more than is due',
      'error',
      [...overPaid, ...overDue],
      'trim_allocations',
    ),
  );

  // Gaps inside one series (same prefix, same type, same financial year).
  const series = new Map<string, number[]>();
  const dupes = new Map<string, string[]>();
  for (const i of d.invoices || []) {
    const parts = numberParts(i.number);
    const fy = getFinancialYearLabel(parseLocalDate(i.invoiceDate));
    const key = `${i.invoiceType}|${parts?.[0] ?? i.number}|${fy}`;
    if (parts) series.set(key, [...(series.get(key) ?? []), parts[1]]);
    const dk = `${i.invoiceType}|${i.number}`;
    dupes.set(dk, [...(dupes.get(dk) ?? []), i.id]);
  }
  const gaps: Record<string, unknown>[] = [];
  for (const [key, nums] of series) {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let k = sorted[0]; k <= sorted[sorted.length - 1]; k++)
      if (!sorted.includes(k)) missing.push(k);
    if (missing.length)
      gaps.push({
        series: key.split('|').slice(0, 2).join(' '),
        fy: key.split('|')[2],
        missing: missing.slice(0, 20),
        count: missing.length,
      });
  }
  checks.push(make('invoice_number_gap', 'Gaps in invoice numbering', 'info', gaps));
  checks.push(
    make(
      'invoice_number_duplicate',
      'The same invoice number used twice',
      'error',
      [...dupes]
        .filter(([, ids]) => ids.length > 1)
        .map(([k, ids]) => ({ number: k.split('|')[1], ids })),
    ),
  );

  checks.push(
    make(
      'gstin_invalid',
      'Parties with an invalid GSTIN',
      'warn',
      (d.parties || [])
        .filter((p) => p.gstin && !gstinChecksumOk(p.gstin))
        .map((p) => ({ id: p.id, name: p.name, gstin: p.gstin })),
    ),
  );
  checks.push(
    make(
      'hsn_missing',
      'Taxed lines with no HSN/SAC',
      'warn',
      (d.hsnLines || [])
        .filter((l) => n(l.taxPercent) > 0 && !String(l.hsn || '').trim())
        .map((l) => ({ invoiceId: l.invoiceId, invoice: l.invoiceNumber, item: l.name })),
    ),
  );

  checks.push(
    make(
      'ledger_unbalanced',
      'Ledger vouchers whose debits and credits differ',
      'error',
      (d.vouchers || [])
        .filter((v) => Math.abs(n(v.debit) - n(v.credit)) > 0.005)
        .map((v) => ({ voucherId: v.voucherId, debit: v.debit, credit: v.credit })),
      'repost',
    ),
  );
  checks.push(
    make(
      'ledger_missing',
      'Documents missing from the ledger',
      'error',
      d.ledgerOn ? (d.documentsWithoutLedger || []).map((x) => ({ ...x })) : [],
      'repost',
    ),
  );
  checks.push(
    make(
      'orphan_stock_movement',
      'Stock movements with no document',
      'warn',
      (d.orphanMovements || []).map((m) => ({ ...m })),
    ),
  );
  checks.push(
    make(
      'party_balance_mismatch',
      'Party balances that differ between the ledger and the documents',
      'error',
      d.ledgerOn
        ? (d.partyMismatches || [])
            .filter((m) => Math.abs(n(m.ledger) - n(m.documents)) > 0.005)
            .map((m) => ({ ...m }))
        : [],
      'repost',
    ),
  );

  const limit = addDays(d.today, 30);
  checks.push(
    make(
      'future_dated',
      'Documents dated more than 30 days ahead',
      'info',
      (d.documentDates || []).filter((x) => x.date > limit).map((x) => ({ ...x })),
    ),
  );

  const byGstin = new Map<string, { id: string; name: string }[]>();
  for (const p of d.parties || [])
    if (p.gstin)
      byGstin.set(p.gstin.toUpperCase(), [
        ...(byGstin.get(p.gstin.toUpperCase()) ?? []),
        { id: p.id, name: p.name },
      ]);
  checks.push(
    make(
      'duplicate_party',
      'Parties sharing a GSTIN',
      'warn',
      [...byGstin].filter(([, l]) => l.length > 1).map(([gstin, parties]) => ({ gstin, parties })),
    ),
  );
  return checks;
}

/** The headline numbers of a run: passed, warnings, errors. */
export const verifySummary = (checks: Check[]) => ({
  passed: checks.filter((c) => c.count === 0).length,
  warnings: checks.filter((c) => c.count > 0 && c.severity !== 'error').length,
  errors: checks.filter((c) => c.count > 0 && c.severity === 'error').length,
});
