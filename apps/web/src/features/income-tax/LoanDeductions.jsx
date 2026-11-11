import { useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { formatCurrency } from '../../utils';
import { listBusinesses } from '../../lib/data/accounting';
import { cashbankSettings, loanTaxSummary } from '../../lib/data/cashbank';

// Vyapar parity P5-S5 "Income Tax link": housing and education loans kept in Cash & Bank suggest their deductions for
// the year — home-loan interest under §24(b) (₹2,00,000 for a self-occupied house), home-loan principal towards §80C
// (the ₹1,50,000 cap is shared with PPF, ELSS and the rest) and education-loan interest under §80E (no cap). Old regime
// only. Shows nothing when Cash & Bank is off or there are no such loans.

export default function LoanDeductions({ fy, deductions, onApply }) {
  const [t, setT] = useState(null);
  const [added80C, setAdded80C] = useState(false);
  useEffect(() => {
    let live = true;
    listBusinesses()
      .then(async (b) => {
        const id = b[0]?.id;
        if (!id || !(await cashbankSettings(id)).enabled) return;
        const r = await loanTaxSummary(id, fy);
        if (live && r.items.some((i) => i.interest || i.principal)) setT(r);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [fy]);
  if (!t) return null;
  const s = t.suggestions;
  const money = (n) => formatCurrency(n);
  const applied = (deductions?.['24b'] || 0) === s['24b'] && (deductions?.['80E'] || 0) === s['80E'];
  return (
    <div className="glass-panel p-4" style={{ margin: '0.5rem 0 0.75rem', fontSize: '0.82rem' }} aria-label="From your loan accounts">
      <strong><Landmark size={14} aria-hidden="true" /> From your loan accounts (FY {t.fy})</strong>
      <ul style={{ margin: '0.4rem 0', paddingLeft: '1.1rem' }}>
        {t.items.map((i) => (
          <li key={i.loanId}>{i.name} ({i.purpose === 'housing' ? 'home loan' : 'education loan'}): interest {money(i.interest)}, principal {money(i.principal)}</li>
        ))}
      </ul>
      <div>§24(b) home-loan interest: <strong>{money(s['24b'])}</strong>{s.housingInterest > s['24b'] && <span> (of {money(s.housingInterest)} paid; ₹2,00,000 cap for a self-occupied house)</span>}</div>
      <div>§80E education-loan interest: <strong>{money(s['80E'])}</strong></div>
      <div>Home-loan principal that counts towards §80C: <strong>{money(s['80C'])}</strong></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} disabled={applied} onClick={() => onApply({ '24b': s['24b'], '80E': s['80E'] })}>{applied ? 'Used for §24(b) and §80E ✔' : 'Use for §24(b) and §80E'}</button>
        {s['80C'] > 0 && (
          <button className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }} disabled={added80C} onClick={() => { onApply({ '80C': (Number(deductions?.['80C']) || 0) + s['80C'] }); setAdded80C(true); }}>{added80C ? 'Added to §80C ✔' : `Add ${money(s['80C'])} to §80C`}</button>
        )}
      </div>
      <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)', fontSize: '0.72rem' }}>Counted from payments recorded in the year. Check against your lender's interest certificate.</p>
    </div>
  );
}
