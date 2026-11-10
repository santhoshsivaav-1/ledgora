import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { BookOpen, Lock, Plus, Trash2 } from 'lucide-react';
import { ACCOUNT_GROUPS } from '@ledgora/tax-engine';
import PageHeader from '../../components/ui/PageHeader';
import Can from '../../components/ui/Can';
import { TabStrip } from '../../components/ui/Tabs';
import { StatusChip } from '../../components/ui/Display';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { formatCurrency, localToday } from '../../utils';
import {
  accountLedger, balanceText, closeYear, createAccount, createJournal, deleteAccount, deleteJournal, drCrText, fyRange,
  getLock, journalState, ledgerStatus, listAccounts, listBusinesses, listJournals, listYears, refLink, reopenYear,
  runBackfill, saveLock, trialBalance, updateAccount, updateJournal,
} from '../../lib/data/accounting';
import VerifyData from './VerifyData';

// Vyapar parity Phase 4: the books. Setup (turn the ledger on, period lock, financial years), the chart of accounts, an
// account's ledger, the trial balance, manual journals and Verify My Data. All of it reads and writes the typed /v1 API;
// the ledger holds what documents made through that API posted (see docs/ACCOUNTING.md).

const TABS = [
  { id: 'setup', label: 'Ledger setup' },
  { id: 'accounts', label: 'Chart of accounts' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'trial-balance', label: 'Trial balance' },
  { id: 'journal', label: 'Journal' },
  { id: 'verify', label: 'Verify My Data' },
];
const money = (n) => formatCurrency(n);
const errText = (e) => e?.body?.error?.message || e?.message || 'Something went wrong';
const GROUPS = [...Object.keys(ACCOUNT_GROUPS), 'Duties & taxes'];

export default function AccountingPage({ initialTab = 'setup' }) {
  const params = useParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab : initialTab;
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [bump, setBump] = useState(0);
  const reload = useCallback(() => setBump((b) => b + 1), []);

  useEffect(() => {
    listBusinesses().then((b) => { setBusinesses(b); setBusinessId((cur) => cur || b[0]?.id || ''); }).catch(setError);
  }, []);
  useEffect(() => {
    if (businessId) ledgerStatus(businessId).then(setStatus).catch(setError);
  }, [businessId, bump]);

  if (error) return <ErrorState message={errText(error)} onRetry={() => window.location.reload()} />;
  if (!businesses || (businessId && !status)) return <LoadingState label="Opening the books…" />;
  if (!businesses.length) return <EmptyState title="No business yet" hint="Create a business first." />;
  const on = !!status?.enabled;

  return (
    <div className="dashboard-container">
      <PageHeader
        icon={<BookOpen size={22} />}
        title="Accounting"
        subtitle="Ledger, trial balance and journals, built from your invoices, purchases, payments and expenses"
        actions={
          <>
            {businesses.length > 1 && (
              <select className="filter-select" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setStatus(null); }} aria-label="Business">
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <StatusChip tone={on ? 'success' : 'neutral'}>{on ? 'Ledger on' : 'Ledger off'}</StatusChip>
          </>
        }
      />
      <TabStrip tabs={TABS} value={tab} onChange={(id) => navigate(`/accounting/${id}`)} ariaLabel="Accounting" />
      <div style={{ marginTop: '1rem' }}>
        {tab === 'setup' && <LedgerSetup businessId={businessId} status={status} onChanged={reload} />}
        {tab !== 'setup' && !on && tab !== 'verify' && (
          <EmptyState title="The ledger is off" hint="Turn it on in Ledger setup to see accounts, the ledger, the trial balance and journals." action={<button className="btn btn-primary" onClick={() => navigate('/accounting/setup')}>Go to Ledger setup</button>} />
        )}
        {on && tab === 'accounts' && <ChartOfAccounts businessId={businessId} />}
        {on && tab === 'ledger' && <AccountLedger businessId={businessId} />}
        {on && tab === 'trial-balance' && <TrialBalance businessId={businessId} />}
        {on && tab === 'journal' && <Journal businessId={businessId} />}
        {tab === 'verify' && <VerifyData businessId={businessId} />}
      </div>
    </div>
  );
}

// ---- P4-S4 enable, P4-S6 lock and years --------------------------------------------------------------------------------

