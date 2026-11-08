import { useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatMoney } from './lib/format';
import { lineColumnsFor, nextCell, parsePastedRows } from './lib/grid';

// Item lines like a spreadsheet (P0-S3.6), for every document that has them: Sale, Purchase, Order, Return,
// Expense. Tab / Shift+Tab / Enter move between cells, Enter on the last cell adds a row, Ctrl+Backspace removes the
// row, and rows copied from Excel paste in one go.
//
// It edits plain line objects ({ item, hsn, qty, unit, rate, discount, gst, itc, batch }) and works out nothing
// itself: `amountOf(line)` comes from the caller, so the tax engine stays the only place that does GST maths. The
// invoice editor keeps its own LineItemsGrid until Phase 2 moves it onto this one.

const HEAD = {
  item: 'Item',
  hsn: 'HSN/SAC',
  batch: 'Batch',
  qty: 'Qty',
  unit: 'Unit',
  rate: 'Rate',
  discount: 'Disc %',
  gst: 'GST %',
  itc: 'ITC',
  amount: 'Amount',
};
const NUMERIC = new Set(['qty', 'rate', 'discount', 'gst']);
const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];

export const blankLine = () => ({ item: '', hsn: '', qty: 1, unit: 'NOS', rate: '', discount: '', gst: 18, itc: true });

export default function LinesGrid({ docType = 'sale', lines, onChange, amountOf = () => 0, batch = false, units = ['NOS', 'KGS', 'LTR', 'MTR', 'BOX', 'PCS'], renderItemCell }) {
  const columns = lineColumnsFor(docType, { batch });
  const editable = columns.filter((c) => c !== 'amount');
  const table = useRef(null);

  const focusCell = (row, col) => {
    requestAnimationFrame(() => {
      table.current?.querySelector(`[data-cell="${row}:${col}"]`)?.focus();
    });
  };
  const setField = (i, field, value) => onChange(lines.map((l, j) => (j === i ? { ...l, [field]: value } : l)));
  const addRow = (at = lines.length) => onChange([...lines.slice(0, at), blankLine(), ...lines.slice(at)]);
  const removeRow = (i) => onChange(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blankLine()]);

  const onKeyDown = (e, row, col) => {
    if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      removeRow(row);
      focusCell(Math.max(0, row - 1), col);
      return;
    }
    if (!['Tab', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.tagName === 'SELECT') return;
    const to = nextCell({ row, col }, { rows: lines.length, cols: editable.length }, e.key, e.shiftKey);
    if (to.row === row && to.col === col) return; // let Tab leave the grid from its first or last cell
    e.preventDefault();
    if (to.addRow) addRow();
    focusCell(to.row, to.col);
  };

  const onPaste = (e, row, col) => {
    const parsed = parsePastedRows(e.clipboardData?.getData('text/plain'), editable.slice(col));
    if (!parsed) return;
    e.preventDefault();
    const next = [...lines];
    parsed.forEach((p, k) => {
      const i = row + k;
      const clean = Object.fromEntries(Object.entries(p).map(([f, v]) => [f, NUMERIC.has(f) ? Number(String(v).replace(/,/g, '')) || 0 : v]));
      next[i] = { ...(next[i] || blankLine()), ...clean };
    });
    onChange(next);
  };

  const cell = (line, field, row, col) => {
    const common = {
      'data-cell': `${row}:${col}`,
      'aria-label': `${HEAD[field]}, line ${row + 1}`,
      onKeyDown: (e) => onKeyDown(e, row, col),
      onPaste: (e) => onPaste(e, row, col),
    };
    if (field === 'item' && renderItemCell) return renderItemCell({ line, row, setField: (f, v) => setField(row, f, v), inputProps: common });
    if (field === 'unit')
      return (
        <select {...common} value={line.unit ?? ''} onChange={(e) => setField(row, 'unit', e.target.value)}>
          {units.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      );
    if (field === 'gst')
      return (
        <select {...common} value={line.gst ?? ''} onChange={(e) => setField(row, 'gst', Number(e.target.value))}>
          {GST_RATES.map((r) => (
            <option key={r} value={r}>
              {r}%
            </option>
          ))}
        </select>
      );
    if (field === 'itc')
      return (
        <span style={{ display: 'flex', justifyContent: 'center' }}>
          <input {...common} type="checkbox" style={{ width: 16, height: 16 }} checked={line.itc !== false} onChange={(e) => setField(row, 'itc', e.target.checked)} />
        </span>
      );
    return (
      <input
        {...common}
        type="text"
        inputMode={NUMERIC.has(field) ? 'decimal' : undefined}
        className={NUMERIC.has(field) ? 'ui-input-num' : undefined}
        value={line[field] ?? ''}
        onChange={(e) => setField(row, field, NUMERIC.has(field) ? e.target.value.replace(/[^\d.]/g, '') : e.target.value)}
      />
    );
  };

  return (
    <div>
      <div className="ui-table-scroll">
        <table className="ui-lines" ref={table}>
          <thead>
            <tr>
              <th scope="col" style={{ width: 36 }}>
                #
              </th>
              {columns.map((c) => (
                <th key={c} scope="col" style={{ textAlign: NUMERIC.has(c) || c === 'amount' ? 'right' : undefined, width: c === 'item' ? undefined : c === 'itc' ? 48 : 96 }}>
                  {HEAD[c]}
                </th>
              ))}
              <th scope="col" style={{ width: 40 }}>
                <span className="ui-visually-hidden">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, row) => (
              <tr key={row}>
                <td className="ui-lines-idx">{row + 1}</td>
                {columns.map((c) =>
                  c === 'amount' ? (
                    <td key={c} className="ui-lines-amt">
                      {formatMoney(amountOf(line))}
                    </td>
                  ) : (
                    <td key={c}>{cell(line, c, row, editable.indexOf(c))}</td>
                  ),
                )}
                <td style={{ textAlign: 'center' }}>
                  <button type="button" className="ui-icon-btn" aria-label={`Remove line ${row + 1}`} tabIndex={-1} onClick={() => removeRow(row)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="ui-btn ui-btn-ghost ui-lines-add" onClick={() => addRow()}>
        <Plus size={15} aria-hidden="true" /> Add row
      </button>
    </div>
  );
}
