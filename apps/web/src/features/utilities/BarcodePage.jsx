import { useEffect, useMemo, useState } from 'react';
import { ScanBarcode } from 'lucide-react';
import { LABEL_SHEETS, sheetById, sheetProblem } from '@ledgora/tax-engine';
import PageHeader from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { toast } from '../../components/ui/Toast';
import { assignBarcodes, listAllItems, loadBarcodePreset, saveBarcodePreset } from '../../lib/data/utilities';
import { DEFAULT_SHOW, labelSvg, labelsHtml, printHtml } from './labels';
import { errText, useBusiness } from './shared';

// Vyapar parity P7-S1: the Barcode Generator. Pick items, a label sheet, a barcode type, copies and what to show; the
// preview is the first page as it will print. Items with no barcode get the next in-store EAN-13 (saved, serialised by
// the server, so two people printing at once never share a code). Printing goes through the browser, which also saves
// a PDF. Code 128, EAN-13 and QR (medium error correction) are drawn.

const SHOW_LABELS = { name: 'Name', price: 'Price', mrp: 'MRP', code: 'Code', business: 'Business name' };
const CUSTOM = { id: 'custom', label: 'Custom size…', pageW: 210, pageH: 297, cols: 3, rows: 8, labelW: 63.5, labelH: 33.9, gapX: 2.54, gapY: 0, marginLeft: 7.2, marginTop: 15.15 };

