import { sql } from 'drizzle-orm';
import type { Database } from './client.ts';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside one transaction that can only see `orgId`'s rows (change 1.12).
 *
 * `SET LOCAL ROLE app_user` drops to the role without BYPASSRLS (owners and superusers would skip the policies),
 * and `set_config('app.org_id', ..., true)` is what the tenant_isolation policy compares `org_id` to. Both are
 * transaction-local, so a pooled connection can never carry one tenant's setting into the next request.
 */
export interface TenantOptions {
  /** Limits the transaction to these businesses (change 2.9). null or empty = every business of the organization. */
  businessIds?: string[] | null;
  /** Who is acting and from where; audit rows pick these up (change 2.14). */
  actorId?: string | null;
  ip?: string | null;
}

export async function withTenant<T>(
  db: Database,
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: TenantOptions = {},
): Promise<T> {
  if (!UUID.test(orgId)) throw new Error('withTenant: orgId must be a UUID');
  const businessIds = opts.businessIds?.length ? opts.businessIds : [];
  if (!businessIds.every((b) => UUID.test(b)))
    throw new Error('withTenant: businessIds must be UUIDs');
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role app_user`);
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(sql`select set_config('app.business_ids', ${businessIds.join(',')}, true)`);
    await tx.execute(sql`select set_config('app.actor_id', ${opts.actorId ?? ''}, true)`);
    await tx.execute(sql`select set_config('app.ip', ${opts.ip ?? ''}, true)`);
    return fn(tx);
  });
}
