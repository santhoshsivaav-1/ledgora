// Vyapar parity P7-S2: Export to Tally. Pure functions: the voucher entries Tally needs from a sale or purchase, the
// checks made before download, and the Master and Voucher XML (Tally Prime "Import Data"). The API reads the documents
// and hands them in as TallyVoucher; nothing here reads a database. Golden tests compare the XML to checked-in files.
//
// Tally's sign convention: a debit entry has ISDEEMEDPOSITIVE=Yes and a NEGATIVE amount; a credit has No and a POSITIVE
// amount. A voucher is balanced when its amounts add to zero.

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 0.01;

export type TallyVoucherType =
  'Sales' | 'Credit Note' | 'Purchase' | 'Debit Note' | 'Receipt' | 'Payment';
export const TALLY_TYPES: TallyVoucherType[] = [
  'Sales',
  'Credit Note',
  'Purchase',
  'Debit Note',
  'Receipt',
  'Payment',
];
/** Receipts, payments and expenses carry their own ledger entries; sales and purchases are built from their lines. */
export const isAccounting = (t: TallyVoucherType) => t === 'Receipt' || t === 'Payment';

export interface TallyLine {
  name: string;
  hsn?: string;
  unit?: string;
  quantity: number;
  rate: number;
  /** Taxable value of the line after its discount. */
  amount: number;
  gstRate?: number;
}
export interface TallyVoucher {
  id: string;
  type: TallyVoucherType;
  number: string;
  /** yyyy-mm-dd */
  date: string;
  party: string;
  partyGstin?: string;
  partyState?: string;
  placeOfSupply?: string;
  narration?: string;
  lines: TallyLine[];
  /** Additional charges, before tax. */
  charges?: { name: string; amount: number }[];
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
  roundOff?: number;
  total: number;
  cancelled?: boolean;
  /** Receipt / Payment vouchers: the entries, in Tally's signs (credit positive). */
  entries?: TallyEntry[];
  /** Which side's tax ledgers this voucher's cgst/sgst/igst/cess belong to: output (sold) or input (bought). */
  taxSide?: 'out' | 'in';
}
export interface TallyMapping {
  company: string;
  sales: string;
  salesReturn: string;
  purchase: string;
  purchaseReturn: string;
  outCgst: string;
  outSgst: string;
  outIgst: string;
  outCess: string;
  inCgst: string;
  inSgst: string;
  inIgst: string;
  inCess: string;
  roundOff: string;
  charges: string;
  debtors: string;
  creditors: string;
  cash: string;
  bank: string;
  discountAllowed: string;
  discountReceived: string;
  tdsReceivable: string;
  tdsPayable: string;
  expenses: string;
  otherIncome: string;
}
export const DEFAULT_TALLY_MAPPING: TallyMapping = {
  company: '',
  sales: 'Sales Accounts',
  salesReturn: 'Sales Accounts',
  purchase: 'Purchase Accounts',
  purchaseReturn: 'Purchase Accounts',
  outCgst: 'Output CGST',
  outSgst: 'Output SGST',
  outIgst: 'Output IGST',
  outCess: 'Output Cess',
  inCgst: 'Input CGST',
  inSgst: 'Input SGST',
  inIgst: 'Input IGST',
  inCess: 'Input Cess',
  roundOff: 'Round Off',
  charges: 'Other Charges',
  debtors: 'Sundry Debtors',
  creditors: 'Sundry Creditors',
  cash: 'Cash',
  bank: 'Bank Account',
  discountAllowed: 'Discount Allowed',
  discountReceived: 'Discount Received',
  tdsReceivable: 'TDS Receivable',
  tdsPayable: 'TDS Payable',
  expenses: 'Indirect Expenses',
  otherIncome: 'Indirect Incomes',
};

