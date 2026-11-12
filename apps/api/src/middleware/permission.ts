import { ROLE_PERMISSIONS, permissionFor, type Permission, type Role } from '@ledgora/contracts';
import { schema, withTenant, type Database } from '@ledgora/db';
import { AppError } from '../errors.ts';
import type { OrgContext } from './context.ts';

// Third link: the member's role must allow what this route does. The role's permissions are the organization's own list
// (Account Access) when it has one, else the built-in preset; a custom role has only its own list. Two rules ride along
// on the context for the handlers that apply them: ownOnly (only the documents the member made) and hideCost (no
// purchase prices). Cached for 30 seconds per organization and dropped at once when a role changes on this server.

const TTL = 30_000;
export interface RoleRules {
  permissions: readonly Permission[];
  ownOnly: boolean;
  hideCost: boolean;
  label: string | null;
}
const cache = new Map<string, { at: number; roles: Map<string, RoleRules> }>();
export const forgetRoles = (orgId: string) => cache.delete(orgId);

async function rolesOf(db: Database, orgId: string) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL) return hit.roles;
  const rows = await withTenant(db, orgId, (tx) => tx.select().from(schema.rolePermissions));
  const roles = new Map(
    rows.map((r) => [
      r.role,
      {
        permissions: r.permissions as Permission[],
        ownOnly: r.ownOnly,
        hideCost: r.hideCost,
        label: r.label ?? null,
      },
    ]),
  );
  cache.set(orgId, { at: Date.now(), roles });
  return roles;
}

/** What a role may do in an organization right now, and its two rules. */
export async function rulesOfRole(db: Database, orgId: string, role: string): Promise<RoleRules> {
  if (role === 'owner')
    return { permissions: ROLE_PERMISSIONS.owner, ownOnly: false, hideCost: false, label: null };
  const own = (await rolesOf(db, orgId)).get(role);
  if (own) return own;
  return {
    permissions: ROLE_PERMISSIONS[role as Role] ?? [],
    ownOnly: false,
    hideCost: false,
    label: null,
  };
}
export const permissionsOfRole = async (db: Database, orgId: string, role: string) =>
  (await rulesOfRole(db, orgId, role)).permissions;

/** A route may name its permission or let the path decide. Also puts the role's rules on the context. */
export async function requirePermission(
  db: Database,
  ctx: OrgContext,
  method: string,
  path: string,
  explicit?: Permission | null,
) {
  const rules = await rulesOfRole(db, ctx.orgId, ctx.role);
  ctx.ownOnly = rules.ownOnly;
  ctx.hideCost = rules.hideCost;
  const needed = explicit === undefined ? permissionFor(method, path) : explicit;
  if (needed && !rules.permissions.includes(needed))
    throw new AppError('forbidden', `Your role can not do this`, { needs: needed });
}
