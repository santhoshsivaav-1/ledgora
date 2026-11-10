import { useState, useEffect } from 'react';
import { Wallet, Plus, Edit3, Trash2, Search, X, Save, Calendar } from 'lucide-react';
import { getAllExpenses, getAllOtherIncome, saveExpense, deleteExpense, getProfile, getNextInvoiceNumber, getExpenseSetup, saveExpenseSetup } from '../../lib/data';
import AttachmentField from '../../components/ui/AttachmentField';
import { addCategory, categoryOptions, categoryRollup, fillFromExpenseItem, removeCategory } from './expenseSetup';
import { formatCurrency, getFYOptions, belongsToProfile, isUnassignedToBusiness, businessKeyOf, INDIAN_STATES } from '../../utils';
import { DEFAULT_INCOME_CATEGORIES } from '@ledgora/tax-engine';
import LinesGrid, { blankLine } from '../../components/ui/LinesGrid';
import { gridLineAmount, gridToItems, itemsToGrid } from '../purchases/purchaseExtras';
import UnassignedBanner from '../../app/UnassignedBanner';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import HelpButton from '../../components/ui/HelpButton';
import TableExport from '../import-export/TableExport';

// Each category is tagged with its ITR (Income Tax Return) head so the
// v1.7.0+ ITR Filing Summary can auto-aggregate expenses under the correct
// P&L line. Users don't have to think about heads — they pick the category
// they already understand.
//   - 'business'      → deductible business expense under section 37
//   - 'depreciation'  → section 32 (asset purchases, capitalised then
//                       depreciated per Rule 5)
//   - 'salary'        → separately tracked; declared under section 40A(2)(b)
//                       for related parties
//   - 'notDeductible' → personal / drawings / capital / non-business
const EXPENSE_CATEGORIES = [
  { name: 'Office Rent',            itrHead: 'business' },
  { name: 'Utilities',              itrHead: 'business' },
  { name: 'Internet & Phone',       itrHead: 'business' },
  { name: 'Software & Tools',       itrHead: 'business' },
  { name: 'Travel',                 itrHead: 'business' },
  { name: 'Meals & Entertainment',  itrHead: 'business' },
  { name: 'Office Supplies',        itrHead: 'business' },
  { name: 'Salary & Wages',         itrHead: 'salary' },
  { name: 'Professional Fees',      itrHead: 'business' },
  { name: 'Insurance',              itrHead: 'business' },
  { name: 'Marketing & Ads',        itrHead: 'business' },
  { name: 'Raw Materials',          itrHead: 'business' },
  { name: 'Shipping & Courier',     itrHead: 'business' },
  { name: 'Repairs & Maintenance',  itrHead: 'business' },
  { name: 'Bank Charges',           itrHead: 'business' },
  { name: 'GST Paid',               itrHead: 'business' },
  { name: 'Asset Purchase',         itrHead: 'depreciation' },
  { name: 'Personal / Drawings',    itrHead: 'notDeductible' },
  { name: 'Other',                  itrHead: 'business' },
];
const CATEGORY_NAMES = EXPENSE_CATEGORIES.map(c => c.name);
// Vyapar parity P3-S6: Other Income is this screen with kind="income" and these categories.
const INCOME_CATEGORY_NAMES = [...DEFAULT_INCOME_CATEGORIES.map(c => c.name), 'Other'];

const PAYMENT_MODES = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card', 'Other'];

