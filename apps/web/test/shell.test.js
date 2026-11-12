import { describe, expect, it } from 'vitest';
import {
  NAV,
  visibleNav,
  findNavEntry,
  routeTitle,
  navScreens,
  leafPath,
  isGroup,
  buildClassicNav,
} from '../src/app/navigation';
import { VIEW_ROUTES, canonicalPath, viewFromPath, pathsForView } from '../src/app/router';
import { rankActions, scoreLabel } from '../src/app/openAnythingRank';
import { fyLabel, fyOptions, fyRange, fyStartYear } from '../src/app/fiscalYear';

// Vyapar parity Phase 0, P0-S2: the new shell's menu, addresses and Open Anything.

const allowAll = { can: () => true, moduleOn: () => true };
const leaves = (nav) => nav.flatMap((e) => (isGroup(e) ? e.children : [e]));

describe('navigation (one source for the new menu)', () => {
  it('every visible entry opens a screen that exists', () => {
    for (const leaf of leaves(visibleNav(NAV, allowAll))) {
      if (leaf.href) continue;
      if (leaf.view) expect(VIEW_ROUTES.some((r) => r.id === leaf.view)).toBe(true);
      // the address resolves back to a real view (or the GST returns pages, which share one)
      const path = leafPath(leaf);
      expect(path.startsWith('/')).toBe(true);
      if (leaf.view) expect(viewFromPath(path)).toBe(leaf.view);
    }
  });

  it('hides planned screens, then entries the role may not open, then switched-off modules', () => {
    const visibleIds = leaves(visibleNav(NAV, allowAll)).map((l) => l.id);
    expect(visibleIds).not.toContain('party-groups');
    expect(visibleIds).toEqual(expect.arrayContaining(['reminders', 'catalog'])); // Grow has two screens now
    expect(visibleIds).toContain('cheques'); // shipped in Phase 5
    const noPurchases = visibleNav(NAV, {
      can: (p) => p !== 'purchase:read',
      moduleOn: () => true,
    });
    expect(leaves(noPurchases).map((l) => l.id)).not.toContain('purchase-bills');
    const noReports = visibleNav(NAV, { can: () => true, moduleOn: (m) => m !== 'reports' });
    expect(noReports.map((e) => e.id)).not.toContain('reports');
  });

  it('turns a group with one visible screen into a plain entry and drops empty groups', () => {
    const nav = visibleNav(NAV, allowAll);
    const parties = nav.find((e) => e.id === 'parties');
    expect(isGroup(parties)).toBe(false); // only All Parties exists before Phase 1
    expect(parties.label).toBe('Parties');
    expect(parties.view).toBe('clients');
    // Cash & Bank shipped in Phase 5: one screen, a tab per entry, all behind cashbank:read.
    const cb = nav.find((e) => e.id === 'cashbank');
    expect(cb.children.map((c) => c.id)).toEqual(['bank-accounts', 'cash-in-hand', 'transfers', 'cheques', 'loans', 'reconcile']);
    expect(leaves(visibleNav(NAV, { can: (p) => p !== 'cashbank:read', moduleOn: () => true })).map((l) => l.id)).not.toContain('cheques');
    expect(isGroup(nav.find((e) => e.id === 'sale'))).toBe(true);
  });

  it('lights the entry for the current address, exact address first', () => {
    const nav = visibleNav(NAV, allowAll);
    // Phase 5 / 6: a Cash & Bank tab and any report light their own entries, not Dashboard.
    expect(findNavEntry(nav, '/cash-bank/cheques').leaf.id).toBe('cheques');
    expect(findNavEntry(nav, '/reports/day-book').leaf.id).toBe('reports');
    expect(viewFromPath('/reports/balance-sheet')).toBe('reports');
    expect(viewFromPath('/cash-bank/loans')).toBe('cashbank');
    expect(findNavEntry(nav, '/gst-returns/tds').leaf.id).toBe('tds-tcs');
    expect(findNavEntry(nav, '/gst-returns/gstr3b').leaf.id).toBe('gst-returns');
    expect(findNavEntry(nav, '/settings/documents').leaf.id).toBe('settings');
    // the editor lights the sales page of the document in it (App passes that view id)
    expect(findNavEntry(nav, '/invoices/new', 'sales-quotes').leaf.id).toBe('sales-quotes');
    expect(routeTitle('/sales/invoices', nav)).toEqual({ group: 'Sale', label: 'Invoices' });
    expect(findNavEntry(nav, '/dev/ui')).toBeNull(); // an address outside the menu lights nothing
    expect(findNavEntry(nav, '/').leaf.id).toBe('home');
  });

  it('lists every screen for Open Anything with its breadcrumb', () => {
    const crumbs = navScreens(visibleNav(NAV, allowAll)).map((s) => s.crumb);
    expect(crumbs).toContain('Sale › Payment In');
    expect(crumbs).toContain('Taxes › TDS / TCS');
    expect(crumbs).toContain('Home');
  });

  it('keeps the classic menu exactly as App.jsx built it', () => {
    const classic = buildClassicNav({ showIfModule: () => true, openDocs: () => {} });
    expect(classic.map((i) => i.id)).toEqual([
      'dashboard',
      'sales-menu',
      'clients',
      'inventory',
      'expenses',
      'purchases',
      'reports',
      'filing',
      'incometax',
      'guide',
    ]);
    expect(classic[1].children.map((c) => c.id)).toEqual([
      'sales',
      'sales-quotes',
      'sales-orders',
      'sales-challans',
      'sales-invoices',
      'sales-proforma',
      'sales-credit',
      'receipts',
      'recurring',
    ]);
    const noRecurring = buildClassicNav({
      showIfModule: (m) => m !== 'recurring',
      openDocs: () => {},
    });
    expect(noRecurring[1].children.map((c) => c.id)).not.toContain('recurring');
  });
});

