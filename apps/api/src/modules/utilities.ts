// Vyapar parity Phase 7 (Utilities), the API side of P7-S1 barcode codes, P7-S2 Export to Tally and P7-S3 Close
// financial year. The decisions are pure functions in @ledgora/tax-engine (barcode.ts, tally.ts, fiscal.ts); this file
// reads the documents they need and writes the closing entry through ledgerRules.ts `repost`, in the caller's
// transaction. Tally export and Close FY need the ledger: with `accounting.ledger` off they answer 409 ledger_required.
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  barcodeAssignInput,
  barcodeAssignResult,
  fyCloseInput,
  fyPreviewQuery,
  fyReopenInput,
  tallyConfigInput,
  tallyExportQuery,
  tallyRangeQuery,
  utilityBusinessQuery,
} from '@ledgora/contracts';
import {
  DEFAULT_TALLY_MAPPING,
  FY_CLOSE_REF,
  buildMasterXml,
  buildVoucherXml,
  carryForward,
  computeInvoiceTotals,
  expenseVoucher,
  paymentVoucher,
  closeProblems,
  closingJournal,
  nextInternalCodes,
  reopenProblems,
  tallyName,
  tallySummary,
  validateTally,
  type AccountKind,
  type TallyItem,
  type TallyMapping,
  type TallyParty,
  type TallyVoucher,
} from '@ledgora/tax-engine';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { loadBusiness } from './businesses.ts';
import { ensureFinancialYears } from './ledger.ts';
import { ledgerEnabled, repost } from './ledgerRules.ts';

const {
  payments,
  expenses,
  expenseCategories,
  documents,
  items,
  invoices,
  invoiceLines,
  purchases,
  purchaseLines,
  parties,
  accounts,
  ledgerEntries,
  financialYears,
  fyCloses,
  businessSettings,
  backups,
} = schema;
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** P7-S2 / P7-S3: these utilities read the ledger. With it off they refuse and say what to do. */
export async function requireLedger(tx: Tx, businessId: string, what: string) {
  if (!(await ledgerEnabled(tx, businessId)))
    throw new AppError(
      'ledger_required',
      `${what} needs the accounting ledger. Enable accounting first (Accounting › Ledger setup).`,
      {
        enable: '/accounting/setup',
      },
    );
}

type Prefs = Record<string, unknown> & {
  tally?: { mapping?: Partial<TallyMapping>; include?: Record<string, boolean> };
};
async function prefsOf(tx: Tx, businessId: string) {
  const [s] = await tx
    .select()
    .from(businessSettings)
    .where(eq(businessSettings.businessId, businessId));
  return { row: s, prefs: (s?.preferences ?? {}) as Prefs };
}

// ---- P7-S2 data ---------------------------------------------------------------------------------------------------------

const DEFAULT_INCLUDE = {
  sales: true,
  salesReturns: true,
  purchases: true,
  purchaseReturns: true,
  cancelled: false,
  receipts: false,
  payments: false,
  expenses: false,
  screens: true,
};
async function tallyConfig(tx: Tx, businessId: string) {
  const biz = await loadBusiness(tx, businessId);
  const { prefs } = await prefsOf(tx, businessId);
  return {
    mapping: {
      ...DEFAULT_TALLY_MAPPING,
      company: biz.name,
      ...(prefs.tally?.mapping ?? {}),
    } as TallyMapping,
    include: { ...DEFAULT_INCLUDE, ...(prefs.tally?.include ?? {}) },
  };
}

// ---- what the older screens saved ----------------------------------------------------------------------------------------

type PartyMap = Map<string, TallyParty & { id: string }>;
/**
 * Adds a party. Tally reads names without case or spaces, so a name typed by hand on a bill and the same name as a
 * typed party are one ledger: the typed party wins. Two different typed parties with one name are kept apart so the
 * check can ask for one to be renamed.
 */
function putParty(m: PartyMap, p: TallyParty & { id: string }) {
  const handTyped = (id: string) => id.startsWith('n:') || id.startsWith('s:');
  const same = [...m.values()].find((x) => tallyName(x.name) === tallyName(p.name));
  if (!same) return void m.set(p.id, p);
  if (same.id === p.id) return;
  if (handTyped(same.id) && !handTyped(p.id)) {
    m.delete(same.id);
    m.set(p.id, p);
  } else if (!handTyped(same.id) && !handTyped(p.id)) m.set(p.id, p);
}

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the older screens' JSON is untyped by nature
const n0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const day10 = (v: unknown) =>
  /^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : '';

