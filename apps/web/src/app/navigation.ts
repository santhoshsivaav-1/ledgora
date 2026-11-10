import type { ComponentType } from 'react';
import {
  Award,
  BarChart3,
  BookOpen,
  Calculator,
  ClipboardList,
  FileClock,
  FileMinus,
  FileText,
  HelpCircle,
  Home,
  Landmark,
  Package,
  PackageCheck,
  Receipt,
  RefreshCw,
  Settings,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Workflow,
  Wrench,
} from 'lucide-react';
import type { Permission } from '../lib/permissions';
import { SALES_PAGES } from '../features/sales/salesFlow';
import { DOCS_URL } from '../utils';
import { FEATURES } from '../config/featureFlags';
import { pathForView, viewFromPath } from './router';

// One source for the menus (Vyapar parity P0-S2): the new sidebar, its breadcrumbs, Open Anything and the page
// titles all read NAV. A leaf names the screen by its view id (app/router.tsx), so its address follows the shell.
//
// `planned` marks a screen a later phase builds (the value is the phase). It stays in the list so the target menu is
// written down in one place, but nothing shows it until the screen exists. The classic menu is buildClassicNav().

type Icon = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;

export interface NavLeaf {
  id: string;
  label: string;
  /** A view id from VIEW_ROUTES; its path is looked up, so it follows the shell. */
  view?: string;
  /** A fixed address, for pages that are not views of their own (/gst-returns/tds). */
  path?: string;
  /** Opens outside the app (the user guide). */
  href?: string;
  icon?: Icon;
  perm?: Permission;
  /** A Settings > Modules switch; off hides the entry, as in the classic menu. */
  module?: string;
  /** Also lit for any address under this prefix (Settings for every /settings/... tab). */
  match?: string;
  planned?: string;
  quickAdd?: string;
}

export interface NavGroup extends Omit<NavLeaf, 'view' | 'path' | 'href'> {
  children: NavLeaf[];
}

export type NavEntry = NavLeaf | NavGroup;

export const isGroup = (e: NavEntry): e is NavGroup => Array.isArray((e as NavGroup).children);

const SALES_ICONS: Record<string, Icon> = {
  'sales-quotes': ClipboardList,
  'sales-orders': PackageCheck,
  'sales-challans': Truck,
  'sales-invoices': FileText,
  'sales-proforma': FileClock,
  'sales-credit': FileMinus,
};

