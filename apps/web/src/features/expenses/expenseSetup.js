// Vyapar parity P3-S5 on the web: the category tree and expense items. Built-in categories stay as they were; the
// user's own sit beside them (optionally under a parent) with a P&L kind. No React, so it is testable.

/** Built-in expense categories that are direct costs (cost of goods); every other built-in one is indirect. */
export const DIRECT_BUILTINS = new Set(['Raw Materials', 'Shipping & Courier']);

/**
 * The category choices for a record of `kind` ('expense' | 'income'): built-in names first, then the user's own of that
 * kind, children labelled "Parent › Child". Each carries its P&L kind (direct / indirect / income).
 */
export function categoryOptions(builtins, custom, kind = 'expense') {
  const income = kind === 'income';
  const own = (custom || []).filter((c) => (c.kind === 'income') === income);
  const base = (builtins || []).map((name) => ({ name, label: name, kind: income ? 'income' : DIRECT_BUILTINS.has(name) ? 'direct' : 'indirect', custom: false }));
  const extra = own
    .filter((c) => !base.some((b) => b.name === c.name))
    .map((c) => ({ name: c.name, label: c.parent ? `${c.parent} › ${c.name}` : c.name, kind: c.kind || (income ? 'income' : 'indirect'), parent: c.parent || '', custom: true }));
  return [...base, ...extra];
}

/** A new custom category, or an error message. Names are unique within a kind; a parent must be of the same kind. */
export function addCategory(custom, options, { name, parent = '', kind }) {
  const clean = String(name || '').trim();
  if (!clean) return { error: 'Enter a name' };
  const income = kind === 'income';
  if (options.some((o) => o.name.toLowerCase() === clean.toLowerCase())) return { error: `${clean} already exists` };
  if (parent) {
    const p = options.find((o) => o.name === parent);
    if (!p) return { error: 'Pick an existing parent' };
    if ((p.kind === 'income') !== income) return { error: 'The parent must be of the same kind' };
  }
  return { categories: [...(custom || []), { name: clean, parent, kind }] };
}

/** Removing a category moves its children up to its own parent, so nothing is orphaned. */
export const removeCategory = (custom, name) => {
  const gone = (custom || []).find((c) => c.name === name);
  return (custom || []).filter((c) => c.name !== name).map((c) => (c.parent === name ? { ...c, parent: gone?.parent || '' } : c));
};

/**
 * Totals per category with children rolled into their parents: `own` is what was booked on the category itself,
 * `total` adds every descendant. The parents' totals are what the Expense Category report (P6) will show.
 */
export function categoryRollup(records, custom) {
  const parentOf = new Map((custom || []).map((c) => [c.name, c.parent || '']));
  const rows = new Map();
  const row = (name) => {
    if (!rows.has(name)) rows.set(name, { category: name, own: 0, total: 0 });
    return rows.get(name);
  };
  for (const r of records || []) {
    const amount = Number(r.amount) || 0;
    const name = r.category || 'Other';
    row(name).own += amount;
    const seen = new Set();
    for (let c = name; c && !seen.has(c); c = parentOf.get(c)) {
      seen.add(c);
      row(c).total += amount;
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return [...rows.values()].map((r) => ({ ...r, own: round(r.own), total: round(r.total), parent: parentOf.get(r.category) || '' })).sort((a, b) => b.total - a.total);
}

/** A LinesGrid row that names a saved expense item picks up its SAC, rate and GST % (only where still blank). */
export function fillFromExpenseItem(line, items) {
  const it = (items || []).find((x) => x.name.toLowerCase() === String(line.item || '').trim().toLowerCase());
  if (!it) return line;
  return {
    ...line,
    hsn: line.hsn || it.sac || '',
    rate: line.rate === '' || line.rate == null ? it.defaultRate ?? '' : line.rate,
    gst: line.gst == null || line.gst === '' || line.gst === 18 ? Number(it.gstRate) || 0 : line.gst,
  };
}
