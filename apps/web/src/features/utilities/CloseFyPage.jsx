import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck2 } from 'lucide-react';
import { Link } from 'react-router';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { confirmAction, promptAction } from '../../components/ui/ConfirmModal';
import { toast } from '../../components/ui/Toast';
import { formatCurrency } from '../../utils';
import { backupNow, financialYears, fyClose, fyHistory, fyPreview, fyReopen } from '../../lib/data/utilities';
import { EnableAccounting, errText, fmtDate, isLedgerOff, useBusiness } from './shared';

// Vyapar parity P7-S3: Close Financial Year. Backup check, method, lock, then type the year to confirm. One transaction
// on the server: the closing entry (the year's profit to Retained Earnings), the numbering restart, the lock and the
// audit row. Needs the ledger and a backup in the last 24 hours. The ledger is continuous, so parties, stock, bank,
// cash, loans and cheques carry into the new year as they stand; the result page shows what they are.

const money = (n) => formatCurrency(n);
const STEPS = ['Backup', 'Method', 'Lock', 'Confirm'];

export default function CloseFyPage() {
  const { biz, loading, error } = useBusiness();
  const [years, setYears] = useState(null);
  const [history, setHistory] = useState([]);
  const [year, setYear] = useState(null);
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState('new-year');
  const [prefix, setPrefix] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [pre, setPre] = useState(null);
  const [off, setOff] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    if (!biz) return;
    try {
      const ys = await financialYears(biz.id);
      setYears(ys);
      setHistory((await fyHistory(biz.id)).data);
      setYear((cur) => cur ?? ys.filter((y) => y.status === 'open').sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? ys[0] ?? null);
    } catch (e) { setLoadError(e); }
  }, [biz]);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    if (!biz || !year) return;
    try { setPre(await fyPreview({ businessId: biz.id, yearId: year.id, method, newPrefix: prefix, confirmText })); setOff(null); }
    catch (e) { if (isLedgerOff(e)) setOff(e.message); else toast(errText(e), 'error'); }
  }, [biz, year, method, prefix, confirmText]);
  useEffect(() => { refresh(); }, [refresh]);

  const backup = async () => {
    setBusy(true);
    try { await backupNow({ note: `Before closing ${year.label}` }); toast('Backup taken', 'success'); await refresh(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const close = async () => {
    setBusy(true);
    try {
      setResult(await fyClose({ businessId: biz.id, yearId: year.id, method, newPrefix: prefix, confirmText }));
      await load();
    } catch (e) { toast(errText(e), 'error'); await refresh(); } finally { setBusy(false); }
  };
  const reopen = async (y) => {
    const reason = await promptAction({ title: `Reopen ${y.label}?`, message: 'The closing entry is reversed and the reason is recorded. Owner only.', placeholder: 'Why (at least 5 characters)' });
    if (!reason) return;
    if (!(await confirmAction({ title: `Reopen ${y.label}`, message: 'Writes into this year are allowed again. Close it again when you are done.', confirmLabel: 'Reopen' }))) return;
    try { await fyReopen({ businessId: biz.id, yearId: y.id, reason }); toast(`${y.label} reopened`, 'success'); setResult(null); await load(); await refresh(); } catch (e) { toast(errText(e), 'error'); }
  };

  if (error || loadError) return <ErrorState message={errText(error || loadError)} onRetry={() => window.location.reload()} />;
  if (loading || !years) return <LoadingState label="Opening Close Financial Year…" />;
  if (off) return <div className="dashboard-container"><PageHeader icon={<CalendarCheck2 size={22} />} title="Close Financial Year" /><EnableAccounting what="Closing a financial year" message={off} /></div>;

  const problems = pre?.problems ?? [];
  const only = (...codes) => problems.filter((p) => codes.includes(p.code));
  const blocking = (step === 0 ? only('backup_needed', 'already_closed', 'not_ended', 'earlier_open') : step === 1 ? only('prefix_required', 'prefix_invalid') : step === 3 ? problems : []);

  if (result)
    return (
      <div className="dashboard-container">
        <PageHeader icon={<CalendarCheck2 size={22} />} title={`${result.year.label} is closed`} subtitle="The new year opens on these balances." />
        <div className="glass-panel p-4" data-testid="fy-result">
          <p>Net {result.netProfit >= 0 ? 'profit' : 'loss'} of <strong>{money(Math.abs(result.netProfit))}</strong> moved to Retained Earnings.</p>
          <table className="data-table"><tbody>
            <tr><td>Cash and bank</td><td className="text-right">{money(result.carry.cashAndBank)}</td></tr>
            <tr><td>Customers owe you</td><td className="text-right">{money(result.carry.receivable)}</td></tr>
            <tr><td>You owe suppliers</td><td className="text-right">{money(result.carry.payable)}</td></tr>
            <tr><td>Total assets</td><td className="text-right">{money(result.carry.assets)}</td></tr>
            <tr><td>Liabilities</td><td className="text-right">{money(result.carry.liabilities)}</td></tr>
            <tr><td>Capital and retained earnings</td><td className="text-right">{money(result.carry.equity)}</td></tr>
          </tbody></table>
          <p className="field-hint">Numbering restarts at 1 in {result.nextYear?.label ?? 'the next year'}. Stock, loans and open cheques carry as they stand.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="btn btn-secondary" to="/reports/balance-sheet">Balance Sheet</Link>
            <Link className="btn btn-secondary" to="/reports/profit-loss">Profit &amp; Loss</Link>
            <button className="btn btn-primary" onClick={() => { setResult(null); setStep(0); setConfirmText(''); setYear(null); load(); }}>Done</button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="dashboard-container">
      <PageHeader icon={<CalendarCheck2 size={22} />} title="Close Financial Year" subtitle="Lock a finished year and start the next on its balances." />
      <div className="glass-panel p-4" style={{ display: 'grid', gap: 12 }}>
        <label className="form-label">Financial year to close
          <select className="form-input" value={year?.id ?? ''} onChange={(e) => { setYear(years.find((y) => y.id === e.target.value)); setStep(0); setConfirmText(''); }}>
            {years.map((y) => <option key={y.id} value={y.id}>{y.label} ({y.startDate} to {y.endDate}){y.status === 'closed' ? ' · closed' : ''}</option>)}
          </select>
        </label>
        <ol aria-label="Steps" style={{ display: 'flex', gap: 14, listStyle: 'none', padding: 0, margin: 0 }}>
          {STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} style={{ fontWeight: i === step ? 700 : 400, opacity: i > step ? 0.5 : 1 }}>{i + 1}. {s}</li>)}
        </ol>

        {step === 0 && (
          <div>
            <p>Last backup: <strong>{pre?.lastBackupAt ? fmtDate(pre.lastBackupAt) : 'none yet'}</strong>. Closing needs one from the last 24 hours.</p>
            <button className="btn btn-secondary" disabled={busy} onClick={backup}>Back up now</button>
          </div>
        )}
        {step === 1 && (
          <fieldset style={{ border: 0, padding: 0 }}>
            <label style={{ display: 'block' }}><input type="radio" name="fym" checked={method === 'prefix'} onChange={() => setMethod('prefix')} /> Change prefix only: numbering restarts at 1 with a new prefix
              {method === 'prefix' && <input className="form-input" style={{ maxWidth: 220, marginLeft: 8 }} aria-label="New prefix" placeholder="e.g. 2026-27/" value={prefix} onChange={(e) => setPrefix(e.target.value)} />}</label>
            <label style={{ display: 'block', marginTop: 6 }}><input type="radio" name="fym" checked={method === 'new-year'} onChange={() => setMethod('new-year')} /> Start new year: numbering restarts at 1 each year, the year's profit moves to Retained Earnings</label>
            {pre?.carry && <p className="field-hint">Carries forward as it stands: cash and bank {money(pre.carry.cashAndBank)}, customers owe {money(pre.carry.receivable)}, you owe {money(pre.carry.payable)}.</p>}
          </fieldset>
        )}
        {step === 2 && <p>The closed year is locked: nobody but the owner, with a reason, can add or change anything dated in it (Accounting › Lock). The owner can reopen the year here.</p>}
        {step === 3 && (
          <div>
            {pre && <p>Net {pre.netProfit >= 0 ? 'profit' : 'loss'} of {money(Math.abs(pre.netProfit))} (income {money(pre.income)}, expenses {money(pre.expense)}) will move to Retained Earnings.</p>}
            <p style={{ color: 'var(--warn-text)' }}>⚠ This cannot be undone without reopening the year (owner only) or restoring a backup.</p>
            <label className="form-label">Type {year?.label} to confirm<input className="form-input" style={{ maxWidth: 200 }} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></label>
          </div>
        )}
        {blocking.length > 0 && <ul role="alert" style={{ color: 'var(--danger, #dc2626)', margin: 0 }}>{blocking.map((p) => <li key={p.code}>{p.message}</li>)}</ul>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          {step < 3 ? <button className="btn btn-primary" disabled={blocking.length > 0} onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn btn-primary" disabled={busy || problems.length > 0} onClick={close}>{busy ? 'Closing…' : `Close FY ${year?.label}`}</button>}
        </div>
      </div>

      {history.length > 0 && (
        <div className="glass-panel p-4 mt-4">
          <h3 className="section-title" style={{ marginTop: 0 }}>Closed with this tool</h3>
          <table className="data-table"><thead><tr><th>Year</th><th>Method</th><th className="text-right">Profit moved</th><th>Closed</th><th /></tr></thead>
            <tbody>{history.map((h) => {
              const y = years.find((x) => x.label === h.year);
              return (
                <tr key={h.id}><td>{h.year}</td><td>{h.method === 'prefix' ? `Prefix ${h.newPrefix}` : 'New year'}</td><td className="text-right">{money(h.netProfit)}</td>
                  <td>{fmtDate(h.closedAt)}{h.reopenedAt ? ` · reopened: ${h.reopenReason}` : ''}</td>
                  <td>{!h.reopenedAt && y?.status === 'closed' && <button className="btn btn-secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => reopen(y)}>Reopen</button>}</td></tr>
              );
            })}</tbody></table>
        </div>
      )}
    </div>
  );
}
