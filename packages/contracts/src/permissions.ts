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
  'staff:read',
  'staff:write',
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
  // Vyapar parity Phase 6: reports that show profit (P&L, Balance Sheet); the "hide profit reports" role switch.
  'report:profit',
  // Vyapar parity Phase 4: the books. Reading them, posting a manual journal, switching the ledger on / closing a year
  // / locking a period, and running Verify My Data.
  'ledger:read',
  'journal:write',
  'accounting:manage',
  'verify:run',
  // Vyapar parity Phase 5: Cash & Bank (bank accounts, cash, transfers, cheques, loans, reconciliation).
  'cashbank:read',
  'cashbank:write',
  // Vyapar parity Phase 9: the message log, payment and service reminders; sending a document or a reminder.
  'message:read',
  'message:write',
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
  'ca',
  'salesman',
  'biller',
  'stock_keeper',
  'viewer',
] as const;
export type Role = (typeof ROLES)[number];
/** A role an organization made on Account Access: 'custom_' and a short slug. */
export const CUSTOM_ROLE_RE = /^custom_[a-z0-9_]{2,30}$/;
export const isCustomRole = (r: string) => CUSTOM_ROLE_RE.test(r);
const customRole = z.string().regex(CUSTOM_ROLE_RE, 'Not a role');
export const role = z.union([z.enum(ROLES), customRole]);
/** Any role but the owner (what an invitation or a role change may give). */
export const assignableRole = z.union([z.enum(ROLES).exclude(['owner']), customRole]);
/** The slug for a new custom role's name: "Counter staff" -> "custom_counter_staff". */
export const customRoleKey = (label: string) =>
  `custom_${
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'role'
  }`;

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  accountant: 'Accountant',
  ca: 'CA (read-only)',
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
    'journal:write',
    'verify:run',
    'cashbank:write',
    'report:profit',
    'message:write',
  ],
  // P7-S6 Share with CA: sees the books, reports and exports; can not create, edit or delete anything.
  ca: [...bookReads, 'audit:read', 'data:export', 'report:profit'],
  salesman: [
    'invoice:read',
    'invoice:write',
    'party:read',
    'party:write',
    'item:read',
    'payment:read',
    'payment:write',
    'message:write',
    // To pick themselves on an invoice; what they see of invoices is scoped to their own (P2-S1).
    'staff:read',
    'template:read',
    'recurring:read',
    'file:read',
    'file:write',
    'business:read',
  ],
  biller: [
    'message:write',
    'invoice:read',
    'invoice:write',
    'party:read',
    'party:write',
    'item:read',
    'staff:read',
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
  // The workspace documents the billing screens use (change 3.23): each collection follows the permission of its screen.
  const ws = /^\/v1\/workspace\/(?:collections\/)?([a-z-]+)/.exec(path);
  if (ws) {
    const part = ws[1];
    if (part === 'meta')
      return /\/increment$/.test(path) ? 'invoice:write' : read ? null : 'settings:write';
    if (part === 'local-prefs') return null;
    if (part === 'export') return 'data:export';
    if (part === 'import') return 'data:import';
    if (part === 'trash') return 'trash:manage';
    if (part === 'number-series') return 'settings:write';
    if (part === 'profile' || part === 'profiles') return read ? 'business:read' : 'business:write';
    const byCollection: Record<string, string> = {
      bills: 'invoice',
      clients: 'party',
      products: 'item',
      expenses: 'expense',
      purchases: 'purchase',
      receipts: 'payment',
      recurring: 'recurring',
      templates: 'template',
    };
    const resource = byCollection[part];
    if (resource) return `${resource}:${read ? 'read' : 'write'}` as Permission;
  }
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
  // Vyapar parity Phase 4 / 10: the books, Verify My Data and the TDS ledger.
  if (/^\/v1\/(accounts|ledger|financial-years)/.test(path))
    return read ? 'ledger:read' : 'accounting:manage';
  if (/^\/v1\/journals/.test(path)) return read ? 'ledger:read' : 'journal:write';
  if (/^\/v1\/accounting/.test(path)) return read ? 'ledger:read' : 'accounting:manage';
  if (/^\/v1\/verify/.test(path)) return 'verify:run';
  // Phase 6: exporting a report is exporting data; running, starring and saving views is reading.
  if (/^\/v1\/reports\/[a-z0-9-]+\/export/.test(path)) return 'data:export';
  if (/^\/v1\/reports(\/|$)/.test(path)) return 'report:read';
  // Phase 5: switching Cash & Bank on is an accounting decision; using it is its own permission.
  if (/^\/v1\/cashbank\/settings/.test(path)) return read ? 'cashbank:read' : 'accounting:manage';
  if (/^\/v1\/(cashbank|bank-accounts|cash|transfers|cheques|loans)(\/|$)/.test(path))
    return read ? 'cashbank:read' : 'cashbank:write';
  // Phase 8: the registry-driven settings. Reading is business data; changing is a setting (owner-only keys are enforced
  // again in the handler).
  if (/^\/v1\/settings(\/|$)/.test(path)) return read ? 'business:read' : 'settings:write';
  // Phase 9: the message log and reminders are read with message:read; sending, sharing, queueing and the service list
  // are message:write. A salesman's own consent and check-ins are open to any member (the handler needs a linked staff row).
  if (/^\/v1\/visits(\/|$)/.test(path)) return null;
  if (/^\/v1\/(messaging|messages|document-links|reminders|service-reminders)(\/|$)/.test(path))
    return read ? 'message:read' : 'message:write';
  // Phase 12 (POS): its settings are a setting; the counter's lookups and bills are invoices.
  if (/^\/v1\/pos\/settings/.test(path)) return read ? 'invoice:read' : 'settings:write';
  // Phase 7: barcodes edit items; Tally is an export; Close FY is an accounting decision; backups are exports, restoring
  // and the schedule are settings (and restore is owner-only in the handler); the setup card reads business data.
  if (/^\/v1\/utilities\/barcodes/.test(path)) return 'item:write';
  if (/^\/v1\/utilities\/tally/.test(path)) return 'data:export';
  if (/^\/v1\/utilities\/fy-/.test(path)) return read ? 'ledger:read' : 'accounting:manage';
  if (/^\/v1\/backups\/drive/.test(path)) return 'settings:write';
  if (/^\/v1\/backups\/(restore|settings)/.test(path))
    return read ? 'data:export' : 'settings:write';
  if (/^\/v1\/backups/.test(path)) return m === 'delete' ? 'settings:write' : 'data:export';
  if (/^\/v1\/setup/.test(path)) return read ? 'business:read' : 'business:write';
  if (/^\/v1\/tds/.test(path)) return read ? 'payment:read' : 'payment:write';
  const table: [RegExp, string][] = [
    [/^\/v1\/(invoices|pos)/, 'invoice'],
    [/^\/v1\/(parties|party-groups)/, 'party'],
    [/^\/v1\/(items|units)/, 'item'],
    [/^\/v1\/payments/, 'payment'],
    [/^\/v1\/staff/, 'staff'],
    [/^\/v1\/(purchases|purchase-orders|suppliers)/, 'purchase'],
    [/^\/v1\/(expenses|expense-categories|expense-items)/, 'expense'],
    [/^\/v1\/recurring/, 'recurring'],
    [/^\/v1\/templates/, 'template'],
    [/^\/v1\/files/, 'file'],
    [/^\/v1\/eway-bills/, 'invoice'],
  ];
  for (const [re, r] of table) if (re.test(path)) return resource(r);
  return null;
}

