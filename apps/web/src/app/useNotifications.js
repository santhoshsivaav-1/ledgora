import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dataVersion } from '../lib/apiClient';
import { notificationSummary } from '../lib/data/search';
import { getAllAppSettings } from '../lib/appSettings';
import { lowStockLimit } from '../features/items/itemFields';
import { getUpcomingFilings, localToday } from '../utils';

// The bell's contents (moved out of App.jsx unchanged, Vyapar parity P0-S2, so both shells share it): overdue and
// due-soon invoices, low stock, filing deadlines and the recurring auto-fire, with "mark all read".
export default function useNotifications(currentView) {
  // ---- Notification centre ----
  // Computed from server data on app boot + every 10 minutes; tucked under a
  // bell icon next to dark-mode toggle in the sidebar. Each section is one
  // click away from the relevant page.
  const [notifications, setNotifications] = useState({
    overdue: [],
    dueSoon: [],
    lowStock: [],
    filings: [],
    autoFire: null,
  });

  // v1.10.62 — reported (#53, @sangwanmail-eng): "Notifications should clear
  // after check."
  //
  // They never did, and the reason is that these are not messages — they are
  // computed live from your data every time the app loads ("3 invoices are
  // overdue", "2 products are low on stock"). There was no notion of having
  // read one, so the badge simply reported what was true and stayed lit
  // forever.
  //
  // Marking them read cannot just hide them, though: if an invoice goes
  // overdue tomorrow you must be told, even if you dismissed yesterday's
  // overdue notice. So dismissal is recorded per section as a SIGNATURE of
  // what was actually shown — the specific invoice numbers, the specific
  // products. Dismissing stores that signature; the section stays quiet only
  // while the signature is unchanged. The moment the underlying facts differ
  // — a new overdue invoice, a different product running low — the signature
  // changes and the alert comes back on its own.
  //
  // Kept in localStorage: it is a per-machine reading preference, not
  // business data, and it must not travel in a backup or sync to another PC.
  const DISMISS_KEY = 'fgsb_dismissedNotifs';
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const notifSignatures = useMemo(
    () => ({
      overdue: notifications.overdue
        .map((b) => b.invoiceNumber || b.id)
        .sort()
        .join('|'),
      dueSoon: notifications.dueSoon
        .map((b) => b.invoiceNumber || b.id)
        .sort()
        .join('|'),
      lowStock: notifications.lowStock
        .map((p) => `${p.id || p.name}:${p.stock ?? ''}`)
        .sort()
        .join('|'),
      filings: notifications.filings
        .map((f) => f.label || f.id || String(f))
        .sort()
        .join('|'),
      autoFire: notifications.autoFire?.count > 0 ? `autofire:${notifications.autoFire.count}` : '',
    }),
    [notifications],
  );

  // A section counts toward the badge only when it has content AND that
  // content is not the exact thing the user already dismissed.
  const isLive = (key) => !!notifSignatures[key] && dismissed[key] !== notifSignatures[key];

  const notifTotal =
    (isLive('overdue') ? notifications.overdue.length : 0) +
    (isLive('dueSoon') ? notifications.dueSoon.length : 0) +
    (isLive('lowStock') ? notifications.lowStock.length : 0) +
    (isLive('filings') ? notifications.filings.length : 0) +
    (isLive('autoFire') ? 1 : 0);

  // How many sections are currently showing something that could be cleared.
  const dismissableCount = ['overdue', 'dueSoon', 'lowStock', 'filings', 'autoFire'].filter(
    isLive,
  ).length;

  const markAllNotifsRead = () => {
    const next = { ...dismissed, ...notifSignatures };
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  // The server works out what is overdue, due soon and possibly low on stock (one small call; before, the browser downloaded
  // every bill and product to do it on every screen change). It is asked on start, every 10 minutes, and when the screen
  // changes only if something was saved since it was last asked, so the bell still updates after a payment is recorded.
  const lastAsked = useRef({ at: 0, version: -1 });
  const alive = useRef(true);
  const compute = useCallback(async () => {
    try {
      lastAsked.current = { at: Date.now(), version: dataVersion() };
      // Local dates: toISOString() is UTC (yesterday in India until 05:30).
      const today = localToday();
      const sum = await notificationSummary(today, 3);
      if (!alive.current) return;
      // Honour the user's stock-alert preferences: when disabled nothing is low; when enabled each product's own minimum
      // (if that setting is on) or the shared threshold decides.
      const threshold = Number(sum.stockAlert?.threshold ?? 5);
      const settings = getAllAppSettings();
      const lowStock = sum.stockAlert?.enabled === false ? [] : sum.lowStock.filter((p) => (p.stock ?? 999) <= lowStockLimit(p, settings, threshold));
      // Recurring auto-fire breadcrumb: only today's counts, older ones would stay sticky forever.
      const af = sum.autoFire;
      setNotifications({
        overdue: sum.overdue,
        dueSoon: sum.dueSoon,
        lowStock,
        filings: getUpcomingFilings().filter((f) => f.daysAway <= 10),
        autoFire: af && af.date === today && af.count > 0 ? af : null,
      });
    } catch {
      /* offline / server down: leave previous counts */
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const id = setInterval(compute, 10 * 60 * 1000);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [compute]);
  useEffect(() => {
    const unchanged = lastAsked.current.version === dataVersion() && Date.now() - lastAsked.current.at < 10 * 60 * 1000;
    if (!unchanged) compute();
  }, [currentView, compute]);

  return { notifications, isLive, notifTotal, dismissableCount, markAllNotifsRead };
}
