import { useAppSettings } from '../../lib/appSettings';
import { itemFieldVisibility, newItemDefaults, lowStockLimit } from './itemFields';
import { useEntitlements } from '../billing/useEntitlements';
import { itemExtraVisibility, barcodeTaken, parseSerials, hsnDigitsProblem } from './itemExtras';
import { useState, useEffect, useRef } from 'react';
import { Package, Search, Plus, Edit3, Trash2, X, Save, Upload, Table2, Download } from 'lucide-react';
import { getAllProducts, saveProduct, deleteProduct, getProfile, getStockAlertSettings } from '../../lib/data';
import { getAllUnits, getCountryConfig, formatCurrency } from '../../utils';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import HelpButton from '../../components/ui/HelpButton';
import ProductBulkEdit from './ProductBulkEdit';
import TableExport from '../import-export/TableExport';
import { PRODUCT_TEMPLATE, downloadCsv, productCsvToRecords } from '../import-export/bulkCsv';

// v1.10.29 — reported: "here purchase price and selling price need".
// Product now carries BOTH: `purchasePrice` (what we paid the supplier) and
// `sellingPrice` (what we charge the customer). Legacy `rate` field is
// still written on save (mirrors sellingPrice) so any pre-v1.10.29 reader
// still gets a valid number, but the form no longer edits it directly —
// dead state removed for clarity.
const emptyForm = {
  name: '', hsn: '', purchasePrice: '', sellingPrice: '', taxPercent: '', unit: 'Pcs', stock: '', description: '',
  itemType: '', category: '', minStock: '', customFields: {},
  mrp: '', wholesalePrice: '', wholesaleMinQty: '', altUnit: '', altFactor: '', barcode: '', image: '', regionalName: '',
  discountPercent: '', batches: [], serialsText: '',
};

