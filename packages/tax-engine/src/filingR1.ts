// R1 of docs/FEATURE_GAPS_2026-11.md: GSTR-1A (what changed after GSTR-1 was filed), GSTR-9 (the annual return built
// from the year's filed monthly returns) and CMP-08 (composition quarter). Pure: the API reads the packs, these work
// them out. Every output is a worksheet in the portal's table order; whether the portal's offline tools take a file
// we make is proven per form by a real upload (X3) before the "Beta" label goes.

import type { Numeric } from './types.ts';
import { gstinChecksumOk } from './gstin.ts';
import { compositionTax } from './gstDue.ts';
import {
  monthOfRetPeriod,
  retPeriodMonths,
  validatePack,
  type FilingIssue,
  type FilingKind,
  type Gstr3bCompare,
} from './filing.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;
const issue = (
  severity: FilingIssue['severity'],
  code: string,
  message: string,
  path = '',
): FilingIssue => ({ id: path ? `${code}:${path}` : code, severity, code, message, path });

interface Heads {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}
const zero = (): Heads => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
const add = (a: Heads, b: Partial<Heads>, sign = 1): Heads => ({
  txval: a.txval + sign * n(b.txval as Numeric),
  iamt: a.iamt + sign * n(b.iamt as Numeric),
  camt: a.camt + sign * n(b.camt as Numeric),
  samt: a.samt + sign * n(b.samt as Numeric),
  csamt: a.csamt + sign * n(b.csamt as Numeric),
});
const round = (h: Heads): Heads => ({
  txval: r2(h.txval),
  iamt: r2(h.iamt),
  camt: r2(h.camt),
  samt: r2(h.samt),
  csamt: r2(h.csamt),
});
type Item = { itm_det?: Partial<Heads> & { rt?: number } } & Partial<Heads> & { rt?: number };
const itemsTotal = (items: Item[] | undefined) =>
  round((items ?? []).reduce((h, it) => add(h, it.itm_det ?? it), zero()));

// ---- GSTR-1A -------------------------------------------------------------------------------------------------------

export type Gstr1Change = 'added' | 'amended' | 'deleted';
export interface Gstr1aRow {
  table: 'b2b' | 'b2cl' | 'exp' | 'cdnr' | 'b2cs';
  /** What identifies the record on the portal: customer GSTIN and number, or B2CS type/state/rate. */
  key: string;
  change: Gstr1Change;
  before: Heads | null;
  after: Heads | null;
  /** The record as it now is (for added and amended), to type into GSTR-1A. */
  record: unknown;
}

/** Every document of a GSTR-1 file by table and key, with its totals. */
function documentsOf(p: Record<string, unknown>) {
  const out = new Map<
    string,
    { table: Gstr1aRow['table']; key: string; totals: Heads; record: unknown }
  >();
  const put = (table: Gstr1aRow['table'], key: string, totals: Heads, record: unknown) =>
    out.set(`${table}|${key}`, { table, key, totals, record });
  for (const party of (p.b2b ?? []) as {
    ctin?: string;
    inv?: (Record<string, unknown> & { inum?: string; itms?: Item[] })[];
  }[])
    for (const inv of party.inv ?? [])
      put('b2b', `${String(party.ctin ?? '').toUpperCase()} ${inv.inum}`, itemsTotal(inv.itms), {
        ctin: party.ctin,
        ...inv,
      });
  for (const grp of (p.b2cl ?? []) as {
    pos?: string;
    inv?: (Record<string, unknown> & { inum?: string; itms?: Item[] })[];
  }[])
    for (const inv of grp.inv ?? [])
      put('b2cl', `${inv.inum}`, itemsTotal(inv.itms), { pos: grp.pos, ...inv });
  for (const grp of (p.exp ?? []) as {
    exp_typ?: string;
    inv?: (Record<string, unknown> & { inum?: string; itms?: Item[] })[];
  }[])
    for (const inv of grp.inv ?? [])
      put('exp', `${inv.inum}`, itemsTotal(inv.itms), { exp_typ: grp.exp_typ, ...inv });
  for (const party of (p.cdnr ?? []) as {
    ctin?: string;
    nt?: (Record<string, unknown> & { nt_num?: string; itms?: Item[] })[];
  }[])
    for (const nt of party.nt ?? [])
      put('cdnr', `${String(party.ctin ?? '').toUpperCase()} ${nt.nt_num}`, itemsTotal(nt.itms), {
        ctin: party.ctin,
        ...nt,
      });
  // B2CS is a summary by supply type, state and rate: one row per combination.
  const b2cs = new Map<string, { totals: Heads; record: Record<string, unknown> }>();
  for (const row of (p.b2cs ?? []) as (Partial<Heads> & {
    sply_ty?: string;
    pos?: string;
    rt?: number;
  })[]) {
    const key = `${row.sply_ty ?? ''} ${row.pos ?? ''} ${row.rt ?? ''}%`;
    const cur = b2cs.get(key) ?? {
      totals: zero(),
      record: { sply_ty: row.sply_ty, pos: row.pos, rt: row.rt },
    };
    cur.totals = add(cur.totals, row);
    b2cs.set(key, cur);
  }
  for (const [key, v] of b2cs)
    put('b2cs', key, round(v.totals), { ...v.record, ...round(v.totals) });
  return out;
}
const sameHeads = (a: Heads, b: Heads) =>
  (['txval', 'iamt', 'camt', 'samt', 'csamt'] as const).every((k) => Math.abs(a[k] - b[k]) < 0.01);