export const NAV: NavEntry[] = [
  { id: 'home', label: 'Home', icon: Home, view: 'dashboard' },
  {
    id: 'parties',
    label: 'Parties',
    icon: Users,
    module: 'clients',
    perm: 'party:read',
    children: [
      { id: 'parties-all', label: 'All Parties', view: 'clients' },
      { id: 'party-groups', label: 'Party Groups', path: '/parties/groups', planned: 'P1' },
      { id: 'parties-import', label: 'Import Parties', path: '/utilities/import-parties', planned: 'P1' },
    ],
  },
  {
    id: 'items',
    label: 'Items',
    icon: ShoppingBag,
    module: 'inventory',
    perm: 'item:read',
    children: [
      { id: 'items-all', label: 'All Items', view: 'inventory' },
      { id: 'item-categories', label: 'Categories', path: '/products/categories', planned: 'P1' },
      { id: 'item-units', label: 'Units', path: '/products/units', planned: 'P1' },
    ],
  },
  {
    id: 'sale',
    label: 'Sale',
    icon: Receipt,
    module: 'invoicing',
    perm: 'invoice:read',
    children: [
      { id: 'sale-overview', label: 'Overview', view: 'sales', icon: Workflow },
      ...SALES_PAGES.map((p: { id: string; label: string }) => ({
        id: p.id,
        label: p.id === 'sales-credit' ? 'Sale Return / Credit Note' : p.label,
        view: p.id,
        icon: SALES_ICONS[p.id],
      })),
      { id: 'payment-in', label: 'Payment In', view: 'receipts', icon: Receipt, module: 'receipts', perm: 'payment:read' },
      { id: 'recurring', label: 'Recurring', view: 'recurring', icon: RefreshCw, module: 'recurring', perm: 'recurring:read' },
    ],
  },
  {
    id: 'purchase',
    label: 'Purchase & Expense',
    icon: ShoppingCart,
    children: [
      { id: 'purchase-bills', label: 'Purchase Bills', view: 'purchases', module: 'purchases', perm: 'purchase:read' },
      { id: 'payment-out', label: 'Payment Out', path: '/purchases/payment-out', planned: 'P3' },
      { id: 'purchase-orders', label: 'Purchase Order', path: '/purchases/orders', planned: 'P3' },
      { id: 'purchase-returns', label: 'Purchase Return / Debit Note', path: '/purchases/returns', planned: 'P3' },
      { id: 'expenses', label: 'Expenses', view: 'expenses', module: 'expenses', perm: 'expense:read' },
      { id: 'other-income', label: 'Other Income', path: '/other-income', planned: 'P3' },
    ],
  },
  {
    id: 'grow',
    label: 'Grow Your Business',
    icon: TrendingUp,
    children: [
      { id: 'reminders', label: 'Payment Reminders', path: '/grow/reminders', planned: 'P9' },
      // The salesman master and its performance table (P2-S1) ship with the Phase 2 flag; visits/check-ins stay P9.
      {
        id: 'salesman',
        label: 'Salesman',
        view: 'salesman',
        perm: 'staff:read',
        ...(FEATURES.saleInlinePayments ? {} : { planned: 'P2' }),
      },
    ],
  },
  {
    id: 'cashbank',
    label: 'Cash & Bank',
    icon: Landmark,
    children: [
      { id: 'bank-accounts', label: 'Bank Accounts', path: '/cash-bank/accounts', planned: 'P5' },
      { id: 'cash-in-hand', label: 'Cash in Hand', path: '/cash-bank/cash', planned: 'P5' },
      { id: 'cheques', label: 'Cheques', path: '/cash-bank/cheques', planned: 'P5' },
      { id: 'loans', label: 'Loan Accounts', path: '/cash-bank/loans', planned: 'P5' },
    ],
  },
  { id: 'reports', label: 'Reports', icon: BarChart3, view: 'reports', module: 'reports', perm: 'report:read' },
  {
    id: 'taxes',
    label: 'Taxes',
    icon: Calculator,
    children: [
      { id: 'gst-returns', label: 'GST Returns', view: 'filing', icon: BookOpen, module: 'gstReturns', perm: 'report:read' },
      { id: 'tds-tcs', label: 'TDS / TCS', path: '/gst-returns/tds', module: 'gstReturns', perm: 'report:read' },
      { id: 'income-tax', label: 'Income Tax', view: 'incometax', module: 'incomeTax', perm: 'report:read' },
    ],
  },
  {
    id: 'sync',
    label: 'Sync, Share & Backup',
    icon: RefreshCw,
    children: [
      { id: 'backup', label: 'Backup & Restore', view: 'settings-data', perm: 'data:export' },
      { id: 'auto-backup', label: 'Auto Backup', path: '/backup', planned: 'P7' },
    ],
  },
  {
    id: 'utilities',
    label: 'Utilities',
    icon: Wrench,
    children: [
      { id: 'import-items', label: 'Import Items', path: '/utilities/import-items', planned: 'P1' },
      { id: 'bulk-update', label: 'Bulk Update', path: '/utilities/bulk-update', planned: 'P7' },
      { id: 'barcode', label: 'Barcode Generator', path: '/utilities/barcode', planned: 'P7' },
      { id: 'verify', label: 'Verify My Data', path: '/utilities/verify', planned: 'P4' },
      { id: 'tally', label: 'Export to Tally', path: '/utilities/tally', planned: 'P7' },
      { id: 'close-fy', label: 'Close Financial Year', path: '/utilities/close-fy', planned: 'P7' },
      { id: 'all-documents', label: 'All Documents', view: 'invoices', module: 'invoicing', perm: 'invoice:read' },
      { id: 'user-guide', label: 'User Guide', href: DOCS_URL, icon: HelpCircle },
    ],
  },
  { id: 'settings', label: 'Settings', icon: Settings, view: 'settings-business', match: '/settings' },
  { id: 'plans', label: 'Plans & Pricing', icon: Award, path: '/plans', planned: 'P8' },
];

export const leafPath = (leaf: NavLeaf) => leaf.path ?? (leaf.view ? pathForView(leaf.view) : '/');

interface VisibleOptions {
  can: (p: Permission) => boolean;
  moduleOn: (moduleId: string) => boolean;
}

const leafVisible = (leaf: NavLeaf | NavGroup, { can, moduleOn }: VisibleOptions) =>
  !leaf.planned && (!leaf.perm || can(leaf.perm)) && (!leaf.module || moduleOn(leaf.module));

/**
 * The menu this member sees: planned screens, entries their role may not open and switched-off modules removed. A
 * group left with one entry becomes that entry under the group's name and icon, so nobody opens a menu to find a
 * single item in it; an empty group disappears.
 */
export function visibleNav(nav: NavEntry[], opts: VisibleOptions): NavEntry[] {
  const out: NavEntry[] = [];
  for (const entry of nav) {
    if (!leafVisible(entry, opts)) continue;
    if (!isGroup(entry)) {
      out.push(entry);
      continue;
    }
    const children = entry.children.filter((c) => leafVisible(c, opts));
    if (children.length === 0) continue;
    if (children.length === 1) out.push({ ...children[0], id: entry.id, label: entry.label, icon: entry.icon });
    else out.push({ ...entry, children });
  }
  return out;
}

