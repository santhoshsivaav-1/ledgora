// The logic inside DataTable (P0-S3.1): sorting, totals, range selection and the column picker. Pure, so it is
// tested without a DOM (test/uiLib.test.js).

/** Clicking a header cycles ascending → descending → unsorted. Clicking another column starts it ascending. */
export function nextSort(sort, columnId) {
  if (!sort || sort.id !== columnId) return { id: columnId, dir: 'asc' };
  if (sort.dir === 'asc') return { id: columnId, dir: 'desc' };
  return null;
}

/** The value a column sorts and totals on: its accessor, a function or a field name. */
export const cellValue = (column, row) =>
  typeof column.accessor === 'function' ? column.accessor(row) : row?.[column.accessor ?? column.id];

const compare = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1; // blanks last either way
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' });
};

/** A sorted copy; equal values keep their order. Blanks go last in both directions. */
export function sortRows(rows, columns, sort) {
  if (!sort) return rows;
  const column = columns.find((c) => c.id === sort.id);
  if (!column) return rows;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: cellValue(column, row) }))
    .sort((x, y) => {
      const blankX = x.v === null || x.v === undefined || x.v === '';
      const blankY = y.v === null || y.v === undefined || y.v === '';
      if (blankX !== blankY) return blankX ? 1 : -1;
      return sign * compare(x.v, y.v) || x.i - y.i;
    })
    .map((x) => x.row);
}

/**
 * The sticky totals row: for each column with `total`, the sum of its values ('sum') or whatever its function
 * returns. Sums are rounded to paise so 0.1 + 0.2 shows 0.30, not 0.30000000000000004.
 */
export function columnTotals(rows, columns) {
  const out = {};
  for (const c of columns) {
    if (!c.total) continue;
    if (typeof c.total === 'function') out[c.id] = c.total(rows);
    else {
      const s = rows.reduce((acc, r) => acc + (Number(cellValue(c, r)) || 0), 0);
      out[c.id] = Math.round(s * 100) / 100;
    }
  }
  return out;
}

/**
 * Selection after clicking row `key`. Shift-click selects everything between the last clicked row and this one;
 * a plain click toggles just this row.
 */
export function toggleSelection(selected, keys, key, { shift = false, anchor = null } = {}) {
  const next = new Set(selected);
  if (shift && anchor !== null && keys.includes(anchor)) {
    const a = keys.indexOf(anchor);
    const b = keys.indexOf(key);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const on = !selected.has(key) || selected.has(anchor);
    for (let i = lo; i <= hi; i += 1) {
      if (on) next.add(keys[i]);
      else next.delete(keys[i]);
    }
    return next;
  }
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

const PREF_PREFIX = 'ledgora_table.';

/** The columns a person hid on table `tableId` (remembered per table on this computer). */
export function loadHiddenColumns(tableId) {
  if (!tableId) return [];
  try {
    const list = JSON.parse(localStorage.getItem(PREF_PREFIX + tableId) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveHiddenColumns(tableId, hidden) {
  if (!tableId) return;
  try {
    localStorage.setItem(PREF_PREFIX + tableId, JSON.stringify(hidden));
  } catch {
    /* private mode */
  }
}

/** Rows as tab-separated text, for "Copy" and for the CSV-style export. */
export function rowsToTsv(rows, columns) {
  const esc = (v) => String(v ?? '').replace(/[\t\n\r]+/g, ' ');
  const head = columns.map((c) => esc(typeof c.header === 'string' ? c.header : c.id)).join('\t');
  return [head, ...rows.map((r) => columns.map((c) => esc(cellValue(c, r))).join('\t'))].join('\n');
}
