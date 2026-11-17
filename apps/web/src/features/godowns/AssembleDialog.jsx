import { useEffect, useState } from 'react';
import { toast } from '../../components/ui/Toast';
import { localToday } from '../../utils';
import { Dialog, Field, Actions, FormErrors } from './godownParts';
import { itemBom, createManufactureRun, godownPickerOptions, listGodowns, validateAssembleForm } from '../../lib/data/godowns';

// The Make / Assemble dialog (Godowns › Manufacture and the Items screen's Assemble row action, one dialog for
// both): pick the product (or arrive with it picked), see its bill of materials and what one unit costs, choose
// the quantity and the godown it is produced into, and POST /v1/godowns/manufacture. The returned run number and
// unit cost become the success line.

export default function AssembleDialog({ item: fixedItem = null, items = null, godowns = null, defaultId = null, onClose, onSaved }) {
  // `item` pins the product (Items › Assemble); `items` offers every stock-tracked item instead (Godowns › Manufacture).
  const [itemId, setItemId] = useState(fixedItem?.id || '');
  const [f, setF] = useState({ runDate: localToday(), quantity: '1', godownId: '', note: '' });
  const [bom, setBom] = useState(null); // { rows, unitCost } from the API's BOM, joined to names
  const [gd, setGd] = useState(godowns);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    if (!godowns) listGodowns().then((r) => setGd(r.data)).catch(() => setGd([]));
    if (!fixedItem && itemId) setBom(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The BOM is read as soon as the product is known — also when the caller pinned one.
  useEffect(() => {
    const id = fixedItem?.id || itemId;
    if (!id) { setBom(null); return; }
    let alive = true;
    itemBom(id)
      .then((r) => {
        if (!alive) return;
        const rows = r.lines.map((l) => {
          const comp = items?.find((i) => i.id === l.componentItemId) ?? null;
          const need = Math.round(l.quantity * (1 + (Number(l.scrapPercent) || 0) / 100) * 1000) / 1000;
          return { ...l, name: comp?.name || 'Item', need, cost: Math.round(need * (Number(comp?.purchasePrice) || 0) * 100) / 100 };
        });
        setBom({ rows, unitCost: r.unitCost, count: r.lines.length });
      })
      .catch((e) => { if (alive) { setBom({ rows: [], unitCost: 0, count: 0, problem: e }); } });
    return () => { alive = false; };
  }, [fixedItem?.id, itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const problems = validateAssembleForm({ runDate: f.runDate, itemId, quantity: f.quantity });
    if (problems.length) { setMessages(problems); return; }
    setMessages([]);
    try {
      const r = await createManufactureRun({
        runDate: f.runDate,
        itemId,
        quantity: Number(f.quantity),
        ...(f.godownId ? { godownId: f.godownId } : {}),
        ...(f.note.trim() ? { note: f.note.trim() } : {}),
      });
      toast(`${r.number} saved — ${Number(f.quantity)} made at ${r.unitCost} per unit`, 'success', 8000);
      onSaved?.(r);
      onClose();
    } catch (e) {
      setError(e);
    }
  };

  const chosen = items?.find((i) => i.id === itemId) ?? null;
  const pickers = godownPickerOptions(gd ?? [], defaultId);
  return (
    <Dialog title="Make from bill of materials" onClose={onClose} width={620}>
      {messages.length > 0 && (
        <div className="glass-panel p-4" role="alert" style={{ marginTop: 8, borderColor: '#d97706' }}>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#b45309' }}>{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      <FormErrors error={error} />
      <div className="grid grid-cols-2 gap-4">
        {fixedItem ? (
          <Field label="Product" title="The item this bill of materials makes">
            <input className="form-input" value={fixedItem.name} disabled />
          </Field>
        ) : (
          <Field label="Product *" title="Every item that tracks stock; pick one that has a bill of materials">
            <select className="form-input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Pick an item</option>
              {(items ?? []).filter((i) => i.trackStock).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Quantity *">
          <input type="number" min="0" step="any" className="form-input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        </Field>
        <Field label="Date">
          <input type="date" className="form-input" value={f.runDate} onChange={(e) => setF({ ...f, runDate: e.target.value })} />
        </Field>
        <Field label="Made in" title="Left empty, the run is produced into the default godown">
          <select className="form-input" value={f.godownId} onChange={(e) => setF({ ...f, godownId: e.target.value })}>
            <option value="">Default godown</option>
            {pickers.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </Field>
        <Field label="Note">
          <input type="text" className="form-input" value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
      {itemId && (
        <div className="glass-panel p-4 mt-4">
          <h4 style={{ margin: '0 0 6px', fontWeight: 600, fontSize: '0.85rem' }}>Bill of materials</h4>
          {!bom ? (
            <p className="field-hint" style={{ margin: 0 }}>Reading the bill of materials…</p>
          ) : bom.problem ? (
            <p className="field-hint" style={{ margin: 0, color: '#b91c1c' }}>{bom.problem?.body?.error?.message || 'Could not read the bill of materials.'}</p>
          ) : bom.count === 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>{chosen ? `${chosen.name} has no bill of materials — add its components on the Items screen first.` : 'This item has no bill of materials yet — add its components first.'}</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Component</th><th>Per unit</th><th>With scrap</th><th style={{ textAlign: 'right' }}>Cost</th></tr></thead>
                <tbody>
                  {bom.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.quantity}</td>
                      <td className="field-hint">{r.need}</td>
                      <td style={{ textAlign: 'right' }}>{r.cost}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}><strong>Cost of one unit</strong></td><td style={{ textAlign: 'right' }}><strong>{bom.unitCost}</strong></td></tr></tfoot>
              </table>
            </div>
          )}
          {bom && !bom.problem && bom.count > 0 && (
            <p className="field-hint" style={{ margin: '6px 0 0' }}>
              Making {Number(f.quantity) || 0} uses the components above × {Number(f.quantity) || 0}, and the run is valued at {bom.unitCost} × {Number(f.quantity) || 0}.
            </p>
          )}
        </div>
      )}
      <Actions onCancel={onClose} onSave={save} disabled={!itemId} label="Make" />
    </Dialog>
  );
}