const clean = (p: string) => p.replace(/\/+$/, '') || '/';

/**
 * The menu entry for an address, and the group it sits in, for highlighting and breadcrumbs. An exact address wins
 * (/gst-returns/tds is TDS / TCS, not GST Returns); otherwise the entry for the same screen.
 */
export function findNavEntry(nav: NavEntry[], pathname: string, viewId = viewFromPath(pathname)) {
  const here = clean(pathname);
  let byView: { leaf: NavLeaf; group: NavGroup | null } | null = null;
  let byPrefix: { leaf: NavLeaf; group: NavGroup | null } | null = null;
  const visit = (leaf: NavLeaf, group: NavGroup | null) => {
    if (leaf.href) return null;
    if (clean(leafPath(leaf)) === here) return { leaf, group };
    // viewFromPath() answers 'dashboard' for any address it does not know; only / itself is Home.
    const known = viewId !== 'dashboard' || here === '/';
    if (!byView && known && leaf.view && leaf.view === viewId && !leaf.path) byView = { leaf, group };
    if (!byPrefix && leaf.match && (here === leaf.match || here.startsWith(`${leaf.match}/`))) byPrefix = { leaf, group };
    return null;
  };
  for (const entry of nav) {
    if (isGroup(entry)) {
      for (const c of entry.children) {
        const hit = visit(c, entry);
        if (hit) return hit;
      }
    } else {
      const hit = visit(entry, null);
      if (hit) return hit;
    }
  }
  return (byView ?? byPrefix) as { leaf: NavLeaf; group: NavGroup | null } | null;
}

/** "Sale › Invoices" for the top bar; a top-level page is just its name. */
export function routeTitle(pathname: string, nav: NavEntry[] = NAV) {
  const hit = findNavEntry(nav, pathname);
  if (!hit) return null;
  return { group: hit.group?.label ?? null, label: hit.leaf.label };
}

/** Every screen in the menu as a flat list, for Open Anything. */
export function navScreens(nav: NavEntry[]) {
  return nav.flatMap((e) =>
    isGroup(e)
      ? e.children.map((c) => ({ leaf: c, crumb: `${e.label} › ${c.label}` }))
      : [{ leaf: e, crumb: e.label }],
  );
}

// ---- The classic menu (moved here from App.jsx, unchanged) ----

interface ClassicNavOptions {
  showIfModule: (moduleId: string) => boolean;
  openDocs: () => void;
}

/** The sidebar of the classic look, item for item what App.jsx built before. */
export function buildClassicNav({ showIfModule, openDocs }: ClassicNavOptions) {
  // Sell is one menu with a page per stage of the sales flow (change: sales modules). Recurring and Receipts sit
  // with it because they are the later steps of a sale.
  const salesChildren = [
    { id: 'sales', icon: Workflow, label: 'Overview', module: 'invoicing' },
    ...SALES_PAGES.map((p: { id: string; label: string }) => ({
      id: p.id,
      icon: SALES_ICONS[p.id],
      label: p.label,
      module: 'invoicing',
    })),
    { id: 'receipts', icon: Receipt, label: 'Receipts', module: 'receipts' },
    { id: 'recurring', icon: RefreshCw, label: 'Recurring', module: 'recurring' },
  ].filter((item) => showIfModule(item.module));
  return [
    { id: 'dashboard', icon: Home, label: 'Dashboard', module: 'dashboard' },
    { id: 'sales-menu', icon: FileText, label: 'Sales', module: 'dashboard', children: salesChildren },
    { id: 'clients', icon: Users, label: 'Clients', module: 'clients' },
    { id: 'inventory', icon: Package, label: 'Products', module: 'inventory' },
    { id: 'expenses', icon: Wallet, label: 'Expenses', module: 'expenses' },
    { id: 'purchases', icon: ShoppingCart, label: 'Purchases', module: 'purchases' },
    { id: 'reports', icon: BarChart3, label: 'Reports', module: 'reports' },
    { id: 'filing', icon: BookOpen, label: 'GST Returns', module: 'gstReturns' },
    { id: 'incometax', icon: Calculator, label: 'Income Tax', module: 'incomeTax' },
    // v1.10.75 - opens the online documentation, which covers every screen
    // and stays current; the old built-in guide had fallen far behind.
    { id: 'guide', icon: HelpCircle, label: 'User Guide', module: 'dashboard', onClick: openDocs }, // gated by dashboard so it's always available
  ].filter((item) => showIfModule(item.module) && (!item.children || item.children.length > 0));
}
