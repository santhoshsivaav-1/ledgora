// Writes a small, realistic Master.xml and Voucher.xml for the owner's manual import test in Tally Prime
// (docs/TALLY_IMPORT_CHECK.md). Usage: node packages/tax-engine/scripts/tally-sample.ts <output folder> [company name]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_TALLY_MAPPING,
  buildMasterXml,
  buildVoucherXml,
  expenseVoucher,
  paymentVoucher,
  validateTally,
  voucherBalance,
  type TallyVoucher,
} from '../src/index.ts';

const out = process.argv[2];
if (!out) {
  console.error(
    'Usage: node packages/tax-engine/scripts/tally-sample.ts <output folder> [company name]',
  );
  process.exit(1);
}
const M = { ...DEFAULT_TALLY_MAPPING, company: process.argv[3] ?? 'Ledgora Test Company' };
const sale = (
  id: string,
  number: string,
  date: string,
  party: string,
  state: string,
  gstin: string,
  pos: string,
  inter: boolean,
  q: number,
  rate: number,
  gst: number,
): TallyVoucher => {
  const taxable = q * rate;
  const tax = Math.round(taxable * gst) / 100;
  const total = taxable + tax;
  return {
    id,
    type: 'Sales',
    number,
    date,
    party,
    partyGstin: gstin,
    partyState: state,
    placeOfSupply: pos,
    lines: [
      {
        name: 'Sample Item',
        hsn: '3401',
        unit: 'PCS',
        quantity: q,
        rate,
        amount: taxable,
        gstRate: gst,
      },
    ],
    cgst: inter ? 0 : tax / 2,
    sgst: inter ? 0 : tax / 2,
    igst: inter ? tax : 0,
    total,
  };
};
const vouchers: TallyVoucher[] = [
  sale(
    's1',
    'INV/2025-26/0001',
    '2025-10-05',
    'Test Customer TN',
    'Tamil Nadu',
    '33ABCDE1234F1Z5',
    'Tamil Nadu',
    false,
    2,
    100,
    18,
  ),
  sale(
    's2',
    'INV/2025-26/0002',
    '2025-10-06',
    'Test Customer KL',
    'Kerala',
    '32ABCDE1234F1Z5',
    'Kerala',
    true,
    10,
    100,
    5,
  ),
  {
    id: 'p1',
    type: 'Purchase',
    number: 'PB-1',
    date: '2025-10-02',
    party: 'Test Supplier',
    partyGstin: '33AAAAA0000A1Z5',
    partyState: 'Tamil Nadu',
    placeOfSupply: 'Tamil Nadu',
    lines: [
      {
        name: 'Sample Item',
        hsn: '3401',
        unit: 'PCS',
        quantity: 50,
        rate: 60,
        amount: 3000,
        gstRate: 18,
      },
    ],
    cgst: 270,
    sgst: 270,
    total: 3540,
  },
  paymentVoucher(
    {
      id: 'r1',
      direction: 'in',
      number: 'RCT-1',
      date: '2025-10-15',
      party: 'Test Customer TN',
      mode: 'bank',
      amount: 200,
    },
    M,
  ),
  expenseVoucher(
    {
      id: 'e1',
      kind: 'expense',
      number: 'EXP-1',
      date: '2025-10-20',
      head: 'Test Rent',
      amount: 1000,
      tax: 180,
      mode: 'cash',
    },
    M,
  ),
];
for (const v of vouchers)
  if (Math.abs(voucherBalance(v, M)) > 0.01) throw new Error(`${v.number} does not balance`);
const problems = validateTally(vouchers, M, [
  { id: 'a', name: 'Test Customer TN' },
  { id: 'b', name: 'Test Customer KL' },
  { id: 'c', name: 'Test Supplier' },
]).filter((p) => p.level === 'error');
if (problems.length) throw new Error(problems.map((p) => p.message).join('; '));
mkdirSync(out, { recursive: true });
const parties = [
  {
    name: 'Test Customer TN',
    kind: 'customer' as const,
    gstin: '33ABCDE1234F1Z5',
    state: 'Tamil Nadu',
  },
  {
    name: 'Test Customer KL',
    kind: 'customer' as const,
    gstin: '32ABCDE1234F1Z5',
    state: 'Kerala',
  },
  {
    name: 'Test Supplier',
    kind: 'supplier' as const,
    gstin: '33AAAAA0000A1Z5',
    state: 'Tamil Nadu',
  },
];
writeFileSync(
  path.join(out, 'Master.xml'),
  buildMasterXml(parties, [{ name: 'Sample Item', unit: 'PCS', hsn: '3401', gstRate: 18 }], M, {
    vouchers,
  }),
);
writeFileSync(path.join(out, 'Voucher.xml'), buildVoucherXml(vouchers, M));
console.log(
  `Wrote Master.xml and Voucher.xml (${vouchers.length} vouchers, company "${M.company}") to ${path.resolve(out)}`,
);