/** Bills, purchases, receipts and expenses saved by the billing screens, as Tally vouchers (the same engine totals them). */
async function screenVouchers(
  tx: Tx,
  from: string,
  to: string,
  include: Record<string, boolean>,
  mapping: TallyMapping,
  partyById: PartyMap,
  itemByName: Map<string, TallyItem>,
) {
  const out: TallyVoucher[] = [];
  const docs = async (collection: string) =>
    (
      await tx
        .select({ data: documents.data })
        .from(documents)
        .where(and(eq(documents.collection, collection), isNull(documents.deletedAt)))
        .orderBy(asc(documents.createdAt))
    ).map((r) => r.data as Doc);
  const inRange = (d: string) => d >= from && d <= to;
  const addParty = (id: string, name: string, kind: 'customer' | 'supplier', c: Doc) => {
    if (name)
      putParty(partyById, {
        id,
        name,
        kind,
        gstin: String(c.gstin ?? c.supplierGstin ?? ''),
        state: String(c.state ?? ''),
        address: String(c.address ?? c.supplierAddress ?? ''),
        pin: String(c.pin ?? ''),
        phone: String(c.phone ?? ''),
        email: String(c.email ?? ''),
      });
  };

  for (const b of await docs('bills')) {
    const type = String(b.invoiceType ?? b.data?.invoiceType ?? 'tax-invoice');
    const credit = type === 'credit-note';
    if (!['tax-invoice', 'bill-of-supply', 'composition'].includes(type) && !credit) continue;
    if (credit ? !include.salesReturns : !include.sales) continue;
    const cancelled = b.status === 'cancelled';
    if (cancelled && !include.cancelled) continue;
    const d: Doc = b.data ?? {};
    const date = day10(b.invoiceDate ?? d.details?.invoiceDate);
    if (!date || !inRange(date)) continue;
    const t: Doc = d.totals ?? {};
    const itemsIn: Doc[] = d.items ?? [];
    // Per-line taxable value from the app's own engine, so the lines add up to the document's saved totals.
    const calc = computeInvoiceTotals({
      items: itemsIn,
      profile: d.profile ?? {},
      client: d.client ?? {},
      details: d.details ?? {},
      showGST: type !== 'bill-of-supply',
      taxInclusive: !!d.taxInclusive,
      invoiceOptions: d.invoiceOptions ?? {},
      charges: d.charges ?? [],
    }) as { lines: { taxable: number }[] };
    const name = String(d.client?.name ?? b.clientName ?? '').trim() || 'Cash Sale';
    addParty(`s:${name.toLowerCase()}`, name, 'customer', d.client ?? {});
    for (const l of itemsIn) {
      const nm = String(l.name ?? l.description ?? 'Item');
      if (!itemByName.has(nm.toLowerCase()))
        itemByName.set(nm.toLowerCase(), {
          name: nm,
          unit: String(l.unit ?? 'PCS'),
          hsn: String(l.hsn ?? ''),
          gstRate: n0(l.taxPercent),
        });
    }
    out.push({
      id: `doc:${b.id ?? b.invoiceNumber}`,
      type: credit ? 'Credit Note' : 'Sales',
      number: String(b.invoiceNumber ?? b.id ?? ''),
      date,
      party: name,
      partyGstin: String(d.client?.gstin ?? ''),
      partyState: String(d.client?.state ?? ''),
      placeOfSupply: String(d.details?.placeOfSupply ?? ''),
      lines: itemsIn.map((l, i) => ({
        name: String(l.name ?? l.description ?? 'Item'),
        hsn: String(l.hsn ?? ''),
        unit: String(l.unit ?? 'PCS'),
        quantity: n0(l.quantity) || 1,
        rate: n0(l.rate),
        amount: r2(calc.lines[i]?.taxable ?? n0(l.quantity) * n0(l.rate)),
        gstRate: n0(l.taxPercent),
      })),
      charges: ((d.charges ?? []) as Doc[]).map((c) => ({
        name: String(c.name ?? 'Charge'),
        amount: n0(c.amount),
      })),
      cgst: n0(t.cgst),
      sgst: n0(t.sgst) + n0(t.utgst),
      igst: n0(t.igst),
      cess: n0(t.cess),
      roundOff: n0(t.roundOff),
      total: n0(t.total ?? b.totalAmount),
      cancelled,
    });
  }

  for (const p of await docs('purchases')) {
    const docType = String(p.docType ?? 'bill');
    if (docType === 'order') continue;
    const debit = docType === 'debit-note';
    if (debit ? !include.purchaseReturns : !include.purchases) continue;
    const date = day10(p.date ?? p.purchaseDate);
    if (!date || !inRange(date)) continue;
    const itemsIn: Doc[] = p.items ?? [];
    let taxable = 0;
    let tax = 0;
    let cess = 0;
    const lines = itemsIn.map((l) => {
      const q = n0(l.quantity) || 1;
      const amount = r2(q * n0(l.rate));
      taxable += amount;
      tax += r2((amount * n0(l.taxPercent)) / 100);
      cess += r2((amount * n0(l.cessPercent)) / 100);
      return {
        name: String(l.name ?? 'Item'),
        hsn: String(l.hsn ?? ''),
        unit: 'Nos',
        quantity: q,
        rate: n0(l.rate),
        amount,
        gstRate: n0(l.taxPercent),
      };
    });
    const name = String(p.supplierName ?? '').trim();
    addParty(`s:${name.toLowerCase()}`, name, 'supplier', p);
    for (const l of lines)
      if (!itemByName.has(l.name.toLowerCase()))
        itemByName.set(l.name.toLowerCase(), {
          name: l.name,
          unit: 'Nos',
          hsn: l.hsn,
          gstRate: l.gstRate,
        });
    const inter = !!p.interstate;
    out.push({
      id: `doc:${p.id ?? p.invoiceNumber}`,
      type: debit ? 'Debit Note' : 'Purchase',
      number: String(p.invoiceNumber ?? p.id ?? ''),
      date,
      party: name,
      partyGstin: String(p.supplierGstin ?? ''),
      lines,
      cgst: inter ? 0 : r2(tax / 2),
      sgst: inter ? 0 : r2(tax - r2(tax / 2)),
      igst: inter ? r2(tax) : 0,
      cess: r2(cess),
      total: r2(taxable + tax + cess),
    });
  }

  if (include.receipts)
    for (const r of await docs('receipts')) {
      const date = day10(r.date);
      const name = String(r.clientName ?? r.partyName ?? r.client ?? '').trim();
      if (!date || !inRange(date) || !name || n0(r.amount) <= 0) continue;
      addParty(`s:${name.toLowerCase()}`, name, 'customer', r);
      out.push(
        paymentVoucher(
          {
            id: `doc:${r.id}`,
            direction: 'in',
            number: String(r.number ?? r.id ?? ''),
            date,
            party: name,
            mode: String(r.mode ?? 'cash'),
            amount: n0(r.amount),
            narration: String(r.reference ?? ''),
          },
          mapping,
        ),
      );
    }
  if (include.expenses)
    for (const e of await docs('expenses')) {
      const date = day10(e.date);
      if (!date || !inRange(date) || n0(e.amount) <= 0) continue;
      out.push(
        expenseVoucher(
          {
            id: `doc:${e.id}`,
            kind: e.kind === 'income' ? 'income' : 'expense',
            number: String(e.number ?? e.id ?? ''),
            date,
            head: String(e.category ?? e.description ?? 'Expenses'),
            amount: n0(e.amount),
            tax: n0(e.taxAmount),
            interstate: !!e.interstate,
            mode: String(e.paymentMode ?? 'cash'),
            narration: String(e.description ?? ''),
          },
          mapping,
        ),
      );
    }
  return out;
}

