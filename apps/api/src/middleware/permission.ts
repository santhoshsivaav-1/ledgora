import { can, permissionFor, type Permission } from '@ledgora/contracts';
import { AppError } from '../errors.ts';
import type { OrgContext } from './context.ts';

/** Third link: the member's role must allow what this route does. A route may name its permission or let the path decide. */
export function requirePermission(
  ctx: OrgContext,
  method: string,
  path: string,
  explicit?: Permission | null,
) {
  const needed = explicit === undefined ? permissionFor(method, path) : explicit;
  if (needed && !can(ctx.role, needed))
    throw new AppError('forbidden', `Your role (${ctx.role}) can not do this`, { needs: needed });
}
