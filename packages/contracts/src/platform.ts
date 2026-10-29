import { z } from 'zod';
import { uuid } from './common.ts';

export const TRASH_ENTITIES = [
  'invoice',
  'party',
  'item',
  'purchase',
  'expense',
  'recurring',
  'template',
] as const;
export const TRASH_RETENTION_DAYS = 30;

export const trashEntry = z.object({
  id: uuid,
  entityType: z.enum(TRASH_ENTITIES),
  label: z.string(),
  deletedAt: z.string(),
  purgeAt: z.string(),
});
export type TrashEntry = z.infer<typeof trashEntry>;
export const trashQuery = z.object({ type: z.enum(TRASH_ENTITIES).optional() });

export const job = z.object({
  id: uuid,
  kind: z.enum(['import.legacy', 'export.full']),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  progress: z.number().int(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type Job = z.infer<typeof job>;

/** The folder shapes of the old single-user app (data/*.json), as the importer receives them. */
export const legacyBundle = z.object({
  profile: z.record(z.string(), z.unknown()).optional(),
  profiles: z.array(z.record(z.string(), z.unknown())).optional(),
  clients: z.array(z.record(z.string(), z.unknown())).optional(),
  products: z.array(z.record(z.string(), z.unknown())).optional(),
  bills: z.array(z.record(z.string(), z.unknown())).optional(),
  receipts: z.array(z.record(z.string(), z.unknown())).optional(),
  purchases: z.array(z.record(z.string(), z.unknown())).optional(),
  expenses: z.array(z.record(z.string(), z.unknown())).optional(),
  recurring: z.array(z.record(z.string(), z.unknown())).optional(),
  templates: z.array(z.record(z.string(), z.unknown())).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type LegacyBundle = z.infer<typeof legacyBundle>;

export const health = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.boolean(),
  version: z.string(),
  uptimeSeconds: z.number(),
});
