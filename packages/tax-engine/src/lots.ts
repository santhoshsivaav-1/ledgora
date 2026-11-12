// Batch and serial stock for the typed API and the POS counter (the web screens keep the same rules over their
// documents in apps/web features/items/itemExtras.js). Pure: the caller hands in the item's opening lots and every line
// that moved it, and gets back what is in stock and what is wrong with a sale.

export interface LotMove {
  /** +1 bought / returned by a customer, -1 sold / returned to a supplier. */
  sign: number;
  quantity: number;
  batchNo?: string | null;
  expDate?: string | null;
  mfgDate?: string | null;
  serials?: readonly string[] | null;
}
export interface Lot {
  batchNo: string;
  expDate: string;
  mfgDate: string;
  qty: number;
}
export interface OpeningLots {
  batches?: readonly { batchNo: string; expDate?: string; mfgDate?: string; qty: number }[] | null;
  serials?: readonly string[] | null;
}

const key = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase();
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Batches with stock worked out from the opening lots and the moves, first-expiring first. */
export function lotStock(
  opening: OpeningLots | null | undefined,
  moves: readonly LotMove[],
): Lot[] {
  const map = new Map<string, Lot>();
  const touch = (b: {
    batchNo?: string | null;
    expDate?: string | null;
    mfgDate?: string | null;
  }) => {
    const k = key(b.batchNo);
    if (!k) return null;
    if (!map.has(k))
      map.set(k, {
        batchNo: String(b.batchNo).trim(),
        expDate: b.expDate || '',
        mfgDate: b.mfgDate || '',
        qty: 0,
      });
    const row = map.get(k)!;
    if (!row.expDate && b.expDate) row.expDate = b.expDate;
    if (!row.mfgDate && b.mfgDate) row.mfgDate = b.mfgDate;
    return row;
  };
  for (const b of opening?.batches ?? []) {
    const row = touch(b);
    if (row) row.qty += Number(b.qty) || 0;
  }
  for (const m of moves) {
    const row = touch(m);
    if (row) row.qty += m.sign * (Number(m.quantity) || 0);
  }
  return [...map.values()]
    .map((r) => ({ ...r, qty: r3(r.qty) }))
    .sort(
      (a, b) =>
        (a.expDate || '9999').localeCompare(b.expDate || '9999') ||
        a.batchNo.localeCompare(b.batchNo),
    );
}

/** Serial numbers in stock: opening and bought, less sold. */
export function serialStock(
  opening: OpeningLots | null | undefined,
  moves: readonly LotMove[],
): string[] {
  const count = new Map<string, number>();
  const label = new Map<string, string>();
  const add = (sn: string, d: number) => {
    const k = key(sn);
    if (!k) return;
    label.set(k, label.get(k) || sn.trim());
    count.set(k, (count.get(k) || 0) + d);
  };
  for (const sn of opening?.serials ?? []) add(sn, 1);
  for (const m of moves) for (const sn of m.serials ?? []) add(sn, m.sign);
  return [...count.entries()].filter(([, c]) => c > 0).map(([k]) => label.get(k)!);
}

/** Does this item track batches / serials (its opening lots say so, or the item is marked)? */
export const tracksBatches = (o: (OpeningLots & { trackBatch?: boolean }) | null | undefined) =>
  !!o?.trackBatch || !!o?.batches?.length;
export const tracksSerials = (o: (OpeningLots & { trackSerial?: boolean }) | null | undefined) =>
  !!o?.trackSerial || !!o?.serials?.length;

/**
 * What is wrong with selling `line` from these lots, as messages (empty = fine). A batch must be named and exist, must
 * not be past its expiry on the sale date, and must have the quantity (only when `block`); serials must match the
 * quantity, be in stock and not repeat.
 */
export function saleLotProblems(
  line: {
    name: string;
    quantity: number;
    batchNo?: string | null;
    serials?: readonly string[] | null;
  },
  o: {
    batches?: Lot[] | null;
    serials?: string[] | null;
    date: string;
    block?: boolean;
  },
): string[] {
  const out: string[] = [];
  if (o.batches) {
    if (!line.batchNo) out.push(`${line.name}: pick a batch`);
    else {
      const b = o.batches.find((x) => key(x.batchNo) === key(line.batchNo));
      if (!b) out.push(`${line.name}: there is no batch ${line.batchNo}`);
      else {
        if (b.expDate && b.expDate < o.date)
          out.push(`${line.name}: batch ${b.batchNo} expired on ${b.expDate}`);
        if (o.block && line.quantity > b.qty + 0.0005)
          out.push(`${line.name}: batch ${b.batchNo} has only ${b.qty} left`);
      }
    }
  }
  if (o.serials) {
    const list = (line.serials ?? []).map((s) => s.trim()).filter(Boolean);
    const uniq = new Set(list.map(key));
    if (uniq.size !== list.length) out.push(`${line.name}: a serial number is repeated`);
    if (list.length !== line.quantity)
      out.push(
        `${line.name}: ${line.quantity} unit(s) need ${line.quantity} serial number(s); ${list.length} given`,
      );
    const have = new Set(o.serials.map(key));
    const missing = list.filter((s) => !have.has(key(s)));
    if (missing.length) out.push(`${line.name}: not in stock: ${missing.slice(0, 5).join(', ')}`);
  }
  return out;
}