/**
 * What changed in a period's sales since its GSTR-1 was filed: the rows to add, amend or delete in GSTR-1A. An invoice
 * whose amounts are equal but whose other fields changed (date, place of supply) is "amended" too.
 */
export function diffGstr1(filed: unknown, current: unknown): Gstr1aRow[] {
  const a = documentsOf((filed ?? {}) as Record<string, unknown>);
  const b = documentsOf((current ?? {}) as Record<string, unknown>);
  const rows: Gstr1aRow[] = [];
  for (const [k, now] of b) {
    const was = a.get(k);
    if (!was)
      rows.push({
        table: now.table,
        key: now.key,
        change: 'added',
        before: null,
        after: now.totals,
        record: now.record,
      });
    else if (
      !sameHeads(was.totals, now.totals) ||
      JSON.stringify(was.record) !== JSON.stringify(now.record)
    )
      rows.push({
        table: now.table,
        key: now.key,
        change: 'amended',
        before: was.totals,
        after: now.totals,
        record: now.record,
      });
  }
  for (const [k, was] of a)
    if (!b.has(k))
      rows.push({
        table: was.table,
        key: was.key,
        change: 'deleted',
        before: was.totals,
        after: null,
        record: was.record,
      });
  const order = { b2b: 0, b2cl: 1, exp: 2, cdnr: 3, b2cs: 4 };
  return rows.sort((x, y) => order[x.table] - order[y.table] || x.key.localeCompare(y.key));
}

/** The GSTR-1A pack: the changes and their effect on the period's liability (which flows into 3B). */
export function gstr1aPack(gstin: string, retPeriod: string, filed: unknown, current: unknown) {
  const changes = diffGstr1(filed, current);
  const delta = round(
    changes.reduce((h, c) => add(add(h, c.after ?? {}), c.before ?? {}, -1), zero()),
  );
  return {
    gstin: gstin.toUpperCase(),
    ret_period: retPeriod,
    version: 'GSTR1A-WORKSHEET-1',
    changes,
    delta,
    // GSTR-1 as it stands after these amendments: GSTR-3B 3.1 is locked from GSTR-1 + 1A, so 3B is checked against it.
    gstr1_after: current,
  };
}

export function validateGstr1a(
  payload: unknown,
  ctx: { gstin?: string; retPeriod?: string } = {},
): FilingIssue[] {
  const out: FilingIssue[] = [];
  const p = (payload ?? {}) as { gstin?: string; ret_period?: string; changes?: Gstr1aRow[] };
  if (!gstinChecksumOk(p.gstin))
    out.push(issue('error', 'GSTIN_INVALID', `GSTIN "${p.gstin ?? ''}" is not valid`));
  else if (ctx.gstin && p.gstin !== ctx.gstin.toUpperCase())
    out.push(issue('error', 'GSTIN_OTHER', 'The file is for another GSTIN'));
  if (!monthOfRetPeriod(String(p.ret_period ?? '')))
    out.push(issue('error', 'PERIOD_INVALID', 'Return period is not MMYYYY'));
  else if (ctx.retPeriod && p.ret_period !== ctx.retPeriod)
    out.push(issue('error', 'PERIOD_OTHER', 'The file is for another period'));
  if (!Array.isArray(p.changes) || !p.changes.length)
    out.push(
      issue(
        'error',
        'NO_CHANGES',
        'Nothing changed since GSTR-1 was filed; there is no GSTR-1A to file',
      ),
    );
  for (const c of p.changes ?? [])
    if (c.change === 'deleted')
      out.push(
        issue(
          'warning',
          'R1A_DELETE',
          `${c.table.toUpperCase()} ${c.key} was in GSTR-1 and is gone from the books: delete it in GSTR-1A only if it was never a supply (a cancelled sale needs a credit note)`,
          `${c.table}:${c.key}`,
        ),
      );
  return out;
}

