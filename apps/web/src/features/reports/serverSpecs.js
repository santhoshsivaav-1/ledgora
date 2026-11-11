// Vyapar parity Phase 6: how the web draws each report the API serves beyond the core seven (definitions.js). A spec says
// which filters a report offers and which columns it shows; its title, description, rows, totals and meta come from the
// server. Adding a report on the server needs one entry here, or none (the generic definition draws it from its rows).

import { cashbankRefLink } from '../../lib/data/cashbank';
import { runServerReport } from './definitions';

const money = (id, header, o = {}) => ({ id, header, format: 'money', total: 'sum', ...o });
const bare = (id, header, o = {}) => ({ id, header, format: 'money', ...o }); // money without a total
const num = (id, header, o = {}) => ({ id, header, align: 'right', total: 'sum', ...o });
const text = (id, header, o = {}) => ({ id, header, ...o });
const sorted = (id, header, o = {}) => ({ id, header, sortable: true, ...o });

const period = (def = 'this-month') => ({ kind: 'period', default: def });
const search = { kind: 'search' };
const toggle = (id, label, on = false) => ({ kind: 'toggle', id, label, default: on });
const select = (id, label, options, def) => ({ kind: 'select', id, label, options, default: def });
const SIDE = select(
  'side',
  'Side',
  [
    { value: 'sale', label: 'Sale' },
    { value: 'purchase', label: 'Purchase' },
  ],
  'sale',
);
const SIDE3 = select(
  'side',
  'Side',
  [
    { value: 'sale', label: 'Sale' },
    { value: 'purchase', label: 'Purchase' },
    { value: 'both', label: 'Sale and purchase' },
  ],
  'sale',
);
const party = (ctx, label = 'All parties') =>
  select(
    'partyId',
    'Party',
    [{ value: '', label }, ...(ctx.parties || []).map((p) => ({ value: p.id, label: p.name }))],
    '',
  );
const item = (ctx, required = false) =>
  select(
    'itemId',
    'Item',
    [
      ...(required ? [] : [{ value: '', label: 'All items' }]),
      ...(ctx.items || []).map((i) => ({ value: i.id, label: i.name })),
    ],
    required ? ctx.items?.[0]?.id : '',
  );
const docs = (r) => (r.refType ? cashbankRefLink(r.refType) : null);
const chip = (label, value, o = {}) => ({ label, value, ...o });

/** Rows of a report that needs a choice (an item, a party) wait until one is made. */
const needs = (ids, id, ctx) => (params) =>
  ids.some((k) => !params[k])
    ? Promise.resolve({ rows: [] })
    : runServerReport(id, ctx.businessId, params);

