import { can, ROLE_LABELS, type Permission, type Role } from '@ledgora/contracts';

// The web app and the API read the same permission table (packages/contracts/src/permissions.ts). The API is the
// real gate; this only decides what to SHOW, so a button the user may not press is hidden or locked instead of
// failing with a 403 after the click.
export { can, ROLE_LABELS };
export type { Permission, Role };

export const roleCan = (role: string | undefined | null, permission: Permission) => !!role && can(role, permission);
