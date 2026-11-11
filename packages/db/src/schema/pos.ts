import { foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { base, money } from './common.ts';
import { businesses } from './business.ts';
import { parties } from './parties.ts';
import { invoices } from './sales.ts';

// Vyapar parity P12 (Point of Sale). The counter bill itself is an ordinary invoice (with its payments, stock movements
// and ledger posting); the POS only adds loyalty points.

/**
 * Loyalty points, one row per earn or redeem, always tied to the bill that earned or spent them. A customer's balance
 * is the sum over bills that are still live, so cancelling or deleting a bill gives back what it spent and takes back
 * what it earned without another write.
 */
export const loyaltyPoints = pgTable(
  'loyalty_points',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    partyId: uuid('party_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    /** earn | redeem */
    kind: text('kind').notNull(),
    /** Signed: earned is positive, redeemed negative. */
    points: money('points').notNull(),
    /** Rupees the redeemed points took off the bill (0 on an earn row). */
    value: money('value').notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.partyId], foreignColumns: [parties.orgId, parties.id] }),
    foreignKey({ columns: [t.orgId, t.invoiceId], foreignColumns: [invoices.orgId, invoices.id] }),
    index('loyalty_points_party').on(t.orgId, t.partyId),
    index('loyalty_points_invoice').on(t.orgId, t.invoiceId),
  ],
);
