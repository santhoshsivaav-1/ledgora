import { useEffect, useRef, useState } from 'react';
import { getInvoiceDisplayOptions, saveInvoiceDisplayOptions } from '../../../lib/data';
import { invoiceOptionOn } from '../../../utils';
import { DEFAULT_OPTIONS } from './editorConstants';
import { optionDefaultsFrom } from './settingsDefaults';
import { getAllAppSettings } from '../../../lib/appSettings';

// The Customize panel's options — columns, sections, paper size, currency, TDS/TCS, recurring — in one object.
// Persisted to localStorage on every change and to the server with a debounce, and merged with the saved server
// defaults on mount. The page passes in the draft (a restored draft keeps its own choices) and the bill being
// edited (a saved bill's own options win over the user's defaults).
export function useInvoiceOptions({ draft, editingBill, hasInitialized }) {
  // v1.10.75 - a saved bill's options are that bill's, not the defaults for
  // new invoices. Opening an old bill used to write its options back as the
  // defaults (the persist effect below) and then let the server defaults
  // replace the bill's own (the mount load below), so a bill saved without
  // round-off could come back rounded, with a different total, and the
  // Settings switch flipped itself.
  const editingSaved = !!editingBill?.data && !editingBill?._isDuplicate;
  const draftOptions = useRef(draft?.invoiceOptions || {});
  const [invoiceOptions, setInvoiceOptions] = useState(() => {
    try {
      const saved = localStorage.getItem('freegstbill_invoiceOptions');
      const persisted = saved ? JSON.parse(saved) : {};
      // v1.10.20 — paymentAccountSnapshot is per-bill data (frozen bank
      // details at time of save). It must NEVER be inherited via the
      // user-preference stores (localStorage / server). Strip on read so
      // opening Invoice B doesn't pick up Invoice A's snapshot.
      delete persisted.paymentAccountSnapshot;
      // Persisted options are the user's defaults, draft can override for in-progress work
      return { ...DEFAULT_OPTIONS, ...persisted, ...optionDefaultsFrom(getAllAppSettings()), ...(draft?.invoiceOptions || {}) };
    } catch { return draft?.invoiceOptions || { ...DEFAULT_OPTIONS }; }
  });
  const [showOptions, setShowOptions] = useState(false);

  // Persist options — v1.10.4 audit M16.
  // Prior: every checkbox flip fired an immediate `/api/display-options`
  // POST. Wiggling a toggle 10× → 10 network requests. localStorage
  // stays synchronous (needed for reload persistence); the server POST
  // is now debounced 800ms so quick option-tweak spins settle to one
  // request.
  const optionsPersistTimer = useRef(null);
  useEffect(() => {
    if (editingSaved) return undefined;
    // v1.10.20 — Strip paymentAccountSnapshot before persisting. It's per-
    // bill data (bank details frozen at save time), not a user preference.
    // Prior code auto-persisted the entire invoiceOptions to localStorage
    // AND to the server, so opening Invoice A (Bank X snapshot) polluted
    // both stores, and opening Invoice B inherited Bank X — defeating the
    // v1.10.19 backfill entirely.
    const { paymentAccountSnapshot: _snap, ...persistable } = invoiceOptions;
    localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(persistable));
    if (hasInitialized.current) {
      clearTimeout(optionsPersistTimer.current);
      optionsPersistTimer.current = setTimeout(() => {
        saveInvoiceDisplayOptions(persistable).catch(() => {});
      }, 800);
    }
    return () => clearTimeout(optionsPersistTimer.current);
  }, [invoiceOptions, editingSaved]);

  // Load saved display options from server on mount (overrides localStorage if available)
  useEffect(() => {
    if (editingSaved) return; // the bill's own options win (see above)
    getInvoiceDisplayOptions().then(serverOpts => {
      if (serverOpts) {
        // v1.10.20 — Strip cross-invoice bleed-through of paymentAccountSnapshot
        // from any stale server-persisted options (pre-v1.10.20 clients would
        // have posted it). Preserves the current bill's snapshot in `prev`.
        delete serverOpts.paymentAccountSnapshot;
        // v1.10.77 - a restored draft keeps its own choices (design, columns
        // ...); the saved defaults only fill what it does not set. They used
        // to replace the draft's options a moment after a page refresh.
        const merged = { ...DEFAULT_OPTIONS, ...serverOpts, ...optionDefaultsFrom(getAllAppSettings()), ...draftOptions.current };
        setInvoiceOptions(prev => {
          // Only update if different to avoid unnecessary re-renders
          const changed = Object.keys(merged).some(k => merged[k] !== prev[k]);
          if (changed) {
            // Preserve the per-bill snapshot from prev when applying server defaults.
            const nextOpts = { ...merged, paymentAccountSnapshot: prev.paymentAccountSnapshot };
            const { paymentAccountSnapshot: _skip, ...toPersist } = nextOpts;
            localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(toPersist));
            return nextOpts;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, [editingSaved]);

  const toggleOption = (key) => {
    setInvoiceOptions(prev => ({ ...prev, [key]: !invoiceOptionOn(prev, key) }));
  };

  return { invoiceOptions, setInvoiceOptions, showOptions, setShowOptions, toggleOption };
}
