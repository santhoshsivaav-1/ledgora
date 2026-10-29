import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { INDIAN_STATES, getStateCode } from '../../utils';
import { getProfile, saveProfile } from '../../store';
import { ApiError, saveOnboarding } from '../../services/session';

function Field({ f, set, fieldErrors, id, label, required = false, className = '', ...rest }) {
  return (
    <div className={`form-group ${className}`}>
      <label className="form-label" htmlFor={`ob-${id}`}>{label}</label>
      <input id={`ob-${id}`} className="form-input" value={f[id]} onChange={set(id)} required={required} aria-invalid={!!fieldErrors[id]} {...rest} />
      {fieldErrors[id] && <div className="auth-field-error">{fieldErrors[id]}</div>}
    </div>
  );
}

// First-run form, shown once after sign-up: who is the business and where (the state drives CGST/SGST vs IGST).
export default function OnboardingScreen({ me, business, onDone, onSignOut }) {
  const [f, setF] = useState({
    name: business.name || '', gstin: business.gstin || '', state: business.state || '', address: business.address || '',
    city: business.city || '', pin: business.pin || '', phone: business.phone || me?.user?.phoneNumber || '', email: business.email || me?.user?.email || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Someone who used the old single-user app has a saved profile on this computer: start from it.
  useEffect(() => {
    let live = true;
    getProfile().then((p) => {
      if (!live || !p?.businessName) return;
      setF((s) => ({
        ...s,
        name: s.name.endsWith("'s Business") ? p.businessName : s.name,
        gstin: s.gstin || p.gstin || '', state: s.state || p.state || '', address: s.address || p.address || '',
        city: s.city || p.city || '', pin: s.pin || p.pin || '', phone: s.phone || p.phone || '',
      }));
    }).catch(() => { /* no old data: the form stays as it is */ });
    return () => { live = false; };
  }, []);

  // Typing a GSTIN picks the state it belongs to.
  const onGstin = (e) => {
    const gstin = e.target.value.toUpperCase();
    setF((s) => {
      const code = gstin.length >= 2 ? getStateCode(gstin) : '';
      const match = code ? INDIAN_STATES.find((st) => getStateCode(st) === code) : '';
      return { ...s, gstin, state: match || s.state };
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setFieldErrors({});
    try {
      const saved = await saveOnboarding({ ...f, gstin: f.gstin.trim() });
      // The billing screens still read the profile saved on this computer; keep both in step.
      try {
        const old = (await getProfile()) || {};
        await saveProfile({ ...old, businessName: saved.business.name, gstin: saved.business.gstin || '', state: saved.business.state, address: saved.business.address, city: saved.business.city, pin: saved.business.pin, phone: saved.business.phone, email: saved.business.email, country: 'India' });
      } catch { /* the old server is not running: the account copy is saved */ }
      onDone();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      }
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card auth-card-wide glass-panel" onSubmit={submit}>
        <div className="auth-brand">Ledgora</div>
        <h1 className="auth-title">Tell us about your business</h1>
        <p className="auth-muted">This appears on your invoices and decides how GST is split. You can change it later in Settings.</p>
        <div className="auth-grid">
          <Field f={f} set={set} fieldErrors={fieldErrors} id="name" label="Business name" required className="auth-span2" autoFocus />
          <Field f={f} set={set} fieldErrors={fieldErrors} id="gstin" label="GSTIN (leave blank if not registered)" value={f.gstin} onChange={onGstin} maxLength={15} placeholder="33AAAAA0000A1Z5" />
          <div className="form-group">
            <label className="form-label" htmlFor="ob-state">State</label>
            <select id="ob-state" className="form-input" value={f.state} onChange={set('state')} required aria-invalid={!!fieldErrors.state}>
              <option value="">Choose…</option>
              {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {fieldErrors.state && <div className="auth-field-error">{fieldErrors.state}</div>}
          </div>
          <Field f={f} set={set} fieldErrors={fieldErrors} id="address" label="Address" className="auth-span2" />
          <Field f={f} set={set} fieldErrors={fieldErrors} id="city" label="City" />
          <Field f={f} set={set} fieldErrors={fieldErrors} id="pin" label="PIN code" inputMode="numeric" maxLength={6} />
          <Field f={f} set={set} fieldErrors={fieldErrors} id="phone" label="Business phone" type="tel" />
          <Field f={f} set={set} fieldErrors={fieldErrors} id="email" label="Business e-mail" type="email" />
        </div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="auth-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
          <button type="button" className="auth-link" onClick={onSignOut}><LogOut size={14} /> Log out</button>
        </div>
      </form>
    </div>
  );
}