// v1.10.74 - today's LOCAL date (toISOString is UTC, so before 05:30 IST it
// gave yesterday). Called when the form opens, not once at load.
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyForm = {
  date: '', // v1.10.74 - set to localToday() when the form opens
  description: '',
  category: 'Other',
  amount: '',
  gstAmount: '',
  gstPercent: '',
  // P1 #15: interstate flag. When on, ITC on GST paid routes to IGST in
  // GSTR-3B Table 4(A) instead of splitting 50/50 into CGST + SGST. Real
  // scenario: AWS / Google / Adobe / SaaS bills from out-of-state offices.
  // Off = intrastate = supplier and buyer in the same state.
  interstate: false,
  vendorName: '',
  vendorGstin: '',
  invoiceNo: '',
  paymentMode: 'Bank Transfer',
  note: '',
  // Vyapar parity P3-S5 / P3-S6.
  number: '', // EXP-n / INC-n, given on first save
  itcEligible: true, // expense: GST counts as input tax credit (off = reversed in GSTR-3B 4(B)(1))
  exempt: false, // income: an exempt supply (interest on deposits), GSTR-3B 3.1(c)
  paidAmount: '', // blank = paid (received) in full; less = on credit
  itemised: false,
  lines: [],
  attachment: null, // the bill or receipt, { fileId, fileName }
  sac: '', // income: the service's SAC, for the GSTR-1 HSN summary
  placeOfSupply: '', // income: where the payer is (blank = your state)
};

// v1.10.6 — audit L4: local copy removed, imported from utils above.

