import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';

const { numberSeries } = schema;

/**
 * Next number of a document series of a business: RCT-1, PAY-1, PUR-1, DN-1, PO-1, EXP-1, INC-1 ... Each series is
 * its own row in number_series, locked while it is taken so two saves at once never get the same number.
 */
export async function nextSeriesNumber(tx: Tx, orgId: string, businessId: string, prefix: string) {
  const counterKey = `counter_${prefix}`;
  await tx.insert(numberSeries).values({ orgId, businessId, counterKey }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.businessId, businessId), eq(numberSeries.counterKey, counterKey)))
    .for('update');
  const next = row.lastValue + 1;
  await tx
    .update(numberSeries)
    .set({ lastValue: next, updatedAt: new Date() })
    .where(eq(numberSeries.id, row.id));
  return `${prefix}-${next}`;
}
