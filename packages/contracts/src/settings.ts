import { z } from 'zod';
import { isoDate, uuid } from './common.ts';

// Vyapar parity Phase 8: the typed settings registry. Every setting is declared here once (its tab, section, control,
// default and who may change it); the API validates against it, the Settings screen renders from it, and a test
// checks that each key sits on exactly one tab.
//
// `live` is the honest part. A key is live only when some code already reads it. Everything else is `soon`: the screen
// shows it disabled with a "Coming soon" badge and the API refuses to change it, so a toggle is never silently inert.
// Flip a key to live in the same change that makes a screen obey it.

export const SETTINGS_TABS = [
  { id: 'general', label: 'General', hint: 'Business profile, regional formats, security' },
  { id: 'transaction', label: 'Transaction', hint: 'Numbering, discounts, totals, stock, locks' },
  { id: 'print', label: 'Print', hint: 'Template, paper, what to show, copies' },
  { id: 'taxes', label: 'Taxes', hint: 'Rate masters, TCS, TDS' },
  { id: 'gst', label: 'GST', hint: 'Registration, returns, e-way bill, e-invoice' },
  { id: 'message', label: 'Txn Message', hint: 'Message templates per event and channel' },
  { id: 'party', label: 'Party', hint: 'Party fields, credit limit, reminders' },
  { id: 'item', label: 'Item', hint: 'Item fields, tracking, defaults' },
  { id: 'service', label: 'Service Reminder', hint: 'Recurring service reminders' },
  { id: 'accounting', label: 'Accounting', hint: 'Ledger, default accounts, valuation' },
  { id: 'currency', label: 'Multi Currency', hint: 'Currencies and exchange rates' },
] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];
export const SETTINGS_TAB_IDS = SETTINGS_TABS.map((t) => t.id) as [
  SettingsTabId,
  ...SettingsTabId[],
];

export type SettingControl =
  | 'switch'
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'date'
  | 'select'
  | 'radio'
  | 'list'
  | 'numlist'
  | 'accounts';

export interface SettingDef<T extends z.ZodType = z.ZodType> {
  type: T;
  default: z.infer<T>;
  tab: SettingsTabId;
  section: string;
  label: string;
  help: string;
  control: SettingControl;
  /** For select and radio: value and label. */
  options?: readonly { value: string | number; label: string }[];
  /** Only an owner may change it; enforced by the API, the screen just shows the lock. */
  ownerOnly?: boolean;
  /** Some code already reads this key. Without it the key is shown as "Coming soon" and can not be changed. */
  live?: boolean;
  /** Where the value is kept for keys that older code already reads (a path inside business_settings.preferences). */
  legacy?: readonly string[];
  /** Asked before the change is saved (the consequences), for switches that are hard to undo. */
  confirm?: string;
  /** The phase that makes it live, shown on the Coming soon badge's tooltip. */
  phase?: string;
  /**
   * The value is shown here but changed on another screen, where the change can be checked first (the ledger switch
   * posts every document, so it goes through the Accounting screen). The API refuses a change made from Settings.
   */
  managedAt?: { href: string; note: string };
}

type Opt = readonly { value: string | number; label: string }[];
const opts = (...pairs: (string | [string | number, string])[]): Opt =>
  pairs.map((p) => (typeof p === 'string' ? { value: p, label: p } : { value: p[0], label: p[1] }));

type Meta = Pick<
  SettingDef,
  'tab' | 'section' | 'ownerOnly' | 'live' | 'legacy' | 'phase' | 'confirm' | 'managedAt'
>;
const at =
  (tab: SettingsTabId, section: string, extra: Partial<Meta> = {}) =>
  <T extends z.ZodType>(
    type: T,
    def: z.infer<T>,
    label: string,
    help: string,
    control: SettingControl,
    more: { options?: Opt } & Partial<Meta> = {},
  ): SettingDef<T> => ({
    type,
    default: def,
    tab,
    section,
    label,
    help,
    control,
    ...extra,
    ...more,
  });

const text = (max = 200) => z.string().trim().max(max);
const toggle = z.boolean();
const money = z.number().min(0).max(1e12);
const days = z.number().int().min(0).max(3650);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, for example 09:00');
const decimals = z.number().int().min(0).max(4);
const named = z.object({ name: text(60).min(1), gst: z.number().min(0).max(100), sac: text(10) });
const customField = z.object({ label: text(40).min(1), printOnInvoice: z.boolean() });

const general = (s: string, e?: Partial<Meta>) => at('general', s, e);
const transaction = (s: string, e?: Partial<Meta>) => at('transaction', s, e);
const print = (s: string) => at('print', s);
const gst = (s: string, e?: Partial<Meta>) => at('gst', s, e);
const party = (s: string) => at('party', s);
const item = (s: string) => at('item', s);
const accounting = (s: string, e?: Partial<Meta>) => at('accounting', s, e);

