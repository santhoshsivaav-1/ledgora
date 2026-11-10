// The 20 computeInvoiceTotals inputs whose outputs are frozen in totals.golden.json (Vyapar parity P2-S3).
// The first 8 are the calls tax.test.js makes (directly or through templateTotals); the other 12 cover the branches
// totals.ts has that those 8 do not reach. Captured before additional charges touched totals.ts; an invoice without
// charges must keep producing byte-identical output.
import { deliveryChargeLine } from '../../src/utils.js';

const punjab = { country: 'India', state: 'Punjab' };
const inclItem = {
  name: 'Shirt',
  quantity: 1,
  rate: 1180,
  taxPercent: 18,
  discount: 118,
  discountMode: 'withTax',
  withTaxRule: 2,
};

const template = (tpl, profile) => ({
  items: tpl.items || [],
  profile,
  client: {
    name: tpl.clientName,
    state: tpl.clientState,
    gstin: tpl.clientGstin,
    country: tpl.clientCountry,
    isSEZ: !!tpl.isSEZ,
  },
  details: { placeOfSupply: tpl.placeOfSupply || '' },
  showGST: tpl.invoiceType !== 'bill-of-supply',
  taxInclusive: !!tpl.taxInclusive,
  invoiceOptions: { ...(tpl.invoiceOptions || {}) },
});
const tpl = {
  invoiceType: 'bill-of-supply',
  clientName: 'Ravi',
  clientState: 'Punjab',
  items: [{ quantity: 1, rate: 1000, taxPercent: 18 }],
};

