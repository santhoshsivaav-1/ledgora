/* eslint-disable @typescript-eslint/no-explicit-any --
   Loose on purpose: invoices, line items, clients and business profiles are free-form bags in the
   legacy app. They get exact types when the Zod contracts land in Phase 1 (change 1.13). */

/** A loosely typed record (invoice, line item, party, business profile, settings). */
export type Rec = Record<string, any>;

/** A number that may arrive from a form as a string, or be missing. */
export type Numeric = number | string | null | undefined;
