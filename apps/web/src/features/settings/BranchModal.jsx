import { useState } from 'react';
import { X, Building2 } from 'lucide-react';
import { INDIAN_STATES, getStateCode } from '../../utils';
import { ApiError, createBusiness } from '../../services/session';

// Add a branch: a new business (its own GSTIN, address and numbering) inside
// the organization you are signed in to. The branch is created on the account
// server, so every member of the organization sees it in their switcher (team
// members limited to some branches only see the ones they were given).
export default function BranchModal({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', gstin: '', state: '', address: '', city: '', pin: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  // Same shortcut as first-run onboarding: typing a GSTIN picks the state it belongs to.
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
      const saved = await createBusiness({ ...f, gstin: f.gstin.trim(), isDefault: false });
      onCreated(saved);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      }
      setError(err instanceof ApiError ? err.message : 'Could not create the branch. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <div
      className="branch-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      role="presentation"
    >
      <form className="auth-card glass-panel" style={{ width: 'min(560px, 100%)', margin: 'auto', padding: '1.75rem' }} onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h1 className="auth-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building2 size={18} /> Add a branch
          </h1>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="auth-muted" style={{ marginBottom: '1rem' }}>
          A branch is another business under your organization — its own GSTIN, address and
          invoice series. It appears in the branch switcher for everyone on your account.
        </p>
        <div className="auth-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="br-name">Branch name</label>
            <input id="br-name" className="form-input" value={f.name} onChange={set('name')} required autoFocus
              aria-invalid={!!fieldErrors.name} placeholder="e.g. Anna Nagar outlet" />
            {fieldErrors.name && <div className="auth-field-error">{fieldErrors.name}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="br-gstin">GSTIN (optional)</label>
              <input id="br-gstin" className="form-input" value={f.gstin} onChange={onGstin} maxLength={15}
                placeholder="33AAxxxxxxx1Z5" aria-invalid={!!fieldErrors.gstin} />
              {fieldErrors.gstin && <div className="auth-field-error">{fieldErrors.gstin}</div>}
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="br-state">State</label>
              <select id="br-state" className="form-input" value={f.state} onChange={set('state')} required
                aria-invalid={!!fieldErrors.state}>
                <option value="">Choose…</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {fieldErrors.state && <div className="auth-field-error">{fieldErrors.state}</div>}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="br-address">Address</label>
            <input id="br-address" className="form-input" value={f.address} onChange={set('address')}
              aria-invalid={!!fieldErrors.address} />
            {fieldErrors.address && <div className="auth-field-error">{fieldErrors.address}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="br-city">City</label>
              <input id="br-city" className="form-input" value={f.city} onChange={set('city')} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="br-pin">PIN code</label>
              <input id="br-pin" className="form-input" value={f.pin} onChange={set('pin')} inputMode="numeric" maxLength={6} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="br-phone">Business phone</label>
              <input id="br-phone" className="form-input" type="tel" value={f.phone} onChange={set('phone')} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="br-email">Business e-mail</label>
              <input id="br-email" className="form-input" type="email" value={f.email} onChange={set('email')} />
            </div>
          </div>
        </div>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <div className="auth-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create branch'}</button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
