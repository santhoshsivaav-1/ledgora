// Phase 3 (docs/AUDIT_2026-11.md): godowns and the bill of materials. Pure: the caller hands in the BOM lines and a cost
// per component, and gets back what one run consumes and what it costs. Stock stays the sum of stock_movements rows; a
// godown only says which row went where, and a movement without a godown belongs to the default one.

export interface BomLine {
  componentItemId: string;
  quantity: number;
  scrapPercent?: number | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** What `qty` units of the product consume of each component, scrap included. */
export function bomNeeds(lines: readonly BomLine[] | null | undefined, qty: number) {
  const out: { componentItemId: string; quantity: number }[] = [];
  for (const l of lines || []) {
    const q = r3(
      (Number(qty) || 0) * (Number(l.quantity) || 0) * (1 + (Number(l.scrapPercent) || 0) / 100),
    );
    if (!l.componentItemId || !q) continue;
    const seen = out.find((o) => o.componentItemId === l.componentItemId);
    if (seen) seen.quantity = r3(seen.quantity + q);
    else out.push({ componentItemId: l.componentItemId, quantity: q });
  }
  return out;
}

/** What one unit of the product costs: the components' cost, scrap included. */
export function bomCost(
  lines: readonly BomLine[] | null | undefined,
  unitCostOf: (itemId: string) => number,
) {
  let cost = 0;
  for (const l of lines || []) {
    const q = r3((Number(l.quantity) || 0) * (1 + (Number(l.scrapPercent) || 0) / 100));
    if (!l.componentItemId || !q) continue;
    cost += q * (Number(unitCostOf(l.componentItemId)) || 0);
  }
  return r2(cost);
}

/** Is there enough of everything? Returns the components that fall short (empty = the run can go). */
export function bomShort(
  lines: readonly BomLine[] | null | undefined,
  qty: number,
  stockOf: (itemId: string) => number,
) {
  return bomNeeds(lines, qty)
    .map((n) => {
      const have = Number(stockOf(n.componentItemId)) || 0;
      return { ...n, have, short: r3(n.quantity - have) };
    })
    .filter((n) => n.short > 0);
}
