// What the landing page says. Every line here is something the software does today (see docs/AUDIT_2026-11.md and the screens
// named in the comments); what it does not do yet is said as "on our roadmap", never implied. Prices and plan features are not
// written here: the page reads them from the plan catalogue the server enforces (packages/contracts/src/plans.ts).

export const STATS = [
  ['123', 'income-tax portal rules checked, by number, before an ITR-3 file can be saved'],
  ['6', 'GST returns prepared: GSTR-1, 3B, 9, 9C, CMP-08 and GSTR-4'],
  ['30+', 'reports from the ledger, each exportable to PDF, Excel and CSV'],
  ['7 days', 'free trial of every feature, then a Free plan that stays free'],
];

/** The whole product, by area. `id` doubles as the anchor. */
export const MODULES = [
  {
    id: 'sell', title: 'Sell', icon: 'receipt',
    blurb: 'From the first quote to the money in your account.',
    points: [
      'GST tax invoices, bills of supply, composition bills, quotations, sales orders, delivery challans, proforma and credit notes',
      'Convert a quotation to an order, a challan and an invoice in one click each',
      'Recurring invoices, receipts allocated across bills, UPI QR on every invoice',
      'Credit-limit and cash-limit guards, offer codes, loyalty points, salesmen and targets',
      'E-way bill and e-invoice (IRN) files prepared for upload',
    ],
  },
  {
    id: 'pos', title: 'POS counter', icon: 'cart',
    blurb: 'A billing screen built for a queue.',
    points: [
      'Scan or search by code, barcode or name; several bills open as tabs',
      'Keyboard shortcuts for quantity, discount, remove, unit, charges and remarks',
      'Cash change, split and credit payments, thermal and A4 printing',
      'Barcode label printing from your item list',
    ],
  },
  {
    id: 'buy', title: 'Buy and spend', icon: 'bag',
    blurb: 'Purchases, expenses and what you owe.',
    points: [
      'Purchase bills, purchase orders, returns and debit notes, payments out',
      'Reverse charge, import of goods and services, and the 180-day input-credit clock',
      'Expenses and other income with GST, supplier and MSME due-date tracking',
      'Supplier statements and ageing of what you owe',
    ],
  },
  {
    id: 'stock', title: 'Items and stock', icon: 'box',
    blurb: 'Know what you have and what it is worth.',
    points: [
      'HSN / SAC with GST rate hints, units and secondary units, categories',
      'Batch and serial tracking, wholesale and party-wise rates',
      'Low-stock alerts with your own minimums, stock valuation at weighted-average cost',
      'Bulk edit and CSV import and export',
    ],
  },
  {
    id: 'bank', title: 'Cash and bank', icon: 'bank',
    blurb: 'Every rupee, in the right place.',
    points: [
      'Bank accounts, cash in hand, transfers, cheques, loan accounts',
      'Import a bank statement and reconcile it line by line',
      'Opening balances posted to the ledger, never to a side sheet',
    ],
  },
  {
    id: 'books', title: 'Books and accounting', icon: 'book',
    blurb: 'Double-entry, behind every bill you raise.',
    points: [
      'Chart of accounts, ledgers, journals, trial balance, profit and loss, balance sheet',
      'Every invoice, bill, payment and expense posts itself; Verify My Data finds what does not add up',
      'Close the financial year, lock a period, export to Tally',
      'Fixed-asset register with income-tax and Companies Act depreciation',
    ],
  },
  {
    id: 'gst', title: 'GST returns', icon: 'file',
    blurb: 'Returns prepared, checked and recorded.',
    points: [
      'GSTR-1 and GSTR-3B files, GSTR-1A, GSTR-9 and 9C worksheets, CMP-08 and GSTR-4',
      'GSTR-2B and IMS reconciliation, HSN summary, late-fee and interest estimates',
      'Filing packs with a SHA-256 fingerprint, CA review, approval, and the acknowledgement number recorded',
      'The month locks once filed',
    ],
  },
  {
    id: 'tax', title: 'Income tax', icon: 'calc',
    blurb: 'The return, built from your books.',
    points: [
      'ITR-3 (business income from the books) and ITR-4 (presumptive 44AD / 44ADA) files for upload',
      'Advance-tax plan, challans, interest under 234A, 234B and 234C, late fee',
      'AIS and TIS import, matched with your books and your return',
      'Old and new regime calculator, TDS and TCS on sales',
    ],
  },
  {
    id: 'reports', title: 'Reports', icon: 'chart',
    blurb: 'Answers, not exports.',
    points: [
      'Day book, party statements, receivable and payable ageing, cash flow, bill-wise profit',
      'Item, party and category profit, stock, GST rate-wise and expense reports',
      'Scheduled reports by e-mail; every report filters, totals and exports',
    ],
  },
  {
    id: 'grow', title: 'Grow', icon: 'spark',
    blurb: 'Get paid faster and sell more.',
    points: [
      'Payment and service reminders by WhatsApp and e-mail',
      'An online catalogue you can share, offer codes, loyalty',
      'Party groups, credit control, salesman targets and visits',
    ],
  },
  {
    id: 'team', title: 'Team and your CA', icon: 'people',
    blurb: 'The right people see the right things.',
    points: [
      'Roles you can edit: own transactions only, hide purchase prices, limit to a business or a date range',
      'More than one business under one login',
      'A free CA seat, and a practice dashboard for a CA with many clients',
    ],
  },
  {
    id: 'platform', title: 'Safe and everywhere', icon: 'shield',
    blurb: 'Your data, protected and portable.',
    points: [
      'Works in any browser and installs as an app; Hindi and Tamil screens; dark mode',
      'Encrypted and scheduled backups, Google Drive option, restore, and a 30-day trash',
      'Two-step sign-in, a list of your sessions, and each organization\'s data kept apart in the database',
    ],
  },
];