// ---- GSTR-9 --------------------------------------------------------------------------------------------------------

export interface Gstr9Input {
  gstin: string;
  /** Financial year start, 2025 for FY 2025-26. */
  fy: number;
  /** The year's GSTR-1 files (filed packs), any order. */
  gstr1: unknown[];
  /** The year's GSTR-3B files (filed packs). */
  gstr3b: unknown[];
  /** ITC available in GSTR-2B for the year by head (Table 8A), when imported. */
  itc2b?: Partial<Heads> | null;
}

/** The months of a financial year as MMYYYY, April to March. */
export const fyRetPeriods = (fy: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    return `${String(m).padStart(2, '0')}${m >= 4 ? fy : fy + 1}`;
  });

/**
 * GSTR-9 Tables 4, 5, 6A, 7, 8, 9 (payable) and 17 from the year's filed GSTR-1 and GSTR-3B. Values that only the
 * person knows (the 6B inputs / capital goods / services split, tax paid in cash vs credit) are left for them and
 * listed in `toFill`.
 */
export function buildGstr9(input: Gstr9Input) {
  const r1 = input.gstr1 as Record<string, unknown>[];
  const r3 = input.gstr3b as Record<string, Record<string, unknown>>[];
  let b2c = zero();
  let b2b = zero();
  let expWpay = zero();
  let expWopay = zero();
  let sezWpay = zero();
  let sezWopay = zero();
  let cn = zero();
  let dn = zero();
  const hsn = new Map<string, Heads & { hsn_sc: string; rt: number; uqc: string; qty: number }>();
  for (const p of r1) {
    for (const party of (p.b2b ?? []) as { inv?: { inv_typ?: string; itms?: Item[] }[] }[])
      for (const inv of party.inv ?? []) {
        const t = itemsTotal(inv.itms);
        if (inv.inv_typ === 'SEWP') sezWpay = add(sezWpay, t);
        else if (inv.inv_typ === 'SEWOP') sezWopay = add(sezWopay, t);
        else b2b = add(b2b, t);
      }
    for (const grp of (p.b2cl ?? []) as { inv?: { itms?: Item[] }[] }[])
      for (const inv of grp.inv ?? []) b2c = add(b2c, itemsTotal(inv.itms));
    for (const row of (p.b2cs ?? []) as Partial<Heads>[]) b2c = add(b2c, row);
    for (const grp of (p.exp ?? []) as { exp_typ?: string; inv?: { itms?: Item[] }[] }[])
      for (const inv of grp.inv ?? []) {
        const t = itemsTotal(inv.itms);
        if (grp.exp_typ === 'WOPAY') expWopay = add(expWopay, t);
        else expWpay = add(expWpay, t);
      }
    for (const party of (p.cdnr ?? []) as { nt?: { ntty?: string; itms?: Item[] }[] }[])
      for (const nt of party.nt ?? []) {
        if (nt.ntty === 'D') dn = add(dn, itemsTotal(nt.itms));
        else cn = add(cn, itemsTotal(nt.itms));
      }
    for (const row of (
      p.hsn as
        | {
            data?: (Partial<Heads> & {
              hsn_sc?: string;
              rt?: number;
              uqc?: string;
              qty?: number;
            })[];
          }
        | undefined
    )?.data ?? []) {
      const key = `${row.hsn_sc}|${row.rt ?? ''}|${row.uqc ?? ''}`;
      const cur = hsn.get(key) ?? {
        ...zero(),
        hsn_sc: String(row.hsn_sc ?? ''),
        rt: Number(row.rt ?? 0),
        uqc: String(row.uqc ?? 'OTH'),
        qty: 0,
      };
      Object.assign(cur, add(cur, row));
      cur.qty += n(row.qty as Numeric);
      hsn.set(key, cur);
    }
  }
  let rcm = zero();
  let nilExempt = 0;
  let nonGst = 0;
  let itcAvl = zero();
  let itcRev = zero();
  let payable = zero();
  for (const p of r3) {
    const sup = (p.sup_details ?? {}) as Record<string, Partial<Heads>>;
    rcm = add(rcm, sup.isup_rev ?? {});
    nilExempt += n((sup.osup_nil_exmp ?? {}).txval as Numeric);
    nonGst += n((sup.osup_nongst ?? {}).txval as Numeric);
    payable = add(add(payable, sup.osup_det ?? {}), sup.osup_zero ?? {});
    payable = add(payable, sup.isup_rev ?? {});
    const itc = (p.itc_elg ?? {}) as { itc_avl?: Partial<Heads>[]; itc_rev?: Partial<Heads>[] };
    for (const r of itc.itc_avl ?? []) itcAvl = add(itcAvl, r);
    for (const r of itc.itc_rev ?? []) itcRev = add(itcRev, r);
  }
  const t4 = {
    A_b2c: round(b2c),
    B_b2b: round(b2b),
    C_exports_with_tax: round(expWpay),
    D_sez_with_tax: round(sezWpay),
    G_inward_reverse_charge: round(rcm),
    I_credit_notes: round(cn),
    J_debit_notes: round(dn),
  };
  const t4N = round(add(add(add(add(add(add(zero(), b2c), b2b), expWpay), sezWpay), rcm), dn));
  const t4Net = round(add(t4N, cn, -1));
  const t5 = {
    A_exports_without_tax: round(expWopay),
    B_sez_without_tax: round(sezWopay),
    D_exempt_and_nil: r2(nilExempt),
    F_non_gst: r2(nonGst),
  };
  const itc8B = round(itcAvl);
  const t8 = input.itc2b
    ? {
        A_as_per_2b: round(add(zero(), input.itc2b)),
        B_claimed_in_3b: itc8B,
        D_difference: round(add(add(zero(), input.itc2b), itc8B, -1)),
      }
    : null;
  const months = fyRetPeriods(input.fy);
  const has1 = new Set(r1.map((p) => String(p.fp ?? '')));
  const has3 = new Set(
    r3.map((p) => String((p as unknown as { ret_period?: string }).ret_period ?? '')),
  );
  return {
    gstin: input.gstin.toUpperCase(),
    fy: `${input.fy}-${String(input.fy + 1).slice(2)}`,
    version: 'GSTR9-WORKSHEET-1',
    table4: { ...t4, N_total: t4N, net_after_credit_notes: t4Net },
    table5: t5,
    table6: { A_itc_as_per_3b: itc8B },
    table7: { reversals_as_per_3b: round(itcRev) },
    table8: t8,
    table9: { tax_payable_as_per_3b: round(payable) },
    table17: [...hsn.values()].map((h) => ({
      ...round(h),
      hsn_sc: h.hsn_sc,
      rt: h.rt,
      uqc: h.uqc,
      qty: h.qty,
    })),
    missing: {
      gstr1: months.filter((m) => !has1.has(m)),
      gstr3b: months.filter((m) => !has3.has(m)),
    },
    toFill: [
      '6B–6H: split of ITC into inputs, capital goods and input services',
      '9: tax paid in cash and through credit, interest and late fee',
      '10–14: amendments of this year made in the next year (April to November)',
      '15–16: refunds, demands, composition and deemed supplies, if any',
    ],
  };
}

