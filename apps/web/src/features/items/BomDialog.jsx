import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from '../../components/ui/Toast';
import { Dialog, Field, Actions, FormErrors } from '../godowns/godownParts';
import { bomPreview, itemBom, saveItemBom } from '../../lib/data/godowns';

// The Bill of materials dialog (Items screen, the "BOM" row action on an item that tracks stock): what one unit
// is made of — component, quantity, scrap %, note — saved with PUT /v1/items/:id/bom (which replaces the whole
// list), with the cost of one unit live as it is typed. Components come from the typed items catalog, and an
// item can not be its own component (the API refuses that too).

const blankLine = () => ({ componentItemId: '', quantity: '', scrapPercent: '', note: '' });

export default function BomDialog({ item, typedItems, onClose, onSaved }) {
  const [lines, setLines] = useState([blankLine()]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const others = typedItems.filter((i) => i.id !== item.id);

  useEffect(() => {
    itemBom(item.id)
      .then((r) => {
        setLoaded(true);
        setLines(r.lines.length
          ? r.lines.map((l) => {
              const comp = typedItems.find((i) => i.id === l.componentItemId) ?? null;
              return { componentItemId: l.componentItemId, quantity: String(l.quantity), scrapPercent: l.scrapPercent ? String(l.scrapPercent) : '', note: l.note || '', _name: comp?.name || '' };
            })
          : [blankLine()]);
      })
      .catch((e) => { setLoaded(true); setError(e); });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = bomPreview(lines, typedItems);

  const setLine = (i, patch) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    const usable = lines.filter((l) => l.componentItemId && Number(l.quantity) > 0);
    const problems = [];
    for (const [i, l] of lines.filter((l) => l.componentItemId || Number(l.quantity) > 0).entries()) {
      if (!l.componentItemId) problems.push(`Line ${i + 1}: pick a component.`);
      else if (!(Number(l.quantity) > 0)) problems.push(`Line ${i + 1}: the quantity must be more than zero.`);
      else if (l.componentItemId === item.id) problems.push(`Line ${i + 1}: an item can not be its own component.`);
      const scrap = Number(l.scrapPercent);
      if (l.scrapPercent !== '' && (!Number.isFinite(scrap) || scrap < 0 || scrap > 100)) problems.push(`Line ${i + 1}: scrap % must be 0–100.`);
    }
    if (problems.length) { setMessages(problems); return; }
    setMessages([]);
    try {
      await saveItemBom(item.id, usable.map((l) => ({
        componentItemId: l.componentItemId,
        quantity: Number(l.quantity),
        ...(Number(l.scrapPercent) > 0 ? { scrapPercent: Number(l.scrapPercent) } : {}),
        ...(l.note.trim() ? { note: l.note.trim() } : {}),
      })));
      toast(usable.length ? `Bill of materials saved — one ${item.name} costs ${preview.unitCost} to make` : 'Bill of materials cleared', 'success', 8000);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Dialog title={`Bill of materials — ${item.name}`} onClose={onClose} width={680}>
      <FormErrors error={error} />
      {messages.length > 0 && (
        <div className="glass-panel p-4" role="alert" style={{ marginTop: 8, borderColor: '#d97706' }}>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#b45309' }}>{messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {!loaded ? (
        <p className="field-hint">Reading the bill of materials…</p>
      ) : (
        <>
          <p className="field-hint" style={{ marginTop: 4 }}>
            What one {item.name} is made of. Saving replaces the whole list.
          </p>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 2, margin: 0 }}>
                <label className="form-label">Component {i === 0 ? '*' : ''}</label>
                <select className="form-input" value={l.componentItemId}
                  onChange={(e) => setLine(i, { componentItemId: e.target.value, _name: (typedItems.find((x) => x.id === e.target.value) || {}).name || '' })}>
                  <option value="">Pick an item</option>
                  {others.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 0.6, margin: 0 }}>
                <label className="form-label">Qty {i === 0 ? '*' : ''}</label>
                <input type="number" min="0" step="any" className="form-input" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 0.6, margin: 0 }}>
                <label className="form-label" title="Extra material allowed for wastage, as a percent">Scrap %</label>
                <input type="number" min="0" max="100" step="any" className="form-input" value={l.scrapPercent} onChange={(e) => setLine(i, { scrapPercent: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 1.4, margin: 0 }}>
                <label className="form-label">Note</label>
                <input type="text" className="form-input" maxLength={300} value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <button type="button" className="icon-btn icon-btn-red" title="Remove component" onClick={() => setLines((cur) => (cur.length > 1 ? cur.filter((_, j) => j !== i) : [blankLine()]))}>
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          <button className="btn btn-secondary" onClick={() => setLines((cur) => [...cur, blankLine()])}>
            <Plus size={14} /> Add component
          </button>
          {preview.rows.length > 0 && (
            <div className="glass-panel p-4 mt-4">
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                <span>Cost of one {item.name}: <strong>{preview.unitCost}</strong></span>
                <span className="field-hint" style={{ margin: 0 }}>from the components' purchase prices, scrap included</span>
              </div>
            </div>
          )}
        </>
      )}
      <Actions onCancel={onClose} onSave={save} label="Save BOM" />
    </Dialog>
  );
}
