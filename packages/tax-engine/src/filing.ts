// File-ready returns (docs/FILE_READY_PLAN.md, Phase 1): the pure half of a filing pack. A pack is one return for one
// period, built by the app in the portal's own upload format, checked here, reviewed (optionally by a CA) and then
// uploaded on the portal by a person. Nothing here talks to a portal. The API runs the same checks again on save, so a
// pack's issues never depend on what the browser claimed.

import type { Numeric } from './types.ts';
import { gstinChecksumOk } from './gstin.ts';
import { GST_PORTAL_RATES } from './rates.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;

/** The returns a pack can hold. Phase 1: GST. Later phases add GSTR-9, ITR, TDS (see the plan). */
export const FILING_KINDS = [
  'gstr1',
  'gstr3b',
  'ims',
  'gstr1a',
  'gstr9',
  'cmp08',
  'gstr4',
  'gstr9c',
  'itr4',
  'itr3',
] as const;
export type FilingKind = (typeof FILING_KINDS)[number];
export const FILING_KIND_LABELS: Record<FilingKind, string> = {
  gstr1: 'GSTR-1',
  gstr3b: 'GSTR-3B',
  ims: 'IMS actions',
  gstr1a: 'GSTR-1A',
  gstr9: 'GSTR-9',
  cmp08: 'CMP-08',
  gstr4: 'GSTR-4',
  gstr9c: 'GSTR-9C',
  itr4: 'ITR-4',
  itr3: 'ITR-3',
};

export const FILING_STATUSES = [
  'draft',
  'ready',
  'in_review',
  'changes_requested',
  'approved',
  'filed',
] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];
export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  draft: 'Needs fixes',
  ready: 'Ready to file',
  in_review: 'With CA for review',
  changes_requested: 'CA asked for changes',
  approved: 'Approved by CA',
  filed: 'Filed',
};

export interface FilingIssue {
  /** Stable across rebuilds of the same data: what a warning is acknowledged by. */
  id: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Where in the file, for the person fixing it ("b2b › 27AAAPA1234A1Z5 › INV/001"). */
  path?: string;
}

const issue = (
  severity: FilingIssue['severity'],
  code: string,
  message: string,
  path = '',
): FilingIssue => ({ id: path ? `${code}:${path}` : code, severity, code, message, path });

// ---- periods -------------------------------------------------------------------------------------------------------

