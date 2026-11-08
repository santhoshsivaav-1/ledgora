import { fyRange, fyStartYear } from '../../../app/fiscalYear';

// The PeriodPicker presets (P0-S3.2). Every preset answers { id, label, from, to } with ISO dates; quarters follow
// the financial year (Q1 = April to June for an April FY).

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthStart = (y, m) => new Date(y, m, 1);
const monthEnd = (y, m) => new Date(y, m + 1, 0);

export const PERIOD_PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['this-week', 'This week'],
  ['this-month', 'This month'],
  ['this-quarter', 'This quarter'],
  ['this-fy', 'This FY'],
  ['last-month', 'Last month'],
  ['last-quarter', 'Last quarter'],
  ['last-fy', 'Last FY'],
  ['custom', 'Custom'],
];

// The FY quarter `today` is in: its first month (0-11) and year.
function quarterStart(today, fyStartMonth) {
  const offset = (today.getMonth() - (fyStartMonth - 1) + 12) % 12;
  const back = offset % 3;
  return monthStart(today.getFullYear(), today.getMonth() - back);
}

/**
 * The dates of preset `id` as seen on `today`. `custom` keeps the range given. `fyStart` (the year the top bar's FY
 * switcher is on) makes This FY / Last FY follow that year instead of today's.
 */
export function periodRange(id, { today = new Date(), fyStartMonth = 4, fyStart, from, to } = {}) {
  const label = (PERIOD_PRESETS.find(([k]) => k === id) || [])[1] || id;
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (id) {
    case 'today':
      return { id, label, from: iso(today), to: iso(today) };
    case 'yesterday': {
      const d = addDays(today, -1);
      return { id, label, from: iso(d), to: iso(d) };
    }
    case 'this-week': {
      // Indian week: Monday to Sunday.
      const start = addDays(today, -((today.getDay() + 6) % 7));
      return { id, label, from: iso(start), to: iso(addDays(start, 6)) };
    }
    case 'this-month':
      return { id, label, from: iso(monthStart(y, m)), to: iso(monthEnd(y, m)) };
    case 'last-month':
      return { id, label, from: iso(monthStart(y, m - 1)), to: iso(monthEnd(y, m - 1)) };
    case 'this-quarter': {
      const s = quarterStart(today, fyStartMonth);
      return { id, label, from: iso(s), to: iso(monthEnd(s.getFullYear(), s.getMonth() + 2)) };
    }
    case 'last-quarter': {
      const cur = quarterStart(today, fyStartMonth);
      const s = monthStart(cur.getFullYear(), cur.getMonth() - 3);
      return { id, label, from: iso(s), to: iso(monthEnd(s.getFullYear(), s.getMonth() + 2)) };
    }
    case 'this-fy':
      return { id, label, ...fyRange(fyStart ?? fyStartYear(today, fyStartMonth), fyStartMonth) };
    case 'last-fy':
      return { id, label, ...fyRange((fyStart ?? fyStartYear(today, fyStartMonth)) - 1, fyStartMonth) };
    default:
      return { id: 'custom', label: 'Custom', from: from || '', to: to || '' };
  }
}
