import { useEffect, useState } from 'react';
import { SettingRow, SettingsSection } from '../../../components/ui/SettingRow';
import { GstinInput, PhoneInput, StateSelect, gstinHint } from '../../../components/ui/IndiaInputs';
import { confirmAction } from '../../../components/ui/ConfirmModal';
import { toast } from '../../../components/ui/Toast';
import { apiClient } from '../../../lib/apiClient';

// P8-S2 Business profile. Saves through the same PATCH /v1/businesses/:id the older Business page uses, so both show
// the same data. Changing the GSTIN of a business that has invoices asks first and says how many carry it.

const FIELDS = ['name', 'address', 'city', 'state', 'pin', 'phone', 'email', 'gstin', 'pan'];
const pick = (b) => Object.fromEntries(FIELDS.map((f) => [f, b?.[f] ?? '']));

export default function BusinessProfile({ businessId, canEdit }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiClient.get(`/v1/businesses/${businessId}`).then((b) => {
      if (live) { setSaved(pick(b)); setForm(pick(b)); }
    });
    return () => { live = false; };
  }, [businessId]);

  if (!form) return null;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: typeof v === 'string' ? v : v?.target?.value ?? '' }));
  const dirty = FIELDS.some((f) => form[f] !== saved[f]);
  const gstinBad = form.gstin && gstinHint(form.gstin).tone === 'error';
  const invalid = !form.name.trim() || gstinBad || form.pan.length > 10;

  const save = async () => {
    setBusy(true);
    try {
      if (form.gstin !== saved.gstin) {
        const { invoices } = await apiClient.get(`/v1/settings/gstin-usage?businessId=${businessId}`);
        if (invoices > 0) {
          const ok = await confirmAction({
            title: 'Change the GSTIN?',
            message: `The current GSTIN appears on ${invoices} invoice${invoices === 1 ? '' : 's'}. Those invoices keep what was printed; new ones will use the new GSTIN.`,
            confirmLabel: 'Change GSTIN',
            tone: 'warning',
          });
          if (!ok) return;
        }
      }
      const b = await apiClient.patch(`/v1/businesses/${businessId}`, { ...form, gstin: form.gstin.toUpperCase() });
      setSaved(pick(b)); setForm(pick(b));
      toast('Business details saved', 'success', 1500);
    } catch (e) {
      toast(e?.message || 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };

  const text = (k, label, help, props = {}) => (
    <SettingRow label={label} help={help} htmlFor={`biz-${k}`}>
      <input id={`biz-${k}`} className="ui-input" disabled={!canEdit} value={form[k]} onChange={set(k)} {...props} />
    </SettingRow>
  );

  return (
    <SettingsSection title="Business profile">
      {text('name', 'Business name', 'Shown on headers and prints', { required: true })}
      {text('address', 'Address', 'Invoice header')}
      {text('city', 'City', '')}
      <SettingRow label="State" help="Default place of supply" htmlFor="biz-state">
        <StateSelect id="biz-state" value={form.state} onChange={set('state')} disabled={!canEdit} />
      </SettingRow>
      {text('pin', 'PIN code', '', { maxLength: 10 })}
      <SettingRow label="Phone" help="Printed on documents" htmlFor="biz-phone">
        <PhoneInput id="biz-phone" value={form.phone} onChange={set('phone')} disabled={!canEdit} />
      </SettingRow>
      {text('email', 'Email', 'Printed on documents', { type: 'email' })}
      <SettingRow label="GSTIN" help="Checked against its check digit; drives the GST features" htmlFor="biz-gstin">
        <GstinInput id="biz-gstin" value={form.gstin} onChange={set('gstin')} disabled={!canEdit} />
      </SettingRow>
      {text('pan', 'PAN', 'For ITR and the 27EQ return', { maxLength: 10, style: { textTransform: 'uppercase' } })}
      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8 }}>
          <button type="button" className="btn btn-secondary" disabled={!dirty || busy} onClick={() => setForm(saved)}>Reset</button>
          <button type="button" className="btn btn-primary" disabled={!dirty || invalid || busy} onClick={save}>{busy ? 'Saving…' : 'Save business details'}</button>
        </div>
      )}
      <p className="ui-help" style={{ margin: '8px 0 0' }}>Logo, signature and branches are still managed in Business details (Settings &gt; Business).</p>
    </SettingsSection>
  );
}
