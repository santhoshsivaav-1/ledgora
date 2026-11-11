import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Landmark, Plus, Trash2, Upload } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader';
import Can from '../../components/ui/Can';
import { TabStrip } from '../../components/ui/Tabs';
import { StatusChip } from '../../components/ui/Display';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { formatCurrency, localToday } from '../../utils';
import { apiClient } from '../../lib/apiClient';
import { listBusinesses } from '../../lib/data/accounting';
import {
  CHEQUE_STATUS_TONE, RECON_QUICK, SECTION_138_TEXT, bankStatement, cashStatement, cashbankRefLink, cashbankSettings,
  cashbankSummary, chequeAction, chequeButtons, createBankAccount, createCashEntry, createCheque, createLoan,
  createTransfer, dayEndCount, deleteBankAccount, deleteLoan, deleteLoanPayment, deleteTransfer, getLoan, ifscBank,
  ignoreStatementRows, listBankAccounts, listCheques, listLoans, listTransfers, loanFormEmi, loanStatement,
  matchStatementRows, moneyAccounts, payLoan, refTypeLabel, saveCashbankSettings, saveReconciliation, statementClosing,
  statementRowsFromFile, updateBankAccount, updateCheque, updateTransfer, lookupIfsc, CASH_BANK_REPORTS,
  creditLoanInterest, deleteLoanInterestCredit, fyEndOf,
} from '../../lib/data/cashbank';

// Vyapar parity Phase 5: Cash & Bank. Bank accounts with their statements (P5-S1), Cash in Hand with adjustments and
// the day-end count (P5-S2), transfers (P5-S3), the cheque register (P5-S4), loan accounts (P5-S5) and bank
// reconciliation (P5-S6). Behind the per-business `cashbank` flag, which needs the accounting ledger on. Every figure is
// read from the ledger, so these screens and the Trial Balance always agree.

const TABS = [
  { id: 'accounts', label: 'Bank accounts' },
  { id: 'cash', label: 'Cash in hand' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'cheques', label: 'Cheques' },
  { id: 'loans', label: 'Loan accounts' },
  { id: 'reconcile', label: 'Reconcile' },
];
const money = (n) => formatCurrency(n);
const errText = (e) => e?.body?.error?.message || e?.message || 'Something went wrong';
const small = { padding: '0.15rem 0.5rem', fontSize: '0.75rem' };
const right = { textAlign: 'right' };

function Dialog({ title, onClose, children, width = 560 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: width }} role="dialog" aria-label={title}>
        <h3 className="section-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}
const Field = ({ label, children }) => <div className="form-group"><label className="form-label">{label}</label>{children}</div>;
/** Cancel / Save. Save runs once at a time, so a double click never records a payment twice. */
function Actions({ onCancel, onSave, disabled, label = 'Save' }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSave(); } finally { setBusy(false); }
  };
  return (
    <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button><button className="btn btn-primary" onClick={run} disabled={disabled || busy}>{busy ? 'Saving…' : label}</button></div>
  );
}