/** The ways Ledgora is different, each with the proof on screen. */
export const DIFFERENT = [
  {
    id: 'clean',
    kicker: 'Clean returns',
    title: 'Files that the portal accepts the first time',
    body: 'Before a return can be saved, it is checked against the Income Tax Department\'s own published JSON schema and its validation rules, rule by rule, with the rule\'s number in the message. A balance sheet that does not balance, a depreciation figure that is a rupee off, a total that does not add up: you see it here, not in a rejection e-mail.',
    proof: {
      title: 'Pre-filing checks, ITR-3',
      rows: [
        ['Rule 52', 'Sources of funds equal application of funds', 'ok'],
        ['Rule 94', 'Profit before tax equals PBIDTA less interest and depreciation', 'ok'],
        ['Rule 240', 'Depreciation in Schedule BP equals Schedule DEP', 'ok'],
        ['Rule 935', 'Total income equals gross total income less deductions', 'ok'],
        ['Rule 310', 'The 45% block can not be claimed under the new regime', 'warn'],
      ],
    },
  },
  {
    id: 'books',
    kicker: 'Books to return',
    title: 'Your income-tax return comes from your books, not from re-typing them',
    body: 'Invoices and bills post to the ledger. The ledger gives the trading and profit and loss accounts and the balance sheet; the asset register gives the depreciation; the return picks all of it up. Advance tax, challans and the AIS match sit beside it. The software prepares the file; you or your CA upload it.',
    flow: ['Invoices and bills', 'Ledger', 'Profit and loss, balance sheet', 'ITR-3 or ITR-4 file', 'You file on the portal'],
  },
  {
    id: 'ca',
    kicker: 'Your CA, on your data',
    title: 'No more Excel sheets by e-mail',
    body: 'Invite your CA with a free seat. They open the same books, review each return as a pack, ask for changes, and approve the exact file that will be filed. When you record the acknowledgement number, the month locks. A CA with many clients gets one dashboard across all of them.',
    proof: {
      title: 'GSTR-3B, October',
      rows: [['Prepared', 'Today, 10:12', 'ok'], ['Sent for review', 'To your CA', 'ok'], ['Approved', 'Exact file fingerprint kept', 'ok'], ['Filed', 'ARN recorded, month locked', 'ok']],
    },
  },
  {
    id: 'watch',
    kicker: 'Warnings before the notice',
    title: 'Cash Watch tells you while you can still fix it',
    body: 'Cash payments above the limit to one person in a day (section 40A(3)), cash receipts and loans above the limits (269ST, 269SS, 269T), MSME suppliers you have not paid in time (43B(h)), and input credit about to be reversed after 180 days: each shown with the invoice or bill behind it.',
    proof: {
      title: 'Cash Watch',
      rows: [['40A(3)', 'Cash payment to one supplier in a day', 'warn'], ['43B(h)', 'MSME supplier unpaid past 45 days', 'warn'], ['ITC', '3 bills reach 180 days this month', 'warn'], ['269ST', 'No cash receipt above the limit', 'ok']],
    },
  },
  {
    id: 'trail',
    kicker: 'A trail an auditor trusts',
    title: 'Nobody can quietly change the books, including you',
    body: 'An append-only edit log records who changed which accounting record and when, and cannot be switched off. Locked periods stay locked. Verify My Data checks that the ledger, the invoices and the stock agree, and offers to fix what it can.',
    proof: {
      title: 'Verify My Data',
      rows: [['Trial balance', 'Debits equal credits', 'ok'], ['Receivables', 'Ledger matches party balances', 'ok'], ['Stock', 'Valuation matches movements', 'ok'], ['Period lock', 'Up to 31 Mar locked', 'ok']],
    },
  },
  {
    id: 'yours',
    kicker: 'Your data is yours',
    title: 'Protected where it matters, portable when you want it',
    body: 'Aadhaar and bank account numbers are encrypted with a key tied to your organization and shown only by their last digits. Each organization\'s rows are separated by the database itself, not just by the application. Download everything any time; scheduled backups are encrypted.',
    bullets: ['Row-level data isolation per organization', 'AES-256-GCM sealed identity numbers', 'Two-step sign-in and a session list', 'Full export and encrypted backups'],
  },
];

