import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import { TDS_DEDUCTION_SECTIONS } from '@ledgora/tax-engine';
import {
  deleteReceipt,
  getAllDebitNotes,
  getAllPaymentsOut,
  getAllPurchases,
  getNextInvoiceNumber,
  getProfile,
  savePurchase,
  saveReceipt,
} from '../../lib/data';
import { belongsToProfile, businessKeyOf, formatCurrency, getFinancialYearLabel, localToday } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { EmptyState } from '../../components/ui/States';
import { StatusChip } from '../../components/ui/Display';
import HelpButton from '../../components/ui/HelpButton';
import AttachmentField from '../../components/ui/AttachmentField';
import { applyPaymentOut, cashOutWarning, openBillsFor, releasePaymentOut, tdsPayableRows, tdsSuggestion } from '../purchases/purchaseExtras';

// Vyapar parity P3-S2: a payment voucher. `direction="out"` is Payment Out: money paid to a supplier, applied to their
// purchase bills by the same allocation engine Payment In uses (tax-engine allocatePayment), with the discount we
// received and the TDS we deducted settling bills like money. Vouchers are kept in the receipts collection with
// direction 'out', so the Receipts screen (money in) never lists them. Payment In still uses ReceiptVoucher.

const MODES = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card', 'Other'];

