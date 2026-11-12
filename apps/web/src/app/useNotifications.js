import { useEffect, useMemo, useState } from 'react';
import { getAllBills, getAllProducts, getStockAlertSettings } from '../lib/data';
import { getAllAppSettings } from '../lib/appSettings';
import { lowStockLimit } from '../features/items/itemFields';
import { getUpcomingFilings, countsAsSales, localToday, toLocalIsoDate } from '../utils';

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

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      try {
        const [bills, products, stockAlertCfg] = await Promise.all([
          getAllBills().catch(() => []),
          getAllProducts().catch(() => []),
          getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
        ]);
        if (cancelled) return;
        // Local dates: toISOString() is UTC (yesterday in India until 05:30),
        // while the server stamps lastRecurringAutoFire with its local date.
        const today = localToday();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 3);
        const tomorrowStr = toLocalIsoDate(tomorrow);
        // v1.10.67 (#66 item 12) — never chase payment for a cancelled invoice;
        // nor for a quotation, proforma, challan or credit note (countsAsSales).
        const overdue = bills.filter((b) => {
          const d = b.data?.details?.dueDate;
          return d && d < today && b.status !== 'paid' && countsAsSales(b);
        });
        const dueSoon = bills.filter((b) => {
          const d = b.data?.details?.dueDate;
          return d && d >= today && d <= tomorrowStr && b.status !== 'paid' && countsAsSales(b);
        });
        // Honour the user's stock-alert preferences. When disabled, the filter
        // returns nothing — bell badge drops to 0 for the stock category.
        // When enabled, use the configured threshold (default 5).
        const stockThreshold = Number(stockAlertCfg?.threshold ?? 5);
        const lowStock =
          stockAlertCfg?.enabled === false
            ? []
            : products.filter((p) => (p.stock ?? 999) <= lowStockLimit(p, getAllAppSettings(), stockThreshold));
        const filings = getUpcomingFilings().filter((f) => f.daysAway <= 10);
        // Recurring auto-fire breadcrumb — set by server.js processDueRecurring().
        // Only "fresh" (today's) auto-fires count as a notification; older ones
        // would otherwise stay sticky forever.
        let autoFire = null;
        try {
          const r = await fetch('/v1/workspace/meta/lastRecurringAutoFire');
          if (r.ok) {
            const j = await r.json();
            if (j.value && j.value.date === today && j.value.count > 0) autoFire = j.value;
          }
        } catch {
          /* fine */
        }
        setNotifications({ overdue, dueSoon, lowStock, filings, autoFire });
      } catch {
        /* offline / server down — leave previous counts */
      }
    };
    compute();
    const interval = setInterval(compute, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentView]); // recompute on view change so the bell stays fresh after the user records a payment

  return { notifications, isLive, notifTotal, dismissableCount, markAllNotifsRead };
}