export const STEPS = [
  ['Sign up and set up', 'A four-step setup: your business, address, bank and year, invoice defaults. About three minutes.'],
  ['Add parties and items', 'Type them in, or import a CSV. Opening balances go straight to the ledger.'],
  ['Bill, buy and get paid', 'Raise invoices and bills, record payments, send reminders. The books keep themselves.'],
  ['File with confidence', 'Prepare the return, let it be checked, have your CA approve it, and file on the portal.'],
];

export const AUDIENCES = [
  ['Shops and retailers', 'Counter billing with barcodes, stock alerts, UPI and thermal receipts.'],
  ['Traders and distributors', 'Party-wise rates, credit limits, batches, ageing and e-way bills.'],
  ['Freelancers and professionals', 'Quotations, recurring invoices, TDS handling and a presumptive ITR-4.'],
  ['Growing businesses', 'Several businesses, roles for your team, full books and an ITR-3 from them.'],
  ['Chartered accountants', 'Client packs to review and approve, one dashboard, a free seat for every client.'],
];

/** Honest comparison. 'yes' included, 'part' varies by product and plan, 'no' not offered, 'soon' on our roadmap. */
export const COMPARE_COLUMNS = [
  { id: 'us', name: 'Ledgora', hint: '' },
  { id: 'billing', name: 'GST billing apps', hint: 'such as Vyapar and myBillBook' },
  { id: 'suite', name: 'Accounting suites', hint: 'such as Zoho Books and TallyPrime' },
];
export const COMPARE_ROWS = [
  ['Sales documents, POS and GST invoices', 'yes', 'yes', 'yes'],
  ['GSTR-1 and 3B files', 'yes', 'yes', 'yes'],
  ['GSTR-9 / 9C, CMP-08 and GSTR-4 worksheets', 'yes', 'part', 'yes'],
  ['GSTR-2B and IMS reconciliation', 'yes', 'part', 'yes'],
  ['Return checked against the portal\'s own rules, by rule number', 'yes', 'no', 'part'],
  ['Income-tax return (ITR-3, ITR-4) built from your books', 'yes', 'no', 'no'],
  ['Advance tax, challans and AIS / TIS match', 'yes', 'no', 'no'],
  ['Fixed assets with tax and Companies Act depreciation', 'yes', 'no', 'part'],
  ['Double-entry books, balance sheet, close the year', 'yes', 'part', 'yes'],
  ['Append-only edit log and period lock', 'yes', 'part', 'yes'],
  ['Cash-limit and MSME-dues watch (40A(3), 269ST, 43B(h))', 'yes', 'no', 'part'],
  ['CA review and approval in the app, free CA seat', 'yes', 'no', 'part'],
  ['A free plan that stays free', 'yes', 'part', 'part'],
  ['Hindi and Tamil screens', 'yes', 'yes', 'part'],
  ['Works in a browser and installs as an app', 'yes', 'part', 'part'],
  ['E-invoice and GST portal upload directly from the app', 'soon', 'part', 'yes'],
  ['Bank feeds', 'soon', 'no', 'part'],
  ['Payroll', 'soon', 'no', 'part'],
  ['Several godowns and manufacturing', 'soon', 'part', 'yes'],
  ['Native mobile apps', 'soon', 'yes', 'part'],
];
export const COMPARE_LEGEND = { yes: 'Included', part: 'Varies by product and plan', no: 'Not offered', soon: 'On our roadmap' };

