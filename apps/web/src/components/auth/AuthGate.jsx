import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMe, getOnboarding, signOut as apiSignOut } from '../../services/session';
import LoginScreen from './LoginScreen';
import OnboardingScreen from './OnboardingScreen';
import { SessionContext } from './SessionContext';
import './auth.css';

// Everything behind sign-in. Decides, on every load, which of four screens to show:
//   loading     asking the server who we are
//   login       nobody is signed in (also where Log out lands)
//   onboarding  signed in, but the first-run business form is not filled in yet
//   the app     signed in and set up
export default function AuthGate({ children }) {
  const [phase, setPhase] = useState('loading'); // loading | error | out | onboarding | in
  const [me, setMe] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [problem, setProblem] = useState('');

  const refresh = useCallback(async () => {
    try {
      const who = await getMe();
      if (!who) { setMe(null); setPhase('out'); return; }
      const ob = await getOnboarding();
      setMe(who);
      setOnboarding(ob);
      setPhase(ob.complete ? 'in' : 'onboarding');
    } catch (e) {
      setProblem(e.message);
      setPhase('error');
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the first call decides which screen to show
  useEffect(() => { refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    try { await apiSignOut(); } catch { /* already signed out: same result for the user */ }
    // Do not keep the last user's half-typed invoice or last-open screen for the next person on this browser.
    try { sessionStorage.clear(); } catch { /* private window */ }
    setMe(null);
    setOnboarding(null);
    setPhase('out');
  }, []);

  const value = useMemo(() => ({ me, signOut, refresh }), [me, signOut, refresh]);

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
  if (phase === 'out') return <LoginScreen onSignedIn={refresh} />;
  if (phase === 'onboarding') {
    return (
      <SessionContext.Provider value={value}>
        <OnboardingScreen me={me} business={onboarding.business} onDone={refresh} onSignOut={signOut} />
      </SessionContext.Provider>
    );
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
