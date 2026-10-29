import type { Tx } from '@ledgora/db';
import { sql } from 'drizzle-orm';
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
    // Who and from where: withTenant() set these for the transaction (change 2.14).
    actorId: sql`nullif(current_setting('app.actor_id', true), '')`,
    ip: sql`nullif(current_setting('app.ip', true), '')`,
    action,
    entityType,
    entityId,
    before: detail.before ?? null,
    after: detail.after ?? null,
  });
}
