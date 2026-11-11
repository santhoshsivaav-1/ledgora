// Vyapar parity P6-S1: the report registry. A report is a definition with an id, its own query parameters (zod) and a
// `run` that reads the books and returns { rows, totals, meta }. modules/reports.ts serves every registered report at
// GET /v1/reports/:id and lists them at GET /v1/reports, so adding a report means adding a definition, not a route.
import { z } from 'zod';
import type { Tx } from '@ledgora/db';
import { isoDate, uuid } from '@ledgora/contracts';

export const REPORT_GROUPS = [
  'transaction',
  'party',
  'gst',
  'item',
  'expense',
  'cashbank',
  'orders',
  'incometax',
  'financial',
] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

/** Parameters every report takes: the business and, for period reports, the dates (inclusive). */
export const commonParams = z.object({
  businessId: uuid,
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export interface ReportResult {
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  meta?: Record<string, unknown>;
}

export interface ReportDef<P extends z.ZodType = z.ZodType> {
  id: string;
  title: string;
  group: ReportGroup;
  description: string;
  /** Shows profit: needs `report:profit` (the "hide profit reports" role switch). */
  profit?: boolean;
  /** Needs the ledger on for the business (reads ledger_entries). */
  ledger?: boolean;
  params: P;
  run: (tx: Tx, p: z.infer<P>, ctx: { orgId: string }) => Promise<ReportResult>;
}

const REGISTRY = new Map<string, ReportDef>();

/** Registers a report. A second definition with the same id replaces the first (tests use this for a toy report). */
export function defineReport<P extends z.ZodType>(def: ReportDef<P>) {
  REGISTRY.set(def.id, def as unknown as ReportDef);
  return def;
}
export const reportDef = (id: string) => REGISTRY.get(id);
export const reportDefs = () => [...REGISTRY.values()];