describe('addresses in both shells', () => {
  it('opens a screen on either of its addresses', () => {
    expect(viewFromPath('/parties')).toBe('clients');
    expect(viewFromPath('/clients')).toBe('clients');
    expect(viewFromPath('/sales/payment-in')).toBe('receipts');
    expect(pathsForView('clients')).toEqual(['/clients', '/parties']);
  });

  it('moves the address bar to the current shell’s address', () => {
    expect(canonicalPath('/clients', true)).toBe('/parties');
    expect(canonicalPath('/parties', true)).toBeNull();
    expect(canonicalPath('/parties', false)).toBe('/clients');
    expect(canonicalPath('/receipts', true)).toBe('/sales/payment-in');
    expect(canonicalPath('/inventory', false)).toBe('/products');
    expect(canonicalPath('/sales/invoices', true)).toBeNull();
  });
});

describe('Open Anything ranking', () => {
  const acts = [
    'Sale › Invoices',
    'Sale › Payment In',
    'Parties',
    'Reports',
    '📄 INV-12 — Ravi Traders',
  ].map((label) => ({ label }));

  it('scores prefix over word start over letters in order', () => {
    expect(scoreLabel('Payment In', 'pay')).toBe(3);
    expect(scoreLabel('Sale › Payment In', 'pay')).toBe(2);
    expect(scoreLabel('Payment In', 'pyin')).toBe(1);
    expect(scoreLabel('Reports', 'xyz')).toBe(0);
    expect(scoreLabel('📄 INV-12 — Ravi Traders', 'inv-12')).toBe(3); // the emoji marker is ignored
  });

  it('ranks, and puts recents first when nothing is typed', () => {
    expect(rankActions(acts, 'pa').map((a) => a.label)).toEqual(['Parties', 'Sale › Payment In']);
    const empty = rankActions(acts, '', ['Reports']);
    expect(empty[0]).toMatchObject({ label: 'Reports', recent: true });
    expect(empty).toHaveLength(acts.length);
  });
});

describe('financial year', () => {
  it('starts in April by default', () => {
    expect(fyStartYear(new Date(2026, 2, 31))).toBe(2025);
    expect(fyStartYear(new Date(2026, 3, 1))).toBe(2026);
    expect(fyLabel(2026)).toBe('FY 2026-27');
    expect(fyRange(2026)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(fyRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(fyLabel(2026, 1)).toBe('FY 2026');
  });

  it('offers this year and the five before it', () => {
    const opts = fyOptions(new Date(2026, 10, 8));
    expect(opts.map((o) => o.start)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });
});
