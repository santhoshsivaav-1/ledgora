import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Plus, Printer, Settings, X } from 'lucide-react';
import {
  BUILTIN_UNITS, PosError, billDiscountAmount, cartAdd, cartUpdate, cashSuggestions, maxRedeemable, parseQtyPrefix, posTotals, settleTender,
} from '@ledgora/tax-engine';
import { confirmAction, promptAction } from '../../components/ui/ConfirmModal';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { apiClient } from '../../lib/apiClient';
import { getAppSetting } from '../../lib/appSettings';
import { formatCurrency } from '../../utils';
import { listBusinesses } from '../../lib/data/accounting';
import { listBankAccounts } from '../../lib/data/cashbank';
import { getAllProducts } from '../../lib/data/products';
import { getAllClients } from '../../lib/data/clients';
import {
  cancelBill, createPosCustomer, createPosItem, getInvoice, getPosSettings, listTypedItemNames, posCustomers, posItems, recentBills, saveSale,
} from '../../lib/data/pos';
import PosSettingsDrawer from './PosSettingsDrawer';
import { POS_SHORTCUTS, actionForKey } from './posKeys';
import { blankBill, closeTab, parseDiscount, tabLabel } from './posBills';
import { printReceipt, receiptHtml } from './receipt';
import './pos.css';

// Vyapar parity P12: the Point of Sale counter. Bill tabs, scan/search, a bill table, shortcuts, split and credit
// payments, loyalty points. Everything is totalled by the tax engine's posTotals (the same function the API runs when
// the bill is saved) and saved as one typed invoice through POST /v1/pos/sales, so stock, payments, the ledger and the
// reports see it like any other sale.

const money = (n) => formatCurrency(n);
const errText = (e) => e?.message || 'Something went wrong';
const todayIso = () => new Date().toISOString().slice(0, 10);
const storeKey = (businessId) => `ledgora.pos.${businessId}`;
const MODE_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', cheque: 'Cheque', other: 'Other' };

function readHeld(businessId) {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(businessId)) || 'null');
    if (raw?.bills?.length) return { bills: raw.bills.map((b) => ({ ...blankBill(), ...b })), active: Math.min(raw.active || 0, raw.bills.length - 1) };
  } catch { /* private window or bad data: start clean */ }
  return { bills: [blankBill()], active: 0 };
}

function Dialog({ title, onClose, children, width = 520 }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: width }} role="dialog" aria-label={title}>
        <h3 className="section-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** Quantity cell: edits locally and commits on Enter or blur, so a half-typed number never deletes the line. */
function QtyInput({ value, onCommit }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <input className="form-input q" type="number" min="0" step="any" value={text} aria-label="Quantity"
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } }} />
  );
}

