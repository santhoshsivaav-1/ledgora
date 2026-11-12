// Vyapar parity P10-S5, receivable half: TDS that customers deducted from what they paid us, compared with Form 26AS
// (the TRACES statement of tax credited to our PAN). Only the deductor summary of Part A is read: per deductor, total
// amount paid and total tax deducted. Matching is by TAN when both sides have one, else by the deductor's name.

import type { Numeric } from './types.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;
const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/i;

/** One CSV or caret-separated line into cells (quotes allowed in CSV). */
function cells(line: string): string[] {
  if (line.includes('^')) return line.split('^').map((c) => c.trim());
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const num = (s: string | undefined) => n(String(s ?? '').replace(/[,\s₹]/g, ''));

export interface Statement26ASRow {
  deductor: string;
  tan: string;
  amount: number;
  tds: number;
}

/** The deductor summary rows of Part A of a 26AS text (TRACES) or CSV download. Rows of other parts are ignored. */
export function parse26AS(text: string): Statement26ASRow[] {
  const out: Statement26ASRow[] = [];
  let cols: { name: number; tan: number; amount: number; tds: number } | null = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim() ? raw : '';
    if (/^\s*part\s+[b-z]\b/i.test(line)) {
      cols = null;
      continue;
    }
    const c = cells(line);
    const low = c.map((x) => x.toLowerCase());
    const find = (f: (x: string) => boolean) => low.findIndex(f);
    const tanAt = find((x) => /\btan\b/.test(x));
    const tdsAt = find((x) => x.includes('tax deducted'));
    if (tanAt >= 0 && tdsAt >= 0) {
      cols = {
        name: find((x) => x.includes('name of deductor') || x === 'deductor' || x === 'name'),
        tan: tanAt,
        amount: find((x) => x.includes('amount paid')),
        tds: tdsAt,
      };
      continue;
    }
    if (!cols || cols.name < 0) continue;
    const tan = c[cols.tan] ?? '';
    if (!TAN_RE.test(tan)) continue;
    out.push({
      deductor: c[cols.name] ?? '',
      tan: tan.toUpperCase(),
      amount: cols.amount >= 0 ? num(c[cols.amount]) : 0,
      tds: num(c[cols.tds]),
    });
  }
  return out;
}

/** A deductor's name reduced so "ACME INDIA PRIVATE LIMITED" and "Acme India Pvt. Ltd." are the same. */
export function deductorKey(name: string) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/^\s*m\/s\.?\s*/, '')
    .replace(/\bprivate\b/g, 'pvt')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/[^a-z0-9]/g, '');
}

export type Match26AS = 'matched' | 'mismatch' | 'missing_in_26as' | 'missing_in_books';

/**
 * Our books (TDS per customer) against 26AS. `diff` = 26AS − books; within ₹1 is a match. A deductor only in 26AS is
 * credit we never recorded (a receipt short-paid without noting TDS, or someone else's deduction); one only in the books
 * has not filed or quoted a wrong PAN, so the credit is not ours yet.
 */
export function compare26AS(
  book: { deductor: string; tan?: string; tds: Numeric }[],
  statement: Statement26ASRow[],
) {
  const key = (r: { deductor: string; tan?: string }) =>
    r.tan && TAN_RE.test(r.tan) ? `tan:${r.tan.toUpperCase()}` : `name:${deductorKey(r.deductor)}`;
  const stByTan = new Map<string, Statement26ASRow & { used?: boolean }>();
  const stByName = new Map<string, Statement26ASRow & { used?: boolean }>();
  for (const s of statement) {
    const merge = (m: Map<string, Statement26ASRow>, k: string) => {
      const cur = m.get(k);
      if (cur) {
        cur.tds = r2(cur.tds + s.tds);
        cur.amount = r2(cur.amount + s.amount);
      } else m.set(k, { ...s });
    };
    merge(stByTan, s.tan.toUpperCase());
    merge(stByName, deductorKey(s.deductor));
  }
  const books = new Map<string, { deductor: string; tan: string; tds: number }>();
  for (const b of book) {
    const k = key(b);
    const cur = books.get(k) ?? { deductor: b.deductor, tan: b.tan ?? '', tds: 0 };
    cur.tds = r2(cur.tds + n(b.tds));
    books.set(k, cur);
  }
  const usedTans = new Set<string>();
  const rows: {
    deductor: string;
    tan: string;
    book: number;
    statement: number;
    diff: number;
    status: Match26AS;
  }[] = [];
  for (const b of books.values()) {
    const s = (b.tan && stByTan.get(b.tan.toUpperCase())) || stByName.get(deductorKey(b.deductor));
    if (s) usedTans.add(s.tan);
    const st = s?.tds ?? 0;
    const diff = r2(st - b.tds);
    rows.push({
      deductor: b.deductor,
      tan: s?.tan ?? b.tan,
      book: b.tds,
      statement: st,
      diff,
      status: !s ? 'missing_in_26as' : Math.abs(diff) <= 1 ? 'matched' : 'mismatch',
    });
  }
  for (const s of stByTan.values())
    if (!usedTans.has(s.tan))
      rows.push({
        deductor: s.deductor,
        tan: s.tan,
        book: 0,
        statement: s.tds,
        diff: s.tds,
        status: 'missing_in_books',
      });
  const t = (k: 'book' | 'statement') => r2(rows.reduce((a, r) => a + r[k], 0));
  return {
    rows,
    totals: { book: t('book'), statement: t('statement'), diff: r2(t('statement') - t('book')) },
  };
}
