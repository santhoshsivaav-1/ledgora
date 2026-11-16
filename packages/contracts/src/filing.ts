import { z } from 'zod';
import { uuid } from './common.ts';

// File-ready returns (docs/FILE_READY_PLAN.md, Phase 1): a filing pack is one return for one period in the portal's
// upload format. The app checks it, a CA may approve it, and a person uploads it on the portal and records the ARN.

// Same lists as FILING_KINDS / FILING_STATUSES in @ledgora/tax-engine (filing.ts); the API test checks they agree.
export const FILING_PACK_KINDS = [
  'gstr1',
  'gstr3b',
  'ims',
  'gstr1a',
  'gstr9',
  'cmp08',
  'gstr4',
  'gstr9c',
  'itr4',
] as const;
export const FILING_PACK_STATUSES = [
  'draft',
  'ready',
  'in_review',
  'changes_requested',
  'approved',
  'filed',
] as const;
export const filingKind = z.enum(FILING_PACK_KINDS);
export const filingStatus = z.enum(FILING_PACK_STATUSES);
/** The portal's return period, MMYYYY. */
export const retPeriod = z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/, 'Use MMYYYY, e.g. 102026');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const createFilingPackBody = z.object({
  businessId: uuid,
  kind: filingKind,
  period: retPeriod,
  /** QRMP: the pack covers the quarter ending in `period`. */
  quarterly: z.boolean().default(false),
  /** The return as the portal takes it. Up to 5 MB once serialised (checked by the route). */
  payload: z.record(z.string(), z.unknown()),
  /** Warning ids the person has read and accepts. */
  acknowledged: z.array(z.string().max(300)).max(2000).default([]),
  /** For GSTR-3B: ITC available in GSTR-2B (after IMS) by head, compared with what is claimed. */
  itc2b: z
    .object({
      iamt: z.number().optional(),
      camt: z.number().optional(),
      samt: z.number().optional(),
      csamt: z.number().optional(),
    })
    .nullish(),
  note: z.string().trim().max(1000).optional(),
});

export const filingPackQuery = z.object({
  businessId: uuid.optional(),
  kind: filingKind.optional(),
  status: filingStatus.optional(),
  /** Financial year start, e.g. 2026 for FY 2026-27. */
  fy: z.coerce.number().int().min(2017).max(2100).optional(),
});

export const acknowledgeBody = z.object({ acknowledged: z.array(z.string().max(300)).max(2000) });
export const reviewNoteBody = z.object({ note: z.string().trim().max(2000).optional() });
export const requestChangesBody = z.object({
  note: z.string().trim().min(3, 'Say what needs to change').max(2000),
});
export const commentBody = z.object({ body: z.string().trim().min(1).max(4000) });
export const recordFiledBody = z.object({
  /** GST ARN (15 characters). Not asked for IMS, which is acted on online. */
  arn: z.string().trim().toUpperCase().max(40).optional(),
  filedOn: isoDate,
  /** The acknowledgement PDF from the portal, uploaded through /v1/files first. */
  ackFileId: uuid.nullish(),
});
export const reopenBody = z.object({
  reason: z.string().trim().min(5, 'Give the reason for reopening').max(1000),
});
export const trackFromBody = z.object({
  businessId: uuid,
  /** YYYY-MM, or null for the default (the month before the business was added). */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
    .nullable(),
});
export const filingCalendarQuery = z.object({
  businessId: uuid,
  fy: z.coerce.number().int().min(2017).max(2100),
});

// ---- R1 builders (docs/FEATURE_GAPS_2026-11.md) --------------------------------------------------------------------
const heads = z.object({
  iamt: z.number().optional(),
  camt: z.number().optional(),
  samt: z.number().optional(),
  csamt: z.number().optional(),
});
/** X1: GSTR-1 or GSTR-3B built on the server from the business's documents. */
export const buildGstBody = z.object({
  businessId: uuid,
  kind: z.enum(['gstr1', 'gstr3b']),
  period: retPeriod,
  quarterly: z.boolean().default(false),
});
export const buildGstr1aBody = z.object({
  businessId: uuid,
  period: retPeriod,
  /** Today's GSTR-1 file for the period, from the GST Returns screen. */
  current: z.record(z.string(), z.unknown()),
});
export const buildGstr9Body = z.object({
  businessId: uuid,
  /** Financial year start: 2026 for FY 2026-27. */
  fy: z.number().int().min(2017).max(2100),
  /** ITC available in GSTR-2B for the whole year (Table 8A). */
  itc2b: heads.nullish(),
});
export const buildCmp08Body = z.object({
  businessId: uuid,
  /** The quarter's last month, MMYYYY. */
  period: retPeriod,
  /** Outward supplies of the quarter, exempt excluded. */
  turnover: z.number().min(0),
  rcm: heads.nullish(),
});
export const buildGstr4Body = z.object({
  businessId: uuid,
  fy: z.number().int().min(2017).max(2100),
});
export const buildGstr9cBody = z.object({
  businessId: uuid,
  fy: z.number().int().min(2017).max(2100),
  /** Why the books' turnover differs from the return; each amount is added to the books' turnover. */
  adjustments: z
    .array(z.object({ label: z.string().trim().min(2).max(200), amount: z.number() }))
    .max(50)
    .default([]),
});
/** GSTR-3B 3.1(a) as the portal shows it (auto-filled from GSTR-1/1A and locked). */
export const portal3bBody = z.object({
  txval: z.number().optional(),
  iamt: z.number().optional(),
  camt: z.number().optional(),
  samt: z.number().optional(),
  csamt: z.number().optional(),
});
