import { useState, useRef } from 'react';
// v1.10.36 — lucide's `Image` icon was imported as `Image`, which
// SHADOWED the browser's `HTMLImageElement` constructor. Reported:
// "Uncaught TypeError: et is not a constructor at onChange" on logo
// upload — the minified `et` was our imported React component, and
// `new Image()` inside handleImageUpload was trying to construct a
// React icon. Aliased to `ImageIcon` so `new Image()` resolves to
// the browser primitive again.
import { Save, Plus, Trash2, Edit3, Image as ImageIcon, PenTool } from 'lucide-react';
import { saveProfile } from '../../lib/data';
import { getCountryConfig, getStatesForCountry, getPaymentAccounts, createEmptyAccount, maskAccountNumber, reorderAccounts, setDefaultAccount, isValidUpiId, businessKeyOf } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import InvoiceNumberSettings from './numbering/InvoiceNumberSettings';

export default function SettingsCompanySection({
  profile, setProfile, handleChange, taxIdWarning, setTaxIdWarning, handleTaxIdBlur,
  visibleCountries, profileLoaded, saving, handleSave, companyFormRef, markProfileSaved,
  invNumRef, activeBusiness, businessProfiles, onInvNumDirtyChange, onInvNumSavingChange,
}) {
  return (
    <>
      <form id="section-company" data-settings-tab="business" onSubmit={handleSave} className="glass-panel p-6 mb-6" ref={companyFormRef} style={{ order: 1 }}>
        <fieldset disabled={!profileLoaded} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <h3 className="section-title">Company Details</h3>
        {(() => {
          const cc = getCountryConfig(profile.country);
          return (
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group full-width">
                <label className="form-label">Business Name *</label>
                <input required type="text" name="businessName" className="form-input" value={profile.businessName} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label">Country</label>
                <select name="country" className="form-input" value={profile.country || 'India'} onChange={handleChange}>
                  {/* If the saved country is filtered out by the region toggle, keep it visible. */}
                  {profile.country && !visibleCountries.some(c => c.name === profile.country) && (
                    <option value={profile.country}>{profile.country}</option>
                  )}
                  {visibleCountries.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group full-width">
                <label className="form-label">Address</label>
                <textarea rows="2" name="address" className="form-input" value={profile.address} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label">City</label>
                <input type="text" name="city" className="form-input" value={profile.city || ''} onChange={handleChange} placeholder="e.g. Mumbai" />
              </div>
              <div className="form-group">
                <label className="form-label">{cc.postalLabel}</label>
                <input type="text" name="pin" className="form-input" value={profile.pin || ''} onChange={handleChange} placeholder={cc.postalLabel} />
              </div>
              <div className="form-group">
                <label className="form-label">{cc.stateLabel}</label>
                {(() => {
                  const stateOpts = getStatesForCountry(profile.country || 'India');
                  return stateOpts.length > 0 ? (
                    <select name="state" className="form-input" value={profile.state} onChange={handleChange}>
                      <option value="">Select {cc.stateLabel}</option>
                      {stateOpts.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : (
                    <input type="text" name="state" className="form-input" value={profile.state || ''} onChange={handleChange} placeholder={cc.stateLabel} />
                  );
                })()}
              </div>
              <div className="form-group">
                <label className="form-label">{cc.taxIdLabel}</label>
                <input type="text" name="gstin" className="form-input"
                  style={taxIdWarning ? { borderColor: '#f59e0b' } : undefined}
                  value={profile.gstin}
                  onChange={(e) => { handleChange(e); if (taxIdWarning) setTaxIdWarning(''); }}
                  onBlur={handleTaxIdBlur}
                  placeholder={cc.taxIdPlaceholder} maxLength={20} />
                {taxIdWarning && <small style={{ color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' }}>⚠ {taxIdWarning}</small>}
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input type="email" name="email" className="form-input" value={profile.email} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input type="text" name="phone" className="form-input" value={profile.phone} onChange={handleChange} />
              </div>
              {/* v1.10.43 — GST-specific fields: AATO band + turnover
                  numbers. Drive the GSTR-1 export's HSN digit-length
                  gate + the gt/cur_gt root fields the offline utility
                  requires. India-only. */}
              {(profile.country || 'India') === 'India' && (
                <div className="form-group full-width" style={{ background: 'var(--bg-secondary)', padding: '0.85rem 1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <label className="form-label" style={{ marginBottom: 6 }}>GSTR filing details (used only for GSTR-1 / GSTR-3B JSON export)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 8 }}>
                    <input type="checkbox" id="aato-above-5cr" name="aatoAbove5Cr"
                      checked={!!profile.aatoAbove5Cr}
                      onChange={(e) => setProfile(p => ({ ...p, aatoAbove5Cr: e.target.checked }))} />
                    <label htmlFor="aato-above-5cr" style={{ fontSize: '0.82rem', margin: 0 }}>
                      Aggregate turnover (AATO) is <strong>above ₹5 crore</strong>
                    </label>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' }}>
                    Drives HSN reporting rule — <strong>{profile.aatoAbove5Cr ? '6-digit HSN' : '4-digit HSN'}</strong> minimum on every item. Since Jan 2025 the portal blocks GSTR-1 if any HSN falls short.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Previous FY aggregate turnover (₹) — sets JSON <code>gt</code></label>
                      <input type="number" min="0" step="1" name="prevFYTurnover" className="form-input"
                        value={profile.prevFYTurnover ?? ''}
                        onChange={handleChange}
                        placeholder="e.g. 5000000" />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.72rem' }}>Current FY turnover so far (₹) — sets JSON <code>cur_gt</code></label>
                      <input type="number" min="0" step="1" name="currentFYTurnover" className="form-input"
                        value={profile.currentFYTurnover ?? ''}
                        onChange={handleChange}
                        placeholder="e.g. 1200000" />
                    </div>
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
                    Both are optional (default 0). The portal lets you edit these while filing — you're just avoiding a schema-validation reject on upload.
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      <PaymentAccountsSection profile={profile} setProfile={setProfile}
        markProfileSaved={markProfileSaved} handleChange={handleChange} />
        {/* Invoice Number Format (per business since v1.10.79, #95) */}
        <InvoiceNumberSettings ref={invNumRef}
          businessKey={businessKeyOf(activeBusiness)} businessName={activeBusiness?.businessName}
          showScope={businessProfiles.length > 1}
          businesses={businessProfiles.map((bp) => ({ key: businessKeyOf(bp), name: bp.businessName || bp.gstin || 'Unnamed business' }))}
          onDirtyChange={onInvNumDirtyChange} onSavingChange={onInvNumSavingChange} />
      <BrandingSection profile={profile} setProfile={setProfile} />
        <div className="mt-6 flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={18} /> {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
        </fieldset>
      </form>
    </>
  );
}

function PaymentAccountsSection({ profile, setProfile, markProfileSaved, handleChange }) {
  // ---- Payment Accounts manager ----
  // `editingAccount` = null ⇒ closed; an account object ⇒ form open for that
  // account; a fresh `createEmptyAccount()` ⇒ Add new flow. Saving merges back
  // into profile.paymentAccounts; profile.upiId/bankName/etc. are mirrored to
  // the DEFAULT account on save so legacy code paths and v1.4.x backups keep
  // working without a data migration.
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountUpiWarning, setAccountUpiWarning] = useState('');

  const updateAccounts = (nextAccounts) => {
    // Mirror the default account's fields onto the profile's flat bank/UPI
    // fields. Means: a v1.4.x reader of the same profile.json still sees the
    // current default account's details, and the existing flat-field code
    // paths (e.g. legacy fallback in InvoicePreview) continue to work.
    const def = nextAccounts.find(a => a.isDefault) || nextAccounts[0];
    setProfile(prev => {
      const next = {
        ...prev,
        paymentAccounts: nextAccounts,
        ...(def ? {
          bankName: def.bankName || '',
          accountNumber: def.accountNumber || '',
          ifsc: def.ifsc || '',
          swift: def.swift || '',
          upiId: def.upiId || '',
        } : {}),
      };
      // v1.10.16 — reported: "also set default is not working". Root cause:
      // this function only updated React state via setProfile — the caller
      // was expected to click the main "Save Profile" button afterwards to
      // persist. Users clicked the ⭐ inline button, saw the star move, and
      // assumed it was saved. Reloading the page reverted it. Now every
      // account-level change (mark-default, add, delete, reorder, toggle
      // active) auto-persists to the server without needing the main Save
      // button. Fire-and-forget — the same handler that awaits saveProfile
      // in handleSave already exists for the "save everything" path.
      // v1.10.56 (#44) — refresh the baseline on success, or the bar would
      // keep claiming unsaved changes for something already on disk.
      saveProfile(next)
        .then(() => markProfileSaved(next))
        .catch(() => { /* non-fatal — user can retry via Save */ });
      return next;
    });
  };

  const openAddAccount = () => {
    const fresh = createEmptyAccount();
    const existing = getPaymentAccounts(profile);
    // First account auto-marks Primary so the user never sees a "no default" state.
    if (existing.length === 0) fresh.isDefault = true;
    setEditingAccount(fresh);
    setAccountUpiWarning('');
  };

  const openEditAccount = (acc) => {
    setEditingAccount({ ...acc });
    setAccountUpiWarning('');
  };

  const cancelAccount = () => { setEditingAccount(null); setAccountUpiWarning(''); };

  const saveAccountForm = () => {
    if (!editingAccount) return;
    const existing = getPaymentAccounts(profile).filter(a => a.id !== 'legacy');
    const idx = existing.findIndex(a => a.id === editingAccount.id);
    const next = idx >= 0 ? existing.map((a, i) => i === idx ? editingAccount : a) : [...existing, editingAccount];
    // Enforce: exactly one default (or zero if list empty).
    if (editingAccount.isDefault) {
      next.forEach(a => { if (a.id !== editingAccount.id) a.isDefault = false; });
    } else if (!next.some(a => a.isDefault) && next.length > 0) {
      next[0].isDefault = true;
    }
    updateAccounts(next);
    setEditingAccount(null);
    setAccountUpiWarning('');
    toast(idx >= 0 ? 'Account updated' : 'Account added', 'success');
  };

  const removeAccount = async (acc) => {
    if (!await confirmAction({
      title: `Delete payment account "${acc.label || acc.bankName || 'this account'}"?`,
      message: 'Existing invoices that used this account keep their bank details as they were saved, so their PDFs stay exactly as printed.',
      confirmLabel: 'Delete account',
      tone: 'danger',
    })) return;
    const next = getPaymentAccounts(profile).filter(a => a.id !== 'legacy' && a.id !== acc.id);
    if (next.length > 0 && !next.some(a => a.isDefault)) next[0].isDefault = true;
    updateAccounts(next);
    toast('Account removed', 'success');
  };

  const markDefault = (acc) => {
    const next = setDefaultAccount(getPaymentAccounts(profile).filter(a => a.id !== 'legacy'), acc.id);
    updateAccounts(next);
    toast(`Default → ${acc.label || acc.bankName || 'account'}`, 'success');
  };

  const toggleAccountActive = (acc) => {
    const next = getPaymentAccounts(profile)
      .filter(a => a.id !== 'legacy')
      .map(a => a.id === acc.id ? { ...a, isActive: !(a.isActive !== false) } : a);
    updateAccounts(next);
  };

  const moveAccountIdx = (idx, delta) => {
    const list = getPaymentAccounts(profile).filter(a => a.id !== 'legacy');
    const next = reorderAccounts(list, idx, idx + delta);
    updateAccounts(next);
  };

  const importLegacyAsAccount = () => {
    const fresh = createEmptyAccount(profile.bankName || 'Default account');
    fresh.bankName = profile.bankName || '';
    fresh.accountNumber = profile.accountNumber || '';
    fresh.ifsc = profile.ifsc || '';
    fresh.swift = profile.swift || '';
    fresh.upiId = profile.upiId || '';
    fresh.isDefault = true;
    updateAccounts([fresh]);
    toast('Imported existing bank details as your first account', 'success');
  };
  return (
    <>
        {/* ---- Payment Accounts ---- */}
        {(() => {
          const bankCC = getCountryConfig(profile.country);
          const isIndia = (profile.country || 'India') === 'India';
          // Show real accounts only — never the synthesised legacy entry, since this
          // panel is for editing the persistent array.
          const accounts = (profile.paymentAccounts || []).filter(a => a && a.id !== 'legacy');
          const hasLegacyFlat = !accounts.length && (profile.bankName || profile.accountNumber || profile.ifsc || profile.swift || profile.upiId);
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.5rem', marginTop: '2rem' }}>
                <div>
                  <h3 className="section-title" style={{ margin: 0 }}>Payment Accounts</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>
                    Multiple bank / UPI accounts per profile. Pick one per invoice in the Customize panel.
                    The ⭐ default account is preselected on new invoices.
                  </p>
                </div>
                <button type="button" className="btn btn-primary" onClick={openAddAccount}>
                  <Plus size={16} /> Add account
                </button>
              </div>

              {/* Migration banner — one-time prompt to lift the legacy flat fields into the new array. */}
              {hasLegacyFlat && (
                <div className="notice notice-warn" style={{ marginTop: '0.85rem' }}>
                  <span className="notice-icon">📋</span>
                  <div style={{ flex: 1 }}>
                    <strong>Your existing bank details are still on this profile.</strong> Click below to import them as the first Payment Account, then add more.
                    <div style={{ marginTop: '0.5rem' }}>
                      <button type="button" className="btn btn-secondary" onClick={importLegacyAsAccount} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}>
                        Import &amp; continue →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Empty state — no accounts AND no legacy fields */}
              {accounts.length === 0 && !hasLegacyFlat && (
                <div className="surface-card" style={{ marginTop: '0.85rem', textAlign: 'center', padding: '1.5rem' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                    No payment accounts yet. Add the first one — it's auto-marked ⭐ Primary.
                  </p>
                </div>
              )}

              {/* Account list */}
              {accounts.length > 0 && (
                <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {accounts.map((a, idx) => (
                    <div key={a.id} className="surface-card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', opacity: a.isActive === false ? 0.55 : 1 }}>
                      <div style={{ flex: 1, minWidth: '220px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {a.isDefault && <span title="Default account" style={{ fontSize: '0.95rem' }}>⭐</span>}
                          <strong style={{ fontSize: '0.92rem' }}>{a.label || a.bankName || 'Untitled account'}</strong>
                          {a.isActive === false && <span className="status-pill" style={{ '--pill-color': 'var(--text-muted)' }}>Inactive</span>}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.55 }}>
                          {a.bankName && <span>{a.bankName} · </span>}
                          {a.accountNumber && <span>A/C {maskAccountNumber(a.accountNumber)} · </span>}
                          {a.ifsc && <span>{bankCC.bankLabel || 'IFSC'} {a.ifsc}</span>}
                          {a.swift && <span> · SWIFT {a.swift}</span>}
                          {a.upiId && <span> · 📱 {a.upiId}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {!a.isDefault && (
                          <button type="button" className="icon-btn" onClick={() => markDefault(a)} title="Set as default">⭐</button>
                        )}
                        <button type="button" className="icon-btn" onClick={() => moveAccountIdx(idx, -1)} disabled={idx === 0} title="Move up">↑</button>
                        <button type="button" className="icon-btn" onClick={() => moveAccountIdx(idx, 1)} disabled={idx === accounts.length - 1} title="Move down">↓</button>
                        <button type="button" className="icon-btn" onClick={() => toggleAccountActive(a)} title={a.isActive === false ? 'Activate' : 'Deactivate'}>
                          {a.isActive === false ? '✓' : '∅'}
                        </button>
                        <button type="button" className="icon-btn icon-btn-blue" onClick={() => openEditAccount(a)} title="Edit"><Edit3 size={15} /></button>
                        <button type="button" className="icon-btn icon-btn-red" onClick={() => removeAccount(a)} title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* PAN sits OUTSIDE the accounts list because it's profile-level, not per-account */}
              {isIndia && (
                <div className="form-group" style={{ marginTop: '1rem', maxWidth: '300px' }}>
                  <label className="form-label">PAN Number (business-level)</label>
                  <input type="text" name="pan" className="form-input" value={profile.pan || ''} onChange={handleChange} placeholder="e.g. AAAAA1234A" maxLength={10} />
                </div>
              )}

              {/* Add/Edit modal */}
              {editingAccount && (
                <div className="modal-overlay" onClick={cancelAccount}>
                  <div className="modal-content" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
                    <h3 className="section-title" style={{ marginTop: 0 }}>{getPaymentAccounts(profile).some(a => a.id === editingAccount.id) ? 'Edit account' : 'Add account'}</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label className="form-label">Label (shown in the dropdown)</label>
                        <input type="text" className="form-input" value={editingAccount.label}
                          onChange={e => setEditingAccount(a => ({ ...a, label: e.target.value }))}
                          placeholder="e.g. HDFC Current — 1234" />
                      </div>
                      {/* v1.10.37 — Account Holder Name + Account Type
                          added. Reported: clients get "beneficiary name
                          mismatch" errors on NEFT/RTGS when the account
                          name differs from the trading name (common for
                          proprietorships, HUFs, abbreviated Pvt Ltd
                          names). Both fields are optional and print on
                          the invoice PDF when filled. */}
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label className="form-label">Account Holder Name <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.72rem' }}>(name printed on the cheque / registered with the bank)</span></label>
                        <input type="text" className="form-input" value={editingAccount.accountHolderName || ''}
                          onChange={e => setEditingAccount(a => ({ ...a, accountHolderName: e.target.value }))}
                          placeholder={`Leave blank to use "${profile.businessName || 'Business Name'}"`} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Bank Name</label>
                        <input type="text" className="form-input" value={editingAccount.bankName}
                          onChange={e => setEditingAccount(a => ({ ...a, bankName: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Account Type <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.72rem' }}>(optional)</span></label>
                        <select className="form-input" value={editingAccount.accountType || ''}
                          onChange={e => setEditingAccount(a => ({ ...a, accountType: e.target.value }))}>
                          <option value="">— Not specified —</option>
                          <option value="savings">Savings Account</option>
                          <option value="current">Current Account</option>
                          <option value="cc">Cash Credit (CC)</option>
                          <option value="od">Overdraft (OD)</option>
                          <option value="nre">NRE Account</option>
                          <option value="nro">NRO Account</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Account Number {!isIndia && '/ IBAN'}</label>
                        <input type="text" className="form-input" value={editingAccount.accountNumber}
                          onChange={e => setEditingAccount(a => ({ ...a, accountNumber: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{bankCC.bankLabel || 'IFSC Code'}</label>
                        <input type="text" className="form-input" value={editingAccount.ifsc}
                          onChange={e => setEditingAccount(a => ({ ...a, ifsc: e.target.value }))}
                          placeholder={bankCC.bankLabel} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">SWIFT / BIC (optional)</label>
                        <input type="text" className="form-input" value={editingAccount.swift}
                          onChange={e => setEditingAccount(a => ({ ...a, swift: e.target.value }))}
                          placeholder="e.g. HDFCINBB" />
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label className="form-label">UPI ID (optional — drives the QR for this account)</label>
                        <input type="text" className="form-input"
                          style={accountUpiWarning ? { borderColor: '#f59e0b' } : undefined}
                          value={editingAccount.upiId}
                          onChange={e => { setEditingAccount(a => ({ ...a, upiId: e.target.value })); if (accountUpiWarning) setAccountUpiWarning(''); }}
                          onBlur={() => {
                            const v = (editingAccount.upiId || '').trim();
                            setAccountUpiWarning(v && !isValidUpiId(v) ? "Doesn't look like a UPI ID. Expected like merchant@hdfcbank or 9876543210@paytm." : '');
                          }}
                          placeholder="e.g. yourbusiness@hdfcbank" />
                        {accountUpiWarning && <small style={{ color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' }}>⚠ {accountUpiWarning}</small>}
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label className="form-label">Internal notes (not printed on the PDF)</label>
                        <textarea rows="2" className="form-input" value={editingAccount.notes}
                          onChange={e => setEditingAccount(a => ({ ...a, notes: e.target.value }))}
                          placeholder="e.g. Use for export clients only" />
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!editingAccount.isDefault}
                            onChange={e => setEditingAccount(a => ({ ...a, isDefault: e.target.checked }))}
                            style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                          <span><strong>⭐ Set as default account</strong> — preselected on every new invoice</span>
                        </label>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end mt-4">
                      <button type="button" className="btn btn-secondary" onClick={cancelAccount}>Cancel</button>
                      <button type="button" className="btn btn-primary" onClick={saveAccountForm}>
                        <Save size={16} /> Save account
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}
    </>
  );
}

function BrandingSection({ profile, setProfile }) {
  const logoInputRef = useRef(null);
  const sigInputRef = useRef(null);
  const stampInputRef = useRef(null);
  const handleImageUpload = (field, e) => {
    const file = e.target.files?.[0];
    // v1.10.36 — Reset the input so re-selecting the SAME file re-fires
    // onChange. Without this, if a user's upload silently failed once
    // (browser can't decode HEIC etc.) they had to pick a DIFFERENT file
    // to try again; picking the same file was a no-op.
    try { e.target.value = ''; } catch { /* ignore */ }
    if (!file) return;

    // v1.10.36 — Reported "not able to set logo it show nothing".
    // Previous strict MIME whitelist (png/jpeg/webp/svg) silently
    // rejected HEIC/HEIF (iPhone default), GIF, BMP, TIFF with a
    // one-line toast users often missed. Now: accept anything the
    // browser can decode. The <img>.onerror fallback catches truly
    // undecodable files with a clearer message. Non-image files are
    // still caught by the .type prefix guard.
    if (!file.type.startsWith('image/') && file.type !== '') {
      toast(`This doesn't look like an image (type: ${file.type || 'unknown'}). Try a PNG or JPEG.`, 'warning', 6000);
      return;
    }
    // Size ceiling relaxed to 5MB (server body limit) so a phone photo
    // doesn't hit the arbitrary 2MB gate before downscaling gets to run.
    if (file.size > 5 * 1024 * 1024) {
      toast(`Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — over the 5MB cap. Try compressing at tinypng.com.`, 'warning', 6000);
      return;
    }

    // SVGs are vector — embed as-is (no canvas needed).
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setProfile(prev => ({ ...prev, [field]: ev.target.result }));
        toast(`${({ logo: 'Logo', signature: 'Signature', stamp: 'Stamp' })[field] || 'Image'} uploaded — click Save Profile to keep it.`, 'success', 4000);
      };
      reader.onerror = () => toast('Could not read the SVG file.', 'error');
      reader.readAsDataURL(file);
      return;
    }

    // Raster: load into an Image, downscale to max 1024px on the longer edge
    // v1.10.36 — Explicit `window.Image` so a future import (e.g. lucide's
    // `Image` icon) can't shadow the browser primitive again.
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1024;
      let { width, height } = img;
      if (!width || !height) {
        toast(`Image has zero dimensions — cannot use as logo.`, 'error');
        return;
      }
      if (width > MAX || height > MAX) {
        const ratio = MAX / Math.max(width, height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      // Fill white for JPEG so transparent PNGs don't come out with black
      // backgrounds on printers that can't render alpha.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      // Keep PNG for images that had alpha (so signature on transparent
      // stays transparent when placed on invoice), JPEG otherwise.
      const preservesAlpha = /png|webp|svg/i.test(file.type) && field !== 'logo';
      const dataUrl = canvas.toDataURL(preservesAlpha ? 'image/png' : 'image/jpeg', 0.92);
      setProfile(prev => ({ ...prev, [field]: dataUrl }));
      toast(`${({ logo: 'Logo', signature: 'Signature', stamp: 'Stamp' })[field] || 'Image'} uploaded — click Save Profile to keep it.`, 'success', 4000);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // v1.10.36 — better error message. Common cause of the silent
      // "logo not showing" report on iOS: user uploads a HEIC file from
      // Photos, Chrome/desktop Safari can't decode it, we ended up here
      // with a generic error. Now the toast names likely fixes.
      toast(`Could not decode this image (type: ${file.type || 'unknown'}). If it's a HEIC from iPhone, share it as JPEG — in Photos: Share → Copy Photo → Files → paste, or set Camera Format = "Most Compatible".`, 'error', 10000);
    };
    img.src = url;
  };

  const removeImage = (field) => setProfile(prev => ({ ...prev, [field]: '' }));
  return (
    <>
        {/* Logo & Signature */}
        <h3 className="section-title mt-8">Branding</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="form-label">Business Logo</label>
            <div className="upload-area">
              {profile.logo ? (
                <div className="logo-upload-section">
                  <div className="logo-preview-box">
                    <img src={profile.logo} alt="Logo" style={{ height: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', display: 'block' }} />
                    <button type="button" className="icon-btn icon-btn-red upload-remove" onClick={() => removeImage('logo')}><Trash2 size={14} /></button>
                  </div>
                  <div className="logo-size-control">
                    <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Logo Size on Invoice</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>S</span>
                      <input type="range" min="24" max="80" value={profile.logoHeight || 48} onChange={(e) => setProfile(prev => ({ ...prev, logoHeight: Number(e.target.value) }))} className="logo-slider" />
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>L</span>
                    </div>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{profile.logoHeight || 48}px height</span>
                  </div>
                  <button type="button" className="upload-change-btn" onClick={() => logoInputRef.current?.click()}>Change Logo</button>
                </div>
              ) : (
                <button type="button" className="upload-btn" onClick={() => logoInputRef.current?.click()}>
                  <ImageIcon size={20} /><span>Upload Logo</span><span className="upload-hint">PNG or JPG, square or wide (up to 5 MB)</span>
                </button>
              )}
              <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload('logo', e)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Signature</label>
            <div className="upload-area">
              {profile.signature ? (
                <div className="logo-upload-section">
                  <div className="logo-preview-box">
                    <img src={profile.signature} alt="Signature" style={{ height: `${profile.signatureHeight || 60}px`, maxWidth: '180px', objectFit: 'contain', display: 'block' }} />
                    <button type="button" className="icon-btn icon-btn-red upload-remove" onClick={() => removeImage('signature')}><Trash2 size={14} /></button>
                  </div>
                  <div className="logo-size-control">
                    <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Signature Size on Invoice</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>S</span>
                      <input type="range" min="30" max="110" value={profile.signatureHeight || 60} onChange={(e) => setProfile(prev => ({ ...prev, signatureHeight: Number(e.target.value) }))} className="logo-slider" />
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>L</span>
                    </div>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{profile.signatureHeight || 60}px height</span>
                  </div>
                  <button type="button" className="upload-change-btn" onClick={() => sigInputRef.current?.click()}>Change Signature</button>
                </div>
              ) : (
                <button type="button" className="upload-btn" onClick={() => sigInputRef.current?.click()}>
                  <PenTool size={20} /><span>Upload Signature</span><span className="upload-hint">PNG or JPG (up to 5 MB)</span>
                </button>
              )}
              <input ref={sigInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload('signature', e)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Company Stamp / Seal</label>
            <div className="upload-area">
              {profile.stamp ? (
                <div className="logo-upload-section">
                  <div className="logo-preview-box">
                    <img src={profile.stamp} alt="Stamp" style={{ height: `${profile.stampHeight || 70}px`, maxWidth: '180px', objectFit: 'contain', display: 'block' }} />
                    <button type="button" className="icon-btn icon-btn-red upload-remove" onClick={() => removeImage('stamp')}><Trash2 size={14} /></button>
                  </div>
                  <div className="logo-size-control">
                    <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Stamp Size on Invoice</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>S</span>
                      <input type="range" min="30" max="120" value={profile.stampHeight || 70} onChange={(e) => setProfile(prev => ({ ...prev, stampHeight: Number(e.target.value) }))} className="logo-slider" />
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>L</span>
                    </div>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{profile.stampHeight || 70}px height</span>
                  </div>
                  <button type="button" className="upload-change-btn" onClick={() => stampInputRef.current?.click()}>Change Stamp</button>
                </div>
              ) : (
                <button type="button" className="upload-btn" onClick={() => stampInputRef.current?.click()}>
                  <ImageIcon size={20} /><span>Upload Stamp</span><span className="upload-hint">PNG with a transparent background looks best (up to 5 MB)</span>
                </button>
              )}
              <input ref={stampInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload('stamp', e)} />
            </div>
          </div>
        </div>
    </>
  );
}
