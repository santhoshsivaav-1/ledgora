// Vyapar parity P10-S5: the TDS ledger. One tds_entries row per TDS we deducted, kept in step with its source (a Payment
// Out, a purchase with §194Q TDS, or a loan payment with §194A TDS on its interest) in the same transaction. A row stays "accrued" until a challan is entered; a
// deposited row is never changed or removed by a later edit of its source.
import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import { tdsDueDate, tdsInterest } from '@ledgora/tax-engine';

const { tdsEntries, payments, purchases, parties, loans, loanPayments, loanInterestCredits } =
  schema;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** PAN is characters 3–12 of a GSTIN; '' when the party has none on file. */
export const panFromGstin = (gstin: string | null | undefined) =>
  /^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(String(gstin || '').toUpperCase())
    ? String(gstin).toUpperCase().slice(2, 12)
    : '';

async function partyInfo(tx: Tx, partyId: string | null, fallbackName: string) {
  if (!partyId) return { name: fallbackName, pan: '' };
  const [p] = await tx
    .select({ name: parties.name, gstin: parties.gstin })
    .from(parties)
    .where(eq(parties.id, partyId));
  return { name: p?.name ?? fallbackName, pan: panFromGstin(p?.gstin) };
}

/** Rebuilds the TDS row of one source document. With nothing to record, or after the source is gone, removes it. */
export async function syncTds(
  tx: Tx,
  orgId: string,
  kind: 'payment' | 'purchase' | 'loan_payment' | 'loan_interest',
  id: string,
) {
  const existing = await tx
    .select()
    .from(tdsEntries)
    .where(and(eq(tdsEntries.refType, kind), eq(tdsEntries.refId, id)));
  if (existing.some((e) => e.status === 'deposited')) return;
  if (existing.length)
    await tx
      .delete(tdsEntries)
      .where(
        and(
          eq(tdsEntries.refType, kind),
          eq(tdsEntries.refId, id),
          eq(tdsEntries.status, 'accrued'),
        ),
      );
  if (kind === 'payment') {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id));
    if (!p || p.deletedAt || p.direction !== 'out' || !(p.tdsAmount > 0) || !p.tdsSection) return;
    const who = await partyInfo(tx, p.partyId, '');
    const base = r2(p.amount + p.tdsAmount);
    await tx.insert(tdsEntries).values({
      orgId,
      businessId: p.businessId,
      partyId: p.partyId,
      partyName: who.name,
      pan: who.pan,
      section: p.tdsSection,
      baseAmount: base,
      rate: base > 0 ? r2((p.tdsAmount / base) * 100) : 0,
      tdsAmount: p.tdsAmount,
      date: p.paymentDate,
      refType: 'payment',
      refId: p.id,
    });
    return;
  }
  if (kind === 'loan_payment' || kind === 'loan_interest') {
    const [lp] =
      kind === 'loan_payment'
        ? await tx.select().from(loanPayments).where(eq(loanPayments.id, id))
        : await tx.select().from(loanInterestCredits).where(eq(loanInterestCredits.id, id));
    if (!lp || lp.deletedAt || !(lp.tdsAmount > 0)) return;
    const [l] = await tx.select().from(loans).where(eq(loans.id, lp.loanId));
    const who = await partyInfo(tx, l.lenderPartyId, l.lender || l.name);
    await tx.insert(tdsEntries).values({
      orgId,
      businessId: lp.businessId,
      partyId: l.lenderPartyId,
      partyName: who.name,
      pan: l.lenderPan || who.pan,
      section: '194A',
      baseAmount: lp.tdsBase,
      rate: lp.tdsRate,
      tdsAmount: lp.tdsAmount,
      date: lp.date,
      refType: kind,
      refId: lp.id,
    });
    return;
  }
  const [b] = await tx.select().from(purchases).where(eq(purchases.id, id));
  if (!b || b.deletedAt || b.docType !== 'bill' || !(b.tdsAmount > 0)) return;
  const who = await partyInfo(tx, b.supplierId, b.supplierName);
  const pct = Number((b.data as { tds194QPercent?: number }).tds194QPercent) || 0;
  await tx.insert(tdsEntries).values({
    orgId,
    businessId: b.businessId,
    partyId: b.supplierId,
    partyName: who.name,
    pan: who.pan || panFromGstin(b.supplierGstin),
    section: '194Q',
    baseAmount: b.taxableAmount,
    rate: pct,
    tdsAmount: b.tdsAmount,
    date: b.purchaseDate,
    refType: 'purchase',
    refId: b.id,
  });
}

/** A row as the TDS Payable screen shows it: due date, overdue flag, §201(1A) interest to date, missing-PAN flag. */
export function tdsView(e: typeof tdsEntries.$inferSelect, asOf: string) {
  const dueDate = tdsDueDate(e.date);
  const i = tdsInterest({
    tds: e.tdsAmount,
    deductedOn: e.date,
    dueDate,
    depositedOn: e.status === 'deposited' ? e.challanDate : null,
    asOf,
  });
  return {
    id: e.id,
    direction: e.direction,
    partyId: e.partyId,
    partyName: e.partyName,
    pan: e.pan,
    section: e.section,
    baseAmount: e.baseAmount,
    rate: e.rate,
    tdsAmount: e.tdsAmount,
    date: e.date,
    refType: e.refType,
    refId: e.refId,
    status: e.status as 'accrued' | 'deposited',
    challanNo: e.challanNo,
    bsrCode: e.bsrCode,
    challanDate: e.challanDate,
    dueDate,
    overdue: i.overdue,
    interest: i.interest,
    panMissing: !e.pan,
  };
}
