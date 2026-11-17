import { useEffect, useState } from 'react';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import { localToday } from '../../utils';
import { Dialog, Field, Actions, FormErrors, usePagedList } from './godownParts';
import {
  batchOptionsFromLots, buildTransferPayload, createStockTransfer, deleteStockTransfer,
  godownLabel, godownPickerOptions, itemLots, itemTracksBatches, listStockTransfers,
  transferLineSummary, validateTransferForm,
} from '../../lib/data/godowns';

// Vyapar parity Phase 3: stock transfers (P3 "STR-00001"). A register (50 at a time, newest first) and a create
// form that moves stock from one godown to another; deleting a transfer puts the stock back. Not enough stock in
// the from-godown — overall, per batch or per serial — comes back as a 422 with every problem, shown on the form.

const blankLine = () => ({ itemId: '', quantity: '', batchNo: '', expDate: '', serials: '', tracksBatch: false });

export default function Transfers({ godowns, defaultId, items }) {
  const [showForm, setShowForm] = useState(false);
  const page = usePagedList((p) => listStockTransfers({ limit: 50, ...p }), []);
  const rows = page.rows ?? [];

  return (
    <>
      <div className="glass-panel">
        <div className="table-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3>Stock transfers</h3>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> New transfer</button>
        </div>
        {page.error ? (
          <ErrorState message={page.error?.body?.error?.message || page.error?.message} onRetry={page.refresh} />
        ) : !page.rows ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState title="No transfers yet" hint="Move stock between godowns with New transfer." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Number</th><th>Date</th><th>From → To</th><th>Lines</th><th>Note</th><th className="col-center">Actions</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium">{t.number}</td>
                    <td>{t.transferDate}</td>
                    <td>
                      {godownLabel(godowns.find((g) => g.id === t.fromGodownId)) || '—'}{' '}
                      <ArrowRight size={13} style={{ verticalAlign: 'middle' }} />{' '}
                      {godownLabel(godowns.find((g) => g.id === t.toGodownId)) || '—'}
                    </td>
                    <td className="text-muted" style={{ maxWidth: 340 }}>{transferLineSummary(t.lines, items)}</td>
                    <td className="text-muted">{t.note || '—'}</td>
                    <td>
                      <div className="table-actions">
                        <button className="icon-btn icon-btn-red" title="Delete — the stock goes back"
                          onClick={async () => {
                            if (!await confirmAction({ title: `Delete ${t.number}?`, message: 'The stock it moved goes back to where it came from.', confirmLabel: 'Delete', tone: 'danger' })) return;
                            try { await deleteStockTransfer(t.id); toast('Transfer deleted — the stock went back', 'success'); page.refresh(); }
                            catch (e) { toast(e?.body?.error?.message || e?.message || 'Could not delete', 'error'); }
                          }}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.hasMore && (
          <div style={{ padding: '0.75rem 1rem' }}>
            <button className="btn btn-secondary" onClick={page.loadMore}>Load more</button>
          </div>
        )}
      </div>
      {showForm && (
        <TransferForm godowns={godowns} defaultId={defaultId} items={items}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); page.refresh(); }} />
      )}
    </>
  );
}

