// R1, second half (docs/FEATURE_GAPS_2026-11.md): GSTR-4 (composition, annual), GSTR-9C (books against GSTR-9) and the
// extra pre-filing checks: e-invoice coverage, GSTR-3B against the portal's auto-filled figures, and late fee and
// interest on a late return. Pure; the API reads the packs and documents and calls these.

import type { Numeric, Rec } from './types.ts';
import { gstinChecksumOk } from './gstin.ts';
import { isCancelledBill } from './invoiceTypes.ts';
import {
  monthOfRetPeriod,
  retPeriodMonths,
  validatePack,
  type FilingIssue,
  type FilingKind,
  type Gstr3bCompare,
} from './filing.ts';
import { fyRetPeriods, validateCmp08, validateGstr1a, validateGstr9 } from './filingR1.ts';
import { validateItr4Rules } from './itr4Rules.ts';
import { validateItr3Rules } from './itr3Rules.ts';

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: Numeric) => Number(v) || 0;
const issue = (
  severity: FilingIssue['severity'],
  code: string,
  message: string,
  path = '',
): FilingIssue => ({ id: path ? `${code}:${path}` : code, severity, code, message, path });
const DAY = 86_400_000;
const days = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY));

// ---- late fee and interest -----------------------------------------------------------------------------------------

/**
 * Late fee for a GST return filed (or still not filed) after its due date, CGST + SGST together. GSTR-1 and GSTR-3B:
 * ₹50 a day (₹20 for a nil return), capped by the previous year's turnover: ₹500 nil, ₹2,000 up to ₹1.5 crore, ₹5,000 up
 * to ₹5 crore, ₹10,000 above (CGST Notifications 19/2021 and 20/2021). GSTR-4: ₹50 a day, capped ₹2,000 (₹500 nil).
 * Other forms return null: check the portal.
 */
export function gstLateFee(
  form: string,
  due: string,
  filedOn: string,
  o: { nil?: boolean; aato?: number } = {},
): { days: number; fee: number; cap: number } | null {
  const late = days(due, filedOn);
  const aato = n(o.aato);
  let perDay: number;
  let cap: number;
  if (form === 'GSTR-1' || form === 'GSTR-3B') {
    perDay = o.nil ? 20 : 50;
    cap = o.nil ? 500 : aato > 5e7 ? 10000 : aato > 1.5e7 ? 5000 : 2000;
  } else if (form === 'GSTR-4') {
    perDay = o.nil ? 20 : 50;
    cap = o.nil ? 500 : 2000;
  } else return null;
  return { days: late, fee: Math.min(late * perDay, cap), cap };
}

/** Interest under section 50 on tax paid late in cash: 18% a year, by the day. */
export const gstInterest = (cashTax: number, due: string, paidOn: string, ratePercent = 18) =>
  r2((n(cashTax) * ratePercent * days(due, paidOn)) / 36500);

// ---- e-invoice coverage --------------------------------------------------------------------------------------------

const EINV_TYPES = new Set(['tax-invoice', 'credit-note', 'debit-note']);
/** A bill e-invoicing covers: a B2B (or export) invoice or note, not cancelled. */
const einvoiceEligible = (bill: Rec) => {
  if (!bill || isCancelledBill(bill) || !EINV_TYPES.has(bill.invoiceType || 'tax-invoice'))
    return false;
  const c = bill.data?.client || {};
  return !!String(c.gstin || '').trim() || (!!c.country && c.country !== 'India');
};
const irnOf = (bill: Rec) => bill?.data?.invoiceOptions?.einvoice?.irn as string | undefined;

/**
 * Above ₹5 crore aggregate turnover every B2B invoice needs an IRN before GSTR-1; at ₹10 crore and above the IRP accepts
 * an invoice only within 30 days of its date (from 1 April 2025). `aato` is the previous year's turnover.
 */
export function einvoiceChecks(bills: Rec[], o: { aato?: number; asOf: string }): FilingIssue[] {
  const aato = n(o.aato);
  if (aato <= 5e7) return [];
  const out: FilingIssue[] = [];
  for (const b of bills) {
    if (!einvoiceEligible(b) || irnOf(b)) continue;
    const late = aato >= 1e8 && days(String(b.invoiceDate || '').slice(0, 10), o.asOf) > 30;
    out.push(
      issue(
        'warning',
        late ? 'EINV_PAST_30_DAYS' : 'EINV_MISSING',
        late
          ? `${b.invoiceNumber}: no IRN and more than 30 days old; the IRP will refuse it (turnover ₹10 crore and above)`
          : `${b.invoiceNumber}: B2B invoice without an IRN; e-invoicing applies above ₹5 crore turnover`,
        String(b.invoiceNumber || ''),
      ),
    );
  }
  return out;
}

