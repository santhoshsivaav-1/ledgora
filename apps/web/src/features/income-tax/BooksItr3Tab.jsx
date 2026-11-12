import { useEffect, useState } from 'react';
import { itr3Map, projectAnnualProfit } from '@ledgora/tax-engine';
import { formatCurrency, getFinancialYearStart, localToday } from '../../utils';
import { listBusinesses } from '../../lib/data/accounting';
import { runServerReport } from '../reports/definitions';
import { toast } from '../../components/ui/Toast';

// Vyapar parity P10-S8: business income from the books. The ledger's Profit & Loss for the financial year so far, mapped
// to ITR-3 Part A-P&L, and the profit projected over the full year for the regime calculator and advance tax. A summary
// to review with a CA, not a filing: there is no public ITR submission API, the figures are typed on incometax.gov.in.

const errText = (e) => e?.body?.error?.message || e?.message || 'Could not read the Profit & Loss';

export default function BooksItr3Tab({ onUseIncome }) {
  const [state, setState] = useState({ loading: true });
  const [projected, setProjected] = useState('');
  const from = `${getFinancialYearStart(new Date())}-04-01`;
  const to = localToday();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = await listBusinesses();
        const biz = list.find((b) => b.isDefault) || list[0];
        if (!biz) throw new Error('No business yet');
        const pl = await runServerReport('profit-loss', biz.id, { period: { from, to } });
        if (!live) return;
        const map = itr3Map(pl);
        setState({ map, business: biz.name });
        setProjected(String(projectAnnualProfit(map.rows.find((r) => r.key === 'netProfit').amount, from, to)));
      } catch (e) {
        if (live) setState({ error: errText(e) });
      }
    })();
    return () => { live = false; };
  }, [from, to]);

  if (state.loading) return <div className="glass-panel p-6">Reading the Profit &amp; Loss…</div>;
  if (state.error)
    return (
      <div className="glass-panel p-6">
        <p style={{ margin: 0 }}>{state.error}</p>
        <p className="field-hint">This needs the accounting ledger (Accounting → turn on). Without it, use the Presumptive tab or type your profit in the calculator.</p>
      </div>
    );
  const { map } = state;
  const net = map.rows.find((r) => r.key === 'netProfit').amount;
  const download = () => {
    const blob = new Blob([JSON.stringify({ financialYearFrom: from, upTo: to, business: state.business, partAPL: map.rows.map(({ key, label, schedule, amount }) => ({ key, label, schedule, amount })), reconciled: map.reconciled, note: 'Not for direct filing. Review with your CA.' }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ITR3_PartA-PL_${from}_${to}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="glass-panel p-6">
      <h3 className="section-title" style={{ marginTop: 0 }}>Books-based ITR-3 · {state.business}</h3>
      <p className="field-hint" style={{ marginTop: 0 }}>Financial year from {from} up to {to}, from the ledger's Profit &amp; Loss.</p>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>ITR-3 field</th><th>Where</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {map.rows.map((r) => (
              <tr key={r.key} style={r.key === 'netProfit' ? { fontWeight: 700 } : undefined}>
                <td>{r.label}</td><td className="text-muted">{r.schedule}</td><td style={{ textAlign: 'right' }}>{formatCurrency(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!map.reconciled && (
        <p className="ui-error">The mapped lines differ from the Profit &amp; Loss by {formatCurrency(map.diff)}. Check the account names (purchases, depreciation, interest) before using these figures.</p>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginTop: 12 }}>
        <label>
          <span className="form-label">Projected profit for the full year</span>
          <input type="number" className="form-input" value={projected} onChange={(e) => setProjected(e.target.value)} />
          <span className="field-hint">Profit to date {formatCurrency(net)}, annualised. Edit it if the rest of the year will differ.</span>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => { onUseIncome(Number(projected) || 0); toast('Business income set from the books; Advance Tax uses it too', 'success'); }}>
          Use as business income
        </button>
        <button type="button" className="btn btn-secondary" onClick={download}>Download JSON</button>
      </div>
      <p className="field-hint">⚠ Not for direct filing. Depreciation in the books is not the Income-tax Act's (Schedule DEP); have your CA review these values.</p>
    </div>
  );
}
