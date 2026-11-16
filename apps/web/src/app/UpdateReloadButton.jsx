// v1.10.81 — "New version" reload button, bottom-right of every screen.
//
// Reported: "when the application is deployed the website keeps using the
// old version; add auto reload or a reload button in the bottom right and
// when I click reload it should give the new version."
//
// Why a tab could stay old even though the deploy succeeded: a signed-in tab
// is a single-page app — React Router swaps screens without the full-page
// navigation the browser needs to check the service worker for an update, so
// until that check happens the old build (and its old precache) is what is
// served, indefinitely. main.jsx now polls the registration for that check;
// this button is the manual, always-there version of the same thing:
//
//   1. If an update is already waiting, apply it — the controllerchange
//      reload armed in main.jsx puts the new version up.
//   2. Otherwise ask the service-worker registration to update(): if the
//      server has a newer build, its SW installs (skipWaiting), claims the
//      tab and that same armed reload fires.
//   3. If even that fails (a stuck SW from an older release, for example),
//      hard reset: delete every Cache-Storage bucket, unregister the service
//      workers, re-fetch the current page past the HTTP cache ('reload', the
//      cache mode that also refreshes the cached entry), then reload — the
//      next boot re-registers the SW from the network, so what comes up is
//      whatever is deployed, old caches or not.
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import pkg from '../../package.json';
import { toast } from '../components/ui/Toast';

export default function UpdateReloadButton() {
  // An update was found (main.jsx flips `__fgsbSwUpdateReady` and fires
  // `fgsb-sw-update-ready`) — highlight the button so a user mid-form, who the
  // auto-reload is politely waiting for, can see there is one and apply it now.
  const [ready, setReady] = useState(() => !!window.__fgsbSwUpdateReady);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Queued, not synchronous: an update found between the first render and
    // this effect still highlights the button, without a cascading render.
    const sync = () => {
      if (window.__fgsbSwUpdateReady) setReady(true);
    };
    queueMicrotask(sync);
    const onReady = () => setReady(true);
    window.addEventListener('fgsb-sw-update-ready', onReady);
    return () => window.removeEventListener('fgsb-sw-update-ready', onReady);
  }, []);

  const applyPendingSwUpdate = () => {
    window.__fgsbSwUpdateReady = false;
    window.__fgsbApplyUpdate?.();
  };

  // Cut the device off from every cached copy this build made, so the reload
  // can only be served from the server. `cache: 'reload'` re-fetches the page
  // unconditionally AND replaces its HTTP-cache entry (location.reload() alone
  // may serve the stale one; a Ctrl+F5 has no scriptable equivalent).
  const hardReset = async () => {
    try {
      if ('caches' in window) {
        await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      await fetch(window.location.href, { cache: 'reload', credentials: 'same-origin' });
    } catch {
      /* offline or blocked: reload anyway — nothing cached can be trusted */
    }
    window.location.reload();
  };

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    // A service-worker update is waiting (auto-detected or a previous check
    // found it): activate && reload via the shared main.jsx flow.
    if (window.__fgsbSwUpdateReady && window.__fgsbApplyUpdate) return applyPendingSwUpdate();
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        toast('Checking for updates…', 'info');
        await reg.update().catch(() => {});
        // Did the check hand us a pending update? The new worker may need a
        // beat to claim the tab (which triggers main.jsx's armed reload —
        // if that happens these steps never finish anyway).
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (window.__fgsbSwUpdateReady && window.__fgsbApplyUpdate) return applyPendingSwUpdate();
        // The server has nothing newer than what this SW registers. A reload
        // is still asked for by name — the hard reset below honours it and
        // also cleans up cache shapes an old release may have left behind.
        toast(`Already on the latest version (v${pkg.version}). Reloading anyway…`, 'info');
      }
    } catch {
      /* no service worker (first visit / private mode): the hard reset covers it */
    }
    await hardReset();
    setBusy(false); // unreachable while the page unloads; keeps UI sane if reload was blocked
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={`Load the newest version of the app (this build: v${pkg.version})`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: ready ? '0.55rem 0.95rem' : '0.5rem',
        borderRadius: 999,
        border: ready ? '1px solid #16a34a' : '1px solid var(--border)',
        background: ready ? '#ecfdf5' : 'var(--card-bg)',
        color: ready ? '#065f46' : 'var(--text-muted)',
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: busy ? 'wait' : 'pointer',
        boxShadow: ready ? '0 6px 20px rgba(22,163,74,0.28)' : '0 2px 8px rgba(0,0,0,0.10)',
      }}
    >
      <RefreshCw size={ready ? 16 : 15} className={busy ? 'spin' : undefined} />
      {ready && <span>New version — reload</span>}
    </button>
  );
}
