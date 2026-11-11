// Running a report by id: parameters checked by its own schema, the business loaded, the ledger required when the report
// reads it. The HTTP route, the CSV export and the scheduled e-mail all come through here.
import type { Tx } from '@ledgora/db';
import { AppError, notFound, validationError } from '../errors.ts';
import { loadBusiness } from '../modules/businesses.ts';
import { ledgerEnabled } from '../modules/ledgerRules.ts';
import { reportDef, type ReportResult } from './registry.ts';
import './core.ts';
import './documents.ts';
import './party.ts';
import './stock.ts';
import './gst.ts';
import './misc.ts';

export async function runReport(
  tx: Tx,
  orgId: string,
  id: string,
  query: Record<string, string | undefined>,
) {
  const def = reportDef(id);
  if (!def) throw notFound('Report');
  const parsed = def.params.safeParse(query);
  if (!parsed.success) throw validationError(parsed.error);
  const businessId = (parsed.data as { businessId: string }).businessId;
  await loadBusiness(tx, businessId);
  if (def.ledger && !(await ledgerEnabled(tx, businessId)))
    throw new AppError(
      'conflict',
      'This report reads the ledger. Turn the ledger on in Accounting first.',
    );
  const r: ReportResult = await def.run(tx, parsed.data, { orgId });
  return { def, result: r, businessId };
}