/** The matrix on the Account Access screen: every permission under the part of the product it belongs to. */
export const PERMISSION_GROUPS: readonly {
  id: string;
  label: string;
  permissions: readonly { key: Permission; label: string }[];
}[] = [
  {
    id: 'sale',
    label: 'Sale',
    permissions: [
      { key: 'invoice:read', label: 'View invoices, quotations, orders, POS bills' },
      { key: 'invoice:write', label: 'Create, edit and delete them' },
      { key: 'invoice:cancel', label: 'Cancel an invoice' },
      { key: 'payment:read', label: 'View payments in and out' },
      { key: 'payment:write', label: 'Record, edit and delete payments' },
    ],
  },
  {
    id: 'parties',
    label: 'Parties',
    permissions: [
      { key: 'party:read', label: 'View customers and suppliers' },
      { key: 'party:write', label: 'Add, edit and delete them' },
      { key: 'staff:read', label: 'View salesmen' },
      { key: 'staff:write', label: 'Manage salesmen, targets and visits' },
    ],
  },
  {
    id: 'items',
    label: 'Items and stock',
    permissions: [
      { key: 'item:read', label: 'View items' },
      { key: 'item:write', label: 'Add, edit and delete items' },
      { key: 'stock:adjust', label: 'Adjust stock' },
    ],
  },
  {
    id: 'purchase',
    label: 'Purchase and expenses',
    permissions: [
      { key: 'purchase:read', label: 'View purchases and orders' },
      { key: 'purchase:write', label: 'Create, edit and delete them' },
      { key: 'expense:read', label: 'View expenses and other income' },
      { key: 'expense:write', label: 'Add, edit and delete them' },
    ],
  },
  {
    id: 'cashbank',
    label: 'Cash & Bank',
    permissions: [
      { key: 'cashbank:read', label: 'View bank accounts, cheques, loans' },
      { key: 'cashbank:write', label: 'Add and change them, reconcile' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    permissions: [
      { key: 'ledger:read', label: 'View the ledger and trial balance' },
      { key: 'journal:write', label: 'Post manual journals' },
      { key: 'verify:run', label: 'Run Verify My Data' },
      { key: 'accounting:manage', label: 'Switch the ledger on, lock periods, close a year' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    permissions: [
      { key: 'report:read', label: 'View reports' },
      { key: 'report:profit', label: 'View profit reports (P&L, balance sheet)' },
      { key: 'data:export', label: 'Export reports and data' },
    ],
  },
  {
    id: 'grow',
    label: 'Messages and reminders',
    permissions: [
      { key: 'message:read', label: 'View the message log and reminders' },
      { key: 'message:write', label: 'Send documents and reminders' },
    ],
  },
  {
    id: 'other',
    label: 'Templates, files and recurring',
    permissions: [
      { key: 'template:read', label: 'View terms templates' },
      { key: 'template:write', label: 'Edit them' },
      { key: 'recurring:read', label: 'View recurring invoices' },
      { key: 'recurring:write', label: 'Create and change them' },
      { key: 'file:read', label: 'View attachments' },
      { key: 'file:write', label: 'Upload attachments' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings and utilities',
    permissions: [
      { key: 'business:read', label: 'View business details' },
      { key: 'business:write', label: 'Edit business details and banks' },
      { key: 'settings:write', label: 'Change settings, backups, number series' },
      { key: 'data:import', label: 'Import data' },
      { key: 'trash:manage', label: 'Restore or delete from Trash' },
      { key: 'audit:read', label: 'View the audit log' },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    permissions: [
      { key: 'team:read', label: 'View team members' },
      { key: 'team:manage', label: 'Invite, change and remove members' },
    ],
  },
];

/**
 * A role's permission list as saved: unknown keys dropped, and a "write" always brings its "read" (a screen that can
 * change something has to be able to open it). `billing:manage` is the owner's alone.
 */
export function normalizePermissions(list: readonly string[]): Permission[] {
  const set = new Set<string>(list.filter((p) => (PERMISSIONS as readonly string[]).includes(p)));
  set.delete('billing:manage');
  for (const p of [...set]) {
    if (p.endsWith(':write')) set.add(p.replace(':write', ':read'));
  }
  // These two writes have no matching read of their own.
  if (set.has('journal:write')) set.add('ledger:read');
  if (set.has('accounting:manage')) set.add('ledger:read');
  if (set.has('stock:adjust')) set.add('item:read');
  if (set.has('invoice:cancel')) set.add('invoice:read');
  if (set.has('report:profit')) set.add('report:read');
  return PERMISSIONS.filter((p) => set.has(p));
}

export const rolePermissionsBody = z.object({
  permissions: z.array(z.string()).max(PERMISSIONS.length),
  /** Sees and changes only the documents they created. */
  ownOnly: z.boolean().optional(),
  /** Never sees purchase prices. */
  hideCost: z.boolean().optional(),
  label: z.string().trim().min(2).max(40).optional(),
});
export const createRoleBody = z.object({
  label: z.string().trim().min(2, 'Give the role a name').max(40),
  /** A preset or custom role to start from. */
  copyFrom: z.string().default('viewer'),
});