export default function BarcodePage() {
  const { biz, loading, error } = useBusiness();
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [sheetId, setSheetId] = useState('a4-65');
  const [custom, setCustom] = useState(CUSTOM);
  const [type, setType] = useState('ean13');
  const [copies, setCopies] = useState(1);
  const [byStock, setByStock] = useState(false);
  const [show, setShow] = useState(DEFAULT_SHOW);
  const [startAt, setStartAt] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => { listAllItems().then(setItems, setLoadError); }, []);
  // The label size, barcode type and what to show are remembered for the business.
  useEffect(() => {
    if (!biz) return;
    loadBarcodePreset(biz.id).then((p) => {
      if (!p) return;
      if (p.sheetId) setSheetId(p.sheetId);
      if (p.custom) setCustom({ ...CUSTOM, ...p.custom });
      if (p.type) setType(p.type);
      if (p.show) setShow({ ...DEFAULT_SHOW, ...p.show });
      if (p.copies) setCopies(p.copies);
      if (typeof p.byStock === 'boolean') setByStock(p.byStock);
    }).catch(() => {});
  }, [biz]);
  const savePreset = async () => {
    try { await saveBarcodePreset(biz.id, { sheetId, custom, type, show, copies: Number(copies) || 1, byStock }); toast('Label settings saved for this business', 'success'); } catch (e) { toast(errText(e), 'error'); }
  };
  const sheet = sheetId === 'custom' ? custom : sheetById(sheetId);
  const problem = sheetId === 'custom' ? sheetProblem(custom) : '';
  const shown = useMemo(() => (items ?? []).filter((i) => `${i.name} ${i.sku ?? ''} ${i.extra?.barcode ?? ''}`.toLowerCase().includes(q.toLowerCase())), [items, q]);
  const chosen = useMemo(() => (items ?? []).filter((i) => picked.has(i.id)), [items, picked]);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toLabel = (i) => ({ id: i.id, name: i.name, code: i.extra?.barcode || '', price: i.salePrice, mrp: i.extra?.mrp ?? null, stock: i.stock });
  const missing = chosen.filter((i) => !i.extra?.barcode);

  const job = (list) => ({ sheet, type, show, businessName: biz?.name ?? '', copies: byStock ? 'stock' : Math.max(1, Number(copies) || 1), startAt, items: list.map(toLabel) });
  const preview = useMemo(() => {
    if (!chosen.length || problem) return null;
    const o = job(chosen);
    const first = chosen[0];
    return { svg: labelSvg(toLabel(first), o), ...labelsHtml(o.items, o) };
  }, [chosen, sheet, type, show, copies, byStock, startAt, biz]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Gives the chosen items without a code their in-store EAN-13 first, then returns the items with their codes. */
  const withCodes = async () => {
    if (!missing.length) return chosen;
    const r = await assignBarcodes(missing.map((m) => m.id));
    const codes = new Map(r.assigned.map((a) => [a.id, a.code]));
    const next = items.map((i) => (codes.has(i.id) ? { ...i, extra: { ...i.extra, barcode: codes.get(i.id) } } : i));
    setItems(next);
    return next.filter((i) => picked.has(i.id));
  };
  const generate = async () => {
    setBusy(true);
    try { const list = await withCodes(); toast(`${missing.length} item${missing.length === 1 ? '' : 's'} got a barcode`, 'success'); return list; } catch (e) { toast(errText(e), 'error'); return null; } finally { setBusy(false); }
  };
  const print = async () => {
    setBusy(true);
    try {
      const list = await withCodes();
      const o = job(list);
      printHtml(labelsHtml(o.items, o).html);
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  if (error || loadError) return <ErrorState message={errText(error || loadError)} onRetry={() => window.location.reload()} />;
  if (loading || !items) return <LoadingState label="Loading items…" />;
  const num = (k) => (e) => setCustom({ ...custom, [k]: Number(e.target.value) });

  return (
    <div className="dashboard-container">
      <PageHeader icon={<ScanBarcode size={22} />} title="Barcode Generator" subtitle="Print barcode labels for your items on a label sheet or a roll. Items without a barcode get one." />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)', gap: '1rem' }}>
        <div className="glass-panel p-4" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div>
            <label className="form-label" htmlFor="bc-q">Items ({picked.size} selected)</label>
            <input id="bc-q" className="form-input" placeholder="Search name, code or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, marginTop: 6 }}>
              <label style={{ display: 'flex', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border-color)' }}>
                <input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((i) => picked.has(i.id))} onChange={(e) => setPicked((p) => { const n = new Set(p); shown.forEach((i) => (e.target.checked ? n.add(i.id) : n.delete(i.id))); return n; })} /> Select all shown
              </label>
              {shown.map((i) => (
                <label key={i.id} style={{ display: 'flex', gap: 8, padding: '4px 8px', alignItems: 'center' }}>
                  <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                  <span style={{ flex: 1 }}>{i.name}</span>
                  <small style={{ color: 'var(--text-secondary)' }}>{i.extra?.barcode || 'no barcode'}</small>
                </label>
              ))}
              {!shown.length && <div className="field-hint" style={{ padding: 10 }}>{items.length ? 'No item matches.' : 'No items yet. Add items in Products, or import them on the POS screen.'}</div>}
            </div>
          </div>
          <label className="form-label">Label size
            <select className="form-input" value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
              {LABEL_SHEETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              <option value="custom">Custom size…</option>
            </select>
          </label>
          {sheetId === 'custom' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {[['labelW', 'Label W mm'], ['labelH', 'Label H mm'], ['cols', 'Columns'], ['rows', 'Rows'], ['gapX', 'Gap X'], ['gapY', 'Gap Y'], ['marginLeft', 'Left margin'], ['marginTop', 'Top margin'], ['pageW', 'Page W'], ['pageH', 'Page H']].map(([k, l]) => (
                <label key={k} className="form-label" style={{ fontSize: '0.72rem' }}>{l}<input className="form-input" type="number" step="0.1" value={custom[k]} onChange={num(k)} /></label>
              ))}
              {problem && <div className="pos-bad" role="alert" style={{ gridColumn: '1 / -1', color: 'var(--danger, #dc2626)' }}>{problem}</div>}
            </div>
          )}
          <div role="radiogroup" aria-label="Barcode type" style={{ display: 'flex', gap: 14 }}>
            <strong style={{ fontSize: '0.8rem' }}>Barcode type</strong>
            {[['ean13', 'EAN-13'], ['code128', 'Code 128'], ['qr', 'QR']].map(([v, l]) => <label key={v}><input type="radio" name="bctype" checked={type === v} onChange={() => setType(v)} /> {l}</label>)}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
            <label className="form-label" style={{ flex: 1 }}>Copies per item<input className="form-input" type="number" min="1" max="1000" disabled={byStock} value={copies} onChange={(e) => setCopies(e.target.value)} /></label>
            <label style={{ paddingBottom: 8 }}><input type="checkbox" checked={byStock} onChange={(e) => setByStock(e.target.checked)} /> = stock qty</label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '0.8rem' }}>Show</strong>
            {Object.entries(SHOW_LABELS).map(([k, l]) => <label key={k}><input type="checkbox" checked={!!show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {l}</label>)}
          </div>
          <label className="form-label">Start at label<input className="form-input" type="number" min="1" disabled={sheet.cols * sheet.rows === 1} value={startAt} onChange={(e) => setStartAt(Math.max(1, Number(e.target.value) || 1))} />
            <span className="field-hint">To reuse a partly used sheet.</span></label>
          {missing.length > 0 && <div className="field-hint" role="status">{missing.length} selected item{missing.length === 1 ? ' has' : 's have'} no barcode. Printing gives each the next in-store code (200…).</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" disabled={busy || !missing.length} onClick={generate}>Generate missing codes</button>
            <button className="btn btn-secondary" disabled={!!problem} onClick={savePreset}>Save these settings</button>
            <button className="btn btn-primary" disabled={busy || !chosen.length || !!problem} onClick={print}>Print / Save as PDF</button>
          </div>
        </div>

        <div className="glass-panel p-4" aria-label="Preview">
          <h3 className="section-title" style={{ marginTop: 0 }}>Preview</h3>
          {!preview ? <p className="field-hint">Select one or more items to see the labels.</p> : (
            <>
              <div data-testid="label-preview" style={{ border: '1px dashed var(--border-color)', display: 'inline-block', padding: 6, background: '#fff' }} dangerouslySetInnerHTML={{ __html: preview.svg }} />
              <p className="field-hint">{preview.labels} label{preview.labels === 1 ? '' : 's'} on {preview.pages} page{preview.pages === 1 ? '' : 's'}. The preview shows the first label at its real size.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