// ---- GSTR-3B against the portal ------------------------------------------------------------------------------------

/**
 * GSTR-3B 3.1 is filled on the portal from GSTR-1/1A and locked. The person types the portal's figures; every head that
 * differs from the pack by more than ₹1 is a warning (the portal's figure is the one filed).
 */
export function comparePortal3b(
  payload: unknown,
  portal: { txval?: number; iamt?: number; camt?: number; samt?: number; csamt?: number },
): FilingIssue[] {
  // 3.1(a) alone: the person types the portal's 3.1(a); exports and SEZ supplies are 3.1(b), a row of their own.
  const a31 = ((payload ?? {}) as { sup_details?: { osup_det?: Rec } }).sup_details?.osup_det ?? {};
  const mine = {
    txval: r2(n(a31.txval)),
    iamt: r2(n(a31.iamt)),
    camt: r2(n(a31.camt)),
    samt: r2(n(a31.samt)),
    csamt: r2(n(a31.csamt)),
  };
  const out: FilingIssue[] = [];
  const LABEL = {
    txval: 'Taxable value',
    iamt: 'IGST',
    camt: 'CGST',
    samt: 'SGST',
    csamt: 'Cess',
  } as const;
  for (const k of Object.keys(LABEL) as (keyof typeof LABEL)[]) {
    if (portal[k] === undefined) continue;
    const diff = r2(n(portal[k]) - mine[k]);
    if (Math.abs(diff) > 1)
      out.push(
        issue(
          'warning',
          'PORTAL_3B_DIFFERS',
          `${LABEL[k]} on the portal is ₹${r2(n(portal[k]))}, this pack has ₹${mine[k]} (₹${diff}). The portal's locked figure is filed; correct GSTR-1A or the books`,
          k,
        ),
      );
  }
  return out;
}

// ---- GSTR-4 (composition, annual) ----------------------------------------------------------------------------------

interface Cmp08Like {
  ret_period?: string;
  outward?: { turnover?: number; ratePercent?: number; cgst?: number; sgst?: number };
  inward_rcm?: { iamt?: number; camt?: number; samt?: number; csamt?: number };
}
const QUARTER_ENDS = (fy: number) => fyRetPeriods(fy).filter((_, i) => i % 3 === 2);

/**
 * GSTR-4 from the year's filed CMP-08 packs (Table 5: tax paid each quarter; Table 6: outward supplies by rate) and the
 * year's purchases (Table 4: inward supplies, by registered supplier, reverse charge and import of services).
 */
export function buildGstr4(input: {
  gstin: string;
  fy: number;
  cmp08: unknown[];
  purchases: Rec[];
}) {
  const quarters = QUARTER_ENDS(input.fy);
  const list = (input.cmp08 as Cmp08Like[]).filter((c) => quarters.includes(String(c.ret_period)));
  const t5 = quarters.map((q) => {
    const c = list.find((x) => x.ret_period === q);
    return {
      ret_period: q,
      turnover: r2(n(c?.outward?.turnover)),
      cgst: r2(n(c?.outward?.cgst)),
      sgst: r2(n(c?.outward?.sgst)),
      rcm: r2(
        n(c?.inward_rcm?.iamt) +
          n(c?.inward_rcm?.camt) +
          n(c?.inward_rcm?.samt) +
          n(c?.inward_rcm?.csamt),
      ),
      filed: !!c,
    };
  });
  const byRate = new Map<number, { rate: number; turnover: number; cgst: number; sgst: number }>();
  for (const c of list) {
    const rate = n(c.outward?.ratePercent);
    const row = byRate.get(rate) ?? { rate, turnover: 0, cgst: 0, sgst: 0 };
    row.turnover = r2(row.turnover + n(c.outward?.turnover));
    row.cgst = r2(row.cgst + n(c.outward?.cgst));
    row.sgst = r2(row.sgst + n(c.outward?.sgst));
    byRate.set(rate, row);
  }
  const from = `${input.fy}-04-01`;
  const to = `${input.fy + 1}-03-31`;
  const bills = input.purchases.filter(
    (p) => (!p.docType || p.docType === 'bill') && String(p.date) >= from && String(p.date) <= to,
  );
  const heads = (p: Rec) => {
    const tax = n(p.totalTax);
    return p.interstate
      ? { iamt: r2(tax), camt: 0, samt: 0 }
      : { iamt: 0, camt: r2(tax / 2), samt: r2(tax - r2(tax / 2)) };
  };
  const bySupplier = new Map<
    string,
    { ctin: string; txval: number; iamt: number; camt: number; samt: number }
  >();
  const total = () => ({ txval: 0, iamt: 0, camt: 0, samt: 0 });
  let rcmRegistered = total();
  let rcmUnregistered = total();
  let importServices = total();
  const addTo = (t: ReturnType<typeof total>, p: Rec) => {
    const h = heads(p);
    return {
      txval: r2(t.txval + n(p.taxableAmount)),
      iamt: r2(t.iamt + h.iamt),
      camt: r2(t.camt + h.camt),
      samt: r2(t.samt + h.samt),
    };
  };
  for (const p of bills) {
    const ctin = String(p.supplierGstin || '').toUpperCase();
    if (p.importType === 'services') importServices = addTo(importServices, p);
    else if (p.reverseCharge) {
      if (ctin) rcmRegistered = addTo(rcmRegistered, p);
      else rcmUnregistered = addTo(rcmUnregistered, p);
    } else if (ctin) {
      const row = bySupplier.get(ctin) ?? { ctin, ...total() };
      Object.assign(row, addTo(row, p));
      bySupplier.set(ctin, row);
    }
  }
  return {
    gstin: input.gstin.toUpperCase(),
    fy: `${input.fy}-${String(input.fy + 1).slice(2)}`,
    version: 'GSTR4-WORKSHEET-1',
    table4: {
      A_registered_suppliers: [...bySupplier.values()].sort((a, b) => a.ctin.localeCompare(b.ctin)),
      B_reverse_charge_registered: rcmRegistered,
      C_reverse_charge_unregistered: rcmUnregistered,
      D_import_of_services: importServices,
    },
    table5: t5,
    table6: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    missing: t5.filter((q) => !q.filed).map((q) => q.ret_period),
    toFill: [
      '7: TDS / TCS credit received, if any',
      '8: tax, interest and late fee payable and paid (the portal computes)',
    ],
  };
}

