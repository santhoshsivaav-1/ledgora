import { isVyaparUi } from './uiMode';

// The app's URLs (change 3.1). Each screen has a path, so refresh, back/forward and copied links all land where
// they should; before this the screen was a state variable and every reload went back to the dashboard.
//
// Vyapar parity P0-S2: a screen can also have `vyaparPath`, its address in the new shell (/parties for Clients). Both
// addresses always open the screen; canonicalPath() moves the address bar to the one the current shell uses, so a
// bookmark from either look keeps working.

export interface ViewRoute {
  id: string;
  path: string;
  title: string;
  vyaparPath?: string;
}

export const VIEW_ROUTES: ViewRoute[] = [
  { id: 'dashboard', path: '/', title: 'Dashboard' },
  { id: 'sales', path: '/sales', title: 'Sales overview' },
  { id: 'sales-quotes', path: '/sales/quotations', title: 'Quotations' },
  { id: 'sales-orders', path: '/sales/orders', title: 'Sales orders' },
  { id: 'sales-challans', path: '/sales/challans', title: 'Delivery challans' },
  { id: 'sales-invoices', path: '/sales/invoices', title: 'Invoices' },
  { id: 'sales-proforma', path: '/sales/proforma', title: 'Proforma' },
  { id: 'sales-credit', path: '/sales/credit-notes', title: 'Credit notes' },
  { id: 'invoices', path: '/invoices', title: 'All documents' },
  { id: 'new', path: '/invoices/new', title: 'New invoice' },
  { id: 'clients', path: '/clients', title: 'Clients', vyaparPath: '/parties' },
  { id: 'inventory', path: '/products', title: 'Products' },
  { id: 'expenses', path: '/expenses', title: 'Expenses' },
  { id: 'purchases', path: '/purchases', title: 'Purchases' },
  { id: 'recurring', path: '/recurring', title: 'Recurring' },
  { id: 'receipts', path: '/receipts', title: 'Receipts', vyaparPath: '/sales/payment-in' },
  { id: 'salesman', path: '/grow/salesman', title: 'Salesman' },
  { id: 'reports', path: '/reports', title: 'Reports' },
  { id: 'filing', path: '/gst-returns', title: 'GST returns' },
  { id: 'incometax', path: '/income-tax', title: 'Income tax' },
  { id: 'settings', path: '/settings', title: 'Settings' },
  { id: 'settings-business', path: '/settings/business', title: 'Business settings' },
  { id: 'settings-documents', path: '/settings/documents', title: 'Invoice and print settings' },
  { id: 'settings-features', path: '/settings/features', title: 'Features and stock' },
  { id: 'settings-data', path: '/settings/data', title: 'Data' },
  { id: 'team', path: '/settings/team', title: 'Team' },
  { id: 'security', path: '/settings/security', title: 'Security' },
  { id: 'accept-invite', path: '/accept-invite/:id', title: 'Invitation' },
];

const BY_ID = new Map(VIEW_ROUTES.map((r) => [r.id, r]));

const routePath = (r: ViewRoute | undefined, vyapar = isVyaparUi()) => (r ? (vyapar && r.vyaparPath) || r.path : '/');

export const pathForView = (id: string) => routePath(BY_ID.get(id));

const matches = (path: string, clean: string) => new RegExp(`^${path.replace(/:[^/]+/g, '[^/]+')}$`).test(clean);

/** The view id for a URL path. Unknown paths answer 'dashboard' so a mistyped URL still opens the app. */
export function viewFromPath(pathname: string) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean.startsWith('/gst-returns')) return 'filing'; // GST returns has one address per page
  for (const r of VIEW_ROUTES) {
    if (matches(r.path, clean) || (r.vyaparPath && matches(r.vyaparPath, clean))) return r.id;
  }
  return 'dashboard';
}

/** Old addresses that moved for good. They redirect in both looks. */
export const LEGACY_REDIRECTS: Record<string, string> = { '/inventory': '/products' };

/**
 * Where the address bar should be for this path in the current look, or null when it already is: /clients becomes
 * /parties in the new shell and /parties becomes /clients in the classic one.
 */
export function canonicalPath(pathname: string, vyapar = isVyaparUi()) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (LEGACY_REDIRECTS[clean]) return LEGACY_REDIRECTS[clean];
  const r = VIEW_ROUTES.find((v) => v.vyaparPath && (v.path === clean || v.vyaparPath === clean));
  if (!r) return null;
  const want = routePath(r, vyapar);
  return want === clean ? null : want;
}

/** Every address a view answers on, for registering routes. */
export const pathsForView = (id: string) => {
  const r = BY_ID.get(id);
  return r ? [r.path, ...(r.vyaparPath ? [r.vyaparPath] : [])] : [];
};

/** Old shortcut links used /?view=new; map them onto the new URLs. */
export function legacyViewRedirect(pathname: string, search: string) {
  if (pathname !== '/') return null;
  const v = new URLSearchParams(search).get('view');
  return v && BY_ID.has(v) ? pathForView(v) : null;
}
