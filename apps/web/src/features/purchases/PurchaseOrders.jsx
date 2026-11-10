import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ClipboardList, Plus, Search, Trash2, PackageCheck, Ban, FileDown } from 'lucide-react';
import { deletePurchase, getAllPurchaseOrders, getAllPurchases, getNextInvoiceNumber, getProfile, savePurchase } from '../../lib/data';
import { belongsToProfile, businessKeyOf, formatCurrency, localToday } from '../../utils';
import { pathForView } from '../../app/router';
import LinesGrid, { blankLine } from '../../components/ui/LinesGrid';
import { StatusChip } from '../../components/ui/Display';
import { EmptyState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import HelpButton from '../../components/ui/HelpButton';
import { purchaseDocPdf } from './purchasePdf';
import { PURCHASE_PREFILL_KEY, billPrefillFromOrder, gridLineAmount, gridToItems, itemsToGrid, orderProgress, purchaseFormTotals } from './purchaseExtras';

// Vyapar parity P3-S3: purchase orders. An order moves no stock and is in no GST return. Goods arrive on a purchase
// bill: "Receive goods" opens Add Purchase filled with what is still pending, and the bill's save checks it does not
// take more than that. Orders are kept in the purchases collection with docType 'order'.

const STATUS = {
  open: { label: 'Open', tone: 'info' },
  partial: { label: 'Partial', tone: 'warning' },
  received: { label: 'Received', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
const blank = () => ({ number: '', date: localToday(), expectedDate: '', supplierName: '', supplierGstin: '', interstate: false, lines: [blankLine()], notes: '', advance: '', advanceMode: 'Bank Transfer' });

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [bills, setBills] = useState([]);
  const [profile, setProfile] = useState({});
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);

  const load = async () => {
    try {
      const [o, b, prof] = await Promise.all([getAllPurchaseOrders(), getAllPurchases(), getProfile()]);
      setOrders((o || []).filter((r) => belongsToProfile(r, prof)));
      setBills((b || []).filter((r) => belongsToProfile(r, prof)));
      setProfile(prof || {});
    } catch {
      toast('Failed to load purchase orders', 'error');
    }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => orders.map((o) => {
    const p = orderProgress(o, bills);
    const pendingValue = (o.items || []).reduce((s, l, i) => s + (p.lines[i]?.pending || 0) * (Number(l.rate) || 0), 0);
    return { order: o, status: p.status, pendingValue };
  }), [orders, bills]);
  const shown = rows.filter(({ order, status }) => {
    if (statusFilter && status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || [order.number, order.supplierName].some((x) => String(x || '').toLowerCase().includes(q));
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const startNew = async () => {
    const f = blank();
    try { f.number = await getNextInvoiceNumber('PO', { peek: true, businessKey: businessKeyOf(profile) }); } catch { /* given on save */ }
    setForm(f);
  };
  const edit = (o) => setForm({ ...blank(), ...o, advance: o.advance ? String(o.advance) : '', lines: itemsToGrid(o.items) });

  const save = async () => {
    const items = gridToItems(form.lines);
    if (!form.supplierName.trim()) { toast('Pick the supplier', 'warning'); return; }
    if (!items.some((i) => i.quantity > 0)) { toast('Add at least one item with a quantity', 'warning'); return; }
    const editing = form.id ? orders.find((o) => o.id === form.id) : null;
    if (editing) {
      // Lines already received can not drop below what came in.
      const p = orderProgress({ ...editing, items }, bills);
      const short = p.lines.find((l) => l.ordered < l.received);
      if (short) { toast(`${short.name}: ${short.received} already received`, 'warning'); return; }
    }
    try {
      let number = form.number;
      if (!form.id) {
        try { number = await getNextInvoiceNumber('PO', { businessKey: businessKeyOf(profile) }); } catch { /* keep the peeked one */ }
      }
      const t = purchaseFormTotals(items, { charges: form.charges });
      await savePurchase({
        ...(form.id ? { id: form.id } : {}),
        docType: 'order',
        number,
        date: form.date,
        expectedDate: form.expectedDate || '',
        supplierName: form.supplierName.trim(),
        supplierGstin: (form.supplierGstin || '').trim(),
        interstate: !!form.interstate,
        items,
        charges: form.charges || [],
        notes: (form.notes || '').trim(),
        advance: parseFloat(form.advance) || 0,
        advanceMode: form.advanceMode,
        status: editing?.status === 'cancelled' ? 'cancelled' : 'open',
        taxableAmount: t.taxable,
        totalAmount: t.finalTotal,
        ownerGstin: profile?.gstin || '',
        ownerName: profile?.businessName || '',
      });
      toast(`Purchase order ${number} saved`, 'success');
      setForm(null);
      load();
    } catch {
      toast('Failed to save the order', 'error');
    }
  };

  const receive = (o) => {
    const prefill = billPrefillFromOrder(o, bills);
    if (!prefill.items.length) { toast('Everything on this order has been received', 'info'); return; }
    try { sessionStorage.setItem(PURCHASE_PREFILL_KEY, JSON.stringify(prefill)); } catch { /* private mode: no prefill */ }
    navigate(pathForView('purchases'));
  };

  const cancel = async (o) => {
    if (!(await confirmAction({
      title: `Cancel ${o.number}?`,
      message: o.advance > 0
        ? `Nothing more can be received against it. The advance of ${formatCurrency(o.advance)} stays with ${o.supplierName} as your advance.`
        : 'Nothing more can be received against it.',
      confirmLabel: 'Cancel order', tone: 'warning',
    }))) return;
    await savePurchase({ ...o, status: 'cancelled' });
    load();
  };

  const remove = async (o, status) => {
    if (status !== 'open') { toast('Goods were received against this order: cancel it instead', 'warning'); return; }
    if (!(await confirmAction({ title: `Delete ${o.number}?`, message: 'The order is removed.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await deletePurchase(o.id);
    load();
  };

  const formTotal = form ? (form.lines || []).reduce((s, l) => s + gridLineAmount(l), 0) : 0;

  return (
    <div className="dashboard-container">
      <div className="page-header">
        <div>
          <h1 className="page-title"><ClipboardList size={22} /> Purchase Orders</h1>
          <p className="page-subtitle">Goods ordered from suppliers. No stock or GST effect until they arrive on a bill.</p>
        </div>
        <div className="flex gap-2 items-center">
          <HelpButton title="Purchase orders — how to use">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Receive goods</strong> opens Add Purchase with what is still pending. Change the quantities for a part delivery; the rest stays on the order.</li>
              <li><strong>Advance</strong> paid with the order is applied to the first bill that receives the goods.</li>
              <li><strong>Cancel</strong> stops further deliveries; any advance stays with the supplier as your advance.</li>
            </ul>
          </HelpButton>
          <button className="btn btn-primary" onClick={startNew}><Plus size={16} /> Add Purchase Order</button>
        </div>
      </div>

      <div className="glass-panel p-4 mb-6" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} />
          <input className="search-input" placeholder="Search PO no or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="glass-panel">
        {shown.length === 0 ? (
          <EmptyState title={orders.length ? 'No orders match' : 'No purchase orders yet'} hint="Order goods from a supplier, then receive them on a purchase bill." action={<button className="btn btn-primary" onClick={startNew}><Plus size={16} /> Add Purchase Order</button>} />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>PO No</th><th>Date</th><th>Supplier</th><th>Expected</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Advance</th><th style={{ textAlign: 'right' }}>Pending value</th><th /></tr></thead>
              <tbody>
                {shown.map(({ order: o, status, pendingValue }) => (
                  <tr key={o.id}>
                    <td><button type="button" className="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }} onClick={() => edit(o)}>{o.number || '—'}</button></td>
                    <td>{o.date}</td>
                    <td>{o.supplierName}</td>
                    <td>{o.expectedDate || '—'}</td>
                    <td><StatusChip tone={STATUS[status].tone}>{STATUS[status].label}</StatusChip></td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(o.totalAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{o.advance ? formatCurrency(o.advance) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(pendingValue)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {(status === 'open' || status === 'partial') && (
                        <>
                          <button className="icon-btn" title="Receive goods on a purchase bill" aria-label={`Receive goods for ${o.number}`} onClick={() => receive(o)}><PackageCheck size={15} /></button>
                          <button className="icon-btn" title="Cancel order" aria-label={`Cancel ${o.number}`} onClick={() => cancel(o)}><Ban size={15} /></button>
                        </>
                      )}
                      <button className="icon-btn" title="Download PDF" aria-label={`PDF of ${o.number}`} onClick={() => purchaseDocPdf({ ...o, status }, { title: 'PURCHASE ORDER' })}><FileDown size={15} /></button>
                      <button className="icon-btn icon-btn-red" title="Delete" aria-label={`Delete ${o.number}`} onClick={() => remove(o, status)}><Trash2 size={15} /></button>
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
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 920 }} role="dialog" aria-label="Purchase order">
            <h3 className="section-title">{form.id ? `Purchase Order ${form.number}` : 'Add Purchase Order'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Supplier *</label>
                <input className="form-input" list="po-suppliers" value={form.supplierName} onChange={(e) => set({ supplierName: e.target.value })} autoComplete="off" />
                <datalist id="po-suppliers">{[...new Set(bills.map((b) => b.supplierName).filter(Boolean))].map((s) => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="form-group">
                <label className="form-label">PO No *</label>
                <input className="form-input" value={form.number} onChange={(e) => set({ number: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Order date</label>
                <input type="date" className="form-input" value={form.date} onChange={(e) => set({ date: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Expected delivery</label>
                <input type="date" className="form-input" value={form.expectedDate} min={form.date} onChange={(e) => set({ expectedDate: e.target.value })} />
              </div>
            </div>
            <LinesGrid docType="order" lines={form.lines} onChange={(lines) => set({ lines })} amountOf={gridLineAmount} />
            <div className="grid grid-cols-2 gap-4" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Advance paid</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" min="0" step="any" className="form-input" value={form.advance} onChange={(e) => set({ advance: e.target.value })} />
                  <select className="form-input" value={form.advanceMode} onChange={(e) => set({ advanceMode: e.target.value })} aria-label="Advance mode">
                    {['Bank Transfer', 'UPI', 'Cash', 'Cheque'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input className="form-input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
              </div>
            </div>
            <p style={{ textAlign: 'right', margin: '0.5rem 0 0' }}>Total <strong>{formatCurrency(formTotal)}</strong></p>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
