import { useSyncExternalStore } from 'react';

// The financial-year switcher in the new top bar (P0-S2). It sets the default period that the shared PeriodPicker
// opens on ("This FY"); a screen keeps its own filters. Indian FYs run April to March unless the business says
// otherwise (fyStartMonth, 1-12).

const FY_KEY = 'ledgora_fy';

/** The FY a date falls in, as the year it starts: 2026 for any day from April 2026 to March 2027. */
export const fyStartYear = (date = new Date(), fyStartMonth = 4) =>
  date.getMonth() + 1 >= fyStartMonth ? date.getFullYear() : date.getFullYear() - 1;

/** "FY 2026-27". A calendar-year FY (January start) is just "FY 2026". */
export const fyLabel = (startYear, fyStartMonth = 4) =>
  fyStartMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** First and last day of the FY that starts in `startYear`, as ISO dates. */
export function fyRange(startYear, fyStartMonth = 4) {
  const endMonth = fyStartMonth === 1 ? 12 : fyStartMonth - 1;
  const endYear = fyStartMonth === 1 ? startYear : startYear + 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate();
  return { from: iso(startYear, fyStartMonth, 1), to: iso(endYear, endMonth, lastDay) };
}

/** The years offered in the switcher: this one and the five before it, newest first. */
export const fyOptions = (today = new Date(), fyStartMonth = 4, count = 6) => {
  const current = fyStartYear(today, fyStartMonth);
  return Array.from({ length: count }, (_, i) => {
    const start = current - i;
    return { start, label: fyLabel(start, fyStartMonth), ...fyRange(start, fyStartMonth) };
  });
};

const listeners = new Set();

export function getSelectedFy() {
  try {
    const n = Number(localStorage.getItem(FY_KEY));
    if (Number.isInteger(n) && n > 1990) return n;
  } catch {
    /* private mode */
  }
  return fyStartYear();
}

export function setSelectedFy(startYear) {
  try {
    localStorage.setItem(FY_KEY, String(startYear));
  } catch {
    /* private mode */
  }
  listeners.forEach((fn) => fn());
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useSelectedFy = () => useSyncExternalStore(subscribe, getSelectedFy, () => fyStartYear());