function TransferForm({ godowns, defaultId, items, onClose, onSaved }) {
  const [f, setF] = useState({ transferDate: localToday(), fromGodownId: defaultId || '', toGodownId: '', note: '' });
  const [lines, setLines] = useState([blankLine()]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const pickers = godownPickerOptions(godowns, defaultId);

  const setLine = (i, patch) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickItem = (i, item) => {
    setLine(i, { itemId: item?.id || '', tracksBatch: item ? itemTracksBatches(item) : false, batchNo: '', expDate: '' });
  };

  const save = async () => {
    const problems = validateTransferForm({ transferDate: f.transferDate, fromGodownId: f.fromGodownId, toGodownId: f.toGodownId, lines });
    if (problems.length) { setMessages(problems); return; }
    setMessages([]);
    try {
      const r = await createStockTransfer(buildTransferPayload({ ...f, lines }));
      toast(`${r.number} saved`, 'success');
      onSaved();
    } catch (e) {
      // 422 with details[{path:'lines',message}]: every stock problem, shown on the form.
      setError(e);
    }
  };

  return (
    <Dialog title="New stock transfer" onClose={onClose} width={720}>
      <FormErrors error={error} />
      {messages.length > 0 && (
        <div className="glass-panel p-4" role="alert" style={{ marginTop: 8, borderColor: '#d97706' }}>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#b45309' }}>{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date">
          <input type="date" className="form-input" value={f.transferDate} onChange={(e) => setF({ ...f, transferDate: e.target.value })} />
        </Field>
        <Field label="Note">
          <input type="text" className="form-input" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <Field label="From godown *">
          <select className="form-input" value={f.fromGodownId} onChange={(e) => setF({ ...f, fromGodownId: e.target.value })}>
            <option value="">Pick a godown</option>
            {pickers.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </Field>
        <Field label="To godown *">
          <select className="form-input" value={f.toGodownId} onChange={(e) => setF({ ...f, toGodownId: e.target.value })}>
            <option value="">Pick a godown</option>
            {pickers.filter((g) => g.value !== f.fromGodownId).map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </Field>
      </div>
      <h4 style={{ margin: '1rem 0 6px', fontWeight: 600, fontSize: '0.85rem' }}>Lines</h4>
      {lines.map((l, i) => <TransferLine key={i} index={i} line={l} items={items} fromGodownId={f.fromGodownId}
        onPick={pickItem} onChange={setLine}
        onRemove={() => setLines((cur) => (cur.length > 1 ? cur.filter((_, j) => j !== i) : cur))} />)}
      <button className="btn btn-secondary" style={{ marginTop: 6 }} onClick={() => setLines((cur) => [...cur, blankLine()])}>
        <Plus size={14} /> Add line
      </button>
      <Actions onCancel={onClose} onSave={save} label="Save transfer" />
    </Dialog>
  );
}

function TransferLine({ index, line, items, fromGodownId, onPick, onChange, onRemove }) {
  // The from-godown's batches for a batch item, fetched once the item and godown are both known, so the picker
  // suggests what is actually there (the API still checks every line).
  const [batches, setBatches] = useState(null);
  useEffect(() => {
    setBatches(null);
    if (!line.tracksBatch || !line.itemId || !fromGodownId) return undefined;
    let alive = true;
    itemLots(line.itemId, fromGodownId)
      .then((r) => { if (alive) setBatches(batchOptionsFromLots(r)); })
      .catch(() => { if (alive) setBatches([]); });
    return () => { alive = false; };
  }, [line.itemId, line.tracksBatch, fromGodownId]);

  return (
    <div className="glass-panel p-3" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ flex: 2, margin: 0 }}>
          <label className="form-label">Item {index === 0 ? '*' : ''}</label>
          <select className="form-input" value={line.itemId} onChange={(e) => onPick(index, items.find((x) => x.id === e.target.value))}>
            <option value="">Pick an item</option>
            {items.filter((i) => i.trackStock).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ flex: 0.7, margin: 0 }}>
          <label className="form-label">Qty {index === 0 ? '*' : ''}</label>
          <input type="number" min="0" step="any" className="form-input" value={line.quantity} onChange={(e) => onChange(index, { quantity: e.target.value })} />
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <button type="button" className="icon-btn icon-btn-red" title="Remove line"
            onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {line.tracksBatch && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label className="form-label">Batch *</label>
            <input className="form-input" value={line.batchNo} placeholder="Batch no. to move" onChange={(e) => onChange(index, { batchNo: e.target.value })} />
          </div>
          {batches && batches.length > 0 && (
            <div className="form-group" style={{ flex: 1.4, margin: 0 }}>
              <label className="form-label" title="Batches the from-godown holds right now">In stock</label>
              <select className="form-input" value="" onChange={(e) => {
                const b = batches.find((x) => x.batchNo === e.target.value);
                if (b) onChange(index, { batchNo: b.batchNo, expDate: b.expDate });
              }}>
                <option value="">Pick a batch in stock…</option>
                {batches.map((b) => <option key={b.batchNo} value={b.batchNo}>{b.label}</option>)}
              </select>
            </div>
          )}
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label className="form-label">Expires on</label>
            <input type="date" className="form-input" value={line.expDate} onChange={(e) => onChange(index, { expDate: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}