const SALE_TYPES = ['tax-invoice', 'bill-of-supply', 'composition'];
async function tallyData(tx: Tx, businessId: string, from: string, to: string) {
  const { mapping, include } = await tallyConfig(tx, businessId);
  const vouchers: TallyVoucher[] = [];
  const partyById: PartyMap = new Map();
  const itemByName = new Map<string, TallyItem>();
  const types = [
    ...(include.sales ? SALE_TYPES : []),
    ...(include.salesReturns ? ['credit-note'] : []),
  ];
  const invs = types.length
    ? await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.businessId, businessId),
            isNull(invoices.deletedAt),
            inArray(invoices.invoiceType, types),
            gte(invoices.invoiceDate, from),
            lte(invoices.invoiceDate, to),
            include.cancelled ? undefined : ne(invoices.status, 'cancelled'),
          ),
        )
        .orderBy(asc(invoices.invoiceDate), asc(invoices.number))
    : [];
  const partyRows = new Map((await tx.select().from(parties)).map((p) => [p.id, p] as const));
  const linesOf = async (ids: string[]) =>
    ids.length
      ? await tx
          .select()
          .from(invoiceLines)
          .where(and(inArray(invoiceLines.invoiceId, ids), isNull(invoiceLines.deletedAt)))
          .orderBy(asc(invoiceLines.position))
      : [];
  const invLines = await linesOf(invs.map((i) => i.id));
  for (const inv of invs) {
    const p = inv.partyId ? partyRows.get(inv.partyId) : undefined;
    const data = inv.data as {
      charges?: { name: string; amount: number }[];
      totals?: { roundOff?: number };
    };
    const lines = invLines.filter((l) => l.invoiceId === inv.id);
    if (p)
      putParty(partyById, {
        id: p.id,
        name: p.name,
        kind: 'customer',
        gstin: p.gstin ?? '',
        state: p.state,
        address: p.address,
        pin: p.pin,
        phone: p.phone,
        email: p.email,
        opening: p.openingBalance,
      });
    for (const l of lines)
      if (!itemByName.has(l.name.toLowerCase()))
        itemByName.set(l.name.toLowerCase(), {
          name: l.name,
          unit: l.unit,
          hsn: l.hsn,
          gstRate: l.taxPercent,
        });
    vouchers.push({
      id: inv.id,
      type: inv.invoiceType === 'credit-note' ? 'Credit Note' : 'Sales',
      number: inv.number,
      date: inv.invoiceDate,
      party: p?.name ?? 'Cash Sale',
      partyGstin: p?.gstin ?? '',
      partyState: p?.state ?? '',
      placeOfSupply: inv.placeOfSupply,
      lines: lines.map((l) => ({
        name: l.name,
        hsn: l.hsn,
        unit: l.unit,
        quantity: l.quantity,
        rate: l.rate,
        amount: l.taxableAmount,
        gstRate: l.taxPercent,
      })),
      charges: (data.charges ?? []).map((c) => ({ name: c.name, amount: c.amount })),
      cgst: inv.cgst,
      sgst: inv.sgst,
      igst: inv.igst,
      cess: inv.cess,
      roundOff: data.totals?.roundOff ?? 0,
      total: inv.total,
      cancelled: inv.status === 'cancelled',
    });
  }
  const docTypes = [
    ...(include.purchases ? ['bill'] : []),
    ...(include.purchaseReturns ? ['debit-note'] : []),
  ];
  const buys = docTypes.length
    ? await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.businessId, businessId),
            isNull(purchases.deletedAt),
            inArray(purchases.docType, docTypes),
            gte(purchases.purchaseDate, from),
            lte(purchases.purchaseDate, to),
          ),
        )
        .orderBy(asc(purchases.purchaseDate))
    : [];
  const buyLines = buys.length
    ? await tx
        .select()
        .from(purchaseLines)
        .where(
          and(
            inArray(
              purchaseLines.purchaseId,
              buys.map((b) => b.id),
            ),
            isNull(purchaseLines.deletedAt),
          ),
        )
    : [];
  for (const b of buys) {
    const data = b.data as { charges?: { name: string; amount: number }[]; roundOff?: number };
    const sup = b.supplierId ? partyRows.get(b.supplierId) : undefined;
    const name = (b.supplierName || sup?.name || '').trim();
    const key = sup?.id ?? `n:${name.toLowerCase()}`;
    if (name)
      putParty(partyById, {
        id: key,
        name,
        kind: 'supplier',
        gstin: b.supplierGstin || sup?.gstin || '',
        state: sup?.state ?? '',
        address: b.supplierAddress,
        pin: sup?.pin,
        phone: sup?.phone,
        email: sup?.email,
      });
    const lines = buyLines.filter((l) => l.purchaseId === b.id);
    for (const l of lines)
      if (!itemByName.has(l.name.toLowerCase()))
        itemByName.set(l.name.toLowerCase(), {
          name: l.name,
          unit: 'Nos',
          hsn: l.hsn,
          gstRate: l.taxPercent,
        });
    vouchers.push({
      id: b.id,
      type: b.docType === 'debit-note' ? 'Debit Note' : 'Purchase',
      number: b.invoiceNumber || b.number,
      date: b.purchaseDate,
      party: name,
      partyGstin: b.supplierGstin || sup?.gstin || '',
      partyState: sup?.state ?? '',
      placeOfSupply: b.placeOfSupply,
      lines: lines.map((l) => ({
        name: l.name,
        hsn: l.hsn,
        unit: 'Nos',
        quantity: l.quantity,
        rate: l.rate,
        amount: l.taxableAmount,
        gstRate: l.taxPercent,
      })),
      charges: (data.charges ?? []).map((c) => ({ name: c.name, amount: c.amount })),
      cgst: b.cgst,
      sgst: b.sgst,
      igst: b.igst,
      cess: b.cess,
      roundOff: data.roundOff ?? 0,
      total: b.total,
    });
  }
  const extraProblems: { level: 'warning'; id: string; message: string }[] = [];
  const addAccounting = (v: TallyVoucher) => vouchers.push(v);

  // Money received and paid (the optional extras). Receipts with a party only; cash sales' inline payments are included.
  if (include.receipts || include.payments) {
    const pays = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.businessId, businessId),
          isNull(payments.deletedAt),
          gte(payments.paymentDate, from),
          lte(payments.paymentDate, to),
        ),
      )
      .orderBy(asc(payments.paymentDate));
    for (const p of pays) {
      if (p.direction === 'in' ? !include.receipts : !include.payments) continue;
      const party = partyRows.get(p.partyId);
      if (party)
        putParty(partyById, {
          id: party.id,
          name: party.name,
          kind: p.direction === 'in' ? 'customer' : 'supplier',
          gstin: party.gstin ?? '',
          state: party.state,
          address: party.address,
          pin: party.pin,
          phone: party.phone,
          email: party.email,
        });
      addAccounting(
        paymentVoucher(
          {
            id: p.id,
            direction: p.direction === 'out' ? 'out' : 'in',
            number: p.number || `${p.direction === 'out' ? 'PAY' : 'RCT'}-${p.id.slice(0, 6)}`,
            date: p.paymentDate,
            party: party?.name ?? '',
            mode: p.mode,
            amount: p.amount,
            discount: p.discountAmount,
            tds: p.tdsAmount,
            narration: p.reference || p.notes,
          },
          mapping,
        ),
      );
    }
  }
  // Expenses and other income.
  if (include.expenses) {
    const cats = new Map(
      (await tx.select().from(expenseCategories)).map((c) => [c.id, c.name] as const),
    );
    const exps = await tx
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.businessId, businessId),
          isNull(expenses.deletedAt),
          gte(expenses.expenseDate, from),
          lte(expenses.expenseDate, to),
        ),
      )
      .orderBy(asc(expenses.expenseDate));
    for (const e of exps) {
      const total = r2(e.amount + e.taxAmount);
      if (e.paidAmount != null && e.paidAmount < total - 0.005)
        extraProblems.push({
          level: 'warning',
          id: e.id,
          message: `${e.number || e.description}: only ₹${e.paidAmount} of ₹${total} is paid; it is sent as paid in full`,
        });
      addAccounting(
        expenseVoucher(
          {
            id: e.id,
            kind: e.kind === 'income' ? 'income' : 'expense',
            number: e.number || `${e.kind === 'income' ? 'INC' : 'EXP'}-${e.id.slice(0, 6)}`,
            date: e.expenseDate,
            head:
              (e.categoryId && cats.get(e.categoryId)) ||
              e.description ||
              (e.kind === 'income' ? 'Other Income' : 'Expenses'),
            amount: e.amount,
            tax: e.taxAmount,
            interstate: e.interstate,
            mode: e.paymentMode,
            narration: e.description,
          },
          mapping,
        ),
      );
    }
  }
  // What the older screens saved (workspace documents), when the same number is not already there from the typed tables.
  if (include.screens) {
    const have = new Set(vouchers.map((v) => `${v.type}|${v.number}`));
    for (const v of await screenVouchers(tx, from, to, include, mapping, partyById, itemByName)) {
      if (have.has(`${v.type}|${v.number}`)) continue;
      have.add(`${v.type}|${v.number}`);
      vouchers.push(v);
    }
  }
  vouchers.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const partyList = [...partyById.values()];
  const itemList = [...itemByName.values()];
  const problems = [...validateTally(vouchers, mapping, partyList), ...extraProblems];
  return { mapping, include, vouchers, parties: partyList, items: itemList, problems };
}

