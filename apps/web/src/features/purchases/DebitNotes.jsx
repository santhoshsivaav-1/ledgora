import { useEffect, useMemo, useState } from 'react';
import { Undo2, Plus, Search, Trash2, FileDown } from 'lucide-react';
import { DEBIT_NOTE_REASONS, debitNoteItcReversal, overReturns } from '@ledgora/tax-engine';
import { deletePurchase, getAllDebitNotes, getAllProducts, getAllPurchases, getNextInvoiceNumber, getProfile, saveProduct, savePurchase } from '../../lib/data';
import { belongsToProfile, businessKeyOf, formatCurrency, localToday, roundQty } from '../../utils';
import LinesGrid, { blankLine } from '../../components/ui/LinesGrid';
import { EmptyState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import HelpButton from '../../components/ui/HelpButton';
import { purchaseDocPdf } from './purchasePdf';
import { debitNoteMovesStock, gridLineAmount, gridToItems, itemsToGrid, purchaseFormTotals, purchaseStatus, returnableOf } from './purchaseExtras';

// Vyapar parity P3-S4: purchase returns / debit notes. Kept in the purchases collection with docType 'debit-note'.
// A return of goods takes stock back out; every note takes back the input tax credit claimed on what it covers
// (GSTR-3B 4(B)(2), gstReturnTables.itcTable4); settled by adjusting what we owe on the bill, or as a refund.

const REASON_LABELS = {
  'purchase-return': 'Purchase return',
  'rate-difference': 'Rate difference',
  quality: 'Quality issue',
  other: 'Other',
};
const REFUNDS = [
  { value: 'adjust', label: 'Adjust payable' },
  { value: 'cash', label: 'Cash refund' },
  { value: 'bank', label: 'Bank refund' },
];
const lineKey = (l) => (l.itemId || l.productId ? `id:${l.itemId || l.productId}` : `nm:${String(l.name || '').trim().toLowerCase()}`);
const blank = () => ({ number: '', date: localToday(), supplierName: '', againstPurchaseId: '', reason: 'purchase-return', refundMode: 'adjust', lines: [blankLine()], note: '' });

/** Moves each line's quantity in or out of its product's stock (matched by product id, then name). */
async function moveProductStock(items, sign) {
  const products = await getAllProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const byName = new Map(products.map((p) => [String(p.name || '').trim().toLowerCase(), p]));
  const delta = new Map();
  for (const it of items) {
    const p = (it.productId && byId.get(it.productId)) || byName.get(String(it.name || '').trim().toLowerCase());
    if (p) delta.set(p.id, (delta.get(p.id) || 0) + sign * (Number(it.quantity) || 0));
  }
  await Promise.all([...delta].map(([id, d]) => {
    const p = byId.get(id);
    return saveProduct({ ...p, stock: roundQty((Number(p.stock) || 0) + d) });
  }));
}

export default function DebitNotes() {
  const [notes, setNotes] = useState([]);
  const [bills, setBills] = useState([]);
  const [profile, setProfile] = useState({});
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [n, b, prof] = await Promise.all([getAllDebitNotes(), getAllPurchases(), getProfile()]);
      setNotes((n || []).filter((r) => belongsToProfile(r, prof)));
      setBills((b || []).filter((r) => belongsToProfile(r, prof)));
      setProfile(prof || {});
    } catch {
      toast('Failed to load debit notes', 'error');
    }
  };
  useEffect(() => { load(); }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const suppliers = useMemo(() => [...new Set(bills.map((b) => (b.supplierName || '').trim()).filter(Boolean))].sort(), [bills]);
  const supplierBills = form ? bills.filter((b) => String(b.supplierName || '').trim().toLowerCase() === form.supplierName.trim().toLowerCase()) : [];
  const bill = form?.againstPurchaseId ? bills.find((b) => b.id === form.againstPurchaseId) : null;
  const left = bill ? returnableOf(bill, notes.filter((n) => n.id !== form.id)) : null;
  const items = form ? gridToItems(form.lines) : [];
  const over = bill && debitNoteMovesStock(form.reason) ? overReturns(items, left) : [];
  const reversal = form ? debitNoteItcReversal(items, { billLines: bill?.items, interstate: !!bill?.interstate }) : null;

  const startNew = async () => {
    const f = blank();
    try { f.number = await getNextInvoiceNumber('DN', { peek: true, businessKey: businessKeyOf(profile) }); } catch { /* given on save */ }
    setForm(f);
  };

  // Picking a bill fills the lines with what is still returnable on it, quantities at the full returnable amount.
  const pickBill = (id) => {
    const b = bills.find((x) => x.id === id);
    if (!b) { set({ againstPurchaseId: '', lines: [blankLine()] }); return; }
    const remaining = returnableOf(b, notes.filter((n) => n.id !== form.id));
    const lines = (b.items || [])
      .map((l) => ({ ...l, quantity: remaining[lineKey(l)] ?? 0 }))
      .filter((l) => l.quantity > 0);
    set({ againstPurchaseId: id, lines: lines.length ? itemsToGrid(lines) : [blankLine()] });
  };

  const save = async () => {
    if (!form.supplierName.trim()) { toast('Pick the supplier', 'warning'); return; }
    if (!items.some((i) => i.quantity > 0 && i.rate > 0)) { toast('Add what goes back', 'warning'); return; }
    if (over.length) { toast(`More than is left to return: ${over.map((o) => `${o.name} (${o.returnable} left)`).join(', ')}`, 'warning'); return; }
    if (!bill && !(await confirmAction({
      title: 'No bill linked',
      message: 'This debit note is not against a purchase bill, so the quantities cannot be checked. Save anyway?',
      confirmLabel: 'Save', tone: 'warning',
    }))) return;
    setSaving(true);
    try {
      const prior = form.id ? notes.find((n) => n.id === form.id) : null;
      let number = form.number;
      if (!form.id) {
        try { number = await getNextInvoiceNumber('DN', { businessKey: businessKeyOf(profile) }); } catch { /* keep the peeked one */ }
      }
      const t = purchaseFormTotals(items);
      const doc = {
        ...(form.id ? { id: form.id } : {}),
        docType: 'debit-note',
        number,
        invoiceNumber: number,
        date: form.date,
        supplierName: form.supplierName.trim(),
        supplierGstin: bill?.supplierGstin || prior?.supplierGstin || '',
        againstPurchaseId: bill?.id || '',
        againstNumber: bill?.invoiceNumber || '',
        reason: form.reason,
        refundMode: form.refundMode,
        interstate: !!bill?.interstate,
        items,
        taxableAmount: t.taxable,
        totalTax: t.tax,
        totalAmount: t.finalTotal,
        note: (form.note || '').trim(),
        ownerGstin: profile?.gstin || '',
        ownerName: profile?.businessName || '',
      };
      // Stock: undo what the saved version took out, then take out what this one returns.
      if (prior && debitNoteMovesStock(prior.reason)) await moveProductStock(prior.items || [], +1);
      if (debitNoteMovesStock(form.reason)) await moveProductStock(items, -1);
      const saved = await savePurchase(doc);
      // Settled by adjustment, the note lowers what is due on its bill: the bill's status follows.
      const touched = new Set([bill?.id, prior?.againstPurchaseId].filter(Boolean));
      const allNotes = [...notes.filter((n) => n.id !== saved.id), saved];
      await Promise.all([...touched].map((id) => {
        const b = bills.find((x) => x.id === id);
        return b ? savePurchase({ ...b, paymentStatus: purchaseStatus(b, allNotes) }) : null;
      }));
      toast(`Debit note ${number} saved`, 'success');
      setForm(null);
      load();
    } catch {
      toast('Failed to save the debit note', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n) => {
    if (!(await confirmAction({ title: `Delete ${n.number}?`, message: 'Returned stock comes back and the bill owes the full amount again.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      if (debitNoteMovesStock(n.reason)) await moveProductStock(n.items || [], +1);
      await deletePurchase(n.id);
      const b = bills.find((x) => x.id === n.againstPurchaseId);
      if (b) await savePurchase({ ...b, paymentStatus: purchaseStatus(b, notes.filter((x) => x.id !== n.id)) });
      load();
    } catch {
      toast('Failed to delete', 'error');
    }
  };

  const shown = notes.filter((n) => {
    const q = search.trim().toLowerCase();
    return !q || [n.number, n.supplierName, n.againstNumber].some((x) => String(x || '').toLowerCase().includes(q));
  });

  return (
    <div className="dashboard-container">
      <div className="page-header">
        <div>
          <h1 className="page-title"><Undo2 size={22} /> Purchase Return / Debit Note</h1>
          <p className="page-subtitle">Goods sent back and price corrections from suppliers. Input tax credit is reversed (GSTR-3B 4(B)(2)).</p>
        </div>
        <div className="flex gap-2 items-center">
          <HelpButton title="Debit notes — how to use">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Against bill</strong> fills the lines with what is still returnable; you cannot return more than you bought less earlier returns.</li>
              <li><strong>Rate difference</strong> moves no stock; only the value and its GST are corrected.</li>
              <li><strong>Adjust payable</strong> lowers what you owe on the bill; a cash or bank refund is money the supplier pays back.</li>
            </ul>
          </HelpButton>
          <button className="btn btn-primary" onClick={startNew}><Plus size={16} /> Add Debit Note</button>
        </div>
      </div>

      <div className="glass-panel p-4 mb-6">
        <div className="search-box">
          <Search size={16} />
          <input className="search-input" placeholder="Search DN no, supplier or bill" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="glass-panel">
        {shown.length === 0 ? (
          <EmptyState title="No debit notes yet" hint="Record goods you send back to a supplier." action={<button className="btn btn-primary" onClick={startNew}><Plus size={16} /> Add Debit Note</button>} />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>DN No</th><th>Date</th><th>Supplier</th><th>Against bill</th><th>Reason</th><th>Settled by</th><th style={{ textAlign: 'right' }}>Total</th><th /></tr></thead>
              <tbody>
                {shown.map((n) => (
                  <tr key={n.id}>
                    <td><button type="button" className="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }} onClick={() => setForm({ ...blank(), ...n, lines: itemsToGrid(n.items) })}>{n.number}</button></td>
                    <td>{n.date}</td>
                    <td>{n.supplierName}</td>
                    <td>{n.againstNumber || '—'}</td>
                    <td>{REASON_LABELS[n.reason] || n.reason}</td>
                    <td>{REFUNDS.find((r) => r.value === n.refundMode)?.label || 'Adjust payable'}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(n.totalAmount)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" title="Download PDF" aria-label={`PDF of ${n.number}`} onClick={() => purchaseDocPdf(n, { title: 'DEBIT NOTE' })}><FileDown size={15} /></button>
                      <button className="icon-btn icon-btn-red" aria-label={`Delete ${n.number}`} onClick={() => remove(n)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 920 }} role="dialog" aria-label="Debit note">
            <h3 className="section-title">{form.id ? `Debit Note ${form.number}` : 'Debit Note / Purchase Return'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Supplier *</label>
                <input className="form-input" list="dn-suppliers" value={form.supplierName} autoComplete="off"
                  onChange={(e) => set({ supplierName: e.target.value, againstPurchaseId: '' })} />
                <datalist id="dn-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="form-group">
                <label className="form-label">Return No</label>
                <input className="form-input" value={form.number} onChange={(e) => set({ number: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={form.date} onChange={(e) => set({ date: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Against bill</label>
                <select className="form-input" value={form.againstPurchaseId} onChange={(e) => pickBill(e.target.value)} disabled={!supplierBills.length}>
                  <option value="">{supplierBills.length ? 'Not linked to a bill' : 'No bills for this supplier'}</option>
                  {supplierBills.map((b) => <option key={b.id} value={b.id}>{b.invoiceNumber} · {b.date} · {formatCurrency(b.totalAmount)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Reason</label>
                <select className="form-input" value={form.reason} onChange={(e) => set({ reason: e.target.value })}>
                  {DEBIT_NOTE_REASONS.map((r) => <option key={r} value={r}>{REASON_LABELS[r]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Refund</label>
                <select className="form-input" value={form.refundMode} onChange={(e) => set({ refundMode: e.target.value })}>
                  {REFUNDS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            {!bill && form.supplierName && <p className="notice notice-warn">Not linked to a bill: pick the items yourself. Quantities cannot be checked against what you bought.</p>}
            {bill && debitNoteMovesStock(form.reason) && (
              <p className="field-hint">Returnable: {(bill.items || []).map((l) => `${l.name} ${left[lineKey(l)] ?? 0} of ${l.quantity}`).join(' · ')}</p>
            )}
            <LinesGrid docType="return" lines={form.lines} onChange={(lines) => set({ lines })} amountOf={gridLineAmount} />
            {over.length > 0 && <p className="ui-error" role="alert">More than is left to return: {over.map((o) => `${o.name} (${o.returnable} left)`).join(', ')}</p>}
            {reversal && (
              <p style={{ textAlign: 'right', margin: '0.5rem 0 0' }}>
                Taxable {formatCurrency(reversal.value)} · ITC reversed {formatCurrency(reversal.reversal.igst + reversal.reversal.cgst + reversal.reversal.sgst)} · Total <strong>{formatCurrency(purchaseFormTotals(items).finalTotal)}</strong>
              </p>
            )}
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label className="form-label">Note</label>
              <input className="form-input" value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || over.length > 0}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
