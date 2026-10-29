import type { Tx } from '@ledgora/db';
import { schema } from '@ledgora/db';

/** One audit row, written in the same transaction as the change it describes. */
export async function audit(
  tx: Tx,
  orgId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: { before?: unknown; after?: unknown } = {},
) {
  await tx.insert(schema.auditLog).values({
    orgId,
    action,
    entityType,
    entityId,
    before: detail.before ?? null,
    after: detail.after ?? null,
  });
}
