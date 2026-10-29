// Moved verbatim from apps/web/src/utils.js (Phase 0, change 0.7/0.8/0.9).
// Types are deliberately loose until the Zod contracts land in Phase 1 (change 1.13).

// Format date as DD-MM-YYYY (GST portal format).
// Guard against malformed input — `new Date("2026-13-45")` is an Invalid Date
// whose getDate() returns NaN, producing "NaN-NaN-NaN" in GSTR-1 export rows.
export const formatDateGST = (dateStr: string | null | undefined) => {
  if (!dateStr) return '';
  const d = parseLocalDate(dateStr);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

export const getFinancialYearStart = (date = new Date()) =>
  date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;

// "2026-27" — the short form used on invoice numbers and FY dropdowns.
export const getFinancialYearLabel = (date = new Date()) => {
  const y = getFinancialYearStart(date);
  return `${y}-${String(y + 1).slice(-2)}`;
};

// Get filing period as MMYYYY from a date range
export const getFilingPeriod = (dateStr: string) => {
  if (!dateStr) return '';
  const d = parseLocalDate(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${mm}${d.getFullYear()}`;
};

// v1.10.74 - today's LOCAL date as YYYY-MM-DD (toISOString is UTC, so before
// 05:30 IST it gave yesterday). Call it when needed, not once at load.
export const toLocalIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const localToday = () => toLocalIsoDate(new Date());

// A YYYY-MM-DD string as a LOCAL date. new Date('2026-04-01') is midnight UTC,
// which west of Greenwich is still 31 March - the wrong month, quarter and
// financial year. Anything else is passed to new Date() as before.
export const parseLocalDate = (value: string | Date | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  return m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(value as string | Date);
};
