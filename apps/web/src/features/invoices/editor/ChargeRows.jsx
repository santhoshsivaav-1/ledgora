import { Plus, X } from 'lucide-react';
import { DEFAULT_CHARGE_PRESETS } from '@ledgora/tax-engine';
import { useAppSetting } from '../../../lib/appSettings';
import { Field, MoneyInput, Select, TextInput } from '../../../components/ui/Field';
import { formatCurrency, GST_PORTAL_RATES } from '../../../utils';

// Vyapar parity P2-S3: additional charges (shipping, packaging...). Each is a taxable supply at its own GST rate with
// its own SAC; the amount is before tax. Totals add them to taxable value and tax (tax-engine computeInvoiceTotals).

const rateOptions = (GST_PORTAL_RATES || [0, 0.25, 3, 5, 12, 18, 28]).map((r) => ({ value: String(r), label: `${r}%` }));

export default function ChargeRows({ charges, onChange, presets: given, totals, currency, showGST }) {
  // Settings > Transaction > Additional charges is the list of presets offered here.
  const configured = useAppSetting('txn.charges');
  const presets = given || (Array.isArray(configured) ? configured.map((c) => ({ name: c.name, gstRate: c.gst, hsn: c.sac })) : DEFAULT_CHARGE_PRESETS);
  const set = (i, patch) => onChange(charges.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = () => {
    const unused = presets.find((p) => !charges.some((c) => c.name === p.name)) || presets[0] || { name: 'Charge', gstRate: 18, hsn: '' };
    onChange([...charges, { name: unused.name, amount: null, gstRate: unused.gstRate, hsn: unused.hsn }]);
  };
  const pickName = (i, name) => {
    const p = presets.find((x) => x.name === name);
    set(i, p ? { name, gstRate: p.gstRate, hsn: p.hsn } : { name });
  };
  return (
    <section className="glass-panel p-6 mb-6 sale-charges" aria-labelledby="sale-charges-title">
      <h3 id="sale-charges-title" className="section-title">Additional charges</h3>
      <datalist id="sale-charge-presets">
        {presets.map((p) => <option key={p.name} value={p.name} />)}
      </datalist>
      {charges.map((c, i) => (
        <div key={c.id || i} className="sale-charge-row">
          <Field label={i === 0 ? 'Name' : undefined}>
            <TextInput value={c.name} onChange={(v) => pickName(i, v)} list="sale-charge-presets" maxLength={80} aria-label={`Charge ${i + 1} name`} />
          </Field>
          <Field label={i === 0 ? 'Amount (before tax)' : undefined}>
            <MoneyInput value={c.amount} onChange={(v) => set(i, { amount: v })} aria-label={`Charge ${i + 1} amount`} />
          </Field>
          {showGST && (
            <Field label={i === 0 ? 'GST' : undefined}>
              <Select value={String(c.gstRate ?? 0)} onChange={(v) => set(i, { gstRate: Number(v) })} options={rateOptions} aria-label={`Charge ${i + 1} GST rate`} />
            </Field>
          )}
          <Field label={i === 0 ? 'SAC' : undefined}>
            <TextInput value={c.hsn} onChange={(v) => set(i, { hsn: v.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" aria-label={`Charge ${i + 1} SAC`} />
          </Field>
          <button type="button" className="ui-btn ui-btn-ghost" onClick={() => onChange(charges.filter((_, j) => j !== i))} aria-label={`Remove charge ${i + 1}`}>
            <X size={16} />
          </button>
        </div>
      ))}
      <div className="sale-payment-foot">
        <button type="button" className="btn btn-secondary" onClick={add} disabled={charges.length >= 20}>
          <Plus size={14} /> Add charge
        </button>
        {totals?.chargesTotal > 0 && (
          <span className="sale-payment-totals">
            Charges <strong>{formatCurrency(totals.chargesTotal, currency)}</strong>
            {showGST && <> + GST {formatCurrency(totals.chargesTax, currency)}</>}
          </span>
        )}
      </div>
    </section>
  );
}
