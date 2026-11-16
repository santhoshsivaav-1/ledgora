import { z } from 'zod';
import { uuid } from './common.ts';

// R4.1 (docs/FEATURE_GAPS_2026-11.md): the fixed-asset register. Requests only; the depreciation is the engine's
// (packages/tax-engine/src/depreciation.ts).

const fy = z.string().regex(/^\d{4}-\d{2}$/, 'Use a financial year like 2025-26');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rupees = z.number().finite().min(0).max(99_999_999_999);

export const ASSET_BLOCKS = [
  'LAND',
  'BLD5',
  'BLD10',
  'BLD40',
  'FF10',
  'PM15',
  'PM30',
  'PM40',
  'PM45',
  'INT25',
  'SHIP20',
] as const;
export const assetBlock = z.enum(ASSET_BLOCKS);

const disposal = z.object({
  date: isoDate,
  proceeds: rupees,
  expenses: rupees.default(0),
});

export const fixedAssetBody = z.object({
  businessId: uuid,
  name: z.string().trim().min(1).max(120),
  block: assetBlock,
  cost: z.number().finite().positive().max(99_999_999_999),
  putToUse: isoDate,
  lifeYears: z.number().int().min(1).max(100).nullable().default(null),
  residualPct: z.number().min(0).max(100).nullable().default(null),
  note: z.string().trim().max(300).default(''),
  disposal: disposal.nullable().default(null),
});
export const fixedAssetPatch = fixedAssetBody.omit({ businessId: true }).partial();
export const fixedAssetQuery = z.object({ businessId: uuid });

export const assetOpeningBody = z.object({
  businessId: uuid,
  /** The year whose 1 April this written-down value belongs to. */
  fy,
  block: assetBlock,
  wdv: rupees,
  trackedAll: z.boolean().default(false),
});
export const assetOpeningQuery = z.object({ businessId: uuid });
export const assetScheduleQuery = z.object({ businessId: uuid, fy });

/** Post the year's depreciation from the register as a journal; asking again for the same year replaces it. */
export const assetDepreciationBody = z.object({ businessId: uuid, fy });