// ---- P7-S3 data ---------------------------------------------------------------------------------------------------------

async function yearsOf(tx: Tx, orgId: string, businessId: string) {
  await ensureFinancialYears(tx, orgId, businessId);
  const rows = await tx
    .select()
    .from(financialYears)
    .where(and(eq(financialYears.businessId, businessId), isNull(financialYears.deletedAt)))
    .orderBy(asc(financialYears.startDate));
  return rows.map((y) => ({
    id: y.id,
    label: y.label,
    start: y.startDate,
    end: y.endDate,
    status: y.status as 'open' | 'closed',
  }));
}
async function lastBackupAt(tx: Tx) {
  const [r] = await tx
    .select({ at: sql<string | null>`max(${backups.createdAt})` })
    .from(backups)
    .where(ne(backups.kind, 'safety'));
  return r?.at ? new Date(r.at).toISOString() : null;
}
/** Each account's movement inside the year, leaving the year's own closing entry out (so reclosing gives the same). */
export async function movementsIn(tx: Tx, businessId: string, start: string, end: string) {
  const rows = await tx
    .select({
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      debit: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)::float8`,
      credit: sql<number>`coalesce(sum(${ledgerEntries.credit}), 0)::float8`,
    })
    .from(accounts)
    .leftJoin(
      ledgerEntries,
      and(
        eq(ledgerEntries.accountId, accounts.id),
        gte(ledgerEntries.txnDate, start),
        lte(ledgerEntries.txnDate, end),
        ne(ledgerEntries.refType, FY_CLOSE_REF),
      ),
    )
    .where(and(eq(accounts.businessId, businessId), isNull(accounts.deletedAt)))
    .groupBy(accounts.code, accounts.name, accounts.kind);
  return rows.map((r) => ({ ...r, kind: r.kind as AccountKind }));
}
async function closingBalances(tx: Tx, businessId: string, asOf: string, includeClose: boolean) {
  const rows = await tx
    .select({
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      group: accounts.group,
      debit: sql<number>`coalesce(sum(${ledgerEntries.debit}), 0)::float8`,
      credit: sql<number>`coalesce(sum(${ledgerEntries.credit}), 0)::float8`,
    })
    .from(accounts)
    .leftJoin(
      ledgerEntries,
      and(
        eq(ledgerEntries.accountId, accounts.id),
        lte(ledgerEntries.txnDate, asOf),
        includeClose ? undefined : ne(ledgerEntries.refType, FY_CLOSE_REF),
      ),
    )
    .where(and(eq(accounts.businessId, businessId), isNull(accounts.deletedAt)))
    .groupBy(accounts.code, accounts.name, accounts.kind, accounts.group);
  return rows.map((r) => ({ ...r, kind: r.kind as AccountKind }));
}

async function fyPlan(
  tx: Tx,
  orgId: string,
  q: {
    businessId: string;
    yearId: string;
    method: 'prefix' | 'new-year';
    newPrefix: string;
    confirmText: string;
  },
) {
  await loadBusiness(tx, q.businessId);
  const years = await yearsOf(tx, orgId, q.businessId);
  const year = years.find((y) => y.id === q.yearId);
  if (!year) throw notFound('Financial year');
  const ledgerOn = await ledgerEnabled(tx, q.businessId);
  const problems = closeProblems({
    ledgerOn,
    year,
    years,
    today: today(),
    lastBackupAt: await lastBackupAt(tx),
    now: Date.now(),
    confirmText: q.confirmText,
    method: q.method,
    newPrefix: q.newPrefix,
  });
  let journal = null as ReturnType<typeof closingJournal> | null;
  let summary = null as ReturnType<typeof carryForward> | null;
  if (ledgerOn) {
    journal = closingJournal({
      yearId: year.id,
      label: year.label,
      movements: await movementsIn(tx, q.businessId, year.start, year.end),
    });
    summary = carryForward(await closingBalances(tx, q.businessId, year.end, false));
  }
  return { year, years, problems, journal, summary, ledgerOn };
}

export function utilitiesModule({ route }: Registrar) {
  // ---- P7-S1 ----
  route({
    method: 'post',
    path: '/v1/utilities/barcodes/assign',
    tag: 'Utilities',
    summary:
      'Give each selected item without a barcode the next in-store EAN-13 (200…). Serialised, so concurrent runs never repeat a code',
    body: barcodeAssignInput,
    response: barcodeAssignResult,
    handler: async ({ tx, orgId, body }) => {
      // One run at a time per organization; the unique barcode index is the backstop.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`barcode:${orgId}`}))`);
      const rows = await tx
        .select()
        .from(items)
        .where(and(inArray(items.id, body.itemIds), isNull(items.deletedAt)));
      if (rows.length !== new Set(body.itemIds).size) throw notFound('Item');
      const [top] = await tx
        .select({
          seq: sql<
            number | null
          >`max(substring(${items.extra}->>'barcode' from 4 for 9)::bigint)::float8`,
        })
        .from(items)
        .where(sql`${items.extra}->>'barcode' ~ '^200[0-9]{10}$'`);
      const need = rows.filter((r) => !(r.extra as { barcode?: string }).barcode);
      const codes = nextInternalCodes(Math.floor(top?.seq ?? 0), need.length);
      const assigned: { id: string; code: string }[] = [];
      for (const [i, r] of need.entries()) {
        await tx
          .update(items)
          .set({ extra: { ...(r.extra as object), barcode: codes[i].code }, updatedAt: new Date() })
          .where(eq(items.id, r.id));
        assigned.push({ id: r.id, code: codes[i].code });
      }
      if (assigned.length)
        await audit(tx, orgId, 'barcode.assign', 'item', null, {
          after: { count: assigned.length, first: assigned[0].code },
        });
      return { assigned, alreadyHad: rows.length - need.length };
    },
  });

  // ---- P7-S2 ----
  route({
    method: 'get',
    path: '/v1/utilities/tally/config',
    tag: 'Utilities',
    summary: 'The saved Tally ledger mapping and which documents to include',
    query: utilityBusinessQuery,
    handler: async ({ tx, query }) => {
      await requireLedger(tx, query.businessId, 'Export to Tally');
      return tallyConfig(tx, query.businessId);
    },
  });
  route({
    method: 'put',
    path: '/v1/utilities/tally/config',
    tag: 'Utilities',
    summary: 'Save the Tally ledger mapping and the include switches',
    body: tallyConfigInput,
    handler: async ({ tx, orgId, body }) => {
      await requireLedger(tx, body.businessId, 'Export to Tally');
      const { row, prefs } = await prefsOf(tx, body.businessId);
      const known = new Set(Object.keys(DEFAULT_TALLY_MAPPING));
      const mapping = Object.fromEntries(
        Object.entries(body.mapping).filter(([k]) => known.has(k)),
      );
      const preferences = { ...prefs, tally: { mapping, include: body.include } };
      if (row)
        await tx
          .update(businessSettings)
          .set({ preferences, updatedAt: new Date() })
          .where(eq(businessSettings.id, row.id));
      else
        await tx
          .insert(businessSettings)
          .values({ orgId, businessId: body.businessId, preferences });
      await audit(tx, orgId, 'tally.config', 'business', body.businessId, {
        after: { mapping, include: body.include },
      });
      return tallyConfig(tx, body.businessId);
    },
  });
  route({
    method: 'get',
    path: '/v1/utilities/tally/preview',
    tag: 'Utilities',
    summary:
      'Counts and problems for a period before downloading. Errors name the document; warnings do not block',
    query: tallyRangeQuery,
    handler: async ({ tx, query }) => {
      await requireLedger(tx, query.businessId, 'Export to Tally');
      const d = await tallyData(tx, query.businessId, query.from, query.to);
      return {
        summary: tallySummary(d.vouchers, d.parties, d.items, d.problems),
        problems: d.problems,
        mapping: d.mapping,
        include: d.include,
      };
    },
  });
  route({
    method: 'get',
    path: '/v1/utilities/tally/export',
    tag: 'Utilities',
    summary:
      'Master.xml (ledgers, taxes, units, stock items) or Voucher.xml for a period. Refused while a document has an error',
    query: tallyExportQuery,
    handler: async ({ tx, orgId, query }) => {
      await requireLedger(tx, query.businessId, 'Export to Tally');
      const d = await tallyData(tx, query.businessId, query.from, query.to);
      const errors = d.problems.filter((p) => p.level === 'error');
      if (errors.length)
        throw new AppError(
          'unprocessable',
          `${errors.length} problem${errors.length > 1 ? 's' : ''} to fix before exporting: ${errors[0].message}`,
          { problems: errors },
        );
      const xml =
        query.file === 'master'
          ? buildMasterXml(d.parties, d.items, d.mapping, { vouchers: d.vouchers })
          : buildVoucherXml(d.vouchers, d.mapping);
      await audit(tx, orgId, 'tally.export', 'business', query.businessId, {
        after: { file: query.file, from: query.from, to: query.to, vouchers: d.vouchers.length },
      });
      return new Response(xml, {
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'content-disposition': `attachment; filename="${query.file === 'master' ? 'Master' : 'Voucher'}.xml"`,
          'x-tally-vouchers': String(d.vouchers.length),
        },
      });
    },
  });

  // ---- P7-S3 ----
  route({
    method: 'get',
    path: '/v1/utilities/fy-close/preview',
    tag: 'Utilities',
    summary:
      'What closing a financial year would do: the problems, the profit moved to Retained Earnings and what carries forward',
    query: fyPreviewQuery,
    handler: async ({ tx, orgId, query }) => {
      const p = await fyPlan(tx, orgId, query);
      const ledgerProblem = p.problems.find((x) => x.code === 'ledger_required');
      if (ledgerProblem)
        throw new AppError('ledger_required', ledgerProblem.message, {
          enable: '/accounting/setup',
        });
      const { posting, ...figures } = p.journal!;
      return {
        year: p.year,
        problems: p.problems,
        canClose: p.problems.length === 0,
        journal: posting,
        ...figures,
        carry: p.summary,
        lastBackupAt: await lastBackupAt(tx),
        years: p.years,
      };
    },
  });
  route({
    method: 'post',
    path: '/v1/utilities/fy-close',
    tag: 'Utilities',
    summary:
      'Close a financial year in one transaction: the closing entry (profit to Retained Earnings), the numbering restart, the lock and the audit row. Needs the ledger and a backup in the last 24 hours',
    body: fyCloseInput,
    handler: async ({ tx, orgId, auth, body }) => {
      // Lock the year row first: two people closing the same year run one after the other.
      await tx
        .select({ id: financialYears.id })
        .from(financialYears)
        .where(eq(financialYears.id, body.yearId))
        .for('update');
      const p = await fyPlan(tx, orgId, body);
      const ledgerProblem = p.problems.find((x) => x.code === 'ledger_required');
      if (ledgerProblem)
        throw new AppError('ledger_required', ledgerProblem.message, {
          enable: '/accounting/setup',
        });
      if (p.problems.length)
        throw new AppError('unprocessable', p.problems[0].message, { problems: p.problems });
      const { year } = p;
      // 1. the closing entry (nothing to post for a year with no profit and loss accounts moving)
      const j = p.journal!;
      await repost(tx, orgId, {
        businessId: body.businessId,
        refType: FY_CLOSE_REF,
        refId: year.id,
        postings: j.posting ? [j.posting] : [],
      });
      // 2. numbering restarts each financial year from now on (and takes the new prefix, if that is the method)
      const { row, prefs } = await prefsOf(tx, body.businessId);
      const [bs] = await tx
        .select({ n: businessSettings.numberSettings })
        .from(businessSettings)
        .where(eq(businessSettings.businessId, body.businessId));
      const numberSettings = {
        ...((bs?.n ?? {}) as object),
        resetOn: 'fy',
        showFinYear: true,
        ...(body.method === 'prefix' ? { brandPrefix: body.newPrefix.trim() } : {}),
      };
      if (row)
        await tx
          .update(businessSettings)
          .set({ numberSettings, updatedAt: new Date() })
          .where(eq(businessSettings.id, row.id));
      else
        await tx
          .insert(businessSettings)
          .values({ orgId, businessId: body.businessId, numberSettings, preferences: prefs });
      // 3. lock the year (writes dated in it are refused for everyone but the owner, with a reason)
      await tx
        .update(financialYears)
        .set({ status: 'closed', lockedAt: today(), lockedBy: auth.user.id, updatedAt: new Date() })
        .where(eq(financialYears.id, year.id));
      // 4. what the new year opens with: the ledger is continuous, so these are the closing balances after the entry
      const after = carryForward(await closingBalances(tx, body.businessId, year.end, true));
      const next =
        (await yearsOf(tx, orgId, body.businessId)).find((y) => y.start > year.end) ?? null;
      await tx.insert(fyCloses).values({
        orgId,
        businessId: body.businessId,
        yearId: year.id,
        method: body.method,
        newPrefix: body.method === 'prefix' ? body.newPrefix.trim() : '',
        netProfit: j.netProfit,
        summary: { before: p.summary, after },
        closedBy: auth.user.id,
      });
      await audit(tx, orgId, 'financial_year.close_fy', 'financial_year', year.id, {
        after: { label: year.label, method: body.method, netProfit: j.netProfit },
      });
      return {
        year: { ...year, status: 'closed' as const },
        netProfit: j.netProfit,
        income: j.income,
        expense: j.expense,
        carry: after,
        nextYear: next,
        method: body.method,
      };
    },
  });
  route({
    method: 'post',
    path: '/v1/utilities/fy-reopen',
    tag: 'Utilities',
    summary:
      'Reopen a closed year (owner only, with a reason): the closing entry is reversed and the audit log records why',
    body: fyReopenInput,
    handler: async ({ tx, orgId, auth, body }) => {
      await requireLedger(tx, body.businessId, 'Reopening a financial year');
      await tx
        .select({ id: financialYears.id })
        .from(financialYears)
        .where(eq(financialYears.id, body.yearId))
        .for('update');
      const years = await yearsOf(tx, orgId, body.businessId);
      const year = years.find((y) => y.id === body.yearId);
      if (!year) throw notFound('Financial year');
      const problems = reopenProblems({ role: auth.role, reason: body.reason, year, years });
      if (problems.length)
        throw new AppError(
          problems[0].code === 'owner_only' ? 'forbidden' : 'unprocessable',
          problems[0].message,
          { problems },
        );
      await repost(tx, orgId, {
        businessId: body.businessId,
        refType: FY_CLOSE_REF,
        refId: year.id,
        postings: [],
      });
      await tx
        .update(financialYears)
        .set({ status: 'open', lockedAt: null, lockedBy: null, updatedAt: new Date() })
        .where(eq(financialYears.id, year.id));
      await tx
        .update(fyCloses)
        .set({ reopenedAt: new Date(), reopenedBy: auth.user.id, reopenReason: body.reason.trim() })
        .where(and(eq(fyCloses.yearId, year.id), isNull(fyCloses.reopenedAt)));
      await audit(tx, orgId, 'financial_year.reopen_fy', 'financial_year', year.id, {
        after: { label: year.label, reason: body.reason.trim() },
      });
      return { ...year, status: 'open' as const };
    },
  });
  route({
    method: 'get',
    path: '/v1/utilities/fy-close/history',
    tag: 'Utilities',
    summary: 'Years closed with Close FY, with the profit moved and any reopen',
    query: utilityBusinessQuery,
    handler: async ({ tx, query }) => {
      const rows = await tx
        .select()
        .from(fyCloses)
        .where(and(eq(fyCloses.businessId, query.businessId), isNull(fyCloses.deletedAt)))
        .orderBy(asc(fyCloses.createdAt));
      const ys = new Map(
        (
          await tx
            .select()
            .from(financialYears)
            .where(eq(financialYears.businessId, query.businessId))
        ).map((y) => [y.id, y.label]),
      );
      return {
        data: rows.map((r) => ({
          id: r.id,
          year: ys.get(r.yearId) ?? '',
          method: r.method,
          newPrefix: r.newPrefix,
          netProfit: r.netProfit,
          closedAt: r.createdAt.toISOString(),
          reopenedAt: r.reopenedAt?.toISOString() ?? null,
          reopenReason: r.reopenReason,
        })),
      };
    },
  });
}

