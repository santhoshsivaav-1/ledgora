// The spreadsheet behaviour of LinesGrid (P0-S3.6), kept pure: which columns a document type shows, pasting rows
// from Excel, and where the cursor goes next.

/** Columns per document type, from the table in the Phase 0 guide. `optional` columns follow a setting. */
export const LINE_COLUMNS = {
  sale: ['item', 'hsn', 'qty', 'unit', 'rate', 'discount', 'gst', 'amount'],
  purchase: ['item', 'hsn', 'qty', 'unit', 'rate', 'discount', 'gst', 'itc', 'amount'],
  order: ['item', 'hsn', 'qty', 'unit', 'rate', 'discount', 'gst', 'amount'],
  return: ['item', 'hsn', 'qty', 'unit', 'rate', 'gst', 'itc', 'amount'],
  expense: ['item', 'hsn', 'qty', 'unit', 'rate', 'gst', 'itc', 'amount'],
};
export const OPTIONAL_LINE_COLUMNS = { sale: ['batch'], purchase: ['batch'], return: ['batch'] };

export const lineColumnsFor = (docType, { batch = false } = {}) => {
  const base = LINE_COLUMNS[docType] || LINE_COLUMNS.sale;
  if (!batch || !(OPTIONAL_LINE_COLUMNS[docType] || []).includes('batch')) return base;
  const i = base.indexOf('qty');
  return [...base.slice(0, i), 'batch', ...base.slice(i)];
};

/**
 * Text copied from Excel or Google Sheets (rows by newline, cells by tab) as line objects, laid onto `fields` in
 * order from the column the paste started in. Blank lines are dropped; a single value is not a multi-row paste.
 */
export function parsePastedRows(text, fields) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length < 2 && !lines[0]?.includes('\t')) return null;
  return lines.map((line) => {
    const cells = line.split('\t');
    const row = {};
    fields.forEach((f, i) => {
      if (cells[i] !== undefined) row[f] = cells[i].trim();
    });
    return row;
  });
}

/**
 * Where Tab / Shift+Tab / Enter moves from cell (row, col) in a grid of `rows` × `cols`. Enter on the last cell of
 * the last row asks for a new row (`addRow: true`).
 */
export function nextCell({ row, col }, { rows, cols }, key, shift = false) {
  if (key === 'Tab' && shift) {
    if (col > 0) return { row, col: col - 1 };
    return row > 0 ? { row: row - 1, col: cols - 1 } : { row, col };
  }
  if (key === 'Tab' || key === 'Enter') {
    if (col < cols - 1) return { row, col: col + 1 };
    if (row < rows - 1) return { row: row + 1, col: 0 };
    return key === 'Enter' ? { row: row + 1, col: 0, addRow: true } : { row, col };
  }
  if (key === 'ArrowDown') return { row: Math.min(row + 1, rows - 1), col };
  if (key === 'ArrowUp') return { row: Math.max(row - 1, 0), col };
  return { row, col };
}