export function validateGstr4(payload: unknown, ctx: { gstin?: string } = {}): FilingIssue[] {
  const out: FilingIssue[] = [];
  const p = (payload ?? {}) as ReturnType<typeof buildGstr4>;
  if (!gstinChecksumOk(p.gstin)) out.push(issue('error', 'GSTIN_INVALID', 'GSTIN is not valid'));
  else if (ctx.gstin && p.gstin !== ctx.gstin.toUpperCase())
    out.push(issue('error', 'GSTIN_OTHER', 'The file is for another GSTIN'));
  for (const q of p.missing ?? [])
    out.push(
      issue(
        'error',
        'CMP08_NOT_FILED',
        `CMP-08 for the quarter ending ${q} is not recorded as filed`,
        q,
      ),
    );
  for (const r of p.table4?.A_registered_suppliers ?? [])
    if (!gstinChecksumOk(r.ctin))
      out.push(
        issue(
          'warning',
          'CTIN_INVALID',
          `Supplier GSTIN ${r.ctin} is not valid; correct the purchase bill`,
          r.ctin,
        ),
      );
  for (const f of p.toFill ?? [])
    out.push(issue('warning', 'TO_FILL', `Fill on the portal: ${f}`, f.slice(0, 2)));
  return out;
}

// ---- GSTR-9C (books against GSTR-9) --------------------------------------------------------------------------------

export interface Gstr9cAdjustment {
  /** Why turnover in the books differs from the return (unbilled revenue, credit notes after the year, …). */
  label: string;
  /** Added to the books' turnover (negative to subtract). */
  amount: number;
}
interface BooksYear {
  /** Outward supplies of the year in the books (taxable, zero-rated, nil, exempt, non-GST). */
  turnover: number;
  taxable: number;
  tax: { iamt: number; camt: number; samt: number; csamt: number };
  itc: { iamt: number; camt: number; samt: number; csamt: number };
}
type Gstr9Like = {
  gstin?: string;
  table4?: { net_after_credit_notes?: Rec; C_exports_with_tax?: Rec; D_sez_with_tax?: Rec };
  table5?: Rec;
  table6?: { A_itc_as_per_3b?: Rec };
  table9?: { tax_payable_as_per_3b?: Rec };
};

/**
 * GSTR-9C: the year's turnover, taxable turnover, tax and ITC in the books against GSTR-9, with the person's
 * adjustments and what stays unreconciled (Tables 5, 7, 9 and 12). Self-certified since FY 2020-21.
 */
