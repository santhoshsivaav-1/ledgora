import { useCallback, useRef, useState } from 'react';
import { deliveryChargeLine, addCustomUnit, removeCustomUnit, getAllUnits, getDefaultUnitForMode, localToday } from '../../../utils';
import { getAllAppSettings } from '../../../lib/appSettings';
import { confirmAction, promptAction } from '../../../components/ui/ConfirmModal';
import { toast } from '../../../components/ui/Toast';
import { lineRateFor, unitFactorFor, itemDiscountFor, findByBarcode, batchStock, suggestBatch } from '../../items/itemExtras';

// Clamp a numeric input to non-negative (and finite). Used for qty/rate/discount.
export function clampNonNeg(raw) {
  const n = parseFloat(raw);
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

// The line-items side of the sheet: picking products (party rate → wholesale → selling price), editing a row
// (secondary-unit factors, wholesale rates), barcode scanning, delivery charge, custom units and removing rows.
// The `items` array itself stays with the page; every change goes through setItems.
export function useInvoiceItems({ showGST, defaultTaxRate, countryTaxRates, invoiceOptions, items, setItems, editingBillIdRef, allBillsRef, purchasesRef, partyRatesRef }) {
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState({ itemId: null, query: '' });
  const [units, setUnits] = useState(getAllUnits());
  const productsRef = useRef([]);
  productsRef.current = products;

  // v1.10.7 — audit H14: handlers wrapped in useCallback so the memoized
  // LineItem below sees stable references and only re-renders the ROW
  // that actually changed. Prior code created new function identities
  // every render → every keystroke re-rendered EVERY line item.
  const handleItemChange = useCallback((id, field, value) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const next = { ...item, [field]: value };
      const product = next.productId ? productsRef.current.find((p) => p.id === next.productId) : null;
      if (product && (field === 'unit' || field === 'quantity')) {
        // A line in the secondary unit moves stock by its factor and takes its own rate; wholesale follows the quantity.
        const unit = field === 'unit' ? value : next.unit;
        const qty = field === 'quantity' ? Number(value) || 0 : Number(next.quantity) || 0;
        next.unitFactor = unitFactorFor(product, unit);
        const s = getAllAppSettings();
        if (field === 'unit' || (s['item.wholesale'] && !next._rateEdited)) {
          next.rate = lineRateFor(product, { qty, unit, partyRates: partyRatesRef.current, s }).rate;
        }
      }
      if (field === 'rate') next._rateEdited = true;
      return next;
    }));
    if (field === 'name') {
      setProductSearch({ itemId: id, query: value });
    }
  }, []);

  const selectProduct = useCallback((itemId, product) => {
    // v1.10.29 — Prefer sellingPrice for sales invoices (falls back to
    // legacy `rate` for pre-v1.10.29 products).
    // Settings > Item / Party: the party's own rate, then wholesale from its minimum quantity, then the selling price.
    const s = getAllAppSettings();
    const { rate: salePrice } = lineRateFor(product, { qty: 1, partyRates: partyRatesRef.current, s });
    const discountPercent = itemDiscountFor(product, s);
    const batch = s['item.batch'] ? suggestBatch(batchStock(product, { bills: allBillsRef.current, purchases: purchasesRef.current, excludeBillId: editingBillIdRef.current }), localToday()) : null;
    setItems(prev => prev.map(item => item.id === itemId ? {
      ...item,
      name: product.name,
      hsn: product.hsn || '',
      rate: salePrice,
      unit: product.unit || item.unit || 'Nos',
      unitFactor: undefined,
      taxPercent: product.taxPercent ?? defaultTaxRate,
      productId: product.id,
      isCharge: false, // a product picked on the delivery line makes it a product line
      ...(s['item.mrp'] && product.mrp ? { mrp: product.mrp } : { mrp: undefined }),
      ...(discountPercent ? { discount: discountPercent, discountType: 'percent' } : {}),
      ...(batch ? { batchNo: batch.batchNo, mfgDate: batch.mfgDate, expDate: batch.expDate } : { batchNo: undefined, mfgDate: undefined, expDate: undefined }),
      serials: undefined,
      ...(s['print.regional'] && product.regionalName ? { regionalName: product.regionalName } : {}),
    } : item));
    setProductSearch({ itemId: null, query: '' });
  }, [countryTaxRates]);

  const getProductSuggestions = useCallback((itemId) => {
    if (productSearch.itemId !== itemId || !productSearch.query.trim()) return [];
    const q = productSearch.query.toLowerCase();
    return products.filter(p =>
      p.name?.toLowerCase().includes(q) || p.hsn?.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [productSearch.itemId, productSearch.query, products]);

  // v1.10.77 (#87) - one delivery-charges line per invoice (see deliveryChargeLine).
  const hasDeliveryCharge = items.some((i) => i.isCharge);
  const addDeliveryCharge = () => {
    if (hasDeliveryCharge) return;
    setItems((prev) => [...prev, deliveryChargeLine(prev)]);
  };

  // Settings > Transaction > Barcode scan on billing: a scanner types the code and presses Enter; a known code adds the
  // item (or one more of it), an unknown one says so.
  const scanBarcode = (code) => {
    const product = findByBarcode(productsRef.current, code);
    if (!product) { toast(`No item has the barcode ${code}`, 'warning'); return false; }
    const existing = items.find((i) => i.productId === product.id && !product.serials?.length && !product.batches?.length);
    if (existing) {
      handleItemChange(existing.id, 'quantity', (Number(existing.quantity) || 0) + 1);
    } else {
      const blank = items.find((i) => !i.name?.trim() && !i.productId);
      const id = blank ? blank.id : `scan-${Date.now()}`;
      if (!blank) setItems((prev) => [...prev, { id, name: '', hsn: '', quantity: 1, unit: product.unit || 'Nos', rate: 0, discount: 0, taxPercent: showGST ? defaultTaxRate : 0, cessPercent: 0 }]);
      setTimeout(() => selectProduct(id, product), 0);
    }
    return true;
  };

  const addItem = () => {
    // Default unit depends on whether this invoice is for goods or services —
    // freelancers and consultants get 'Hrs' by default, retailers/manufacturers
    // get 'Nos'. The dropdown still shows the user's last-used unit if they've
    // overridden a previous row.
    const defaultUnit = items.length > 0 && items[items.length - 1].unit
      ? items[items.length - 1].unit
      : getDefaultUnitForMode(invoiceOptions.invoiceMode);
    const newId = Date.now().toString();
    setItems(prev => [...prev, {
      id: newId, name: '', hsn: '', quantity: 1, unit: defaultUnit, rate: 0, discount: 0,
      taxPercent: showGST ? defaultTaxRate : 0,
      cessPercent: 0,
    }]);
    // Move keyboard focus to the new row's Description field so users who
    // Tab to the Add Item button and press Enter don't have to grab the
    // mouse. requestAnimationFrame waits until React has actually rendered
    // the new row in the DOM before we try to find/focus it.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-item-id="${newId}"] input.form-input`);
      if (el) el.focus();
    });
  };

  // Custom unit handler — prompts for a label, persists to localStorage, applies to current item.
  // v1.10.7 — useCallback for the LineItem memoization benefit.
  const handleAddCustomUnit = useCallback(async (itemId) => {
    const label = await promptAction({
      title: 'Add custom unit',
      message: 'Enter a short unit label. Saved for reuse across future invoices.',
      placeholder: 'e.g. Carat, Bundle, Bushel',
      confirmLabel: 'Add unit',
    });
    if (!label) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    if (trimmed.length > 20) { toast('Unit name must be 20 characters or fewer', 'warning'); return; }
    const ok = addCustomUnit(trimmed);
    setUnits(getAllUnits());
    if (!ok) {
      toast(`Unit "${trimmed}" already exists or is reserved`, 'info');
    } else {
      toast(`Unit "${trimmed}" added`, 'success');
    }
    handleItemChange(itemId, 'unit', trimmed);
  }, [handleItemChange]);

  const handleRemoveCustomUnit = useCallback(async (label) => {
    if (!await confirmAction({
      title: `Remove custom unit "${label}"?`,
      message: 'Existing invoices keep this label unchanged. It just no longer appears in the unit dropdowns.',
      confirmLabel: 'Remove unit',
      tone: 'danger',
    })) return;
    removeCustomUnit(label);
    setUnits(getAllUnits());
    toast(`Removed custom unit "${label}"`, 'success');
  }, []);

  const removeItem = useCallback((id) => {
    // Uses functional setState so the useCallback dep can stay empty —
    // no stale-closure risk from items.length; the guard reads current.
    setItems(prev => prev.length > 1 ? prev.filter(item => item.id !== id) : prev);
  }, []);

  // v1.10.7 — stable identity so memoized LineItem's props stay
  // shallow-equal across parent re-renders.
  const clampNonNegStable = useCallback((raw) => clampNonNeg(raw), []);

  return {
    products, setProducts,
    productSearch, setProductSearch,
    units,
    productsRef,
    clampNonNeg: clampNonNegStable,
    handleItemChange,
    selectProduct,
    getProductSuggestions,
    hasDeliveryCharge, addDeliveryCharge,
    scanBarcode,
    addItem,
    handleAddCustomUnit, handleRemoveCustomUnit,
    removeItem,
  };
}
