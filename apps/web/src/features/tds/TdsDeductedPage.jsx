import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ReceiptText } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import { TabStrip } from '../../components/ui/Tabs';
import { Field, MoneyInput, Select, TextInput } from '../../components/ui/Field';
import { toast } from '../../components/ui/Toast';
import { depositTds, getTdsCompute, getTdsStatement, listBusinesses, listParties } from '../../lib/data/accounting';
import { localToday } from '../../utils';
import { dmy, err } from '../filing/Itr4Page';

const rupees = (v) => `₹${(Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
import './tds.css';

// R3: TDS we deduct (as the payer). Which payments need TDS and how much, the quarter's register with challans, interest and the
// section 234E exposure, and a CSV to prepare the statement from. It does not produce the department's FVU file.
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const fyNow = () => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
const TABS = [{ id: 'statement', label: 'Quarter register' }, { id: 'calc', label: 'What to deduct' }];

function Calculator({ businessId }) {
  const [parties, setParties] = useState([]);
  const [f, setF] = useState({ section: '194C', amount: null, date: localToday(), partyId: '', pan: '', lowerRate: null });
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listParties(businessId).then(setParties, () => setParties([])); }, [businessId]);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const run = async () => {
    if (!f.amount) { toast('Enter the amount being paid', 'error'); return; }
    setBusy(true);
    try {
      const q = { businessId, section: f.section, amount: String(f.amount), date: f.date };
      if (f.partyId) q.partyId = f.partyId;
      if (f.pan) q.pan = f.pan;
      if (f.lowerRate != null && f.lowerRate !== '') q.lowerRate = String(f.lowerRate);
      setRes(await getTdsCompute(q));
    } catch (e) { toast(err(e), 'error'); } finally { setBusy(false); }
  };
  const sections = res?.sections || [
    ['194C', '194C Contractor / sub-contractor'], ['194J', '194J Professional fees'], ['194J-tech', '194J Technical services'], ['194I-pm', '194I(a) Rent, plant and machinery'],
    ['194I', '194I(b) Rent, land and building'], ['194H', '194H Commission or brokerage'], ['194A', '194A Interest'], ['194Q', '194Q Purchase of goods'], ['194R', '194R Business benefit'], ['194T', '194T Payments to partners'],
  ].map(([code, label]) => ({ code, label }));
  return (
    <section className="glass-panel p-4" aria-label="What to deduct">
      <p className="ui-help">Pick who you are paying and what for. We add what you have already paid them this financial year, because most sections have a yearly limit.</p>
      <div className="tds-grid">
        <Field label="Section"><Select value={f.section} onChange={set('section')} options={sections.map((s) => ({ value: s.code, label: s.label }))} /></Field>
        <Field label="Paying (₹)"><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
        <Field label="Date"><TextInput type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Party"><Select value={f.partyId} onChange={set('partyId')} placeholder="Not on the list" options={parties.map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="PAN" help="Used when no party is picked, or the party has no GSTIN"><TextInput value={f.pan} onChange={(v) => set('pan')(v.toUpperCase())} maxLength={10} /></Field>
        <Field label="Lower rate (%)" help="From a section 197 certificate"><MoneyInput value={f.lowerRate} onChange={set('lowerRate')} /></Field>
      </div>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Working it out…' : 'Work it out'}</button>
      {res && (
        <div className={`tds-result ${res.deduct ? 'tds-result-yes' : 'tds-result-no'}`} role="status">
          <b>{res.deduct ? `Deduct ${rupees(res.tds)}` : 'No TDS on this payment'}</b>
          <span>{res.reason}</span>
          <span className="ui-help">Paid to this payee earlier this year under this section: {rupees(res.paidBefore)}; TDS already deducted: {rupees(res.deductedBefore)}.{res.pan ? ` PAN ${res.pan}.` : ' No PAN on file.'}</span>
          <span className="ui-help">{res.note}</span>
        </div>
      )}
    </section>
  );
}

function Deposit({ entry, businessId, onDone }) {
  const [f, setF] = useState({ challanNo: '', bsrCode: '', challanDate: localToday() });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await depositTds(entry.id, f); toast('Marked deposited', 'success'); onDone(); } catch (e) { toast(err(e), 'error'); setBusy(false); }
  };
  return (
    <div className="tds-deposit">
      <TextInput aria-label="Challan number" placeholder="Challan no." value={f.challanNo} onChange={(v) => setF((s) => ({ ...s, challanNo: v }))} />
      <TextInput aria-label="BSR code" placeholder="BSR code (7 digits)" value={f.bsrCode} onChange={(v) => setF((s) => ({ ...s, bsrCode: v }))} maxLength={7} />
      <TextInput aria-label="Deposited on" type="date" value={f.challanDate} onChange={(v) => setF((s) => ({ ...s, challanDate: v }))} />
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Save</button>
    </div>
  );
}

function Statement({ businessId }) {
  const [fy, setFy] = useState(fyNow());
  const [quarter, setQuarter] = useState('Q1');
  const [filedOn, setFiledOn] = useState('');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setData(null);
    getTdsStatement(businessId, fy, quarter, filedOn).then((d) => { setData(d); setError(null); }, setError);
  }, [businessId, fy, quarter, filedOn]);
  useEffect(load, [load]);
  const csv = () => {
    const url = URL.createObjectURL(new Blob([data.csv], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `tds-${fy}-${quarter}.csv` }).click();
    URL.revokeObjectURL(url);
  };
  const years = useMemo(() => [fyNow() - 2, fyNow() - 1, fyNow(), fyNow() + 1], []);
  return (
    <section aria-label="Quarter register">
      <div className="tds-bar">
        <Select value={String(fy)} onChange={(v) => setFy(Number(v))} aria-label="Financial year" options={years.map((y) => ({ value: String(y), label: `FY ${y}-${String(y + 1).slice(2)}` }))} />
        <div role="group" aria-label="Quarter" className="tds-quarters">
          {QUARTERS.map((q) => <button key={q} type="button" aria-pressed={quarter === q} className={`btn btn-sm ${quarter === q ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setQuarter(q)}>{q}</button>)}
        </div>
        <label className="tds-filed">Statement filed on <TextInput type="date" aria-label="Statement filed on" value={filedOn} onChange={setFiledOn} /></label>
        {data && <button type="button" className="btn btn-secondary" onClick={csv}><Download size={14} /> Download CSV</button>}
      </div>
      {error && <ErrorState error={error} />}
      {!error && !data && <LoadingState />}
      {data && (
        <>
          <div className="tds-cards">
            {[['TDS deducted', rupees(data.totals.tds)], ['Deposited', rupees(data.totals.deposited)], ['Not deposited', rupees(data.totals.undeposited)], ['Interest to date', rupees(data.totals.interest)], ['Statement due', dmy(data.dueDate)], ['Late fee (234E)', rupees(data.lateFee.fee)]]
              .map(([l, v]) => <div key={l} className="tds-card"><span>{l}</span><b>{v}</b></div>)}
          </div>
          {data.issues.length > 0 && <ul className="tds-issues" aria-label="Things to fix">{data.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          <p className="ui-help">{data.notice}</p>
          <div className="glass-panel p-4">
            <h3 className="section-title">Deductions</h3>
            <div className="table-scroll">
              <table className="ui-table">
                <thead><tr><th>Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th className="num">Paid</th><th className="num">Rate</th><th className="num">TDS</th><th>Status</th><th className="num">Interest</th><th /></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{dmy(r.date)}</td><td>{r.partyName}</td><td>{r.pan || <StatusChip tone="warn">missing</StatusChip>}</td><td>{r.section}</td>
                      <td className="num">{rupees(r.baseAmount)}</td><td className="num">{r.rate}%</td><td className="num">{rupees(r.tdsAmount)}</td>
                      <td>{r.status === 'deposited' ? <StatusChip tone="success">Deposited {dmy(r.challanDate)}</StatusChip> : <StatusChip tone="warn">Due {dmy(r.dueDate)}</StatusChip>}</td>
                      <td className="num">{r.interest ? rupees(r.interest) : ''}</td>
                      <td>{r.status !== 'deposited' && (open === r.id ? <Deposit entry={r} businessId={businessId} onDone={() => { setOpen(''); load(); }} /> : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(r.id)}>Mark deposited</button>)}</td>
                    </tr>
                  ))}
                  {!data.rows.length && <tr><td colSpan={10} className="ui-help">No TDS was deducted in this quarter.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="tds-two">
            <div className="glass-panel p-4">
              <h3 className="section-title">By deductee</h3>
              <div className="table-scroll"><table className="ui-table"><thead><tr><th>Deductee</th><th>PAN</th><th>Section</th><th className="num">Payments</th><th className="num">TDS</th></tr></thead>
                <tbody>{data.deductees.map((d) => <tr key={`${d.pan}${d.partyName}${d.section}`}><td>{d.partyName}</td><td>{d.pan}</td><td>{d.section}</td><td className="num">{d.payments}</td><td className="num">{rupees(d.tds)}</td></tr>)}</tbody></table></div>
            </div>
            <div className="glass-panel p-4">
              <h3 className="section-title">By challan</h3>
              <div className="table-scroll"><table className="ui-table"><thead><tr><th>Challan</th><th>BSR</th><th>Date</th><th className="num">Deductions</th><th className="num">TDS</th></tr></thead>
                <tbody>{data.challans.map((c) => <tr key={`${c.bsrCode}${c.challanNo}`}><td>{c.challanNo}</td><td>{c.bsrCode}</td><td>{dmy(c.challanDate)}</td><td className="num">{c.entries}</td><td className="num">{rupees(c.tds)}</td></tr>)}
                  {!data.challans.length && <tr><td colSpan={5} className="ui-help">No challan yet.</td></tr>}</tbody></table></div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default function TdsDeductedPage() {
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [tab, setTab] = useState('statement');
  const [error, setError] = useState(null);
  useEffect(() => {
    listBusinesses().then((list) => { setBusinesses(list); setBusinessId((list.find((b) => b.isDefault) || list[0])?.id ?? ''); }, setError);
  }, []);
  if (error) return <ErrorState error={error} />;
  if (!businesses) return <LoadingState />;
  return (
    <div className="dashboard-container">
      <PageHeader icon={<ReceiptText size={22} />} title="TDS Deducted" subtitle="Tax you deduct when you pay others: how much, when to deposit it, and the quarter's register" />
      <TabStrip tabs={TABS} value={tab} onChange={setTab} ariaLabel="TDS" />
      <div className="tds-body">
        {tab === 'statement' ? <Statement businessId={businessId} /> : <Calculator businessId={businessId} />}
      </div>
    </div>
  );
}