const profile = general('Business profile');
const regional = general('Regional');
const security = general('Security');
const fields = transaction('Fields shown');
const discount = transaction('Discount & charges');
const totals = transaction('Totals');
const stock = transaction('Stock');
const payments = transaction('Payments');
const locks = transaction('Locks', { ownerOnly: true });
const months = opts(
  ...[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ].map((m, i): [number, string] => [i + 1, m]),
);

export const SETTINGS = {
  // ---- General (P8-S2) ----
  'biz.type': profile(
    z.enum(['retail', 'wholesale', 'distributor', 'service', 'manufacturing', 'other']),
    'retail',
    'Business type',
    'Seeds the item library and item type defaults',
    'select',
    {
      options: opts(
        ['retail', 'Retail'],
        ['wholesale', 'Wholesale'],
        ['distributor', 'Distributor'],
        ['service', 'Service'],
        ['manufacturing', 'Manufacturing'],
        ['other', 'Other'],
      ),
      live: true,
    },
  ),
  'biz.category': profile(
    text(60),
    '',
    'Business category',
    'What you sell, in your words (for example "Mobile shop"); kept with your business details',
    'text',
    { live: true },
  ),
  'fy.startMonth': regional(
    z.number().int().min(1).max(12),
    4,
    'Financial year starts in',
    'Drives the year switcher and period presets',
    'select',
    { options: months, phase: 'P4' },
  ),
  'fmt.date': regional(
    z.enum(['dd-MM-yyyy', 'dd/MM/yyyy', 'MM-dd-yyyy']),
    'dd-MM-yyyy',
    'Date format',
    'How dates are shown',
    'select',
    { options: opts('dd-MM-yyyy', 'dd/MM/yyyy', 'MM-dd-yyyy') },
  ),
  'fmt.currency': regional(text(4).min(1), '₹', 'Currency symbol', 'Shown before amounts', 'text'),
  'fmt.decimals': regional(decimals, 2, 'Amount decimals', 'Decimal places on amounts', 'number'),
  'fmt.qtyDecimals': regional(
    decimals,
    2,
    'Quantity decimals',
    'Decimal places on quantities',
    'number',
  ),
  'fmt.wordsLang': regional(
    z.enum(['en', 'hi', 'ta']),
    'en',
    'Amount in words language',
    'Language of the amount in words on prints',
    'select',
    { options: opts(['en', 'English'], ['hi', 'Hindi'], ['ta', 'Tamil']) },
  ),
  'ui.lang': regional(z.enum(['en']), 'en', 'App language', 'Language of the screens', 'select', {
    options: opts(['en', 'English']),
    phase: 'P11',
  }),
  'sec.autoLock': security(
    z.enum(['1', '5', '15', '30', 'never']),
    'never',
    'Auto sign-out after',
    'Signs you out after this many minutes without a key press or click, so an open screen is not left unattended',
    'select',
    {
      options: opts(
        ['1', '1 minute'],
        ['5', '5 minutes'],
        ['15', '15 minutes'],
        ['30', '30 minutes'],
        ['never', 'Never'],
      ),
    },
  ),

  // ---- Transaction (P8-S3) ----
  'txn.cashDefault': fields(
    toggle,
    false,
    'Cash sale by default',
    'Add Sale starts as a cash sale',
    'switch',
  ),
  'txn.billingName': fields(
    toggle,
    false,
    'Billing name different from party name',
    'Adds a billing name field',
    'switch',
  ),
  'txn.poDetails': fields(
    toggle,
    true,
    'Customer PO details',
    'Shows purchase order number and date',
    'switch',
  ),
  'txn.transport': fields(
    toggle,
    true,
    'Transport details',
    'Shows vehicle and e-way fields',
    'switch',
  ),
  'txn.ewayThreshold': fields(
    money,
    50000,
    'E-way bill threshold',
    'Invoices above this prompt for an e-way bill',
    'money',
  ),
  'txn.charges': discount(
    z.array(named).max(10),
    [
      { name: 'Shipping', gst: 18, sac: '9965' },
      { name: 'Packaging', gst: 18, sac: '9985' },
    ],
    'Additional charges',
    'Charges that can be added to a bill',
    'list',
    { phase: 'P2' },
  ),
  'txn.discountMode': discount(
    z.enum(['line', 'transaction', 'both']),
    'both',
    'Discount mode',
    'Where discounts can be entered',
    'select',
    {
      options: opts(
        ['line', 'On each line'],
        ['transaction', 'On the whole bill'],
        ['both', 'Both'],
      ),
    },
  ),
  'txn.discountUnit': discount(
    z.enum(['percent', 'amount', 'both']),
    'both',
    'Discount unit',
    'Percent, rupees or both, for the whole-bill discount',
    'select',
    { options: opts(['percent', 'Percent'], ['amount', 'Rupees'], ['both', 'Both']) },
  ),
  'txn.roundOff': totals(
    z.enum(['nearest', 'off']),
    'nearest',
    'Round off transaction totals',
    'Rounds the final total to the nearest rupee, or not at all, on new bills',
    'select',
    { options: opts(['nearest', 'Nearest rupee'], ['off', 'Off']) },
  ),
  'txn.quickEntry': totals(
    toggle,
    false,
    'Quick entry mode',
    'Minimal columns while billing',
    'switch',
  ),
  'txn.showProfit': totals(
    toggle,
    false,
    'Show profit while billing',
    'A live profit chip in the editor, visible only to owners',
    'switch',
    { ownerOnly: true },
  ),
  'txn.showPurchasePrice': totals(
    toggle,
    false,
    'Display purchase price on item row',
    'Shows the purchase price while billing',
    'switch',
  ),
  // Unset has always meant "allow" (saleRules.ts), so that is the default; the blueprint's "warn" would change every existing business.
  'txn.negativeStock': stock(
    z.enum(['allow', 'warn', 'block']),
    'allow',
    'Allow negative stock',
    'Selling more than is in stock',
    'radio',
    {
      options: opts(['allow', 'Allow'], ['warn', 'Warn'], ['block', 'Block']),
      live: true,
      legacy: ['transaction', 'negativeStock'],
    },
  ),
  'txn.challanStock': stock(
    toggle,
    true,
    'Auto-deduct stock on challan',
    'Off keeps stock unchanged until the challan becomes an invoice',
    'switch',
    { live: true },
  ),
  'txn.barcodeScan': stock(
    toggle,
    false,
    'Barcode scan on billing',
    'Item search accepts scanner input',
    'switch',
  ),
  'txn.terms.days': payments(
    days,
    0,
    'Default payment terms (days)',
    'A sale saved without a due date gets the bill date plus this many days; 0 leaves it blank',
    'number',
    { live: true },
  ),
  'txn.editAfterPay': payments(
    toggle,
    true,
    'Allow editing after payment',
    'Off blocks editing an invoice once any payment is recorded against it',
    'switch',
    { live: true },
  ),
  'txn.autofillReceived': payments(
    toggle,
    false,
    'Auto-fill received amount',
    'Fills the received amount with the total',
    'switch',
  ),
  'txn.terms.text': payments(
    text(1000),
    '',
    'Terms & conditions default',
    'Printed on documents',
    'textarea',
  ),
  'txn.lockBefore': locks(
    z.union([isoDate, z.null()]),
    null,
    'Freeze transactions before',
    'Nothing dated on or before this day can be saved without an owner override',
    'date',
    {
      live: true,
      legacy: ['transaction', 'lockDate'],
      confirm:
        'Nothing dated on or before this day can be saved afterwards without an owner override and a reason.',
    },
  ),

  // ---- Print (P8-S4) ----
  'print.template': print('Layout')(
    z.enum(['classic', 'modern', 'minimal', 'boxed', 'tally']),
    'classic',
    'Template',
    'Look of printed documents',
    'select',
    { options: opts('classic', 'modern', 'minimal', 'boxed', 'tally') },
  ),
  'print.paper': print('Layout')(
    z.enum(['a4', 'a5', 'thermal2', 'thermal3']),
    'a4',
    'Paper size',
    'A4, A5 or thermal roll',
    'select',
    {
      options: opts(
        ['a4', 'A4'],
        ['a5', 'A5'],
        ['thermal2', 'Thermal 2 inch'],
        ['thermal3', 'Thermal 3 inch'],
      ),
    },
  ),
  'print.orientation': print('Layout')(
    z.enum(['portrait', 'landscape']),
    'portrait',
    'Orientation',
    'Page orientation',
    'select',
    { options: opts('portrait', 'landscape') },
  ),
  'print.copies': print('Layout')(
    z.enum(['original', 'duplicate', 'triplicate']),
    'original',
    'Copies',
    'Prints stacked copies with a label',
    'select',
    {
      options: opts(
        ['original', 'Original'],
        ['duplicate', 'Original + Duplicate'],
        ['triplicate', 'Original + Duplicate + Triplicate'],
      ),
    },
  ),
  'print.show.hsn': print('Show on print')(
    toggle,
    true,
    'HSN / SAC',
    'HSN or SAC column',
    'switch',
  ),
  'print.show.upiQr': print('Show on print')(
    toggle,
    true,
    'UPI QR',
    'QR code to pay by UPI',
    'switch',
  ),
  'print.show.bank': print('Show on print')(
    toggle,
    true,
    'Bank details',
    'Your bank account',
    'switch',
  ),
  // On: a line description has always printed. Off hides it.
  'print.show.description': print('Show on print')(
    toggle,
    true,
    'Item description',
    'Description under the item name',
    'switch',
  ),
  'print.show.mrp': print('Show on print')(toggle, false, 'MRP', 'MRP column', 'switch'),
  'print.show.batch': print('Show on print')(
    toggle,
    false,
    'Batch',
    'Batch number and expiry',
    'switch',
  ),
  'print.show.paymentMode': print('Show on print')(
    toggle,
    false,
    'Payment mode',
    'How the bill was paid',
    'switch',
  ),
  'print.show.amountInWords': print('Show on print')(
    toggle,
    true,
    'Amount in words',
    'Total in words',
    'switch',
  ),
  'print.show.partyBalance': print('Show on print')(
    toggle,
    false,
    'Party balance',
    'Previous and current balance',
    'switch',
  ),
  'print.show.paidStamp': print('Show on print')(
    toggle,
    false,
    'PAID stamp',
    'Stamp on fully paid bills',
    'switch',
  ),
  'print.show.signature': print('Show on print')(
    toggle,
    true,
    'Signature',
    'Authorised signature',
    'switch',
  ),
  'print.footer': print('Footer')(
    text(300),
    '',
    'Footer text',
    'Printed at the bottom',
    'textarea',
  ),
  'print.regional': print('Footer')(
    toggle,
    false,
    'Regional item names',
    'Prints the item name in a second language',
    'switch',
  ),

  // ---- Taxes (P8-S5): the masters are tables, listed in PLANNED_TABLES; these are the switches around them ----
  'tax.priceInclusive': at('taxes', 'Defaults')(
    toggle,
    false,
    'Price inclusive of tax by default',
    'New bills start with tax-inclusive prices',
    'switch',
  ),
  'tax.gstRates': at('taxes', 'Rate masters')(
    z.array(z.number().min(0).max(100)).min(1).max(20),
    [0, 0.1, 0.25, 3, 5, 12, 18, 28, 40],
    'GST rates offered',
    'The rates in the GST % list on bills and items (any other rate can still be typed as Custom)',
    'numlist',
    { live: true },
  ),
  'tax.tdsRates': at('taxes', 'Rate masters')(
    z.array(z.object({ code: text(20).min(1), rate: z.number().min(0).max(100) })).max(30),
    [],
    'TDS rates',
    'Your own rate for a TDS section (for example 194J at 2), or a section that is not listed',
    'list',
    { live: true },
  ),
  'tax.tcsRates': at('taxes', 'Rate masters')(
    z.array(z.object({ code: text(20).min(1), rate: z.number().min(0).max(100) })).max(30),
    [],
    'TCS rates',
    'Your own rate for a TCS section, or one that is not listed',
    'list',
    { live: true },
  ),
  'tax.defaultItemRate': at('taxes', 'Defaults')(
    z.number().min(0).max(100),
    18,
    'Default tax on new items',
    'GST rate a new item starts with',
    'number',
  ),

  // ---- GST (P8-S6) ----
  'gst.enabled': gst('Registration', { ownerOnly: true })(
    toggle,
    true,
    'Enable GST',
    'Off starts new bills without GST columns (bills already saved are unchanged)',
    'switch',
  ),
  'gst.regType': gst('Registration', { ownerOnly: true })(
    z.enum(['regular', 'composition', 'unregistered']),
    'regular',
    'Registration type',
    'Composition issues a Bill of Supply only',
    'select',
    {
      options: opts(
        ['regular', 'Regular'],
        ['composition', 'Composition'],
        ['unregistered', 'Unregistered'],
      ),
    },
  ),
  'gst.compRate': gst('Registration')(
    z.number().min(0).max(100),
    1,
    'Composition rate (%)',
    'Rate under the composition scheme',
    'number',
  ),
  'gst.frequency': gst('Returns')(
    z.enum(['monthly', 'qrmp']),
    'monthly',
    'Return filing',
    'Monthly or quarterly (QRMP)',
    'select',
    { options: opts(['monthly', 'Monthly'], ['qrmp', 'Quarterly (QRMP)']) },
  ),
  // D-15: offline only. No IRP credentials are asked for or stored.
  'gst.einvoice.enabled': gst('Returns')(
    toggle,
    false,
    'E-invoice',
    'Adds "E-invoice" to B2B invoices: download the IRP JSON, upload it on the IRP portal, paste the IRN back',
    'switch',
  ),
  'gst.eway.enabled': gst('Returns')(
    toggle,
    true,
    'E-way bill',
    'Prompt for an e-way bill above the threshold',
    'switch',
    { live: true },
  ),
  // On by default: the reverse-charge boxes have always been on the purchase and sale screens.
  'gst.rcm': gst('Invoice')(
    toggle,
    true,
    'Reverse charge',
    'Shows the reverse charge box on purchases and sales (a bill that already has it keeps it)',
    'switch',
  ),
  'gst.pos': gst('Invoice')(
    toggle,
    true,
    'Show place of supply',
    'Place of supply on the invoice',
    'switch',
  ),
  'gst.hsnDigits': gst('Invoice')(
    z
      .number()
      .int()
      .refine((n) => [4, 6, 8].includes(n)),
    4,
    'HSN digits',
    '4, 6 or 8 digits',
    'select',
    { options: opts([4, '4'], [6, '6'], [8, '8']) },
  ),
  'gst.itcDefault': gst('Invoice')(
    z.enum(['eligible', 'ineligible']),
    'eligible',
    'ITC default',
    'Input tax credit on new purchases',
    'select',
    { options: opts(['eligible', 'Eligible'], ['ineligible', 'Ineligible']) },
  ),
  'gst.tcs': gst('TCS')(
    toggle,
    false,
    'Enable TCS',
    'New bills start with the TCS line switched on',
    'switch',
  ),
  'gst.tan': gst('TCS')(
    z.union([
      z.literal(''),
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}\d{5}[A-Z]$/, 'A TAN is 4 letters, 5 digits and a letter'),
    ]),
    '',
    'Collector TAN',
    'Shown on the Form 27EQ report',
    'text',
  ),
  'gst.exemptLabel': gst('Invoice')(
    text(30),
    'Exempt',
    'Exempt / nil label',
    'Printed against exempt lines',
    'text',
  ),

  // ---- Party (P8-S8) ----
  'party.groups': party('Fields')(
    toggle,
    true,
    'Party grouping',
    'Group field and filters',
    'switch',
  ),
  'party.shipping': party('Fields')(toggle, true, 'Shipping address', 'Ship-to on sales', 'switch'),
  // On by default: credit limits set on a party have always been checked, so the default keeps that behaviour.
  'party.credit': party('Credit')(
    toggle,
    true,
    'Check credit limits',
    'Off saves sales without checking the party credit limit (limits already set are kept)',
    'switch',
    { live: true },
  ),
  'party.creditMode': party('Credit')(
    z.enum(['warn', 'block']),
    'warn',
    'Credit limit mode',
    'Warn or block when exceeded',
    'select',
    { options: opts(['warn', 'Warn'], ['block', 'Block']) },
  ),
  'party.custom': party('Fields')(
    z.array(customField).max(4),
    [],
    'Additional party fields',
    'Up to four extra fields',
    'list',
  ),
  'party.reminder': party('Reminders')(
    toggle,
    false,
    'Payment reminders',
    'Queue reminders for unpaid invoices before and after the due date (needs Messaging on in the Txn Message tab)',
    'switch',
    { live: true },
  ),
  'reminder.daysBefore': party('Reminders')(
    z.number().int().min(0).max(30),
    3,
    'Remind this many days before the due date',
    '0 sends none before the due date',
    'number',
    { live: true },
  ),
  'reminder.onDue': party('Reminders')(
    toggle,
    true,
    'Remind on the due date',
    'One reminder on the day the payment is due',
    'switch',
    { live: true },
  ),
  'reminder.daysAfter': party('Reminders')(
    z.array(z.number().int().min(1).max(365)).max(10),
    [3, 7, 15],
    'Remind this many days after the due date',
    'Comma separated, for example 3, 7, 15',
    'numlist',
    { live: true },
  ),
  'reminder.max': party('Reminders')(
    z.number().int().min(1).max(20),
    5,
    'Most reminders per invoice',
    'Stops after this many for one due date',
    'number',
    { live: true },
  ),
  'reminder.channel': party('Reminders')(
    z.enum(['whatsapp', 'email']),
    'whatsapp',
    'Send automatic reminders by',
    'WhatsApp opens as a click-to-send link on the Reminders screen; Email is sent by the server',
    'select',
    { options: opts(['whatsapp', 'WhatsApp'], ['email', 'Email']), live: true },
  ),
  'reminder.quietStart': party('Reminders')(
    hhmm,
    '09:00',
    'Send from (IST)',
    'Nothing goes out before this time; it waits for the next morning',
    'text',
    { live: true },
  ),
  'reminder.quietEnd': party('Reminders')(
    hhmm,
    '20:00',
    'Send until (IST)',
    'Nothing goes out after this time',
    'text',
    { live: true },
  ),
  'party.itemRates': party('Fields')(
    toggle,
    false,
    'Party-wise item rate',
    'A rate per party and item',
    'switch',
    { phase: 'P1' },
  ),
  'party.tdsTcs': party('Fields')(
    toggle,
    false,
    'TDS / TCS on party',
    'Flags on the party',
    'switch',
  ),
  'party.defaultKind': party('Defaults')(
    z.enum(['customer', 'supplier']),
    'customer',
    'Default party type',
    'Type a new party starts with',
    'select',
    { options: opts(['customer', 'Customer'], ['supplier', 'Supplier']) },
  ),
  'party.openingRequired': party('Defaults')(
    toggle,
    false,
    'Opening balance mandatory',
    'Ask for an opening balance on a new party',
    'switch',
  ),
  'party.dupPhone': party('Defaults')(
    toggle,
    true,
    'Duplicate phone warning',
    'Warn when a phone number is already used',
    'switch',
  ),

  // ---- Item (P8-S9) ----
  'item.types': item('Fields')(
    toggle,
    true,
    'Item type (product / service)',
    'Product or service on each item',
    'switch',
  ),
  'item.category': item('Fields')(toggle, true, 'Category', 'Category on each item', 'switch'),
  'item.hsn': item('Fields')(toggle, true, 'HSN / SAC', 'HSN or SAC on each item', 'switch'),
  'item.altUnit': item('Fields')(
    toggle,
    false,
    'Secondary unit',
    'A second unit with a conversion',
    'switch',
    { phase: 'P1' },
  ),
  'item.description': item('Fields')(
    toggle,
    true,
    'Description',
    'Description on each item',
    'switch',
  ),
  'item.image': item('Fields')(toggle, false, 'Image', 'Picture on each item', 'switch'),
  'item.wholesale': item('Fields')(
    toggle,
    false,
    'Wholesale price',
    'A second sale price',
    'switch',
  ),
  'item.mrp': item('Fields')(toggle, false, 'MRP', 'MRP on each item', 'switch'),
  'item.batch': item('Tracking')(
    toggle,
    false,
    'Batch tracking',
    'Batch, manufacture and expiry',
    'switch',
    { phase: 'P1' },
  ),
  'item.serial': item('Tracking')(
    toggle,
    false,
    'Serial tracking',
    'A serial number per unit',
    'switch',
  ),
  'item.stock': item('Tracking')(toggle, true, 'Stock maintenance', 'Track stock', 'switch'),
  'item.minStock': item('Tracking')(
    toggle,
    true,
    'Minimum stock alert',
    'Alert when stock is low',
    'switch',
  ),
  'item.discount': item('Fields')(
    toggle,
    true,
    'Item-wise discount',
    'A discount on each item',
    'switch',
  ),
  'item.tax': item('Fields')(toggle, true, 'Item-wise tax', 'A tax rate on each item', 'switch'),
  'item.barcode': item('Tracking')(
    toggle,
    false,
    'Barcode scanning',
    'Look items up by barcode',
    'switch',
  ),
  'item.custom': item('Fields')(
    z.array(customField).max(4),
    [],
    'Additional item fields',
    'Up to four extra fields',
    'list',
  ),
  'item.defaultUnit': item('Defaults')(
    text(10).min(1),
    'PCS',
    'Default unit',
    'Unit a new item starts with',
    'text',
  ),
  'item.defaultGst': item('Defaults')(
    z.number().min(0).max(100),
    18,
    'Default GST rate',
    'Rate a new item starts with',
    'number',
  ),
  'item.barcodeFormat': item('Defaults')(
    z.enum(['code128', 'ean13', 'qr']),
    'ean13',
    'Barcode format',
    'Format of generated barcodes',
    'select',
    { options: opts(['code128', 'Code 128'], ['ean13', 'EAN-13'], ['qr', 'QR']) },
  ),

  // ---- Accounting (P8-S11) ----
  'acct.enabled': accounting('Ledger', { ownerOnly: true })(
    toggle,
    false,
    'Enable accounting ledger',
    'Turn the books on from the Accounting screen: it posts every existing document and checks the balances first',
    'switch',
    {
      live: true,
      legacy: ['accounting', 'ledger'],
      managedAt: {
        href: '/accounting',
        note: 'Switched on from Accounting, which checks your party balances before it starts',
      },
    },
  ),
  'acct.valuation': accounting('Stock')(
    z.enum(['average']),
    'average',
    'Stock valuation method',
    "Weighted average only (D-11); stock is valued at each item's average landed cost",
    'select',
    { options: opts(['average', 'Weighted average']), live: true },
  ),
  'acct.defaultAccounts': accounting('Default accounts')(
    z.record(z.string(), z.string().regex(/^\d{3,8}$/, 'Pick an account')),
    {},
    'Post to these accounts',
    'Send sales, purchases, discounts, round-off and the rest to accounts of your own (same kind). Needs the ledger on',
    'accounts',
    { live: true },
  ),
  'acct.autoPostExpense': accounting('Ledger')(
    toggle,
    true,
    'Auto-post expenses',
    'Off leaves new and edited expenses out of the ledger until you run "Post history again" on the Accounting screen',
    'switch',
    { live: true },
  ),

  // ---- Offers (P9-S7) ----
  'offer.coupons': party('Offers')(
    z
      .array(
        z.object({
          code: text(20).min(2),
          percent: z.number().min(0).max(100),
          amount: money,
          minBill: money,
          from: z.union([isoDate, z.literal('')]),
          to: z.union([isoDate, z.literal('')]),
        }),
      )
      .max(50),
    [],
    'Offer codes',
    'A code a customer quotes for a discount on the whole bill: % off or ₹ off, from a minimum bill, between two dates',
    'list',
    { live: true },
  ),

  // ---- Messaging (Phase 9) ----
  'msg.enabled': at('message', 'Messaging', { ownerOnly: true })(
    toggle,
    false,
    'Messaging',
    'Share documents on WhatsApp or email, send payment and service reminders. Off, none of it is available and nothing is queued',
    'switch',
    {
      live: true,
      confirm:
        'Turns on messaging for this business. Messages are only sent when you or a reminder rule asks; parties marked Do not message are always skipped.',
    },
  ),
  'visits.retentionDays': at('general', 'Security')(
    z.number().int().min(7).max(365),
    90,
    'Keep salesman check-in locations for (days)',
    'Check-ins are deleted automatically after this many days. This is also the number shown on the consent screen',
    'number',
    { live: true },
  ),

  // ---- Multi Currency (P8-S12) ----
  // On: the currency and exchange-rate boxes have always been on the bill. Off hides them for new bills (a foreign bill keeps its own).
  'mc.enabled': at('currency', 'Currencies', { ownerOnly: true })(
    toggle,
    true,
    'Enable multi currency',
    "Shows the currency and exchange-rate boxes on a bill. The rate is typed per bill; India's books stay in INR",
    'switch',
  ),
  'mc.showBoth': at('currency', 'Currencies')(
    toggle,
    false,
    'Show both amounts',
    "A foreign-currency bill also prints its INR value at the bill's exchange rate",
    'switch',
  ),
} satisfies Record<string, SettingDef>;

