// The app's URLs (change 3.1). Each screen has a path, so refresh, back/forward and copied links all land where
// they should; before this the screen was a state variable and every reload went back to the dashboard.

export interface ViewRoute {
  id: string;
  path: string;
  title: string;
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
  { id: 'clients', path: '/clients', title: 'Clients' },
  { id: 'inventory', path: '/products', title: 'Products' },
  { id: 'expenses', path: '/expenses', title: 'Expenses' },
  { id: 'purchases', path: '/purchases', title: 'Purchases' },
  { id: 'recurring', path: '/recurring', title: 'Recurring' },
  { id: 'receipts', path: '/receipts', title: 'Receipts' },
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

export const pathForView = (id: string) => BY_ID.get(id)?.path ?? '/';

/** The view id for a URL path. Unknown paths answer 'dashboard' so a mistyped URL still opens the app. */
export function viewFromPath(pathname: string) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean.startsWith('/gst-returns')) return 'filing'; // GST returns has one address per page
  for (const r of VIEW_ROUTES) {
    const pattern = new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`);
    if (pattern.test(clean)) return r.id;
  }
  return 'dashboard';
}

/** Old shortcut links used /?view=new; map them onto the new URLs. */
export function legacyViewRedirect(pathname: string, search: string) {
  if (pathname !== '/') return null;
  const v = new URLSearchParams(search).get('view');
  return v && BY_ID.has(v) ? pathForView(v) : null;
}
