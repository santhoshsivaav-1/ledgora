// One row of the line-items table, and the item-name box that suggests products as you type (change 3.9).
import { useState, useEffect, memo } from 'react';
import { Trash2 } from 'lucide-react';
import { formatCurrency } from '../../../utils';
import { promptAction } from '../../../components/ui/ConfirmModal';
import { suggestGstRate } from '@ledgora/tax-engine';
import { toast } from '../../../components/ui/Toast';
import { currencySymbolFor } from './editorConstants';

// v1.10.37 — Sub-component: the Description input + product-suggestion
// dropdown, with keyboard navigation. Extracted so LineItem stays lean
// and the local `activeIdx` state doesn't cause other row fields to
// re-render on every arrow-key press.
export function SuggestingInput({ item, suggestions, onFieldChange, onSelectProduct, onSetProductSearch, currency }) {
  const [activeIdx, setActiveIdx] = useState(-1);
  // Reset the highlighted suggestion when the query changes so ArrowDown
  // starts from the top rather than continuing a stale index.
  useEffect(() => { setActiveIdx(-1); }, [item.name, suggestions.length]);
  const commit = (idx) => {
    const pick = suggestions[idx] ?? suggestions[0];
    if (pick) onSelectProduct(item.id, pick);
  };
  const handleKey = (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // Only intercept Enter if the user has actively navigated to a
      // suggestion. Otherwise fall through so the row's "last-row add"
      // shortcut can fire. Prevents double-fire on the last row.
      if (activeIdx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        commit(activeIdx);
      }
    } else if (e.key === 'Escape') {
      onSetProductSearch({ itemId: null, query: '' });
    }
  };
  return (
    <>
      <input type="text" className="form-input" value={item.name}
        placeholder="Item"
        onChange={(e) => onFieldChange(item.id, 'name', e.target.value)}
        onBlur={() => setTimeout(() => onSetProductSearch({ itemId: null, query: '' }), 200)}
        onKeyDown={handleKey}
        autoComplete="off" />
      {suggestions.length > 0 && (
        <div className="product-suggestions" role="listbox">
          {suggestions.map((p, i) => (
            <div key={p.id} className="product-suggestion-item"
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={() => onSelectProduct(item.id, p)}
              style={i === activeIdx ? { background: 'var(--primary-light, rgba(30,64,175,0.12))' } : undefined}>
              <span className="product-suggestion-name">{p.name}</span>
              <span className="product-suggestion-meta">
                {p.hsn && `HSN: ${p.hsn}`}{p.hsn && p.rate ? ' · ' : ''}{p.rate ? formatCurrency(p.rate, currency || 'INR') : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export const LineItem = memo(function LineItem({
  item, invoiceOptions, showGST, taxLabel,
  units, countryTaxRates, filterUnitsByMode, invoiceMode,
  currency, profileCountry, suggestions,
  onFieldChange, onSelectProduct, onSetProductSearch,
  onAddCustomUnit, onRemoveCustomUnit, onRemove, clampNonNeg,
  isLastRow, onAddRow, isOnlyRow,
}) {
  // v1.10.37 — Keyboard shortcut: Enter on any input inside the LAST
  // row adds a new row. Muscle-memory for POS users — reported: "if
  // user hits Enter on last item field the natural expectation is a
  // new blank row". Excludes Shift+Enter (soft newline in text
  // fields) and only fires on isLastRow to avoid Enter-mashing on
  // middle rows creating trailing empty rows.
  const handleRowKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || !isLastRow) return;
    // Only fire when the input has SOME meaningful content in the
    // row, so an accidental Enter on a completely blank row doesn't
    // spawn a new blank row.
    const hasContent = (item.name && item.name.trim()) || Number(item.rate) > 0 || Number(item.quantity) > 0;
    if (!hasContent) return;
    e.preventDefault();
    onAddRow?.();
  };
  return (
    <div className="line-item-row" data-item-id={item.id} onKeyDown={handleRowKeyDown}>
      <div className="line-item-field" style={{ flex: 2.5, position: 'relative' }}>
        {/* v1.10.74 - was "Description", which clashed with "+ Add description" below. */}
        <label className="form-label">Item</label>
        {/* v1.10.37 — Keyboard nav on product suggestions. Reported:
            "20 invoices/day is slow because product picker forces the
            mouse." Now: ArrowDown / ArrowUp cycles suggestions, Enter
            commits the highlighted one (or the first if none is
            highlighted). Escape closes the dropdown. Highlighted index
            resets when the query changes. */}
        <SuggestingInput
          item={item}
          suggestions={suggestions}
          onFieldChange={onFieldChange}
          onSelectProduct={onSelectProduct}
          onSetProductSearch={onSetProductSearch}
          currency={currency}
        />
      </div>
      {invoiceOptions.showHSN && (
        <div className="line-item-field" style={{ flex: 1, position: 'relative' }}>
          <label className="form-label">HSN/SAC</label>
          <input type="text" className="form-input" value={item.hsn}
            onChange={(e) => {
              const val = e.target.value;
              onFieldChange(item.id, 'hsn', val);
              // v1.10.22 — Suggest GST rate from a curated HSN/SAC table.
              // Only overwrites the tax rate when the user has NOT already
              // typed a custom rate (default 18 is treated as "unset").
              const suggested = suggestGstRate(val);
              if (suggested && (item.taxPercent === undefined || item.taxPercent === 18 || item.taxPercent === 0)) {
                onFieldChange(item.id, 'taxPercent', suggested.rate);
              }
            }} />
          {/* Show the label of the matched HSN inline so the user can
              confirm the code is right. Hidden until at least 4 chars. */}
          {(() => {
            const s = suggestGstRate(item.hsn);
            if (!s || !item.hsn || String(item.hsn).length < 4) return null;
            return (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, padding: '3px 6px', fontSize: '0.68rem', color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', zIndex: 1 }}
                title={`${s.label} — suggested ${s.rate}% GST`}>
                → {s.rate}% · {s.label}
              </div>
            );
          })()}
        </div>
      )}
      <div className="line-item-field" style={{ flex: 0.7 }}>
        <label className="form-label">Qty</label>
        <input type="number" min="0" step="any" className="form-input" value={item.quantity}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onFieldChange(item.id, 'quantity', clampNonNeg(e.target.value))} />
      </div>
      <div className="line-item-field" style={{ flex: 0.9 }}>
        <label className="form-label">Unit</label>
        <select className="form-input" value={item.unit || 'Nos'}
          onChange={(e) => {
            if (e.target.value === '__custom__') { onAddCustomUnit(item.id); return; }
            if (e.target.value.startsWith('__remove__::')) {
              const label = e.target.value.replace('__remove__::', '');
              onRemoveCustomUnit(label);
              return;
            }
            onFieldChange(item.id, 'unit', e.target.value);
          }}>
          {(() => {
            const visible = filterUnitsByMode(units, invoiceMode);
            const showCurrentExtra = item.unit && !visible.some(u => u.label === item.unit);
            return (
              <>
                {showCurrentExtra && <option value={item.unit}>{item.unit}</option>}
                {visible.map(u => (
                  <option key={u.label} value={u.label}>{u.label}{u.custom ? ' ★' : ''}</option>
                ))}
              </>
            );
          })()}
          <option value="__custom__">＋ Add custom…</option>
          {units.some(u => u.custom) && units.filter(u => u.custom).map(u => (
            <option key={`rm-${u.label}`} value={`__remove__::${u.label}`}>− Remove "{u.label}"</option>
          ))}
        </select>
      </div>
      <div className="line-item-field" style={{ flex: 1.2 }}>
        <label className="form-label">Rate</label>
        <input type="number" min="0" step="any" className="form-input" value={item.rate}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onFieldChange(item.id, 'rate', clampNonNeg(e.target.value))} />
      </div>
      {invoiceOptions.showDiscount && (
        <div className="line-item-field" style={{ flex: 1.8, minWidth: 200 }}>
          <label className="form-label">Discount</label>
          {/* v1.10.22 — two-mode discount: fixed rupees OR percent-of-line.
              v1.10.23 — wider min-width so value + mode selector stay
              readable on narrow rows.
              v1.10.25 — added third selector for the discount BASE when in
              fixed mode. Options: Net Amount (default), Unit Price (₹ off
              each unit × qty), Price With Tax (₹ off the tax-inclusive
              total — tax gets backed out so consumer sees clean round). */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <input type="number" min="0" step="any" className="form-input" value={item.discount}
              onFocus={(e) => e.target.select()}
              onChange={(e) => onFieldChange(item.id, 'discount', clampNonNeg(e.target.value))}
              style={{ flex: 1, minWidth: 55 }} />
            <select className="form-input"
              value={item.discountType === 'percent' ? 'percent' : 'fixed'}
              onChange={(e) => onFieldChange(item.id, 'discountType', e.target.value)}
              style={{ width: 52, padding: '0.4rem 0.3rem', fontSize: '0.82rem' }}
              title="Discount mode: fixed amount or percent of line">
              <option value="fixed">{currencySymbolFor(currency)}</option>
              <option value="percent">%</option>
            </select>
            {/* Base only meaningful for fixed-mode. Percent of any base is
                mathematically identical (proportional), so hide the
                selector when type='percent' to avoid dead UI. */}
            {item.discountType !== 'percent' && (
              <select className="form-input"
                value={item.discountBase || 'net'}
                onChange={(e) => { onFieldChange(item.id, 'discountBase', e.target.value); onFieldChange(item.id, 'withTaxRule', 2); }}
                style={{ width: 78, padding: '0.4rem 0.3rem', fontSize: '0.75rem' }}
                title="What the ₹ discount applies to. Net = qty×rate (default). Unit = ₹X off each unit. WithTax = ₹X off tax-inclusive total.">
                <option value="net">Net</option>
                <option value="unit">Unit</option>
                <option value="with-tax">W/Tax</option>
              </select>
            )}
          </div>
        </div>
      )}
      {showGST && (
        <div className="line-item-field" style={{ flex: 1 }}>
          <label className="form-label">{taxLabel} %</label>
          <select className="form-input"
            value={countryTaxRates.includes(Number(item.taxPercent)) ? String(item.taxPercent) : '__custom__'}
            onChange={async (e) => {
              if (e.target.value === '__custom__') {
                const raw = await promptAction({
                  title: `Custom ${taxLabel} rate`,
                  message: `Enter a ${taxLabel} rate between 0% and 100% (up to 2 decimals).`,
                  defaultValue: String(item.taxPercent || 0),
                  placeholder: 'e.g. 7.5',
                  inputType: 'number',
                  confirmLabel: 'Apply rate',
                });
                if (raw === null) return;
                const n = parseFloat(raw);
                if (!isFinite(n) || n < 0 || n > 100) { toast('Tax rate must be between 0 and 100', 'warning'); return; }
                onFieldChange(item.id, 'taxPercent', n);
              } else {
                onFieldChange(item.id, 'taxPercent', parseFloat(e.target.value) || 0);
              }
            }}>
            {countryTaxRates.map(r => (
              <option key={r} value={String(r)}>{r}%</option>
            ))}
            <option value="__custom__">{countryTaxRates.includes(Number(item.taxPercent)) ? 'Custom…' : `${item.taxPercent}% (custom)`}</option>
          </select>
        </div>
      )}
      {showGST && invoiceOptions.showCess && (profileCountry || 'India') === 'India' && (
        <div className="line-item-field" style={{ flex: 0.8 }}>
          <label className="form-label" title="GST Compensation Cess (tobacco / auto / coal etc.)">Cess %</label>
          <input type="number" min="0" max="500" step="any" className="form-input"
            value={item.cessPercent || 0}
            onChange={(e) => onFieldChange(item.id, 'cessPercent', clampNonNeg(e.target.value))} />
        </div>
      )}
      <div className="line-item-field line-item-delete">
        {/* v1.10.74 - removeItem keeps the last row, so the button did nothing there; say so. */}
        <button className="icon-btn icon-btn-red" onClick={() => onRemove(item.id)}
          disabled={isOnlyRow} title={isOnlyRow ? 'An invoice needs at least one line' : 'Remove'}><Trash2 size={16} /></button>
      </div>
      {/* v1.10.22 — inline expandable description per row. Reported: "add
          option so user can directly enter product description into
          invoice directly". Hidden by default; expands on click. Persists
          with the item and renders under the item name in the PDF/preview. */}
      <div className="line-item-description-row" style={{ flexBasis: '100%', marginTop: 4 }}>
        {item.description || item._descOpen ? (
          <textarea
            className="form-input"
            rows={2}
            placeholder="Description (optional, shown under this line in the PDF)"
            value={item.description || ''}
            onChange={(e) => onFieldChange(item.id, 'description', e.target.value)}
            style={{ fontSize: '0.82rem', resize: 'vertical', minHeight: 40 }} />
        ) : (
          <button type="button" className="btn btn-secondary"
            onClick={() => onFieldChange(item.id, '_descOpen', true)}
            style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', color: 'var(--text-muted)' }}
            title="Add a description that will show under this line in the PDF">
            + Add description
          </button>
        )}
      </div>
    </div>
  );
});