export default function ExpenseTracker({ kind = 'expense' }) {
  const income = kind === 'income';
  // P3-S5: the user's own categories (a tree with a P&L kind) and expense items, kept with the workspace settings.
  const [setup, setSetup] = useState({ categories: [], items: [] });
  const [showSetup, setShowSetup] = useState(false);
  const [showRollup, setShowRollup] = useState(false);
  const options = categoryOptions(income ? INCOME_CATEGORY_NAMES : CATEGORY_NAMES, setup.categories, kind);
  const categoryNames = options.map(o => o.name);
  const labelOf = (name) => options.find(o => o.name === name)?.label || name;
  const storeSetup = async (next) => {
    try { await saveExpenseSetup(next); setSetup(next); } catch { toast('Could not save', 'error'); }
  };
  const noun = income ? 'income' : 'expense';
  const [expenses, setExpenses] = useState([]);
  // v1.10.65 (#58 item 3) — the business these records belong to.
  const [ownerProfile, setOwnerProfile] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [fyFilter, setFyFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });

  const fyOptions = getFYOptions();
  const defaultFy = fyOptions[0]?.value || '';


  // v1.10.65 (#58 item 3) — assign records saved before businesses were kept
  // separate. Never automatic: only the user knows which business an old
  // record belonged to, so guessing would file it into the wrong books.
  const unassignedExpenses = expenses.filter(isUnassignedToBusiness);
  const assignUnassignedExpenses = async () => {
    await Promise.all(unassignedExpenses.map(r => saveExpense({
      ...r,
      ownerGstin: ownerProfile?.gstin || '',
      ownerName: ownerProfile?.businessName || '',
    })));
    loadExpenses();
  };

  const loadExpenses = async () => {
    try {
      const [rows, prof] = await Promise.all([income ? getAllOtherIncome() : getAllExpenses(), getProfile().catch(() => null)]);
      setOwnerProfile(prof);
      // v1.10.65 (#58 item 3) — show only this business's records. Anything
      // saved before businesses were separated has no owner recorded and is
      // always shown, so nothing disappears from an existing ledger.
      setExpenses((rows || []).filter(r => belongsToProfile(r, prof)));
      getExpenseSetup().then(setSetup).catch(() => {});
    } catch {
      toast('Failed to load expenses', 'error');
    }
  };

  useEffect(() => {
    if (fyOptions[0]) setFyFilter(fyOptions[0].value);
    loadExpenses();
  }, []);

  const filtered = expenses.filter(exp => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!(exp.description || '').toLowerCase().includes(q) &&
          !(exp.vendorName || '').toLowerCase().includes(q) &&
          !(exp.invoiceNo || '').toLowerCase().includes(q)) return false;
    }
    if (categoryFilter !== 'all' && exp.category !== categoryFilter) return false;
    if (fyFilter) {
      const fy = fyOptions.find(f => f.value === fyFilter);
      if (fy && exp.date) {
        if (exp.date < fy.from || exp.date > fy.to) return false;
      }
    }
    return true;
  });

  const totalAmount = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const totalGST = filtered.reduce((s, e) => s + (e.gstAmount || 0), 0);

  const openAdd = () => {
    setForm({ ...emptyForm, date: localToday(), category: income ? categoryNames[0] : emptyForm.category, itcEligible: !income });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (exp) => {
    setForm({
      date: exp.date || '',
      description: exp.description || '',
      category: exp.category || 'Other',
      amount: exp.amount || '',
      gstAmount: exp.gstAmount || '',
      gstPercent: exp.gstPercent || '',
      vendorName: exp.vendorName || '',
      vendorGstin: exp.vendorGstin || '',
      invoiceNo: exp.invoiceNo || '',
      paymentMode: exp.paymentMode || 'Bank Transfer',
      interstate: !!exp.interstate,
      note: exp.note || '',
      number: exp.number || '',
      itcEligible: exp.itcEligible !== false,
      exempt: !!exp.exempt,
      paidAmount: exp.paidAmount ?? '',
      itemised: !!exp.items?.length,
      lines: exp.items?.length ? itemsToGrid(exp.items) : [],
      attachment: exp.attachment || null,
      sac: exp.sac || '',
      placeOfSupply: exp.placeOfSupply || '',
    });
    setEditingId(exp.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const handleSave = async () => {
    if (!form.description.trim()) { toast('Description is required', 'warning'); return; }
    // Itemised (P3-S5): amount and GST come from the lines.
    const items = form.itemised ? gridToItems(form.lines) : [];
    if (form.itemised && !items.length) { toast('Add at least one line', 'warning'); return; }
    const linesTotal = form.lines.reduce((t, l) => t + gridLineAmount(l), 0);
    const linesTaxable = items.reduce((t, i) => t + i.quantity * i.rate, 0);
    const amountIn = form.itemised ? String(Math.round(linesTotal * 100) / 100) : form.amount;
    const gstIn = form.itemised ? Math.round((linesTotal - linesTaxable) * 100) / 100 : form.gstAmount;
    const pctIn = form.itemised ? '' : form.gstPercent;
    if (!amountIn || parseFloat(amountIn) <= 0) { toast('Enter a valid amount', 'warning'); return; }
    if (form.paidAmount !== '' && parseFloat(form.paidAmount) > parseFloat(amountIn) + 0.005) { toast(income ? 'Received is more than the total' : 'Paid is more than the total', 'warning'); return; }
    // v1.10.74 - GST % must be 0 to 100 (40% is a real rate, so no 28 cap).
    const gstPct = pctIn === '' ? 0 : parseFloat(pctIn);
    if (!(gstPct >= 0 && gstPct <= 100)) { toast('GST % must be between 0 and 100', 'warning'); return; }
    try {
      let number = form.number;
      if (!number) {
        try { number = await getNextInvoiceNumber(income ? 'INC' : 'EXP', { businessKey: businessKeyOf(ownerProfile || {}) }); } catch { number = ''; }
      }
      const expense = {
        ...(editingId ? { id: editingId } : {}),
        ...(income ? { kind: 'income' } : {}),
        number,
        date: form.date,
        description: form.description.trim(),
        category: form.category,
        amount: parseFloat(amountIn),
        gstAmount: gstIn ? parseFloat(gstIn) : 0,
        gstPercent: pctIn ? parseFloat(pctIn) : 0,
        vendorName: form.vendorName.trim(),
        vendorGstin: form.vendorGstin.trim(),
        invoiceNo: form.invoiceNo.trim(),
        paymentMode: form.paymentMode,
        interstate: !!form.interstate,
        note: form.note.trim(),
        // Stamp the business this expense belongs to. `vendorGstin` above is
        // the SUPPLIER — filing an expense under your own supplier would be
        // exactly backwards, so the owner is kept in its own field.
        ownerGstin: ownerProfile?.gstin || '',
        ownerName: ownerProfile?.businessName || '',
        ...(income ? { exempt: !!form.exempt } : { itcEligible: !!form.itcEligible }),
        ...(form.paidAmount !== '' && form.paidAmount != null ? { paidAmount: parseFloat(form.paidAmount) || 0 } : {}),
        ...(items.length ? { items } : {}),
        attachment: form.attachment || null,
        ...(income ? { sac: (form.sac || '').trim(), placeOfSupply: form.placeOfSupply || '' } : {}),
      };
      if (income && expense.exempt) { expense.gstAmount = 0; expense.gstPercent = 0; }
      await saveExpense(expense);
      toast(editingId ? `${income ? 'Income' : 'Expense'} updated` : `${income ? 'Income' : 'Expense'} added`, 'success');
      closeForm();
      loadExpenses();
    } catch {
      toast('Failed to save expense', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (await confirmAction({
      title: 'Delete this expense?',
      message: 'The row is removed from your expense ledger. Any GST ITC claimed against this bill in past returns stays as filed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })) {
      try {
        await deleteExpense(id);
        toast('Expense deleted', 'success');
        loadExpenses();
      } catch {
        toast('Failed to delete', 'error');
      }
    }
  };

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  // v1.10.74 - recompute GST from the NEW amount and GST % on every change
  // of either (it used the old amount), and zero it when either is empty/0.
  const updateAmountOrGST = (field, value) => setForm(prev => {
    const next = { ...prev, [field]: value };
    const base = parseFloat(next.amount) || 0;
    const pct = parseFloat(next.gstPercent) || 0;
    const gst = base > 0 && pct > 0 ? (base * pct) / (100 + pct) : 0;
    return { ...next, gstAmount: Math.round(gst * 100) / 100 };
  });

  // v1.10.77 (#85) - the expense statement: the list as filtered, oldest
  // first, with a total row; as CSV, Excel or Print / PDF. Same columns as the
  // old CSV, so a CA's sheet keeps working.
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const statementRows = filtered.length ? [
    ...[...filtered].sort((x, y) => String(x.date || '').localeCompare(String(y.date || ''))).map(x => [
      x.date || '', x.description || '', x.category || '', r2(x.amount), r2(x.gstAmount), Number(x.gstPercent) || 0,
      x.vendorName || '', x.vendorGstin || '', x.invoiceNo || '', x.paymentMode || '', x.interstate ? 'Y' : 'N', x.note || '']),
    ['Total', '', '', r2(totalAmount), r2(totalGST), '', '', '', '', '', '', ''],
  ] : [];
  const statementPeriod = [
    fyOptions.find(f => f.value === fyFilter)?.label || 'all years',
    categoryFilter !== 'all' ? categoryFilter : '',
    search.trim() ? `matching "${search.trim()}"` : '',
  ].filter(Boolean).join(', ');

  return (
    <div className="dashboard-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <h1 className="page-title">{income ? 'Other Income' : 'Expenses'}</h1>
            <p className="page-subtitle">{income ? 'Income outside sales: interest, commission, rent received. Taxable income is reported in GSTR-3B 3.1(a), exempt income in 3.1(c).' : 'Track business expenses for P&L and ITC claims'}</p>
          </div>
          <HelpButton title="Expenses — how to use" doc="expenses">
            <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
              <li>For costs that are not stock: rent, electricity, internet, software, travel, fees.</li>
              <li><strong>Amount</strong> is what you paid, including GST. Enter the <strong>GST %</strong> and the GST inside it is worked out and counted as input tax credit.</li>
              <li>Tick <strong>Inter-state expense</strong> when the vendor charged IGST.</li>
              <li><strong>Print / PDF</strong>, <strong>Excel</strong> and <strong>CSV</strong> above the list give your CA the expense statement for the year, category and search shown, with a total.</li>
            </ul>
          </HelpButton>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={18} /> {income ? 'Add Income' : 'Add Expense'}</button>
        </div>
      </div>

      <UnassignedBanner
        count={unassignedExpenses.length}
        businessName={ownerProfile?.businessName}
        noun={noun}
        onAssign={assignUnassignedExpenses}
      />

      {/* Stats */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon stat-icon-purple"><Wallet size={22} /></div>
          <div><p className="stat-label">{income ? 'Total Income' : 'Total Expenses'}</p><h2 className="stat-value stat-value-purple">{formatCurrency(totalAmount)}</h2></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-green"><Calendar size={22} /></div>
          <div><p className="stat-label">{income ? 'GST Charged' : 'GST Paid (ITC)'}</p><h2 className="stat-value stat-value-green">{formatCurrency(totalGST)}</h2></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue"><Wallet size={22} /></div>
          <div><p className="stat-label">Entries</p><h2 className="stat-value">{filtered.length}</h2></div>
        </div>
      </div>

      {/* P3-S5: totals by category, children rolled into their parents. */}
      <div style={{ marginBottom: '0.75rem' }}>
        <button type="button" className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }} onClick={() => setShowRollup(v => !v)}>
          {showRollup ? 'Hide' : 'Show'} totals by category
        </button>
        {showRollup && (
          <div className="glass-panel" style={{ marginTop: '0.5rem' }}>
            <table className="data-table">
              <thead><tr><th>Category</th><th>P&amp;L</th><th style={{ textAlign: 'right' }}>Booked here</th><th style={{ textAlign: 'right' }}>With sub-categories</th></tr></thead>
              <tbody>
                {categoryRollup(filtered, setup.categories).map(r => (
                  <tr key={r.category}>
                    <td>{labelOf(r.category)}</td>
                    <td>{options.find(o => o.name === r.category)?.kind || (income ? 'income' : 'indirect')}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(r.own)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showSetup && (
        <ExpenseSetupModal income={income} setup={setup} options={options} onSave={storeSetup} onClose={() => setShowSetup(false)} />
      )}

      {/* Filters */}
      <div className="glass-panel p-4 mb-6">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box" style={{ maxWidth: '300px' }}>
            <Search size={16} className="search-icon" />
            <input type="text" placeholder="Search expenses..." value={search}
              onChange={e => setSearch(e.target.value)} className="search-input" />
          </div>
          <select className="filter-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="all">All Categories</option>
            {options.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
          </select>
          <select className="filter-select" value={fyFilter} onChange={e => setFyFilter(e.target.value)}>
            {/* v1.10.74 - '' already means no FY filter. */}
            <option value="">All years</option>
            {fyOptions.map(fy => <option key={fy.value} value={fy.value}>{fy.label}</option>)}
          </select>
          {/* v1.10.74 - Clear filters also puts the FY back to the current one. */}
          {(search || categoryFilter !== 'all' || fyFilter !== defaultFy) && (
            <button className="icon-btn icon-btn-red" onClick={() => { setSearch(''); setCategoryFilter('all'); setFyFilter(defaultFy); }} title="Clear filters" aria-label="Clear filters"><X size={15} /></button>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '620px' }}>
            <h3 className="section-title">{editingId ? `Edit ${income ? 'Income' : 'Expense'}` : `Add ${income ? 'Income' : 'Expense'}`}{form.number ? ` · ${form.number}` : ''}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Date *</label>
                <input type="date" className="form-input" value={form.date} onChange={e => updateField('date', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select className="form-input" value={form.category} onChange={e => updateField('category', e.target.value)}>
                  {[...new Set([...categoryNames, form.category].filter(Boolean))].map(c => <option key={c} value={c}>{labelOf(c)}</option>)}
                </select>
                <button type="button" className="field-hint" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => setShowSetup(true)}>Manage categories{income ? '' : ' and expense items'}</button>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.itemised}
                    onChange={e => {
                      const on = e.target.checked;
                      setForm(prev => ({ ...prev, itemised: on, lines: on && !prev.lines.length ? [blankLine()] : prev.lines }));
                    }}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                  <span><strong>Itemised</strong> — enter lines (item, SAC, qty, rate, GST %) instead of one amount</span>
                </label>
              </div>
              {form.itemised && (
                <div style={{ gridColumn: 'span 2' }}>
                  <datalist id="exp-item-list">{setup.items.map(i => <option key={i.name} value={i.name} />)}</datalist>
                  <LinesGrid docType="expense" lines={form.lines} amountOf={gridLineAmount}
                    // A line that names a saved expense item picks up its SAC, rate and GST %.
                    onChange={v => updateField('lines', v.map((l, i) => (l.item !== form.lines[i]?.item ? fillFromExpenseItem(l, setup.items) : l)))}
                    renderItemCell={({ line, setField, inputProps }) => (
                      <input {...inputProps} type="text" list="exp-item-list" value={line.item ?? ''} onChange={e => setField('item', e.target.value)} />
                    )} />
                  <p className="field-hint" style={{ textAlign: 'right' }}>Total {formatCurrency(form.lines.reduce((t, l) => t + gridLineAmount(l), 0))}</p>
                </div>
              )}
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Description *</label>
                <input type="text" className="form-input" value={form.description}
                  onChange={e => updateField('description', e.target.value)} placeholder="e.g. AWS Hosting - March" />
              </div>
              {!form.itemised && (
                <>
                  <div className="form-group">
                    <label className="form-label">Amount (incl. GST) *</label>
                    <input type="number" className="form-input" value={form.amount}
                      onChange={e => updateAmountOrGST('amount', e.target.value)}
                      placeholder="0.00" min="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{income ? 'GST % charged' : 'GST % (for ITC)'}</label>
                    <input type="number" className="form-input" value={form.gstPercent} disabled={income && form.exempt}
                      onChange={e => updateAmountOrGST('gstPercent', e.target.value)} placeholder="18" min="0" max="100" />
                    {form.gstAmount > 0 && <p className="field-hint">GST: {formatCurrency(form.gstAmount)}</p>}
                  </div>
                </>
              )}
              <div className="form-group">
                <label className="form-label">{income ? 'Received now' : 'Paid now'}</label>
                <input type="number" className="form-input" value={form.paidAmount} min="0"
                  onChange={e => updateField('paidAmount', e.target.value)} placeholder="All of it" />
                <p className="field-hint">Less than the total leaves the rest {income ? 'receivable' : 'payable'}.</p>
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                  {income ? (
                    <input type="checkbox" checked={!!form.exempt} onChange={e => updateField('exempt', e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                  ) : (
                    <input type="checkbox" checked={!!form.itcEligible} onChange={e => updateField('itcEligible', e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                  )}
                  <span>
                    {income
                      ? <><strong>Exempt</strong> — no GST (interest on deposits, agricultural income)</>
                      : <><strong>ITC eligible</strong> — claim this GST as input tax credit</>}
                  </span>
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">{income ? 'Received from' : 'Vendor Name'}</label>
                <input type="text" className="form-input" value={form.vendorName}
                  onChange={e => updateField('vendorName', e.target.value)} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="form-label">{income ? 'Payer GSTIN' : 'Vendor GSTIN'}</label>
                <input type="text" className="form-input" value={form.vendorGstin}
                  onChange={e => updateField('vendorGstin', e.target.value)} placeholder="For ITC claim" maxLength={15} />
              </div>
              <div className="form-group">
                <label className="form-label">Invoice / Bill No</label>
                <input type="text" className="form-input" value={form.invoiceNo}
                  onChange={e => updateField('invoiceNo', e.target.value)} placeholder="Optional" />
              </div>
              <div className="form-group">
                <label className="form-label">Payment Mode</label>
                <select className="form-input" value={form.paymentMode} onChange={e => updateField('paymentMode', e.target.value)}>
                  {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!form.interstate}
                    onChange={e => updateField('interstate', e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                  <span>
                    <strong>Inter-state expense</strong> — vendor charged IGST (different state)
                    <span style={{ color: '#94a3b8', fontSize: '0.72rem', display: 'block' }}>
                      Routes ITC to IGST in GSTR-3B. Common: AWS / Google / Adobe / SaaS billed from an out-of-state office. Tip: check the vendor's GSTIN — first 2 digits are their state code.
                    </span>
                  </span>
                </label>
              </div>
              {income && !form.exempt && (
                <>
                  <div className="form-group">
                    <label className="form-label">SAC</label>
                    <input type="text" className="form-input" value={form.sac} inputMode="numeric" maxLength={8}
                      onChange={e => updateField('sac', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 9971" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Place of supply</label>
                    <select className="form-input" value={form.placeOfSupply} onChange={e => updateField('placeOfSupply', e.target.value)}>
                      <option value="">{ownerProfile?.state ? `Your state (${ownerProfile.state})` : 'Your state'}</option>
                      {INDIAN_STATES.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                </>
              )}
              <AttachmentField label={income ? 'Attachment' : 'Attach receipt'} value={form.attachment} onChange={v => updateField('attachment', v)} />
              <div />
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label">Note (optional)</label>
                <input type="text" className="form-input" value={form.note}
                  onChange={e => updateField('note', e.target.value)} placeholder="Any additional note..." />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-secondary" onClick={closeForm}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}><Save size={16} /> {editingId ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Expense Table */}
      <div className="glass-panel">
        <div className="table-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3>Expense Records</h3>
          <TableExport title="Expense statement" filename={`Expenses-${statementPeriod}`} landscape
            subtitle={[ownerProfile?.businessName, statementPeriod].filter(Boolean).join(', ')}
            headers={['Date', 'Description', 'Category', 'Amount', 'GST Amount', 'GST %', 'Vendor', 'Vendor GSTIN', 'Invoice No', 'Payment Mode', 'Inter-state', 'Note']}
            rows={statementRows} />
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <Wallet size={48} />
            <p>{expenses.length === 0 ? 'No expenses recorded yet.' : 'No expenses match your filters.'}</p>
            {expenses.length === 0 && <button className="btn btn-primary" onClick={openAdd}><Plus size={18} /> Add Expense</button>}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table" style={{ minWidth: '800px' }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Vendor</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>GST</th>
                  <th>Mode</th>
                  <th className="col-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(exp => (
                  <tr key={exp.id}>
                    <td className="text-muted">{exp.date ? new Date(exp.date).toLocaleDateString('en-IN') : ''}</td>
                    <td className="font-medium">{exp.description}</td>
                    <td><span className="type-badge">{exp.category}</span></td>
                    <td className="text-muted">{exp.vendorName || '-'}</td>
                    <td style={{ textAlign: 'right' }} className="font-bold">{formatCurrency(exp.amount)}</td>
                    <td style={{ textAlign: 'right' }} className="text-muted">{exp.gstAmount ? formatCurrency(exp.gstAmount) : '-'}</td>
                    <td className="text-muted">{exp.paymentMode}</td>
                    <td>
                      <div className="table-actions">
                        <button className="icon-btn icon-btn-blue" onClick={() => openEdit(exp)} title="Edit"><Edit3 size={15} /></button>
                        <button className="icon-btn icon-btn-red" onClick={() => handleDelete(exp.id)} title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 'bold', borderTop: '2px solid var(--border)' }}>
                  <td colSpan={4}>Total</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totalAmount)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(totalGST)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// P3-S5: the user's own categories (with a parent and a P&L kind) and, for expenses, expense items.
function ExpenseSetupModal({ income, setup, options, onSave, onClose }) {
  const [cat, setCat] = useState({ name: '', parent: '', kind: income ? 'income' : 'indirect' });
  const [item, setItem] = useState({ name: '', sac: '', defaultRate: '', gstRate: '18', category: '' });
  const own = setup.categories.filter(c => (c.kind === 'income') === income);
  const add = () => {
    const r = addCategory(setup.categories, options, cat);
    if (r.error) { toast(r.error, 'warning'); return; }
    onSave({ ...setup, categories: r.categories });
    setCat({ ...cat, name: '' });
  };
  const addItem = () => {
    const name = item.name.trim();
    if (!name) { toast('Enter a name', 'warning'); return; }
    if (setup.items.some(i => i.name.toLowerCase() === name.toLowerCase())) { toast(`${name} already exists`, 'warning'); return; }
    onSave({ ...setup, items: [...setup.items, { name, sac: item.sac.trim(), defaultRate: parseFloat(item.defaultRate) || 0, gstRate: parseFloat(item.gstRate) || 0, category: item.category }] });
    setItem({ name: '', sac: '', defaultRate: '', gstRate: '18', category: '' });
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '720px' }} role="dialog" aria-label="Categories">
        <h3 className="section-title">{income ? 'Income categories' : 'Expense categories and items'}</h3>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem' }}>Your categories</h4>
        {own.length === 0 && <p className="field-hint">The built-in categories are always there. Add your own, optionally under a parent.</p>}
        {own.map(c => (
          <div key={c.name} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0.25rem 0' }}>
            <span style={{ flex: 1 }}>{c.parent ? `${c.parent} › ${c.name}` : c.name}</span>
            {!income && <span className="field-hint">{c.kind === 'direct' ? 'Direct' : 'Indirect'}</span>}
            <button type="button" className="icon-btn icon-btn-red" aria-label={`Remove ${c.name}`} onClick={() => onSave({ ...setup, categories: removeCategory(setup.categories, c.name) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
          <input className="form-input" style={{ flex: 2, minWidth: 140 }} placeholder="New category" value={cat.name} onChange={e => setCat({ ...cat, name: e.target.value })} aria-label="Category name" />
          <select className="form-input" style={{ flex: 2, minWidth: 140 }} value={cat.parent} onChange={e => setCat({ ...cat, parent: e.target.value })} aria-label="Parent category">
            <option value="">No parent</option>
            {options.map(o => <option key={o.name} value={o.name}>{o.label}</option>)}
          </select>
          {!income && (
            <select className="form-input" style={{ flex: 1, minWidth: 110 }} value={cat.kind} onChange={e => setCat({ ...cat, kind: e.target.value })} aria-label="P&L placement">
              <option value="indirect">Indirect</option>
              <option value="direct">Direct</option>
            </select>
          )}
          <button type="button" className="btn btn-primary" onClick={add}><Plus size={14} /> Add</button>
        </div>
        {!income && (
          <>
            <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem' }}>Expense items</h4>
            {setup.items.map(i => (
              <div key={i.name} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0.25rem 0' }}>
                <span style={{ flex: 1 }}>{i.name}</span>
                <span className="field-hint">SAC {i.sac || '—'} · {formatCurrency(i.defaultRate)} · GST {i.gstRate}%{i.category ? ` · ${i.category}` : ''}</span>
                <button type="button" className="icon-btn icon-btn-red" aria-label={`Remove ${i.name}`} onClick={() => onSave({ ...setup, items: setup.items.filter(x => x.name !== i.name) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '0.5rem 0' }}>
              <input className="form-input" style={{ flex: 2, minWidth: 130 }} placeholder="Item (e.g. Office rent)" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} aria-label="Expense item name" />
              <input className="form-input" style={{ width: 90 }} placeholder="SAC" value={item.sac} onChange={e => setItem({ ...item, sac: e.target.value.replace(/\D/g, '') })} aria-label="SAC" />
              <input className="form-input" style={{ width: 100 }} type="number" min="0" placeholder="Rate" value={item.defaultRate} onChange={e => setItem({ ...item, defaultRate: e.target.value })} aria-label="Default rate" />
              <input className="form-input" style={{ width: 80 }} type="number" min="0" max="100" placeholder="GST %" value={item.gstRate} onChange={e => setItem({ ...item, gstRate: e.target.value })} aria-label="GST rate" />
              <select className="form-input" style={{ flex: 1, minWidth: 120 }} value={item.category} onChange={e => setItem({ ...item, category: e.target.value })} aria-label="Default category">
                <option value="">No default category</option>
                {options.map(o => <option key={o.name} value={o.name}>{o.label}</option>)}
              </select>
              <button type="button" className="btn btn-primary" onClick={addItem}><Plus size={14} /> Add</button>
            </div>
          </>
        )}
        <div className="flex justify-end mt-4"><button className="btn btn-secondary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
