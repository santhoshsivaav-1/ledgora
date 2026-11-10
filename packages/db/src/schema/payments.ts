import { date, foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { base, money } from './common.ts';
import { businesses } from './business.ts';
import { parties } from './parties.ts';
import { invoices } from './sales.ts';

/** Money received from a party. Whatever is not allocated to an invoice stays as the party's credit. */
export const payments = pgTable(
  'payments',
  {
    ...base(),
    businessId: uuid('business_id').notNull(),
    partyId: uuid('party_id').notNull(),
    amount: money('amount').notNull(),
    mode: text('mode').notNull().default('cash'), // cash | upi | bank | cheque | card | other
    paymentDate: date('payment_date').notNull(),
    reference: text('reference').notNull().default(''),
    notes: text('notes').notNull().default(''),
    // Vyapar parity P2-S2 / P2-S5.
    /** in = received from a customer, out = paid to a supplier (Phase 3) or refunded (credit note). */
    direction: text('direction').notNull().default('in'),
    /** Bank account (P5); null = cash in hand. */
    accountId: uuid('account_id'),
    chequeDate: date('cheque_date'),
    /** Discount allowed and TDS kept by the payer: they settle invoices alongside `amount`. */
    discountAmount: money('discount_amount').notNull().default(0),
    tdsAmount: money('tds_amount').notNull().default(0),
    /** receipt | invoice_inline | credit_note_refund */
    source: text('source').notNull().default('receipt'),
    /** The invoice an inline payment or refund belongs to. */
    invoiceId: uuid('invoice_id'),
    /** Receipt number (RCT series); '' for inline payments, which carry the invoice's number. */
    number: text('number').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.businessId],
      foreignColumns: [businesses.orgId, businesses.id],
    }),
    foreignKey({ columns: [t.orgId, t.partyId], foreignColumns: [parties.orgId, parties.id] }),
    index('payments_party_idx').on(t.orgId, t.partyId),
    index('payments_org_unique_id').on(t.orgId, t.id),
    index('payments_invoice_idx').on(t.orgId, t.invoiceId),
    foreignKey({ columns: [t.orgId, t.invoiceId], foreignColumns: [invoices.orgId, invoices.id] }),
  ],
);

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    ...base(),
    paymentId: uuid('payment_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    /** Phase 3: allocation to a purchase bill. */
    purchaseId: uuid('purchase_id'),
    amount: money('amount').notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.invoiceId], foreignColumns: [invoices.orgId, invoices.id] }),
    index('payment_allocations_payment_idx').on(t.orgId, t.paymentId),
    index('payment_allocations_invoice_idx').on(t.orgId, t.invoiceId),
  ],
);
