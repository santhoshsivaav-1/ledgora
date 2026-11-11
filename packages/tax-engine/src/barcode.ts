// Vyapar parity P7-S1: barcode labels. Pure functions: EAN-13 check digits, Code 128 (set B) encoding to bar widths,
// the label sheet geometry and the page layout. The screen draws the SVG from what these return; nothing here touches
// the DOM, so every figure is testable (EAN-13 vectors, sheet alignment, copies and skipped labels).

// ---- EAN-13 -------------------------------------------------------------------------------------------------------------

/** The check digit of the first 12 digits (weights 1 and 3 from the left). */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits before the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}
/** 12 digits in, 13 out; 13 digits in are checked and returned. */
export function ean13(code: string): string {
  if (/^\d{12}$/.test(code)) return code + ean13CheckDigit(code);
  if (/^\d{13}$/.test(code)) {
    if (ean13CheckDigit(code.slice(0, 12)) !== Number(code[12]))
      throw new Error(`${code} has a wrong EAN-13 check digit`);
    return code;
  }
  throw new Error('EAN-13 is 12 or 13 digits');
}
export const isValidEan13 = (code: string) => {
  try {
    ean13(code);
    return /^\d{13}$/.test(code);
  } catch {
    return false;
  }
};

/**
 * The shop's own EAN-13 for item number `seq` (1, 2, 3…): prefix 200-299 is reserved by GS1 for in-store use, so these
 * never clash with a manufacturer's code. 3-digit prefix + 9-digit sequence + check digit.
 */
export function internalEan13(seq: number, prefix = '200'): string {
  if (!/^2\d\d$/.test(prefix)) throw new Error('In-store EAN-13 prefixes are 200 to 299');
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999_999)
    throw new Error('Sequence out of range');
  return ean13(prefix + String(seq).padStart(9, '0'));
}
/** The next `count` in-store codes after the highest sequence already used (`lastSeq`). */
export const nextInternalCodes = (lastSeq: number, count: number, prefix = '200') =>
  Array.from({ length: count }, (_, i) => ({
    seq: lastSeq + i + 1,
    code: internalEan13(lastSeq + i + 1, prefix),
  }));
/** The sequence of one of our in-store codes, or null (a manufacturer's EAN, a typed code). */
export const internalSeqOf = (code: string, prefix = '200') =>
  isValidEan13(code) && code.startsWith(prefix) ? Number(code.slice(3, 12)) : null;

/** EAN-13 as 95 modules (1 = bar). Left half uses the L/G tables chosen by the first digit, right half the R table. */
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];
export function ean13Modules(code: string): string {
  const c = ean13(code);
  const par = PARITY[Number(c[0])];
  let out = '101';
  for (let i = 0; i < 6; i++) out += (par[i] === 'L' ? L : G)[Number(c[i + 1])];
  out += '01010';
  for (let i = 7; i < 13; i++) out += R[Number(c[i])];
  return out + '101';
}

// ---- Code 128 (set B) -----------------------------------------------------------------------------------------------------

// Bar/space widths for symbol values 0..105 (six digits: bar, space, bar, space, bar, space) and the stop (seven).
const C128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232'
).split(' ');
export const CODE128_PATTERNS = C128;
const STOP = '2331112';
const START_B = 104;

/** Code 128 set B accepts printable ASCII (space to ~): item codes and names do. */
export const code128Encodable = (text: string) => text.length > 0 && /^[\x20-\x7e]+$/.test(text);

/** The symbol values of a Code 128 B barcode: start, one per character, checksum, then the stop. */
export function code128Values(text: string): { values: number[]; checksum: number } {
  if (!code128Encodable(text)) throw new Error('Code 128 B takes printable ASCII only');
  const chars = [...text].map((ch) => ch.charCodeAt(0) - 32);
  let sum = START_B;
  chars.forEach((v, i) => (sum += v * (i + 1)));
  const checksum = sum % 103;
  return { values: [START_B, ...chars, checksum], checksum };
}
/** Modules (1 = bar) of a Code 128 B barcode, including the stop and its closing bar. */
export function code128Modules(text: string): string {
  const { values } = code128Values(text);
  let out = '';
  for (const v of [...values]) out += runs(C128[v]);
  return out + runs(STOP);
}
function runs(widths: string) {
  let bar = true;
  let out = '';
  for (const w of widths) {
    out += (bar ? '1' : '0').repeat(Number(w));
    bar = !bar;
  }
  return out;
}

/** Bars as {x, w} rectangles in modules, merging neighbours: what the SVG draws. */
export function barsOf(modules: string) {
  const bars: { x: number; w: number }[] = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      let j = i;
      while (modules[j] === '1') j++;
      bars.push({ x: i, w: j - i });
      i = j;
    } else i++;
  }
  return bars;
}

/** What to draw for a code under a chosen type: EAN-13 falls back to Code 128 for a code that is not 12/13 digits. */
export function barcodeFor(code: string, type: 'code128' | 'ean13') {
  if (type === 'ean13' && /^\d{12,13}$/.test(code)) {
    const c = ean13(code);
    return { type: 'ean13' as const, text: c, modules: ean13Modules(c) };
  }
  return { type: 'code128' as const, text: code, modules: code128Modules(code) };
}

