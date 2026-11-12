import { useEffect, useState } from 'react';
import { LogOut, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { INDIAN_STATES, getStateCode, decodeGstin } from '../../utils';
import { getProfile, saveProfile } from '../../lib/data';
import { apiClient } from '../../lib/apiClient';
import { ApiError, saveOnboarding } from '../../services/session';
import { STEPS, stepProblem, settingsFrom, profileFrom } from './setupRules';
import { useT } from '../../i18n';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Field({ f, set, errors, id, label, hint, children, className = '', ...rest }) {
  return (
    <div className={`form-group ${className}`}>
      <label className="form-label" htmlFor={`bs-${id}`}>{label}</label>
      {children || <input id={`bs-${id}`} className="form-input" value={f[id]} onChange={set(id)} aria-invalid={!!errors[id]} {...rest} />}
      {hint && <div className="auth-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.75rem' }}>{hint}</div>}
      {errors[id] && <div className="auth-field-error" role="alert">{errors[id]}</div>}
    </div>
  );
}

// The full business setup, once, right after the plan choice: everything the product needs to run (who you are and where,
// how you are registered, how you get paid, and what a new invoice starts with). Four short steps, nothing skipped by accident.
export default function BusinessSetup({ me, business, onDone, onSignOut }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: business.name || '', gstin: business.gstin || '', state: business.state || '', regType: business.gstin ? 'regular' : 'unregistered', compRate: '1', bizType: 'retail', bizCategory: '',
    address: business.address || '', city: business.city || '', pin: business.pin || '', phone: business.phone || me?.user?.phoneNumber || '', email: business.email || me?.user?.email || '',
    bankName: '', accountNumber: '', ifsc: '', upiId: '', fyStart: '4',
    defaultGst: '18', taxInclusive: false, terms: 'Goods once sold will not be taken back.\nPayment is due within the agreed days.',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const tr = useT();
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // Someone who used the old single-user app has a profile saved on this computer: start from it.
  useEffect(() => {
    let live = true;
    getProfile().then((p) => {
      if (!live || !p?.businessName) return;
      setF((s) => ({ ...s, name: s.name.endsWith("'s Business") ? p.businessName : s.name, gstin: s.gstin || p.gstin || '', state: s.state || p.state || '', address: s.address || p.address || '', city: s.city || p.city || '', pin: s.pin || p.pin || '', phone: s.phone || p.phone || '', bankName: p.bankName || '', accountNumber: p.accountNumber || '', ifsc: p.ifsc || '', upiId: p.upiId || '' }));
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  // A GSTIN picks the state it belongs to and says so when its check digit is wrong.
  const onGstin = (e) => {
    const gstin = e.target.value.toUpperCase();
    setF((s) => {
      const code = gstin.length >= 2 ? getStateCode(gstin) : '';
      const match = code ? INDIAN_STATES.find((st) => getStateCode(st) === code) : '';
      return { ...s, gstin, state: match || s.state, regType: gstin && s.regType === 'unregistered' ? 'regular' : s.regType };
    });
  };
  const decoded = f.gstin.trim().length === 15 ? decodeGstin(f.gstin.trim()) : null;
  const gstinOk = !!decoded && decoded.checksumOk;

  const next = () => {
    const p = stepProblem(STEPS[step].id, f, gstinOk);
    if (p) { setErrors({ [p.field]: p.message }); return; }
    setErrors({}); setError(''); setStep((n) => n + 1);
  };

  const finish = async (e) => {
    e.preventDefault();
    const p = stepProblem('defaults', f, gstinOk);
    if (p) { setErrors({ [p.field]: p.message }); return; }
    setBusy(true); setError(''); setErrors({});
    try {
      // Settings and the print profile first; the business record last, because saving it is what marks setup complete.
      await apiClient.patch('/v1/settings', { businessId: business.id, values: settingsFrom(f) });
      const old = (await getProfile().catch(() => null)) || {};
      await saveProfile({ ...old, businessName: f.name.trim(), gstin: f.gstin.trim(), state: f.state, address: f.address, city: f.city, pin: f.pin, phone: f.phone, email: f.email, country: 'India', ...profileFrom(f) }).catch(() => {});
      await saveOnboarding({ name: f.name, gstin: f.gstin.trim(), state: f.state, address: f.address, city: f.city, pin: f.pin, phone: f.phone, email: f.email });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      setError(err?.message || 'Could not save. Try again.');
    } finally { setBusy(false); }
  };

  const id = STEPS[step].id;
  return (
    <div className="auth-shell">
      <form className="auth-card auth-card-wide glass-panel" onSubmit={finish} noValidate>
        <div className="auth-brand">Ledgora</div>
        <ol className="setup-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span>{i < step ? <Check size={12} /> : i + 1}</span> {s.title}
            </li>
          ))}
        </ol>

        {id === 'business' && (
          <>
            <h1 className="auth-title">{tr('setup.title', 'Tell us about your business')}</h1>
            <p className="auth-muted">This is printed on every invoice and decides how GST is split.</p>
            <div className="auth-grid">
              <Field f={f} set={set} errors={errors} id="name" label="Business name *" className="auth-span2" autoFocus />
              <Field f={f} set={set} errors={errors} id="regType" label="GST registration">
                <select id="bs-regType" className="form-input" value={f.regType} onChange={set('regType')}>
                  <option value="regular">Regular (collects GST)</option>
                  <option value="composition">Composition scheme</option>
                  <option value="unregistered">Not registered</option>
                </select>
              </Field>
              <Field f={f} set={set} errors={errors} id="gstin" label={`GSTIN${f.regType === 'unregistered' ? ' (optional)' : ' *'}`} value={f.gstin} onChange={onGstin} maxLength={15} placeholder="33AAAAA0000A1Z5"
                hint={decoded ? (gstinOk ? `Valid, registered in ${decoded.state || 'India'}` : 'The check digit does not match: look for a typo') : ''} />
              <Field f={f} set={set} errors={errors} id="state" label="State *">
                <select id="bs-state" className="form-input" value={f.state} onChange={set('state')} aria-invalid={!!errors.state}>
                  <option value="">Choose…</option>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field f={f} set={set} errors={errors} id="bizType" label="Type of business">
                <select id="bs-bizType" className="form-input" value={f.bizType} onChange={set('bizType')}>
                  <option value="retail">Retail shop</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="distributor">Distributor</option>
                  <option value="service">Services</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field f={f} set={set} errors={errors} id="bizCategory" label="What you sell (optional)" placeholder="e.g. Mobile phones" maxLength={60} />
              {f.regType === 'composition' && <Field f={f} set={set} errors={errors} id="compRate" label="Composition rate (%)" type="number" min="0" step="any" hint="1% for traders and manufacturers, 5% for restaurants, 6% for services" />}
            </div>
          </>
        )}

        {id === 'contact' && (
          <>
            <h1 className="auth-title">Address and contact</h1>
            <p className="auth-muted">Shown on invoices. Your phone and e-mail are used to send invoices and reminders.</p>
            <div className="auth-grid">
              <Field f={f} set={set} errors={errors} id="address" label="Address" className="auth-span2" autoFocus />
              <Field f={f} set={set} errors={errors} id="city" label="City" />
              <Field f={f} set={set} errors={errors} id="pin" label="PIN code" inputMode="numeric" maxLength={6} />
              <Field f={f} set={set} errors={errors} id="phone" label="Business phone" type="tel" />
              <Field f={f} set={set} errors={errors} id="email" label="Business e-mail" type="email" />
            </div>
          </>
        )}

        {id === 'money' && (
          <>
            <h1 className="auth-title">How you get paid, and your year</h1>
            <p className="auth-muted">Bank details and a UPI id print on invoices with a pay-by-UPI QR. You can add more accounts later.</p>
            <div className="auth-grid">
              <Field f={f} set={set} errors={errors} id="bankName" label="Bank name" autoFocus />
              <Field f={f} set={set} errors={errors} id="accountNumber" label="Account number" inputMode="numeric" />
              <Field f={f} set={set} errors={errors} id="ifsc" label="IFSC" maxLength={11} />
              <Field f={f} set={set} errors={errors} id="upiId" label="UPI id" placeholder="name@bank" />
              <Field f={f} set={set} errors={errors} id="fyStart" label="Your books start in" hint="GST returns and income tax always run April to March">
                <select id="bs-fyStart" className="form-input" value={f.fyStart} onChange={set('fyStart')}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Field>
            </div>
          </>
        )}

        {id === 'defaults' && (
          <>
            <h1 className="auth-title">What a new invoice starts with</h1>
            <p className="auth-muted">You can change any of these on a single invoice, and later in Settings.</p>
            <div className="auth-grid">
              <Field f={f} set={set} errors={errors} id="defaultGst" label="Usual GST rate (%)" type="number" min="0" max="100" step="any" autoFocus />
              <div className="form-group" style={{ alignSelf: 'end' }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={f.taxInclusive} onChange={set('taxInclusive')} /> My prices already include GST
                </label>
              </div>
              <Field f={f} set={set} errors={errors} id="terms" label="Terms and conditions on invoices" className="auth-span2">
                <textarea id="bs-terms" className="form-input" rows={3} maxLength={1000} value={f.terms} onChange={set('terms')} />
              </Field>
            </div>
          </>
        )}

        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="auth-actions">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {step > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setErrors({}); setStep((n) => n - 1); }}><ArrowLeft size={14} /> {tr('setup.back', 'Back')}</button>}
            <button type="button" className="auth-link" style={{ marginTop: 0 }} onClick={onSignOut}><LogOut size={14} /> {tr('common.logout', 'Log out')}</button>
          </div>
          {step < STEPS.length - 1
            ? <button type="button" className="btn btn-primary" onClick={next}>{tr('setup.next', 'Next')} <ArrowRight size={14} /></button>
            : <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : tr('setup.finish', 'Finish setup')}</button>}
        </div>
      </form>
    </div>
  );
}