function LedgerSetup({ businessId, status, onChanged }) {
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lock, setLock] = useState(null);
  const [years, setYears] = useState([]);
  const on = !!status?.enabled;

  const loadSide = useCallback(() => {
    getLock(businessId).then(setLock).catch(() => {});
    listYears(businessId).then(setYears).catch(() => {});
  }, [businessId]);
  useEffect(() => { loadSide(); }, [loadSide]);

  const run = async (dryRun, force = false) => {
    setBusy(true);
    try {
      const r = await runBackfill({ businessId, dryRun, force });
      setCheck(r);
      if (!dryRun) {
        if (r.enabled) toast('The ledger is on', 'success');
        else toast('Not turned on: the checks found differences. Nothing was changed.', 'warning');
        onChanged();
      }
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const enable = async (force) => {
    if (!(await confirmAction({ title: force ? 'Turn on anyway?' : 'Turn on the ledger?', message: force ? 'Party balances differ between the ledger and your documents. The ledger will carry the differences until you fix them in Verify My Data.' : 'Every document is posted to the ledger. From now on new ones post automatically. Your documents do not change.', confirmLabel: force ? 'Turn on anyway' : 'Enable ledger and post history', tone: force ? 'warning' : undefined }))) return;
    run(false, force);
  };
  const saveLockBody = async (patch) => {
    const next = { ...lock, ...patch };
    try { setLock(await saveLock({ businessId, ...next })); toast('Saved', 'success'); } catch (e) { toast(errText(e), 'error'); }
  };
  const toggleYear = async (y) => {
    try { y.status === 'open' ? await closeYear(y.id) : await reopenYear(y.id); loadSide(); } catch (e) { toast(errText(e), 'error'); }
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="glass-panel p-6">
        <h3 className="section-title">Accounting ledger</h3>
        <p style={{ margin: '0 0 0.75rem' }}>
          Status: <strong>{on ? 'On' : 'Not enabled'}</strong>
          {on && <span className="field-hint"> · {status.accounts} accounts · {status.entries} entries{status.enabledAt ? ` · since ${status.enabledAt.slice(0, 10)}` : ''}</span>}
        </p>
        <p className="field-hint">Turning it on posts every invoice, purchase, payment and expense into balanced ledger entries and keeps them in step as documents change. It unlocks the chart of accounts, trial balance and journals.</p>
        <Can do="accounting:manage">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0.75rem 0' }}>
            <button className="btn btn-secondary" onClick={() => run(true)} disabled={busy}>Step 1 · Run check (no changes)</button>
            <button className="btn btn-primary" onClick={() => enable(false)} disabled={busy || !check || check.problems.length > 0 || check.diffs.length > 0}>
              {on ? 'Post history again' : 'Step 2 · Enable ledger and post history'}
            </button>
          </div>
        </Can>
        {check && (
          <div>
            <p>
              {check.documents} documents · {check.vouchers} vouchers · {check.problems.length} problems · trial balance {check.trialBalance?.balanced ? <span style={{ color: '#059669' }}>✔ balanced</span> : <span style={{ color: '#dc2626' }}>✖ not balanced</span>} · party balances {check.diffs.length === 0 ? <span style={{ color: '#059669' }}>✔ match documents</span> : <span style={{ color: '#dc2626' }}>✖ {check.diffs.length} differ</span>}
            </p>
            {check.problems.length > 0 && <ul>{check.problems.map((p) => <li key={p.id} style={{ color: '#dc2626' }}>{p.kind} {p.label}: {p.message}</li>)}</ul>}
            {check.diffs.length > 0 && (
              <>
                <table className="data-table" style={{ minWidth: 0 }}>
                  <thead><tr><th>Party</th><th style={{ textAlign: 'right' }}>Ledger</th><th style={{ textAlign: 'right' }}>Documents</th></tr></thead>
                  <tbody>{check.diffs.map((d) => <tr key={d.name}><td>{d.name}</td><td style={{ textAlign: 'right' }}>{money(d.ledger)}</td><td style={{ textAlign: 'right' }}>{money(d.documents)}</td></tr>)}</tbody>
                </table>
                <Can do="accounting:manage"><button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => enable(true)}>Turn on anyway…</button></Can>
              </>
            )}
          </div>
        )}
      </div>

      <div className="glass-panel p-6">
        <h3 className="section-title"><Lock size={14} /> Period lock</h3>
        {lock && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label>Freeze transactions on or before{' '}
              <input type="date" className="form-input" style={{ width: 170, display: 'inline-block' }} value={lock.lockBefore || ''} onChange={(e) => setLock({ ...lock, lockBefore: e.target.value || null })} />
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={!!lock.allowEditAfterGstFiled} onChange={(e) => setLock({ ...lock, allowEditAfterGstFiled: e.target.checked })} /> A filed GST month does not lock the books
            </label>
            <Can do="accounting:manage"><button className="btn btn-primary" onClick={() => saveLockBody({})}>Save</button></Can>
          </div>
        )}
        <p className="field-hint">Writes dated in a locked period are refused in every screen. The owner can still save into one, with a reason, which is recorded.</p>
      </div>

      <div className="glass-panel p-6">
        <h3 className="section-title">Financial years</h3>
        <table className="data-table" style={{ minWidth: 0 }}>
          <thead><tr><th>Year</th><th>From</th><th>To</th><th>Status</th><th /></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.id}>
                <td>{y.label}</td><td>{y.startDate}</td><td>{y.endDate}</td>
                <td>{y.status === 'closed' ? <StatusChip tone="neutral">Closed 🔒</StatusChip> : <StatusChip tone="success">Open</StatusChip>}</td>
                <td><Can do="accounting:manage"><button className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} onClick={() => toggleYear(y)}>{y.status === 'open' ? 'Close year' : 'Reopen'}</button></Can></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- P4-S1 chart of accounts -------------------------------------------------------------------------------------------

