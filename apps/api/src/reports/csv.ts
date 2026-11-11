// CSV for reports: a header from the row keys, quoted cells, formula-safe, and a stream that writes it in chunks so a big
// report does not become one giant string. Used by the export endpoint and the scheduled e-mails.
import { csvCell } from './shared.ts';

/** Keys that are plumbing (ids for drill-down), not columns a person reads. */
const HIDDEN = new Set(['id', 'refId', 'refType']);

/** "totalTax" → "Total tax", "0-30" stays. */
export const humanize = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(gst|hsn|sac|tds|tcs|pan|gstin|pos|uqc|itc|json|eway)\b/gi, (m) => m.toUpperCase());

export const columnsOf = (rows: Record<string, unknown>[]) =>
  Object.keys(rows[0] ?? {}).filter((k) => !HIDDEN.has(k));

export function csvHeader(cols: string[]) {
  return `${cols.map((c) => csvCell(humanize(c))).join(',')}\r\n`;
}
export function csvRow(cols: string[], row: Record<string, unknown>) {
  return `${cols.map((c) => csvCell(row[c])).join(',')}\r\n`;
}
export const reportCsv = (rows: Record<string, unknown>[]) => {
  const cols = columnsOf(rows);
  return csvHeader(cols) + rows.map((r) => csvRow(cols, r)).join('');
};

/** The same CSV as a stream of byte chunks (a UTF-8 byte-order mark first, so Excel reads ₹ and Indian names right). */
export function csvStream(rows: Record<string, unknown>[], chunk = 1000) {
  const cols = columnsOf(rows);
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`\uFEFF${csvHeader(cols)}`));
    },
    pull(c) {
      if (i >= rows.length) return c.close();
      let out = '';
      for (const end = Math.min(rows.length, i + chunk); i < end; i++) out += csvRow(cols, rows[i]);
      c.enqueue(enc.encode(out));
    },
  });
}
