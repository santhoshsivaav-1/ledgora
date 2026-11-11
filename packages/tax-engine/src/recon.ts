// Vyapar parity P5-S6: bank reconciliation. Pure matching of bank statement rows to the bank account's ledger entries
// (docs/VYAPAR_IMPLEMENTATION_PHASES.md, P5-S6). Statements are read by parseBankStatement (itr.ts); this file
// normalises their dates, fingerprints each row and pairs rows with entries.
//
// Rule: same amount on the matching side (a statement credit is money into the bank = a ledger debit of the bank
// account), dates within ±toleranceDays. Among candidates the best is a reference found in the description, then the
// nearest date, then the earliest entry. Each statement row and each entry is used at most once.

import type { Numeric } from './types.ts';
import { r2 } from './money.ts';

export interface StatementRow {
  date: string;
  description?: string;
  /** Money out of the bank (withdrawal). */
  debit?: Numeric;
  /** Money into the bank (deposit). */
  credit?: Numeric;
  balance?: Numeric;
}
export interface BookEntry {
  id: string;
  date: string;
  /** Ledger debit of the bank account = money in. */
  debit: Numeric;
  credit: Numeric;
  /** Payment number, cheque number, reference: looked for in the statement description. */
  reference?: string | null;
}
export interface ReconMatch {
  row: number;
  hash: string;
  entryId: string;
  days: number;
  byReference: boolean;
}

const n = (v: Numeric) => Number(v) || 0;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A statement date as 'YYYY-MM-DD'. Banks write 06/11/2026, 06-11-2026, 06.11.26, 06-Nov-2026, 06 Nov 26 or
 * 2026-11-06; day first throughout (Indian statements). A spreadsheet's date cell arrives as a serial number (46332).
 * null when it is not a date.
 */
export function normalizeStatementDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  // A spreadsheet date cell read as its number: days since 30 Dec 1899 (Excel's serial date), 1955 to 2118.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial >= 20000 && serial <= 80000)
      return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2,4})$/.exec(s);
  if (m) return iso(year(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[/.\-\s]([A-Za-z]{3})[A-Za-z]*[/.\-\s,]*(\d{2,4})$/.exec(s);
  if (m) {
    const mon = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    return mon ? iso(year(+m[3]), mon, +m[1]) : null;
  }
  return null;
}
const year = (y: number) => (y < 100 ? 2000 + y : y);
function iso(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** FNV-1a, 32 bit, as 8 hex digits. Small, stable, no dependency. */
function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A fingerprint per statement row, the same every time the same statement is uploaded, so a row reconciled once is
 * recognised again. Identical rows (two ₹100 charges on one day) get their occurrence number in the hash.
 */
export function statementHashes(rows: StatementRow[]) {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = [
      r.date,
      (r.description ?? '').trim().toLowerCase(),
      r2(n(r.debit)),
      r2(n(r.credit)),
      r2(n(r.balance)),
    ].join('|');
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    return fnv(`${key}#${k}`);
  });
}

const dayDiff = (a: string, b: string) =>
  Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));

/** Pairs statement rows with ledger entries. Rows without a usable date or amount are left unmatched. */
export function matchStatement(
  rows: StatementRow[],
  entries: BookEntry[],
  opts: { toleranceDays?: number } = {},
) {
  const tol = opts.toleranceDays ?? 3;
  const hashes = statementHashes(rows);
  const used = new Set<string>();
  const matches: ReconMatch[] = [];
  // Rows with a reference hit go first, so a reference match is never taken by a plain amount match.
  const candidates = rows.map((r, i) => {
    const inflow = r2(n(r.credit) - n(r.debit));
    const desc = (r.description ?? '').toLowerCase();
    const list =
      r.date && inflow
        ? entries
            .filter((e) => r2(n(e.debit) - n(e.credit)) === inflow)
            .map((e) => ({
              e,
              days: dayDiff(r.date, e.date),
              byReference:
                !!e.reference &&
                e.reference.length >= 3 &&
                desc.includes(e.reference.toLowerCase()),
            }))
            .filter((c) => c.days <= tol)
            .sort(
              (a, b) =>
                Number(b.byReference) - Number(a.byReference) ||
                a.days - b.days ||
                a.e.date.localeCompare(b.e.date) ||
                a.e.id.localeCompare(b.e.id),
            )
        : [];
    return { i, list };
  });
  const order = [...candidates].sort(
    (a, b) =>
      Number(b.list[0]?.byReference ?? false) - Number(a.list[0]?.byReference ?? false) ||
      (a.list[0]?.days ?? 99) - (b.list[0]?.days ?? 99) ||
      a.i - b.i,
  );
  for (const { i, list } of order) {
    const c = list.find((x) => !used.has(x.e.id));
    if (!c) continue;
    used.add(c.e.id);
    matches.push({
      row: i,
      hash: hashes[i],
      entryId: c.e.id,
      days: c.days,
      byReference: c.byReference,
    });
  }
  matches.sort((a, b) => a.row - b.row);
  const matchedRows = new Set(matches.map((m) => m.row));
  return {
    matches,
    hashes,
    unmatchedRows: rows.map((_, i) => i).filter((i) => !matchedRows.has(i)),
    unmatchedEntries: entries.filter((e) => !used.has(e.id)).map((e) => e.id),
  };
}

/** Statement closing balance less the book balance: what is still to explain. 0 = reconciled. */
export const reconDifference = (statementBalance: Numeric, bookBalance: Numeric) =>
  r2(n(statementBalance) - n(bookBalance));