const SPECS = {
  sale: (ctx) => ({
    filters: [
      period(),
      party(ctx),
      toggle('includeCancelled', 'Include cancelled'),
      toggle('creditNotes', 'Include credit notes', true),
      search,
    ],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Invoice no'),
      sorted('party', 'Party'),
      text('type', 'Txn type'),
      text('paymentType', 'Payment'),
      money('total', 'Total'),
      money('received', 'Received'),
      money('balance', 'Balance'),
      money('taxable', 'Taxable'),
      money('tax', 'Tax'),
      text('salesman', 'Salesman'),
    ],
    summary: (_r, t) => [
      chip('Total sale', t.total ?? 0),
      chip('Received', t.received ?? 0, { tone: 'pos' }),
      chip('Pending', t.balance ?? 0, { tone: 'neg' }),
      chip('Documents', t.count ?? 0, { money: false }),
    ],
    drilldown: docs,
  }),
  purchase: (ctx) => ({
    filters: [
      period(),
      party(ctx, 'All suppliers'),
      toggle('debitNotes', 'Include debit notes', true),
      search,
    ],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Bill no'),
      sorted('party', 'Supplier'),
      text('type', 'Txn type'),
      money('total', 'Total'),
      money('paid', 'Paid'),
      money('balance', 'Balance'),
      money('taxable', 'Taxable'),
      money('tax', 'Tax'),
      money('itcEligible', 'ITC eligible'),
      money('itcClaimed', 'ITC claimed'),
    ],
    summary: (_r, t) => [
      chip('Total purchase', t.total ?? 0),
      chip('Paid', t.paid ?? 0, { tone: 'pos' }),
      chip('Pending', t.balance ?? 0, { tone: 'neg' }),
      chip('ITC claimed', t.itcClaimed ?? 0),
    ],
    drilldown: docs,
  }),
  'all-transactions': (ctx) => ({
    filters: [
      period(),
      party(ctx),
      select(
        'types',
        'Type',
        [
          { value: '', label: 'All types' },
          ...[
            'sale',
            'purchase',
            'payment-in',
            'payment-out',
            'expense',
            'income',
            'transfer',
            'journal',
          ].map((v) => ({ value: v, label: v })),
        ],
        '',
      ),
      search,
    ],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Ref no'),
      sorted('party', 'Party'),
      text('type', 'Type'),
      text('paymentType', 'Payment type'),
      money('total', 'Total'),
      money('balance', 'Balance'),
    ],
    summary: (_r, t) => [
      chip('Transactions', t.count ?? 0, { money: false }),
      chip('Total', t.total ?? 0),
      chip('Pending', t.balance ?? 0),
    ],
    drilldown: docs,
  }),
  'bill-wise-profit': (ctx) => ({
    filters: [period(), party(ctx), toggle('includeCharges', 'Add charges income'), search],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Invoice no'),
      sorted('party', 'Party'),
      money('sale', 'Sale (before GST)'),
      money('cost', 'Cost'),
      money('charges', 'Charges'),
      money('discount', 'Discount'),
      money('profit', 'Profit', { sortable: true }),
      { id: 'profitPct', header: 'Profit %', align: 'right' },
    ],
    summary: (_r, t) => [
      chip('Sale', t.sale ?? 0),
      chip('Cost', t.cost ?? 0),
      chip('Profit', t.profit ?? 0, { tone: (t.profit ?? 0) >= 0 ? 'pos' : 'neg' }),
      chip('Margin', `${t.profitPct ?? 0}%`, { money: false }),
    ],
    drilldown: docs,
  }),
  ageing: () => ({
    filters: [period('this-fy'), search],
    columns: [
      sorted('partyName', 'Party'),
      money('0-30', '0–30 days'),
      money('31-60', '31–60'),
      money('61-90', '61–90'),
      money('90+', '90+'),
      money('total', 'Total', { sortable: true }),
    ],
    summary: (_r, t) => [
      chip('To collect', t.total ?? 0, { tone: 'pos' }),
      chip('Over 90 days', t['90+'] ?? 0, { tone: 'neg' }),
    ],
  }),
  'all-parties': (ctx) => ({
    filters: [
      select(
        'balance',
        'Balance',
        [
          { value: 'all', label: 'All balances' },
          { value: 'receivable', label: 'To collect' },
          { value: 'payable', label: 'To pay' },
        ],
        'all',
      ),
      select(
        'kind',
        'Kind',
        [
          { value: 'all', label: 'All parties' },
          { value: 'customer', label: 'Customers' },
          { value: 'supplier', label: 'Suppliers' },
          { value: 'both', label: 'Both' },
        ],
        'all',
      ),
      select(
        'groupId',
        'Group',
        [
          { value: '', label: 'All groups' },
          ...(ctx.groups || []).map((g) => ({ value: g.id, label: g.name })),
        ],
        '',
      ),
      search,
    ],
    columns: [
      sorted('name', 'Party'),
      text('email', 'Email'),
      text('phone', 'Phone'),
      text('group', 'Group'),
      text('address', 'Address'),
      money('toCollect', 'To collect'),
      money('toPay', 'To pay'),
      bare('creditLimit', 'Credit limit'),
    ],
    summary: (_r, t) => [
      chip('To collect', t.toCollect ?? 0, { tone: 'pos' }),
      chip('To pay', t.toPay ?? 0, { tone: 'neg' }),
      chip('Parties', t.count ?? 0, { money: false }),
    ],
  }),
  'party-pnl': () => ({
    filters: [period('this-fy'), search],
    columns: [
      sorted('name', 'Party'),
      text('phone', 'Phone'),
      money('sale', 'Total sale'),
      money('cost', 'Cost'),
      money('profit', 'Profit / loss', { sortable: true }),
    ],
    summary: (_r, t) => [
      chip('Sale', t.sale ?? 0),
      chip('Profit', t.profit ?? 0, { tone: (t.profit ?? 0) >= 0 ? 'pos' : 'neg' }),
    ],
  }),
  'party-by-item': (ctx) => ({
    filters: [period('this-fy'), party(ctx), item(ctx), search],
    columns: [
      sorted('party', 'Party'),
      sorted('item', 'Item'),
      num('saleQty', 'Sale qty'),
      money('saleAmt', 'Sale amount'),
      num('purchaseQty', 'Purchase qty'),
      money('purchaseAmt', 'Purchase amount'),
    ],
  }),
  'by-party': () => ({
    filters: [period('this-fy'), SIDE, search],
    columns: [sorted('party', 'Party'), money('amount', 'Amount', { sortable: true })],
    summary: (_r, t) => [chip('Total', t.amount ?? 0)],
  }),
  'by-party-group': () => ({
    filters: [period('this-fy'), SIDE],
    columns: [
      { id: 'group', header: 'Group', render: (r) => `${'   '.repeat(r.depth || 0)}${r.group}` },
      bare('own', 'Own parties'),
      bare('amount', 'With groups below'),
    ],
    summary: (_r, t) => [chip('Total', t.amount ?? 0)],
  }),
  salesman: () => ({
    filters: [
      period('this-month'),
      select(
        'basis',
        'Commission on',
        [
          { value: 'sale', label: 'Sales' },
          { value: 'collection', label: 'Collections' },
        ],
        'sale',
      ),
    ],
    columns: [
      sorted('salesman', 'Salesman'),
      money('sales', 'Sales'),
      money('collected', 'Collected'),
      money('outstanding', 'Outstanding'),
      money('commission', 'Commission'),
      { id: 'targetPct', header: 'Target %', align: 'right' },
    ],
    summary: (_r, t) => [
      chip('Sales', t.sales ?? 0),
      chip('Collected', t.collected ?? 0, { tone: 'pos' }),
      chip('Commission', t.commission ?? 0),
    ],
  }),
  'stock-summary': () => ({
    filters: [period('this-fy'), toggle('hideZero', 'Hide zero stock'), search],
    columns: [
      sorted('item', 'Item'),
      text('category', 'Category'),
      text('unit', 'Unit'),
      bare('salePrice', 'Sale price'),
      bare('purchasePrice', 'Purchase price'),
      num('qty', 'Qty'),
      bare('avgCost', 'Avg cost'),
      money('value', 'Value', { sortable: true }),
    ],
    summary: (_r, t, m) => [
      chip('Stock value', t.value ?? 0),
      chip('Quantity', t.qty ?? 0, { money: false }),
      chip('As of', m.asOf ?? '', { money: false }),
    ],
  }),
  'stock-by-category': () => ({
    filters: [period('this-fy')],
    columns: [sorted('category', 'Category'), num('qty', 'Qty'), money('value', 'Value')],
    summary: (_r, t) => [chip('Stock value', t.value ?? 0)],
  }),
  'stock-detail': (ctx) => ({
    filters: [item(ctx, true), period('this-fy')],
    columns: [
      text('date', 'Date'),
      text('type', 'Txn'),
      text('number', 'Ref'),
      text('party', 'Party'),
      num('qtyIn', 'In', { total: undefined }),
      num('qtyOut', 'Out', { total: undefined }),
      bare('cost', 'Cost / unit'),
      num('balance', 'Balance', { total: undefined }),
    ],
    summary: (_r, t, m) => [
      chip(m.item || 'Item', '', { money: false }),
      chip('Opening', t.opening ?? 0, { money: false }),
      chip('In', t.qtyIn ?? 0, { money: false }),
      chip('Out', t.qtyOut ?? 0, { money: false }),
      chip('Closing', t.closing ?? 0, { money: false }),
      chip('Value', t.value ?? 0),
    ],
    drilldown: docs,
    fetch: needs(['itemId'], 'stock-detail', ctx),
  }),
  'item-detail': (ctx) => ({
    filters: [item(ctx, true), period('this-fy')],
    columns: [
      text('date', 'Date'),
      text('type', 'Txn'),
      text('number', 'Ref'),
      text('party', 'Party'),
      num('qtyIn', 'Qty in', { total: undefined }),
      num('qtyOut', 'Qty out', { total: undefined }),
      bare('price', 'Price'),
      num('balance', 'Running stock', { total: undefined }),
    ],
    summary: (_r, t, m) => [
      chip(m.item || 'Item', '', { money: false }),
      chip('Opening', t.opening ?? 0, { money: false }),
      chip('Closing', t.closing ?? 0, { money: false }),
    ],
    drilldown: docs,
    fetch: needs(['itemId'], 'item-detail', ctx),
  }),
  'low-stock': () => ({
    filters: [
      select(
        'threshold',
        'Limit',
        ['5', '10', '25', '50', '100'].map((v) => ({ value: v, label: `Up to ${v}` })),
        '5',
      ),
      search,
    ],
    columns: [
      sorted('item', 'Item'),
      text('category', 'Category'),
      text('unit', 'Unit'),
      num('minStock', 'Minimum', { total: undefined }),
      num('current', 'Current', { total: undefined }),
      num('shortfall', 'Shortfall', { sortable: true }),
    ],
    summary: (_r, t) => [chip('Items low', t.count ?? 0, { money: false, tone: 'neg' })],
  }),
  'item-by-party': (ctx) => ({
    filters: [item(ctx, true), period('this-fy')],
    columns: [
      sorted('party', 'Party'),
      num('saleQty', 'Sale qty'),
      money('saleAmt', 'Sale amount'),
      num('purchaseQty', 'Purchase qty'),
      money('purchaseAmt', 'Purchase amount'),
    ],
    fetch: needs(['itemId'], 'item-by-party', ctx),
  }),
  'item-pnl': () => ({
    filters: [period('this-fy'), search],
    columns: [
      sorted('item', 'Item'),
      text('category', 'Category'),
      num('saleQty', 'Sale qty'),
      money('saleAmt', 'Sale amount'),
      money('cost', 'Cost'),
      money('closingStock', 'Closing stock'),
      money('profit', 'Profit', { sortable: true }),
    ],
    summary: (_r, t) => [
      chip('Sale', t.saleAmt ?? 0),
      chip('Cost', t.cost ?? 0),
      chip('Profit', t.profit ?? 0, { tone: (t.profit ?? 0) >= 0 ? 'pos' : 'neg' }),
    ],
  }),
  'category-pnl': () => ({
    filters: [period('this-fy')],
    columns: [
      sorted('category', 'Category'),
      num('saleQty', 'Sale qty'),
      money('saleAmt', 'Sale amount'),
      money('cost', 'Cost'),
      money('closingStock', 'Closing stock'),
      money('profit', 'Profit', { sortable: true }),
    ],
    summary: (_r, t) => [
      chip('Profit', t.profit ?? 0, { tone: (t.profit ?? 0) >= 0 ? 'pos' : 'neg' }),
    ],
  }),
  'by-category': () => ({
    filters: [period('this-fy'), SIDE],
    columns: [
      sorted('category', 'Category'),
      num('qty', 'Qty'),
      money('amount', 'Amount', { sortable: true }),
    ],
    summary: (_r, t) => [chip('Total', t.amount ?? 0)],
  }),
  'item-discount': () => ({
    filters: [period('this-fy'), search],
    columns: [
      sorted('item', 'Item'),
      num('qty', 'Qty'),
      money('amount', 'Sale amount'),
      money('discount', 'Discount', { sortable: true }),
      { id: 'discountPct', header: 'Discount %', align: 'right' },
    ],
    summary: (_r, t) => [chip('Discount given', t.discount ?? 0, { tone: 'neg' })],
  }),
  'gst-rate': () => ({
    filters: [period(), SIDE3, toggle('creditNotes', 'Include credit / debit notes', true)],
    columns: [
      text('side', 'Side'),
      { id: 'rate', header: 'Rate %', align: 'right' },
      money('taxable', 'Taxable'),
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('igst', 'IGST'),
      money('cess', 'Cess'),
      money('totalTax', 'Total tax'),
      num('invoices', 'Documents'),
    ],
    summary: (_r, t) => [chip('Taxable', t.taxable ?? 0), chip('Tax', t.totalTax ?? 0)],
  }),
  hsn: () => ({
    filters: [
      period(),
      SIDE,
      select(
        'digits',
        'Digits',
        [
          { value: '4', label: '4 digits' },
          { value: '6', label: '6 digits' },
          { value: '8', label: '8 digits' },
        ],
        '8',
      ),
      toggle('creditNotes', 'Include credit / debit notes', true),
    ],
    columns: [
      sorted('code', 'HSN'),
      text('description', 'Description'),
      text('uqc', 'UQC'),
      num('qty', 'Qty'),
      money('taxable', 'Taxable'),
      { id: 'rate', header: 'Rate %', align: 'right' },
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('igst', 'IGST'),
      money('cess', 'Cess'),
      money('total', 'Total'),
    ],
    summary: (_r, t) => [chip('Taxable', t.taxable ?? 0), chip('Total', t.total ?? 0)],
  }),
  sac: () => ({
    filters: [
      period(),
      SIDE,
      select(
        'digits',
        'Digits',
        [
          { value: '4', label: '4 digits' },
          { value: '6', label: '6 digits' },
          { value: '8', label: '8 digits' },
        ],
        '8',
      ),
      toggle('creditNotes', 'Include credit / debit notes', true),
    ],
    columns: [
      sorted('code', 'SAC'),
      text('description', 'Description'),
      money('taxable', 'Taxable'),
      { id: 'rate', header: 'Rate %', align: 'right' },
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('igst', 'IGST'),
      money('cess', 'Cess'),
      money('total', 'Total'),
    ],
    summary: (_r, t) => [chip('Taxable', t.taxable ?? 0), chip('Total', t.total ?? 0)],
  }),
  'sale-gst': () => ({
    filters: [period(), toggle('creditNotes', 'Include credit notes', true), search],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Invoice'),
      sorted('party', 'Party'),
      text('gstin', 'GSTIN'),
      text('pos', 'POS'),
      { id: 'rate', header: 'Rate %', align: 'right' },
      money('taxable', 'Taxable'),
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('igst', 'IGST'),
      money('cess', 'Cess'),
      money('total', 'Total'),
    ],
    summary: (_r, t) => [chip('Taxable', t.taxable ?? 0), chip('Total', t.total ?? 0)],
    drilldown: docs,
  }),
  'purchase-gst': () => ({
    filters: [period(), toggle('creditNotes', 'Include debit notes', true), search],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Bill'),
      sorted('party', 'Supplier'),
      text('gstin', 'GSTIN'),
      { id: 'rate', header: 'Rate %', align: 'right' },
      money('taxable', 'Taxable'),
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('igst', 'IGST'),
      money('cess', 'Cess'),
      money('total', 'Total'),
      text('itc', 'ITC status'),
    ],
    summary: (_r, t) => [chip('Taxable', t.taxable ?? 0), chip('Total', t.total ?? 0)],
    drilldown: docs,
  }),
  'form-27eq': () => ({
    filters: [period('this-quarter'), search],
    columns: [
      text('pan', 'Collectee PAN', { render: (r) => (r.panMissing ? `${r.pan} ⚠` : r.pan) }),
      sorted('collectee', 'Collectee'),
      text('nature', 'Nature of collection'),
      sorted('date', 'Date of collection'),
      text('invoice', 'Invoice'),
      money('received', 'Amount received'),
      money('tcs', 'TCS collected'),
      { id: 'rate', header: 'Rate %', align: 'right' },
      text('challan', 'Challan'),
    ],
    summary: (_r, t) => [
      chip('Received', t.received ?? 0),
      chip('TCS', t.tcs ?? 0),
      chip('Missing PAN', t.missingPan ?? 0, {
        money: false,
        tone: (t.missingPan ?? 0) > 0 ? 'neg' : undefined,
      }),
    ],
  }),
  'eway-register': () => ({
    filters: [
      period(),
      select(
        'status',
        'Status',
        [
          { value: '', label: 'All' },
          { value: 'pending', label: 'Pending' },
          { value: 'generated', label: 'Generated' },
          { value: 'cancelled', label: 'Cancelled' },
        ],
        '',
      ),
      search,
    ],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Invoice'),
      sorted('party', 'Party'),
      money('value', 'Value'),
      text('ewayNo', 'E-way bill no'),
      text('vehicle', 'Vehicle'),
      text('status', 'Status'),
      text('validUntil', 'Valid until'),
      text('jsonExportedOn', 'JSON exported'),
    ],
    summary: (_r, t) => [
      chip('Invoices', t.value ?? 0),
      chip('Pending', t.pending ?? 0, {
        money: false,
        tone: (t.pending ?? 0) > 0 ? 'neg' : undefined,
      }),
    ],
    drilldown: docs,
  }),
  expense: (ctx) => ({
    filters: [
      period(),
      select(
        'categoryId',
        'Category',
        [
          { value: '', label: 'All categories' },
          ...(ctx.categories || []).map((c) => ({ value: c.id, label: c.name })),
        ],
        '',
      ),
      search,
    ],
    columns: [
      sorted('date', 'Date'),
      text('number', 'No'),
      sorted('category', 'Category'),
      sorted('payee', 'Payee'),
      text('description', 'Description'),
      money('amount', 'Amount'),
      money('gst', 'GST'),
      money('total', 'Total'),
      text('mode', 'Paid by'),
    ],
    summary: (_r, t) => [chip('Expenses', t.total ?? 0, { tone: 'neg' }), chip('GST', t.gst ?? 0)],
    drilldown: docs,
  }),
  'expense-category': () => ({
    filters: [period()],
    columns: [
      sorted('category', 'Category'),
      money('total', 'Total', { sortable: true }),
      { id: 'share', header: 'Share %', align: 'right' },
    ],
    summary: (_r, t) => [chip('Total', t.total ?? 0)],
  }),
  'expense-item': () => ({
    filters: [period(), search],
    columns: [
      sorted('item', 'Item'),
      num('qty', 'Qty'),
      money('amount', 'Amount', { sortable: true }),
    ],
    summary: (_r, t) => [chip('Total', t.amount ?? 0)],
  }),
  'other-income': () => ({
    filters: [period()],
    columns: [
      sorted('category', 'Category'),
      money('total', 'Total', { sortable: true }),
      { id: 'share', header: 'Share %', align: 'right' },
    ],
    summary: (_r, t) => [chip('Other income', t.total ?? 0, { tone: 'pos' })],
  }),
  discount: () => ({
    filters: [period(), search],
    columns: [
      sorted('party', 'Party'),
      money('saleDiscount', 'Sale discount'),
      money('paymentDiscountGiven', 'Payment discount given'),
      money('paymentDiscountReceived', 'Payment discount received'),
    ],
    summary: (_r, t) => [
      chip('Sale discount', t.saleDiscount ?? 0),
      chip('Given on payments', t.paymentDiscountGiven ?? 0),
      chip('Received on payments', t.paymentDiscountReceived ?? 0),
    ],
  }),
  'sale-order': () => ({
    filters: [
      period(),
      select(
        'status',
        'Status',
        [
          { value: '', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'partially-invoiced', label: 'Partly invoiced' },
          { value: 'closed', label: 'Closed' },
          { value: 'cancelled', label: 'Cancelled' },
        ],
        '',
      ),
      search,
    ],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Order no'),
      sorted('party', 'Party'),
      text('due', 'Due'),
      text('status', 'Status'),
      money('total', 'Total'),
      money('advance', 'Advance'),
    ],
    summary: (_r, t) => [
      chip('Orders', t.count ?? 0, { money: false }),
      chip('Value', t.total ?? 0),
      chip('Advance', t.advance ?? 0),
    ],
    drilldown: docs,
  }),
  'sale-order-item': () => ({
    filters: [period(), search],
    columns: [
      sorted('item', 'Item'),
      num('ordered', 'Ordered'),
      num('invoiced', 'Invoiced'),
      num('pending', 'Pending', { sortable: true }),
      money('amount', 'Ordered value'),
    ],
    summary: (_r, t) => [
      chip('Pending quantity', t.pending ?? 0, { money: false }),
      chip('Ordered value', t.amount ?? 0),
    ],
  }),
  'purchase-order': () => ({
    filters: [
      period(),
      select(
        'status',
        'Status',
        [
          { value: '', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'partial', label: 'Partly received' },
          { value: 'received', label: 'Received' },
          { value: 'cancelled', label: 'Cancelled' },
        ],
        '',
      ),
      search,
    ],
    columns: [
      sorted('date', 'Date'),
      sorted('number', 'Order no'),
      sorted('supplier', 'Supplier'),
      text('expected', 'Expected'),
      text('status', 'Status'),
      money('taxable', 'Taxable'),
      money('total', 'Total'),
    ],
    summary: (_r, t) => [
      chip('Orders', t.count ?? 0, { money: false }),
      chip('Value', t.total ?? 0),
    ],
  }),
  'cash-watch': () => ({
    filters: [period('this-fy')],
    columns: [
      sorted('date', 'Date'),
      sorted('party', 'Party'),
      money('total', 'Cash received'),
      money('over', 'Over the limit'),
    ],
    summary: (_r, t) => [
      chip('Days over', t.count ?? 0, {
        money: false,
        tone: (t.count ?? 0) > 0 ? 'neg' : undefined,
      }),
      chip('Cash', t.total ?? 0),
    ],
  }),
};

/** The ReportShell definition of a server report from its spec, or null when the web has none for it. */
export function specDefinition(meta, ctx) {
  const make = SPECS[meta.id];
  if (!make) return null;
  const s = make(ctx);
  return {
    id: meta.id,
    title: meta.title,
    description: meta.description,
    exports: ['pdf', 'xlsx', 'csv', 'share'],
    fetch: (params) => runServerReport(meta.id, ctx.businessId, params),
    ...s,
  };
}

export const SPEC_IDS = Object.keys(SPECS);