function ChartOfAccounts({ businessId }) {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [showSystem, setShowSystem] = useState(true);
  const [form, setForm] = useState(null);
  const load = useCallback(() => listAccounts(businessId).then(setRows).catch((e) => toast(errText(e), 'error')), [businessId]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows || []).filter((a) => (showSystem || !a.system) && (!kind || a.kind === kind) && (!search || `${a.code} ${a.name}`.toLowerCase().includes(search.toLowerCase()))), [rows, search, kind, showSystem]);
  const save = async () => {
    const body = { businessId, name: form.name.trim(), group: form.group, ...(form.group === 'Duties & taxes' ? { kind: form.kind } : {}), ...(form.code ? { code: form.code } : {}), ...(Number(form.opening) > 0 ? { opening: { amount: Number(form.opening), side: form.side, date: form.date } } : {}) };
    try { await createAccount(body); toast('Account added', 'success'); setForm(null); load(); } catch (e) { toast(errText(e), 'error'); }
  };
  const remove = async (a) => {
    if (!(await confirmAction({ title: `Delete ${a.name}?`, message: 'An account with entries can not be deleted; switch it off instead.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await deleteAccount(a.id); load(); } catch (e) { toast(errText(e), 'error'); }
  };
  const toggle = async (a) => { try { await updateAccount(a.id, { active: !a.active }); load(); } catch (e) { toast(errText(e), 'error'); } };

  if (!rows) return <LoadingState />;
  return (
    <>
      <div className="glass-panel p-4 mb-6" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="search-input" style={{ flex: 1, minWidth: 180 }} placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{['asset', 'liability', 'income', 'expense', 'equity'].map((k) => <option key={k} value={k}>{k}</option>)}</select>
        <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} /> Show system accounts</label>
        <Can do="accounting:manage"><button className="btn btn-primary" onClick={() => setForm({ name: '', group: 'Indirect expense', kind: 'asset', code: '', opening: '', side: 'Dr', date: localToday() })}><Plus size={16} /> Add Account</button></Can>
      </div>
      <div className="glass-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Code</th><th>Name</th><th>Group</th><th>Kind</th><th style={{ textAlign: 'right' }}>Balance</th><th /></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                  <td>{a.code}</td><td>{a.name}{a.system && <Lock size={11} style={{ marginLeft: 6 }} aria-label="System account" />}</td><td>{a.group}</td><td>{a.kind}</td>
                  <td style={{ textAlign: 'right' }}>{balanceText(a, money)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Can do="accounting:manage">
                      {!a.system && <button className="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => toggle(a)}>{a.active ? 'Switch off' : 'Switch on'}</button>}
                      {!a.system && <button className="icon-btn icon-btn-red" aria-label={`Delete ${a.name}`} onClick={() => remove(a)}><Trash2 size={14} /></button>}
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }} role="dialog" aria-label="Add account">
            <h3 className="section-title">Add account</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group"><label className="form-label">Name *</label><input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Code</label><input className="form-input" placeholder="Next free" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} /></div>
              <div className="form-group"><label className="form-label">Group *</label><select className="form-input" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}>{GROUPS.map((g) => <option key={g}>{g}</option>)}</select></div>
              {form.group === 'Duties & taxes' && <div className="form-group"><label className="form-label">Kind *</label><select className="form-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="asset">Asset (credit you claim)</option><option value="liability">Liability (tax you owe)</option></select></div>}
              <div className="form-group"><label className="form-label">Opening balance</label><div style={{ display: 'flex', gap: 6 }}><input type="number" min="0" className="form-input" value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} /><select className="form-input" style={{ width: 80 }} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} aria-label="Dr or Cr"><option>Dr</option><option>Cr</option></select></div></div>
              <div className="form-group"><label className="form-label">As of</label><input type="date" className="form-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name.trim()}>Save</button></div>
          </div>
        </div>
      )}
    </>
  );
}