export function validateGstr9(payload: unknown, ctx: { gstin?: string } = {}): FilingIssue[] {
  const out: FilingIssue[] = [];
  const p = (payload ?? {}) as ReturnType<typeof buildGstr9>;
  if (!gstinChecksumOk(p.gstin)) out.push(issue('error', 'GSTIN_INVALID', 'GSTIN is not valid'));
  else if (ctx.gstin && p.gstin !== ctx.gstin.toUpperCase())
    out.push(issue('error', 'GSTIN_OTHER', 'The file is for another GSTIN'));
  for (const m of p.missing?.gstr1 ?? [])
    out.push(
      issue(
        'error',
        'R1_NOT_FILED',
        `GSTR-1 for ${m} is not recorded as filed; GSTR-9 needs every month`,
        `gstr1:${m}`,
      ),
    );
  for (const m of p.missing?.gstr3b ?? [])
    out.push(
      issue('error', 'R3B_NOT_FILED', `GSTR-3B for ${m} is not recorded as filed`, `gstr3b:${m}`),
    );
  if (!p.table8)
    out.push(
      issue(
        'warning',
        'NO_2B',
        'GSTR-2B for the year was not imported, so Table 8A could not be compared with the ITC claimed',
      ),
    );
  else
    for (const k of ['iamt', 'camt', 'samt', 'csamt'] as const) {
      const d = p.table8.D_difference[k];
      if (d < -1)
        out.push(
          issue(
            'warning',
            'ITC_ABOVE_2B',
            `${k}: ITC claimed is ₹${-d} more than 2B for the year; expect a notice unless explained`,
            k,
          ),
        );
    }
  for (const f of p.toFill ?? [])
    out.push(issue('warning', 'TO_FILL', `Fill on the portal: ${f}`, f.slice(0, 5)));
  return out;
}

