import { useState } from 'react';
import { Plus, Truck, ScanBarcode } from 'lucide-react';
import { filterUnitsByMode } from '../../../utils';
import { LineItem } from './LineItemRow';
import DiscountControls from './DiscountControls';
import { useAppSettings } from '../../../lib/appSettings';

// The line-items table with add, delete, discount and unit controls (change 3.9).
export default function LineItemsGrid({
  addDeliveryCharge, billTotal = 0, billDate = '', scanBarcode, batchOptionsFor, serialStockFor, productOf, addItem, clampNonNeg, countryTaxRates, getProductSuggestions, handleAddCustomUnit, handleItemChange, handleRemoveCustomUnit, hasDeliveryCharge, invoiceOptions, items, profile, removeItem, selectProduct, setInvoiceOptions, setProductSearch, setTaxInclusive, showGST, taxInclusive, taxLabel, units,
}) {
  const appSettings = useAppSettings();
  const [scan, setScan] = useState('');
  return (
          <div className="glass-panel p-6 mb-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Line Items</h3>
              {showGST && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={taxInclusive} onChange={e => setTaxInclusive(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                  <span style={{ fontWeight: 500 }}>Prices include tax</span>
                </label>
              )}
            </div>
            {scanBarcode && (
              <div className="form-group" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: '0.5rem' }}>
                <ScanBarcode size={18} aria-hidden="true" />
                <input className="form-input" style={{ maxWidth: 320 }} placeholder="Scan a barcode" aria-label="Scan a barcode" value={scan} autoComplete="off"
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (scan.trim() && scanBarcode(scan.trim())) setScan(''); } }} />
              </div>
            )}
            {items.map((item, idx) => (
              <LineItem
                key={item.id}
                item={item}
                invoiceOptions={invoiceOptions}
                taxInclusive={taxInclusive}
                showGST={showGST}
                taxLabel={taxLabel}
                units={units}
                countryTaxRates={countryTaxRates}
                filterUnitsByMode={filterUnitsByMode}
                invoiceMode={invoiceOptions.invoiceMode}
                currency={invoiceOptions.currency}
                profileCountry={profile?.country}
                suggestions={getProductSuggestions(item.id)}
                onFieldChange={handleItemChange}
                onSelectProduct={selectProduct}
                onSetProductSearch={setProductSearch}
                onAddCustomUnit={handleAddCustomUnit}
                onRemoveCustomUnit={handleRemoveCustomUnit}
                onRemove={removeItem}
                clampNonNeg={clampNonNeg}
                isLastRow={idx === items.length - 1}
                isOnlyRow={items.length === 1}
                batches={appSettings['item.batch'] ? batchOptionsFor(item) : null}
                serialStock={appSettings['item.serial'] ? serialStockFor(item) : null}
                product={productOf(item)}
                settings={appSettings}
                onAddRow={addItem}
              />
            ))}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-secondary mt-2" onClick={addItem}><Plus size={18} /> Add Item</button>
              {!hasDeliveryCharge && (
                <button type="button" className="btn btn-secondary mt-2" onClick={addDeliveryCharge}
                  title="Adds a 'Delivery charges' line, taxed at the goods' GST rate (composite supply)">
                  <Truck size={16} /> Delivery charges
                </button>
              )}
              {hasDeliveryCharge && showGST && (
                <span className="mt-2" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Delivery is taxed like the goods it ships with (composite supply), so it starts at the highest GST rate on this invoice. Change it if needed.
                </span>
              )}
            </div>

            <DiscountControls invoiceOptions={invoiceOptions} setInvoiceOptions={setInvoiceOptions} clampNonNeg={clampNonNeg} billTotal={billTotal} billDate={billDate} />
          </div>
  );
}