/** §269SS / §269T: the API refuses ₹20,000 or more in cash until the owner types an acknowledgement. */
const cashLimitOf = (e) => (e?.body?.error?.code === 'cash_limit' ? e.body.error.message : null);
function CashAck({ message, value, onChange }) {
  if (!message) return null;
  return (
    <div className="glass-panel p-4" role="alert" style={{ marginTop: 8, borderColor: '#d97706' }}>
      <p style={{ margin: '0 0 6px', color: '#b45309' }}>{message}</p>
      <input className="form-input" placeholder="Type why (recorded in the audit log)" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function CashBankPage({ initialTab = 'accounts' }) {
  const params = useParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.id === params.tab) ? params.tab : initialTab;
  const [businesses, setBusinesses] = useState(null);
  const [businessId, setBusinessId] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [bump, setBump] = useState(0);
  const reload = useCallback(() => setBump((b) => b + 1), []);

  useEffect(() => {
    listBusinesses().then((b) => { setBusinesses(b); setBusinessId((cur) => cur || b[0]?.id || ''); }).catch(setError);
  }, []);
  useEffect(() => {
    if (businessId) cashbankSettings(businessId).then(setStatus).catch(setError);
  }, [businessId, bump]);

  if (error) return <ErrorState message={errText(error)} onRetry={() => window.location.reload()} />;
  if (!businesses || (businessId && !status)) return <LoadingState label="Opening Cash & Bank…" />;
  if (!businesses.length) return <EmptyState title="No business yet" hint="Create a business first." />;

  const toggle = async (patch) => {
    try { setStatus(await saveCashbankSettings({ businessId, enabled: status.enabled, ...patch })); toast('Saved', 'success'); reload(); } catch (e) { toast(errText(e), 'error'); }
  };

  return (
    <div className="dashboard-container">
      <PageHeader
        icon={<Landmark size={22} />}
        title="Cash & Bank"
        subtitle="Bank accounts, cash in hand, transfers, cheques and loans, straight from the books"
        actions={
          <>
            {businesses.length > 1 && (
              <select className="filter-select" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setStatus(null); }} aria-label="Business">
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            {status.enabled && (
              <select className="filter-select" value="" onChange={(e) => e.target.value && navigate(`/reports/${e.target.value}`)} aria-label="Reports">
                <option value="">Reports…</option>
                {CASH_BANK_REPORTS.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            )}
            <StatusChip tone={status.enabled ? 'success' : 'neutral'}>{status.enabled ? 'On' : 'Off'}</StatusChip>
          </>
        }
      />
      {!status.ledger && (
        <EmptyState title="Cash & Bank needs the accounting ledger" hint="Balances come from the ledger. Turn it on in Accounting › Ledger setup first." action={<button className="btn btn-primary" onClick={() => navigate('/accounting/setup')}>Go to Ledger setup</button>} />
      )}
      {status.ledger && !status.enabled && (
        <div className="glass-panel p-6">
          <h3 className="section-title">Turn on Cash & Bank</h3>
          <p className="field-hint">Each bank account gets its own ledger account and opening balance. Then you can record transfers, cash adjustments, cheques and loans, and reconcile statements. Nothing you have already recorded changes.</p>
          <Can do="accounting:manage" fallback={<p className="field-hint">Ask the owner or an admin to turn it on.</p>}>
            <button className="btn btn-primary" onClick={() => toggle({ enabled: true })}>Turn on Cash & Bank</button>
          </Can>
        </div>
      )}
      {status.enabled && (
        <>
          <TabStrip tabs={TABS} value={tab} onChange={(id) => navigate(`/cash-bank/${id}`)} ariaLabel="Cash & Bank" />
          <div style={{ marginTop: '1rem' }}>
            {tab === 'accounts' && <BankAccounts businessId={businessId} />}
            {tab === 'cash' && <CashInHand businessId={businessId} />}
            {tab === 'transfers' && <Transfers businessId={businessId} />}
            {tab === 'cheques' && <Cheques businessId={businessId} />}
            {tab === 'loans' && <Loans businessId={businessId} />}
            {tab === 'reconcile' && <Reconcile businessId={businessId} />}
          </div>
          <Can do="accounting:manage">
            <p className="field-hint" style={{ marginTop: '1.5rem' }}>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={status.allowOverdraft} onChange={(e) => toggle({ allowOverdraft: e.target.checked })} /> Banks may go below zero on a transfer (OD and CC accounts always may)
              </label>
              {' · '}
              <button className="btn btn-secondary" style={small} onClick={async () => { if (await confirmAction({ title: 'Turn off Cash & Bank?', message: 'The screens go away; everything recorded stays in the books.', confirmLabel: 'Turn off', tone: 'warning' })) toggle({ enabled: false }); }}>Turn off</button>
            </p>
          </Can>
        </>
      )}
    </div>
  );
}

// ---- statements (shared by bank accounts and cash) ----------------------------------------------------------------------

function Statement({ load, deps, header, actions }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [range, setRange] = useState({ from: '', to: '' });
  useEffect(() => { load(range).then(setData).catch((e) => toast(errText(e), 'error')); }, [range, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <LoadingState />;
  return (
    <div className="glass-panel">
      <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>{header} <span className="field-hint">Balance <strong>{money(data.account.balance)}</strong></span></div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" className="form-input" style={{ width: 150 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" />
          <input type="date" className="form-input" style={{ width: 150 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" />
          {actions}
        </div>
      </div>
      {data.rows.length === 0 ? <EmptyState title="No transactions" hint="Nothing has gone in or out in this range." /> : (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Description</th><th>Party</th><th>Type</th><th style={right}>{data.account.kind === 'cash' ? 'Cash in' : 'Deposit'}</th><th style={right}>{data.account.kind === 'cash' ? 'Cash out' : 'Withdrawal'}</th><th style={right}>Running balance</th>{data.account.kind === 'bank' && <th>Rec</th>}</tr></thead>
            <tbody>
              {data.opening !== 0 && <tr><td colSpan={6} className="field-hint">Opening balance</td><td style={right}>{money(data.opening)}</td>{data.account.kind === 'bank' && <td />}</tr>}
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.txnDate}</td><td>{r.narration || '—'}</td><td>{r.partyName || ''}</td>
                  <td>{cashbankRefLink(r.refType) ? <button className="btn btn-secondary" style={small} onClick={() => navigate(cashbankRefLink(r.refType))}>{refTypeLabel(r.refType)}</button> : refTypeLabel(r.refType)}</td>
                  <td style={right}>{r.deposit ? money(r.deposit) : ''}</td><td style={right}>{r.withdrawal ? money(r.withdrawal) : ''}</td>
                  <td style={right}>{money(r.running)}</td>
                  {data.account.kind === 'bank' && <td>{r.reconciled ? '☑' : '☐'}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}><strong>Total</strong></td><td style={right}><strong>{money(data.deposits)}</strong></td><td style={right}><strong>{money(data.withdrawals)}</strong></td><td style={right}><strong>{money(data.closing)}</strong></td>{data.account.kind === 'bank' && <td />}</tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** Deposit, withdraw or adjust a cash or bank account (P5-S1 / P5-S2). */
function EntryModal({ businessId, account, kind, onClose, onSaved }) {
  // On a bank, Deposit and Withdraw mostly mean cash taken to or from the counter: a contra entry with Cash in Hand
  // (a transfer). Owner's capital, drawings, bank charges and other accounts are the other choices.
  const [f, setF] = useState({ direction: kind === 'withdraw' ? 'reduce' : 'increase', amount: '', date: localToday(), remarks: '', countAsIncome: false, category: account.kind === 'bank' ? 'cash' : kind === 'deposit' ? 'capital' : 'drawings', counterAccountId: '' });
  const [others, setOthers] = useState([]);
  const [cashId, setCashId] = useState('');
  useEffect(() => {
    if (kind === 'withdraw') apiClient.get(`/v1/accounts?businessId=${businessId}`).then((r) => setOthers(r.data.filter((a) => a.active && a.code !== '1000' && a.group !== 'Bank'))).catch(() => {});
    moneyAccounts(businessId).then((m) => setCashId(m.find((x) => x.kind === 'cash')?.accountId || '')).catch(() => {});
  }, [businessId, kind]);
  const save = async () => {
    try {
      if (f.category === 'cash' && kind !== 'adjust') {
        const [from, to] = kind === 'deposit' ? [cashId, account.accountId] : [account.accountId, cashId];
        await createTransfer({ businessId, fromAccountId: from, toAccountId: to, amount: Number(f.amount), date: f.date, notes: f.remarks, reference: kind === 'deposit' ? 'Cash deposit' : 'Cash withdrawal' });
      } else {
        await createCashEntry({ businessId, accountId: account.accountId, kind, direction: f.direction, amount: Number(f.amount), date: f.date, remarks: f.remarks, countAsIncome: f.countAsIncome, ...(kind === 'withdraw' ? { category: f.category, ...(f.category === 'other' ? { counterAccountId: f.counterAccountId } : {}) } : {}) });
      }
      toast('Saved', 'success'); onSaved();
    } catch (e) { toast(errText(e), 'error'); }
  };
  const title = { adjust: `Adjust ${account.name}`, deposit: `Deposit into ${account.name}`, withdraw: `Withdraw from ${account.name}` }[kind];
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        {kind === 'adjust' && (
          <Field label="Adjustment">
            <div style={{ display: 'flex', gap: 12 }}>
              <label><input type="radio" checked={f.direction === 'increase'} onChange={() => setF({ ...f, direction: 'increase' })} /> Add money</label>
              <label><input type="radio" checked={f.direction === 'reduce'} onChange={() => setF({ ...f, direction: 'reduce' })} /> Reduce money</label>
            </div>
          </Field>
        )}
        <Field label="Amount *"><input type="number" min="0" step="any" className="form-input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date"><input type="date" className="form-input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {kind === 'deposit' && (
          <Field label="Money from">
            <select className="form-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {account.kind === 'bank' && <option value="cash">Cash in Hand (cash deposited)</option>}
              <option value="capital">Owner's capital (owner put money in)</option>
            </select>
          </Field>
        )}
        {kind === 'withdraw' && (
          <Field label="Money went to">
            <select className="form-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {account.kind === 'bank' && <option value="cash">Cash in Hand (cash withdrawn)</option>}
              <option value="drawings">Owner drawing</option><option value="bank_charges">Bank charges</option><option value="other">Other (choose account)</option>
            </select>
          </Field>
        )}
        {kind === 'withdraw' && f.category === 'other' && (
          <Field label="Account *"><select className="form-input" value={f.counterAccountId} onChange={(e) => setF({ ...f, counterAccountId: e.target.value })}><option value="">Select account</option>{others.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
        )}
        <Field label="Remarks"><input className="form-input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        {kind === 'adjust' && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.countAsIncome} onChange={(e) => setF({ ...f, countAsIncome: e.target.checked })} /> Count as income / loss (not an opening correction)</label>}
      </div>
      {kind === 'deposit' && f.category === 'capital' && <p className="field-hint">Posted to Owner's Capital. Money from a customer is a Payment In.</p>}
      {f.category === 'cash' && <p className="field-hint">A contra entry: Cash in Hand and this bank move by the same amount.</p>}
      <Actions onCancel={onClose} onSave={save} disabled={!(Number(f.amount) > 0) || (kind === 'withdraw' && f.category === 'other' && !f.counterAccountId)} />
    </Dialog>
  );
}

// ---- P5-S1 bank accounts -------------------------------------------------------------------------------------------------

const blankBank = () => ({ label: '', accountType: 'current', bankName: '', accountHolderName: '', accountNumber: '', ifsc: '', branch: '', swift: '', upiId: '', openingBalance: '', openingDate: localToday(), printOnInvoice: true, isDefault: false, isActive: true });

function BankForm({ businessId, initial, onClose, onSaved }) {
  const [f, setF] = useState(initial ?? blankBank());
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const lookedUp = ifscBank(f.ifsc);
  const [ifscInfo, setIfscInfo] = useState(null);
  const lookup = async () => {
    try {
      const d = await lookupIfsc(f.ifsc);
      setIfscInfo(d);
      set({ bankName: f.bankName || d.bank, branch: d.branch || f.branch });
      if (d.source === 'bundled') toast('Branch lookup is offline: only the bank name was filled', 'warning');
    } catch (e) { toast(e?.status === 404 ? 'No bank branch has this IFSC' : errText(e), 'error'); }
  };
  const save = async () => {
    const body = { label: f.label.trim(), accountType: f.accountType, bankName: f.bankName || lookedUp, accountHolderName: f.accountHolderName, accountNumber: f.accountNumber.replace(/\s/g, ''), ifsc: f.ifsc.trim().toUpperCase(), branch: (f.branch || '').trim(), swift: f.swift, upiId: f.upiId.trim(), openingBalance: Number(f.openingBalance) || 0, openingDate: f.openingDate, printOnInvoice: f.printOnInvoice, isDefault: f.isDefault, isActive: f.isActive };
    try { initial?.id ? await updateBankAccount(initial.id, body) : await createBankAccount({ businessId, ...body }); toast('Bank account saved', 'success'); onSaved(); } catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <Dialog title={initial?.id ? `Edit ${initial.label}` : 'Add Bank Account'} onClose={onClose} width={640}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Account display name *"><input className="form-input" value={f.label} onChange={(e) => set({ label: e.target.value })} placeholder="HDFC Current" /></Field>
        <Field label="Type"><select className="form-input" value={f.accountType} onChange={(e) => set({ accountType: e.target.value })}><option value="current">Current</option><option value="savings">Savings</option><option value="od">Overdraft (OD)</option><option value="cc">Cash credit (CC)</option></select></Field>
        <Field label="Bank name"><input className="form-input" value={f.bankName} placeholder={lookedUp} onChange={(e) => set({ bankName: e.target.value })} /></Field>
        <Field label="Account holder"><input className="form-input" value={f.accountHolderName} onChange={(e) => set({ accountHolderName: e.target.value })} /></Field>
        <Field label="Account number"><input className="form-input" inputMode="numeric" value={f.accountNumber} onChange={(e) => set({ accountNumber: e.target.value.replace(/[^\d\s]/g, '') })} /></Field>
        <Field label={`IFSC${lookedUp ? ` · ${lookedUp}` : ''}`}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="form-input" value={f.ifsc} onChange={(e) => { set({ ifsc: e.target.value.toUpperCase() }); setIfscInfo(null); }} placeholder="HDFC0000123" />
            <button type="button" className="btn btn-secondary" style={small} disabled={!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc.trim().toUpperCase())} onClick={lookup}>Find branch</button>
          </div>
          {ifscInfo?.address && <span className="field-hint">{ifscInfo.address}{ifscInfo.micr ? ` · MICR ${ifscInfo.micr}` : ''}</span>}
        </Field>
        <Field label="Branch"><input className="form-input" value={f.branch || ''} onChange={(e) => set({ branch: e.target.value })} /></Field>
        <Field label="SWIFT"><input className="form-input" value={f.swift} onChange={(e) => set({ swift: e.target.value })} /></Field>
        <Field label="UPI ID"><input className="form-input" value={f.upiId} onChange={(e) => set({ upiId: e.target.value })} placeholder="shop@hdfc" /></Field>
        <Field label="Opening balance (negative = overdrawn)"><input type="number" step="any" className="form-input" value={f.openingBalance} onChange={(e) => set({ openingBalance: e.target.value })} /></Field>
        <Field label="As of"><input type="date" className="form-input" value={f.openingDate || ''} onChange={(e) => set({ openingDate: e.target.value })} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
        <label><input type="checkbox" checked={f.printOnInvoice} onChange={(e) => set({ printOnInvoice: e.target.checked })} /> Print bank details on invoices</label>
        <label><input type="checkbox" checked={f.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} /> Default for invoices</label>
        <label><input type="checkbox" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active</label>
      </div>
      <Actions onCancel={onClose} onSave={save} disabled={!f.label.trim()} />
    </Dialog>
  );
}

function BankAccounts({ businessId }) {
  const [rows, setRows] = useState(null);
  const [cash, setCash] = useState(null);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(() => {
    listBankAccounts(businessId, showAll).then(setRows).catch((e) => toast(errText(e), 'error'));
    moneyAccounts(businessId).then((m) => setCash(m.find((x) => x.kind === 'cash'))).catch(() => {});
  }, [businessId, showAll]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <LoadingState />;
  if (open) return <AccountDetail businessId={businessId} bank={open} onBack={() => { setOpen(null); load(); }} />;
  const total = Math.round((rows.filter((b) => b.isActive).reduce((s, b) => s + b.balance, 0) + (cash?.balance ?? 0)) * 100) / 100;
  const remove = async (b) => {
    if (!(await confirmAction({ title: `Delete ${b.label}?`, message: 'An account with entries can not be deleted; switch it off instead.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await deleteBankAccount(b.id); load(); } catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <Can do="cashbank:write"><button className="btn btn-primary" onClick={() => setForm({})}><Plus size={16} /> Add Bank Account</button></Can>
        <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show switched-off accounts</label>
        <span style={{ marginLeft: 'auto' }}>Total cash + bank <strong>{money(total)}</strong></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '0.75rem' }}>
        {rows.map((b) => (
          <div key={b.id} className="glass-panel p-4" style={{ opacity: b.isActive ? 1 : 0.55, cursor: 'pointer' }} onClick={() => setOpen(b)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(b)}>
            <strong>{b.label}</strong>
            <div className="field-hint">{[b.bankName, b.accountNumberMasked].filter(Boolean).join(' ')} · {b.code}</div>
            <div style={{ fontSize: '1.3rem', margin: '0.4rem 0', color: b.balance < 0 ? '#dc2626' : undefined }}>{money(b.balance)}</div>
            {b.isDefault && <StatusChip tone="info">Default for invoices</StatusChip>}
            {b.balance < 0 && <StatusChip tone="danger">Overdrawn</StatusChip>}
            <Can do="cashbank:write">
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-secondary" style={small} onClick={() => setForm({ ...b, openingBalance: String(b.openingBalance) })}>Edit</button>
                <button className="icon-btn icon-btn-red" aria-label={`Delete ${b.label}`} onClick={() => remove(b)}><Trash2 size={14} /></button>
              </div>
            </Can>
          </div>
        ))}
        {cash && (
          <div className="glass-panel p-4">
            <strong>Cash in Hand</strong>
            <div className="field-hint">System account · {cash.code}</div>
            <div style={{ fontSize: '1.3rem', margin: '0.4rem 0' }}>{money(cash.balance)}</div>
          </div>
        )}
      </div>
      {rows.length === 0 && <EmptyState title="No bank accounts" hint="Add your bank accounts with their opening balance to see real balances." />}
      {form && <BankForm businessId={businessId} initial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

function AccountDetail({ businessId, bank, onBack }) {
  const [modal, setModal] = useState(null);
  const [bump, setBump] = useState(0);
  const account = { accountId: bank.accountId, name: bank.label, kind: 'bank' };
  const done = () => { setModal(null); setBump((b) => b + 1); };
  return (
    <>
      <button className="btn btn-secondary" style={{ marginBottom: 8 }} onClick={onBack}><ArrowLeft size={14} /> Bank accounts</button>
      <Statement
        load={(r) => bankStatement(bank.id, r)}
        deps={[bank.id, bump]}
        header={<strong>{bank.label} {bank.accountNumberMasked}</strong>}
        actions={
          <Can do="cashbank:write">
            <button className="btn btn-secondary" style={small} onClick={() => setModal('deposit')}>Deposit</button>
            <button className="btn btn-secondary" style={small} onClick={() => setModal('withdraw')}>Withdraw</button>
            <button className="btn btn-secondary" style={small} onClick={() => setModal('transfer')}>Transfer</button>
            <button className="btn btn-secondary" style={small} onClick={() => setModal('adjust')}>Adjust</button>
          </Can>
        }
      />
      {modal === 'transfer' && <TransferModal businessId={businessId} preset={{ fromAccountId: bank.accountId }} onClose={() => setModal(null)} onSaved={done} />}
      {modal && modal !== 'transfer' && <EntryModal businessId={businessId} account={account} kind={modal} onClose={() => setModal(null)} onSaved={done} />}
    </>
  );
}

// ---- P5-S2 cash in hand --------------------------------------------------------------------------------------------------

function CashInHand({ businessId }) {
  const [modal, setModal] = useState(null);
  const [bump, setBump] = useState(0);
  const [cash, setCash] = useState(null);
  const [watch, setWatch] = useState([]);
  const [outWatch, setOutWatch] = useState([]);
  const [count, setCount] = useState({ counted: '', date: localToday(), remarks: '' });
  useEffect(() => {
    moneyAccounts(businessId).then((m) => setCash(m.find((x) => x.kind === 'cash'))).catch(() => {});
    cashbankSummary(businessId).then((s) => { setWatch(s.cashWatch); setOutWatch(s.cashOutWatch); }).catch(() => {});
  }, [businessId, bump]);
  const done = () => { setModal(null); setBump((b) => b + 1); };
  const saveCount = async () => {
    try {
      const r = await dayEndCount({ businessId, date: count.date, counted: Number(count.counted), remarks: count.remarks });
      toast(r.entry ? `Difference ${money(r.difference)} posted to Cash Over / Short` : 'Count matches the books: nothing posted', r.entry ? 'warning' : 'success');
      done();
    } catch (e) { toast(errText(e), 'error'); }
  };
  if (!cash) return <LoadingState />;
  return (
    <>
      {watch.length + outWatch.length > 0 && (
        <div className="glass-panel p-4 mb-6" role="alert">
          {watch.map((w) => <div key={`in${w.partyId}${w.date}`}><StatusChip tone="warning">§269ST</StatusChip> Cash of {money(w.total)} received from {w.partyName} on {w.date} (limit ₹2,00,000 a day per party)</div>)}
          {outWatch.map((w) => <div key={`out${w.partyId}${w.date}`}><StatusChip tone="warning">§40A(3)</StatusChip> Cash of {money(w.total)} paid to {w.partyName} on {w.date}: an expense paid in cash above ₹10,000 a day is not allowed as a deduction</div>)}
        </div>
      )}
      <Statement
        load={(r) => cashStatement(businessId, r)}
        deps={[businessId, bump]}
        header={<strong>Cash in Hand</strong>}
        actions={
          <Can do="cashbank:write">
            <button className="btn btn-secondary" style={small} onClick={() => setModal('adjust')}>Adjust Cash</button>
            <button className="btn btn-secondary" style={small} onClick={() => setModal('count')}>Day-end count</button>
          </Can>
        }
      />
      {modal === 'adjust' && <EntryModal businessId={businessId} account={cash} kind="adjust" onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'count' && (
        <Dialog title="Day-end count" onClose={() => setModal(null)}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date"><input type="date" className="form-input" value={count.date} onChange={(e) => setCount({ ...count, date: e.target.value })} /></Field>
            <Field label="Counted *"><input type="number" min="0" step="any" className="form-input" value={count.counted} onChange={(e) => setCount({ ...count, counted: e.target.value })} /></Field>
            <Field label="Remarks"><input className="form-input" value={count.remarks} onChange={(e) => setCount({ ...count, remarks: e.target.value })} /></Field>
          </div>
          <p className="field-hint">Books say {money(cash.balance)} today. {count.counted !== '' && `Difference ${money(Number(count.counted) - cash.balance)} (on ${count.date} the books may differ).`}</p>
          <Actions onCancel={() => setModal(null)} onSave={saveCount} disabled={count.counted === ''} />
        </Dialog>
      )}
    </>
  );
}

// ---- P5-S3 transfers -----------------------------------------------------------------------------------------------------

function TransferModal({ businessId, preset = {}, editing, onClose, onSaved }) {
  const [accts, setAccts] = useState([]);
  const [f, setF] = useState(editing ? { ...editing, amount: String(editing.amount), fee: String(editing.fee || '') } : { fromAccountId: '', toAccountId: '', amount: '', fee: '', date: localToday(), reference: '', notes: '', ...preset });
  useEffect(() => { moneyAccounts(businessId).then(setAccts).catch(() => {}); }, [businessId]);
  const bal = (id) => accts.find((a) => a.accountId === id)?.balance;
  const save = async () => {
    const body = { businessId, fromAccountId: f.fromAccountId, toAccountId: f.toAccountId, amount: Number(f.amount), fee: Number(f.fee) || 0, date: f.date, reference: f.reference, notes: f.notes };
    try { editing ? await updateTransfer(editing.id, body) : await createTransfer(body); toast('Transfer saved', 'success'); onSaved(); } catch (e) { toast(errText(e), 'error'); }
  };
  const pick = (key) => (
    <select className="form-input" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}><option value="">Select</option>{accts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select>
  );
  return (
    <Dialog title={editing ? 'Edit transfer' : 'Transfer Money'} onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <Field label={`From *${f.fromAccountId ? ` · ${money(bal(f.fromAccountId) ?? 0)}` : ''}`}>{pick('fromAccountId')}</Field>
        <Field label={`To *${f.toAccountId ? ` · ${money(bal(f.toAccountId) ?? 0)}` : ''}`}>{pick('toAccountId')}</Field>
        <Field label="Amount *"><input type="number" min="0" step="any" className="form-input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date"><input type="date" className="form-input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Bank charges"><input type="number" min="0" step="any" className="form-input" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Field>
        <Field label="Reference"><input className="form-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><input className="form-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      {f.fromAccountId && f.fromAccountId === f.toAccountId && <p className="ui-error" role="alert">From and To must be different accounts.</p>}
      <Actions onCancel={onClose} onSave={save} label="Transfer" disabled={!f.fromAccountId || !f.toAccountId || f.fromAccountId === f.toAccountId || !(Number(f.amount) > 0)} />
    </Dialog>
  );
}

function Transfers({ businessId }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const load = useCallback(() => listTransfers(businessId).then(setRows).catch((e) => toast(errText(e), 'error')), [businessId]);
  useEffect(() => { load(); }, [load]);
  const remove = async (t) => {
    if (!(await confirmAction({ title: 'Delete this transfer?', message: 'Its posting is reversed; both balances go back.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await deleteTransfer(t.id); load(); } catch (e) { toast(errText(e), 'error'); }
  };
  if (!rows) return <LoadingState />;
  return (
    <>
      <div style={{ marginBottom: '0.75rem' }}><Can do="cashbank:write"><button className="btn btn-primary" onClick={() => setForm({})}><Plus size={16} /> Transfer Money</button></Can></div>
      <div className="glass-panel">
        {rows.length === 0 ? <EmptyState title="No transfers" hint="Move money between Cash in Hand and your banks, like an ATM withdrawal or a cash deposit." /> : (
          <table className="data-table">
            <thead><tr><th>Date</th><th>From</th><th>To</th><th>Reference</th><th style={right}>Amount</th><th style={right}>Charges</th><th /></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.id}><td>{t.date}</td><td>{t.fromName}</td><td>{t.toName}</td><td>{t.reference || '—'}</td><td style={right}>{money(t.amount)}</td><td style={right}>{t.fee ? money(t.fee) : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}><Can do="cashbank:write"><button className="btn btn-secondary" style={small} onClick={() => setForm(t)}>Edit</button><button className="icon-btn icon-btn-red" aria-label="Delete transfer" onClick={() => remove(t)}><Trash2 size={14} /></button></Can></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {form && <TransferModal businessId={businessId} editing={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

// ---- P5-S4 cheques -------------------------------------------------------------------------------------------------------

function Cheques({ businessId }) {
  const [direction, setDirection] = useState('received');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [banks, setBanks] = useState([]);
  const [add, setAdd] = useState(null);
  const [act, setAct] = useState(null);
  const [partyList, setPartyList] = useState([]);
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => listCheques(businessId, { direction, status }).then(setRows).catch((e) => toast(errText(e), 'error')), [businessId, direction, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    listBankAccounts(businessId).then(setBanks).catch(() => {});
    apiClient.get('/v1/parties?limit=200').then((r) => setPartyList(r.data)).catch(() => {});
  }, [businessId]);
  const bankName = (id) => banks.find((b) => b.id === id)?.label || '—';
  const due = (rows || []).filter((c) => c.due).length;

  const saveCheque = async () => {
    try {
      await createCheque({ businessId, direction, partyId: add.partyId, number: add.number.trim(), amount: Number(add.amount), chequeDate: add.chequeDate, receivedDate: add.receivedDate, bankAccountId: add.bankAccountId || null, reminderDays: Number(add.reminderDays) || 0, notes: add.notes, autoAllocate: add.autoAllocate });
      toast('Cheque added', 'success'); setAdd(null); load();
    } catch (e) { toast(errText(e), 'error'); }
  };
  const runAction = async () => {
    try {
      await chequeAction(act.cheque.id, { action: act.action, date: act.date, ...(act.bankAccountId ? { bankAccountId: act.bankAccountId } : {}), ...(act.action === 'bounce' ? { bounceCharges: Number(act.charges) || 0, chargeTo: act.chargeTo } : {}), note: act.note });
      toast('Saved', 'success'); setAct(null); load();
    } catch (e) { toast(errText(e), 'error'); }
  };

  return (
    <>
      <div className="glass-panel p-4 mb-6" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <TabStrip tabs={[{ id: 'received', label: 'Received' }, { id: 'issued', label: 'Issued' }]} value={direction} onChange={setDirection} ariaLabel="Direction" />
        <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{Object.keys(CHEQUE_STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}</select>
        {due > 0 && <StatusChip tone="warning">Due soon: {due} ⚠</StatusChip>}
        <span style={{ marginLeft: 'auto' }}><Can do="cashbank:write"><button className="btn btn-primary" onClick={() => setAdd({ partyId: '', number: '', amount: '', chequeDate: localToday(), receivedDate: localToday(), bankAccountId: '', reminderDays: 3, notes: '', autoAllocate: true })}><Plus size={16} /> Add Cheque</button></Can></span>
      </div>
      <div className="glass-panel">
        {!rows ? <LoadingState /> : rows.length === 0 ? <EmptyState title="No cheques" hint="Cheques you receive or issue, from Add Cheque or a payment by cheque, appear here." /> : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Cheque no</th><th>Party</th><th>Bank account</th><th style={right}>Amount</th><th>Cheque date</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.number}</td><td>{c.partyName}</td><td>{bankName(c.bankAccountId)}</td><td style={right}>{money(c.amount)}</td>
                  <td title={`Valid till ${c.validTill}`}>{c.chequeDate}{c.postDated && <span className="field-hint"> (post-dated)</span>}{c.due && ' ⚠'}</td>
                  <td>
                    <StatusChip tone={CHEQUE_STATUS_TONE[c.status]}>{c.status}</StatusChip>{c.stale && <> <StatusChip tone="danger">Stale since {c.validTill}</StatusChip></>}
                    {c.status === 'bounced' && c.bounceCharges > 0 && <span className="field-hint"> +{money(c.bounceCharges)}</span>}
                    {c.section138 && (
                      <div className="field-hint" style={{ marginTop: 4 }}>
                        <StatusChip tone={SECTION_138_TEXT[c.section138.stage].tone}>§138</StatusChip> {SECTION_138_TEXT[c.section138.stage].text(c.section138)}
                        <Can do="cashbank:write"> <button className="btn btn-secondary" style={small} onClick={() => setNotice({ cheque: c, date: c.noticeServedOn || localToday() })}>{c.noticeServedOn ? `Notice served ${c.noticeServedOn}` : 'Notice served…'}</button></Can>
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}><Can do="cashbank:write">{chequeButtons(c).map((b) => (
                    <button key={b.action} className={`btn btn-${b.tone === 'danger' ? 'secondary' : b.tone}`} style={{ ...small, marginRight: 4, ...(b.tone === 'danger' ? { color: '#dc2626' } : {}) }} onClick={() => setAct({ cheque: c, action: b.action, date: localToday(), bankAccountId: c.bankAccountId || '', charges: '', chargeTo: 'party', note: '' })}>{b.label}</button>
                  ))}</Can></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {add && (
        <Dialog title={direction === 'received' ? 'Add received cheque' : 'Add issued cheque'} onClose={() => setAdd(null)} width={640}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Party *"><select className="form-input" value={add.partyId} onChange={(e) => setAdd({ ...add, partyId: e.target.value })}><option value="">Select party</option>{partyList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Cheque number *"><input className="form-input" value={add.number} onChange={(e) => setAdd({ ...add, number: e.target.value })} /></Field>
            <Field label="Amount *"><input type="number" min="0" step="any" className="form-input" value={add.amount} onChange={(e) => setAdd({ ...add, amount: e.target.value })} /></Field>
            <Field label="Cheque date *"><input type="date" className="form-input" value={add.chequeDate} onChange={(e) => setAdd({ ...add, chequeDate: e.target.value })} /></Field>
            <Field label={direction === 'received' ? 'Received on' : 'Issued on'}><input type="date" className="form-input" value={add.receivedDate} onChange={(e) => setAdd({ ...add, receivedDate: e.target.value })} /></Field>
            <Field label={direction === 'received' ? 'Deposit to' : 'Drawn on'}><select className="form-input" value={add.bankAccountId} onChange={(e) => setAdd({ ...add, bankAccountId: e.target.value })}><option value="">Choose later</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
            <Field label="Reminder days"><input type="number" min="0" className="form-input" value={add.reminderDays} onChange={(e) => setAdd({ ...add, reminderDays: e.target.value })} /></Field>
            <Field label="Notes"><input className="form-input" value={add.notes} onChange={(e) => setAdd({ ...add, notes: e.target.value })} /></Field>
          </div>
          <label style={{ display: 'flex', gap: 6, marginTop: 8 }}><input type="checkbox" checked={add.autoAllocate} onChange={(e) => setAdd({ ...add, autoAllocate: e.target.checked })} /> Apply to the oldest open {direction === 'received' ? 'invoices' : 'bills'} of this party</label>
          <Actions onCancel={() => setAdd(null)} onSave={saveCheque} disabled={!add.partyId || !add.number.trim() || !(Number(add.amount) > 0)} />
        </Dialog>
      )}
      {notice && (
        <Dialog title={`§138 notice · cheque ${notice.cheque.number}`} onClose={() => setNotice(null)}>
          <p className="field-hint">Under the Negotiable Instruments Act, the drawer has 15 days from receiving your demand notice to pay; after that a complaint can be filed within one month. Enter the day the notice reached them.</p>
          <Field label="Notice received by the drawer on"><input type="date" className="form-input" value={notice.date} onChange={(e) => setNotice({ ...notice, date: e.target.value })} /></Field>
          <p className="field-hint">These dates are reminders, not legal advice.</p>
          <Actions onCancel={() => setNotice(null)} onSave={async () => { try { await updateCheque(notice.cheque.id, { noticeServedOn: notice.date }); setNotice(null); load(); } catch (e) { toast(errText(e), 'error'); } }} disabled={!notice.date} />
        </Dialog>
      )}
      {act && (
        <Dialog title={`${chequeButtons(act.cheque).find((b) => b.action === act.action)?.label} · cheque ${act.cheque.number}`} onClose={() => setAct(null)}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date"><input type="date" className="form-input" value={act.date} onChange={(e) => setAct({ ...act, date: e.target.value })} /></Field>
            {(act.action === 'deposit' || act.action === 'clear') && <Field label="Bank account *"><select className="form-input" value={act.bankAccountId} onChange={(e) => setAct({ ...act, bankAccountId: e.target.value })}><option value="">Select</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>}
            {act.action === 'bounce' && <Field label="Charges"><input type="number" min="0" step="any" className="form-input" value={act.charges} onChange={(e) => setAct({ ...act, charges: e.target.value })} /></Field>}
            {act.action === 'bounce' && act.cheque.direction === 'received' && <Field label="Charge to"><select className="form-input" value={act.chargeTo} onChange={(e) => setAct({ ...act, chargeTo: e.target.value })}><option value="party">The party</option><option value="us">Us (bank charges)</option></select></Field>}
            <Field label="Note"><input className="form-input" value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} /></Field>
          </div>
          {act.action === 'bounce' && <p className="field-hint">The payment is voided: the {act.cheque.direction === 'received' ? 'invoices' : 'bills'} it paid are open again.{act.cheque.direction === 'received' && ' The 30 days for a §138 demand notice start from the bank\'s return memo.'}</p>}
          {act.cheque.stale && (act.action === 'deposit' || act.action === 'clear') && <p className="ui-error" role="alert">This cheque was valid till {act.cheque.validTill}. A stale cheque can not be presented: cancel it and ask for a fresh one.</p>}
          <Actions onCancel={() => setAct(null)} onSave={runAction} disabled={(act.action === 'deposit' || act.action === 'clear') && !act.bankAccountId} />
        </Dialog>
      )}
    </>
  );
}

// ---- P5-S5 loans ---------------------------------------------------------------------------------------------------------

const blankLoan = () => ({ lenderType: 'bank', lenderPan: '', tdsExempt: false, name: '', lender: '', type: 'term', principal: '', receivedAccountId: '', receivedOn: localToday(), ratePct: '', interestType: 'reducing', tenureMonths: 12, emi: '', emiEdited: false, firstEmiDate: localToday(), processingFee: '', purpose: 'business', notes: '' });

function Loans({ businessId }) {
  const [rows, setRows] = useState(null);
  const [banks, setBanks] = useState([]);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => listLoans(businessId).then(setRows).catch((e) => toast(errText(e), 'error')), [businessId]);
  useEffect(() => { load(); listBankAccounts(businessId).then(setBanks).catch(() => {}); }, [load, businessId]);
  const formEmi = form ? loanFormEmi(form) : 0;
  const save = async () => {
    try {
      const r = await createLoan({ businessId, name: form.name.trim(), lender: form.lender, type: form.type, principal: Number(form.principal), ratePct: Number(form.ratePct) || 0, interestType: form.interestType, tenureMonths: Math.floor(Number(form.tenureMonths)), ...(form.emiEdited && Number(form.emi) > 0 ? { emi: Number(form.emi) } : {}), firstEmiDate: form.firstEmiDate, receivedOn: form.receivedOn, receivedAccountId: form.receivedAccountId || null, processingFee: Number(form.processingFee) || 0, purpose: form.purpose, notes: form.notes, lenderType: form.lenderType, lenderPan: form.lenderPan.trim().toUpperCase(), tdsExempt: form.tdsExempt, ...(form.ack?.trim() ? { cashAcknowledgement: form.ack.trim() } : {}) });
      toast('Loan added', 'success'); setForm(null); load(); setOpen(r.id);
    } catch (e) {
      const limit = cashLimitOf(e);
      if (limit) setForm((x) => ({ ...x, ackNeeded: limit }));
      else toast(errText(e), 'error');
    }
  };
  if (!rows) return <LoadingState />;
  if (open) return <LoanDetail id={open} banks={banks} onBack={() => { setOpen(null); load(); }} />;
  return (
    <>
      <div style={{ marginBottom: '0.75rem' }}><Can do="cashbank:write"><button className="btn btn-primary" onClick={() => setForm(blankLoan())}><Plus size={16} /> Add Loan</button></Can></div>
      <div className="glass-panel">
        {rows.length === 0 ? <EmptyState title="No loans" hint="Add a loan to see its schedule, pay EMIs and keep its balance in the books." /> : (
          <table className="data-table">
            <thead><tr><th>Loan</th><th>Lender</th><th>Type</th><th style={right}>Principal</th><th style={right}>Rate</th><th style={right}>EMI</th><th style={right}>Outstanding</th><th>Next due</th><th /></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(l.id)}>
                <td>{l.name}{l.status === 'closed' && <> <StatusChip tone="success">Closed</StatusChip></>}</td><td>{l.lender || '—'}</td><td>{l.type}</td>
                <td style={right}>{money(l.principal)}</td><td style={right}>{l.ratePct}%</td><td style={right}>{money(l.emi)}</td><td style={right}>{money(l.outstanding)}</td>
                <td>{l.nextDue?.dueDate ?? '—'}</td><td>›</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {form && (
        <Dialog title="Add Loan" onClose={() => setForm(null)} width={720}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Account name *"><input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Term loan A" /></Field>
            <Field label="Lender"><input className="form-input" value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} /></Field>
            <Field label="Type"><select className="form-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{['term', 'od', 'cc', 'vehicle', 'business', 'personal', 'housing', 'education', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label="Principal *"><input type="number" min="0" step="any" className="form-input" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></Field>
            <Field label="Received in *"><select className="form-input" value={form.receivedAccountId} onChange={(e) => setForm({ ...form, receivedAccountId: e.target.value })}><option value="">Cash in Hand</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
            <Field label="Received on"><input type="date" className="form-input" value={form.receivedOn} onChange={(e) => setForm({ ...form, receivedOn: e.target.value })} /></Field>
            <Field label="Interest rate % p.a. *"><input type="number" min="0" step="any" className="form-input" value={form.ratePct} onChange={(e) => setForm({ ...form, ratePct: e.target.value })} /></Field>
            <Field label="Interest type"><div style={{ display: 'flex', gap: 12 }}><label><input type="radio" checked={form.interestType === 'reducing'} onChange={() => setForm({ ...form, interestType: 'reducing' })} /> Reducing</label><label><input type="radio" checked={form.interestType === 'flat'} onChange={() => setForm({ ...form, interestType: 'flat' })} /> Flat</label></div></Field>
            <Field label="Tenure (months)"><input type="number" min="1" max="600" className="form-input" value={form.tenureMonths} onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })} /></Field>
            <Field label="EMI (editable)"><input type="number" min="0" step="any" className="form-input" value={form.emiEdited ? form.emi : formEmi || ''} onChange={(e) => setForm({ ...form, emi: e.target.value, emiEdited: e.target.value !== '' })} /></Field>
            <Field label="First EMI date"><input type="date" className="form-input" value={form.firstEmiDate} onChange={(e) => setForm({ ...form, firstEmiDate: e.target.value })} /></Field>
            <Field label="Processing fee"><input type="number" min="0" step="any" className="form-input" value={form.processingFee} onChange={(e) => setForm({ ...form, processingFee: e.target.value })} /></Field>
            <Field label="Purpose"><select className="form-input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}><option value="business">Business</option><option value="housing">Housing (§24(b))</option><option value="education">Education (§80E)</option><option value="other">Other</option></select></Field>
            <Field label="Description"><input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label="Lender is (for TDS u/s 194A)"><select className="form-input" value={form.lenderType} onChange={(e) => setForm({ ...form, lenderType: e.target.value })}><option value="bank">Bank / co-op bank / LIC / insurer (no TDS)</option><option value="nbfc">NBFC</option><option value="company">Company / firm</option><option value="individual">Individual / HUF</option><option value="other">Other</option></select></Field>
            {form.lenderType !== 'bank' && <Field label="Lender PAN"><input className="form-input" value={form.lenderPan} onChange={(e) => setForm({ ...form, lenderPan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} /></Field>}
          </div>
          {form.lenderType !== 'bank' && (
            <div className="field-hint" style={{ marginTop: 6 }}>
              TDS at 10% (20% without PAN) is kept from the interest once interest to this lender passes ₹10,000 in the year.{' '}
              <label><input type="checkbox" checked={form.tdsExempt} onChange={(e) => setForm({ ...form, tdsExempt: e.target.checked })} /> No TDS on this loan (Form 15G / 15H received, or we are not required to deduct)</label>
            </div>
          )}
          {!form.receivedAccountId && Number(form.principal) >= 20000 && !form.ackNeeded && <p className="field-hint">⚠ A loan of ₹20,000 or more should not be taken in cash (section 269SS).</p>}
          <CashAck message={form.ackNeeded} value={form.ack || ''} onChange={(v) => setForm({ ...form, ack: v })} />
          <Actions onCancel={() => setForm(null)} onSave={save} disabled={!form.name.trim() || !(Number(form.principal) > 0) || !(Number(form.tenureMonths) >= 1) || (form.ackNeeded && !form.ack?.trim())} />
        </Dialog>
      )}
    </>
  );
}

function LoanDetail({ id, banks, onBack }) {
  const [loan, setLoan] = useState(null);
  const [pay, setPay] = useState(null);
  const [statement, setStatement] = useState(null);
  const load = useCallback(() => getLoan(id).then(setLoan).catch((e) => toast(errText(e), 'error')), [id]);
  useEffect(() => { load(); }, [load]);
  const startPay = (kind = 'emi') => setPay({ kind, date: localToday(), principal: kind === 'emi' ? String(loan.nextDue?.principal ?? '') : '', interest: kind === 'emi' ? String(loan.nextDue?.interest ?? '') : '', charges: '', accountId: loan.receivedAccountId || '', reschedule: kind === 'topup' ? 'emi' : 'tenure', notes: '' });
  const topup = pay?.kind === 'topup';
  const save = async () => {
    try {
      setLoan(await payLoan(id, { kind: pay.kind, date: pay.date, principal: Number(pay.principal) || 0, interest: topup ? 0 : Number(pay.interest) || 0, charges: Number(pay.charges) || 0, accountId: pay.accountId || null, reschedule: pay.reschedule, notes: pay.notes, ...(pay.ack?.trim() ? { cashAcknowledgement: pay.ack.trim() } : {}) }));
      const updated = await getLoan(id);
      const last = [...updated.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      toast(topup ? 'Loan increased' : last?.tdsAmount ? `Payment saved · TDS ${money(last.tdsAmount)} kept u/s 194A (pay it to the Government by the 7th)` : 'Payment saved', 'success');
      setLoan(updated); setPay(null); setStatement(null);
    } catch (e) {
      const limit = cashLimitOf(e);
      if (limit) setPay((x) => ({ ...x, ackNeeded: limit }));
      else toast(errText(e), 'error');
    }
  };
  const showStatement = async () => { try { setStatement(await loanStatement(id)); } catch (e) { toast(errText(e), 'error'); } };
  const [credit, setCredit] = useState(null);
  const saveCredit = async () => {
    try {
      const r = await creditLoanInterest(id, { date: credit.date, amount: Number(credit.amount), notes: credit.notes });
      setLoan(r); setCredit(null);
      const last = [...r.credits].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      toast(last?.tdsAmount ? `Interest credited · TDS ${money(last.tdsAmount)} kept u/s 194A` : 'Interest credited', 'success');
    } catch (e) { toast(errText(e), 'error'); }
  };
  const removeCredit = async (cr) => {
    if (!(await confirmAction({ title: 'Delete this interest credit?', message: 'Its posting and its TDS entry are reversed. Not possible once a payment has paid it.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { setLoan(await deleteLoanInterestCredit(id, cr.id)); } catch (e) { toast(errText(e), 'error'); }
  };
  const removePayment = async (p) => {
    if (!(await confirmAction({ title: 'Delete this payment?', message: 'Its posting is reversed and the schedule rebuilt.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { setLoan(await deleteLoanPayment(id, p.id)); } catch (e) { toast(errText(e), 'error'); }
  };
  const removeLoan = async () => {
    if (!(await confirmAction({ title: `Delete ${loan.name}?`, message: 'Only a loan with no payments can be deleted. The money received is reversed.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await deleteLoan(id); onBack(); } catch (e) { toast(errText(e), 'error'); }
  };
  if (!loan) return <LoadingState />;
  return (
    <>
      <button className="btn btn-secondary" style={{ marginBottom: 8 }} onClick={onBack}><ArrowLeft size={14} /> Loan accounts</button>
      <div className="glass-panel p-4 mb-6" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>{loan.name}</strong><span className="field-hint">{loan.lender} · {loan.code} · {loan.ratePct}% {loan.interestType} · EMI {money(loan.emi)}</span>
        <span>Outstanding <strong>{money(loan.outstanding)}</strong></span><span className="field-hint">Interest paid {money(loan.interestPaid)}{loan.tdsDeducted > 0 && ` · TDS u/s 194A ${money(loan.tdsDeducted)}`}{loan.interestCreditedUnpaid > 0 && ` · Interest credited, not paid ${money(loan.interestCreditedUnpaid)}`}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Can do="cashbank:write">
            {loan.status === 'active' && <button className="btn btn-primary" onClick={() => startPay('emi')}>Make Payment</button>}
            <button className="btn btn-secondary" onClick={() => startPay('topup')}>Increase Loan</button>
            {loan.status === 'active' && <button className="btn btn-secondary" onClick={() => setCredit({ date: fyEndOf(localToday()), amount: String(loan.nextDue?.interest || ''), notes: '' })}>Credit interest</button>}
            {loan.payments.length === 0 && <button className="icon-btn icon-btn-red" aria-label={`Delete ${loan.name}`} onClick={removeLoan}><Trash2 size={14} /></button>}
          </Can>
          <button className="btn btn-secondary" onClick={() => (statement ? setStatement(null) : showStatement())}>{statement ? 'Schedule' : 'Statement'}</button>
        </span>
      </div>
      {statement && (
        <div className="glass-panel">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Particulars</th><th style={right}>Borrowed</th><th style={right}>Repaid</th><th style={right}>Outstanding</th></tr></thead>
            <tbody>{statement.rows.map((r) => <tr key={r.id}><td>{r.txnDate}</td><td>{r.narration || refTypeLabel(r.refType)}</td><td style={right}>{r.borrowed ? money(r.borrowed) : ''}</td><td style={right}>{r.repaid ? money(r.repaid) : ''}</td><td style={right}>{money(r.outstanding)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}><strong>Outstanding</strong></td><td style={right}><strong>{money(statement.outstanding)}</strong></td></tr></tfoot>
          </table>
        </div>
      )}
      {!statement && <div className="glass-panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>#</th><th>Due date</th><th style={right}>EMI</th><th style={right}>Principal</th><th style={right}>Interest</th><th style={right}>Balance</th><th>Status</th></tr></thead>
            <tbody>{loan.schedule.map((s) => (
              <tr key={s.n}><td>{s.n}</td><td>{s.dueDate}</td><td style={right}>{money(s.emi)}</td><td style={right}>{money(s.principalPart)}</td><td style={right}>{money(s.interestPart)}</td><td style={right}>{money(s.balanceAfter)}</td>
                <td><StatusChip tone={s.status === 'paid' ? 'success' : s.status === 'part' ? 'warning' : 'neutral'}>{s.status === 'paid' ? `Paid ${s.paidOn ?? ''}` : s.status === 'part' ? 'Part paid' : 'Due'}</StatusChip></td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>}
      {loan.credits.length > 0 && (
        <div className="glass-panel" style={{ marginTop: '1rem' }}>
          <table className="data-table">
            <thead><tr><th>Interest credited on</th><th style={right}>Interest</th><th style={right}>TDS kept</th><th>Notes</th><th /></tr></thead>
            <tbody>{loan.credits.map((cr) => (
              <tr key={cr.id}><td>{cr.date}</td><td style={right}>{money(cr.amount)}</td><td style={right}>{cr.tdsAmount ? money(cr.tdsAmount) : ''}</td><td>{cr.notes}</td>
                <td><Can do="cashbank:write"><button className="icon-btn icon-btn-red" aria-label="Delete interest credit" onClick={() => removeCredit(cr)}><Trash2 size={14} /></button></Can></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {credit && (
        <Dialog title="Credit interest" onClose={() => setCredit(null)}>
          <p className="field-hint">Interest the lender has earned but you have not paid yet, for example the year's interest on 31 March. It is booked as an expense now, and TDS u/s 194A is kept on the day of credit (the law takes the earlier of credit and payment). When you later pay it, the payment clears it without deducting again.</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Credited on"><input type="date" className="form-input" value={credit.date} onChange={(e) => setCredit({ ...credit, date: e.target.value })} /></Field>
            <Field label="Interest *"><input type="number" min="0" step="any" className="form-input" value={credit.amount} onChange={(e) => setCredit({ ...credit, amount: e.target.value })} /></Field>
            <Field label="Notes"><input className="form-input" value={credit.notes} onChange={(e) => setCredit({ ...credit, notes: e.target.value })} placeholder="FY interest" /></Field>
          </div>
          <Actions onCancel={() => setCredit(null)} onSave={saveCredit} disabled={!(Number(credit.amount) > 0)} label="Credit" />
        </Dialog>
      )}
      {loan.payments.length > 0 && (
        <div className="glass-panel" style={{ marginTop: '1rem' }}>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Type</th><th style={right}>Principal</th><th style={right}>Interest</th><th style={right}>Charges</th><th style={right}>TDS</th><th /></tr></thead>
            <tbody>{loan.payments.map((p) => (
              <tr key={p.id}><td>{p.date}</td><td>{p.kind}</td><td style={right}>{money(p.principal)}</td><td style={right}>{money(p.interest)}</td><td style={right}>{p.charges ? money(p.charges) : ''}</td><td style={right}>{p.tdsAmount ? money(p.tdsAmount) : ''}</td>
                <td><Can do="cashbank:write"><button className="icon-btn icon-btn-red" aria-label="Delete payment" onClick={() => removePayment(p)}><Trash2 size={14} /></button></Can></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {pay && (
        <Dialog title={topup ? 'Increase Loan' : 'Make Payment'} onClose={() => setPay(null)}>
          <div className="grid grid-cols-2 gap-4">
            {!topup && <Field label="Type"><select className="form-input" value={pay.kind} onChange={(e) => { const k = e.target.value; setPay({ ...pay, kind: k, ...(k === 'emi' ? { principal: String(loan.nextDue?.principal ?? ''), interest: String(loan.nextDue?.interest ?? '') } : {}) }); }}><option value="emi">EMI</option><option value="part">Part payment</option><option value="prepay">Prepay</option></select></Field>}
            <Field label="Date"><input type="date" className="form-input" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
            <Field label={topup ? 'Amount borrowed *' : 'Principal'}><input type="number" min="0" step="any" className="form-input" value={pay.principal} onChange={(e) => setPay({ ...pay, principal: e.target.value })} /></Field>
            {!topup && <Field label="Interest"><input type="number" min="0" step="any" className="form-input" value={pay.interest} onChange={(e) => setPay({ ...pay, interest: e.target.value })} /></Field>}
            <Field label={topup ? 'Charges deducted by the lender' : 'Charges'}><input type="number" min="0" step="any" className="form-input" value={pay.charges} onChange={(e) => setPay({ ...pay, charges: e.target.value })} /></Field>
            <Field label={topup ? 'Received in *' : 'From account *'}><select className="form-input" value={pay.accountId} onChange={(e) => setPay({ ...pay, accountId: e.target.value })}><option value="">Cash in Hand</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>
            {pay.kind !== 'emi' && <Field label={topup ? 'Repay it by' : 'After this payment'}><select className="form-input" value={pay.reschedule} onChange={(e) => setPay({ ...pay, reschedule: e.target.value })}>{topup ? <><option value="emi">Keep the end date, raise the EMI</option><option value="tenure">Keep the EMI, take longer</option></> : <><option value="tenure">Keep the EMI, finish sooner</option><option value="emi">Keep the end date, lower the EMI</option></>}</select></Field>}
            <Field label="Notes"><input className="form-input" value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} /></Field>
          </div>
          {!topup && loan.lenderType !== 'bank' && !loan.tdsExempt && Number(pay.interest) > 0 && <p className="field-hint">TDS u/s 194A on the interest is worked out from this lender's interest for the year and kept from what is paid.</p>}
          {!pay.accountId && !pay.ackNeeded && (Number(pay.principal) || 0) + (topup ? 0 : (Number(pay.interest) || 0) + (Number(pay.charges) || 0)) >= 20000 && <p className="field-hint">⚠ ₹20,000 or more {topup ? 'borrowed' : 'repaid'} in cash breaks section {topup ? '269SS' : '269T'}.</p>}
          <CashAck message={pay.ackNeeded} value={pay.ack || ''} onChange={(v) => setPay({ ...pay, ack: v })} />
          <Actions onCancel={() => setPay(null)} onSave={save} label={topup ? 'Increase' : 'Save'} disabled={(topup ? !(Number(pay.principal) > 0) : !((Number(pay.principal) || 0) + (Number(pay.interest) || 0) + (Number(pay.charges) || 0) > 0)) || (pay.ackNeeded && !pay.ack?.trim())} />
        </Dialog>
      )}
    </>
  );
}

// ---- P5-S6 reconciliation ------------------------------------------------------------------------------------------------

function Reconcile({ businessId }) {
  const navigate = useNavigate();
  const [banks, setBanks] = useState(null);
  const [bankId, setBankId] = useState('');
  const [stmt, setStmt] = useState(null);
  const [result, setResult] = useState(null);
  const [ticked, setTicked] = useState({});
  const [balance, setBalance] = useState('');
  const [reason, setReason] = useState('');
  const [cashId, setCashId] = useState('');
  useEffect(() => {
    listBankAccounts(businessId).then((b) => { setBanks(b); setBankId((cur) => cur || b[0]?.id || ''); }).catch(() => {});
    moneyAccounts(businessId).then((m) => setCashId(m.find((x) => x.kind === 'cash')?.accountId || '')).catch(() => {});
  }, [businessId]);
  const bank = banks?.find((b) => b.id === bankId);
  const rematch = async (rows, keep = {}) => {
    const r = await matchStatementRows(bankId, { rows });
    setResult(r);
    setTicked({ ...Object.fromEntries(r.matches.map((m) => [m.row, true])), ...keep });
  };
  /** Records an unmatched statement row on this bank (bank charges, interest, a cash deposit…) and matches again. */
  const quick = async (i, opt) => {
    const r = stmt.rows[i];
    const amount = r.debit || r.credit;
    try {
      if (opt.transfer) {
        const [from, to] = opt.transfer === 'to_cash' ? [bank.accountId, cashId] : [cashId, bank.accountId];
        await createTransfer({ businessId, fromAccountId: from, toAccountId: to, amount, date: r.date, reference: r.description.slice(0, 100) });
      } else await createCashEntry({ businessId, accountId: bank.accountId, amount, date: r.date, remarks: r.description.slice(0, 300), ...opt.body });
      toast(`Recorded as ${opt.label.toLowerCase()}`, 'success');
      await rematch(stmt.rows, ticked);
    } catch (e) { toast(errText(e), 'error'); }
  };
  const ignore = async (i) => {
    const why = window.prompt('Why leave this row out? (optional)') ?? null;
    if (why === null) return;
    try { await ignoreStatementRows(bankId, [{ hash: result.hashes[i], statementDate: stmt.rows[i].date, reason: why }]); await rematch(stmt.rows, ticked); } catch (e) { toast(errText(e), 'error'); }
  };
  const entriesById = useMemo(() => new Map((result?.entries ?? []).map((e) => [e.id, e])), [result]);

  const upload = async (file) => {
    try {
      const parsed = await statementRowsFromFile(file);
      if (!parsed.rows.length) { toast('No transactions found in that file', 'error'); return; }
      setStmt(parsed);
      setBalance(String(statementClosing(parsed.rows) ?? ''));
      await rematch(parsed.rows);
    } catch (e) { toast(errText(e), 'error'); }
  };
  const finish = async () => {
    const chosen = result.matches.filter((m) => ticked[m.row]);
    try {
      const r = await saveReconciliation(bankId, { matches: chosen.map((m) => ({ entryId: m.entryId, hash: m.hash, statementDate: stmt.rows[m.row].date })), statementBalance: Number(balance), clearedOn: stmt.rows.reduce((d, x) => (x.date > d ? x.date : d), stmt.rows[0].date), ...(reason.trim() ? { reason: reason.trim() } : {}) });
      toast(`${r.reconciled} entries reconciled${r.difference ? ` · difference ${money(r.difference)}` : ''}`, r.difference ? 'warning' : 'success');
      setStmt(null); setResult(null); setReason('');
    } catch (e) { toast(errText(e), 'error'); }
  };
  if (!banks) return <LoadingState />;
  if (!banks.length) return <EmptyState title="No bank accounts" hint="Add a bank account first." />;
  const rowState = (i) => (result.alreadyReconciled.includes(i) ? 'done' : result.matches.find((m) => m.row === i) ? 'matched' : 'unmatched');
  const difference = result ? Math.round(((Number(balance) || 0) - result.bookBalance) * 100) / 100 : 0;
  return (
    <>
      <div className="glass-panel p-4 mb-6" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="filter-select" value={bankId} onChange={(e) => { setBankId(e.target.value); setResult(null); setStmt(null); }} aria-label="Bank account">{banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
        <Can do="cashbank:write">
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}><Upload size={14} /> Upload statement (CSV / Excel)<input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        </Can>
        {result && <span style={{ marginLeft: 'auto' }}>Statement bal <input type="number" step="any" className="form-input" style={{ width: 140, display: 'inline-block' }} value={balance} onChange={(e) => setBalance(e.target.value)} aria-label="Statement balance" /> · Book bal <strong>{money(result.bookBalance)}</strong></span>}
      </div>
      {!result && <EmptyState title="Reconcile a statement" hint="Upload your bank's statement as CSV or Excel (.xlsx). Rows are matched to the books by amount and date (±3 days); a payment or cheque number in the description matches first. Bank charges, interest and cash deposits can be recorded straight from here." />}
      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1rem' }}>
          <div className="glass-panel">
            <h4 style={{ padding: '0.6rem 1rem 0' }}>Statement rows</h4>
            <table className="data-table" style={{ minWidth: 0 }}>
              <tbody>{stmt.rows.map((r, i) => {
                const st = rowState(i);
                const m = result.matches.find((x) => x.row === i);
                return (
                  <tr key={i}>
                    <td>{st === 'matched' && <input type="checkbox" checked={!!ticked[i]} onChange={(e) => setTicked({ ...ticked, [i]: e.target.checked })} aria-label={`Match row ${i + 1}`} />}</td>
                    <td>{r.date}</td><td>{r.credit ? 'CR' : 'DR'} {money(r.credit || r.debit)}</td><td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description}</td>
                    <td>{st === 'done' ? <StatusChip tone="neutral">Done before</StatusChip> : st === 'matched' ? <StatusChip tone="success">● {entriesById.get(m.entryId)?.narration || 'matched'}</StatusChip> : (
                      <Can do="cashbank:write">
                        <select className="filter-select" style={{ maxWidth: 170 }} value="" aria-label={`Record row ${i + 1} as`} onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'party') navigate(r.credit ? '/receipts' : '/expenses');
                          else if (v === 'ignore') ignore(i);
                          else if (v) quick(i, RECON_QUICK[r.credit ? 'credit' : 'debit'].find((o) => o.id === v));
                        }}>
                          <option value="">Record as…</option>
                          {RECON_QUICK[r.credit ? 'credit' : 'debit'].map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                          <option value="party">{r.credit ? 'Payment from a party…' : 'Expense / payment to a party…'}</option>
                          <option value="ignore">Ignore this row</option>
                        </select>
                      </Can>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="glass-panel">
            <h4 style={{ padding: '0.6rem 1rem 0' }}>Book entries not matched (stay uncleared)</h4>
            <table className="data-table" style={{ minWidth: 0 }}>
              <tbody>{result.unmatchedEntries.map((id) => { const e = entriesById.get(id); return e && <tr key={id}><td>{e.txnDate}</td><td>{e.narration || '—'}</td><td style={right}>{e.deposit ? money(e.deposit) : `-${money(e.withdrawal)}`}</td></tr>; })}</tbody>
            </table>
          </div>
        </div>
      )}
      {result && (
        <div className="glass-panel p-4" style={{ marginTop: '1rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Difference <strong style={{ color: difference ? '#d97706' : '#059669' }}>{money(difference)}</strong></span>
          {difference !== 0 && <input className="form-input" style={{ flex: 1, minWidth: 220 }} placeholder="Reason to finish with a difference (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          <Can do="cashbank:write"><button className="btn btn-primary" onClick={finish} disabled={balance === '' || (difference !== 0 && !reason.trim())}>Finish reconciliation</button></Can>
        </div>
      )}
    </>
  );
}