/** 'MMYYYY' (the portal's return period) for a calendar month 'YYYY-MM'. */
export const retPeriodOf = (month: string) => `${month.slice(5, 7)}${month.slice(0, 4)}`;
/** 'YYYY-MM' for a return period 'MMYYYY'; null when it is not one. */
export function monthOfRetPeriod(fp: string): string | null {
  const m = /^(0[1-9]|1[0-2])(\d{4})$/.exec(String(fp ?? ''));
  return m ? `${m[2]}-${m[1]}` : null;
}
/** The months a return covers: one for monthly, the quarter ending in `fp`'s month for quarterly (QRMP). */
export function retPeriodMonths(fp: string, quarterly = false): string[] {
  const month = monthOfRetPeriod(fp);
  if (!month) return [];
  if (!quarterly) return [month];
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m % 3 !== 0) return [];
  return [m - 2, m - 1, m].map((x) => `${y}-${String(x).padStart(2, '0')}`);
}
/** First and last day of the months. */
export function periodBoundsOf(months: string[]) {
  if (!months.length) return null;
  const last = months[months.length - 1]!;
  const y = Number(last.slice(0, 4));
  const m = Number(last.slice(5, 7));
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${months[0]}-01`, to: `${last}-${String(end).padStart(2, '0')}` };
}
/** 'dd-mm-yyyy' (the portal's date) to 'yyyy-mm-dd'; null when it is not a real date. */
function isoOfPortalDate(d: unknown): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d ?? ''));
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

// ---- shared checks -------------------------------------------------------------------------------------------------

/** Invoice and note numbers on the portal: up to 16 characters, letters, digits, '-' and '/' (RET191115). */
export const PORTAL_DOC_NO = /^[A-Za-z0-9/-]{1,16}$/;
const RATES = new Set(GST_PORTAL_RATES);
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

interface Ctx {
  gstin?: string;
  /** 'MMYYYY' */
  retPeriod?: string;
  quarterly?: boolean;
}

function checkRoot(
  p: Record<string, unknown>,
  ctx: Ctx,
  periodKey: 'fp' | 'ret_period',
  out: FilingIssue[],
) {
  const gstin = String(p.gstin ?? '').toUpperCase();
  if (!gstinChecksumOk(gstin))
    out.push(issue('error', 'GSTIN_INVALID', `Your GSTIN "${gstin || '(blank)'}" is not valid`));
  else if (ctx.gstin && gstin !== ctx.gstin.toUpperCase())
    out.push(
      issue('error', 'GSTIN_OTHER', `The file is for ${gstin}, not this business (${ctx.gstin})`),
    );
  const fp = String(p[periodKey] ?? '');
  if (!monthOfRetPeriod(fp))
    out.push(issue('error', 'PERIOD_INVALID', `Return period "${fp}" is not MMYYYY`));
  else if (ctx.retPeriod && fp !== ctx.retPeriod)
    out.push(issue('error', 'PERIOD_OTHER', `The file is for period ${fp}, not ${ctx.retPeriod}`));
  if (!p.version)
    out.push(
      issue('error', 'VERSION_MISSING', 'The file has no version; the portal rejects it whole'),
    );
}

// ---- GSTR-1 --------------------------------------------------------------------------------------------------------

interface Gstr1Item {
  itm_det?: {
    rt?: number;
    txval?: number;
    iamt?: number;
    camt?: number;
    samt?: number;
    csamt?: number;
  };
}
interface Gstr1Inv {
  inum?: string;
  idt?: string;
  val?: number;
  pos?: string;
  inv_typ?: string;
  itms?: Gstr1Item[];
}
interface Gstr1Note {
  nt_num?: string;
  nt_dt?: string;
  val?: number;
  pos?: string;
  inv_typ?: string;
  itms?: Gstr1Item[];
}

/** Tax by head over items: what the GSTR-1 vs 3B comparison adds up. */
interface Heads {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}
const zero = (): Heads => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
const addItems = (h: Heads, items: Gstr1Item[] | undefined, sign = 1) => {
  for (const it of items ?? []) {
    const d = it.itm_det ?? {};
    h.txval += sign * n(d.txval as Numeric);
    h.iamt += sign * n(d.iamt as Numeric);
    h.camt += sign * n(d.camt as Numeric);
    h.samt += sign * n(d.samt as Numeric);
    h.csamt += sign * n(d.csamt as Numeric);
  }
  return h;
};
const round = (h: Heads): Heads => ({
  txval: r2(h.txval),
  iamt: r2(h.iamt),
  camt: r2(h.camt),
  samt: r2(h.samt),
  csamt: r2(h.csamt),
});

function checkItems(
  items: Gstr1Item[] | undefined,
  where: string,
  interstate: boolean,
  out: FilingIssue[],
) {
  if (!items?.length) {
    out.push(issue('error', 'NO_ITEMS', 'Has no rate-wise lines', where));
    return;
  }
  for (const it of items) {
    const d = it.itm_det ?? {};
    if (!RATES.has(Number(d.rt)))
      out.push(issue('error', 'RATE_INVALID', `Rate ${d.rt}% is not a GST rate`, where));
    for (const k of ['txval', 'iamt', 'camt', 'samt', 'csamt'] as const)
      if (d[k] !== undefined && !finite(d[k]))
        out.push(issue('error', 'AMOUNT_INVALID', `${k} is not a number`, where));
    if (interstate && (n(d.camt as Numeric) || n(d.samt as Numeric)))
      out.push(
        issue('error', 'HEAD_INTER', 'Inter-state supply carries CGST/SGST instead of IGST', where),
      );
    if (!interstate && n(d.iamt as Numeric))
      out.push(
        issue('error', 'HEAD_INTRA', 'Intra-state supply carries IGST instead of CGST/SGST', where),
      );
    if (!interstate && Math.abs(n(d.camt as Numeric) - n(d.samt as Numeric)) > 0.01)
      out.push(issue('warning', 'CGST_SGST_UNEQUAL', 'CGST and SGST differ', where));
    const expected = (n(d.txval as Numeric) * Number(d.rt)) / 100;
    const charged = n(d.iamt as Numeric) + n(d.camt as Numeric) + n(d.samt as Numeric);
    if (Number.isFinite(expected) && Math.abs(expected - charged) > 1)
      out.push(
        issue(
          'warning',
          'TAX_NOT_RATE',
          `Tax ₹${r2(charged)} is not ${d.rt}% of ₹${r2(n(d.txval as Numeric))} (expected ₹${r2(expected)})`,
          where,
        ),
      );
  }
}

/** SEZ supplies and exports are IGST whatever the state. */
const sezType = (t: unknown) => t === 'SEWP' || t === 'SEWOP';

export function validateGstr1(payload: unknown, ctx: Ctx = {}): FilingIssue[] {
  const out: FilingIssue[] = [];
  if (!payload || typeof payload !== 'object') return [issue('error', 'NOT_JSON', 'Not a return')];
  const p = payload as Record<string, unknown>;
  checkRoot(p, ctx, 'fp', out);
  const own = String(p.gstin ?? '').toUpperCase();
  const ownState = own.slice(0, 2);
  const bounds = periodBoundsOf(retPeriodMonths(String(p.fp ?? ''), ctx.quarterly));
  const seen = new Map<string, string>();
  const docNo = (no: unknown, date: unknown, where: string, kind: string) => {
    const s = String(no ?? '');
    if (!PORTAL_DOC_NO.test(s))
      out.push(
        issue(
          'error',
          'DOC_NO_INVALID',
          `${kind} number "${s}" must be up to 16 letters, digits, - or /`,
          where,
        ),
      );
    const iso = isoOfPortalDate(date);
    if (!iso) out.push(issue('error', 'DATE_INVALID', `Date "${date}" is not dd-mm-yyyy`, where));
    else if (bounds && iso > bounds.to)
      out.push(
        issue('error', 'DATE_AFTER_PERIOD', `Dated ${date}, after the return period`, where),
      );
    const key = `${kind}:${s.toUpperCase()}`;
    if (seen.has(key))
      out.push(issue('error', 'DOC_NO_DUPLICATE', `${kind} number ${s} appears twice`, where));
    else seen.set(key, where);
  };

  const b2b = (p.b2b ?? []) as { ctin?: string; inv?: Gstr1Inv[] }[];
  for (const party of b2b) {
    const ctin = String(party.ctin ?? '').toUpperCase();
    const at = `b2b › ${ctin || '(no GSTIN)'}`;
    if (!gstinChecksumOk(ctin))
      out.push(issue('error', 'CTIN_INVALID', `Customer GSTIN "${ctin}" is not valid`, at));
    else if (ctin === own)
      out.push(issue('error', 'CTIN_SELF', 'Customer GSTIN is your own GSTIN', at));
    for (const inv of party.inv ?? []) {
      const where = `${at} › ${inv.inum ?? '?'}`;
      docNo(inv.inum, inv.idt, where, 'Invoice');
      const pos = String(inv.pos ?? '');
      if (!/^\d{2}$/.test(pos))
        out.push(
          issue('error', 'POS_INVALID', `Place of supply "${pos}" is not a state code`, where),
        );
      checkItems(inv.itms, where, sezType(inv.inv_typ) || pos !== ownState, out);
    }
  }
  for (const grp of (p.b2cl ?? []) as { pos?: string; inv?: Gstr1Inv[] }[])
    for (const inv of grp.inv ?? []) {
      const where = `b2cl › ${inv.inum ?? '?'}`;
      docNo(inv.inum, inv.idt, where, 'Invoice');
      checkItems(inv.itms, where, true, out);
    }
  for (const grp of (p.exp ?? []) as { inv?: Gstr1Inv[] }[])
    for (const inv of grp.inv ?? [])
      docNo(inv.inum, inv.idt, `exp › ${inv.inum ?? '?'}`, 'Invoice');
  for (const party of (p.cdnr ?? []) as { ctin?: string; nt?: Gstr1Note[] }[]) {
    const ctin = String(party.ctin ?? '').toUpperCase();
    if (!gstinChecksumOk(ctin))
      out.push(
        issue('error', 'CTIN_INVALID', `Customer GSTIN "${ctin}" is not valid`, `cdnr › ${ctin}`),
      );
    for (const nt of party.nt ?? []) {
      const where = `cdnr › ${ctin} › ${nt.nt_num ?? '?'}`;
      docNo(nt.nt_num, nt.nt_dt, where, 'Note');
      checkItems(nt.itms, where, sezType(nt.inv_typ) || String(nt.pos ?? '') !== ownState, out);
    }
  }
  for (const row of (p.b2cs ?? []) as { rt?: number; sply_ty?: string }[])
    if (!RATES.has(Number(row.rt)))
      out.push(issue('error', 'RATE_INVALID', `B2C rate ${row.rt}% is not a GST rate`, 'b2cs'));

  const outward = gstr1Liability(p);
  const hsnRows = ((p.hsn as { data?: unknown[] } | undefined)?.data ?? []).length;
  if (outward.txval > 0 && !hsnRows)
    out.push(
      issue('warning', 'HSN_EMPTY', 'Table 12 (HSN summary) is empty although there are sales'),
    );
  const nothing =
    !b2b.length &&
    !((p.b2cl as unknown[]) ?? []).length &&
    !((p.b2cs as unknown[]) ?? []).length &&
    !((p.exp as unknown[]) ?? []).length &&
    !((p.cdnr as unknown[]) ?? []).length &&
    !(p.nil as { inv?: unknown[] } | undefined)?.inv?.length;
  if (nothing)
    out.push(
      issue(
        'warning',
        'NIL_RETURN',
        'No supplies in this period: file a NIL GSTR-1 on the portal instead of uploading',
      ),
    );
  return out;
}

/** Outward tax of a GSTR-1 file, credit notes subtracted: what GSTR-3B 3.1(a) + 3.1(b) should carry. */
export function gstr1Liability(payload: unknown): Heads {
  const p = (payload ?? {}) as Record<string, unknown>;
  const h = zero();
  for (const party of (p.b2b ?? []) as { inv?: Gstr1Inv[] }[])
    for (const inv of party.inv ?? []) addItems(h, inv.itms);
  for (const grp of (p.b2cl ?? []) as { inv?: Gstr1Inv[] }[])
    for (const inv of grp.inv ?? []) addItems(h, inv.itms);
  for (const row of (p.b2cs ?? []) as Heads[]) {
    h.txval += n(row.txval);
    h.iamt += n(row.iamt);
    h.camt += n(row.camt);
    h.samt += n(row.samt);
    h.csamt += n(row.csamt);
  }
  for (const grp of (p.exp ?? []) as { inv?: { itms?: Heads[] }[] }[])
    for (const inv of grp.inv ?? [])
      for (const it of inv.itms ?? []) {
        h.txval += n(it.txval);
        h.iamt += n(it.iamt);
        h.csamt += n(it.csamt);
      }
  for (const party of (p.cdnr ?? []) as { nt?: (Gstr1Note & { ntty?: string })[] }[])
    for (const nt of party.nt ?? []) addItems(h, nt.itms, nt.ntty === 'D' ? 1 : -1);
  for (const nt of (p.cdnur ?? []) as (Gstr1Note & { ntty?: string })[])
    addItems(h, nt.itms, nt.ntty === 'D' ? 1 : -1);
  return round(h);
}

// ---- GSTR-3B -------------------------------------------------------------------------------------------------------

/** 3.1(a) + 3.1(b) of a GSTR-3B file. */
export function gstr3bLiability(payload: unknown): Heads {
  const s = ((payload ?? {}) as { sup_details?: Record<string, Partial<Heads>> }).sup_details ?? {};
  const a = s.osup_det ?? {};
  const b = s.osup_zero ?? {};
  return round({
    txval: n(a.txval as Numeric) + n(b.txval as Numeric),
    iamt: n(a.iamt as Numeric) + n(b.iamt as Numeric),
    camt: n(a.camt as Numeric),
    samt: n(a.samt as Numeric),
    csamt: n(a.csamt as Numeric) + n(b.csamt as Numeric),
  });
}

/** Table 4(A) of a GSTR-3B file, all rows. */
export function gstr3bItcClaimed(payload: unknown): Heads {
  const rows =
    ((payload ?? {}) as { itc_elg?: { itc_avl?: (Partial<Heads> & { ty?: string })[] } }).itc_elg
      ?.itc_avl ?? [];
  const h = zero();
  for (const r of rows) {
    h.iamt += n(r.iamt as Numeric);
    h.camt += n(r.camt as Numeric);
    h.samt += n(r.samt as Numeric);
    h.csamt += n(r.csamt as Numeric);
  }
  return round(h);
}

export interface Gstr3bCompare {
  /** The GSTR-1 file of the same period, when one is saved. */
  gstr1?: unknown;
  /** ITC available in GSTR-2B (after IMS) for the period, by head. */
  itc2b?: Partial<Heads> | null;
}

const HEADS = [
  ['iamt', 'IGST'],
  ['camt', 'CGST'],
  ['samt', 'SGST'],
  ['csamt', 'cess'],
] as const;

export function validateGstr3b(
  payload: unknown,
  ctx: Ctx = {},
  cmp: Gstr3bCompare = {},
): FilingIssue[] {
  const out: FilingIssue[] = [];
  if (!payload || typeof payload !== 'object') return [issue('error', 'NOT_JSON', 'Not a return')];
  const p = payload as Record<string, unknown>;
  checkRoot(p, ctx, 'ret_period', out);
  const sup = p.sup_details as Record<string, Record<string, unknown>> | undefined;
  if (!sup?.osup_det)
    out.push(issue('error', 'SECTION_MISSING', 'Table 3.1 (sup_details.osup_det) is missing'));
  if (!(p.itc_elg as { itc_avl?: unknown[] } | undefined)?.itc_avl)
    out.push(issue('error', 'SECTION_MISSING', 'Table 4 (itc_elg.itc_avl) is missing'));
  // Every amount a number, and none negative except the net ITC (4(C) may go below zero).
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    else if (/(txval|iamt|camt|samt|csamt|inter|intra)$/.test(path)) {
      if (!finite(v)) out.push(issue('error', 'AMOUNT_INVALID', 'Not a number', path));
      else if ((v as number) < 0 && !path.startsWith('itc_elg.itc_net'))
        out.push(issue('error', 'AMOUNT_NEGATIVE', 'Negative amount', path));
    }
  };
  walk({ sup_details: p.sup_details, itc_elg: p.itc_elg, inward_sup: p.inward_sup }, '');
  const osup = sup?.osup_det ?? {};
  if (Math.abs(n(osup.camt as Numeric) - n(osup.samt as Numeric)) > 1)
    out.push(
      issue(
        'warning',
        'CGST_SGST_UNEQUAL',
        'CGST and SGST in 3.1(a) differ',
        'sup_details.osup_det',
      ),
    );

  if (cmp.gstr1) {
    const r1 = gstr1Liability(cmp.gstr1);
    const r3 = gstr3bLiability(p);
    for (const [k, label] of [['txval', 'Taxable value'], ...HEADS] as const) {
      const diff = r2(r3[k] - r1[k]);
      if (Math.abs(diff) > 1)
        out.push(
          issue(
            'warning',
            'R1_3B_MISMATCH',
            `${label} differs from your GSTR-1 by ₹${diff} (3B ₹${r3[k]}, GSTR-1 ₹${r1[k]}). 3B liability is locked from GSTR-1/1A on the portal`,
            k,
          ),
        );
    }
  } else
    out.push(
      issue(
        'warning',
        'R1_NOT_SAVED',
        'No GSTR-1 pack saved for this period, so 3B liability could not be compared with it',
      ),
    );

  if (cmp.itc2b) {
    const claimed = gstr3bItcClaimed(p);
    for (const [k, label] of HEADS) {
      const over = r2(claimed[k] - n((cmp.itc2b[k] ?? 0) as Numeric));
      if (over > 1)
        out.push(
          issue(
            'warning',
            'ITC_OVER_2B',
            `${label} ITC claimed is ₹${over} more than GSTR-2B shows; the portal restricts ITC to 2B after IMS`,
            k,
          ),
        );
    }
  }
  return out;
}

// ---- IMS (Invoice Management System) -------------------------------------------------------------------------------

export type ImsAction = 'accept' | 'reject' | 'pending';
/** One row of the 2B reconciliation (apps/web gstHelpers buildReconciliation). */
export interface ReconRow {
  status: 'matched' | 'amount_mismatch' | 'twob_only' | 'book_only';
  supplier?: string;
  ctin?: string;
  invoiceNumber?: string;
  date?: string;
  twoBVal?: Numeric;
  twoBTaxable?: Numeric;
  twoBIgst?: Numeric;
  twoBCgst?: Numeric;
  twoBSgst?: Numeric;
  bookVal?: Numeric;
  valDiff?: Numeric;
}
export interface ImsRow {
  ctin: string;
  supplier: string;
  invoiceNumber: string;
  date: string;
  value: number;
  taxable: number;
  tax: number;
  action: ImsAction;
  reason: string;
}

/**
 * What to do with each supplier invoice in IMS, from the 2B reconciliation. Matched → accept. A different amount →
 * keep pending and ask the supplier to amend (accepting takes the supplier's figure into 2B). In 2B but not in the
 * books → pending until the person checks it (reject only if it was never bought; rejecting loses the ITC).
 * In the books but not in 2B is not an IMS row at all: the supplier has not reported it yet.
 */
export function imsActions(rows: ReconRow[], overrides: Record<string, ImsAction> = {}): ImsRow[] {
  const out: ImsRow[] = [];
  for (const r of rows) {
    if (r.status === 'book_only') continue;
    const key = imsKey(r.ctin, r.invoiceNumber);
    let action: ImsAction = 'pending';
    let reason = '';
    if (r.status === 'matched') {
      action = 'accept';
      reason = 'Matches your purchase bill';
    } else if (r.status === 'amount_mismatch') {
      reason = `Amount differs from your bill by ₹${r2(n(r.valDiff ?? 0))}; ask the supplier to amend before accepting`;
    } else reason = 'Not in your books; check it, then accept or reject';
    if (overrides[key]) {
      action = overrides[key]!;
      reason = `${reason} (set by you: ${action})`;
    }
    out.push({
      ctin: String(r.ctin ?? '').toUpperCase(),
      supplier: r.supplier ?? '',
      invoiceNumber: String(r.invoiceNumber ?? ''),
      date: String(r.date ?? ''),
      value: r2(n(r.twoBVal ?? 0)),
      taxable: r2(n(r.twoBTaxable ?? 0)),
      tax: r2(n(r.twoBIgst ?? 0) + n(r.twoBCgst ?? 0) + n(r.twoBSgst ?? 0)),
      action,
      reason,
    });
  }
  return out;
}
export const imsKey = (ctin: unknown, inv: unknown) =>
  `${String(ctin ?? '').toUpperCase()}::${String(inv ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')}`;

/** An IMS pack: the action list and its totals, kept in the pack as its "file". */
export function imsPack(gstin: string, retPeriod: string, rows: ImsRow[]) {
  const sum = (a: ImsAction) =>
    r2(rows.filter((r) => r.action === a).reduce((s, r) => s + r.tax, 0));
  return {
    gstin: gstin.toUpperCase(),
    ret_period: retPeriod,
    version: 'IMS-ACTIONS-1',
    rows,
    totals: {
      accept: sum('accept'),
      reject: sum('reject'),
      pending: sum('pending'),
      count: rows.length,
    },
  };
}

export function validateIms(payload: unknown, ctx: Ctx = {}): FilingIssue[] {
  const out: FilingIssue[] = [];
  if (!payload || typeof payload !== 'object') return [issue('error', 'NOT_JSON', 'Not a list')];
  const p = payload as { rows?: ImsRow[] } & Record<string, unknown>;
  checkRoot(p, ctx, 'ret_period', out);
  if (!Array.isArray(p.rows)) out.push(issue('error', 'SECTION_MISSING', 'No IMS rows'));
  for (const r of p.rows ?? []) {
    if (!['accept', 'reject', 'pending'].includes(r.action))
      out.push(issue('error', 'IMS_ACTION', `Unknown action "${r.action}"`, r.invoiceNumber));
    if (r.action === 'pending')
      out.push(
        issue(
          'warning',
          'IMS_PENDING',
          `${r.supplier || r.ctin} ${r.invoiceNumber}: ${r.reason}`,
          imsKey(r.ctin, r.invoiceNumber),
        ),
      );
  }
  return out;
}

// ---- one entry point -----------------------------------------------------------------------------------------------

export function validatePack(
  kind: FilingKind,
  payload: unknown,
  ctx: Ctx = {},
  cmp: Gstr3bCompare = {},
): FilingIssue[] {
  if (kind === 'gstr1') return validateGstr1(payload, ctx);
  if (kind === 'gstr3b') return validateGstr3b(payload, ctx, cmp);
  return validateIms(payload, ctx);
}

/**
 * The "100% file-ready" gate: no errors, and every warning acknowledged by a person. Returns what is still open.
 */
export function readiness(issues: FilingIssue[], acknowledged: readonly string[] = []) {
  const ack = new Set(acknowledged);
  const errors = issues.filter((i) => i.severity === 'error');
  const openWarnings = issues.filter((i) => i.severity === 'warning' && !ack.has(i.id));
  return { ready: !errors.length && !openWarnings.length, errors, openWarnings };
}

// ---- status rules --------------------------------------------------------------------------------------------------

export type FilingAction =
  'submit_review' | 'approve' | 'request_changes' | 'record_filed' | 'reopen';

/**
 * Where a pack may go from where it is. A pack that was sent for review must be approved before it is recorded as
 * filed (the CA's sign-off is not skipped by a later click); a pack never reviewed may be filed straight from ready.
 */
export function nextStatus(
  from: FilingStatus,
  action: FilingAction,
  o: { ready: boolean; reviewed?: boolean; approved?: boolean },
): FilingStatus | { error: string } {
  switch (action) {
    case 'submit_review':
      if (from !== 'ready' && from !== 'changes_requested')
        return { error: 'Only a ready pack can be sent for review' };
      if (!o.ready) return { error: 'Fix the errors and acknowledge the warnings first' };
      return 'in_review';
    case 'approve':
      if (from !== 'in_review') return { error: 'Only a pack in review can be approved' };
      return 'approved';
    case 'request_changes':
      if (from !== 'in_review') return { error: 'Only a pack in review can be sent back' };
      return 'changes_requested';
    case 'record_filed':
      if (from === 'approved') return 'filed';
      if (from === 'ready' && !o.reviewed && o.ready) return 'filed';
      if (from === 'ready' && o.reviewed)
        return { error: 'This pack was sent for review; it needs approval first' };
      return { error: 'Only a ready or approved pack can be recorded as filed' };
    case 'reopen':
      // The file did not change, so a CA's approval of it still stands.
      if (from !== 'filed') return { error: 'Only a filed pack can be reopened' };
      return o.approved ? 'approved' : o.ready ? 'ready' : 'draft';
  }
}

/** The status a freshly saved pack starts in. */
export const initialStatus = (ready: boolean): FilingStatus => (ready ? 'ready' : 'draft');

/**
 * GST ARN: 15 characters, 'AA', the 2-digit state code, MMYY, then 7 characters. Checked loosely (letters and digits,
 * the AA prefix and the state code of the business) because the portal is the only authority on the rest.
 */
export function arnProblem(arn: string, gstin: string): string | null {
  const a = String(arn ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{15}$/.test(a)) return 'An ARN is 15 letters and digits';
  if (!a.startsWith('AA')) return 'A GST ARN starts with AA';
  const state = String(gstin ?? '').slice(0, 2);
  if (/^\d{2}$/.test(state) && a.slice(2, 4) !== state)
    return `This ARN is for state ${a.slice(2, 4)}, not ${state}`;
  return null;
}

/** The acknowledgement number of a filed income-tax return: 15 digits. */
export function ackProblem(ack: string): string | null {
  return /^[0-9]{15}$/.test(String(ack ?? '').trim())
    ? null
    : 'An income-tax acknowledgement number is 15 digits';
}

/** JSON with keys in a fixed order, so the same return always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}
