import { SALES_PAGES } from '../features/sales/salesFlow';
import { setUiMode } from './uiMode';

// What the Ctrl+K palette offers (moved out of App.jsx unchanged, Vyapar parity P0-S2): actions, the classic
// menu's screens, invoices, clients, products and Settings sections. Open Anything reuses it in the new shell.
export function buildPaletteActions({ navItems, handleNewInvoice, handleEditInvoice, setCurrentView, toggleDark, setShowShortcutsHelp, searchCorpus }) {
  const acts = [
    {
      label: 'New Invoice',
      hint: 'Ctrl+N',
      category: 'action',
      run: () => {
        handleNewInvoice();
      },
    },
  ];
  navItems
    .flatMap((item) => item.children || [item])
    .forEach((item) => {
      acts.push({
        label: item.id === 'sales' ? 'Go to Sales overview' : `Go to ${item.label}`,
        hint: '',
        category: 'nav',
        run: item.onClick || (() => setCurrentView(item.id)),
      });
    });
  SALES_PAGES.forEach((p) =>
    acts.push({
      label: `New ${p.singular}`,
      hint: '',
      category: 'action',
      run: () => handleNewInvoice(p.newType),
    }),
  );
  acts.push({
    label: 'Go to Settings',
    hint: '',
    category: 'nav',
    run: () => setCurrentView('settings'),
  });
  acts.push({ label: 'Toggle dark mode', hint: '', category: 'action', run: toggleDark });
  acts.push({ label: 'Try the new layout (beta)', hint: '', category: 'action', run: () => setUiMode('vyapar') });
  acts.push({
    label: 'Show keyboard shortcuts',
    hint: 'Ctrl+/',
    category: 'help',
    run: () => setShowShortcutsHelp(true),
  });
  // v1.9.4 — cross-app search: invoices, clients, products
  // v1.10.5 — audit H24 fix. Prior code dispatched
  // `CustomEvent('fgsb-open-bill', { detail: b.id })` but no one
  // listened for it — selecting an invoice in the palette silently
  // dropped the ID and just landed on Dashboard. Now: reuse
  // handleEditInvoice() directly, which is already the canonical way
  // to open a bill for editing (works from Dashboard row-click too).
  searchCorpus.bills.forEach((b) => {
    acts.push({
      label: `📄 ${b.invoiceNumber || 'INV-?'} — ${b.clientName || 'No client'}`,
      hint: b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '',
      category: 'invoice',
      run: () => handleEditInvoice(b),
    });
  });
  searchCorpus.clients.forEach((c) => {
    acts.push({
      label: `👤 ${c.name} — client${c.gstin ? ' · GSTIN: ' + c.gstin : ''}`,
      hint: c.phone || c.email || '',
      category: 'client',
      run: () => setCurrentView('clients'),
    });
  });
  searchCorpus.products.forEach((p) => {
    acts.push({
      label: `📦 ${p.name} — product${p.hsn ? ' · HSN: ' + p.hsn : ''}`,
      hint: (p.stock ?? 0) + ' in stock',
      category: 'product',
      run: () => setCurrentView('inventory'),
    });
  });
  // Settings sections (jump to specific area)
  // v1.10.74 - these all used to just open Settings at the top. Each now
  // names its section id; after Settings mounts (it's lazy-loaded, so retry
  // briefly) we click that section's "Jump to" chip, which already scrolls
  // below the sticky bars.
  const openSettingsAt = (sectionId) => {
    setCurrentView('settings');
    let tries = 0;
    const jump = () => {
      const chip = document.querySelector(`.settings-jumpnav a[href="#${sectionId}"]`);
      if (chip && document.getElementById(sectionId)) chip.click();
      else if (++tries < 30) setTimeout(jump, 100);
    };
    setTimeout(jump, 50);
  };
  const settingsJumps = [
    ['Company profile', 'section-company'],
    ['Payment accounts', 'section-company'],
    ['Print & PDF Settings', 'section-print'],
    ['PDF Style Editor', 'section-print'],
    ['Business type presets', 'section-print'],
    ['Section labels', 'section-print'],
    ['Watermarks', 'section-print'],
    ['Multi-copy print', 'section-print'],
    ['Digital signature', 'section-company'],
    ['Company letterhead', 'section-print'],
    ['Modules', 'section-modules'],
    ['Region preference', 'section-region'],
    ['Google Drive backup', 'section-cloud'],
  ];
  settingsJumps.forEach(([s, sectionId]) => {
    acts.push({
      label: `⚙️ Settings → ${s}`,
      hint: '',
      category: 'settings',
      run: () => openSettingsAt(sectionId),
    });
  });
  return acts;
}
