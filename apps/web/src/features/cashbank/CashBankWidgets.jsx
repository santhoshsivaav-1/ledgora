import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatCurrency } from '../../utils';
import { listBusinesses } from '../../lib/data/accounting';
import { cashbankSettings, cashbankSummary } from '../../lib/data/cashbank';

// Vyapar parity P5-S7: the Home widgets for Cash & Bank. Kept apart from CashBankPage so Home does not load that screen.

const money = (n) => formatCurrency(n);

/** Cash + Bank, cheques due, EMIs due in 7 days, overdraft warning. Renders nothing when Cash & Bank is off. */
export default function CashBankWidgets() {
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  useEffect(() => {
    let live = true;
    listBusinesses()
      .then(async (b) => {
        const id = b[0]?.id;
        if (!id) return;
        const st = await cashbankSettings(id);
        if (st.enabled && live) setS(await cashbankSummary(id));
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  if (!s) return null;
  const tile = (label, value, hint, go, tone) => (
    <button type="button" className="glass-panel p-4" style={{ textAlign: 'left', cursor: 'pointer', border: tone === 'bad' ? '1px solid #dc2626' : undefined }} onClick={go}>
      <div className="field-hint">{label}</div><div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{value}</div><div className="field-hint">{hint}</div>
    </button>
  );
  return (
    <section aria-label="Cash and bank" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem', margin: '0.75rem 0' }}>
      {tile('Cash + Bank', money(s.total), `Cash ${money(s.cash)} · Bank ${money(s.bank)}`, () => navigate('/cash-bank/accounts'))}
      {tile('Cheques due', String(s.chequesDue.count), s.chequesDue.count ? money(s.chequesDue.amount) : 'None due', () => navigate('/cash-bank/cheques'), s.chequesDue.count ? 'bad' : undefined)}
      {tile('Loan EMI due in 7 days', String(s.emiDue.count), s.emiDue.count ? money(s.emiDue.amount) : 'None due', () => navigate('/cash-bank/loans'))}
      {s.overdrawn.length > 0 && tile('Overdrawn', String(s.overdrawn.length), s.overdrawn.map((o) => `${o.name} ${money(o.balance)}`).join(' · '), () => navigate('/cash-bank/accounts'), 'bad')}
    </section>
  );
}
