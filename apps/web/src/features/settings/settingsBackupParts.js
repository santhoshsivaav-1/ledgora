// Export / Import (granular)
export const ALL_BACKUP_PARTS = [
  { id: 'profile',        label: 'Active business profile',  hint: 'Name, address, GSTIN, bank, logo, signature' },
  { id: 'profiles',       label: 'All business profiles',    hint: 'Multi-business switcher entries' },
  { id: 'bills',          label: 'Invoices / bills',         hint: 'Tax invoices, proforma, credit notes, etc.' },
  { id: 'clients',        label: 'Clients',                  hint: 'Saved client directory' },
  { id: 'products',       label: 'Products / Inventory',     hint: 'Product catalog with HSN, rate, stock' },
  { id: 'expenses',       label: 'Expenses',                 hint: 'Expense tracker entries' },
  { id: 'purchases',      label: 'Purchase bills',           hint: 'Vendor bills used for ITC' },
  { id: 'recurring',      label: 'Recurring invoices',       hint: 'Auto-billing schedule entries' },
  { id: 'receipts',       label: 'Receipts',                 hint: 'Payment receipts' },
  { id: 'termsTemplates', label: 'Terms templates',          hint: 'Reusable T&C library' },
  { id: 'meta',           label: 'App settings',             hint: 'Region, modules, invoice number format, display options' },
  { id: 'localStorage',   label: 'Local preferences',        hint: 'Custom units, theme, last region preference' },
];

// Auto-tick only the parts that actually have data in the file (v1.10.74).
export function autoTickFromInspection(inspection) {
  return Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, (inspection.counts?.[p.id] || 0) > 0]));
}

// v1.10.74 - list every restored category, not just five of them.
export function buildRestoreSummary(result, importSel, importInspection) {
  const parts = [];
  if (result.billCount) parts.push(`${result.billCount} invoice(s)`);
  if (result.hasProfile) parts.push('profile');
  if (result.profileCount) parts.push(`${result.profileCount} business profile(s)`);
  if (result.templateCount) parts.push(`${result.templateCount} template(s)`);
  if (result.clientCount) parts.push(`${result.clientCount} client(s)`);
  if (result.productCount) parts.push(`${result.productCount} product(s)`);
  if (result.expenseCount) parts.push(`${result.expenseCount} expense(s)`);
  if (result.purchaseCount) parts.push(`${result.purchaseCount} purchase bill(s)`);
  if (result.recurringCount) parts.push(`${result.recurringCount} recurring invoice(s)`);
  if (result.receiptCount) parts.push(`${result.receiptCount} receipt(s)`);
  const lsCount = importSel.localStorage ? (importInspection?.counts?.localStorage || 0) : 0;
  if (lsCount) parts.push(`${lsCount} local preference(s)`);
  return parts.length ? `Restored: ${parts.join(', ')}` : 'Restore complete';
}
