// The sales flow in one place: the pages under Sell, which document types each one lists, and which document
// can be raised from which. The sidebar, the list pages, the overview and the row actions all read this.
//
//   Quotation -> Sales Order -> Delivery Challan -> Tax Invoice -> Receipt
//                                                       |-> Credit Note (a return or correction)
//
// A step can be skipped: a quotation can go straight to an invoice, and a sale needs no quotation at all.

export const SALES_PAGES = [
  {
    id: 'sales-quotes',
    path: '/sales/quotations',
    label: 'Quotations',
    singular: 'Quotation',
    types: ['quotation'],
    newType: 'quotation',
    blurb: 'Priced offers you send before a sale. When the client accepts, turn one into a sales order or an invoice.',
  },
  {
    id: 'sales-orders',
    path: '/sales/orders',
    label: 'Sales Orders',
    singular: 'Sales Order',
    types: ['sales-order'],
    newType: 'sales-order',
    blurb: 'What clients have confirmed they want. Deliver it with a challan, bill it with an invoice, or both.',
  },
  {
    id: 'sales-challans',
    path: '/sales/challans',
    label: 'Delivery Challans',
    singular: 'Delivery Challan',
    types: ['delivery-challan'],
    newType: 'delivery-challan',
    blurb: 'Goods that leave your premises before or without an invoice. Stock goes out when you save one.',
  },
  {
    id: 'sales-invoices',
    path: '/sales/invoices',
    label: 'Invoices',
    singular: 'Invoice',
    types: ['tax-invoice', 'bill-of-supply', 'composition'],
    newType: 'tax-invoice',
    blurb: 'Tax invoices, bills of supply and composition bills. These are the sales that reach your GST returns.',
  },
  {
    id: 'sales-proforma',
    path: '/sales/proforma',
    label: 'Proforma',
    singular: 'Proforma',
    types: ['proforma'],
    newType: 'proforma',
    blurb: 'Advance or estimate invoices that are not tax documents. Convert one to a tax invoice when you bill.',
  },
  {
    id: 'sales-credit',
    path: '/sales/credit-notes',
    label: 'Credit Notes',
    singular: 'Credit Note',
    types: ['credit-note'],
    newType: 'credit-note',
    blurb: 'Returns, price corrections and discounts after an invoice. They reduce sales and put returned stock back.',
  },
];

export const salesPageForView = (id) => SALES_PAGES.find((p) => p.id === id) || null;
export const salesPageForType = (type) => SALES_PAGES.find((p) => p.types.includes(type || 'tax-invoice')) || null;

// What can be raised from a document. `linkOnly` steps leave the source open (a credit note does not close its
// invoice, which still collects payments); the others close the source ("Converted") and carry its stock over.
export const NEXT_STEPS = {
  quotation: [
    { to: 'sales-order', label: 'Create Sales Order' },
    { to: 'tax-invoice', label: 'Create Invoice' },
  ],
  'sales-order': [
    { to: 'delivery-challan', label: 'Create Delivery Challan' },
    { to: 'tax-invoice', label: 'Create Invoice' },
  ],
  'delivery-challan': [{ to: 'tax-invoice', label: 'Create Invoice' }],
  proforma: [{ to: 'tax-invoice', label: 'Create Invoice' }],
  'tax-invoice': [{ to: 'credit-note', label: 'Issue Credit Note', linkOnly: true }],
};

export const nextStepsFor = (bill) => NEXT_STEPS[bill?.invoiceType || 'tax-invoice'] || [];

// The stages on the overview, in order.
export const PIPELINE = [
  { key: 'quotation', label: 'Quotation', page: 'sales-quotes', types: ['quotation'], newType: 'quotation' },
  { key: 'sales-order', label: 'Sales Order', page: 'sales-orders', types: ['sales-order'], newType: 'sales-order' },
  { key: 'delivery-challan', label: 'Delivery Challan', page: 'sales-challans', types: ['delivery-challan'], newType: 'delivery-challan' },
  { key: 'tax-invoice', label: 'Invoice', page: 'sales-invoices', types: ['tax-invoice', 'bill-of-supply', 'composition'], newType: 'tax-invoice' },
];

// The words each document's create page uses, so a quotation reads like a quotation and not like an invoice.
const INVOICE_COPY = { number: 'Invoice Number', date: 'Invoice Date', due: 'Due Date', party: 'Billed To' };
export const DOC_COPY = {
  quotation: { number: 'Quotation Number', date: 'Quotation Date', due: 'Valid Until', party: 'Quotation For', tip: 'Set how long this offer stays open in "Valid Until".' },
  'sales-order': { number: 'Order Number', date: 'Order Date', due: 'Expected Delivery', party: 'Customer', tip: 'Record what the customer confirmed. Delivery and billing follow from it.' },
  'delivery-challan': { number: 'Challan Number', date: 'Challan Date', due: 'Delivery By', party: 'Deliver To', tip: 'Stock goes out when you save. Add the vehicle number under dispatch details.' },
  proforma: { number: 'Proforma Number', date: 'Proforma Date', due: 'Valid Until', party: 'Billed To', tip: 'Not a tax document. Convert it to a tax invoice when you bill.' },
  'credit-note': { number: 'Credit Note Number', date: 'Credit Note Date', due: null, party: 'Credit To', tip: 'Name the invoice it corrects. Stock of returned goods goes back.' },
  'tax-invoice': { ...INVOICE_COPY, tip: 'This is the sale. It reaches your GST returns.' },
  'bill-of-supply': { ...INVOICE_COPY, number: 'Bill Number', date: 'Bill Date', tip: 'No GST is charged. Reported as an exempt supply.' },
  composition: { ...INVOICE_COPY, number: 'Bill Number', date: 'Bill Date', tip: 'For composition dealers. The Rule 46A declaration is added.' },
};
export const copyFor = (type) => ({ ...INVOICE_COPY, ...(DOC_COPY[type || 'tax-invoice'] || {}) });

// The route a sale takes, with a branch for returns.
export const FLOW_STAGES = [
  { type: 'quotation', label: 'Quotation' },
  { type: 'sales-order', label: 'Sales Order' },
  { type: 'delivery-challan', label: 'Delivery Challan' },
  { type: 'tax-invoice', label: 'Invoice' },
  { type: 'credit-note', label: 'Credit Note' },
];
export const stageIndexFor = (type) => {
  const t = type === 'bill-of-supply' || type === 'composition' ? 'tax-invoice' : type;
  return FLOW_STAGES.findIndex((s) => s.type === t);
};
