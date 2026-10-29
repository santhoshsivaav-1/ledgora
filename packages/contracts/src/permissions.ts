import { z } from 'zod';

/**
 * What a member may do (change 2.8). A permission is `<resource>:<action>`. Routes name the one they need
 * (apps/api/src/middleware/permission.ts derives it from the path) and a role is just a list of them.
 */
export const PERMISSIONS = [
  'invoice:read',
  'invoice:write',
  'invoice:cancel',
  'party:read',
  'party:write',
  'item:read',
  'item:write',
  'stock:adjust',
  'payment:read',
  'payment:write',
  'purchase:read',
  'purchase:write',
  'expense:read',
  'expense:write',
  'recurring:read',
  'recurring:write',
  'template:read',
  'template:write',
  'file:read',
  'file:write',
  'report:read',
  'business:read',
  'business:write',
  'settings:write',
  'trash:manage',
  'data:import',
  'data:export',
  'team:read',
  'team:manage',
  'audit:read',
  'billing:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'owner',
  'admin',
  'accountant',
  'salesman',
  'biller',
  'stock_keeper',
  'viewer',
] as const;
export type Role = (typeof ROLES)[number];
export const role = z.enum(ROLES);

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  accountant: 'Accountant',
  salesman: 'Salesman',
  biller: 'Biller',
  stock_keeper: 'Stock keeper',
  viewer: 'Viewer',
};

const reads = PERMISSIONS.filter((p) => p.endsWith(':read'));
// A viewer sees the books, not who changed them or who is on the team.
const bookReads = reads.filter((p) => p !== 'audit:read' && p !== 'team:read');
const except = (...drop: Permission[]) => PERMISSIONS.filter((p) => !drop.includes(p));

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  // Everything except paying for the plan.
  admin: except('billing:manage'),
  accountant: [
    ...reads,
    'payment:write',
    'purchase:write',
    'expense:write',
    'invoice:cancel',
    'data:export',
    'audit:read',
    'team:read',
  ],
  salesman: [
    'invoice:read',
    'invoice:write',
    'party:read',
    'party:write',
    'item:read',
    'payment:read',
    'payment:write',
    'template:read',
    'recurring:read',
    'file:read',
    'file:write',
    'business:read',
  ],
  biller: [
    'invoice:read',
    'invoice:write',
    'party:read',
    'party:write',
    'item:read',
    'template:read',
    'file:read',
    'file:write',
    'business:read',
  ],
  stock_keeper: [
    'item:read',
    'item:write',
    'stock:adjust',
    'purchase:read',
    'purchase:write',
    'party:read',
    'file:read',
    'file:write',
    'business:read',
  ],
  viewer: bookReads,
};

export const can = (r: string, p: Permission) => (ROLE_PERMISSIONS[r as Role] ?? []).includes(p);

/** The permission a request needs, from its method and path. `null` = any signed-in member. */
export function permissionFor(method: string, path: string): Permission | null {
  const m = method.toLowerCase();
  const read = m === 'get';
  const resource = (r: string): Permission => `${r}:${read ? 'read' : 'write'}` as Permission;
  if (/^\/v1\/invoices\/[^/]+\/cancel$/.test(path)) return 'invoice:cancel';
  if (/^\/v1\/items\/[^/]+\/stock$/.test(path)) return 'stock:adjust';
  if (/^\/v1\/number-series/.test(path)) return read ? 'invoice:read' : 'settings:write';
  if (/^\/v1\/businesses\/[^/]+\/settings/.test(path))
    return read ? 'business:read' : 'settings:write';
  if (/^\/v1\/onboarding/.test(path)) return read ? 'business:read' : 'business:write';
  if (/^\/v1\/(businesses|payment-accounts)/.test(path))
    return read ? 'business:read' : 'business:write';
  if (/^\/v1\/trash/.test(path)) return 'trash:manage';
  if (/^\/v1\/import/.test(path)) return 'data:import';
  if (/^\/v1\/export/.test(path)) return 'data:export';
  if (/^\/v1\/jobs/.test(path)) return null;
  if (/^\/v1\/(members|invitations)/.test(path)) return read ? 'team:read' : 'team:manage';
  if (/^\/v1\/audit/.test(path)) return 'audit:read';
  const table: [RegExp, string][] = [
    [/^\/v1\/invoices/, 'invoice'],
    [/^\/v1\/parties/, 'party'],
    [/^\/v1\/(items|units)/, 'item'],
    [/^\/v1\/payments/, 'payment'],
    [/^\/v1\/(purchases)/, 'purchase'],
    [/^\/v1\/(expenses|expense-categories)/, 'expense'],
    [/^\/v1\/recurring/, 'recurring'],
    [/^\/v1\/templates/, 'template'],
    [/^\/v1\/files/, 'file'],
  ];
  for (const [re, r] of table) if (re.test(path)) return resource(r);
  return null;
}
