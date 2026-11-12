import { useState } from 'react';
import { Check, FileText, Package, Users } from 'lucide-react';
import { saveClient, saveProduct } from '../../lib/data';
import { toast } from '../../components/ui/Toast';

const STEPS = [
  { id: 'customer', title: 'Add a customer', icon: Users },
  { id: 'item', title: 'Add an item', icon: Package },
  { id: 'invoice', title: 'Create the invoice', icon: FileText },
];

// After setup: three short steps to the first invoice, so nobody lands on an empty app. Each step can be skipped.
export default function FirstInvoiceGuide({ onFinish }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState({ name: '', phone: '' });
  const [i, setI] = useState({ name: '', sellingPrice: '', taxPercent: '18', unit: 'Pcs' });
  const [made, setMade] = useState({ customer: '', item: '' });

  const saveCustomer = async () => {
    if (!c.name.trim()) { setStep(1); return; }
    setBusy(true);
    try { await saveClient({ name: c.name.trim(), phone: c.phone.trim(), country: 'India' }); setMade((m) => ({ ...m, customer: c.name.trim() })); setStep(1); }
    catch { toast('Could not save the customer. You can add one from Parties.', 'error'); }
    finally { setBusy(false); }
  };
  const saveItem = async () => {
    if (!i.name.trim()) { setStep(2); return; }
    setBusy(true);
    try {
      const price = Number(i.sellingPrice) || 0;
      await saveProduct({ name: i.name.trim(), sellingPrice: price, rate: price, purchasePrice: 0, taxPercent: Number(i.taxPercent) || 0, unit: i.unit || 'Pcs', stock: 0 });
      setMade((m) => ({ ...m, item: i.name.trim() })); setStep(2);
    } catch { toast('Could not save the item. You can add one from Items.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-wide glass-panel">
        <div className="auth-brand">Ledgora</div>
        <ol className="setup-steps" aria-label="First invoice steps">
          {STEPS.map((s, n) => (
            <li key={s.id} className={n === step ? 'on' : n < step ? 'done' : ''} aria-current={n === step ? 'step' : undefined}>
              <span>{n < step ? <Check size={12} /> : n + 1}</span> {s.title}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <>
            <h1 className="auth-title">Who is your first customer?</h1>
            <p className="auth-muted">A name is enough. Add GSTIN and address later from Parties.</p>
            <div className="auth-grid">
              <div className="form-group"><label className="form-label" htmlFor="fg-cname">Customer name</label><input id="fg-cname" className="form-input" autoFocus value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="fg-cphone">Phone (optional)</label><input id="fg-cphone" className="form-input" type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></div>
            </div>
            <div className="auth-actions"><button type="button" className="auth-link" onClick={() => setStep(1)}>Skip</button><button type="button" className="btn btn-primary" disabled={busy} onClick={saveCustomer}>{busy ? 'Saving…' : 'Save and continue'}</button></div>
          </>
        )}
        {step === 1 && (
          <>
            <h1 className="auth-title">What do you sell?</h1>
            <p className="auth-muted">Add one item or service now. The price and GST fill in on the invoice by themselves.</p>
            <div className="auth-grid">
              <div className="form-group auth-span2"><label className="form-label" htmlFor="fg-iname">Item or service name</label><input id="fg-iname" className="form-input" autoFocus value={i.name} onChange={(e) => setI({ ...i, name: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="fg-iprice">Selling price (₹)</label><input id="fg-iprice" className="form-input" type="number" min="0" step="any" value={i.sellingPrice} onChange={(e) => setI({ ...i, sellingPrice: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="fg-igst">GST %</label><input id="fg-igst" className="form-input" type="number" min="0" max="100" step="any" value={i.taxPercent} onChange={(e) => setI({ ...i, taxPercent: e.target.value })} /></div>
            </div>
            <div className="auth-actions"><button type="button" className="auth-link" onClick={() => setStep(2)}>Skip</button><button type="button" className="btn btn-primary" disabled={busy} onClick={saveItem}>{busy ? 'Saving…' : 'Save and continue'}</button></div>
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="auth-title">Create your first invoice</h1>
            <p className="auth-muted">
              {made.customer || made.item ? `Ready: ${[made.customer && `customer ${made.customer}`, made.item && `item ${made.item}`].filter(Boolean).join(', ')}. ` : ''}
              Pick the customer, pick the item, and save. You can print, download or send it from there.
            </p>
            <div className="auth-actions"><button type="button" className="auth-link" onClick={() => onFinish(false)}>Take me to the app</button><button type="button" className="btn btn-primary" onClick={() => onFinish(true)}>Create the invoice</button></div>
          </>
        )}
      </div>
    </div>
  );
}
