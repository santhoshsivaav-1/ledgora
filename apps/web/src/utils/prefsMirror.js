// v1.10.77 (#84) - settings that lived ONLY in this browser's storage are now
// also kept in the app's data folder, and put back if the browser loses them.
//
// Reported: "Welcome to Free GST Billing pops up repeatedly" and "Region
// Preference saved as India is back to Both/Auto after a restart". Print &
// PDF settings (including "setup finished"), Region, Features, custom units,
// GST "filed" marks and the income-tax inputs were stored only in the
// browser. A browser that clears site data on exit (Brave can), a cleared
// cache, or the app starting on another port (a new origin, so an empty
// storage) lost them all: the wizard came back and everything reset.
//
// Kept local AND mirrored: reads stay instant and offline; the copy in the
// copy on the server (per person, /v1/workspace/local-prefs) is restored after sign-in, before the app first
// renders, for keys the browser no longer has. Signing out clears them from this browser (clearMirroredPrefs).

const MIRRORED = /^(gst_regionMode|gst_enabledModules|gst_customUnits|gst_dashboardColumns|gst_filing_status(_.*)?|gst_itr[A-Za-z]*|freegstbill_onboarded|freegstbill_theme|freegstbill_startedDismissed|freegstbill_supportNudge|freegstbill_starBanner|freegstbill_sidebarAutoHide)$/;
const ENDPOINT = '/v1/workspace/local-prefs';

export const isMirrored = (key) => MIRRORED.test(String(key));

// Missing keys come back from the data folder; keys the browser has win.
// Returns true only when the data-folder copy was read.
export async function restorePrefs() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500); // never hold up start-up
    const res = await fetch(ENDPOINT, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const { value } = await res.json();
    for (const [k, v] of Object.entries(value || {})) {
      if (isMirrored(k) && typeof v === 'string' && localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }
    return true;
  } catch {
    return false; // server not reachable yet: the browser copy is used as is
  }
}

// Changed keys since the last write; only these are sent, and the server
// merges them, so nothing this browser did not touch is ever replaced.
const dirty = new Set();
let timer = null;
const push = () => {
  const set = {};
  const remove = [];
  if (dirty.size === 0) return Promise.resolve();
  try {
    for (const k of dirty) {
      const v = localStorage.getItem(k);
      if (v === null) remove.push(k); else set[k] = v;
    }
  } catch { return Promise.resolve(); }
  dirty.clear();
  return fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set, remove }) }).catch(() => {});
};
let paused = false;
const touch = (k) => { if (paused) return; dirty.add(k); clearTimeout(timer); timer = setTimeout(push, 600); };

// Every write or removal of a mirrored key, from anywhere in the app, updates
// the copy in the data folder (one write per burst of changes). Only after a
// successful restore: had the server been unreachable at start, this browser
// may hold first-run defaults, which must never replace the saved copy.
let installed = false;
export function startMirroring(restored) {
  if (!restored || installed) return;
  installed = true;
  try {
    const proto = Object.getPrototypeOf(localStorage);
    const set = proto.setItem;
    const remove = proto.removeItem;
    proto.setItem = function setItem(k, v) { set.call(this, k, v); if (this === window.localStorage && isMirrored(k)) touch(k); };
    proto.removeItem = function removeItem(k) { remove.call(this, k); if (this === window.localStorage && isMirrored(k)) touch(k); };
    // Seed the data-folder copy with what this browser has now (after the
    // restore it holds everything the copy had, plus its own newer values).
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (isMirrored(k)) touch(k);
    }
  } catch { /* storage blocked: nothing to mirror */ }
}

// Sign-out: the next person to use this browser must not inherit this person's settings. Removing the keys must not be
// mirrored (that would delete them from the server copy), so mirroring is paused while it happens.
export function clearMirroredPrefs() {
  paused = true;
  try {
    for (const k of Object.keys(localStorage)) if (isMirrored(k)) localStorage.removeItem(k);
  } catch { /* storage blocked */ } finally {
    paused = false;
    dirty.clear();
    clearTimeout(timer);
  }
}

// Sign-out: send what has changed in the last moments now, instead of after the usual short delay, so nothing is lost.
export function flushMirroredPrefs() {
  clearTimeout(timer);
  return push();
}
