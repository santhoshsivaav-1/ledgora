import { useState } from 'react';
import { Link } from 'react-router';
import { Drawer } from '../../components/ui/Modal';
import { toast } from '../../components/ui/Toast';
import { savePosSettings } from '../../lib/data/pos';

// P12: the POS settings (the drawer on the counter, as in Vyapar). Saved per business in preferences.pos. Cash is
// always a payment mode; the rest are switched here. "Accounts" sends a mode's money to a bank account instead of the
// default (cash goes to Cash in Hand).

const MODES = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['bank', 'Bank transfer'],
  ['cheque', 'Cheque'],
  ['other', 'Other'],
];

const Toggle = ({ label, hint, checked, onChange, disabled }) => (
  <label className="pos-row" style={{ cursor: disabled ? 'default' : 'pointer', alignItems: 'flex-start' }}>
    <span>
      {label}
      {hint && <span className="field-hint" style={{ display: 'block' }}>{hint}</span>}
    </span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
  </label>
);
const Section = ({ title, children }) => (
  <section style={{ marginBottom: '1.1rem' }}>
    <h4 className="section-title" style={{ marginTop: 0 }}>{title}</h4>
    {children}
  </section>
);

export default function PosSettingsDrawer({ open, onClose, businessId, settings, banks = [], onSaved }) {
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setS((cur) => ({ ...cur, [k]: v }));
  const loy = (k, v) => setS((cur) => ({ ...cur, loyalty: { ...cur.loyalty, [k]: v } }));
  const mode = (m, on) => set('paymentModes', on ? [...new Set([...s.paymentModes, m])] : s.paymentModes.filter((x) => x !== m));
  const num = (v) => (v === '' ? 0 : Number(v));

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await savePosSettings(businessId, s));
      toast('POS settings saved', 'success');
      onClose();
    } catch (e) {
      toast(e?.message || 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="POS settings"
      dirty={JSON.stringify(s) !== JSON.stringify(settings)}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <Section title="General">
        <Toggle label="Bill Discount" hint="A discount on the whole bill (F9), taken off before GST." checked={s.billDiscount} onChange={(v) => set('billDiscount', v)} />
        <Toggle label="Bill Tax" hint="One GST rate for every item on the bill." checked={s.billTax} onChange={(v) => set('billTax', v)} />
        <Toggle label="Free Item Quantity" hint="Give some quantity free: it leaves stock but is not charged." checked={s.freeQty} onChange={(v) => set('freeQty', v)} />
        <Toggle label="Enable Loyalty Points" checked={s.loyalty.enabled} onChange={(v) => loy('enabled', v)} />
        {s.loyalty.enabled && (
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr', margin: '0.4rem 0 0.6rem' }}>
            <label className="form-label">Points per ₹100<input className="form-input" type="number" min="0" value={s.loyalty.earnPer100} onChange={(e) => loy('earnPer100', num(e.target.value))} /></label>
            <label className="form-label">₹ per point<input className="form-input" type="number" min="0" step="0.01" value={s.loyalty.pointValue} onChange={(e) => loy('pointValue', num(e.target.value))} /></label>
            <label className="form-label">Minimum bill (₹)<input className="form-input" type="number" min="0" value={s.loyalty.minBill} onChange={(e) => loy('minBill', num(e.target.value))} /></label>
            <label className="form-label">Max % payable by points<input className="form-input" type="number" min="0" max="100" value={s.loyalty.maxRedeemPercent} onChange={(e) => loy('maxRedeemPercent', num(e.target.value))} /></label>
          </div>
        )}
        <label className="form-label">Round off total
          <select className="form-input" value={s.roundOff} onChange={(e) => set('roundOff', e.target.value)}>
            <option value="nearest">Nearest to ₹1</option>
            <option value="up">Up to ₹1</option>
            <option value="down">Down to ₹1</option>
            <option value="none">Do not round</option>
          </select>
        </label>
      </Section>

      <Section title="PoS settings">
        <Toggle label="Direct Quantity Change" hint="Type the quantity in the bill table; also lets “3*” before an item set its quantity." checked={s.directQtyChange} onChange={(v) => set('directQtyChange', v)} />
        <Toggle label="Sell below zero stock without asking" hint="Otherwise a bill that takes stock below zero asks first (when the Transaction setting is Warn)." checked={s.allowNegativeStock} onChange={(v) => set('allowNegativeStock', v)} />
        <label className="form-label">Primary action for bill
          <select className="form-input" value={s.primaryAction} onChange={(e) => set('primaryAction', e.target.value)}>
            <option value="save-print">Save &amp; Print Bill</option>
            <option value="save-new">Save &amp; New</option>
          </select>
        </label>
        <label className="form-label">Pricing
          <select className="form-input" value={s.pricing} onChange={(e) => set('pricing', e.target.value)}>
            <option value="with-tax">Price is with tax</option>
            <option value="without-tax">Price is without tax</option>
          </select>
        </label>
        <label className="form-label">Receipt paper
          <select className="form-input" value={s.paper} onChange={(e) => set('paper', e.target.value)}>
            <option value="80mm">Thermal 80 mm</option>
            <option value="58mm">Thermal 58 mm</option>
            <option value="a4">A4</option>
          </select>
        </label>
        <label className="form-label">Receipt footer
          <input className="form-input" maxLength={300} value={s.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} />
        </label>
      </Section>

      <Section title="Payment modes">
        {MODES.map(([id, label]) => (
          <div key={id}>
            <Toggle label={label} checked={s.paymentModes.includes(id)} disabled={id === 'cash'} onChange={(v) => mode(id, v)} />
            {id !== 'cash' && s.paymentModes.includes(id) && banks.length > 0 && (
              <select className="form-input" style={{ margin: '0 0 0.4rem' }} aria-label={`${label} is received into`} value={s.modeAccounts[id] || ''}
                onChange={(e) => set('modeAccounts', { ...Object.fromEntries(Object.entries(s.modeAccounts).filter(([k]) => k !== id)), ...(e.target.value ? { [id]: e.target.value } : {}) })}>
                <option value="">Default account</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            )}
          </div>
        ))}
      </Section>
      <Link to="/settings/documents" onClick={onClose}>More settings →</Link>
    </Drawer>
  );
}
