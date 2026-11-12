// Account Access matrix (P8-S13): what each role may do in this organization. The built-in presets are the starting
// point; the owner can change a role's permission list, and "Reset" goes back to the preset. The owner role is fixed.
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@ledgora/db';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  normalizePermissions,
  rolePermissionsBody,
  type Role,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { forgetRoles } from '../middleware/permission.ts';

const { rolePermissions } = schema;
const editable = (r: string): r is Role =>
  (ROLES as readonly string[]).includes(r) && r !== 'owner';

export function rolesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/roles',
    tag: 'Team',
    summary:
      "Every role with its permissions (the organization's own list where it has changed one) and the preset",
    permission: 'team:read',
    handler: async ({ tx }) => {
      const rows = await tx.select().from(rolePermissions);
      const own = new Map(rows.map((r) => [r.role, r.permissions as string[]]));
      return {
        groups: PERMISSION_GROUPS,
        roles: ROLES.map((r) => ({
          role: r,
          label: ROLE_LABELS[r],
          editable: r !== 'owner',
          customised: own.has(r),
          permissions: r === 'owner' ? [...PERMISSIONS] : (own.get(r) ?? [...ROLE_PERMISSIONS[r]]),
          preset: [...ROLE_PERMISSIONS[r]],
        })),
      };
    },
  });

  route({
    method: 'put',
    path: '/v1/roles/:role',
    tag: 'Team',
    summary: 'Set the permissions of a role (owner only; takes effect on the next request)',
    permission: 'team:manage',
    params: z.object({ role: z.string() }),
    body: rolePermissionsBody,
    handler: async ({ tx, orgId, auth, params, body }) => {
      if (auth.role !== 'owner') throw new AppError('forbidden', 'Only the owner can change roles');
      if (!editable(params.role))
        throw new AppError('forbidden', 'The owner role always has every permission');
      const permissions = normalizePermissions(body.permissions);
      await tx
        .insert(rolePermissions)
        .values({ orgId, role: params.role, permissions })
        .onConflictDoUpdate({
          target: [rolePermissions.orgId, rolePermissions.role],
          set: { permissions, updatedAt: new Date(), deletedAt: null },
        });
      await audit(tx, orgId, 'role.change', 'role', null, {
        after: { role: params.role, permissions: permissions.length },
      });
      forgetRoles(orgId);
      return { role: params.role, permissions };
    },
  });

  route({
    method: 'delete',
    path: '/v1/roles/:role',
    tag: 'Team',
    summary: 'Put a role back to its built-in preset (owner only)',
    permission: 'team:manage',
    params: z.object({ role: z.string() }),
    handler: async ({ tx, orgId, auth, params }) => {
      if (auth.role !== 'owner') throw new AppError('forbidden', 'Only the owner can change roles');
      if (!editable(params.role)) throw new AppError('forbidden', 'The owner role is fixed');
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.orgId, orgId), eq(rolePermissions.role, params.role)));
      await audit(tx, orgId, 'role.reset', 'role', null, { after: { role: params.role } });
      forgetRoles(orgId);
      return { role: params.role, permissions: [...ROLE_PERMISSIONS[params.role]] };
    },
  });
}
