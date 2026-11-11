// A small .xlsx reader for bank statements (Vyapar parity P5-S6), with no dependency: an .xlsx file is a zip of XML
// parts, and the browser's DecompressionStream inflates them. It reads the first worksheet's cell values (shared
// strings, inline strings, numbers) into rows, which `rowsToCsv` turns into the CSV parseBankStatement already reads.
// Formatting, formulas and the old binary .xls format are out of scope: a formula cell gives its cached value, and an
// .xls file is refused with a message to save it as .xlsx or CSV.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&';
    if (l === 'lt') return '<';
    if (l === 'gt') return '>';
    if (l === 'quot') return '"';
    if (l === 'apos') return "'";
    return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
  });

/** The files in a zip archive, each readable as text. */
function unzip(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && dv.getUint32(0, true) === 0xe011cfd0)
    throw new Error('This is an old Excel .xls file. Open it in Excel and save it as .xlsx or CSV, then upload again.');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (dv.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('This file is not an .xlsx spreadsheet.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  const utf8 = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== CENTRAL) throw new Error('The spreadsheet is damaged.');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    files.set(utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen)), { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const f = files.get(name);
    if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const data = bytes.subarray(start, start + f.size);
    if (f.method === 0) return utf8.decode(data);
    if (f.method !== 8) throw new Error('The spreadsheet uses a compression this reader does not know.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return utf8.decode(await new Response(stream).arrayBuffer());
  };
  return { names: [...files.keys()], read };
}

/** "AB12" → 27 (zero-based column). */
const colIndex = (ref) => {
  let n = 0;
  for (const ch of String(ref).replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** The first worksheet of an .xlsx file as rows of cell texts. */
export async function readXlsx(buf) {
  const zip = unzip(buf);
  const sheets = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheets.length) throw new Error('The spreadsheet has no worksheet.');
  sheets.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const shared = [];
  const sst = await zip.read('xl/sharedStrings.xml');
  if (sst)
    for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g))
      shared.push(decodeXml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const xml = await zip.read(sheets[0]);
  const rows = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = c[2] ?? '';
      let v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (type === 'inlineStr') v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('');
      if (v == null) continue;
      const text = type === 's' ? (shared[Number(v)] ?? '') : decodeXml(v);
      row[ref ? colIndex(ref) : row.length] = text;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}

/** Rows as CSV text (quoted where needed), for parsers that read CSV. */
export const rowsToCsv = (rows) =>
  rows
    .map((r) => r.map((v) => (/[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(','))
    .join('\n');