// A picture is kept on the product as a small data URL (longest side 160px), so it needs no file storage.
function readItemImage(file, done) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { toast('Pick a picture under 4 MB', 'warning'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 160 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    done(c.toDataURL('image/jpeg', 0.8));
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture', 'warning'); };
  img.src = url;
}

export default function InventoryView() {
  const appSettings = useAppSettings();
  const show = itemFieldVisibility(appSettings); // Settings > Item
  const extra = itemExtraVisibility(appSettings); // MRP, wholesale, secondary unit, image, barcode, batch, serial
  const hideCost = useEntitlements().restrictions.hideCost; // Account Access: this role never sees purchase prices
  const startForm = () => ({ ...emptyForm, ...newItemDefaults(appSettings) });
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  // v1.10.77 (#85) - edit many products at once (see ProductBulkEdit).
  const [bulkEdit, setBulkEdit] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => ({ ...emptyForm }));
  const [units, setUnits] = useState(getAllUnits());
  const [profileCountry, setProfileCountry] = useState('India');
  const profileCurrency = getCountryConfig(profileCountry).currency;
  // The colour-coded stock badge in the table respects the user's threshold
  // — defaults to 5 if no setting saved yet. When alerts are disabled
  // entirely, items at or below threshold render in the same plain colour
  // as everything else (still "Out of Stock" red for 0 — that's a hard fact,
  // not an alert preference).
  const [stockAlerts, setStockAlerts] = useState({ enabled: true, threshold: 5 });

  const loadProducts = async () => {
    try {
      const data = await getAllProducts();
      setProducts(data);
    } catch {
      toast('Failed to load products', 'error');
    }
  };

  useEffect(() => {
    loadProducts();
    setUnits(getAllUnits());
    getProfile().then(p => { if (p?.country) setProfileCountry(p.country); }).catch(() => {});
    getStockAlertSettings().then(setStockAlerts).catch(() => {});
  }, []);

  const filtered = search.trim()
    ? products.filter(p =>
        (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.hsn || '').toLowerCase().includes(search.toLowerCase())
      )
    : products;

  const openAdd = () => {
    setForm(startForm());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (product) => {
    // v1.10.29 — Backward-compat: pre-v1.10.29 products only had `rate`.
    // Read `sellingPrice` if set, else fall back to `rate`. `purchasePrice`
    // is new — starts empty for legacy products until the user fills it.
    setForm({
      name: product.name || '',
      hsn: product.hsn || '',
      purchasePrice: product.purchasePrice ?? '',
      sellingPrice: product.sellingPrice ?? product.rate ?? '',
      taxPercent: product.taxPercent || '',
      unit: product.unit || 'Nos',
      stock: product.stock ?? '', // v1.10.74 - was `|| ''`, which blanked a stock of 0
      description: product.description || '',
      itemType: product.itemType || '',
      category: product.category || '',
      minStock: product.minStock ?? '',
      customFields: product.customFields || {},
      mrp: product.mrp ?? '', wholesalePrice: product.wholesalePrice ?? '', wholesaleMinQty: product.wholesaleMinQty ?? '',
      altUnit: product.altUnit || '', altFactor: product.altFactor ?? '', barcode: product.barcode || '', image: product.image || '',
      regionalName: product.regionalName || '', discountPercent: product.discountPercent ?? '',
      batches: product.batches || [], serialsText: (product.serials || []).join('\n'),
    });
    setEditingId(product.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast('Product name is required', 'warning');
      return;
    }
    // v1.10.74 - the input's min/max are not enforced by the browser on save.
    const gst = form.taxPercent === '' ? 0 : Number(form.taxPercent);
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) {
      toast('GST % must be between 0 and 100', 'warning');
      return;
    }
    const hsnProblem = show.hsn && form.hsn.trim() ? hsnDigitsProblem(form.hsn, appSettings['gst.hsnDigits']) : null;
    if (hsnProblem) { toast(hsnProblem, 'warning'); return; }
    if (extra.barcode && form.barcode.trim()) {
      const twin = barcodeTaken(products, form.barcode, editingId);
      if (twin) { toast(`The barcode ${form.barcode.trim()} is already used by ${twin.name}`, 'warning'); return; }
    }
    if (extra.altUnit && form.altUnit.trim() && !(Number(form.altFactor) > 0)) {
      toast('Enter how many secondary units make one primary unit', 'warning'); return;
    }
    const serials = extra.serial ? parseSerials(form.serialsText) : [];
    if (extra.serial && serials.length && form.stock !== '' && serials.length !== Number(form.stock)) {
      toast(`Stock is ${form.stock} but ${serials.length} serial number${serials.length === 1 ? '' : 's'} entered`, 'warning'); return;
    }
    const batches = extra.batch ? (form.batches || []).filter(b => String(b.batchNo || '').trim()) : [];
    if (extra.batch && batches.length && form.stock !== '' && Math.abs(batches.reduce((n, b) => n + (Number(b.qty) || 0), 0) - Number(form.stock)) > 0.0005) {
      toast('Batch quantities must add up to the stock quantity', 'warning'); return;
    }
    try {
      // v1.10.29 — Persist both prices. `rate` mirrors sellingPrice so any
      // old caller reading .rate still gets the right number.
      const sellingPrice = form.sellingPrice ? parseFloat(form.sellingPrice) : 0;
      const purchasePrice = form.purchasePrice ? parseFloat(form.purchasePrice) : 0;
      const product = {
        // Fields this form does not show (cess % from purchase bills, etc.)
        // are kept: the record used to be rebuilt from the form alone.
        ...(editingId ? (products.find(p => p.id === editingId) || {}) : {}),
        ...(editingId ? { id: editingId } : {}),
        name: form.name.trim(),
        hsn: form.hsn.trim(),
        purchasePrice,
        sellingPrice,
        rate: sellingPrice, // mirror for legacy readers
        taxPercent: form.taxPercent ? parseFloat(form.taxPercent) : 0,
        unit: form.unit,
        stock: form.stock ? parseFloat(form.stock) : 0,
        description: form.description.trim(),
        itemType: form.itemType || undefined,
        category: form.category.trim() || undefined,
        minStock: form.minStock === '' ? undefined : Math.max(0, Number(form.minStock) || 0),
        customFields: Object.keys(form.customFields || {}).length ? form.customFields : undefined,
        // Settings > Item extras. A box that is switched off keeps what the product already holds.
        ...(extra.mrp ? { mrp: form.mrp === '' ? undefined : Math.max(0, Number(form.mrp) || 0) } : {}),
        ...(extra.wholesale ? {
          wholesalePrice: form.wholesalePrice === '' ? undefined : Math.max(0, Number(form.wholesalePrice) || 0),
          wholesaleMinQty: form.wholesaleMinQty === '' ? undefined : Math.max(0, Number(form.wholesaleMinQty) || 0),
        } : {}),
        ...(extra.altUnit ? { altUnit: form.altUnit.trim() || undefined, altFactor: form.altUnit.trim() ? Number(form.altFactor) : undefined } : {}),
        ...(extra.barcode ? { barcode: form.barcode.trim() || undefined } : {}),
        ...(extra.image ? { image: form.image || undefined } : {}),
        ...(extra.regional ? { regionalName: form.regionalName.trim() || undefined } : {}),
        ...(extra.discount ? { discountPercent: form.discountPercent === '' ? undefined : Math.min(100, Math.max(0, Number(form.discountPercent) || 0)) } : {}),
        ...(extra.batch ? { batches: batches.length ? batches.map(b => ({ batchNo: String(b.batchNo).trim(), mfgDate: b.mfgDate || '', expDate: b.expDate || '', qty: Number(b.qty) || 0 })) : undefined } : {}),
        ...(extra.serial ? { serials: serials.length ? serials : undefined } : {}),
      };
      await saveProduct(product);
      toast(editingId ? 'Product updated' : 'Product added', 'success');
      closeForm();
      loadProducts();
    } catch {
      toast('Failed to save product', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (await confirmAction({
      title: 'Delete this product?',
      message: 'Existing invoices that used this product keep their line items unchanged. This just removes the product from your catalog.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })) {
      try {
        await deleteProduct(id);
        toast('Product deleted', 'success');
        loadProducts();
      } catch {
        toast('Failed to delete', 'error');
      }
    }
  };

  const setBatch = (i, patch) => setForm(prev => ({ ...prev, batches: prev.batches.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const csvInputRef = useRef(null);

  const handleCSVImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // Names already in the list (trimmed, any case) and repeats inside the file are skipped (v1.10.74).
      const { products: rows, skipped, errors } = productCsvToRecords(await file.text(), { existing: products });
      if (!rows.length && !skipped.length) {
        toast(errors.length ? `No products imported: ${errors[0].message} (line ${errors[0].line})` : 'CSV file is empty or has no data rows', 'warning');
      } else {
        for (const row of rows) await saveProduct(row);
        const notes = [
          skipped.length && `skipped ${skipped.length} already in your list`,
          errors.length && `${errors.length} row(s) without a name`,
        ].filter(Boolean);
        toast(`Imported ${rows.length} product(s)${notes.length ? `, ${notes.join(', ')}` : ''}`, rows.length ? 'success' : 'warning');
        loadProducts();
      }
    } catch {
      toast('Failed to read the CSV file', 'error');
    }
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  return (
    <div className="dashboard-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <h1 className="page-title">Products</h1>
            <p className="page-subtitle">Manage your products and services catalog</p>
          </div>
          <HelpButton title="Products — how to use" doc="products">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li><strong>Add Product</strong>: name, HSN/SAC, purchase and selling price, GST %, unit and stock. Typing the name on an invoice fills the rest in.</li>
              <li><strong>Stock</strong> goes down when you save an invoice and up when you save a purchase bill.</li>
              <li><strong>Import CSV</strong>: click <strong>Template</strong> for a ready file (Name, HSN/SAC, Selling Price, Purchase Price, GST %, Unit, Opening Stock, Description). Old <code>name, hsn, rate, gst%, unit, stock</code> files still work.</li>
              <li><strong>Low stock</strong> shows in amber, none in red. Set the level in Settings → Low-stock alerts.</li>
            </ul>
          </HelpButton>
        </div>
        <div className="flex gap-2">
          <input type="file" accept=".csv" ref={csvInputRef} style={{ display: 'none' }} onChange={handleCSVImport} />
          <button className="btn btn-secondary" onClick={() => downloadCsv(PRODUCT_TEMPLATE, 'Products-import-template.csv')}
            title="A CSV with the columns Import CSV reads, and two example rows">
            <Download size={16} /> Template
          </button>
          <button className="btn btn-secondary" onClick={() => csvInputRef.current?.click()}>
            <Upload size={16} /> Import CSV
          </button>
          <button className="btn btn-secondary" onClick={() => setBulkEdit(true)} disabled={!products.length || bulkEdit || hideCost}
            title="Edit name, HSN, prices, GST %, unit and stock of many products at once">
            <Table2 size={16} /> Bulk edit
          </button>
          <button className="btn btn-primary" onClick={openAdd}>
            <Plus size={18} /> Add Product
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="glass-panel p-4 mb-6">
        <div className="search-box" style={{ maxWidth: '400px' }}>
          <Search size={16} className="search-icon" />
          <input type="text" placeholder="Search by name or HSN..." value={search}
            onChange={e => setSearch(e.target.value)} className="search-input" disabled={bulkEdit}
            title={bulkEdit ? 'Save or cancel the bulk edit first' : undefined} />
          {search && <button className="icon-btn" onClick={() => setSearch('')} title="Clear search" aria-label="Clear search"><X size={14} /></button>}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="section-title">{editingId ? 'Edit Product' : 'Add Product'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Product / Service Name *</label>
                <input type="text" className="form-input" value={form.name}
                  onChange={e => updateField('name', e.target.value)} placeholder="e.g. Web Development" />
              </div>
              {show.type && (
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input" value={form.itemType || 'product'} onChange={e => updateField('itemType', e.target.value)}>
                    <option value="product">Product</option>
                    <option value="service">Service</option>
                  </select>
                </div>
              )}
              {show.category && (
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <input type="text" className="form-input" value={form.category} maxLength={60}
                    onChange={e => updateField('category', e.target.value)} placeholder="e.g. Electronics" />
                </div>
              )}
              {show.hsn && (
                <div className="form-group">
                  <label className="form-label">HSN / SAC Code</label>
                  <input type="text" className="form-input" value={form.hsn}
                    onChange={e => updateField('hsn', e.target.value)} placeholder="e.g. 998314" />
                </div>
              )}
              {/* v1.10.29 — Purchase price + selling price side by side.
                  Selling price seeds the invoice rate; purchase price seeds
                  the purchase-bill rate. Legacy `rate` field kept invisible
                  for backward compat — writes through to sellingPrice. */}
              {!hideCost && <div className="form-group">
                <label className="form-label">Purchase Price</label>
                <input type="number" className="form-input" value={form.purchasePrice}
                  onChange={e => updateField('purchasePrice', e.target.value)}
                  placeholder="0.00" min="0" step="any"
                  title="What you pay the supplier. Auto-fills on new Purchase Bills." />
              </div>}
              <div className="form-group">
                <label className="form-label">Selling Price</label>
                <input type="number" className="form-input" value={form.sellingPrice}
                  onChange={e => updateField('sellingPrice', e.target.value)}
                  placeholder="0.00" min="0" step="any"
                  title="What you charge the customer. Auto-fills on new Invoices." />
              </div>
              {show.tax && (
                <div className="form-group">
                  <label className="form-label">GST %</label>
                  <input type="number" className="form-input" value={form.taxPercent}
                    onChange={e => updateField('taxPercent', e.target.value)} placeholder="18" min="0" max="100" />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Unit</label>
                <select className="form-input" value={form.unit}
                  onChange={e => updateField('unit', e.target.value)}>
                  {form.unit && !units.some(u => u.label === form.unit) && (
                    <option value={form.unit}>{form.unit}</option>
                  )}
                  {units.map(u => <option key={u.label} value={u.label}>{u.label}{u.custom ? ' ★' : ''}</option>)}
                </select>
              </div>
              {show.stock && (
                <div className="form-group">
                  <label className="form-label">Stock Quantity</label>
                  <input type="number" className="form-input" value={form.stock}
                    onChange={e => updateField('stock', e.target.value)} placeholder="0" min="0" />
                </div>
              )}
              {show.minStock && (
                <div className="form-group">
                  <label className="form-label">Minimum stock</label>
                  <input type="number" className="form-input" value={form.minStock} min="0"
                    onChange={e => updateField('minStock', e.target.value)} placeholder="Alert at or below"
                    title="This product shows as low at or below this level. Empty uses the shared alert level." />
                </div>
              )}
              {show.description && (
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Description (optional)</label>
                  <input type="text" className="form-input" value={form.description}
                    onChange={e => updateField('description', e.target.value)} placeholder="Brief description..." />
                </div>
              )}
              {extra.mrp && (
                <div className="form-group">
                  <label className="form-label">MRP</label>
                  <input type="number" className="form-input" value={form.mrp} min="0" step="any" placeholder="0.00"
                    onChange={e => updateField('mrp', e.target.value)} title="Maximum retail price printed on the pack" />
                </div>
              )}
              {extra.wholesale && (
                <>
                  <div className="form-group">
                    <label className="form-label">Wholesale price</label>
                    <input type="number" className="form-input" value={form.wholesalePrice} min="0" step="any" placeholder="0.00"
                      onChange={e => updateField('wholesalePrice', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Wholesale from quantity</label>
                    <input type="number" className="form-input" value={form.wholesaleMinQty} min="0" step="any" placeholder="e.g. 10"
                      onChange={e => updateField('wholesaleMinQty', e.target.value)}
                      title="A sale line at or above this quantity starts at the wholesale price" />
                  </div>
                </>
              )}
              {extra.discount && (
                <div className="form-group">
                  <label className="form-label">Discount %</label>
                  <input type="number" className="form-input" value={form.discountPercent} min="0" max="100" step="any" placeholder="0"
                    onChange={e => updateField('discountPercent', e.target.value)} title="A new sale line for this item starts with this discount" />
                </div>
              )}
              {extra.altUnit && (
                <>
                  <div className="form-group">
                    <label className="form-label">Secondary unit</label>
                    <select className="form-input" value={form.altUnit} onChange={e => updateField('altUnit', e.target.value)}>
                      <option value="">None</option>
                      {units.filter(u => u.label !== form.unit).map(u => <option key={u.label} value={u.label}>{u.label}</option>)}
                    </select>
                  </div>
                  {form.altUnit && (
                    <div className="form-group">
                      <label className="form-label">1 {form.unit || 'unit'} = how many {form.altUnit}?</label>
                      <input type="number" className="form-input" value={form.altFactor} min="0" step="any" placeholder="e.g. 12"
                        onChange={e => updateField('altFactor', e.target.value)} />
                    </div>
                  )}
                </>
              )}
              {extra.barcode && (
                <div className="form-group">
                  <label className="form-label">Barcode</label>
                  <input type="text" className="form-input" value={form.barcode} maxLength={40} placeholder="Scan or type"
                    onChange={e => updateField('barcode', e.target.value)} />
                </div>
              )}
              {extra.regional && (
                <div className="form-group">
                  <label className="form-label">Name in a second language</label>
                  <input type="text" className="form-input" value={form.regionalName} maxLength={120}
                    onChange={e => updateField('regionalName', e.target.value)} title="Printed under the item name when Regional item names is on" />
                </div>
              )}
              {extra.image && (
                <div className="form-group">
                  <label className="form-label">Picture</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="form-input"
                    onChange={e => readItemImage(e.target.files?.[0], (img) => updateField('image', img))} />
                  {form.image && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <img src={form.image} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                      <button type="button" className="btn btn-secondary" onClick={() => updateField('image', '')}>Remove</button>
                    </div>
                  )}
                </div>
              )}
              {extra.batch && (
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Opening batches</label>
                  {(form.batches || []).map((b, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      <input className="form-input" style={{ flex: 2, minWidth: 90 }} placeholder="Batch no." value={b.batchNo || ''} aria-label="Batch number"
                        onChange={e => setBatch(i, { batchNo: e.target.value })} />
                      <input type="date" className="form-input" style={{ flex: 2, minWidth: 120 }} value={b.mfgDate || ''} aria-label="Manufactured on" title="Manufactured on"
                        onChange={e => setBatch(i, { mfgDate: e.target.value })} />
                      <input type="date" className="form-input" style={{ flex: 2, minWidth: 120 }} value={b.expDate || ''} aria-label="Expires on" title="Expires on"
                        onChange={e => setBatch(i, { expDate: e.target.value })} />
                      <input type="number" className="form-input" style={{ flex: 1, minWidth: 70 }} placeholder="Qty" min="0" step="any" value={b.qty ?? ''} aria-label="Batch quantity"
                        onChange={e => setBatch(i, { qty: e.target.value })} />
                      <button type="button" className="icon-btn icon-btn-red" aria-label="Remove batch"
                        onClick={() => setForm(prev => ({ ...prev, batches: prev.batches.filter((_, j) => j !== i) }))}><X size={14} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary"
                    onClick={() => setForm(prev => ({ ...prev, batches: [...(prev.batches || []), { batchNo: '', mfgDate: '', expDate: '', qty: '' }] }))}>
                    <Plus size={14} /> Add batch
                  </button>
                </div>
              )}
              {extra.serial && (
                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Opening serial numbers</label>
                  <textarea className="form-input" rows={3} value={form.serialsText} placeholder="One per line, or separated by commas"
                    onChange={e => updateField('serialsText', e.target.value)} />
                  <small className="field-hint">{parseSerials(form.serialsText).length} entered</small>
                </div>
              )}
              {show.custom.map(f => (
                <div className="form-group" key={f.label}>
                  <label className="form-label">{f.label}</label>
                  <input type="text" className="form-input" maxLength={200} value={form.customFields?.[f.label] || ''}
                    onChange={e => setForm(prev => ({ ...prev, customFields: { ...prev.customFields, [f.label]: e.target.value } }))} />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={closeForm}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>
                <Save size={16} /> {editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Product Table */}
      <div className="glass-panel">
        <div className="table-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3>Products & Services</h3>
          {!bulkEdit && (
            <TableExport title="Products" filename="Products"
              headers={['Name', 'HSN/SAC', ...(hideCost ? [] : ['Purchase price']), 'Selling price', 'GST %', 'Unit', 'Stock']}
              rows={filtered.map((p) => [p.name, p.hsn || '', ...(hideCost ? [] : [Number(p.purchasePrice) || 0]), Number(p.sellingPrice ?? p.rate) || 0, Number(p.taxPercent) || 0, p.unit || 'Nos', Number(p.stock) || 0])} />
          )}
        </div>
        {bulkEdit && filtered.length > 0 ? (
          <ProductBulkEdit products={filtered} units={units} onDone={(saved) => { setBulkEdit(false); if (saved) loadProducts(); }} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Package size={48} />
            <p>{products.length === 0 ? 'No products yet. Add your first product.' : 'No products match your search.'}</p>
            {products.length === 0 && (
              <button className="btn btn-primary" onClick={openAdd}><Plus size={18} /> Add Product</button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  {show.hsn && <th>HSN/SAC</th>}
                  <th>Rate</th>
                  {extra.mrp && <th>MRP</th>}
                  {show.tax && <th>GST %</th>}
                  <th>Unit</th>
                  {show.stock && <th>Stock</th>}
                  <th className="col-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(product => (
                  <tr key={product.id}>
                    <td className="font-medium" title={product.description || ''}>
                      {extra.image && product.image && <img src={product.image} alt="" style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 4, marginRight: 6, verticalAlign: 'middle' }} />}
                      {product.name}
                    </td>
                    {show.hsn && <td className="text-muted">{product.hsn || '-'}</td>}
                    <td className="font-bold">{product.rate ? formatCurrency(product.rate, profileCurrency) : '-'}</td>
                    {extra.mrp && <td>{product.mrp ? formatCurrency(product.mrp, profileCurrency) : '-'}</td>}
                    {show.tax && <td>{product.taxPercent ? `${product.taxPercent}%` : '-'}</td>}
                    <td className="text-muted">{product.unit || 'Nos'}</td>
                    {show.stock && <td>
                      {(product.stock ?? 0) <= 0 ? (
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>Out of Stock</span>
                      ) : (stockAlerts.enabled !== false && (product.stock ?? 0) <= lowStockLimit(product, appSettings, Number(stockAlerts.threshold ?? 5))) ? (
                        <span style={{ color: '#d97706', fontWeight: 600 }}>{product.stock}</span>
                      ) : (
                        product.stock
                      )}
                    </td>}
                    <td>
                      <div className="table-actions">
                        <button className="icon-btn icon-btn-blue" onClick={() => openEdit(product)} title="Edit">
                          <Edit3 size={15} />
                        </button>
                        <button className="icon-btn icon-btn-red" onClick={() => handleDelete(product.id)} title="Delete">
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
      </div>
    </div>
  );
}
