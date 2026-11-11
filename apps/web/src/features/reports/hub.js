// The Reports hub's grouping and search (P6-S1), kept pure so it is tested without a DOM.

export const GROUP_LABELS = {
  financial: 'Financial statements',
  transaction: 'Transactions',
  party: 'Party',
  cashbank: 'Cash & Bank',
  gst: 'GST',
  item: 'Item / Stock',
  expense: 'Expense',
  orders: 'Orders',
  incometax: 'Income Tax',
};
const ORDER = Object.keys(GROUP_LABELS);

/** Reports by group in hub order, filtered by a search on title and description. Empty groups are dropped. */
export function groupReports(reports, q = '') {
  const needle = String(q).trim().toLowerCase();
  const hit = (r) => !needle || `${r.title} ${r.description ?? ''}`.toLowerCase().includes(needle);
  const by = new Map();
  for (const r of reports.filter(hit)) by.set(r.group, [...(by.get(r.group) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))
    .map(([id, list]) => ({ id, label: GROUP_LABELS[id] ?? id, reports: list }));
}

/** The reports whose ids are given, in that order, leaving out any the catalogue does not have (a report that was removed). */
export const pickReports = (reports, ids) =>
  ids.map((id) => reports.find((r) => r.id === id)).filter(Boolean);
