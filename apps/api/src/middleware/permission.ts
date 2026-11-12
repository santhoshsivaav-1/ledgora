import { ROLE_PERMISSIONS, permissionFor, type Permission, type Role } from '@ledgora/contracts';
import { schema, withTenant, type Database } from '@ledgora/db';
import { AppError } from '../errors.ts';
import type { OrgContext } from './context.ts';

// Third link: the member's role must allow what this route does. The role's permissions are the organization's own list
// (Account Access matrix) when it has changed one, else the built-in preset. The lookup is cached for 30 seconds per
// organization and dropped at once when a role is changed on this server, so a change applies on the next request.

const TTL = 30_000;
const cache = new Map<string, { at: number; roles: Map<string, readonly Permission[]> }>();
export const forgetRoles = (orgId: string) => cache.delete(orgId);

async function rolesOf(db: Database, orgId: string) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL) return hit.roles;
  const rows = await withTenant(db, orgId, (tx) => tx.select().from(schema.rolePermissions));
  const roles = new Map(rows.map((r) => [r.role, r.permissions as Permission[]]));
  cache.set(orgId, { at: Date.now(), roles });
  return roles;
}

/** What a role may do in an organization right now. */
export async function permissionsOfRole(db: Database, orgId: string, role: string) {
  if (role === 'owner') return ROLE_PERMISSIONS.owner;
  return (await rolesOf(db, orgId)).get(role) ?? ROLE_PERMISSIONS[role as Role] ?? [];
}

/** A route may name its permission or let the path decide. */
export async function requirePermission(
  db: Database,
  ctx: OrgContext,
  method: string,
  path: string,
  explicit?: Permission | null,
) {
  const needed = explicit === undefined ? permissionFor(method, path) : explicit;
  if (!needed) return;
  if (!(await permissionsOfRole(db, ctx.orgId, ctx.role)).includes(needed))
    throw new AppError('forbidden', `Your role (${ctx.role}) can not do this`, { needs: needed });
}