// The TDS return is quarterly: Q1 April–June ... Q4 January–March of the financial year.
const QUARTERS = [['Q1', '04-01', '06-30'], ['Q2', '07-01', '09-30'], ['Q3', '10-01', '12-31'], ['Q4', '01-01', '03-31']];
function quarterOf(date) {
  const fy = getFinancialYearLabel(new Date(`${date}T00:00:00`));
  const m = Number(String(date).slice(5, 7));
  return { fy, q: m >= 4 && m <= 6 ? 'Q1' : m >= 7 && m <= 9 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4' };
}
function quarterRange({ fy, q }) {
  const start = Number(String(fy).slice(0, 4));
  const [, from, to] = QUARTERS.find((x) => x[0] === q);
  const year = q === 'Q4' ? start + 1 : start;
  return { from: `${year}-${from}`, to: `${year}-${to}` };
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const num = (v) => parseFloat(v) || 0;
const blank = () => ({
  date: localToday(), voucherNo: '', supplierName: '', amount: '', discount: '', tds: '', tdsSection: '', tdsAlt: false,
  mode: 'Bank Transfer', reference: '', chequeDate: '', note: '', manual: false, allocations: {}, attachment: null,
});

export default function PaymentVoucher({ direction = 'out' }) {
  const [vouchers, setVouchers] = useState([]);
  const [bills, setBills] = useState([]);
  const [debitNotes, setDebitNotes] = useState([]);
  const [profile, setProfile] = useState({});
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showTds, setShowTds] = useState(false);
  const [quarter, setQuarter] = useState(() => quarterOf(localToday()));

  const load = async () => {
    try {
      const [v, b, d, prof] = await Promise.all([getAllPaymentsOut(), getAllPurchases(), getAllDebitNotes(), getProfile()]);
      setVouchers((v || []).filter((r) => belongsToProfile(r, prof)));
      setBills((b || []).filter((r) => belongsToProfile(r, prof)));
      setDebitNotes((d || []).filter((r) => belongsToProfile(r, prof)));
      setProfile(prof || {});
    } catch {
      toast('Failed to load payments', 'error');
    }
  };
  useEffect(() => { load(); }, []);

  const suppliers = useMemo(() => [...new Set(bills.map((b) => (b.supplierName || '').trim()).filter(Boolean))].sort(), [bills]);
  const open = form ? openBillsFor(bills.map((b) => ({ ...b, payments: (b.payments || []).filter((p) => !(form.id && p.voucherId === form.id)) })), form.supplierName, debitNotes) : [];
  const voucher = form ? { ...form, amount: num(form.amount), discount: num(form.discount), tds: num(form.tds) } : null;
  const manual = form?.manual ? Object.fromEntries(Object.entries(form.allocations).map(([k, v]) => [k, num(v)])) : undefined;
  const plan = form ? applyPaymentOut({
    bills: bills.map((b) => ({ ...b, payments: (b.payments || []).filter((p) => !(form.id && p.voucherId === form.id)) })),
    voucher, manual, debitNotes,
  }) : null;
  const tds = form ? tdsSuggestion({ vouchers, voucher }) : null;
  const cashWarn = form ? cashOutWarning({ vouchers, voucher }) : null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const startNew = async () => {
    const f = blank();
    try { f.voucherNo = await getNextInvoiceNumber('PAY', { peek: true, businessKey: businessKeyOf(profile) }); } catch { /* typed on save */ }
    setForm(f);
  };

  const save = async () => {
    if (!form.supplierName.trim()) { toast('Pick the supplier', 'warning'); return; }
    if (!(voucher.amount > 0)) { toast('Enter the amount paid', 'warning'); return; }
    if (form.mode === 'Cheque' && !form.chequeDate) { toast('A cheque needs its date', 'warning'); return; }
    if (!plan.ok) { toast(plan.errors[0], 'warning'); return; }
    if (cashWarn && !(await confirmAction({
      title: 'Cash payment over ₹10,000',
      message: `Cash paid to ${form.supplierName} on ${form.date} reaches ${formatCurrency(cashWarn.total)}. Under section 40A(3) a cash expense above ₹10,000 to one person in a day is not deductible. Save anyway?`,
      confirmLabel: 'Save anyway', cancelLabel: 'Go back', tone: 'warning',
    }))) return;
    setSaving(true);
    try {
      let voucherNo = form.voucherNo;
      if (!form.id) {
        try { voucherNo = await getNextInvoiceNumber('PAY', { businessKey: businessKeyOf(profile) }); } catch { /* keep the peeked one */ }
      }
      const saved = await saveReceipt({
        ...(form.id ? { id: form.id } : {}),
        direction: 'out',
        voucherNo,
        date: form.date,
        supplierName: form.supplierName.trim(),
        amount: voucher.amount,
        discount: voucher.discount,
        tds: voucher.tds,
        tdsSection: form.tdsSection || '',
        tdsAlt: !!form.tdsAlt,
        mode: form.mode,
        reference: form.reference.trim(),
        chequeDate: form.mode === 'Cheque' ? form.chequeDate : '',
        note: form.note.trim(),
        attachment: form.attachment || null,
        allocations: plan.allocations.map((a) => ({ purchaseId: a.docId, amount: a.amount })),
        advance: plan.advance,
        ownerGstin: profile?.gstin || '',
        ownerName: profile?.businessName || '',
      });
      // Bills it no longer pays are released, then the bills it pays carry its entry.
      const finalPlan = applyPaymentOut({
        bills: bills.map((b) => ({ ...b, payments: (b.payments || []).filter((p) => p.voucherId !== saved.id) })),
        voucher: { ...voucher, id: saved.id, voucherNo }, manual, debitNotes,
      });
      const touched = new Map(releasePaymentOut(bills, saved.id, debitNotes).map((b) => [b.id, b]));
      for (const b of finalPlan.updated) touched.set(b.id, b);
      await Promise.all([...touched.values()].map((b) => savePurchase(b)));
      toast(`Payment ${voucherNo || ''} saved`.trim(), 'success');
      setForm(null);
      load();
    } catch {
      toast('Failed to save the payment', 'error');
    } finally {
      setSaving(false);
    }
  };

  // P10-S5: a challan is kept on the document the TDS came from (a voucher, or a bill with §194Q TDS).
  const markDeposited = async (row, challan) => {
    try {
      if (row.kind === 'voucher') await saveReceipt({ ...vouchers.find((v) => v.id === row.id), tdsChallan: challan });
      else await savePurchase({ ...bills.find((b) => b.id === row.id), tdsChallan: challan });
      toast('TDS marked deposited', 'success');
      load();
    } catch {
      toast('Could not save the challan', 'error');
    }
  };

  const remove = async (v) => {
    if (!(await confirmAction({
      title: 'Delete payment?',
      message: `Payment ${v.voucherNo || ''} of ${formatCurrency(v.amount)} to ${v.supplierName} will be removed and the bills it paid reopened. Its TDS goes with it.`,
      confirmLabel: 'Delete', tone: 'danger',
    }))) return;
    try {
      await Promise.all(releasePaymentOut(bills, v.id, debitNotes).map((b) => savePurchase(b)));
      await deleteReceipt(v.id);
      toast('Payment deleted', 'success');
      load();
    } catch {
      toast('Failed to delete', 'error');
    }
  };

  const edit = (v) => setForm({
    ...blank(), ...v,
    amount: String(v.amount ?? ''), discount: v.discount ? String(v.discount) : '', tds: v.tds ? String(v.tds) : '',
    manual: true,
    allocations: Object.fromEntries((v.allocations || []).map((a) => [a.purchaseId, String(a.amount)])),
  });

  const shown = vouchers.filter((v) => {
    const q = search.trim().toLowerCase();
    return !q || [v.supplierName, v.voucherNo, v.reference].some((x) => String(x || '').toLowerCase().includes(q));
  });
  const totalPaid = shown.reduce((s, v) => s + num(v.amount), 0);
  const totalTds = shown.reduce((s, v) => s + num(v.tds), 0);

  if (direction !== 'out') return null;

  return (
    <div className="dashboard-container">
      <div className="page-header">
        <div>
          <h1 className="page-title"><ArrowUpRight size={22} /> Payment Out</h1>
          <p className="page-subtitle">Money paid to suppliers, applied to their purchase bills</p>
        </div>
        <div className="flex gap-2 items-center">
          <HelpButton title="Payment Out — how to use">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Link to bills</strong> — the payment pays the supplier's oldest bills first; switch to manual to choose.</li>
              <li><strong>TDS deducted</strong> — pick the section; the suggested amount follows the year's thresholds. TDS and any discount received settle bills like money.</li>
              <li><strong>Cash</strong> — over ₹10,000 to one supplier in a day is flagged (section 40A(3)).</li>
              <li><strong>Deleting</strong> a payment reopens the bills it paid.</li>
            </ul>
          </HelpButton>
          <button className="btn btn-primary" onClick={startNew}><Plus size={16} /> Add Payment Out</button>
        </div>
      </div>

      <div className="stats-grid mb-6">
        <div className="stat-card"><div><p className="stat-label">Paid</p><h2 className="stat-value">{formatCurrency(totalPaid)}</h2></div></div>
        <div className="stat-card"><div><p className="stat-label">TDS deducted</p><h2 className="stat-value">{formatCurrency(totalTds)}</h2></div></div>
        <div className="stat-card"><div><p className="stat-label">Vouchers</p><h2 className="stat-value">{shown.length}</h2></div></div>
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }} onClick={() => setShowTds((v) => !v)}>
          {showTds ? 'Hide' : 'Show'} TDS register
        </button>
      </div>
      {showTds && <TdsRegisterPanel vouchers={vouchers} bills={bills} quarter={quarter} onQuarter={setQuarter} onDeposit={markDeposited} />}

      <div className="glass-panel p-4 mb-6">
        <div className="search-box">
          <Search size={16} />
          <input className="search-input" placeholder="Search supplier, voucher or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="glass-panel">
        {shown.length === 0 ? (
          <EmptyState title="No payments out yet" hint="Record what you pay suppliers and it settles their purchase bills." action={<button className="btn btn-primary" onClick={startNew}><Plus size={16} /> Add Payment Out</button>} />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Voucher</th><th>Supplier</th><th>Mode</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>TDS</th><th>Bills</th><th /></tr></thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.id}>
                    <td>{v.date}</td>
                    <td><button type="button" className="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }} onClick={() => edit(v)}>{v.voucherNo || '—'}</button></td>
                    <td>{v.supplierName}</td>
                    <td>{v.mode}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(v.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{v.tds ? `${formatCurrency(v.tds)} §${v.tdsSection}` : '—'}</td>
                    <td>{(v.allocations || []).length ? `${v.allocations.length} bill${v.allocations.length > 1 ? 's' : ''}` : <StatusChip tone="info">Advance</StatusChip>}</td>
                    <td><button className="icon-btn icon-btn-red" onClick={() => remove(v)} aria-label={`Delete ${v.voucherNo}`}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820 }} role="dialog" aria-label="Payment Out">
            <h3 className="section-title">{form.id ? `Payment ${form.voucherNo}` : 'Payment Out'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Supplier *</label>
                <input className="form-input" list="pout-suppliers" value={form.supplierName} autoComplete="off"
                  onChange={(e) => set({ supplierName: e.target.value, allocations: {} })} placeholder="Supplier name" />
                <datalist id="pout-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
                {form.supplierName && <span className="field-hint">To pay {formatCurrency(open.reduce((s, o) => s + o.pending, 0))} on {open.length} bill{open.length === 1 ? '' : 's'}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Voucher No</label>
                <input className="form-input" value={form.voucherNo} onChange={(e) => set({ voucherNo: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={form.date} onChange={(e) => set({ date: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Mode</label>
                <select className="form-input" value={form.mode} onChange={(e) => set({ mode: e.target.value })}>
                  {MODES.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Reference</label>
                <input className="form-input" value={form.reference} onChange={(e) => set({ reference: e.target.value })} placeholder={form.mode === 'Cheque' ? 'Cheque no.' : 'UTR / ref'} />
              </div>
              {form.mode === 'Cheque' ? (
                <div className="form-group">
                  <label className="form-label">Cheque date *</label>
                  <input type="date" className="form-input" value={form.chequeDate} onChange={(e) => set({ chequeDate: e.target.value })} />
                </div>
              ) : <div />}
              <div className="form-group">
                <label className="form-label">Amount paid *</label>
                <input type="number" min="0" step="any" className="form-input" value={form.amount} onFocus={(e) => e.target.select()} onChange={(e) => set({ amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Discount received</label>
                <input type="number" min="0" step="any" className="form-input" value={form.discount} onFocus={(e) => e.target.select()} onChange={(e) => set({ discount: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">TDS section</label>
                <select className="form-input" value={form.tdsSection} onChange={(e) => set({ tdsSection: e.target.value })}>
                  <option value="">No TDS</option>
                  {Object.entries(TDS_DEDUCTION_SECTIONS).map(([k, s]) => <option key={k} value={k}>{k} — {s.label}</option>)}
                </select>
                {TDS_DEDUCTION_SECTIONS[form.tdsSection]?.rateAltLabel && (
                  <label className="field-hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={!!form.tdsAlt} onChange={(e) => set({ tdsAlt: e.target.checked })} />
                    {TDS_DEDUCTION_SECTIONS[form.tdsSection].rateAltLabel} ({TDS_DEDUCTION_SECTIONS[form.tdsSection].rateAlt}%)
                  </label>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">TDS deducted</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" min="0" step="any" className="form-input" value={form.tds} disabled={!form.tdsSection}
                    onFocus={(e) => e.target.select()} onChange={(e) => set({ tds: e.target.value })} />
                  {tds && (
                    <button type="button" className="btn btn-secondary" title="Use the suggested amount" disabled={!form.tdsSection}
                      onClick={() => set({ tds: String(tds.tds) })}><Wand2 size={14} /></button>
                  )}
                </div>
                {tds && (
                  <span className="field-hint">
                    {tds.applies
                      ? `Suggested ${formatCurrency(tds.tds)} at ${tds.rate}% on ${formatCurrency(tds.taxableBase)}${tds.reason === 'crosses_aggregate' ? ' (this payment crosses the yearly limit, so earlier ones count too)' : ''}`
                      : 'Under the threshold so far this year: no TDS due'}
                  </span>
                )}
              </div>
            </div>

            {cashWarn && (
              <p className="notice notice-warn" role="alert">⚠ Cash payment to {form.supplierName} today would reach {formatCurrency(cashWarn.total)}, over ₹10,000 (section 40A(3)).</p>
            )}

            <div className="glass-panel p-4" style={{ marginTop: '0.75rem' }}>
              <div className="flex justify-between items-center" style={{ marginBottom: '0.5rem' }}>
                <strong>Link to bills</strong>
                <label className="field-hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.manual} onChange={(e) => set({ manual: e.target.checked, allocations: e.target.checked ? Object.fromEntries(plan.allocations.map((a) => [a.docId, String(a.amount)])) : {} })} />
                  Choose amounts myself
                </label>
              </div>
              {open.length === 0 ? (
                <p className="field-hint">{form.supplierName ? 'Nothing pending for this supplier: the payment is kept as an advance.' : 'Pick a supplier to see their bills.'}</p>
              ) : (
                <div className="table-scroll">
                <table className="data-table" style={{ minWidth: 0, width: '100%' }}>
                  <thead><tr><th>Bill</th><th>Date</th><th style={{ textAlign: 'right' }}>Pending</th><th style={{ textAlign: 'right' }}>Settle</th></tr></thead>
                  <tbody>
                    {open.map(({ bill, pending }) => {
                      const a = plan.allocations.find((x) => x.docId === bill.id);
                      return (
                        <tr key={bill.id}>
                          <td>{bill.invoiceNumber}{bill.number ? ` · ${bill.number}` : ''}</td>
                          <td>{bill.date}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(pending)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {form.manual ? (
                              <input type="number" min="0" step="any" className="form-input" style={{ width: 120, marginLeft: 'auto' }}
                                value={form.allocations[bill.id] ?? ''} aria-label={`Settle ${bill.invoiceNumber}`}
                                onChange={(e) => set({ allocations: { ...form.allocations, [bill.id]: e.target.value } })} />
                            ) : formatCurrency(a?.amount || 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
              <p className="field-hint" style={{ marginTop: '0.5rem' }}>
                Settles {formatCurrency(plan.settled)} (paid + discount + TDS) · applied {formatCurrency(plan.allocated)}
                {plan.advance > 0 ? ` · ${formatCurrency(plan.advance)} kept as advance` : ''}
              </p>
              {!plan.ok && <p className="ui-error" role="alert">{plan.errors[0]}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input className="form-input" value={form.note} onChange={(e) => set({ note: e.target.value })} />
              </div>
              <AttachmentField label="Attach" value={form.attachment} onChange={(v) => set({ attachment: v })} />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !plan.ok}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// P10-S5: TDS payable, per payment, with due dates, late-deposit interest, the PAN flag and challan entry; CSV for the
// quarter's TDS return (P3-S2 acceptance 2).
function TdsRegisterPanel({ vouchers, bills, quarter, onQuarter, onDeposit }) {
  const range = quarterRange(quarter);
  const reg = tdsPayableRows(vouchers, bills, { ...range, asOf: localToday() });
  const [paying, setPaying] = useState(null);
  const [challan, setChallan] = useState({ no: '', bsr: '', date: localToday() });
  const download = () => {
    const lines = [['Deductee', 'PAN', 'Section', 'Nature', 'Date', 'Voucher', 'Amount paid', 'TDS', 'Due date', 'Status', 'Challan', 'BSR', 'Challan date', 'Interest to date'],
      ...reg.rows.map((r) => [r.deductee, r.pan, r.section, r.nature, r.date, r.voucherNo, r.paid.toFixed(2), r.tds.toFixed(2), r.dueDate, r.status, r.challan?.no || '', r.challan?.bsr || '', r.challan?.date || '', r.status === 'accrued' ? r.interest.toFixed(2) : '0.00'])];
    const blob = new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `TDS-payable-${quarter.fy}-${quarter.q}.csv`;
    a.click();
  };
  const save = () => {
    if (!challan.no.trim()) { toast('Enter the challan serial number', 'warning'); return; }
    if (!/^\d{7}$/.test(challan.bsr.trim())) { toast('The BSR code is 7 digits', 'warning'); return; }
    onDeposit(paying, { no: challan.no.trim(), bsr: challan.bsr.trim(), date: challan.date });
    setPaying(null);
  };
  return (
    <div className="glass-panel p-4 mb-6">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <strong style={{ marginRight: 'auto' }}>TDS payable · {quarter.fy} {quarter.q} ({range.from} to {range.to})</strong>
        <select className="filter-select" value={quarter.q} onChange={(e) => onQuarter({ ...quarter, q: e.target.value })} aria-label="Quarter">
          {QUARTERS.map(([q]) => <option key={q}>{q}</option>)}
        </select>
        <input className="filter-select" style={{ width: 100 }} value={quarter.fy} onChange={(e) => onQuarter({ ...quarter, fy: e.target.value })} aria-label="Financial year" />
        <button type="button" className="btn btn-secondary" onClick={download} disabled={!reg.rows.length}>CSV</button>
      </div>
      {reg.rows.length === 0 ? (
        <p className="field-hint">No TDS deducted in this quarter.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table" style={{ minWidth: 0, width: '100%' }}>
            <thead><tr><th>Deductee</th><th>PAN</th><th>Section</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>TDS</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {reg.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.deductee}<span className="field-hint" style={{ display: 'block' }}>{r.voucherNo} · {r.date}</span></td>
                  <td>{r.pan || <span style={{ color: '#d97706', fontWeight: 600 }} title="Without a PAN, TDS is deducted at a higher rate (up to 20%)">PAN missing</span>}</td>
                  <td>{r.section}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.paid)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.tds)}</td>
                  <td style={{ color: r.status === 'accrued' && r.overdue ? '#dc2626' : undefined }}>
                    {r.dueDate}
                    {r.status === 'accrued' && r.overdue && <span className="field-hint" style={{ display: 'block', color: '#dc2626' }}>Overdue · interest {formatCurrency(r.interest)}</span>}
                  </td>
                  <td>
                    {r.status === 'deposited'
                      ? <span title={`BSR ${r.challan.bsr}, ${r.challan.date}`}>Deposited · {r.challan.no}</span>
                      : <button type="button" className="btn btn-secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem' }} onClick={() => { setPaying(r); setChallan({ no: '', bsr: '', date: localToday() }); }}>Mark deposited</button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}><strong>Total TDS</strong> (deposited {formatCurrency(reg.deposited)} · pending {formatCurrency(reg.pending)}{reg.interest > 0 ? ` · interest to date ${formatCurrency(reg.interest)}` : ''})</td><td style={{ textAlign: 'right' }}><strong>{formatCurrency(reg.total)}</strong></td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      )}
      {paying && (
        <div className="glass-panel p-4" style={{ marginTop: '0.75rem' }}>
          <strong>Challan for {paying.deductee} · {formatCurrency(paying.tds)}</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0.5rem 0' }}>
            <input className="form-input" style={{ width: 160 }} placeholder="Challan serial no." value={challan.no} onChange={(e) => setChallan({ ...challan, no: e.target.value })} aria-label="Challan serial number" />
            <input className="form-input" style={{ width: 140 }} placeholder="BSR code (7 digits)" maxLength={7} value={challan.bsr} onChange={(e) => setChallan({ ...challan, bsr: e.target.value.replace(/\D/g, '') })} aria-label="BSR code" />
            <input type="date" className="form-input" style={{ width: 160 }} value={challan.date} onChange={(e) => setChallan({ ...challan, date: e.target.value })} aria-label="Challan date" />
            <button type="button" className="btn btn-primary" onClick={save}>Save</button>
            <button type="button" className="btn btn-secondary" onClick={() => setPaying(null)}>Cancel</button>
          </div>
        </div>
      )}
      <p className="field-hint" style={{ marginTop: '0.5rem' }}>Due on the 7th of the next month (30 April for March). Late deposit costs 1.5% a month or part of a month (section 201(1A)). From tax year 2026-27 these sections sit in section 393 of the Income-tax Act, 2025; rates and thresholds are unchanged.</p>
    </div>
  );
}