export const FAQ = [
  ['Does Ledgora file my returns?', 'No. It prepares each return, checks it against the department\'s rules, lets your CA review and approve it, and records the acknowledgement. You (or your CA) upload the file on the government portal. That is deliberate: you stay in control of what is filed.'],
  ['What happens after the 7-day trial?', 'Your account moves to the Free plan unless you choose a paid one. Your data stays readable and you can download it at any time. Paid features pause until you choose a plan.'],
  ['Can my CA use it?', 'Yes. Invite them from Settings with a free CA seat. They see the books you let them see, review and approve returns, and can work on many clients from one dashboard.'],
  ['Is e-invoicing supported?', 'The e-invoice (IRN) and e-way bill files are prepared for upload. Sending them straight to the invoice registration portal from inside the app is on our roadmap.'],
  ['Can I bring my data from another app?', 'Parties and items import from CSV, with a template, and opening balances are posted to the ledger. A one-click import from other billing apps is on our roadmap. You can export to Tally.'],
  ['Does it work offline?', 'It is a web app that installs on your computer or phone, and it needs a connection to save. The invoice editor keeps your draft in the browser while you type.'],
  ['Are GST rate changes handled?', 'The 5%, 18% and 40% structure effective 22 September 2025 is supported, with the older 12% and 28% rates kept for invoices dated before it.'],
  ['Who can see my data?', 'Only the people you invite, with the access you set. Identity numbers are encrypted, each organization\'s data is separated in the database, and there is an edit log of every accounting change.'],
  ['Do you support my language?', 'The screens are available in English, Hindi and Tamil. More languages are on our roadmap.'],
];

export const TRUST = [
  ['Row-level isolation', 'Each organization\'s data is separated by the database itself.'],
  ['Sealed identity numbers', 'Aadhaar and bank accounts are encrypted and shown by last digits.'],
  ['Append-only edit log', 'Every accounting change is recorded and cannot be removed.'],
  ['Your data, any time', 'Export everything; encrypted scheduled backups; 30-day trash.'],
];
