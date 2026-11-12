// Vyapar parity P10-S3: GSTR-3B cells that were missing or misplaced (docs/VYAPAR_IMPLEMENTATION_PHASES.md).
// The screens total documents into these shapes; the functions only place them in the right cell.

import type { Numeric } from './types.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;

/**
 * 3.1(a) and 3.1(b): a supply to an SEZ unit or developer is zero-rated (§16 IGST Act), so its taxable value and IGST
 * belong in 3.1(b) with exports, not in 3.1(a). The IGST is still output tax; only the cell changes. Without SEZ
 * supplies the same objects come back, so such a return reads exactly as before.
 */
export function moveSezToZeroRated<
  A extends { taxable: number; igst: number; cess: number },
  B extends { taxable: number; igst: number; cess: number },
>(a: A, b: B, sez: { taxable: Numeric; igst: Numeric; cess: Numeric }): { a: A; b: B } {
  if (!n(sez.taxable) && !n(sez.igst) && !n(sez.cess)) return { a, b };
  return {
    a: {
      ...a,
      taxable: r2(Math.max(0, a.taxable - n(sez.taxable))),
      igst: r2(Math.max(0, a.igst - n(sez.igst))),
      cess: r2(Math.max(0, a.cess - n(sez.cess))),
    },
    b: {
      ...b,
      taxable: r2(b.taxable + n(sez.taxable)),
      igst: r2(b.igst + n(sez.igst)),
      cess: r2(b.cess + n(sez.cess)),
    },
  };
}

/** 3.2 unregistered: inter-state supplies to unregistered persons, by place of supply. Credit notes come in negative. */
export function interStateUnregistered(rows: { pos: string; txval: Numeric; iamt: Numeric }[]) {
  const by = new Map<string, { pos: string; txval: number; iamt: number }>();
  for (const r of rows) {
    if (!r.pos) continue;
    const cur = by.get(r.pos) ?? { pos: r.pos, txval: 0, iamt: 0 };
    cur.txval = r2(cur.txval + n(r.txval));
    cur.iamt = r2(cur.iamt + n(r.iamt));
    by.set(r.pos, cur);
  }
  return [...by.values()]
    .filter((r) => r.txval !== 0 || r.iamt !== 0)
    .sort((a, b) => a.pos.localeCompare(b.pos));
}

/**
 * Table 5: inward supplies that carry no GST. A 0% line is exempt or nil-rated ("GST" row); a line marked `nonGst`
 * (petrol, alcohol for human consumption) is the "Non-GST" row. Split by inter-state / intra-state as the bill is.
 */
export function exemptInward(
  bills: {
    interstate?: boolean;
    reverseCharge?: boolean;
    items?: { quantity?: Numeric; rate?: Numeric; taxPercent?: Numeric; nonGst?: boolean }[];
  }[],
) {
  const out = { gst: { inter: 0, intra: 0 }, nongst: { inter: 0, intra: 0 } };
  for (const b of bills) {
    if (b.reverseCharge) continue;
    const side = b.interstate ? 'inter' : 'intra';
    for (const it of b.items ?? []) {
      if (n(it.taxPercent) !== 0) continue;
      const v = n(it.quantity) * n(it.rate);
      const row = it.nonGst ? out.nongst : out.gst;
      row[side] = r2(row[side] + v);
    }
  }
  return out;
}
