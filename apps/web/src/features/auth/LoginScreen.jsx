import { useState } from 'react';
import { Mail, Phone, ShieldCheck, ArrowLeft } from 'lucide-react';
import {
  ApiError, requestPasswordReset, resendVerification, resetPassword, sendPhoneCode, signInEmail, signUpEmail,
  verifyBackupCode, verifyPhoneCode, verifyTotp,
} from '../../services/session';

// Defined out here: a component declared inside another one is a new component on every keystroke, which drops focus.
function Field({ f, set, id, label, type = 'text', ...rest }) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>{label}</label>
      <input id={id} className="form-input" type={type} value={f[id]} onChange={set(id)} required {...rest} />
    </div>
  );
}

function Msg({ error, notice }) {
  return (
    <>
      {error && <div className="auth-error" role="alert">{error}</div>}
      {notice && <div className="auth-notice" role="status">{notice}</div>}
    </>
  );
}

const PHONE_RE = /^\+\d{8,15}$/;

// The sign-in landing page: e-mail or phone, sign up, forgot password and the two-factor step.
export default function LoginScreen({ onSignedIn }) {
  // A password-reset e-mail comes back to /?reset=1&token=...
  const resetToken = (() => {
    const q = new URLSearchParams(window.location.search);
    return q.get('reset') && q.get('token') ? q.get('token') : '';
  })();
  const [mode, setMode] = useState(resetToken ? 'reset' : 'signin'); // signin | signup | phone | forgot | reset | twofactor
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '+91', code: '', newPassword: '' });
  const [codeSent, setCodeSent] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const go = (m) => { setError(''); setMode(m); };

  const run = async (fn) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  };

  const goHome = () => {
    // Drop ?reset=1&token=... from the address bar once used.
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname);
    onSignedIn();
  };

  const signIn = (e) => { e.preventDefault(); run(async () => {
    try {
      const r = await signInEmail({ email: f.email.trim(), password: f.password });
      if (r?.twoFactorRedirect) { go('twofactor'); return; }
      goHome();
    } catch (err) {
      if (err.code === 'EMAIL_NOT_VERIFIED') { setNotice(''); setError(err.message); go('unverified'); return; }
      throw err;
    }
  }); };

  const signUp = (e) => { e.preventDefault(); run(async () => {
    if (f.password.length < 8) throw new ApiError('Use a password of at least 8 characters.');
    await signUpEmail({ name: f.name.trim() || f.email.split('@')[0], email: f.email.trim(), password: f.password });
    // E-mail confirmation is off: sign-up starts a session, so go straight on (the app opens onboarding).
    goHome();
  }); };

  const resend = () => run(async () => { await resendVerification(f.email.trim()); setNotice('We sent the link again.'); });

  const askCode = (e) => { e?.preventDefault(); run(async () => {
    if (!PHONE_RE.test(f.phone.trim())) throw new ApiError('Enter the number with country code, like +919876543210.');
    await sendPhoneCode(f.phone.trim());
    setCodeSent(true); setNotice(`We sent a 6-digit code to ${f.phone.trim()}.`);
  }); };

  const checkCode = (e) => { e.preventDefault(); run(async () => {
    await verifyPhoneCode({ phoneNumber: f.phone.trim(), code: f.code.trim() });
    goHome();
  }); };

  const twoFactor = (e) => { e.preventDefault(); run(async () => {
    await (useBackup ? verifyBackupCode(f.code.trim()) : verifyTotp(f.code.trim()));
    goHome();
  }); };

  const forgot = (e) => { e.preventDefault(); run(async () => {
    await requestPasswordReset(f.email.trim());
    go('check-mail-reset');
  }); };

  const reset = (e) => { e.preventDefault(); run(async () => {
    if (f.newPassword.length < 8) throw new ApiError('Use a password of at least 8 characters.');
    await resetPassword({ token: resetToken, newPassword: f.newPassword });
    window.history.replaceState({}, '', window.location.pathname);
    go('signin'); setNotice('Password changed. Sign in with the new one.');
  }); };

  const back = () => (
    <button type="button" className="auth-link auth-back" onClick={() => { go('signin'); setNotice(''); setCodeSent(false); setUseBackup(false); }}><ArrowLeft size={14} /> Back to sign in</button>
  );

  return (
    <div className="auth-shell">
      <div className="auth-card glass-panel">
        <div className="auth-brand">Ledgora</div>

        {(mode === 'signin' || mode === 'signup' || mode === 'phone') && (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => go('signin')}><Mail size={14} /> Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => go('signup')}>Create account</button>
            <button type="button" role="tab" aria-selected={mode === 'phone'} className={mode === 'phone' ? 'on' : ''} onClick={() => go('phone')}><Phone size={14} /> Phone</button>
          </div>
        )}

        {mode === 'signin' && (
          <form onSubmit={signIn}>
            <h1 className="auth-title">Welcome back</h1>
            <Field f={f} set={set} id="email" label="E-mail" type="email" autoComplete="email" autoFocus />
            <Field f={f} set={set} id="password" label="Password" type="password" autoComplete="current-password" />
            <Msg error={error} notice={notice} />
            <button className="btn btn-primary auth-wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" className="auth-link" onClick={() => go('forgot')}>Forgot password?</button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={signUp}>
            <h1 className="auth-title">Create your account</h1>
            <p className="auth-muted">Free for 14 days. We set up your business next.</p>
            <Field f={f} set={set} id="name" label="Your name" autoComplete="name" required={false} />
            <Field f={f} set={set} id="email" label="E-mail" type="email" autoComplete="email" />
            <Field f={f} set={set} id="password" label="Password (8+ characters)" type="password" autoComplete="new-password" minLength={8} />
            <Msg error={error} notice={notice} />
            <button className="btn btn-primary auth-wide" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          </form>
        )}

        {mode === 'phone' && (
          <form onSubmit={codeSent ? checkCode : askCode}>
            <h1 className="auth-title">Sign in with your phone</h1>
            <p className="auth-muted">New number? We create your account when you confirm the code.</p>
            <Field f={f} set={set} id="phone" label="Mobile number" type="tel" autoComplete="tel" placeholder="+919876543210" disabled={codeSent} />
            {codeSent && <Field f={f} set={set} id="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />}
            <Msg error={error} notice={notice} />
            <button className="btn btn-primary auth-wide" disabled={busy}>{busy ? 'Please wait…' : codeSent ? 'Confirm code' : 'Send code'}</button>
            {codeSent && <button type="button" className="auth-link" onClick={askCode}>Send a new code</button>}
          </form>
        )}

        {mode === 'twofactor' && (
          <form onSubmit={twoFactor}>
            <h1 className="auth-title"><ShieldCheck size={20} /> Two-step check</h1>
            <p className="auth-muted">{useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}</p>
            <Field f={f} set={set} id="code" label={useBackup ? 'Backup code' : 'Code'} autoComplete="one-time-code" autoFocus />
            <Msg error={error} notice={notice} />
            <button className="btn btn-primary auth-wide" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
            <button type="button" className="auth-link" onClick={() => { setUseBackup((v) => !v); setF((s) => ({ ...s, code: '' })); }}>{useBackup ? 'Use the authenticator app' : 'Use a backup code instead'}</button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={forgot}>
            <h1 className="auth-title">Reset your password</h1>
            <p className="auth-muted">We will e-mail you a link that works for one hour.</p>
            <Field f={f} set={set} id="email" label="E-mail" type="email" autoComplete="email" autoFocus />
            <Msg error={error} notice={notice} />
            <button className="btn btn-primary auth-wide" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
            {back()}
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={reset}>
            <h1 className="auth-title">Choose a new password</h1>
            <Field f={f} set={set} id="newPassword" label="New password (8+ characters)" type="password" autoComplete="new-password" minLength={8} autoFocus />
            <Msg error={error} notice={notice} />
            <button className="btn btn-primary auth-wide" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          </form>
        )}

        {(mode === 'check-mail' || mode === 'check-mail-reset' || mode === 'unverified') && (
          <div>
            <h1 className="auth-title">Check your e-mail</h1>
            <p className="auth-muted">
              {mode === 'check-mail-reset'
                ? <>If <b>{f.email}</b> has an account, a reset link is on its way.</>
                : <>We sent a confirmation link to <b>{f.email}</b>. Open it, then sign in.</>}
            </p>
            <Msg error={error} notice={notice} />
            {mode !== 'check-mail-reset' && <button type="button" className="btn btn-secondary auth-wide" disabled={busy} onClick={resend}>Send the link again</button>}
            {back()}
          </div>
        )}
      </div>
    </div>
  );
}