export function buildGstr9c(input: {
  gstin: string;
  fy: number;
  gstr9: unknown;
  books: BooksYear;
  adjustments?: Gstr9cAdjustment[];
}) {
  const g9 = (input.gstr9 ?? {}) as Gstr9Like;
  const t5 = g9.table5 ?? {};
  const net4 = g9.table4?.net_after_credit_notes ?? {};
  const returnTurnover = r2(
    n(net4.txval) +
      n(t5.A_exports_without_tax) +
      n(t5.B_sez_without_tax) +
      n(t5.D_exempt_and_nil) +
      n(t5.F_non_gst),
  );
  const adjustments = (input.adjustments ?? []).map((a) => ({
    label: a.label,
    amount: r2(n(a.amount)),
  }));
  const adjusted = r2(n(input.books.turnover) + adjustments.reduce((s, a) => s + a.amount, 0));
  const heads = ['iamt', 'camt', 'samt', 'csamt'] as const;
  const diffHeads = (a: Rec, b: Rec) =>
    Object.fromEntries(heads.map((k) => [k, r2(n(a[k]) - n(b[k]))])) as Record<
      (typeof heads)[number],
      number
    >;
  const tax9 = g9.table9?.tax_payable_as_per_3b ?? {};
  const itc9 = g9.table6?.A_itc_as_per_3b ?? {};
  return {
    gstin: input.gstin.toUpperCase(),
    fy: `${input.fy}-${String(input.fy + 1).slice(2)}`,
    version: 'GSTR9C-WORKSHEET-1',
    table5: {
      A_turnover_in_books: r2(n(input.books.turnover)),
      adjustments,
      O_turnover_after_adjustments: adjusted,
      P_turnover_in_gstr9: returnTurnover,
      Q_unreconciled: r2(adjusted - returnTurnover),
    },
    table7: {
      A_taxable_in_books: r2(n(input.books.taxable)),
      B_taxable_in_gstr9: r2(n(net4.txval)),
      unreconciled: r2(n(input.books.taxable) - n(net4.txval)),
    },
    table9: { books: input.books.tax, gstr9: tax9, unreconciled: diffHeads(input.books.tax, tax9) },
    table12: {
      books: input.books.itc,
      gstr9: itc9,
      unreconciled: diffHeads(input.books.itc, itc9),
    },
  };
}

export function validateGstr9c(payload: unknown, ctx: { gstin?: string } = {}): FilingIssue[] {
  const out: FilingIssue[] = [];
  const p = (payload ?? {}) as ReturnType<typeof buildGstr9c>;
  if (!gstinChecksumOk(p.gstin)) out.push(issue('error', 'GSTIN_INVALID', 'GSTIN is not valid'));
  else if (ctx.gstin && p.gstin !== ctx.gstin.toUpperCase())
    out.push(issue('error', 'GSTIN_OTHER', 'The file is for another GSTIN'));
  if (!p.table5) {
    out.push(issue('error', 'SECTION_MISSING', 'Table 5 is missing'));
    return out;
  }
  if (Math.abs(p.table5.Q_unreconciled) > 1)
    out.push(
      issue(
        'warning',
        'R9C_TURNOVER',
        `Turnover differs from GSTR-9 by ₹${p.table5.Q_unreconciled} after adjustments; give the reason in Table 6, or add the adjustment`,
        'table5',
      ),
    );
  if (Math.abs(p.table7?.unreconciled ?? 0) > 1)
    out.push(
      issue(
        'warning',
        'R9C_TAXABLE',
        `Taxable turnover differs by ₹${p.table7.unreconciled}; explain in Table 8`,
        'table7',
      ),
    );
  for (const [t, label] of [
    ['table9', 'Tax'],
    ['table12', 'ITC'],
  ] as const)
    for (const [k, v] of Object.entries(p[t]?.unreconciled ?? {}))
      if (Math.abs(v) > 1)
        out.push(
          issue(
            'warning',
            'R9C_DIFF',
            `${label} ${k}: books and GSTR-9 differ by ₹${v}; explain it`,
            `${t}:${k}`,
          ),
        );
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
  if (kind === 'gstr4') return validateGstr4(payload, ctx);
  if (kind === 'gstr9c') return validateGstr9c(payload, ctx);
  if (kind === 'itr4') return validateItr4Rules(payload);
  if (kind === 'itr3') return validateItr3Rules(payload);
  return validatePack(kind, payload, ctx, cmp);
}

/** The months a pack covers: a quarter for CMP-08 and QRMP returns, the whole financial year for the annual returns. */
export function packMonths(kind: FilingKind, period: string, quarterly: boolean): string[] {
  const month = monthOfRetPeriod(period);
  if (!month) return [];
  if (
    kind === 'gstr9' ||
    kind === 'gstr4' ||
    kind === 'gstr9c' ||
    kind === 'itr4' ||
    kind === 'itr3'
  ) {
    if (month.slice(5, 7) !== '03') return [];
    const fy = Number(month.slice(0, 4)) - 1;
    return fyRetPeriods(fy).map((p) => monthOfRetPeriod(p)!);
  }
  return retPeriodMonths(period, kind === 'cmp08' ? true : quarterly);
}
