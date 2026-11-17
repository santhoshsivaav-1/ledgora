import { z } from 'zod';
import { isoDate, uuid } from './common.ts';

// Vyapar parity Phase 7 (Utilities): barcode labels (P7-S1), Tally export (P7-S2), Close financial year (P7-S3),
// backup and restore (P7-S4), the setup checklist (P7-S5) and bulk trash (P7-S6).

const businessQuery = z.object({ businessId: uuid });
export const utilityBusinessQuery = businessQuery;

// ---- P7-S1 ----
export const barcodeAssignInput = z.object({ itemIds: z.array(uuid).min(1).max(500) });
export const barcodeAssignResult = z.object({
  assigned: z.array(z.object({ id: uuid, code: z.string() })),
  alreadyHad: z.number().int(),
});

/** Bulk items from a spreadsheet (Barcode Generator): one row per item; a blank barcode gets the next in-store EAN-13. */
export const barcodeImportRow = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(60).nullish(),
  barcode: z.string().trim().max(40).nullish(),
  hsn: z.string().trim().max(10).default(''),
  unit: z.string().trim().max(10).default('PCS'),
  salePrice: z.number().min(0).default(0),
  mrp: z.number().min(0).nullish(),
  purchasePrice: z.number().min(0).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  openingStock: z.number().min(0).default(0),
});
export const barcodeImportInput = z.object({ rows: z.array(barcodeImportRow).min(1).max(500) });
export const barcodeImportResult = z.object({
  rows: z.array(
    z.object({
      index: z.number().int(),
      status: z.enum(['created', 'existing', 'error']),
      id: uuid.nullable(),
      code: z.string().nullable(),
      message: z.string().nullable(),
    }),
  ),
  created: z.number().int(),
  existing: z.number().int(),
  failed: z.number().int(),
  coded: z.number().int(),
});

// ---- P7-S2 ----
export const tallyMappingInput = z.record(z.string(), z.string().max(100));
export const tallyInclude = z.object({
  sales: z.boolean().default(true),
  salesReturns: z.boolean().default(true),
  purchases: z.boolean().default(true),
  purchaseReturns: z.boolean().default(true),
  cancelled: z.boolean().default(false),
  /** The optional extras: money received and paid, expenses and other income. */
  receipts: z.boolean().default(false),
  payments: z.boolean().default(false),
  expenses: z.boolean().default(false),
  /** Also read what the older screens saved (their bills, purchases, receipts, expenses), not only the typed tables. */
  screens: z.boolean().default(true),
});
export const tallyConfigInput = z.object({
  businessId: uuid,
  mapping: tallyMappingInput.default({}),
  include: tallyInclude.default({
    sales: true,
    salesReturns: true,
    purchases: true,
    purchaseReturns: true,
    cancelled: false,
    receipts: false,
    payments: false,
    expenses: false,
    screens: true,
  }),
});
export const tallyRangeQuery = z.object({ businessId: uuid, from: isoDate, to: isoDate });
export const tallyExportQuery = tallyRangeQuery.extend({ file: z.enum(['master', 'vouchers']) });

// ---- P7-S3 ----
export const FY_METHODS = ['prefix', 'new-year'] as const;
export const fyPreviewQuery = z.object({
  businessId: uuid,
  yearId: uuid,
  method: z.enum(FY_METHODS).default('new-year'),
  newPrefix: z.string().max(20).default(''),
  confirmText: z.string().max(20).default(''),
});
export const fyCloseInput = z.object({
  businessId: uuid,
  yearId: uuid,
  method: z.enum(FY_METHODS),
  newPrefix: z.string().max(20).default(''),
  confirmText: z.string().max(20),
});
export const fyReopenInput = z.object({
  businessId: uuid,
  yearId: uuid,
  reason: z.string().max(300),
});

// ---- P7-S4 ----
export const backupOut = z.object({
  id: uuid,
  kind: z.enum(['manual', 'auto', 'safety']),
  fileName: z.string(),
  sizeBytes: z.number().int(),
  encrypted: z.boolean(),
  /** none | password (the owner's) | server (scheduled backups: openable only on this server, from the history) */
  keyMode: z.enum(['none', 'password', 'server']),
  onDrive: z.boolean(),
  schemaVersion: z.number().int(),
  counts: z.record(z.string(), z.number()),
  createdAt: z.string(),
  note: z.string(),
});
export const backupCreateInput = z.object({
  password: z.string().min(8).max(200).optional(),
  note: z.string().max(200).default(''),
  /** Also save a copy to the connected Google Drive (ignored when none is connected). */
  toDrive: z.boolean().default(true),
});
export const backupSettingsDto = z.object({
  frequency: z.enum(['off', 'daily', 'weekly']),
  hour: z.number().int().min(0).max(23),
  keepLast: z.number().int().min(1).max(60),
  remind: z.boolean(),
  remindDays: z.number().int().min(1).max(90),
});
export const restoreInput = z.object({
  /** The .ledgora file, base64. Or the id of one in the history. */
  file: z.string().optional(),
  backupId: uuid.optional(),
  password: z.string().max(200).optional(),
  /** Without `RESTORE` only the preview is returned. */
  confirm: z.string().max(20).default(''),
});

// ---- P7-S6 ----
export const trashBulkInput = z.object({ ids: z.array(uuid).min(1).max(200) });
