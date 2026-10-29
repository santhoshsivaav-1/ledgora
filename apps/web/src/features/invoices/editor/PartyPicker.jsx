import { UserPlus, Pencil } from 'lucide-react';
import { getRegionMode } from '../../../lib/data';
import { formatCurrency, getCountryConfig, getStatesForCountry, getCountriesForRegion } from '../../../utils';

// Who the invoice is for: search or add a client, their address, GSTIN and place of supply (change 3.9).
export default function PartyPicker({
  client, clientCredit, clientNameRef, clientPickerIdx, clientSuggestionsRef, creditToApply, editingBill, filteredClients, gstinHint, handleClientGstinBlur, invoiceOptions, openAddClientModal, openEditClientModal, profile, savedClients, selectSavedClient, selectedClientId, setClient, setClientPickerIdx, setCreditToApply, setGstinHint, setInvoiceOptions, setSelectedClientId, setShowClientSuggestions, showClientSuggestions, totals,
}) {
  return (
          <div className="glass-panel p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="section-title" style={{ margin: 0 }}>Billed To</h3>
            </div>

            {/* v1.10.24 — Client credit banner. Shows when the picked
                client has overpayment sitting unused on prior bills;
                lets the user apply it as advance on this invoice. */}
            {!editingBill && clientCredit.available > 0.005 && (
              <div style={{
                marginBottom: '1rem', padding: '0.75rem 1rem',
                background: 'rgba(3, 105, 161, 0.08)',
                border: '1px solid rgba(3, 105, 161, 0.3)',
                borderRadius: 8, fontSize: '0.85rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <strong style={{ color: '#0369a1' }}>💳 Client has {formatCurrency(clientCredit.available, invoiceOptions.currency || 'INR')} credit</strong>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                      from {clientCredit.sources.length} prior overpayment{clientCredit.sources.length > 1 ? 's' : ''}
                      {' '}({clientCredit.sources.map(s => s.invoiceNumber).slice(0, 3).join(', ')}
                      {clientCredit.sources.length > 3 ? '…' : ''})
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input type="number" min="0" step="any" className="form-input"
                      value={creditToApply || ''} placeholder="0"
                      onChange={e => {
                        const v = Math.max(0, Number(e.target.value) || 0);
                        const cap = Math.min(clientCredit.available, Number(totals.total) || Infinity);
                        setCreditToApply(Math.min(v, cap));
                      }}
                      style={{ width: 100, fontSize: '0.82rem', padding: '0.3rem 0.5rem' }} />
                    <button type="button" className="btn btn-secondary"
                      style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                      onClick={() => setCreditToApply(Math.min(clientCredit.available, Number(totals.total) || 0))}>
                      Apply full
                    </button>
                    {creditToApply > 0 && (
                      <button type="button" className="btn btn-secondary"
                        style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', color: '#dc2626', borderColor: '#fca5a5' }}
                        onClick={() => setCreditToApply(0)}>
                        Skip
                      </button>
                    )}
                  </div>
                </div>
                {creditToApply > 0.005 && (
                  <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#0369a1' }}>
                    → Will apply {formatCurrency(creditToApply, invoiceOptions.currency || 'INR')} as advance from prior overpayment
                    {creditToApply < clientCredit.available ? ` (${formatCurrency(clientCredit.available - creditToApply, invoiceOptions.currency || 'INR')} credit will remain)` : ''}.
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={!!invoiceOptions.autoApplyClientCredit}
                    onChange={e => setInvoiceOptions(prev => ({ ...prev, autoApplyClientCredit: e.target.checked }))} />
                  Auto-apply available client credit on future invoices
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="form-group full-width" style={{ position: 'relative' }}>
                <label className="form-label">Client Name</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input type="text" className="form-input" style={{ flex: 1 }} value={client.name} ref={clientNameRef}
                    onChange={(e) => {
                      setClient({ ...client, name: e.target.value });
                      setSelectedClientId(null);
                      setShowClientSuggestions(true);
                      setClientPickerIdx(-1);
                    }}
                    onFocus={() => { if (savedClients.length > 0) setShowClientSuggestions(true); }}
                    onKeyDown={(e) => {
                      // v1.10.37 — Arrow keys / Enter / Escape on the client
                      // picker. Reported: "20 invoices/day forces mouse on
                      // the client autocomplete." Now: keyboard-only path.
                      if (!showClientSuggestions || !filteredClients.length) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setClientPickerIdx(i => (i + 1) % filteredClients.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setClientPickerIdx(i => (i <= 0 ? filteredClients.length - 1 : i - 1));
                      } else if (e.key === 'Enter') {
                        // Only intercept Enter when the user has actually
                        // arrow-nav'd to a suggestion; otherwise let Enter
                        // fall through to the form for the "Add new client"
                        // path via openAddClientModal.
                        if (clientPickerIdx >= 0 && filteredClients[clientPickerIdx]) {
                          e.preventDefault();
                          selectSavedClient(filteredClients[clientPickerIdx]);
                        }
                      } else if (e.key === 'Escape') {
                        setShowClientSuggestions(false);
                      }
                    }}
                    placeholder="Type client name to search or add new" autoComplete="off" />
                  {selectedClientId && (
                    <button type="button" className="btn-client-edit" onClick={() => openEditClientModal(savedClients.find(c => c.id === selectedClientId))} title="Edit saved client">
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
                {showClientSuggestions && savedClients.length > 0 && (
                  <div className="client-suggestions" ref={clientSuggestionsRef}>
                    {filteredClients.length > 0 && filteredClients.map((cli, i) => (
                      <div key={cli.id} className="client-suggestion-row"
                        style={i === clientPickerIdx ? { background: 'var(--primary-light, rgba(30,64,175,0.12))' } : undefined}>
                        <button type="button" className="client-suggestion-item"
                          onMouseEnter={() => setClientPickerIdx(i)}
                          onClick={() => selectSavedClient(cli)}>
                          <div className="client-suggestion-main">
                            <strong>{cli.name}</strong>
                            {(cli.city || cli.address) && <small className="client-suggestion-addr">{cli.city || cli.address.substring(0, 30)}{!cli.city && cli.address.length > 30 ? '...' : ''}</small>}
                          </div>
                          <span>{cli.state}{cli.gstin ? ` · ${cli.gstin}` : ''}</span>
                        </button>
                        <button type="button" className="client-suggestion-edit" onClick={() => { openEditClientModal(cli); setShowClientSuggestions(false); }} title="Edit client">
                          <Pencil size={12} />
                        </button>
                      </div>
                    ))}
                    {client.name.trim() && (
                      <button type="button" className="client-suggestion-save" onClick={openAddClientModal}>
                        <UserPlus size={14} /> Save "{client.name.trim()}" as new client
                      </button>
                    )}
                    {filteredClients.length === 0 && !client.name.trim() && (
                      <div className="client-picker-empty">Type to search clients</div>
                    )}
                  </div>
                )}
              </div>
              <div className="form-group full-width">
                <label className="form-label">Billing Address</label>
                <input type="text" className="form-input" value={client.address}
                  onChange={(e) => setClient({ ...client, address: e.target.value })} placeholder="Street address, locality" />
              </div>
              <div className="form-group">
                <label className="form-label">Country</label>
                <select className="form-input" value={client.country || profile?.country || 'India'}
                  onChange={(e) => setClient({ ...client, country: e.target.value, state: '' })}>
                  {(() => {
                    const visible = getCountriesForRegion(getRegionMode());
                    const cur = client.country || profile?.country;
                    const out = [];
                    if (cur && !visible.some(c => c.name === cur)) {
                      out.push(<option key={cur} value={cur}>{cur}</option>);
                    }
                    return out.concat(visible.map(c => <option key={c.code} value={c.name}>{c.name}</option>));
                  })()}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">City</label>
                <input type="text" className="form-input" value={client.city}
                  onChange={(e) => setClient({ ...client, city: e.target.value })} placeholder="e.g. Mumbai" />
              </div>
              <div className="form-group">
                {(() => { const cc = getCountryConfig(client.country || profile?.country); return <label className="form-label">{cc.postalLabel}</label>; })()}
                <input type="text" className="form-input" value={client.pin}
                  onChange={(e) => setClient({ ...client, pin: e.target.value })} placeholder="Postal / PIN code" />
              </div>
              {invoiceOptions.showState && (() => {
                const cc = getCountryConfig(client.country || profile?.country);
                const stateOpts = getStatesForCountry(client.country || profile?.country);
                return (
                  <div className="form-group">
                    <label className="form-label">{cc.stateLabel}</label>
                    {stateOpts.length > 0 ? (
                      <select className="form-input" value={client.state} onChange={(e) => setClient({ ...client, state: e.target.value })}>
                        <option value="">Select {cc.stateLabel}</option>
                        {stateOpts.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input type="text" className="form-input" value={client.state}
                        onChange={(e) => setClient({ ...client, state: e.target.value })} placeholder={cc.stateLabel} />
                    )}
                  </div>
                );
              })()}
              {invoiceOptions.showGSTIN && (() => {
                const cc = getCountryConfig(client.country || profile?.country);
                return (
                  <div className="form-group">
                    <label className="form-label">{cc.taxIdLabel}</label>
                    <input type="text" className="form-input" value={client.gstin}
                      // v1.10.74 - drop the old hint on edit; it is re-checked on blur.
                      onChange={(e) => { setClient({ ...client, gstin: e.target.value.toUpperCase() }); setGstinHint(null); }}
                      onBlur={handleClientGstinBlur} placeholder="Optional" maxLength={20} />
                    {gstinHint && (
                      <small style={{ color: gstinHint.tone === 'warn' ? '#d97706' : '#16a34a', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' }}>
                        {gstinHint.tone === 'warn' ? '⚠' : '✓'} {gstinHint.message}
                      </small>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
  );
}