// ---- P4-S7 account ledger ----------------------------------------------------------------------------------------------

function AccountLedger({ businessId }) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [fy, setFy] = useState('');
  const [data, setData] = useState(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { listAccounts(businessId).then((a) => { setAccounts(a); setAccountId((cur) => cur || a.find((x) => x.code === '1300')?.id || a[0]?.id || ''); }); }, [businessId]);
  useEffect(() => {
    if (!accountId) return;
    const range = fy ? fyRange(fy) : {};
    accountLedger(accountId, { ...range, all: showAll ? '1' : '0' }).then(setData).catch((e) => toast(errText(e), 'error'));
  }, [accountId, fy, showAll]);
  if (!accounts) return <LoadingState />;
  return (
    <>
      <div className="glass-panel p-4 mb-6" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="filter-select" style={{ minWidth: 220 }} value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
        <input className="filter-select" style={{ width: 110 }} placeholder="FY e.g. 2026-27" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year" />
        <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show reversals</label>
      </div>
      {data && (
        <div className="glass-panel">
          <div style={{ padding: '0.75rem 1rem' }}>
            <strong>{data.account.code} · {data.account.name}</strong>{' '}
            <span className="field-hint">Opening {drCrText(data.opening, money)} · Closing <strong>{money(data.closing)} {data.closingSide}</strong></span>
          </div>
          {data.entries.length === 0 ? <EmptyState title="No entries" hint="Nothing has been posted to this account in this range." /> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Narration</th><th>Ref</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id} style={{ opacity: e.reversalOf ? 0.55 : 1 }}>
                      <td>{e.txnDate}</td><td>{e.narration || '—'}</td>
                      <td>{refLink(e.refType) ? <button className="btn btn-secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.72rem' }} onClick={() => navigate(refLink(e.refType))}>{e.refType}</button> : e.refType}</td>
                      <td style={{ textAlign: 'right' }}>{e.debit ? money(e.debit) : ''}</td><td style={{ textAlign: 'right' }}>{e.credit ? money(e.credit) : ''}</td>
                      <td style={{ textAlign: 'right' }}>{drCrText(e.running, money)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{money(data.debit)}</strong></td><td style={{ textAlign: 'right' }}><strong>{money(data.credit)}</strong></td><td /></tr></tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---- trial balance ------------------------------------------------------------------------------------------------------

function TrialBalance({ businessId }) {
  const [asOf, setAsOf] = useState('');
  const [tb, setTb] = useState(null);
  useEffect(() => { trialBalance(businessId, asOf).then(setTb).catch((e) => toast(errText(e), 'error')); }, [businessId, asOf]);
  if (!tb) return <LoadingState />;
  return (
    <div className="glass-panel">
      <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>As of <input type="date" className="form-input" style={{ width: 170, display: 'inline-block' }} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        {tb.balanced ? <StatusChip tone="success">✔ Balanced</StatusChip> : <StatusChip tone="danger">✖ Not balanced</StatusChip>}
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Account</th><th>Kind</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th></tr></thead>
          <tbody>{tb.lines.map((l) => <tr key={l.code}><td>{l.code}</td><td>{l.name}</td><td>{l.kind}</td><td style={{ textAlign: 'right' }}>{l.debit ? money(l.debit) : ''}</td><td style={{ textAlign: 'right' }}>{l.credit ? money(l.credit) : ''}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{money(tb.debit)}</strong></td><td style={{ textAlign: 'right' }}><strong>{money(tb.credit)}</strong></td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// ---- journal vouchers ----------------------------------------------------------------------------------------------------

const blankRow = () => ({ accountId: '', debit: '', credit: '' });

function Journal({ businessId }) {
  const [list, setList] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(null);
  const load = useCallback(() => { listJournals(businessId).then(setList); listAccounts(businessId).then((a) => setAccounts(a.filter((x) => x.active))); }, [businessId]);
  useEffect(() => { load(); }, [load]);

  const st = form ? journalState(form.rows) : null;
  const setRow = (i, patch) => setForm({ ...form, rows: form.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = async () => {
    const body = { businessId, date: form.date, narration: form.narration, rows: st.rows.map((r) => ({ accountId: r.accountId, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 })) };
    try { form.id ? await updateJournal(form.id, body) : await createJournal(body); toast('Journal saved', 'success'); setForm(null); load(); } catch (e) { toast(errText(e), 'error'); }
  };
  const remove = async (j) => {
    if (!(await confirmAction({ title: `Delete ${j.number}?`, message: 'Its postings are reversed. The history stays in the ledger.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await deleteJournal(j.id); load(); } catch (e) { toast(errText(e), 'error'); }
  };
  if (!list) return <LoadingState />;
  return (
    <>
      <div style={{ marginBottom: '0.75rem' }}>
        <Can do="journal:write"><button className="btn btn-primary" onClick={() => setForm({ date: localToday(), narration: '', rows: [blankRow(), blankRow()] })}><Plus size={16} /> New Journal Voucher</button></Can>
      </div>
      <div className="glass-panel">
        {list.length === 0 ? <EmptyState title="No journal vouchers" hint="Use a journal for entries that are not a sale, purchase, payment or expense, like depreciation." /> : (
          <table className="data-table">
            <thead><tr><th>No</th><th>Date</th><th>Narration</th><th>Entries</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
            <tbody>
              {list.map((j) => (
                <tr key={j.id}>
                  <td>{j.number}</td><td>{j.date}</td><td>{j.narration || '—'}</td>
                  <td>{j.rows.map((r) => `${r.name} ${r.debit ? 'Dr' : 'Cr'}`).join(', ')}</td>
                  <td style={{ textAlign: 'right' }}>{money(j.total)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Can do="journal:write">
                      <button className="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setForm({ id: j.id, number: j.number, date: j.date, narration: j.narration, rows: j.rows.map((r) => ({ accountId: r.accountId, debit: r.debit || '', credit: r.credit || '' })) })}>Edit</button>
                      <button className="icon-btn icon-btn-red" aria-label={`Delete ${j.number}`} onClick={() => remove(j)}><Trash2 size={14} /></button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }} role="dialog" aria-label="Journal voucher">
            <h3 className="section-title">{form.id ? `Journal ${form.number}` : 'Journal Voucher'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Narration</label><input className="form-input" value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} placeholder="e.g. Depreciation on laptop" /></div>
            </div>
            <table className="data-table" style={{ minWidth: 0, marginTop: '0.75rem' }}>
              <thead><tr><th>Account</th><th style={{ width: 130 }}>Debit</th><th style={{ width: 130 }}>Credit</th><th style={{ width: 36 }} /></tr></thead>
              <tbody>
                {form.rows.map((r, i) => (
                  <tr key={i}>
                    <td><select className="form-input" value={r.accountId} onChange={(e) => setRow(i, { accountId: e.target.value })} aria-label={`Account, row ${i + 1}`}><option value="">Select account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></td>
                    <td><input type="number" min="0" step="any" className="form-input" value={r.debit} onChange={(e) => setRow(i, { debit: e.target.value, credit: e.target.value ? '' : r.credit })} aria-label={`Debit, row ${i + 1}`} /></td>
                    <td><input type="number" min="0" step="any" className="form-input" value={r.credit} onChange={(e) => setRow(i, { credit: e.target.value, debit: e.target.value ? '' : r.debit })} aria-label={`Credit, row ${i + 1}`} /></td>
                    <td>{form.rows.length > 2 && <button className="icon-btn icon-btn-red" aria-label={`Remove row ${i + 1}`} onClick={() => setForm({ ...form, rows: form.rows.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={() => setForm({ ...form, rows: [...form.rows, blankRow()] })}><Plus size={14} /> Add row</button>
              <span style={{ color: st.balanced ? '#059669' : '#d97706', fontWeight: 600 }}>
                Total {money(st.debit)} = {money(st.credit)} {st.balanced ? '✔ Balanced' : st.debit || st.credit ? `✖ differ by ${money(Math.abs(st.diff))}` : ''}
              </span>
            </div>
            {st.bothSides && <p className="ui-error" role="alert">A row has either a debit or a credit, not both.</p>}
            <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!st.ok}>Save</button></div>
          </div>
        </div>
      )}
    </>
  );
}