// ---- CMP-08 --------------------------------------------------------------------------------------------------------

export interface Cmp08 {
  gstin: string;
  /** MMYYYY of the quarter's last month. */
  ret_period: string;
  version: string;
  /** Turnover of the quarter (outward supplies, exempt excluded) and the composition rate. */
  outward: { turnover: number; ratePercent: number; cgst: number; sgst: number };
  /** Tax on inward supplies under reverse charge, paid with CMP-08. */
  inward_rcm: { iamt: number; camt: number; samt: number; csamt: number };
}

export function buildCmp08(
  gstin: string,
  retPeriod: string,
  turnover: number,
  ratePercent: number,
  rcm: Partial<Heads> = {},
): Cmp08 {
  const t = compositionTax(turnover, ratePercent);
  return {
    gstin: gstin.toUpperCase(),
    ret_period: retPeriod,
    version: 'CMP08-WORKSHEET-1',
    outward: { turnover: r2(turnover), ratePercent, cgst: t.central, sgst: t.state },
    inward_rcm: {
      iamt: r2(n(rcm.iamt as Numeric)),
      camt: r2(n(rcm.camt as Numeric)),
      samt: r2(n(rcm.samt as Numeric)),
      csamt: r2(n(rcm.csamt as Numeric)),
    },
  };
}

export function validateCmp08(
  payload: unknown,
  ctx: { gstin?: string; retPeriod?: string } = {},
): FilingIssue[] {
  const out: FilingIssue[] = [];
  const p = (payload ?? {}) as Partial<Cmp08>;
  if (!gstinChecksumOk(p.gstin)) out.push(issue('error', 'GSTIN_INVALID', 'GSTIN is not valid'));
  else if (ctx.gstin && p.gstin !== ctx.gstin.toUpperCase())
    out.push(issue('error', 'GSTIN_OTHER', 'The file is for another GSTIN'));
  const month = monthOfRetPeriod(String(p.ret_period ?? ''));
  if (!month || Number(month.slice(5, 7)) % 3 !== 0)
    out.push(
      issue(
        'error',
        'PERIOD_INVALID',
        'CMP-08 is for a quarter: use the quarter’s last month (MMYYYY)',
      ),
    );
  else if (ctx.retPeriod && p.ret_period !== ctx.retPeriod)
    out.push(issue('error', 'PERIOD_OTHER', 'The file is for another quarter'));
  const o = p.outward;
  if (!o || !(o.turnover >= 0))
    out.push(issue('error', 'AMOUNT_INVALID', 'Turnover is missing or negative'));
  else {
    const t = compositionTax(o.turnover, o.ratePercent);
    if (Math.abs(t.central - o.cgst) > 1 || Math.abs(t.state - o.sgst) > 1)
      out.push(
        issue(
          'error',
          'TAX_NOT_RATE',
          `Tax should be ₹${t.central} CGST and ₹${t.state} SGST at ${o.ratePercent}%`,
        ),
      );
    if (![0.5, 1, 2, 3, 5, 6].includes(o.ratePercent))
      out.push(
        issue(
          'warning',
          'RATE_UNUSUAL',
          `${o.ratePercent}% is not a usual composition rate (1% traders and manufacturers, 5% restaurants, 6% services)`,
        ),
      );
  }
  return out;
}

// ---- one entry point for every pack kind ---------------------------------------------------------------------------

/** Checks a pack of any kind: the R1 kinds here, GSTR-1 / 3B / IMS in filing.ts. */
export function validateAnyPack(
  kind: FilingKind,
  payload: unknown,
  ctx: { gstin?: string; retPeriod?: string; quarterly?: boolean } = {},
  cmp: Gstr3bCompare = {},
): FilingIssue[] {
  if (kind === 'gstr1a') return validateGstr1a(payload, ctx);
  if (kind === 'gstr9') return validateGstr9(payload, ctx);
  if (kind === 'cmp08') return validateCmp08(payload, ctx);
  return validatePack(kind, payload, ctx, cmp);
}

/** The months a pack covers: a quarter for CMP-08 and QRMP returns, the whole financial year for GSTR-9. */
export function packMonths(kind: FilingKind, period: string, quarterly: boolean): string[] {
  const month = monthOfRetPeriod(period);
  if (!month) return [];
  if (kind === 'gstr9') {
    if (month.slice(5, 7) !== '03') return [];
    const fy = Number(month.slice(0, 4)) - 1;
    return fyRetPeriods(fy).map((p) => monthOfRetPeriod(p)!);
  }
  return retPeriodMonths(period, kind === 'cmp08' ? true : quarterly);
}