export interface TallyEntry {
  ledger: string;
  /** Positive = credit, negative = debit (Tally's AMOUNT). */
  amount: number;
  /** For a ledger the masters file must create: the Tally group it goes under. Party ledgers have none. */
  parent?: string;
}

const isSale = (t: TallyVoucherType) => t === 'Sales' || t === 'Credit Note';
/** Does the party side of this voucher type sit on the debit side? Sales and Debit Note: yes. */
const partyIsDebit = (t: TallyVoucherType) => t === 'Sales' || t === 'Debit Note';

/** The party's and the tax / round-off / charge ledger entries of a voucher; the goods go through the line allocations. */
export function voucherEntries(
  v: TallyVoucher,
  m: TallyMapping,
): { party: TallyEntry; others: TallyEntry[]; goods: number } {
  const sale = isSale(v.type);
  const dr = partyIsDebit(v.type);
  const sign = dr ? 1 : -1; // taxes, charges and goods sit opposite the party
  const taxLedger = sale
    ? { cgst: m.outCgst, sgst: m.outSgst, igst: m.outIgst, cess: m.outCess }
    : { cgst: m.inCgst, sgst: m.inSgst, igst: m.inIgst, cess: m.inCess };
  const others: TallyEntry[] = [];
  for (const c of v.charges ?? [])
    if (r2(c.amount)) others.push({ ledger: m.charges, amount: r2(sign * c.amount) });
  for (const k of ['cgst', 'sgst', 'igst', 'cess'] as const)
    if (r2(v[k] ?? 0)) others.push({ ledger: taxLedger[k], amount: r2(sign * (v[k] ?? 0)) });
  // Round off follows the document's total: a positive round-off raised the party's amount, so it sits with the goods.
  if (r2(v.roundOff ?? 0))
    others.push({ ledger: m.roundOff, amount: r2(sign * (v.roundOff ?? 0)) });
  const goods = r2(v.lines.reduce((s, l) => s + l.amount, 0));
  return { party: { ledger: v.party, amount: r2(-sign * v.total) }, others, goods };
}

/** Σ of every amount in a voucher, party and goods included: zero when it balances. */
export function voucherBalance(v: TallyVoucher, m: TallyMapping) {
  if (isAccounting(v.type)) return r2((v.entries ?? []).reduce((s, e) => s + e.amount, 0));
  const e = voucherEntries(v, m);
  const dr = partyIsDebit(v.type);
  const goods = r2((dr ? 1 : -1) * e.goods);
  return r2(e.party.amount + e.others.reduce((s, o) => s + o.amount, 0) + goods);
}

export interface TallyProblem {
  level: 'error' | 'warning';
  /** The voucher (its id) or party the problem is about, so the screen can point at the row. */
  id: string;
  message: string;
}
/** Tally compares ledger names without case or trailing spaces. */
export const tallyName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Errors block the download; warnings are listed but do not. Errors: an unmapped ledger, vouchers that do not balance,
 * two parties whose names are the same to Tally. Warnings: a party with no GSTIN on a sale over ₹2.5 lakh... kept to
 * facts we know: no GSTIN (unregistered), no state, GSTIN state differing from the place of supply, zero-value vouchers.
 */