// A key is live when a screen or the API obeys it. This list is the one place that says so for the keys the web app reads
// (lib/appSettings.js); keys whose behaviour lives in the API carry `live: true` where they are declared. The test in
// settings.test.ts keeps every name here a real key.
export const LIVE_IN_APP = [
  'fy.startMonth',
  'fmt.qtyDecimals',
  'fmt.wordsLang',
  'txn.billingName',
  'txn.quickEntry',
  'txn.showPurchasePrice',
  'txn.barcodeScan',
  'print.show.description',
  'print.show.mrp',
  'print.show.batch',
  'print.regional',
  'gst.regType',
  'gst.compRate',
  'gst.frequency',
  'gst.hsnDigits',
  'gst.itcDefault',
  'party.itemRates',
  'party.tdsTcs',
  'party.openingRequired',
  'item.altUnit',
  'item.image',
  'item.wholesale',
  'item.mrp',
  'item.batch',
  'item.serial',
  'item.barcode',
  'item.discount',
  'mc.enabled',
  'mc.showBoth',
  'party.shipping',
  'item.barcodeFormat',
  'print.show.paymentMode',
  'print.show.partyBalance',
  'print.show.paidStamp',
  'gst.exemptLabel',
  'party.defaultKind',
  'fmt.date',
  'fmt.currency',
  'fmt.decimals',
  'sec.autoLock',
  'txn.cashDefault',
  'txn.poDetails',
  'txn.transport',
  'txn.ewayThreshold',
  'txn.charges',
  'txn.discountMode',
  'txn.discountUnit',
  'txn.roundOff',
  'txn.autofillReceived',
  'txn.terms.text',
  'txn.showProfit',
  'print.template',
  'print.paper',
  'print.orientation',
  'print.copies',
  'print.footer',
  'print.show.hsn',
  'print.show.upiQr',
  'print.show.bank',
  'print.show.amountInWords',
  'print.show.signature',
  'tax.priceInclusive',
  'tax.defaultItemRate',
  'gst.enabled',
  'gst.pos',
  'gst.rcm',
  'gst.einvoice.enabled',
  'gst.tcs',
  'gst.tan',
  'party.groups',
  'party.creditMode',
  'party.custom',
  'party.dupPhone',
  'item.types',
  'item.category',
  'item.hsn',
  'item.description',
  'item.stock',
  'item.minStock',
  'item.tax',
  'item.custom',
  'item.defaultUnit',
  'item.defaultGst',
] as const satisfies readonly (keyof typeof SETTINGS)[];
for (const k of LIVE_IN_APP) {
  const def: SettingDef = SETTINGS[k];
  def.live = true;
  delete def.phase;
}

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['type']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const isSettingKey = (k: string): k is SettingKey => Object.hasOwn(SETTINGS, k);
export const settingDef = (k: SettingKey): SettingDef => SETTINGS[k];

