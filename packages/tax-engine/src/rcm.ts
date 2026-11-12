// Vyapar parity P10-S2: reverse charge on purchases (docs/VYAPAR_IMPLEMENTATION_PHASES.md). D-13: the supplier is owed
// the bill WITHOUT the RCM tax; that tax is paid to the government in cash (GSTR-3B 3.1(d)) and becomes input tax credit
// in the period it is paid (4(A)(3)).

import type { Numeric } from './types.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;

/** What the supplier is owed before payments: total less RCM tax (reverse charge only), §194Q TDS and adjusted debit notes. */
export function rcmSupplierDue(b: {
  total: Numeric;
  reverseCharge?: boolean;
  tax?: Numeric;
  cess?: Numeric;
  tds?: Numeric;
  adjusted?: Numeric;
}) {
  const rcm = b.reverseCharge ? n(b.tax) + n(b.cess) : 0;
  return r2(Math.max(0, n(b.total) - rcm - n(b.tds) - n(b.adjusted)));
}

interface RcmHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}
const zero = (): RcmHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const add = (a: RcmHeads, b: Partial<RcmHeads>): RcmHeads => ({
  igst: r2(a.igst + n(b.igst ?? 0)),
  cgst: r2(a.cgst + n(b.cgst ?? 0)),
  sgst: r2(a.sgst + n(b.sgst ?? 0)),
  cess: r2(a.cess + n(b.cess ?? 0)),
});

export interface RcmBill {
  id?: string;
  /** Bill date: the period whose 3.1(d) carries the liability. */
  date: string;
  reverseCharge?: boolean;
  heads: Partial<RcmHeads>;
  /** Set by "Record RCM payment". */
  rcmPayment?: { date: string; amount?: Numeric } | null;
}

/**
 * One return period of reverse charge: `liability` (3.1(d)) from bills dated in the period, `claim` (4(A)(3)) from RCM
 * tax paid in the period whatever the bill's date, and `unpaid`: bills of the period or earlier whose tax is not paid.
 */
export function rcmItcForPeriod(bills: RcmBill[], period: { from: string; to: string }) {
  const inP = (d?: string | null) => !!d && d >= period.from && d <= period.to;
  let liability = zero();
  let claim = zero();
  const unpaid: RcmBill[] = [];
  for (const b of bills) {
    if (!b.reverseCharge) continue;
    if (inP(b.date)) liability = add(liability, b.heads);
    if (b.rcmPayment?.date && inP(b.rcmPayment.date)) claim = add(claim, b.heads);
    if (!b.rcmPayment?.date && b.date <= period.to) unpaid.push(b);
  }
  return { liability, claim, unpaid };
}