export function validateTally(
  vouchers: TallyVoucher[],
  m: TallyMapping,
  parties: { id: string; name: string }[] = [],
): TallyProblem[] {
  const out: TallyProblem[] = [];
  const need = (key: keyof TallyMapping, why: string) => {
    if (!String(m[key] ?? '').trim())
      out.push({ level: 'error', id: key, message: `The ${why} ledger name is empty` });
  };
  need('company', 'company');
  need('sales', 'sales');
  need('purchase', 'purchase');
  need('roundOff', 'round off');
  need('debtors', 'customers (Sundry Debtors) group');
  need('creditors', 'suppliers (Sundry Creditors) group');
  const used = (k: 'cgst' | 'sgst' | 'igst' | 'cess') => vouchers.some((v) => r2(v[k] ?? 0));
  for (const [k, ledgers] of [
    ['cgst', ['outCgst', 'inCgst']],
    ['sgst', ['outSgst', 'inSgst']],
    ['igst', ['outIgst', 'inIgst']],
    ['cess', ['outCess', 'inCess']],
  ] as const)
    if (used(k))
      for (const l of ledgers)
        if (!String(m[l]).trim())
          out.push({
            level: 'error',
            id: l,
            message: `The ${l} ledger name is empty but ${k.toUpperCase()} is in the period`,
          });
  if (vouchers.some((v) => (v.charges ?? []).length)) need('charges', 'additional charges');
  if (vouchers.some((v) => isAccounting(v.type))) {
    need('cash', 'cash');
    need('bank', 'bank');
  }

  const seen = new Map<string, string>();
  for (const p of parties) {
    const k = tallyName(p.name);
    const prior = seen.get(k);
    if (prior && prior !== p.id)
      out.push({
        level: 'error',
        id: p.id,
        message: `“${p.name}” is the same party name as another one once Tally ignores case and spaces; rename one`,
      });
    seen.set(k, p.id);
  }
  for (const v of vouchers) {
    const acct = isAccounting(v.type);
    if (!acct && !v.party.trim())
      out.push({ level: 'error', id: v.id, message: `${v.type} ${v.number} has no party` });
    const bal = voucherBalance(v, m);
    if (Math.abs(bal) > EPS)
      out.push({
        level: 'error',
        id: v.id,
        message: `${v.type} ${v.number} does not balance (off by ₹${Math.abs(bal).toFixed(2)})`,
      });
    if (acct) {
      if (!(v.entries ?? []).length)
        out.push({ level: 'error', id: v.id, message: `${v.type} ${v.number} has no entries` });
      if (v.cancelled)
        out.push({
          level: 'warning',
          id: v.id,
          message: `${v.type} ${v.number} is cancelled and is sent as a cancelled voucher`,
        });
      continue;
    }
    if (!v.lines.length)
      out.push({ level: 'error', id: v.id, message: `${v.type} ${v.number} has no items` });
    if (!v.partyGstin)
      out.push({
        level: 'warning',
        id: v.id,
        message: `${v.type} ${v.number}: ${v.party} has no GSTIN (sent as unregistered)`,
      });
    if (
      v.partyGstin &&
      v.placeOfSupply &&
      v.partyState &&
      tallyName(v.placeOfSupply) !== tallyName(v.partyState) &&
      !v.igst &&
      (v.cgst || v.sgst)
    )
      out.push({
        level: 'warning',
        id: v.id,
        message: `${v.type} ${v.number}: place of supply ${v.placeOfSupply} differs from ${v.party}'s state but CGST/SGST was charged`,
      });
    if (v.cancelled)
      out.push({
        level: 'warning',
        id: v.id,
        message: `${v.type} ${v.number} is cancelled and is sent as a cancelled voucher`,
      });
  }
  return out;
}

// ---- XML ------------------------------------------------------------------------------------------------------------------

/** XML-safe text: the five entities, and control characters Tally rejects removed. */
export const xmlText = (s: unknown) =>
  String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const tag = (name: string, value: unknown) => `<${name}>${xmlText(value)}</${name}>`;
const amt = (n: number) => r2(n).toFixed(2);
const tallyDate = (iso: string) => iso.replace(/-/g, '');

