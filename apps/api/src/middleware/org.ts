import type { Context } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { schema, withTenant, type Database } from '@ledgora/db';
import { ROLES, type Role } from '@ledgora/contracts';
import { AppError } from '../errors.ts';
import type { AuthContext, OrgContext } from './context.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Second link (change 2.7, 2.9): which organization the request acts in, and as which member.
 * The organization is the session's active one; an `x-org-id` header may name another organization, but only one the
 * user belongs to. Members limited to some businesses get their list here, and withTenant() turns it into the
 * app.business_ids setting that the RLS business_scope policies read.
 */
export async function requireOrg(c: Context, db: Database, auth: AuthContext): Promise<OrgContext> {
  const asked = c.req.header('x-org-id');
  if (asked && !UUID.test(asked)) throw new AppError('bad_request', 'x-org-id must be a UUID');
  let orgId = asked?.toLowerCase() ?? auth.activeOrganizationId;
  if (!orgId) {
    // A session that has not picked an organization yet (just signed up, or removed from the one it used) works in the
    // user's oldest membership: their own workspace.
    const [first] = await db
      .select({ orgId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, auth.user.id))
      .orderBy(asc(schema.member.createdAt))
      .limit(1);
    orgId = first?.orgId ?? null;
  }
  if (!orgId) throw new AppError('forbidden', 'This account has no organization yet');
  const [m] = await db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.userId, auth.user.id), eq(schema.member.organizationId, orgId)));
  // Same answer for "no such organization" and "not yours": do not confirm that an id exists.
  if (!m || !(ROLES as readonly string[]).includes(m.role))
    throw new AppError('forbidden', 'You are not a member of this organization');
  const role = m.role as Role;
  let businessIds: string[] | null = null;
  if (role !== 'owner') {
    const rows = await withTenant(db, orgId, (tx) =>
      tx
        .select({ businessId: schema.memberBusinesses.businessId })
        .from(schema.memberBusinesses)
        .where(eq(schema.memberBusinesses.memberId, m.id)),
    );
    if (rows.length) businessIds = rows.map((r) => r.businessId);
  }
  return { ...auth, orgId, memberId: m.id, role, businessIds };
}
