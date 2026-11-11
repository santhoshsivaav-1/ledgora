// Vyapar parity P10-S4: where each purchase bill stands on the 180-day rule, from the typed tables.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  chequePaidOn,
  itcAging,
  itcSplit,
  type ChequeStatus,
  type ItcBill,
  type ItcPayment,
} from '@ledgora/tax-engine';

const { purchases, purchaseLines, paymentAllocations, payments, cheques } = schema;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Bills with their payable amount, the credit claimed on them and the payments applied. A payment counts on its own
 * date, except a cheque in the register (Phase 5): it counts on the day it cleared, not at all while it is open or
 * deposited, and never once it bounced or was cancelled (`chequePaidOn`).
 */
export async function itcInputs(tx: Tx, businessId: string) {
  const bills = await tx
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.businessId, businessId),
        eq(purchases.docType, 'bill'),
        isNull(purchases.deletedAt),
      ),
    );
  if (!bills.length) return { bills: [] as ItcBill[], payments: [] as ItcPayment[] };
  const ids = bills.map((b) => b.id);
  const lines = await tx
    .select()
    .from(purchaseLines)
    .where(and(inArray(purchaseLines.purchaseId, ids), isNull(purchaseLines.deletedAt)));
  const allocs = await tx
    .select({
      billId: paymentAllocations.purchaseId,
      amount: paymentAllocations.amount,
      date: payments.paymentDate,
      chequeStatus: cheques.status,
      chequeStatusDate: cheques.statusDate,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .leftJoin(cheques, and(eq(cheques.paymentId, payments.id), isNull(cheques.deletedAt)))
    .where(
      and(
        inArray(paymentAllocations.purchaseId, ids),
        isNull(paymentAllocations.deletedAt),
        isNull(payments.deletedAt),
      ),
    );
  const items: ItcBill[] = bills.map((b) => {
    const eligible = itcSplit(
      lines.filter((l) => l.purchaseId === b.id),
      { interstate: b.interstate, charges: (b.data as { charges?: never[] }).charges },
    ).eligible;
    return {
      id: b.id,
      supplier: b.supplierName,
      number: b.invoiceNumber || b.number,
      date: b.purchaseDate,
      payable: r2(b.total - b.tdsAmount),
      itc: r2(eligible.cgst + eligible.sgst + eligible.igst + eligible.cess),
    };
  });
  return {
    bills: items,
    payments: allocs.flatMap((a) => {
      const date = chequePaidOn(
        a.date,
        a.chequeStatus
          ? { status: a.chequeStatus as ChequeStatus, statusDate: a.chequeStatusDate }
          : null,
      );
      return a.billId && date ? [{ billId: a.billId, amount: a.amount, date }] : [];
    }),
  };
}

export async function itcPositions(tx: Tx, businessId: string, asOf: string) {
  const { bills, payments: pays } = await itcInputs(tx, businessId);
  const a = itcAging(bills, pays, asOf);
  return {
    atRisk: a.atRisk.map((x) => ({
      id: x.id,
      supplier: x.supplier ?? '',
      number: x.number ?? '',
      date: x.date,
      unpaid: x.unpaid,
      itc: x.itcAtRisk,
      daysLeft: x.daysLeft,
    })),
    dueForReversal: a.dueForReversal.map((x) => ({
      id: x.id,
      supplier: x.supplier ?? '',
      number: x.number ?? '',
      date: x.date,
      unpaid: x.unpaid,
      itc: x.itcToReverse,
      daysLate: x.daysLate,
    })),
  };
}