const envelope = (report: string, company: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>${report}</REPORTNAME>
    <STATICVARIABLES>
     ${tag('SVCURRENTCOMPANY', company)}
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${body}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;

/** GST rate by head: CGST and SGST are half the rate, IGST the whole. */
const rateDetails = (rate: number, pad: string) =>
  [
    ['CGST', rate / 2],
    ['SGST/UTGST', rate / 2],
    ['IGST', rate],
  ]
    .map(
      ([head, r]) =>
        `\n${pad}<RATEDETAILS.LIST>\n${pad} ${tag('GSTRATEDUTYHEAD', head)}\n${pad} ${tag('GSTRATE', amt(Number(r)))}\n${pad}</RATEDETAILS.LIST>`,
    )
    .join('');

const entryXml = (e: TallyEntry, extra = '') =>
  `      <ALLLEDGERENTRIES.LIST>
       ${tag('LEDGERNAME', e.ledger)}
       ${tag('ISDEEMEDPOSITIVE', e.amount < 0 ? 'Yes' : 'No')}
       ${extra}${tag('AMOUNT', amt(e.amount))}
      </ALLLEDGERENTRIES.LIST>`;

/** One voucher as a TALLYMESSAGE. */
/** A receipt, payment or expense: no items, only its own ledger entries (the party's first, when it has one). */
function accountingXml(v: TallyVoucher): string {
  const entries = [...(v.entries ?? [])].sort(
    (a, b) => Number(b.ledger === v.party) - Number(a.ledger === v.party),
  );
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${xmlText(v.type)}" ACTION="${v.cancelled ? 'Cancel' : 'Create'}" OBJVIEW="Accounting Voucher View">
      ${tag('DATE', tallyDate(v.date))}
      ${tag('VOUCHERTYPENAME', v.type)}
      ${tag('VOUCHERNUMBER', v.number)}
      ${v.party ? tag('PARTYLEDGERNAME', v.party) : ''}
      ${tag('ISINVOICE', 'No')}
      ${v.narration ? tag('NARRATION', v.narration) : ''}
${entries.map((e) => entryXml(e, v.party && e.ledger === v.party ? `${tag('ISPARTYLEDGER', 'Yes')}\n       ` : '')).join('\n')}
     </VOUCHER>
    </TALLYMESSAGE>`.replace(/\n\s*\n/g, '\n');
}

export function voucherXml(v: TallyVoucher, m: TallyMapping): string {
  if (isAccounting(v.type)) return accountingXml(v);
  const e = voucherEntries(v, m);
  const dr = partyIsDebit(v.type);
  const goodsLedger = {
    Sales: m.sales,
    'Credit Note': m.salesReturn,
    Purchase: m.purchase,
    'Debit Note': m.purchaseReturn,
  }[v.type];
  const goodsSign = dr ? 1 : -1; // goods sit opposite the party: credit (positive) on Sales, debit on a Credit Note
  const inv = v.lines
    .map((l) => {
      const signed = goodsSign * l.amount;
      return `      <ALLINVENTORYENTRIES.LIST>
       ${tag('STOCKITEMNAME', l.name)}
       ${l.hsn ? tag('GSTHSNNAME', l.hsn) : ''}
       ${tag('ISDEEMEDPOSITIVE', signed < 0 ? 'Yes' : 'No')}
       ${tag('RATE', `${amt(l.rate)}/${l.unit || 'Nos'}`)}
       ${tag('AMOUNT', amt(signed))}
       ${tag('ACTUALQTY', ` ${l.quantity} ${l.unit || 'Nos'}`)}
       ${tag('BILLEDQTY', ` ${l.quantity} ${l.unit || 'Nos'}`)}
       <ACCOUNTINGALLOCATIONS.LIST>
        ${tag('LEDGERNAME', goodsLedger)}
        ${tag('ISDEEMEDPOSITIVE', signed < 0 ? 'Yes' : 'No')}
        ${tag('AMOUNT', amt(signed))}
       </ACCOUNTINGALLOCATIONS.LIST>${l.gstRate != null ? rateDetails(l.gstRate, '       ') : ''}
      </ALLINVENTORYENTRIES.LIST>`;
    })
    .join('\n');
  const view =
    v.type === 'Sales' || v.type === 'Credit Note'
      ? 'Invoice Voucher View'
      : 'Invoice Voucher View';
  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="${xmlText(v.type)}" ACTION="${v.cancelled ? 'Cancel' : 'Create'}" OBJVIEW="${view}">
      ${tag('DATE', tallyDate(v.date))}
      ${tag('VOUCHERTYPENAME', v.type)}
      ${tag('VOUCHERNUMBER', v.number)}
      ${tag('REFERENCE', v.number)}
      ${tag('PARTYLEDGERNAME', v.party)}
      ${tag('PARTYNAME', v.party)}
      ${v.partyGstin ? tag('PARTYGSTIN', v.partyGstin) : ''}
      ${tag('PLACEOFSUPPLY', v.placeOfSupply || v.partyState || '')}
      ${tag('ISINVOICE', 'Yes')}
      ${v.narration ? tag('NARRATION', v.narration) : ''}
${entryXml(e.party, `${tag('ISPARTYLEDGER', 'Yes')}\n       `)}
${[...e.others.map((o) => entryXml(o))].join('\n')}
${inv}
     </VOUCHER>
    </TALLYMESSAGE>`.replace(/\n\s*\n/g, '\n');
}

export function buildVoucherXml(vouchers: TallyVoucher[], m: TallyMapping) {
  return envelope('Vouchers', m.company, vouchers.map((v) => voucherXml(v, m)).join('\n'));
}

export interface TallyParty {
  name: string;
  kind: 'customer' | 'supplier';
  gstin?: string;
  state?: string;
  address?: string;
  pin?: string;
  phone?: string;
  email?: string;
  /** Signed: positive = they owe us (debit). */
  opening?: number;
}
export interface TallyItem {
  name: string;
  unit?: string;
  hsn?: string;
  gstRate?: number;
}

const ledgerMaster = (name: string, parent: string, extra = '') =>
  `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <LEDGER NAME="${xmlText(name)}" ACTION="Create">
      ${tag('NAME', name)}
      ${tag('PARENT', parent)}
      ${extra}
     </LEDGER>
    </TALLYMESSAGE>`.replace(/\n\s*\n/g, '\n');

/** Master XML: party ledgers under their group, the tax / round-off / charge ledgers, and stock items. */
export function buildMasterXml(
  parties: TallyParty[],
  items: TallyItem[],
  m: TallyMapping,
  o: { vouchers?: TallyVoucher[] } = {},
) {
  const out: string[] = [];
  const dutyHeads: [string, string][] = [];
  const has = (k: 'cgst' | 'sgst' | 'igst' | 'cess') =>
    !o.vouchers || o.vouchers.some((v) => r2(v[k] ?? 0));
  const sideOf = (v: TallyVoucher) => v.taxSide ?? (isSale(v.type) ? 'out' : 'in');
  const sale = !o.vouchers || o.vouchers.some((v) => sideOf(v) === 'out');
  const buy = !o.vouchers || o.vouchers.some((v) => sideOf(v) === 'in');
  for (const [k, outL, inL, type] of [
    ['cgst', m.outCgst, m.inCgst, 'CGST'],
    ['sgst', m.outSgst, m.inSgst, 'SGST/UTGST'],
    ['igst', m.outIgst, m.inIgst, 'IGST'],
    ['cess', m.outCess, m.inCess, 'Cess'],
  ] as const)
    if (has(k)) {
      if (sale) dutyHeads.push([outL, type]);
      if (buy) dutyHeads.push([inL, type]);
    }
  const seen = new Set<string>();
  const once = (name: string) =>
    seen.has(tallyName(name)) ? false : (seen.add(tallyName(name)), true);
  for (const [name, type] of dutyHeads)
    if (once(name))
      out.push(
        ledgerMaster(
          name,
          'Duties & Taxes',
          `${tag('TAXTYPE', 'GST')}\n      ${tag('GSTDUTYHEAD', type)}`,
        ),
      );
  // Ledgers that receipts, payments and expenses name (cash, bank, discount, TDS, expense heads): each once, under its group.
  for (const v of o.vouchers ?? [])
    for (const e of v.entries ?? [])
      if (e.parent && once(e.ledger)) out.push(ledgerMaster(e.ledger, e.parent));
  if (once(m.roundOff)) out.push(ledgerMaster(m.roundOff, 'Indirect Expenses'));
  if ((o.vouchers ?? []).some((v) => (v.charges ?? []).length) && once(m.charges))
    out.push(ledgerMaster(m.charges, 'Indirect Incomes'));
  for (const p of parties) {
    const parent = p.kind === 'customer' ? m.debtors : m.creditors;
    const extra = [
      p.address ? `<ADDRESS.LIST>${tag('ADDRESS', p.address)}</ADDRESS.LIST>` : '',
      p.state ? tag('LEDSTATENAME', p.state) : '',
      p.pin ? tag('PINCODE', p.pin) : '',
      p.gstin
        ? `${tag('PARTYGSTIN', p.gstin)}\n      ${tag('GSTREGISTRATIONTYPE', 'Regular')}`
        : tag('GSTREGISTRATIONTYPE', 'Unregistered'),
      p.phone ? tag('LEDGERPHONE', p.phone) : '',
      p.email ? tag('EMAIL', p.email) : '',
      p.opening ? tag('OPENINGBALANCE', amt(-p.opening)) : '', // a debit opening is negative in Tally
    ]
      .filter(Boolean)
      .join('\n      ');
    if (once(p.name)) out.push(ledgerMaster(p.name, parent, extra));
  }
  const units = new Map<string, string>();
  for (const i of items) units.set(i.unit || 'Nos', i.unit || 'Nos');
  for (const u of units.values())
    out.push(`    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <UNIT NAME="${xmlText(u)}" ACTION="Create">
      ${tag('NAME', u)}
      ${tag('ISSIMPLEUNIT', 'Yes')}
     </UNIT>
    </TALLYMESSAGE>`);
  const stock = new Set<string>();
  for (const i of items) {
    if (stock.has(tallyName(i.name))) continue;
    stock.add(tallyName(i.name));
    out.push(`    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <STOCKITEM NAME="${xmlText(i.name)}" ACTION="Create">
      ${tag('NAME', i.name)}
      ${tag('BASEUNITS', i.unit || 'Nos')}${i.hsn ? `\n      ${tag('GSTHSNNAME', i.hsn)}` : ''}${
        i.gstRate != null
          ? `
      <GSTDETAILS.LIST>
       ${tag('GSTAPPLICABLE', 'Applicable')}
       <STATEWISEDETAILS.LIST>
        ${rateDetails(i.gstRate, '').replace(/\n/g, '\n        ').trim()}
       </STATEWISEDETAILS.LIST>
      </GSTDETAILS.LIST>`
          : ''
      }
     </STOCKITEM>
    </TALLYMESSAGE>`);
  }
  return envelope('All Masters', m.company, out.join('\n'));
}

/** Counts shown on the preview step. */
export function tallySummary(
  vouchers: TallyVoucher[],
  parties: unknown[],
  items: unknown[],
  problems: TallyProblem[],
) {
  const by: Record<string, number> = {};
  for (const v of vouchers) by[v.type] = (by[v.type] ?? 0) + 1;
  return {
    vouchers: vouchers.length,
    byType: by,
    parties: parties.length,
    items: items.length,
    total: r2(
      vouchers.reduce(
        (s, v) => s + (isSale(v.type) ? (v.type === 'Sales' ? 1 : -1) : 0) * v.total,
        0,
      ),
    ),
    errors: problems.filter((p) => p.level === 'error').length,
    warnings: problems.filter((p) => p.level === 'warning').length,
  };
}

// ---- receipts, payments and expenses -----------------------------------------------------------------------------------------

const moneyLedger = (mode: string, m: TallyMapping): TallyEntry => ({
  ledger: mode === 'cash' ? m.cash : m.bank,
  amount: 0,
  parent: mode === 'cash' ? 'Cash-in-Hand' : 'Bank Accounts',
});

/**
 * Money received from (Receipt) or paid to (Payment) a party. Discount and TDS settle the party's account like money:
 * on a receipt the customer's ledger is credited with money + discount + TDS, on a payment it is debited the same.
 */
export function paymentVoucher(
  p: {
    id: string;
    direction: 'in' | 'out';
    number: string;
    date: string;
    party: string;
    mode: string;
    amount: number;
    discount?: number;
    tds?: number;
    narration?: string;
    cancelled?: boolean;
  },
  m: TallyMapping,
): TallyVoucher {
  const money = moneyLedger(p.mode, m);
  const disc = r2(p.discount ?? 0);
  const tds = r2(p.tds ?? 0);
  const settled = r2(p.amount + disc + tds);
  const entries: TallyEntry[] =
    p.direction === 'in'
      ? [
          { ...money, amount: -r2(p.amount) },
          ...(disc
            ? [{ ledger: m.discountAllowed, amount: -disc, parent: 'Indirect Expenses' }]
            : []),
          ...(tds ? [{ ledger: m.tdsReceivable, amount: -tds, parent: 'Duties & Taxes' }] : []),
          { ledger: p.party, amount: settled },
        ]
      : [
          { ledger: p.party, amount: -settled },
          { ...money, amount: r2(p.amount) },
          ...(disc
            ? [{ ledger: m.discountReceived, amount: disc, parent: 'Indirect Incomes' }]
            : []),
          ...(tds ? [{ ledger: m.tdsPayable, amount: tds, parent: 'Duties & Taxes' }] : []),
        ];
  return {
    id: p.id,
    type: p.direction === 'in' ? 'Receipt' : 'Payment',
    number: p.number,
    date: p.date,
    party: p.party,
    narration: p.narration,
    lines: [],
    entries,
    total: settled,
    cancelled: p.cancelled,
  };
}

/** An expense (a Payment voucher: the head and input GST debited, cash or bank credited) or other income (a Receipt). */
export function expenseVoucher(
  e: {
    id: string;
    kind: 'expense' | 'income';
    number: string;
    date: string;
    head: string;
    amount: number;
    tax?: number;
    interstate?: boolean;
    mode: string;
    narration?: string;
  },
  m: TallyMapping,
): TallyVoucher {
  const money = moneyLedger(e.mode, m);
  const tax = r2(e.tax ?? 0);
  const total = r2(e.amount + tax);
  const half = r2(tax / 2);
  const split = e.interstate
    ? { igst: tax, cgst: 0, sgst: 0 }
    : { igst: 0, cgst: half, sgst: r2(tax - half) };
  const exp = e.kind === 'expense';
  const taxEntries: TallyEntry[] = [
    ['cgst', exp ? m.inCgst : m.outCgst],
    ['sgst', exp ? m.inSgst : m.outSgst],
    ['igst', exp ? m.inIgst : m.outIgst],
  ].flatMap(([k, ledger]) => {
    const v = split[k as 'cgst' | 'sgst' | 'igst'];
    return v ? [{ ledger, amount: exp ? -v : v, parent: 'Duties & Taxes' }] : [];
  });
  return {
    id: e.id,
    type: exp ? 'Payment' : 'Receipt',
    number: e.number,
    date: e.date,
    party: '',
    narration: e.narration,
    lines: [],
    entries: exp
      ? [
          { ...money, amount: total },
          { ledger: e.head, amount: -r2(e.amount), parent: m.expenses },
          ...taxEntries,
        ]
      : [
          { ...money, amount: -total },
          { ledger: e.head, amount: r2(e.amount), parent: m.otherIncome },
          ...taxEntries,
        ],
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    taxSide: exp ? 'in' : 'out',
    total,
  };
}