/** Profit moved at close versus profit now, for each year closed with Close FY and not reopened (Verify My Data). */
export async function staleClosings(tx: Tx, businessId: string) {
  const rows = await tx
    .select({ c: fyCloses, y: financialYears })
    .from(fyCloses)
    .innerJoin(financialYears, eq(financialYears.id, fyCloses.yearId))
    .where(
      and(
        eq(fyCloses.businessId, businessId),
        isNull(fyCloses.reopenedAt),
        isNull(fyCloses.deletedAt),
      ),
    );
  const out = [];
  for (const { c, y } of rows) {
    const j = closingJournal({
      yearId: y.id,
      label: y.label,
      movements: await movementsIn(tx, businessId, y.startDate, y.endDate),
    });
    out.push({ yearId: y.id, label: y.label, closed: c.netProfit, now: j.netProfit });
  }
  return out;
}

/**
 * The fix for a stale closing entry: post the closing entry again from the books as they are now (repost reverses the
 * old one), and record the new profit. The year stays closed and locked.
 */
export async function recloseStale(tx: Tx, orgId: string, businessId: string) {
  let fixed = 0;
  for (const s of await staleClosings(tx, businessId)) {
    if (Math.abs(s.closed - s.now) <= 0.005) continue;
    const [y] = await tx.select().from(financialYears).where(eq(financialYears.id, s.yearId));
    const j = closingJournal({
      yearId: y.id,
      label: y.label,
      movements: await movementsIn(tx, businessId, y.startDate, y.endDate),
    });
    await repost(tx, orgId, {
      businessId,
      refType: FY_CLOSE_REF,
      refId: y.id,
      postings: j.posting ? [j.posting] : [],
    });
    await tx
      .update(fyCloses)
      .set({ netProfit: j.netProfit, updatedAt: new Date() })
      .where(and(eq(fyCloses.yearId, y.id), isNull(fyCloses.reopenedAt)));
    await audit(tx, orgId, 'financial_year.reclose', 'financial_year', y.id, {
      before: { netProfit: s.closed },
      after: { netProfit: j.netProfit },
    });
    fixed++;
  }
  return fixed;
}