/**
 * Parts of a tab that are tables of their own (not key/value rows). They have their own phases and storage, so the
 * screen shows them as "Coming soon" cards; each is listed once so the empty tabs are not a mystery.
 */
export const PLANNED_TABLES: readonly {
  tab: SettingsTabId;
  title: string;
  note: string;
  href?: string;
}[] = [
  {
    tab: 'transaction',
    title: 'Number series per document type',
    note: 'Prefix, next number, padding, financial-year part and yearly restart for each document type.',
    href: '/settings/documents',
  },
  {
    tab: 'print',
    title: 'Logo, signature, stamp and thermal printing',
    note: 'Upload them and set sizes, labels, language and the thermal layout in the print designer.',
    href: '/settings/documents',
  },
  {
    tab: 'message',
    title: 'Message templates',
    note: 'Edit the text of each message, with variables and a live preview, in Grow > Reminders > Templates.',
    href: '/grow/reminders?tab=templates',
  },
  {
    tab: 'service',
    title: 'Service reminders',
    note: 'Recurring service reminders (every N days or months, remind M days before) are managed in Grow > Reminders > Service.',
    href: '/grow/reminders?tab=service',
  },
  {
    tab: 'general',
    title: 'Backup reminder',
    note: 'How often to remind you to back up is set with the backup schedule, in Utilities › Backup & Restore.',
    href: '/utilities/backup',
  },
  {
    tab: 'accounting',
    title: 'Cash in hand opening balance',
    note: 'Set in Cash & Bank › Cash in Hand, where it also posts to the books.',
    href: '/cash-bank/cash',
  },
  {
    tab: 'accounting',
    title: 'Chart of accounts and opening balances',
    note: 'Add accounts and their opening balances on the Accounting screen.',
    href: '/accounting',
  },
  {
    tab: 'currency',
    title: 'Exchange-rate table',
    note: 'A saved list of daily rates. Today the rate is typed on each bill; the base currency stays INR.',
  },
];