// ---- label sheets ---------------------------------------------------------------------------------------------------------

export interface LabelSheet {
  id: string;
  label: string;
  /** Page size in mm; a roll has the label's own width and a page per label (rows = 1). */
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
  gapX: number;
  gapY: number;
  marginLeft: number;
  marginTop: number;
}
export const LABEL_SHEETS: LabelSheet[] = [
  // Avery L7651 / Herma 4678 style: 5 × 13 = 65 on A4.
  {
    id: 'a4-65',
    label: 'A4 · 65 labels (38.1 × 21.2 mm)',
    pageW: 210,
    pageH: 297,
    cols: 5,
    rows: 13,
    labelW: 38.1,
    labelH: 21.2,
    gapX: 2.5,
    gapY: 0,
    marginLeft: 4.65,
    marginTop: 10.7,
  },
  // Avery L7159 style: 3 × 8 = 24 on A4.
  {
    id: 'a4-24',
    label: 'A4 · 24 labels (63.5 × 33.9 mm)',
    pageW: 210,
    pageH: 297,
    cols: 3,
    rows: 8,
    labelW: 63.5,
    labelH: 33.9,
    gapX: 2.54,
    gapY: 0,
    marginLeft: 7.2,
    marginTop: 15.15,
  },
  {
    id: 'roll-50x25',
    label: 'Roll · 50 × 25 mm',
    pageW: 50,
    pageH: 25,
    cols: 1,
    rows: 1,
    labelW: 50,
    labelH: 25,
    gapX: 0,
    gapY: 0,
    marginLeft: 0,
    marginTop: 0,
  },
  {
    id: 'roll-38x25',
    label: 'Roll · 38 × 25 mm',
    pageW: 38,
    pageH: 25,
    cols: 1,
    rows: 1,
    labelW: 38,
    labelH: 25,
    gapX: 0,
    gapY: 0,
    marginLeft: 0,
    marginTop: 0,
  },
];
export const sheetById = (id: string) => LABEL_SHEETS.find((s) => s.id === id) ?? LABEL_SHEETS[0];

/** Why a custom sheet can not work, or ''. Every label must lie inside the page. */
export function sheetProblem(s: LabelSheet): string {
  if ([s.pageW, s.pageH, s.labelW, s.labelH].some((v) => !(v > 0)))
    return 'Sizes must be more than 0';
  if (!Number.isInteger(s.cols) || !Number.isInteger(s.rows) || s.cols < 1 || s.rows < 1)
    return 'Columns and rows must be whole numbers';
  if ([s.gapX, s.gapY, s.marginLeft, s.marginTop].some((v) => v < 0))
    return 'Gaps and margins can not be negative';
  const right = s.marginLeft + s.cols * s.labelW + (s.cols - 1) * s.gapX;
  const bottom = s.marginTop + s.rows * s.labelH + (s.rows - 1) * s.gapY;
  if (right > s.pageW + 0.01)
    return `The labels run ${(right - s.pageW).toFixed(1)} mm past the right edge`;
  if (bottom > s.pageH + 0.01)
    return `The labels run ${(bottom - s.pageH).toFixed(1)} mm past the bottom edge`;
  return '';
}

/** Top-left of slot `i` (0-based, row by row) on a sheet, in mm. */
export const slotPosition = (s: LabelSheet, i: number) => {
  const col = i % s.cols;
  const row = Math.floor(i / s.cols) % s.rows;
  return {
    x: r3(s.marginLeft + col * (s.labelW + s.gapX)),
    y: r3(s.marginTop + row * (s.labelH + s.gapY)),
  };
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const MAX_COPIES = 1000;
export interface LabelItem {
  id: string;
  name: string;
  code: string;
  price?: number;
  mrp?: number | null;
  /** Used when copies are "= stock quantity". */
  stock?: number;
}
/**
 * The labels to print, page by page. `copies` is a number (≥ 1) or 'stock' (the item's stock, at least 1); each is capped
 * at 1000. `startAt` (1-based) skips used positions on the first page of a sheet; a roll has no positions to skip.
 */
export function layoutLabels(
  items: LabelItem[],
  o: { sheet: LabelSheet; copies: number | 'stock'; startAt?: number },
) {
  const perPage = o.sheet.cols * o.sheet.rows;
  const queue: LabelItem[] = [];
  for (const it of items) {
    const n =
      o.copies === 'stock'
        ? Math.max(1, Math.floor(it.stock ?? 1))
        : Math.max(1, Math.floor(o.copies));
    for (let k = 0; k < Math.min(n, MAX_COPIES); k++) queue.push(it);
  }
  const skip =
    perPage > 1 ? Math.min(Math.max(0, Math.floor((o.startAt ?? 1) - 1)), perPage - 1) : 0;
  const pages: { slot: number; item: LabelItem; x: number; y: number }[][] = [];
  let slot = skip;
  for (const item of queue) {
    const page = Math.floor(slot / perPage);
    (pages[page] ??= []).push({
      slot: slot % perPage,
      item,
      ...slotPosition(o.sheet, slot % perPage),
    });
    slot++;
  }
  return { pages, labels: queue.length, perPage, skipped: skip };
}
