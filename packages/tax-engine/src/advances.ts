// Vyapar parity P10-S1: GST on advances received and GSTR-1 Table 11 (docs/VYAPAR_IMPLEMENTATION_PHASES.md).
// D-14: only advances for SERVICES are taxed (Notification 66/2017-CT exempts advances for goods), so the screen marks a
// receipt as an advance for services and these functions never see the others.
// The receipt amount includes the tax: taxable = amount / (1 + rate). Place of supply and the business's state are
// two-digit state codes ('33' Tamil Nadu).

import type { Numeric } from './types.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;

export interface AdvanceAdjustment {
  date: string;
  amount: Numeric;
  /** 'invoice': set off against a tax invoice. 'refund': the advance was paid back with no supply. */
  kind?: 'invoice' | 'refund';
}
export interface AdvanceReceipt {
  id?: string;
  /** The day the money came in: the tax point of a service advance. */
  date: string;
  amount: Numeric;
  rate: Numeric;
  pos: string;
  cessRate?: Numeric;
  adjustments?: AdvanceAdjustment[];
}
export interface HeadSplit {
  inter: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

/** Tax inside an advance: inclusive, IGST between states, CGST + SGST within one (SGST takes the odd paisa). */
export function advanceTax(o: {
  amount: Numeric;
  rate: Numeric;
  pos: string;
  bizState: string;
  cessRate?: Numeric;
}): HeadSplit {
  const amount = n(o.amount);
  const rate = n(o.rate);
  const cessRate = n(o.cessRate);
  const inter = !!o.pos && !!o.bizState && o.pos !== o.bizState;
  const taxable = r2((amount * 100) / (100 + rate + cessRate));
  const cess = r2((taxable * cessRate) / 100);
  const tax = r2(amount - taxable - cess);
  if (inter) return { inter, taxable, igst: tax, cgst: 0, sgst: 0, cess };
  const cgst = r2(tax / 2);
  return { inter, taxable, igst: 0, cgst, sgst: r2(tax - cgst), cess };
}

/** What is still unadjusted on an advance. */
export const advanceBalance = (r: AdvanceReceipt) =>
  r2(Math.max(0, n(r.amount) - (r.adjustments ?? []).reduce((s, a) => s + n(a.amount), 0)));

export interface Table11Row {
  pos: string;
  rate: number;
  inter: boolean;
  /** The money, tax included. */
  gross: number;
  taxable: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}
const inPeriod = (d: string, from: string, to: string) => d >= from && d <= to;

function addRow(rows: Map<string, Table11Row>, r: AdvanceReceipt, gross: number, bizState: string) {
  if (gross <= 0) return;
  const t = advanceTax({ amount: gross, rate: r.rate, pos: r.pos, bizState, cessRate: r.cessRate });
  const key = `${r.pos}|${n(r.rate)}`;
  const row = rows.get(key) ?? {
    pos: r.pos,
    rate: n(r.rate),
    inter: t.inter,
    gross: 0,
    taxable: 0,
    iamt: 0,
    camt: 0,
    samt: 0,
    csamt: 0,
  };
  row.gross = r2(row.gross + gross);
  row.taxable = r2(row.taxable + t.taxable);
  row.iamt = r2(row.iamt + t.igst);
  row.camt = r2(row.camt + t.cgst);
  row.samt = r2(row.samt + t.sgst);
  row.csamt = r2(row.csamt + t.cess);
  rows.set(key, row);
}
const sorted = (rows: Map<string, Table11Row>) =>
  [...rows.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);

/**
 * Table 11 for one return period.
 * 11A (`at`): advances received in the period, less what was adjusted or refunded within the same period (an advance
 * and its invoice in one month are reported only through the invoice, so they net to nothing here).
 * 11B (`txpd`): adjustments and refunds in the period of advances received in an EARLIER period.
 * `net` is what the advances add to the period's output tax (11A − 11B), for GSTR-3B 3.1(a).
 */
export function table11(o: {
  receipts: AdvanceReceipt[];
  from: string;
  to: string;
  bizState: string;
}) {
  const at = new Map<string, Table11Row>();
  const txpd = new Map<string, Table11Row>();
  for (const r of o.receipts) {
    const adj = r.adjustments ?? [];
    if (inPeriod(r.date, o.from, o.to)) {
      const sameMonth = adj
        .filter((a) => inPeriod(a.date, o.from, o.to))
        .reduce((s, a) => s + n(a.amount), 0);
      addRow(at, r, r2(Math.max(0, n(r.amount) - sameMonth)), o.bizState);
    } else if (r.date < o.from) {
      // Never more than the advance itself, whatever was typed.
      let left =
        n(r.amount) - adj.filter((a) => a.date < o.from).reduce((s, a) => s + n(a.amount), 0);
      for (const a of adj.filter((x) => inPeriod(x.date, o.from, o.to))) {
        const g = r2(Math.min(Math.max(0, left), n(a.amount)));
        left -= g;
        addRow(txpd, r, g, o.bizState);
      }
    }
  }
  const sum = (rows: Table11Row[], k: 'taxable' | 'iamt' | 'camt' | 'samt' | 'csamt') =>
    r2(rows.reduce((s, x) => s + x[k], 0));
  const A = sorted(at);
  const B = sorted(txpd);
  const net = Object.fromEntries(
    (['taxable', 'iamt', 'camt', 'samt', 'csamt'] as const).map((k) => [
      k,
      r2(sum(A, k) - sum(B, k)) || 0,
    ]),
  ) as Record<'taxable' | 'iamt' | 'camt' | 'samt' | 'csamt', number>;
  return { at: A, txpd: B, net };
}

/** The GSTR-1 JSON keys for Table 11. Empty object when there is nothing, so a return without advances is unchanged. */
export function table11Json(t: { at: Table11Row[]; txpd: Table11Row[] }) {
  const group = (rows: Table11Row[]) => {
    const byPos = new Map<string, Table11Row[]>();
    for (const r of rows) byPos.set(r.pos, [...(byPos.get(r.pos) ?? []), r]);
    return [...byPos.entries()].map(([pos, list]) => ({
      pos,
      sply_ty: list[0]!.inter ? 'INTER' : 'INTRA',
      itms: list.map((r) => ({
        rt: r.rate,
        ad_amt: r.taxable,
        iamt: r.iamt,
        camt: r.camt,
        samt: r.samt,
        csamt: r.csamt,
      })),
    }));
  };
  return {
    ...(t.at.length ? { at: group(t.at) } : {}),
    ...(t.txpd.length ? { txpd: group(t.txpd) } : {}),
  };
}

/**
 * GSTR-3B 3.1(a) with the advances of the period: the invoices' figures plus Table 11's net (11A − 11B). The same object
 * comes back untouched when the period has no advance activity, so a return without advances reads exactly as before.
 */
export function withAdvanceTax<
  T extends { taxable: number; igst: number; cgst: number; sgst: number; cess: number },
>(totals: T, t: ReturnType<typeof table11>): T {
  if (!t.at.length && !t.txpd.length) return totals;
  return {
    ...totals,
    taxable: r2(totals.taxable + t.net.taxable),
    igst: r2(totals.igst + t.net.iamt),
    cgst: r2(totals.cgst + t.net.camt),
    sgst: r2(totals.sgst + t.net.samt),
    cess: r2(totals.cess + t.net.csamt),
  };
}
