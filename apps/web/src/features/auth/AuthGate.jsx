import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStartup, signOut as apiSignOut } from '../../services/session';
import { configureApiClient, forgetReads, rememberRead } from '../../lib/apiClient';
import { flushPrintSettings } from '../print/printSettingsStore';
import { applyPrefs, clearMirroredPrefs, flushMirroredPrefs, startMirroring } from '../../utils/prefsMirror';
import LoginScreen from './LoginScreen';
import Landing from '../landing/Landing';
import BusinessSetup from './BusinessSetup';
import PlansScreen from './PlansScreen';
import FirstInvoiceGuide from '../onboarding/FirstInvoiceGuide';
import { SessionContext } from './SessionContext';
import './auth.css';

// Everything behind sign-in. Decides, on every load, which screen to show, in this order:
//   loading     asking the server who we are
//   login       nobody is signed in (also where Log out lands)
//   plans       a new owner who has not yet started the trial or chosen Free
//   onboarding  the business setup is not finished yet
//   guide       just finished setup: add a customer and an item, then the first invoice
//   ended       (owner, once per sign-in) the trial or paid plan has ended: plans again, or carry on with Free
//   the app     signed in and set up
const GUIDE_KEY = 'ledgora_first_invoice_guide';
const ENDED_KEY = 'ledgora_plan_ended_seen';
const flag = (k) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const seen = (k) => { try { return sessionStorage.getItem(k) === '1'; } catch { return false; } };
export default function AuthGate({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | error | out | plans | onboarding | guide | ended | in
  const [me, setMe] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [problem, setProblem] = useState('');

  const refresh = useCallback(async () => {
    try {
      // One call answers who we are, the set-up state, this person's saved screen settings and the businesses.
      const boot = await getStartup();
      if (!boot) { setMe(null); setPhase('out'); return; }
      const { me: who, onboarding: ob } = boot;
      // This person's saved screen settings (print layout, region, ...) are back before the app draws.
      if (ob.complete) {
        applyPrefs(boot.prefs);
        startMirroring(boot.prefs !== null, boot.prefs);
      }
      // The screens that list the businesses find them already here.
      if (boot.businesses) rememberRead('/v1/businesses', { data: boot.businesses });
      setMe(who);
      setOnboarding(ob);
      const ent = who.entitlements;
      const owner = who.role === 'owner';
      // Someone who signed up to join a team opens the invitation first: they are not choosing a plan or setting up
      // a business of their own. After accepting, the shared business is active and needs neither.
      const joining = window.location.pathname.startsWith('/accept-invite/');
      if (joining) setPhase('in');
      else if (owner && ent?.needsPlan) setPhase('plans');
      else if (!ob.complete) setPhase('onboarding');
      else if (flag(GUIDE_KEY)) setPhase('guide');
      // The timeline check at sign-in: an owner whose trial or plan has run out sees the plans once before the app.
      else if (owner && (ent?.locked || ent?.expired) && !seen(ENDED_KEY)) setPhase('ended');
      else setPhase('in');
    } catch (e) {
      setProblem(e.message);
      setPhase('error');
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the first call decides which screen to show
  useEffect(() => { refresh(); }, [refresh]);

  // Any data request answered 401 (session ended elsewhere, expired, revoked) sends the user back to sign-in.
  useEffect(() => {
    configureApiClient({
      onUnauthorized: () => {
        // The session ended: the offline copy of billing data must not outlive it on a shared computer.
        try { caches?.delete('api-cache'); } catch { /* no Cache API */ }
        forgetReads();
        setMe(null);
        setPhase('out');
      },
    });
  }, []);

  const signOut = useCallback(async () => {
    await flushMirroredPrefs(); // while the session is still valid
    await flushPrintSettings();
    try { await apiSignOut(); } catch { /* already signed out: same result for the user */ }
    // Do not keep the last user's half-typed invoice or last-open screen for the next person on this browser.
    try { sessionStorage.clear(); } catch { /* private window */ }
    clearMirroredPrefs();
    // The offline copy of the last user's billing data goes too, so the next person on this browser cannot read it.
    try { await caches?.delete('api-cache'); } catch { /* no Cache API */ }
    setMe(null);
    setOnboarding(null);
    setPhase('out');
  }, []);

  const value = useMemo(() => ({ me, signOut, refresh }), [me, signOut, refresh]);

  // Someone already signed in who opens /login or /signup is taken to the app.
  useEffect(() => {
    if (phase === 'in' && /^\/(login|signin|signup|register|forgot-password)\/?$/.test(window.location.pathname)) window.history.replaceState({}, '', '/');
  }, [phase]);

  if (phase === 'loading') return <div className="auth-shell"><div className="auth-card auth-muted">Loading…</div></div>;
  if (phase === 'error') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Can't reach the server</h1>
          <p className="auth-muted">{problem}</p>
          <button type="button" className="btn btn-primary auth-wide" onClick={() => { setPhase('loading'); refresh(); }}>Try again</button>
        </div>
      </div>
    );
  }
  if (phase === 'out') {
    // The landing page is the front door at "/" (a plain visit, not a link carrying a reset or sign-in token); the sign-in,
    // sign-up and forgot-password screens have their own addresses, and any other address someone was sent to asks them to sign in.
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' && !window.location.search) return <Landing />;
    return <LoginScreen onSignedIn={refresh} />;
  }
  if (phase === 'plans' || phase === 'ended') {
    return (
      <SessionContext.Provider value={value}>
        <PlansScreen mode={phase === 'ended' ? 'ended' : 'start'} owner={me?.role === 'owner'}
          onDone={() => { if (phase === 'ended') { try { sessionStorage.setItem(ENDED_KEY, '1'); } catch { /* private window */ } } refresh(); }}
          onSignOut={signOut} />
      </SessionContext.Provider>
    );
  }
  if (phase === 'onboarding') {
    return (
      <SessionContext.Provider value={value}>
        <BusinessSetup me={me} business={onboarding.business}
          onDone={() => { try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* private window */ } refresh(); }} onSignOut={signOut} />
      </SessionContext.Provider>
    );
  }
  if (phase === 'guide') {
    return (
      <SessionContext.Provider value={value}>
        <FirstInvoiceGuide onFinish={(create) => {
          try { localStorage.removeItem(GUIDE_KEY); } catch { /* private window */ }
          if (create) window.history.replaceState({}, '', '/invoices/new');
          refresh();
        }} />
      </SessionContext.Provider>
    );
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