/** Every key the API will accept a change for. */
export const liveKeys = () => SETTING_KEYS.filter((k) => SETTINGS[k].live);
export const keysOfTab = (tab: SettingsTabId) =>
  SETTING_KEYS.filter((k) => SETTINGS[k].tab === tab);

/** A key with its value, for the screen: everything it needs to draw a row. */
export const settingView = z.object({
  key: z.string(),
  tab: z.enum(SETTINGS_TAB_IDS),
  section: z.string(),
  label: z.string(),
  help: z.string(),
  control: z.string(),
  options: z
    .array(z.object({ value: z.union([z.string(), z.number()]), label: z.string() }))
    .nullable(),
  ownerOnly: z.boolean(),
  live: z.boolean(),
  phase: z.string().nullable(),
  value: z.unknown(),
});
export type SettingView = z.infer<typeof settingView>;

export const settingsQuery = z.object({ businessId: uuid });
export const settingsResponse = z.object({
  settings: z.record(z.string(), z.unknown()),
  /** Setting key -> the plan feature it needs, for the keys this business's plan does not include (they read as their default). */
  locked: z.record(z.string(), z.string()).optional(),
});
export const settingsPatch = z.object({
  businessId: uuid,
  values: z.record(z.string(), z.unknown()),
});

/**
 * Checks a partial map against the registry. Unknown keys, keys that are not live yet, and invalid values each come
 * back as a field error keyed by the setting, so the screen can show it on the row.
 */
export function parseSettingsPatch(values: Record<string, unknown>) {
  const out: Partial<Record<SettingKey, unknown>> = {};
  const errors: { key: string; message: string }[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (!isSettingKey(k)) {
      errors.push({ key: k, message: 'Unknown setting' });
      continue;
    }
    const def = SETTINGS[k];
    if (!def.live) {
      errors.push({ key: k, message: 'This setting is coming soon and can not be changed yet' });
      continue;
    }
    if (def.managedAt) {
      errors.push({ key: k, message: def.managedAt.note });
      continue;
    }
    const r = def.type.safeParse(v);
    if (!r.success) errors.push({ key: k, message: r.error.issues[0]?.message ?? 'Invalid value' });
    else out[k] = r.data;
  }
  return { values: out, errors };
}

/** How many invoices carry the business's GSTIN, so changing it can say so first ("GSTIN appears on 412 invoices"). */
export const gstinUsageResponse = z.object({
  gstin: z.string().nullable(),
  invoices: z.number().int(),
});
