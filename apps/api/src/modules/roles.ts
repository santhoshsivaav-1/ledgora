// Account Access (P8-S13): what each role may do in this organization. The built-in presets are the starting point;
// the owner can change a preset's permissions, make roles of their own (copied from any role), and give any non-owner
// role two rules: "own transactions only" and "hide purchase prices". The owner role is fixed.
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@ledgora/db';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  createRoleBody,
  customRoleKey,
  isCustomRole,
  normalizePermissions,
  rolePermissionsBody,
  type Role,
} from '@ledgora/contracts';
import { audit } from '../audit.ts';
import { AppError, notFound } from '../errors.ts';
import type { Registrar } from '../http.ts';
import { forgetRoles } from '../middleware/permission.ts';

const { rolePermissions, member, invitation } = schema;
const isPreset = (r: string): r is Role => (ROLES as readonly string[]).includes(r);
const ownerOnly = (role: string) => {
  if (role !== 'owner') throw new AppError('forbidden', 'Only the owner can change roles');
};

/** Is `role` one an organization may hand out: a preset other than owner, or one of its own custom roles. */
export async function roleExists(tx: Tx, role: string) {
  if (isPreset(role)) return true;
  if (!isCustomRole(role)) return false;
  const [row] = await tx
    .select({ id: rolePermissions.id })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.role, role), isNull(rolePermissions.deletedAt)));
  return !!row;
}

export function rolesModule({ route }: Registrar) {
  route({
    method: 'get',
    path: '/v1/roles',
    tag: 'Team',
    summary:
      'Every role, preset and custom, with its permissions, rules and the preset it started from',
    permission: 'team:read',
    handler: async ({ tx }) => {
      const rows = await tx.select().from(rolePermissions).where(isNull(rolePermissions.deletedAt));
      const own = new Map(rows.map((r) => [r.role, r]));
      const view = (role: string, label: string, preset: readonly string[]) => {
        const r = own.get(role);
        return {
          role,
          label: r?.label || label,
          editable: role !== 'owner',
          custom: isCustomRole(role),
          customised: !!r && !isCustomRole(role),
          permissions:
            role === 'owner' ? [...PERMISSIONS] : ((r?.permissions as string[]) ?? [...preset]),
          preset: [...preset],
          ownOnly: !!r?.ownOnly,
          hideCost: !!r?.hideCost,
        };
      };
      return {
        groups: PERMISSION_GROUPS,
        roles: [
          ...ROLES.map((r) => view(r, ROLE_LABELS[r], ROLE_PERMISSIONS[r])),
          ...rows
            .filter((r) => isCustomRole(r.role))
            .map((r) => view(r.role, r.label || r.role, [])),
        ],
      };
    },
  });

  route({
    method: 'post',
    path: '/v1/roles',
    tag: 'Team',
    summary:
      'Make a role of your own, starting from the permissions and rules of another (owner only)',
    permission: 'team:manage',
    body: createRoleBody,
    handler: async ({ tx, orgId, auth, body }) => {
      ownerOnly(auth.role);
      const key = customRoleKey(body.label);
      if (await roleExists(tx, key))
        throw new AppError('conflict', 'A role with this name already exists');
      const [src] = await tx
        .select()
        .from(rolePermissions)
        .where(and(eq(rolePermissions.role, body.copyFrom), isNull(rolePermissions.deletedAt)));
      const base =
        (src?.permissions as string[] | undefined) ??
        (isPreset(body.copyFrom) && body.copyFrom !== 'owner'
          ? [...ROLE_PERMISSIONS[body.copyFrom]]
          : []);
      const permissions = normalizePermissions(base);
      await tx.delete(rolePermissions).where(eq(rolePermissions.role, key)); // a deleted role of the same name
      await tx.insert(rolePermissions).values({
        orgId,
        role: key,
        label: body.label,
        permissions,
        ownOnly: !!src?.ownOnly,
        hideCost: !!src?.hideCost,
      });
      await audit(tx, orgId, 'role.create', 'role', null, {
        after: { role: key, label: body.label },
      });
      forgetRoles(orgId);
      return { role: key, label: body.label, permissions };
    },
  });

  route({
    method: 'put',
    path: '/v1/roles/:role',
    tag: 'Team',
    summary:
      'Set the permissions and rules of a role (owner only; takes effect on the next request)',
    permission: 'team:manage',
    params: z.object({ role: z.string() }),
    body: rolePermissionsBody,
    handler: async ({ tx, orgId, auth, params, body }) => {
      ownerOnly(auth.role);
      if (params.role === 'owner' || !(await roleExists(tx, params.role)))
        throw new AppError('forbidden', 'The owner role always has every permission');
      const permissions = normalizePermissions(body.permissions);
      const set = {
        permissions,
        ...(body.ownOnly !== undefined ? { ownOnly: body.ownOnly } : {}),
        ...(body.hideCost !== undefined ? { hideCost: body.hideCost } : {}),
        ...(body.label && isCustomRole(params.role) ? { label: body.label } : {}),
      };
      await tx
        .insert(rolePermissions)
        .values({ orgId, role: params.role, ...set })
        .onConflictDoUpdate({
          target: [rolePermissions.orgId, rolePermissions.role],
          set: { ...set, updatedAt: new Date(), deletedAt: null },
        });
      await audit(tx, orgId, 'role.change', 'role', null, {
        after: {
          role: params.role,
          permissions: permissions.length,
          ownOnly: body.ownOnly,
          hideCost: body.hideCost,
        },
      });
      forgetRoles(orgId);
      return { role: params.role, permissions, ownOnly: !!body.ownOnly, hideCost: !!body.hideCost };
    },
  });

  route({
    method: 'delete',
    path: '/v1/roles/:role',
    tag: 'Team',
    summary:
      'Reset a preset to its built-in permissions, or delete a custom role nobody has (owner only)',
    permission: 'team:manage',
    params: z.object({ role: z.string() }),
    handler: async ({ tx, orgId, auth, params, deps }) => {
      ownerOnly(auth.role);
      if (params.role === 'owner') throw new AppError('forbidden', 'The owner role is fixed');
      if (isCustomRole(params.role)) {
        if (!(await roleExists(tx, params.role))) throw notFound('Role');
        const [used] = await deps.db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.organizationId, orgId), eq(member.role, params.role)))
          .limit(1);
        const [invited] = await deps.db
          .select({ id: invitation.id })
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, orgId),
              eq(invitation.role, params.role),
              or(eq(invitation.status, 'pending')),
            ),
          )
          .limit(1);
        if (used || invited)
          throw new AppError(
            'conflict',
            'Someone has this role (or an invitation for it). Give them another role first',
          );
      } else if (!isPreset(params.role)) throw notFound('Role');
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.orgId, orgId), eq(rolePermissions.role, params.role)));
      await audit(
        tx,
        orgId,
        isCustomRole(params.role) ? 'role.delete' : 'role.reset',
        'role',
        null,
        {
          after: { role: params.role },
        },
      );
      forgetRoles(orgId);
      return {
        role: params.role,
        permissions: isPreset(params.role) ? [...ROLE_PERMISSIONS[params.role]] : [],
      };
    },
  });
}
