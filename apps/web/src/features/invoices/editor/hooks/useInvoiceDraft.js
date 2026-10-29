import { useEffect } from 'react';

// The invoice being typed survives an accidental reload (change 3.9): it is kept in this tab's session storage,
// never in the invoices list. It is a draft only, so it is also the one thing that is allowed to stay on the device.
const KEY = 'gst_invoiceDraft';

/** The saved draft of this tab, or null. */
export function loadDraft() {
  try {
    const saved = sessionStorage.getItem(KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
}






export function clearDraft() {
  try { sessionStorage.removeItem(KEY); } catch { /* private window */ }
}

/** Saves `draftData` shortly after it stops changing (a trailing debounce, so typing is never slowed). */
export function useInvoiceDraft(draftData) {
  useEffect(() => {
    const t = setTimeout(() => {
      try { sessionStorage.setItem(KEY, JSON.stringify(draftData)); } catch { /* private mode / quota exceeded: skip */ }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller passes a fresh object each render; compare by content
  }, [JSON.stringify(draftData)]);
}
