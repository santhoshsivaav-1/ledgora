// Number and date handling for the form primitives (P0-S3.3). Pure, so test/uiLib.test.js covers it without a DOM.

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123456.5 → "1,23,456.50" (Indian grouping). Not a number → "". */
export const formatMoney = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '' : INR.format(Number(n)));

/** Up to `places` decimals, trailing zeros dropped: 2.5 → "2.5", 2 → "2". */
export const formatQty = (n, places = 3) => {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: places }).format(Number(n));
};

/**
 * What a person typed into an amount box, as a number: "1,23,456.50", "123456.5", "₹ 500" and "-20" all work.
 * Returns null for an empty box and NaN for something that is not a number, so a form can tell the two apart.
 */
export function parseAmount(text, { allowNegative = false } = {}) {
  const raw = String(text ?? '')
    .replace(/[₹,\s]/g, '')
    .trim();
  if (raw === '') return null;
  if (!/^-?\d*\.?\d*$/.test(raw) || raw === '-' || raw === '.') return NaN;
  const n = Number(raw);
  if (!allowNegative && n < 0) return NaN;
  return n;
}

/**
 * Rounds to `places` decimals the way money is rounded (half away from zero). Shifting through the exponent keeps
 * 1.005 at 1.01; multiplying by 100 would see 100.49999999999999 and give 1.00.
 */
export const roundTo = (n, places = 2) => {
  const abs = Math.abs(Number(n) || 0);
  if (String(abs).includes('e')) return Math.sign(n) * (Math.round(abs * 10 ** places) / 10 ** places); // 1e-7, 1e21
  const shifted = Math.round(Number(`${abs}e${places}`));
  return Math.sign(n) * Number(`${shifted}e-${places}`);
};

const pad = (n) => String(n).padStart(2, '0');

/** "2026-01-06" → "06-01-2026". Anything else → "". */
export const isoToDisplay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

const validDate = (y, m, d) => {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

/**
 * A typed date to ISO: "06-01-2026", "6/1/2026", "06.01.26" and the digits-only "060126" or "06012026" all give
 * "2026-01-06". Two-digit years are 20xx. Returns null when it is not a real day (31-02-2026).
 */
export function parseTypedDate(text) {
  const s = String(text || '').trim();
  let d;
  let m;
  let y;
  const digits = /^\d+$/.test(s);
  if (digits && (s.length === 6 || s.length === 8)) {
    d = Number(s.slice(0, 2));
    m = Number(s.slice(2, 4));
    y = Number(s.slice(4));
  } else {
    const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!parts) return null;
    [d, m, y] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  }
  if (y < 100) y += 2000;
  if (!validDate(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Whether `iso` lies within the optional bounds (ISO strings compare correctly as text). */
export const withinBounds = (iso, min, max) => !!iso && (!min || iso >= min) && (!max || iso <= max);

/** Ten digits for an Indian mobile number, whatever was pasted: "+91 98765-43210" → "9876543210". */
export const normalisePhone = (text) => {
  const digits = String(text || '').replace(/\D/g, '');
  return digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits.slice(0, 10);
};