export const TOTALS_FIXTURES = [
  {
    name: 'tax.test: delivery charges line in the total',
    input: {
      items: [{ quantity: 2, rate: 500, taxPercent: 12 }, deliveryChargeLine([{ taxPercent: 12 }], 100)],
      profile: punjab,
      client: { state: 'Punjab' },
      details: { placeOfSupply: 'Punjab' },
      showGST: true,
    },
  },
  {
    name: 'tax.test: old with-tax discount, tax-inclusive',
    input: {
      items: [{ ...inclItem, withTaxRule: undefined }],
      profile: punjab,
      client: { state: 'Punjab' },
      details: {},
      showGST: true,
      taxInclusive: true,
    },
  },
  {
    name: 'tax.test: with-tax discount, tax-inclusive',
    input: { items: [inclItem], profile: punjab, client: { state: 'Punjab' }, details: {}, showGST: true, taxInclusive: true },
  },
  {
    name: 'tax.test: bill of supply with a with-tax discount',
    input: { items: [{ ...inclItem, rate: 1000 }], profile: punjab, client: { state: 'Punjab' }, details: {}, showGST: false },
  },
  {
    name: 'tax.test: e-way bill, interstate',
    input: {
      items: [{ quantity: 1, rate: 100, taxPercent: 18 }],
      profile: punjab,
      client: { state: 'Punjab' },
      details: { placeOfSupply: 'Haryana' },
      showGST: true,
    },
  },
  { name: 'tax.test: template, bill of supply', input: template(tpl, punjab) },
  { name: 'tax.test: template, tax invoice', input: template({ ...tpl, invoiceType: 'tax-invoice' }, punjab) },
  {
    name: 'tax.test: template, place of supply decides IGST',
    input: template({ ...tpl, invoiceType: 'tax-invoice', placeOfSupply: 'Haryana' }, punjab),
  },
  {
    name: 'mixed rates, intra-state, line discounts',
    input: {
      items: [
        { quantity: 3, rate: 250, taxPercent: 18, discount: 50 },
        { quantity: 10, rate: 12.5, taxPercent: 5, discount: 10, discountType: 'percent' },
        { quantity: 1, rate: 999.99, taxPercent: 28, cessPercent: 12 },
      ],
      profile: { country: 'India', state: 'Tamil Nadu', gstin: '33AAAAA0000A1Z5' },
      client: { state: 'Tamil Nadu' },
      details: { placeOfSupply: 'Tamil Nadu' },
      showGST: true,
    },
  },
  {
    name: 'intra-UT (Chandigarh) uses UTGST',
    input: {
      items: [{ quantity: 4, rate: 125, taxPercent: 12 }],
      profile: { country: 'India', state: 'Chandigarh' },
      client: { state: 'Chandigarh' },
      details: { placeOfSupply: 'Chandigarh' },
      showGST: true,
    },
  },
  {
    name: 'reverse charge, tax-inclusive',
    input: {
      items: [{ quantity: 1, rate: 1180, taxPercent: 18, cessPercent: 1 }],
      profile: punjab,
      client: { state: 'Punjab' },
      details: { placeOfSupply: 'Punjab' },
      showGST: true,
      taxInclusive: true,
      invoiceOptions: { reverseCharge: true },
    },
  },
  {
    name: 'TCS 206C(1H) above the threshold, round-off on',
    input: {
      items: [{ quantity: 7, rate: 1234.57, taxPercent: 18 }],
      profile: punjab,
      client: { state: 'Delhi' },
      details: { placeOfSupply: 'Delhi' },
      showGST: true,
      invoiceOptions: { showTCS: true, tcsRate: 0.1, tcsCumulativeThisYear: 6_000_000, showRoundOff: true },
    },
  },
  {
    name: 'TDS 194J from rupee one',
    input: {
      items: [{ quantity: 1, rate: 100000, taxPercent: 18 }],
      profile: punjab,
      client: { state: 'Punjab' },
      details: { placeOfSupply: 'Punjab' },
      showGST: true,
      invoiceOptions: { showTDS: true, tdsRate: 10, tdsSection: '194J' },
    },
  },
  {
    name: 'invoice-level percent discount with round-off',
    input: {
      items: [
        { quantity: 2, rate: 333.33, taxPercent: 18 },
        { quantity: 1, rate: 99.5, taxPercent: 5 },
      ],
      profile: punjab,
      client: { state: 'Punjab' },
      details: { placeOfSupply: 'Punjab' },
      showGST: true,
      invoiceOptions: { invoiceDiscountType: 'percent', invoiceDiscountValue: 7.5, showRoundOff: true },
    },
  },
  {
    name: 'invoice-level fixed discount above the total is capped',
    input: {
      items: [{ quantity: 1, rate: 50, taxPercent: 18 }],
      profile: punjab,
      client: { state: 'Punjab' },
      details: {},
      showGST: true,
      invoiceOptions: { invoiceDiscountType: 'fixed', invoiceDiscountValue: 500 },
    },
  },
  {
    name: 'export client is IGST',
    input: {
      items: [{ quantity: 5, rate: 80, taxPercent: 18 }],
      profile: punjab,
      client: { state: '', country: 'United States' },
      details: {},
      showGST: true,
    },
  },
  {
    name: 'SEZ client is IGST',
    input: {
      items: [{ quantity: 2, rate: 450, taxPercent: 12 }],
      profile: punjab,
      client: { state: 'Punjab', isSEZ: true },
      details: { placeOfSupply: 'Punjab' },
      showGST: true,
    },
  },
  {
    name: 'blank business state warns and needs a profile fix',
    input: {
      items: [{ quantity: 1, rate: 100, taxPercent: 18 }],
      profile: { country: 'India' },
      client: { state: 'Kerala' },
      details: {},
      showGST: true,
    },
  },
  {
    name: 'seller outside India',
    input: {
      items: [{ quantity: 3, rate: 19.99, taxPercent: 20 }],
      profile: { country: 'United Kingdom' },
      client: {},
      details: {},
      showGST: true,
    },
  },
  {
    name: 'null profile and garbage numbers do not crash',
    input: {
      items: [{ quantity: 'abc', rate: 100, taxPercent: 18 }, { quantity: 2, rate: -5, taxPercent: 'x' }],
      profile: null,
      client: null,
      details: null,
      showGST: true,
    },
  },
];