export default function PosPage() {
  const [ctx, setCtx] = useState(null); // { biz, settings, banks }
  const [error, setError] = useState(null);
  const [held, setHeld] = useState({ bills: [blankBill()], active: 0 });
  const [dlg, setDlg] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [hi, setHi] = useState(0);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef(null);
  const busy = useRef(false); // a prompt or dialog is up: shortcuts wait
  const seq = useRef(0);

  useEffect(() => {
    (async () => {
      const b = await listBusinesses();
      const biz = b[0];
      if (!biz) return null;
      const [settings, banks] = await Promise.all([getPosSettings(biz.id), listBankAccounts(biz.id).catch(() => [])]);
      return { biz, settings, banks };
    })().then((c) => { setCtx(c); if (c) setHeld(readHeld(c.biz.id)); }, setError);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    try { localStorage.setItem(storeKey(ctx.biz.id), JSON.stringify(held)); } catch { /* storage unavailable: held bills last this visit only */ }
  }, [held, ctx]);

  const { bills, active } = held;
  const bill = bills[active] || bills[0];
  const settings = ctx?.settings;
  const patch = useCallback((p) => setHeld((h) => ({ ...h, bills: h.bills.map((b, i) => (i === h.active ? { ...b, ...(typeof p === 'function' ? p(b) : p) } : b)) })), []);

  // ---- the numbers, from the engine ----
  const pb = useMemo(() => ({ lines: bill.lines, billDiscount: bill.billDiscount, billTaxPercent: bill.billTaxPercent, charges: bill.charges, redeemPoints: bill.redeemPoints }), [bill]);
  const taxCtx = { businessState: ctx?.biz.state, partyState: bill.customer?.state || '', partyGstin: bill.customer?.gstin || '' };
  const totals = useMemo(() => (settings ? posTotals(pb, settings, taxCtx) : null), [pb, settings, ctx, bill.customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const tenders = bill.split ?? [{ mode: bill.pay.mode, amount: bill.pay.received === '' ? totals?.total || 0 : Number(bill.pay.received) || 0 }];
  let settle = null;
  let problem = '';
  if (totals && bill.lines.length) {
    try { settle = settleTender(totals.total, tenders, !!bill.customer); } catch (e) { problem = e instanceof PosError ? e.message : errText(e); }
  }

  // ---- search ----
  useEffect(() => {
    if (!ctx) return undefined;
    const { rest } = parseQtyPrefix(query);
    if (!rest.trim()) { setResults([]); return undefined; }
    const my = ++seq.current;
    const t = setTimeout(() => {
      posItems(ctx.biz.id, rest.trim()).then((r) => { if (my === seq.current) { setResults(r); setHi(0); } }).catch(() => {});
    }, 140);
    return () => clearTimeout(t);
  }, [query, ctx]);

  // Settings > Item: an item that tracks batches gets the first-expiring batch with stock (changeable on the line);
  // one that tracks serial numbers asks for them. The server checks both again when the bill is saved.
  const lotsFor = async (item) => {
    if (!getAppSetting('item.batch') && !getAppSetting('item.serial')) return null;
    try { return await apiClient.get(`/v1/items/${item.id}/lots`); } catch { return null; }
  };
  const addItem = async (item, qty = 1) => {
    const lots = item.id ? await lotsFor(item) : null;
    const today = new Date().toISOString().slice(0, 10);
    const batch = lots?.tracksBatches && getAppSetting('item.batch')
      ? lots.batches.find((b) => b.qty > 0 && !(b.expDate && b.expDate < today)) || null
      : null;
    if (lots?.tracksBatches && getAppSetting('item.batch') && !batch) { toast(`${item.name}: no batch in stock`, 'warning'); return; }
    let serials = null;
    if (lots?.tracksSerials && getAppSetting('item.serial')) {
      const typed = await promptAction({
        title: `Serial numbers for ${item.name}`,
        message: `${qty} needed. In stock: ${lots.serials.slice(0, 8).join(', ')}${lots.serials.length > 8 ? '…' : ''}`,
        placeholder: 'Scan or type, separated by commas',
        confirmLabel: 'Add',
      });
      if (typed === null) return;
      serials = typed.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      if (serials.length !== qty) { toast(`${qty} serial number${qty === 1 ? '' : 's'} needed`, 'warning'); return; }
    }
    patch((b) => {
      // A tracked line is its own line (each batch or set of serials is sold separately).
      if (batch || serials) {
        // A tracked line is never merged into another: each batch or set of serial numbers is its own line.
        const fresh = cartAdd([], item, settings, qty)[0];
        const line = { ...fresh, key: `${fresh.key}#${Date.now()}`, stock: item.stock, trackStock: item.trackStock, batchNo: batch?.batchNo ?? null, serials, lots: lots?.batches || null };
        return { lines: [...b.lines, line], selected: line.key };
      }
      const lines = cartAdd(b.lines, item, settings, qty).map((l) => (l.itemId === item.id ? { ...l, stock: item.stock, trackStock: item.trackStock } : l));
      return { lines, selected: lines.find((l) => l.itemId === item.id)?.key };
    });
    setQuery('');
    setResults([]);
    searchRef.current?.focus();
  };

  const onSearchKey = async (e) => {
    if (e.key === 'ArrowDown' && results.length) { e.preventDefault(); setHi((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp' && results.length) { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setQuery(''); setResults([]); }
    else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const { qty, rest } = parseQtyPrefix(query);
      if (!rest.trim()) return;
      let list = results;
      if (!list.length || !list.some((r) => r.exact)) { // a scanner is faster than the debounce: ask now
        list = await posItems(ctx.biz.id, rest.trim()).catch(() => []);
      }
      const pick = list.find((r) => r.exact) || list[hi] || list[0];
      if (!pick) {
        toast(`No item “${rest.trim()}”. Add it from the Items screen or Import.`, 'warning');
        return;
      }
      addItem(pick, qty ?? 1);
    }
  };

  // ---- actions on the bill ----
  const selectedLine = bill.lines.find((l) => l.key === bill.selected) || null;
  const needLine = () => { if (!selectedLine) toast('Select an item in the bill first', 'warning'); return selectedLine; };
  const ask = async (opts) => { busy.current = true; try { return await promptAction(opts); } finally { busy.current = false; } };

  const actions = {
    newBill: () => { setHeld((h) => ({ bills: [...h.bills, blankBill()], active: h.bills.length })); setTimeout(() => searchRef.current?.focus(), 0); },
    closeBill: async () => {
      if (bill.lines.length && !(await confirmAction({ title: 'Close this bill?', message: 'Its items have not been saved.', confirmLabel: 'Close bill', tone: 'danger' }))) return;
      setHeld((h) => closeTab(h.bills, h.active, h.active));
    },
    gotoBill: ({ index }) => setHeld((h) => (index < h.bills.length ? { ...h, active: index } : h)),
    focusSearch: () => searchRef.current?.focus(),
    moveLine: ({ delta }) => patch((b) => {
      if (!b.lines.length) return {};
      const at = b.lines.findIndex((l) => l.key === b.selected);
      return { selected: b.lines[Math.max(0, Math.min(b.lines.length - 1, (at < 0 ? (delta > 0 ? -1 : b.lines.length) : at) + delta))].key };
    }),
    qty: async () => {
      const l = needLine(); if (!l) return;
      const v = await ask({ title: `Quantity of ${l.name}`, defaultValue: String(l.quantity), inputType: 'number' });
      const n = Number(v);
      if (v != null && Number.isFinite(n)) patch((b) => ({ lines: cartUpdate(b.lines, l.key, { quantity: n }) }));
    },
    itemDiscount: async () => {
      const l = needLine(); if (!l) return;
      const v = await ask({ title: `Discount on ${l.name}`, message: 'Rupees, or a percent like 10%', defaultValue: l.discountType === 'percent' ? `${l.discount}%` : String(l.discount || '') });
      const d = v == null ? null : v.trim() === '' ? { type: 'amount', value: 0 } : parseDiscount(v);
      if (v != null && !d) return toast('Enter an amount or a percent', 'warning');
      if (d) patch((b) => ({ lines: cartUpdate(b.lines, l.key, { discount: d.value, discountType: d.type }) }));
    },
    removeItem: () => { const l = needLine(); if (l) patch((b) => ({ lines: b.lines.filter((x) => x.key !== l.key), selected: null })); },
    unit: () => { const l = needLine(); if (l) setDlg({ kind: 'unit', line: l }); },
    charges: () => setDlg({ kind: 'charges' }),
    billDiscount: async () => {
      if (!settings.billDiscount) return toast('Bill discount is off in POS settings', 'warning');
      const cur = bill.billDiscount;
      const v = await ask({ title: 'Bill discount', message: 'Rupees, or a percent like 10%. Leave empty to clear.', defaultValue: cur ? `${cur.value}${cur.type === 'percent' ? '%' : ''}` : '' });
      if (v == null) return;
      if (v.trim() === '') return patch({ billDiscount: null });
      const d = parseDiscount(v);
      if (!d) return toast('Enter an amount or a percent', 'warning');
      patch({ billDiscount: d });
    },
    loyalty: async () => {
      if (!settings.loyalty.enabled) return toast('Loyalty points are off in POS settings', 'warning');
      if (!bill.customer) return toast('Pick a customer first (F11)', 'warning');
      const before = posTotals({ ...pb, redeemPoints: 0 }, settings, taxCtx).total;
      const most = maxRedeemable(bill.customer.points, before, settings.loyalty);
      const v = await ask({ title: `Redeem points (${bill.customer.points} available, up to ${most} on this bill)`, defaultValue: String(bill.redeemPoints || ''), inputType: 'number' });
      if (v == null) return;
      const n = Math.floor(Number(v) || 0);
      if (n > most) return toast(`At most ${most} points can be redeemed on this bill`, 'warning');
      patch({ redeemPoints: Math.max(0, n) });
    },
    customer: () => setDlg({ kind: 'customer' }),
    remarks: async () => { const v = await ask({ title: 'Remarks on the bill', defaultValue: bill.remarks }); if (v != null) patch({ remarks: v }); },
    breakup: () => setDlg({ kind: 'breakup' }),
    payments: () => setDlg({ kind: 'payments' }),
    recent: () => setDlg({ kind: 'recent' }),
    help: () => setDlg({ kind: 'help' }),
    save: () => save({ print: true }),
    saveNew: () => save({ print: false }),
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // ---- save ----
  async function save({ print }) {
    if (saving || !settings) return;
    if (!bill.lines.length) return toast('Add at least one item', 'warning');
    if (problem) return toast(problem, 'warning');
    setSaving(true);
    try {
      const body = {
        businessId: ctx.biz.id,
        partyId: bill.customer?.id ?? null,
        invoiceDate: bill.date || todayIso(),
        lines: bill.lines.map((l) => ({ itemId: l.itemId, name: l.name, hsn: l.hsn || '', unit: l.unit, quantity: l.quantity, freeQty: settings.freeQty ? l.freeQty || 0 : 0, rate: l.rate, discount: l.discount || 0, discountType: l.discountType || 'amount', taxPercent: l.taxPercent, cessPercent: l.cessPercent || 0, ...(l.batchNo ? { batchNo: l.batchNo } : {}), ...(l.serials?.length ? { serials: l.serials } : {}) })),
        billDiscount: settings.billDiscount ? bill.billDiscount : null,
        billTaxPercent: settings.billTax ? bill.billTaxPercent : null,
        charges: bill.charges.map((c) => ({ name: c.name, amount: c.amount, gstRate: c.gstRate || 0, taxable: true, hsn: '' })),
        redeemPoints: settings.loyalty.enabled ? bill.redeemPoints : 0,
        tenders: settle.payments.map((p) => ({ mode: p.mode, amount: p.amount, accountId: p.accountId ?? null, reference: p.reference || '' })),
        remarks: bill.remarks,
        clientKey: bill.clientKey,
      };
      let confirm = { ...bill.confirm };
      let res;
      for (;;) {
        try { res = await saveSale({ ...body, confirm }); break; }
        catch (e) {
          if (e.code === 'negative_stock' && !confirm.negativeStock) {
            if (!(await confirmAction({ title: 'Not enough stock', message: e.message, confirmLabel: 'Sell anyway' }))) return;
            confirm = { ...confirm, negativeStock: true };
          } else if (e.code === 'credit_limit' && !confirm.creditLimit) {
            if (!(await confirmAction({ title: 'Credit limit', message: e.message, confirmLabel: 'Continue' }))) return;
            confirm = { ...confirm, creditLimit: true };
          } else if (e.code === 'cash_limit' && !confirm.cashAcknowledgement) {
            const ack = await ask({ title: 'Cash limit (§269ST)', message: `${e.message}`, placeholder: 'Type an acknowledgement' });
            if (!ack) return;
            confirm = { ...confirm, cashAcknowledgement: ack };
          } else throw e;
        }
      }
      toast(`Saved ${res.number}${res.change > 0 ? ` · return ${money(res.change)}` : ''}`, 'success');
      if (print) {
        try {
          const invoice = await getInvoice(res.invoiceId);
          printReceipt(receiptHtml({ business: ctx.biz, invoice, customer: bill.customer, change: res.change, settings, pointsEarned: res.pointsEarned, pointsBalance: res.pointsBalance }));
        } catch (e) { toast(`Saved, but the receipt did not print: ${errText(e)}`, 'warning'); }
      }
      setHeld((h) => ({ ...h, bills: h.bills.map((b, i) => (i === h.active ? blankBill() : b)) }));
      setTimeout(() => searchRef.current?.focus(), 0);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e) => {
      if (busy.current || document.querySelector('.modal-overlay, .ui-overlay')) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      const hit = actionForKey(e, { typing });
      if (!hit || (typing && hit.action === 'removeItem')) return;
      e.preventDefault();
      actionsRef.current[hit.action]?.(hit);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (ctx) searchRef.current?.focus(); }, [ctx]);

  if (error) return <ErrorState message={errText(error)} onRetry={() => window.location.reload()} />;
  if (!ctx) return <LoadingState label="Opening the counter…" />;
  if (!ctx.biz) return <EmptyState title="No business yet" hint="Create a business first." />;
  const T = totals;
  const stockWarn = (l) => l.trackStock && l.stock != null && l.quantity + (settings.freeQty ? l.freeQty || 0 : 0) > l.stock;

  return (
    <div className="pos" aria-label="Point of sale">
      <div className="pos-tabs" role="tablist" aria-label="Bills">
        {bills.map((b, i) => (
          <span key={b.id} role="tab" tabIndex={0} aria-selected={i === active} className="pos-tab" onClick={() => setHeld((h) => ({ ...h, active: i }))}
            onKeyDown={(e) => e.key === 'Enter' && setHeld((h) => ({ ...h, active: i }))}>
            {tabLabel(b, i + 1)}
            {bills.length > 1 && <button className="x" aria-label={`Close bill ${i + 1}`} onClick={(e) => { e.stopPropagation(); setHeld((h) => closeTab(h.bills, h.active, i)); }}><X size={12} /></button>}
          </span>
        ))}
        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }} onClick={actions.newBill}><Plus size={13} /> New Bill [Ctrl+T]</button>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Recent bills (Ctrl+H)" aria-label="Recent bills" onClick={actions.recent}><Printer size={16} /></button>
        <button className="icon-btn" title="Full screen" aria-label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}><Maximize2 size={16} /></button>
        <button className="icon-btn" title="POS settings" aria-label="POS settings" onClick={() => setDrawer(true)}><Settings size={16} /></button>
      </div>

      <div className="pos-main">
        <div className="pos-left">
          <div className="pos-search">
            <input ref={searchRef} className="form-input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
              placeholder="Scan or search by item code, barcode or item name" aria-label="Scan or search an item" autoComplete="off" />
            {results.length > 0 && (
              <div className="pos-results" role="listbox">
                {results.map((r, i) => (
                  <div key={r.id} role="option" aria-selected={i === hi} className="pos-result" onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); addItem(r, parseQtyPrefix(query).qty ?? 1); }}>
                    <span><strong>{r.name}</strong> <small>{[r.sku, r.barcode].filter(Boolean).join(' · ')}</small></span>
                    <span><span className="tabular">{money(r.salePrice)}</span> <small>{r.trackStock ? `${r.stock} in stock` : 'service'}</small></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pos-panel pos-table-wrap">
            <table className="pos-table">
              <thead><tr><th>#</th><th>Item Code</th><th>Item Name</th><th className="n">Qty</th><th>Unit</th><th className="n">Price/Unit (₹) Without Tax</th><th className="n">Discount (₹)</th><th className="n">Tax Applied (₹)</th><th className="n">Total (₹)</th></tr></thead>
              <tbody>
                {bill.lines.map((l, i) => {
                  const v = T.lines[i];
                  return (
                    <tr key={l.key} aria-selected={l.key === bill.selected} className={stockWarn(l) ? 'warn' : ''} onClick={() => patch({ selected: l.key })} title={stockWarn(l) ? `Only ${l.stock} in stock` : undefined}>
                      <td>{i + 1}</td><td>{l.code}</td><td>{l.name}{l.freeQty > 0 && settings.freeQty ? <small> (+{l.freeQty} free)</small> : null}
                        {l.batchNo && (
                          <div><small>Batch{' '}
                            {l.lots?.length > 1
                              ? <select aria-label={`Batch of ${l.name}`} value={l.batchNo} onClick={(e) => e.stopPropagation()} onChange={(e) => patch((b) => ({ lines: b.lines.map((x) => (x.key === l.key ? { ...x, batchNo: e.target.value } : x)) }))}>
                                  {l.lots.filter((bt) => bt.qty > 0).map((bt) => <option key={bt.batchNo} value={bt.batchNo}>{bt.batchNo}{bt.expDate ? ` · exp ${bt.expDate}` : ''} · {bt.qty} left</option>)}
                                </select>
                              : l.batchNo}
                          </small></div>
                        )}
                        {l.serials?.length > 0 && <div><small>Serial {l.serials.join(', ')}</small></div>}
                      </td>
                      <td className="n">{settings.directQtyChange ? <QtyInput value={l.quantity} onCommit={(n) => patch((b) => ({ lines: cartUpdate(b.lines, l.key, { quantity: n }) }))} /> : l.quantity}</td>
                      <td>{l.unit}</td><td className="n">{v.priceExTax.toFixed(2)}</td><td className="n">{v.discount.toFixed(2)}</td><td className="n">{v.tax.toFixed(2)}</td><td className="n"><strong>{v.total.toFixed(2)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!bill.lines.length && <div className="pos-empty">Scan a barcode or search an item to start the bill.<br /><button className="btn btn-secondary mt-2" onClick={() => setDlg({ kind: 'import' })}>Import my products and customers</button> <button className="btn btn-secondary mt-2" onClick={() => setDlg({ kind: 'newItem' })}>Add an item</button></div>}
          </div>

          <div className="pos-keys">
            {[['Change Quantity', 'F2', 'qty'], ['Item Discount', 'F3', 'itemDiscount'], ['Remove Item', 'F4', 'removeItem'], ['Change Unit', 'F6', 'unit'],
              ['Additional Charges', 'F8', 'charges'], ['Bill Discount', 'F9', 'billDiscount'], ['Loyalty Points', 'F10', 'loyalty'], ['Remarks', 'F12', 'remarks']].map(([label, k, act]) => (
              <button key={act} type="button" onClick={actions[act]} disabled={(['qty', 'itemDiscount', 'removeItem', 'unit'].includes(act) && !selectedLine) || (act === 'billDiscount' && !settings.billDiscount) || (act === 'loyalty' && !settings.loyalty.enabled)}>{label} <kbd>{k}</kbd></button>
            ))}
          </div>
        </div>

        <div className="pos-right">
          <div className="pos-panel">
            <div className="pos-row"><label className="form-label" style={{ margin: 0 }}>Date</label><input type="date" className="form-input" style={{ width: 'auto' }} value={bill.date || todayIso()} onChange={(e) => patch({ date: e.target.value })} /></div>
            <button type="button" className="form-input" style={{ textAlign: 'left', cursor: 'pointer', marginTop: 6 }} onClick={actions.customer}>
              {bill.customer ? <><strong>{bill.customer.name}</strong>{bill.customer.phone ? ` · ${bill.customer.phone}` : ''}{settings.loyalty.enabled ? ` · ${bill.customer.points} pts` : ''}{bill.customer.due ? ` · due ${money(bill.customer.due)}` : ''}</> : <span style={{ color: 'var(--text-secondary)' }}>Search for a customer by name, phone number [F11]</span>}
            </button>
          </div>

          <div className="pos-panel">
            <div className="pos-total"><div className="sub">Total</div><div className="amt">{money(T.total)}</div><div className="sub">{T.items} item{T.items === 1 ? '' : 's'}, quantity {T.quantity}</div>
              <button className="btn btn-secondary" style={{ padding: '0.15rem 0.6rem', fontSize: '0.75rem', marginTop: 4 }} onClick={actions.breakup}>Full Breakup [Ctrl+F]</button></div>
            {T.billDiscount > 0 && <div className="pos-row"><span>Bill discount</span><span>−{money(T.billDiscount)}</span></div>}
            {T.pointsValue > 0 && <div className="pos-row"><span>Points ({bill.redeemPoints})</span><span>−{money(T.pointsValue)}</span></div>}
            {T.charges > 0 && <div className="pos-row"><span>Charges</span><span>{money(T.charges)}</span></div>}
          </div>

          <div className="pos-panel">
            {bill.split ? (
              <div>{bill.split.map((s, i) => <div key={i} className="pos-row"><span>{MODE_LABEL[s.mode]}</span><span>{money(s.amount)}</span></div>)}
                <button className="btn btn-secondary" style={{ padding: '0.15rem 0.6rem', fontSize: '0.75rem' }} onClick={() => patch({ split: null })}>Use one payment</button></div>
            ) : (
              <>
                <div className="pos-row"><label className="form-label" style={{ margin: 0 }} htmlFor="pos-mode">Payment Mode</label>
                  <select id="pos-mode" className="form-input" style={{ width: 'auto' }} value={bill.pay.mode} onChange={(e) => patch({ pay: { ...bill.pay, mode: e.target.value } })}>
                    {settings.paymentModes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                  </select></div>
                <div className="pos-row"><label className="form-label" style={{ margin: 0 }} htmlFor="pos-recv">Amount Received</label>
                  <input id="pos-recv" className="form-input" style={{ width: 130, textAlign: 'right' }} type="number" min="0" placeholder={String(T.total)} value={bill.pay.received} onChange={(e) => patch({ pay: { ...bill.pay, received: e.target.value } })} /></div>
                {bill.pay.mode === 'cash' && T.total > 0 && <div className="pos-row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{cashSuggestions(T.total).map((n) => <button key={n} type="button" className="btn btn-secondary" style={{ padding: '0.1rem 0.45rem', fontSize: '0.72rem' }} onClick={() => patch({ pay: { ...bill.pay, received: String(n) } })}>{n}</button>)}</div>}
              </>
            )}
            <div className="pos-row pos-change"><span>Change to Return</span><span>{money(settle?.change || 0)}</span></div>
            {settle?.credit > 0 && <div className="pos-row"><span>On credit</span><span>{money(settle.credit)}</span></div>}
            {problem && <div className="pos-bad" role="alert">{problem}</div>}
            <button className="pos-act" style={{ width: '100%', marginTop: 6 }} onClick={actions.payments}>Other / Credit Payments <kbd>Ctrl+M</kbd></button>
          </div>

          <div className="pos-save">
            <button className="btn btn-primary" disabled={saving || !bill.lines.length || !!problem} onClick={() => save({ print: settings.primaryAction === 'save-print' })}>
              {saving ? 'Saving…' : settings.primaryAction === 'save-print' ? 'Save & Print Bill [Ctrl+P]' : 'Save & New [Ctrl+Enter]'}</button>
            <button className="btn btn-secondary" disabled={saving || !bill.lines.length || !!problem} onClick={() => save({ print: settings.primaryAction !== 'save-print' })}>
              {settings.primaryAction === 'save-print' ? 'Save & New [Ctrl+Enter]' : 'Save & Print Bill [Ctrl+P]'}</button>
            <button className="btn btn-link" style={{ fontSize: '0.75rem' }} onClick={actions.help}>Keyboard shortcuts (F1)</button>
          </div>
        </div>
      </div>

      {drawer && <PosSettingsDrawer open onClose={() => setDrawer(false)} businessId={ctx.biz.id} settings={settings} banks={ctx.banks} onSaved={(s) => setCtx((c) => ({ ...c, settings: s }))} />}
      {dlg?.kind === 'help' && (
        <Dialog title="POS keyboard shortcuts" onClose={() => setDlg(null)} width={560}>
          <table className="pos-table"><tbody>{POS_SHORTCUTS.map((s) => <tr key={s.action}><td><kbd>{s.keys}</kbd></td><td>{s.label}</td></tr>)}</tbody></table>
          <p className="field-hint">Browsers keep Ctrl+T and Ctrl+W for themselves, so Alt+N and Alt+W do the same here. Full screen (the corner button) lets Ctrl+T/W through in an installed app.</p>
        </Dialog>
      )}
      {dlg?.kind === 'breakup' && <BreakupDialog totals={T} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'unit' && <UnitDialog line={dlg.line} onClose={() => setDlg(null)} onPick={(unit) => { patch((b) => ({ lines: b.lines.map((l) => (l.key === dlg.line.key ? { ...l, unit } : l)) })); setDlg(null); }} />}
      {dlg?.kind === 'charges' && <ChargesDialog charges={bill.charges} onClose={() => setDlg(null)} onSave={(charges) => { patch({ charges }); setDlg(null); }} />}
      {dlg?.kind === 'payments' && <PaymentsDialog total={T.total} modes={settings.paymentModes} hasCustomer={!!bill.customer} split={bill.split} onClose={() => setDlg(null)} onSave={(split) => { patch({ split }); setDlg(null); }} />}
      {dlg?.kind === 'customer' && <CustomerDialog biz={ctx.biz} onClose={() => setDlg(null)} onPick={(c) => { patch({ customer: c, redeemPoints: 0 }); setDlg(null); }} />}
      {dlg?.kind === 'recent' && <RecentDialog ctx={ctx} settings={settings} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'newItem' && <NewItemDialog onClose={() => setDlg(null)} onCreated={(it) => { setDlg(null); toast(`${it.name} added`, 'success'); }} />}
      {dlg?.kind === 'import' && <ImportDialog onClose={() => setDlg(null)} />}
    </div>
  );
}

function BreakupDialog({ totals: T, onClose }) {
  const rows = [['Subtotal', T.subtotal], ['Discount', -T.discount], ['Taxable value', T.taxable], ['CGST', T.cgst], ['SGST', T.sgst], ['IGST', T.igst], ['Cess', T.cess], ['Charges (before tax)', T.charges], ['Round off', T.roundOff]].filter(([, v]) => v);
  return (
    <Dialog title="Full breakup" onClose={onClose} width={420}>
      {rows.map(([k, v]) => <div key={k} className="pos-row"><span>{k}</span><span>{money(v)}</span></div>)}
      <div className="pos-row"><strong>Total</strong><strong>{money(T.total)}</strong></div>
      <div className="flex justify-end mt-4"><button className="btn btn-primary" onClick={onClose}>Close</button></div>
    </Dialog>
  );
}

function UnitDialog({ line, onClose, onPick }) {
  const [u, setU] = useState(line.unit);
  return (
    <Dialog title={`Unit of ${line.name}`} onClose={onClose} width={380}>
      <p className="field-hint">The price stays as it is: change it in the item if one unit costs more than another.</p>
      <select className="form-input" value={u} autoFocus onChange={(e) => setU(e.target.value)}>
        {[...new Set([line.unit, ...BUILTIN_UNITS.map((x) => x.uqc)])].map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onPick(u)}>Change</button></div>
    </Dialog>
  );
}

function ChargesDialog({ charges, onClose, onSave }) {
  const [rows, setRows] = useState(charges.length ? charges : [{ name: 'Packing', amount: '', gstRate: 18 }]);
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const clean = rows.filter((r) => r.name.trim() && Number(r.amount) > 0).map((r) => ({ name: r.name.trim(), amount: Number(r.amount), gstRate: Number(r.gstRate) || 0 }));
  return (
    <Dialog title="Additional charges" onClose={onClose}>
      <p className="field-hint">Amounts are before GST; each charge carries its own GST rate.</p>
      {rows.map((r, i) => (
        <div key={i} className="pos-row">
          <input className="form-input" placeholder="Name" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
          <input className="form-input" style={{ width: 100 }} type="number" min="0" placeholder="Amount" value={r.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
          <select className="form-input" style={{ width: 80 }} value={r.gstRate} onChange={(e) => set(i, 'gstRate', e.target.value)}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</select>
          <button className="icon-btn" aria-label="Remove charge" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      {rows.length < 10 && <button className="btn btn-secondary" onClick={() => setRows((r) => [...r, { name: '', amount: '', gstRate: 18 }])}>+ Add charge</button>}
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => onSave(clean)}>Apply</button></div>
    </Dialog>
  );
}

function PaymentsDialog({ total, modes, hasCustomer, split, onClose, onSave }) {
  const [rows, setRows] = useState(split?.length ? split.map((s) => ({ ...s, amount: String(s.amount) })) : [{ mode: 'cash', amount: String(total) }]);
  const set = (i, k, v) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const list = rows.map((r) => ({ mode: r.mode, amount: Number(r.amount) || 0 }));
  let out = null;
  let problem = '';
  try { out = settleTender(total, list, hasCustomer); } catch (e) { problem = e instanceof PosError ? e.message : String(e.message || e); }
  return (
    <Dialog title="Other / Credit payments" onClose={onClose}>
      <p className="field-hint">Split the bill across modes. Whatever is not paid stays on the customer as credit.</p>
      {rows.map((r, i) => (
        <div key={i} className="pos-row">
          <select className="form-input" style={{ width: 150 }} value={r.mode} onChange={(e) => set(i, 'mode', e.target.value)}>{modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select>
          <input className="form-input" type="number" min="0" value={r.amount} onChange={(e) => set(i, 'amount', e.target.value)} aria-label="Amount" />
          <button className="icon-btn" aria-label="Remove row" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      {rows.length < 6 && <button className="btn btn-secondary" onClick={() => setRows((r) => [...r, { mode: modes[1] || 'cash', amount: '' }])}>+ Add payment</button>}
      <div className="pos-row mt-4"><span>Bill total</span><strong>{money(total)}</strong></div>
      {out && <><div className="pos-row"><span>Paid</span><span>{money(out.paid)}</span></div><div className="pos-row"><span>On credit</span><span>{money(out.credit)}</span></div><div className="pos-row pos-change"><span>Change to return</span><span>{money(out.change)}</span></div></>}
      {problem && <div className="pos-bad" role="alert">{problem}</div>}
      <div className="flex gap-2 justify-end mt-4">
        <button className="btn btn-secondary" onClick={() => { setRows([]); }}>Pay nothing (all credit)</button>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!!problem} onClick={() => onSave(list.filter((l) => l.amount > 0))}>Apply</button>
      </div>
    </Dialog>
  );
}

function CustomerDialog({ biz, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [add, setAdd] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => posCustomers(biz.id, q).then(setList).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [q, biz.id]);
  const create = async () => {
    try {
      const p = await createPosCustomer({ name: add.name.trim(), phone: add.phone.trim(), state: biz.state || '', kind: 'customer' });
      onPick({ id: p.id, name: p.name, phone: p.phone || null, state: p.state || null, gstin: p.gstin, points: 0, due: 0 });
    } catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <Dialog title="Customer" onClose={onClose} width={560}>
      <input className="form-input" autoFocus placeholder="Search by name or phone" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && list[0] && onPick(list[0])} />
      <div style={{ maxHeight: 260, overflow: 'auto', margin: '0.5rem 0' }}>
        {list.map((c) => (
          <div key={c.id} className="pos-result" onClick={() => onPick(c)}>
            <span><strong>{c.name}</strong> <small>{c.phone}</small></span><small>{c.points} pts{c.due ? ` · due ${money(c.due)}` : ''}</small>
          </div>
        ))}
        {!list.length && <div className="pos-empty">No customer found.</div>}
      </div>
      {add ? (
        <div className="pos-row"><input className="form-input" placeholder="Name" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /><input className="form-input" placeholder="Phone" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /><button className="btn btn-primary" disabled={!add.name.trim()} onClick={create}>Add</button></div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setAdd({ name: q.match(/\d/) ? '' : q, phone: q.match(/^\d+$/) ? q : '' })}>+ New customer</button>
      )}
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={() => onPick(null)}>Walk-in (no customer)</button><button className="btn btn-secondary" onClick={onClose}>Cancel</button></div>
    </Dialog>
  );
}

function RecentDialog({ ctx, settings, onClose }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => recentBills(ctx.biz.id).then(setRows).catch((e) => { toast(errText(e), 'error'); setRows([]); }), [ctx]);
  useEffect(() => { load(); }, [load]);
  const reprint = async (b) => {
    try { printReceipt(receiptHtml({ business: ctx.biz, invoice: await getInvoice(b.id), settings })); } catch (e) { toast(errText(e), 'error'); }
  };
  const cancel = async (b) => {
    if (!(await confirmAction({ title: `Cancel ${b.number}?`, message: 'Stock goes back and the sale is reversed in the books.', confirmLabel: 'Cancel bill', tone: 'danger' }))) return;
    try { await cancelBill(b.id); toast(`${b.number} cancelled`, 'success'); load(); } catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <Dialog title="Recent bills" onClose={onClose} width={640}>
      {!rows ? <LoadingState label="Loading…" /> : (
        <table className="pos-table"><thead><tr><th>Bill</th><th>Date</th><th className="n">Total</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}><td>{b.number}</td><td>{b.invoiceDate}</td><td className="n">{money(b.total)}</td><td>{b.status}</td>
              <td><button className="btn btn-secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem' }} onClick={() => reprint(b)}>Reprint</button>{b.status !== 'cancelled' && <button className="btn btn-secondary" style={{ padding: '0.1rem 0.5rem', fontSize: '0.75rem', marginLeft: 4 }} onClick={() => cancel(b)}>Cancel</button>}</td></tr>
          ))}</tbody></table>
      )}
      <div className="flex justify-end mt-4"><button className="btn btn-primary" onClick={onClose}>Close</button></div>
    </Dialog>
  );
}

function NewItemDialog({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', sku: '', barcode: '', salePrice: '', taxPercent: '18', unit: 'PCS', stock: '', inclTax: true });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      onCreated(await createPosItem({
        name: f.name.trim(), sku: f.sku.trim() || null, unit: f.unit, salePrice: Number(f.salePrice) || 0, taxPercent: Number(f.taxPercent) || 0, openingStock: Number(f.stock) || 0,
        extra: { ...(f.barcode.trim() ? { barcode: f.barcode.trim() } : {}), salePriceInclTax: f.inclTax },
      }));
    } catch (e) { toast(errText(e), 'error'); }
  };
  const field = (label, k, props = {}) => <label className="form-label">{label}<input className="form-input" value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} /></label>;
  return (
    <Dialog title="Add an item" onClose={onClose}>
      {field('Item name', 'name', { autoFocus: true })}
      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>{field('Item code', 'sku')}{field('Barcode', 'barcode')}{field('Sale price (₹)', 'salePrice', { type: 'number', min: 0 })}{field('GST %', 'taxPercent', { type: 'number', min: 0 })}{field('Unit', 'unit')}{field('Opening stock', 'stock', { type: 'number', min: 0 })}</div>
      <label className="pos-row" style={{ justifyContent: 'flex-start' }}><input type="checkbox" checked={f.inclTax} onChange={(e) => set('inclTax', e.target.checked)} /> Sale price includes GST</label>
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!f.name.trim()} onClick={save}>Add</button></div>
    </Dialog>
  );
}

/** The Products and Clients screens still keep their records as workspace documents; the counter sells typed items. */
function ImportDialog({ onClose }) {
  const [state, setState] = useState({ busy: false, done: null });
  const run = async () => {
    setState({ busy: true, done: null });
    try {
      const have = await listTypedItemNames();
      let items = 0;
      for (const p of await getAllProducts()) {
        if (!p?.name || have.has(`${String(p.name).toLowerCase()}|${p.hsn || ''}`)) continue;
        await createPosItem({
          name: String(p.name).trim().slice(0, 200), hsn: String(p.hsn || '').slice(0, 10), unit: String(p.unit || 'PCS').slice(0, 10),
          salePrice: Number(p.sellingPrice ?? p.rate) || 0, purchasePrice: Number(p.purchasePrice) || 0, taxPercent: Number(p.taxPercent) || 0,
          openingStock: Math.max(0, Number(p.stock) || 0), extra: { salePriceInclTax: false, importedFrom: p.id },
        }); items += 1;
      }
      let customers = 0;
      for (const c of await getAllClients()) {
        if (!c?.name) continue;
        try { await createPosCustomer({ name: String(c.name).slice(0, 200), phone: String(c.phone || '').slice(0, 30), state: c.state || '', email: c.email || '', gstin: c.gstin || null, kind: 'customer' }); customers += 1; }
        catch { /* a bad GSTIN or a duplicate: leave that one */ }
      }
      setState({ busy: false, done: `Imported ${items} item${items === 1 ? '' : 's'} and ${customers} customer${customers === 1 ? '' : 's'}.` });
    } catch (e) { setState({ busy: false, done: `Stopped: ${errText(e)}` }); }
  };
  return (
    <Dialog title="Import my products and customers" onClose={onClose} width={460}>
      <p>The counter sells items kept in the books (the same ones Reports and Cash &amp; Bank use). This copies the products and clients from the older Products and Clients screens. Items already there (same name and HSN) are skipped. Run it once.</p>
      {state.done && <p><strong>{state.done}</strong></p>}
      <div className="flex gap-2 justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={state.busy} onClick={run}>{state.busy ? 'Importing…' : 'Import'}</button></div>
    </Dialog>
  );
}
