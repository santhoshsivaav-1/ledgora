// Ported from scripts/tax-test.mjs (Phase 0, change 0.10). Assertions are unchanged; only the
// runner changed (Vitest instead of console output).
import { describe, it, expect } from 'vitest';
import {
  INDIAN_STATES,
  appliedStock,
  businessKeyOf,
  clientYearToDate,
  computeInvoiceTotals,
  counterKeyFor,
  decodeGstin,
  formatDocNumber,
  generateEWayBillJSON,
  getStateCode,
  gstinChecksumOk,
  isInterstateSupply,
  isUnionTerritoryWithoutLegislature,
  nextCounterValue,
  numberSeriesFor,
  ownPrefixProblem,
  partyOutstanding,
  periodMonths,
  placeOfSupplyLabel,
  printedSubtotal,
  roundQty,
  setOffITC,
  splitLineTax,
  startFor,
  stateNameForCode,
  stockDelta,
  stockEffect,
} from '../src/index.ts';

// Same semantics as the legacy script helpers (JSON-string equality), reported through Vitest.
const eq = (actual, expected, label) =>
  expect.soft(JSON.stringify(actual), label).toBe(JSON.stringify(expected));
const approx = (actual, expected, label, tol = 0.01) =>
  expect
    .soft(Math.abs(actual - expected) < tol, `${label}: expected approx ${expected}, got ${actual}`)
    .toBe(true);
const truthy = (x, label) => expect.soft(!!x, `${label} (got ${JSON.stringify(x)})`).toBe(true);

describe('[C5] Interstate detection when business state is blank', () => {
  it('holds', () => {
    {
      const r = computeInvoiceTotals({
        items: [{ quantity: 1, rate: 100000, discount: 0, taxPercent: 18 }],
        profile: { country: 'India', state: '' },
        client: { state: 'Karnataka' },
        details: { placeOfSupply: 'Karnataka' },
        showGST: true,
      });
      truthy(
        r.warnings && r.warnings.some((w) => /state.*not set/i.test(w)),
        'blank business state produces a "state not set" warning',
      );
      truthy(r.needsProfileFix, 'sets needsProfileFix flag');
    }

    // ─────────────────────────────────────────────────────────────────────
    // C6 — UTGST for intra-UT supplies (Chandigarh)
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[C6] UTGST bucket for intra-UT supplies', () => {
  it('holds', () => {
    {
      eq(isUnionTerritoryWithoutLegislature('04'), true, 'Chandigarh (04) → UT w/o legislature');
      eq(isUnionTerritoryWithoutLegislature('35'), true, 'A&N (35) → UT w/o legislature');
      eq(isUnionTerritoryWithoutLegislature('38'), true, 'Ladakh (38) → UT w/o legislature');
      eq(isUnionTerritoryWithoutLegislature('31'), true, 'Lakshadweep (31) → UT w/o legislature');
      eq(isUnionTerritoryWithoutLegislature('26'), true, 'DN&DD (26) → UT w/o legislature');
      eq(
        isUnionTerritoryWithoutLegislature('07'),
        false,
        'Delhi (07) → HAS legislature (SGST, not UTGST)',
      );
      eq(isUnionTerritoryWithoutLegislature('34'), false, 'Puducherry (34) → HAS legislature');
      eq(isUnionTerritoryWithoutLegislature('27'), false, 'Maharashtra → not UT');

      // Intra-Chandigarh supply → CGST + UTGST, sgst=0, utgst=9%
      const r = computeInvoiceTotals({
        items: [{ quantity: 1, rate: 100, discount: 0, taxPercent: 18 }],
        profile: { country: 'India', state: 'Chandigarh' },
        client: { state: 'Chandigarh' },
        details: { placeOfSupply: 'Chandigarh' },
        showGST: true,
      });
      approx(r.cgst, 9, 'Chandigarh→Chandigarh: CGST = 9');
      approx(r.utgst, 9, 'Chandigarh→Chandigarh: UTGST = 9');
      approx(r.sgst, 0, 'Chandigarh→Chandigarh: SGST = 0');
      approx(r.igst, 0, 'Chandigarh→Chandigarh: IGST = 0');
    }

    // ─────────────────────────────────────────────────────────────────────
    // C7 — E-Way Bill taxable value when tax-inclusive
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[C7] E-Way Bill respects tax-inclusive', () => {
  it('holds', () => {
    {
      const items = [
        { quantity: 1, rate: 118, discount: 0, taxPercent: 18, hsn: '9018', name: 'Widget' },
      ];
      const totals = computeInvoiceTotals({
        items,
        profile: { country: 'India', state: 'Maharashtra', gstin: '27ABCDE1234F1Z5' },
        client: { state: 'Maharashtra' },
        details: { placeOfSupply: 'Maharashtra' },
        showGST: true,
        taxInclusive: true,
      });
      const ewb = generateEWayBillJSON(
        {
          country: 'India',
          state: 'Maharashtra',
          gstin: '27ABCDE1234F1Z5',
          pin: '400001',
          address: 'Mumbai',
        },
        { state: 'Maharashtra', gstin: '27ZZZZZ9999Z1Z9', pin: '400002', address: 'Mumbai' },
        { invoiceNumber: 'INV/1', invoiceDate: '2026-07-08' },
        items,
        totals,
        'tax-invoice',
        { taxInclusive: true }, // NEW: fourth-arg-plus opts
      );
      // ₹118 gross MRP → taxable value should be ₹100
      approx(
        ewb.billLists[0].itemList[0].taxableAmount,
        100,
        'itemList[0].taxableAmount = 100 (was 118 in old code)',
      );
      approx(ewb.billLists[0].totalValue, 100, 'totalValue = 100 (was 118)');
      approx(ewb.billLists[0].totInvValue, 118, 'totInvValue = 118 (unchanged)');
    }

    // ─────────────────────────────────────────────────────────────────────
    // H6 — TCS 206C(1H) base includes GST
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[H6/H7] TCS/TDS on right base + 50L threshold', () => {
  it('holds', () => {
    {
      // ₹1,00,000 + 18% IGST + 0.1% TCS. Correct: TCS = 0.1% × 118000 = 118. Old = 100.
      // But NOT triggered because threshold not met (single invoice ₹1L << ₹50L).
      const rNotTriggered = computeInvoiceTotals({
        items: [{ quantity: 1, rate: 100000, discount: 0, taxPercent: 18 }],
        profile: { country: 'India', state: 'Maharashtra' },
        client: { state: 'Karnataka' },
        details: { placeOfSupply: 'Karnataka' },
        showGST: true,
        invoiceOptions: { showTCS: true, tcsRate: 0.1, tcsCumulativeThisYear: 100000 }, // way below 50L
      });
      approx(rNotTriggered.tcsAmount, 0, 'below ₹50L cumulative → TCS = 0');

      // Now: cumulative already at 50L → next invoice DOES attract TCS on the marginal amount
      const rTriggered = computeInvoiceTotals({
        items: [{ quantity: 1, rate: 100000, discount: 0, taxPercent: 18 }],
        profile: { country: 'India', state: 'Maharashtra' },
        client: { state: 'Karnataka' },
        details: { placeOfSupply: 'Karnataka' },
        showGST: true,
        invoiceOptions: { showTCS: true, tcsRate: 0.1, tcsCumulativeThisYear: 5000000 },
      });
      // Marginal amount for TCS = full invoice inv-value 118,000 (above threshold).
      // 0.1% × 118000 = 118
      approx(rTriggered.tcsAmount, 118, 'above ₹50L: TCS = 0.1% × 118000 = 118 (Circular 17/2020)');
    }

    // ─────────────────────────────────────────────────────────────────────
    // M5 — RCM + tax-inclusive should not double-charge buyer
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[M5] RCM + tax-inclusive back-out embedded tax', () => {
  it('holds', () => {
    {
      const r = computeInvoiceTotals({
        items: [{ quantity: 1, rate: 118, discount: 0, taxPercent: 18 }],
        profile: { country: 'India', state: 'Maharashtra' },
        client: { state: 'Maharashtra' },
        details: { placeOfSupply: 'Maharashtra' },
        showGST: true,
        taxInclusive: true,
        invoiceOptions: { reverseCharge: true },
      });
      // Under RCM the SELLER's invoice total = taxable value only (₹100), NOT the MRP.
      // Old code produced total=118 which meant buyer pays ₹118 to seller + ₹18 GST to govt.
      approx(r.total, 100, 'RCM + inclusive: seller invoice total = 100, not 118');
    }

    // ─────────────────────────────────────────────────────────────────────
    // M8 — totalTaxCollected includes cess (+ UTGST)
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[M8] totalTaxCollected includes cess and UTGST', () => {
  it('holds', () => {
    {
      const r = computeInvoiceTotals({
        items: [{ quantity: 1, rate: 100, discount: 0, taxPercent: 18, cessPercent: 15 }],
        profile: { country: 'India', state: 'Chandigarh' },
        client: { state: 'Chandigarh' },
        details: { placeOfSupply: 'Chandigarh' },
        showGST: true,
      });
      approx(
        r.totalTaxAmount,
        9 + 9 + 0 + 15,
        'total tax = CGST 9 + UTGST 9 + IGST 0 + cess 15 = 33',
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // M10 — non-numeric rate coerced safely
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[M10] Non-numeric rate/qty stays finite', () => {
  it('holds', () => {
    {
      const r = computeInvoiceTotals({
        items: [{ quantity: '3', rate: 'abc', discount: 0, taxPercent: 18 }],
        profile: { country: 'India', state: 'Maharashtra' },
        client: { state: 'Maharashtra' },
        details: { placeOfSupply: 'Maharashtra' },
        showGST: true,
      });
      eq(
        Number.isFinite(r.total) && r.total >= 0,
        true,
        'total is finite non-negative even with bad rate',
      );
      approx(r.subtotal, 0, 'bad rate → subtotal 0');
    }

    // ─────────────────────────────────────────────────────────────────────
    // H11 — Per-line rounding consistent between invoice and GSTR-1 export
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[H11] Rounding: sum-of-rounded-lines used consistently', () => {
  it('holds', () => {
    {
      const items = [
        { quantity: 1, rate: 42.05, discount: 0, taxPercent: 18 },
        { quantity: 1, rate: 42.05, discount: 0, taxPercent: 18 },
        { quantity: 1, rate: 42.05, discount: 0, taxPercent: 18 },
      ];
      const r = computeInvoiceTotals({
        items,
        profile: { country: 'India', state: 'Maharashtra' },
        client: { state: 'Maharashtra' },
        details: { placeOfSupply: 'Maharashtra' },
        showGST: true,
      });
      // Per-line tax: 42.05 × 0.18 = 7.569 → round(7.57 / 2) = 3.785 each side.
      // Sum of 3 rounded-halves: CGST = 3 × 3.785 = 11.355
      const perLine = items.map((it) => Math.round(it.rate * it.taxPercent) / 100);
      const perLineCgst = perLine.reduce((s, v) => s + v / 2, 0);
      approx(
        r.cgst,
        Math.round(perLineCgst * 100) / 100,
        'invoice CGST equals sum-of-per-line-rounded-halves',
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // ITR fixes
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[V66-#61] Interstate decision and the isInterstate flag', () => {
  it('holds', () => {
    {
      const items = [{ quantity: 1, rate: 1000, discount: 0, taxPercent: 18 }];
      const profile = { country: 'India', state: 'Punjab', gstin: '03AAAAA1111A1Z1' };
      const run = (client, details = {}, invoiceOptions = {}) =>
        computeInvoiceTotals({ items, profile, client, details, invoiceOptions });

      const inter = run({ state: 'Delhi' }, { placeOfSupply: 'Delhi' });
      eq(
        [inter.isInterstate, inter.igst, inter.cgst],
        [true, 180, 0],
        'Delhi client, place of supply Delhi → IGST',
      );

      const intra = run({ state: 'Punjab' }, { placeOfSupply: 'Punjab' });
      eq(
        [intra.isInterstate, intra.igst, intra.cgst, intra.sgst],
        [false, 0, 90, 90],
        'Same state → CGST + SGST',
      );

      // The case #61 reported: the engine charged CGST + SGST while the invoice,
      // comparing state names on its own, printed an "IGST ₹0.00" row.
      const posGoverns = run({ state: 'Delhi' }, { placeOfSupply: 'Punjab' });
      eq(
        [posGoverns.isInterstate, posGoverns.igst, posGoverns.cgst],
        [false, 0, 90],
        'Delhi client supplied in Punjab → place of supply governs',
      );

      const byGstin = run({ gstin: '07BBBBB2222B1Z2' });
      eq(
        [byGstin.isInterstate, byGstin.igst],
        [true, 180],
        'Client known only by an out-of-state GSTIN → IGST',
      );

      const exportClient = run(
        { country: 'United States', state: 'California' },
        {},
        { currency: 'USD' },
      );
      eq(
        [exportClient.isInterstate, exportClient.igst, exportClient.cgst],
        [true, 180, 0],
        'Client outside India → IGST, never CGST + SGST',
      );
      truthy(
        !exportClient.warnings.some((w) => /Place of supply is not set/.test(w)),
        'No "place of supply not set" warning for an export',
      );

      // PR #60 made any non-INR currency an export. Currency is not place of supply.
      const usdInState = run(
        { country: 'India', state: 'Punjab' },
        { placeOfSupply: 'Punjab' },
        { currency: 'USD' },
      );
      eq(
        [usdInState.isInterstate, usdInState.igst, usdInState.cgst],
        [false, 0, 90],
        'Indian client in the same state billed in USD stays CGST + SGST',
      );

      const deliveredHere = run({ country: 'United States' }, { placeOfSupply: 'Punjab' });
      eq(
        [deliveredHere.isInterstate, deliveredHere.cgst],
        [false, 90],
        'Foreign client with an explicit Indian place of supply follows that place',
      );

      const noCountry = run({ state: 'Punjab' });
      eq(noCountry.isInterstate, false, 'A client with no country recorded is treated as Indian');

      eq(typeof intra.isInterstate, 'boolean', 'isInterstate is always a boolean');
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.10.67 (#66 items 7 and 12) — what counts as turnover. The dashboard
    // cards, Reports, GST Returns and Income Tax all lean on this one rule.
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[V68-#68] Reading a GSTIN offline', () => {
  it('holds', () => {
    {
      const real = decodeGstin('27AAPFU0939F1ZV');
      eq(
        [real.stateCode, real.state, real.pan, real.entityType, real.taxpayerType, real.checksumOk],
        ['27', 'Maharashtra', 'AAPFU0939F', 'Firm / LLP', 'Regular', true],
        'A real GSTIN gives state, PAN, entity type and passes its own checksum',
      );
      eq(
        decodeGstin('29AAGCB7383J1Z4').entityType,
        'Company',
        'The 4th letter of the PAN says Company',
      );

      truthy(!gstinChecksumOk('27AAPFU0939F1ZW'), 'A wrong last character is rejected');
      truthy(!gstinChecksumOk('72AAPFU0939F1ZV'), 'Transposed state digits are rejected');
      truthy(!gstinChecksumOk('27AAPFU9039F1ZV'), 'Transposed digits inside the PAN are rejected');
      truthy(!gstinChecksumOk('27AAPFU0939F1Z'), 'A 14-character GSTIN is rejected');

      eq(stateNameForCode('03'), 'Punjab', 'Code 03 is Punjab');
      eq(
        stateNameForCode('37'),
        'Andhra Pradesh',
        'Code 37 is Andhra Pradesh, after the 2014 split',
      );
      eq(
        stateNameForCode('26'),
        'Dadra and Nagar Haveli and Daman and Diu',
        'Code 26 is the merged UT, spelled the way the dropdown spells it',
      );
      eq(stateNameForCode('96'), null, 'An unknown code returns null instead of a guess');
      // A filled-in state has to match a State dropdown option exactly, or the
      // client is left holding a state the form cannot show.
      const strays = INDIAN_STATES.filter((s) => stateNameForCode(getStateCode(s)) !== s);
      eq(strays, [], 'Every state survives name -> code -> name unchanged');

      eq(decodeGstin(''), null, 'Empty input decodes to null');
      eq(decodeGstin('27AAPFU0939F1Z'), null, 'A short string decodes to null');
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.10.70 (ERR-024) - a PDF page may never end inside the signature block
    // or an image. The footer is two columns; an edge that is safe on the left
    // (between bank details and terms) cut the stamp on the right in half.
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[V71] TDS / TCS threshold only for 194Q and 206C(1H)', () => {
  it('holds', () => {
    {
      const base = {
        items: [{ quantity: 1, rate: 100000, taxPercent: 18 }],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: {},
        showGST: true,
      };
      const tds194J = computeInvoiceTotals({
        ...base,
        invoiceOptions: { showTDS: true, tdsSection: '194J', tdsRate: 10 },
      });
      // TDS is on the value WITHOUT GST when GST is shown separately (CBDT
      // Circular 23/2017): 10% of 1,00,000, not of 1,18,000.
      eq(
        tds194J.tdsAmount,
        10000,
        '194J at 10% applies from the first rupee, on the value without GST',
      );
      eq(tds194J.netReceivable, 108000, 'Net receivable = 1,18,000 - 10,000 TDS');
      const tds194Q = computeInvoiceTotals({
        ...base,
        invoiceOptions: {
          showTDS: true,
          tdsSection: '194Q',
          tdsRate: 0.1,
          tdsCumulativeThisYear: 5000000,
        },
      });
      eq(
        tds194Q.tdsAmount,
        100,
        '194Q above ₹50 lakh: 0.1% of the value without GST (Circular 13/2021)',
      );
      const tcs1H = computeInvoiceTotals({
        ...base,
        invoiceOptions: {
          showTCS: true,
          tcsSection: '206C(1H)',
          tcsRate: 0.1,
          tcsCumulativeThisYear: 0,
        },
      });
      eq(tcs1H.tcsAmount, 0, '206C(1H) still waits for the ₹50 lakh threshold');
      const tcs1Hover = computeInvoiceTotals({
        ...base,
        invoiceOptions: {
          showTCS: true,
          tcsSection: '206C(1H)',
          tcsRate: 0.1,
          tcsCumulativeThisYear: 4950000,
        },
      });
      eq(tcs1Hover.tcsAmount, 68, '206C(1H) charges only the part above ₹50 lakh (68,000 × 0.1%)');
      // '52' is the code TCS_SECTIONS stores. Section 52 TCS is on the net
      // taxable value, without GST.
      const tcs52 = computeInvoiceTotals({
        ...base,
        invoiceOptions: { showTCS: true, tcsSection: '52', tcsRate: 1 },
      });
      eq(
        tcs52.tcsAmount,
        1000,
        'CGST section 52 TCS applies from the first rupee, on the taxable value',
      );
    }
  });
});

describe("[V71] A client's sales so far this financial year", () => {
  it('holds', () => {
    {
      const bills = [
        {
          id: 'a',
          clientName: 'Meera',
          invoiceDate: '2026-04-10',
          totalAmount: 100,
          invoiceType: 'tax-invoice',
        },
        {
          id: 'b',
          clientName: 'meera ',
          invoiceDate: '2027-03-31',
          totalAmount: 200,
          invoiceType: 'tax-invoice',
        },
        {
          id: 'c',
          clientName: 'Meera',
          invoiceDate: '2026-03-31',
          totalAmount: 400,
          invoiceType: 'tax-invoice',
        },
        {
          id: 'd',
          clientName: 'Meera',
          invoiceDate: '2026-05-01',
          totalAmount: 800,
          invoiceType: 'proforma',
        },
        {
          id: 'e',
          clientName: 'Meera',
          invoiceDate: '2026-05-01',
          totalAmount: 1600,
          invoiceType: 'tax-invoice',
          status: 'cancelled',
        },
        {
          id: 'f',
          clientName: 'Meera',
          invoiceDate: '2026-05-01',
          totalAmount: 3200,
          invoiceType: 'tax-invoice',
          currency: 'USD',
        },
        {
          id: 'g',
          clientName: 'Arjun',
          invoiceDate: '2026-05-01',
          totalAmount: 6400,
          invoiceType: 'tax-invoice',
        },
      ];
      eq(
        clientYearToDate(bills, 'Meera', '2026-09-24'),
        300,
        'Same client, same FY, rupee sales only (quotes, cancelled, USD, last FY and other clients left out)',
      );
      eq(
        clientYearToDate(bills, 'Meera', '2026-09-24', 'a'),
        200,
        'The invoice being edited is not counted twice',
      );
      eq(clientYearToDate(bills, '', '2026-09-24'), 0, 'No client name, nothing counted');
    }
  });
});

describe('[V75] Party outstanding by month', () => {
  it('holds', () => {
    {
      const fy = periodMonths('fy', 2026);
      eq(
        [fy[0].key, fy[11].key, fy.length],
        ['2026-04', '2027-03', 12],
        'Financial year runs April to March',
      );
      const cal = periodMonths('calendar', 2026);
      eq(
        [cal[0].key, cal[11].key],
        ['2026-01', '2026-12'],
        'Calendar year runs January to December',
      );
      const bills = [
        {
          clientName: 'Asha Traders',
          invoiceDate: '2026-04-10',
          totalAmount: 1000,
          paidAmount: 400,
        },
        { clientName: 'asha traders ', invoiceDate: '2026-04-20', totalAmount: 500 },
        { clientName: 'Asha Traders', invoiceDate: '2026-06-01', totalAmount: 300 },
        { clientName: 'Asha Traders', invoiceDate: '2026-02-01', totalAmount: 200 },
        {
          clientName: 'Bala & Sons',
          invoiceDate: '2026-05-05',
          totalAmount: 800,
          status: 'paid',
          paidAmount: 800,
        },
        {
          clientName: 'Bala & Sons',
          invoiceDate: '2026-05-06',
          totalAmount: 900,
          invoiceType: 'proforma',
        },
        {
          clientName: 'Bala & Sons',
          invoiceDate: '2026-05-07',
          totalAmount: 700,
          status: 'cancelled',
        },
        { clientName: 'Bala & Sons', invoiceDate: '2026-05-08', totalAmount: 50, currency: 'USD' },
        { clientName: 'Chetan', invoiceDate: '2027-04-02', totalAmount: 999 },
      ];
      const rows = partyOutstanding(bills, fy, 'INR');
      eq(
        rows.map((r) => r.name),
        ['Asha Traders'],
        'Only parties with unpaid real sales in this currency, up to the period end',
      );
      eq(
        rows[0].months,
        { '2026-04': 1100, '2026-06': 300 },
        'Unpaid balance lands in the invoice month; same party despite case and spaces',
      );
      eq(
        [rows[0].earlier, rows[0].total],
        [200, 1600],
        'Still-unpaid bills from before the period show as Earlier and count in the total',
      );
      eq(partyOutstanding(bills, fy, 'USD')[0].total, 50, 'Each currency is its own report');
    }
  });
});

describe('[V76] #83 printed Subtotal with prices including tax', () => {
  it('holds', () => {
    {
      const inc = computeInvoiceTotals({
        items: [
          { quantity: 1, rate: 300, discount: 0, taxPercent: 0 },
          { quantity: 2, rate: 1050, discount: 0, taxPercent: 18 },
        ],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: { placeOfSupply: 'Punjab' },
        showGST: true,
        taxInclusive: true,
      });
      approx(inc.total, 2400, 'Total stays 2,400 (tax is inside the prices)');
      approx(
        printedSubtotal(inc),
        2079.66,
        'Printed Subtotal is the taxable value, not the tax-inclusive 2,400',
      );
      approx(
        printedSubtotal(inc) - inc.totalDiscount + inc.cgst + inc.sgst,
        inc.total,
        'Subtotal + CGST + SGST adds up to the Total on paper',
      );
      const exc = computeInvoiceTotals({
        items: [{ quantity: 2, rate: 1000, discount: 0, taxPercent: 18 }],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: { placeOfSupply: 'Punjab' },
        showGST: true,
      });
      approx(printedSubtotal(exc), 2000, 'Without tax-inclusive prices the Subtotal is unchanged');
    }
  });
});

describe('[V76] #81 GSTR-3B ITC set-off across heads', () => {
  it('holds', () => {
    {
      const a = setOffITC({ igst: 810, cgst: 0, sgst: 0 }, { igst: 0, cgst: 360, sgst: 360 });
      eq(
        a.payable,
        { igst: 90, cgst: 0, sgst: 0 },
        'CGST + SGST credit pays an IGST liability (the #81 example: 810 -> 90)',
      );
      eq(a.carry, { igst: 0, cgst: 0, sgst: 0 }, 'No credit left over in that example');
      const b = setOffITC({ igst: 0, cgst: 0, sgst: 500 }, { igst: 0, cgst: 500, sgst: 0 });
      eq([b.payable.sgst, b.carry.cgst], [500, 500], 'CGST credit never pays SGST');
      const c = setOffITC({ igst: 100, cgst: 300, sgst: 300 }, { igst: 400, cgst: 0, sgst: 0 });
      eq(
        c.payable,
        { igst: 0, cgst: 0, sgst: 300 },
        'IGST credit pays IGST first, then CGST, then SGST',
      );
      const d = setOffITC({ igst: 0, cgst: 100, sgst: 100 }, { igst: 0, cgst: 150, sgst: 150 });
      eq(
        [d.payable, d.carry],
        [
          { igst: 0, cgst: 0, sgst: 0 },
          { igst: 0, cgst: 50, sgst: 50 },
        ],
        'Intra-state only: same as before, extra credit carried forward',
      );
      const e = setOffITC({ igst: 0, cgst: 100, sgst: 100 }, { igst: 100, cgst: 100, sgst: 0 });
      eq(
        [e.payable, e.carry],
        [
          { igst: 0, cgst: 0, sgst: 0 },
          { igst: 0, cgst: 0, sgst: 0 },
        ],
        'IGST credit goes where it avoids cash: SGST here, as CGST has its own credit',
      );
    }
  });
});

describe('[V76] #82 purchase inter-state from the supplier GSTIN', () => {
  it('holds', () => {
    {
      eq(
        isInterstateSupply('27AABCU9603R1ZM', { gstin: '07AAAAA0000A1Z5' }),
        true,
        'Maharashtra supplier, Delhi business: inter-state',
      );
      eq(
        isInterstateSupply('07BBBBB1111B1Z2', { gstin: '07AAAAA0000A1Z5' }),
        false,
        'Same state: not inter-state',
      );
      eq(
        isInterstateSupply('27AABCU9603R1ZM', { state: 'Maharashtra' }),
        false,
        'Business state used when it has no GSTIN',
      );
      eq(
        isInterstateSupply('27AABCU96', { gstin: '07AAAAA0000A1Z5' }),
        null,
        'A half-typed GSTIN changes nothing',
      );
      eq(isInterstateSupply('27AABCU9603R1ZM', {}), null, 'Unknown business state changes nothing');
    }
  });
});

describe('[V76] #80 stock follows the invoice', () => {
  it('holds', () => {
    {
      const items = (q) => [
        { productId: 'pen', quantity: q },
        { name: 'free text line', quantity: 3 },
      ];
      eq(
        stockEffect(items(10), 'tax-invoice', 'unpaid'),
        { pen: -10 },
        'A sale takes stock out (lines without a product are ignored)',
      );
      eq(stockEffect(items(10), 'quotation', 'unpaid'), {}, 'A quotation moves no stock');
      eq(stockEffect(items(10), 'proforma', 'unpaid'), {}, 'A proforma moves no stock');
      eq(
        stockEffect(items(4), 'credit-note', 'unpaid'),
        { pen: 4 },
        'A credit note puts returned goods back',
      );
      eq(
        stockEffect(items(10), 'tax-invoice', 'cancelled'),
        {},
        'A cancelled invoice moves nothing',
      );
      const saved = {
        status: 'unpaid',
        data: { items: items(10), invoiceType: 'tax-invoice', stockApplied: { pen: -10 } },
      };
      eq(
        stockDelta(appliedStock(saved), stockEffect(items(15), 'tax-invoice', 'unpaid')),
        { pen: -5 },
        'Editing 10 -> 15 takes exactly 5 more (the #80 example)',
      );
      eq(
        stockDelta(appliedStock(saved), stockEffect(items(10), 'tax-invoice', 'unpaid')),
        {},
        'Saving again unchanged moves nothing',
      );
      eq(
        stockDelta(appliedStock(saved), stockEffect(items(10), 'quotation', 'unpaid')),
        { pen: 10 },
        'Turning it into a quotation gives the stock back',
      );
      const legacy = { status: 'unpaid', data: { items: items(10), invoiceType: 'quotation' } };
      eq(
        appliedStock(legacy),
        { pen: -10 },
        'A quotation saved before v1.10.76 is known to have taken stock out',
      );
      eq(
        appliedStock({ ...legacy, autoGenerated: true }),
        {},
        'A recurring bill made by the server never touched stock',
      );
      eq(
        appliedStock({ ...legacy, status: 'cancelled' }),
        {},
        'An old cancelled bill had its stock put back',
      );
      const oldCancelledInv = {
        status: 'cancelled',
        data: { items: items(10), invoiceType: 'tax-invoice' },
      };
      eq(
        stockDelta(appliedStock(oldCancelledInv), stockEffect(items(10), 'tax-invoice', 'unpaid')),
        { pen: -10 },
        'Un-cancelling an old cancelled invoice takes its stock out again',
      );
      const challan = {
        status: 'unpaid',
        data: { items: items(10), invoiceType: 'delivery-challan', stockApplied: { pen: -10 } },
      };
      eq(
        stockDelta(appliedStock(challan), stockEffect(items(10), 'tax-invoice', 'unpaid')),
        {},
        'A challan converted to an invoice: the invoice takes over its stock, nothing moves twice',
      );
    }
  });
});

describe('[V77] #89 CGST and SGST are equal halves in the GST returns', () => {
  it('holds', () => {
    {
      // 25 lines at 5% whose tax lands on an odd paisa (the reporter's HSN summary drifted by ₹0.25).
      const lines = Array.from({ length: 25 }, (_, i) => ({
        quantity: 1,
        rate: 20.3 + i * 0.2,
        taxPercent: 5,
        discount: 0,
      }));
      const sum = lines
        .map((l) => splitLineTax(l, false))
        .reduce((a, x) => ({ c: a.c + x.cgst, s: a.s + x.sgst }), { c: 0, s: 0 });
      eq(
        Math.round(sum.c * 100),
        Math.round(sum.s * 100),
        'Over 25 odd-paisa lines CGST and SGST stay exactly equal',
      );
      // And they add up to what one invoice with those 25 lines prints (no paisa drift per line).
      const many = computeInvoiceTotals({
        items: lines,
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: { placeOfSupply: 'Punjab' },
        showGST: true,
      });
      eq(
        [Math.round(sum.c * 100) / 100, Math.round(sum.s * 100) / 100],
        [many.cgst, many.sgst],
        '25 lines: GST return CGST and SGST equal the invoice CGST and SGST',
      );
      const one = { quantity: 9, rate: 232.804, taxPercent: 5, discount: 0 };
      const inv = computeInvoiceTotals({
        items: [one],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: { placeOfSupply: 'Punjab' },
        showGST: true,
      });
      const ln = splitLineTax(one, false);
      eq(
        [Math.round(ln.cgst * 100) / 100, Math.round(ln.sgst * 100) / 100],
        [inv.cgst, inv.sgst],
        'A line splits the same way the invoice prints it',
      );
      const ut = splitLineTax(one, false, false, true);
      eq(
        [ut.sgst, ut.utgst === ln.cgst],
        [0, true],
        'UT without a legislature: CGST + UTGST, no SGST',
      );
      approx(splitLineTax(one, true).igst, 104.76, 'Inter-state: all IGST');
      // 300 lines (fixed pseudo-random): the half paisa always rounds up, and
      // round() and toFixed(2) agree, so screen, CSV and JSON show the same CGST.
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const big = Array.from({ length: 300 }, () => ({
        quantity: 1 + Math.floor(rnd() * 9),
        rate: Math.round(rnd() * 50000) / 100,
        taxPercent: [5, 12, 18, 28][Math.floor(rnd() * 4)],
        discount: 0,
      }));
      const raw = big.reduce((a, l) => a + splitLineTax(l, false).cgst, 0);
      const paise = big.reduce((a, l) => a + Math.round(splitLineTax(l, true).igst * 100), 0);
      eq(
        [Math.round(raw * 100) / 100, Number(raw.toFixed(2))],
        [Math.ceil(paise / 2) / 100, Math.ceil(paise / 2) / 100],
        '300 lines: CGST is half the tax with the half paisa rounded up, same by round() and toFixed(2)',
      );
    }
  });
});

describe('[V78] #93 start numbering from (tax invoices)', () => {
  it('holds', () => {
    {
      const settings = { startNumber: 1001 };
      eq(
        nextCounterValue(undefined, startFor('tax-invoice', settings)),
        1001,
        'A new book with Start 1001: the first tax invoice is 1001',
      );
      eq(nextCounterValue(1001, startFor('tax-invoice', settings)), 1002, 'Then 1002, 1003...');
      eq(
        nextCounterValue(5, startFor('tax-invoice', settings)),
        1001,
        'Already at 0005: raising the start jumps to 1001',
      );
      eq(
        nextCounterValue(1200, startFor('tax-invoice', settings)),
        1201,
        'A start below the last number never reuses a number',
      );
      eq(
        nextCounterValue(0, startFor(undefined, settings)),
        1001,
        'An invoice saved before types existed counts as a tax invoice',
      );
      eq(
        [
          nextCounterValue(0, startFor('quotation', settings)),
          nextCounterValue(3, startFor('credit-note', settings)),
          nextCounterValue(0, startFor('delivery-challan', settings)),
        ],
        [1, 4, 1],
        'Quotations, credit notes and challans keep their own count from 1',
      );
      eq(nextCounterValue(0), 1, 'No start (receipts): from 1');
      eq(
        [
          nextCounterValue(0, '1001'),
          nextCounterValue(0, 1001.7),
          nextCounterValue(0, -5),
          nextCounterValue(7.9, 1),
          nextCounterValue(0, ''),
        ],
        [1001, 1001, 1, 8, 1],
        'Text, decimals, negatives and blanks are made safe',
      );
      eq(nextCounterValue(0, 1e15), 999999999, 'A start is capped at 999999999');
    }
  });
});

describe('[V79] #96 quantities, #95 places of supply and per-business numbering', () => {
  it('holds', () => {
    {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += 15.8924; // floating point drifts
      eq(
        [
          roundQty(sum),
          roundQty(6356.959999999999),
          roundQty(0.1 + 0.2),
          roundQty(6356.959999999999, 2),
        ],
        [6356.96, 6356.96, 0.3, 6356.96],
        'Added-up quantities are rounded (6356.9599999 -> 6356.96)',
      );
      eq(
        [
          placeOfSupplyLabel('10'),
          placeOfSupplyLabel('Bihar'),
          placeOfSupplyLabel('03AAAAA0000A1Z5'),
          placeOfSupplyLabel(''),
        ],
        ['10-Bihar', '10-Bihar', '03-Punjab', ''],
        'Place of supply written the portal way: 10-Bihar',
      );

      const brand = { brandPrefix: 'ACME', separator: '/', showFinYear: true, padDigits: 4 };
      const fmt = (settings, typePrefix, next, extra = {}) =>
        formatDocNumber({ settings, typePrefix, next, fyLabel: '2026-27', ...extra });
      eq(
        [fmt(brand, 'INV', 6), fmt(brand, 'QUO', 6), fmt(brand, 'DC', 1), fmt(brand, 'RCP', 2)],
        [
          'ACME/2026-27/0006',
          'ACME-QUO/2026-27/0006',
          'ACME-DC/2026-27/0001',
          'ACME-RCP/2026-27/0002',
        ],
        'Brand prefix: invoices ACME/..., other types ACME-QUO/... so a quotation never collides with an invoice',
      );
      eq(
        [
          fmt({}, 'INV', 7),
          fmt({ ...brand, showFinYear: false }, 'INV', 7),
          fmt(brand, 'RPT', 3, { explicitPrefix: true }),
        ],
        ['INV/2026-27/0007', 'ACME/0007', 'RPT/2026-27/0003'],
        'No brand: type prefix; no FY; a Print Settings per-type prefix is used as is',
      );

      const kaveri = { businessName: 'Kaveri Stationers', gstin: '29abcde1234f1zw' };
      const anant = { businessName: '  Anant  Exports ', gstin: '' };
      eq(
        [businessKeyOf(kaveri), businessKeyOf(anant), businessKeyOf(null)],
        ['29ABCDE1234F1ZW', 'NAME:anant exports', ''],
        'A business is known by its GSTIN, else its name',
      );
      const shared = { brandPrefix: '', startNumber: 1 };
      const map = { [businessKeyOf(anant)]: { brandPrefix: 'AE', startNumber: 502 } };
      const a = numberSeriesFor(shared, map, businessKeyOf(kaveri));
      const b = numberSeriesFor(shared, map, businessKeyOf(anant));
      eq(
        [a.own, b.own, b.brandPrefix, b.startNumber, b.separator],
        [false, true, 'AE', 502, '/'],
        'A business without its own numbering uses the shared one; one with it uses its own',
      );
      eq(
        [
          counterKeyFor('INV', a, businessKeyOf(kaveri)),
          counterKeyFor('INV', b, businessKeyOf(anant)),
        ],
        ['counter_INV', 'counter_INV@NAME:anant exports'],
        'Each own series has its own counters',
      );
      eq(
        [
          fmt(a, 'INV', nextCounterValue(1225, startFor('tax-invoice', a))),
          fmt(b, 'INV', nextCounterValue(undefined, startFor('tax-invoice', b))),
        ],
        ['INV/2026-27/1226', 'AE/2026-27/0502'],
        '#95: firm A continues at 1226, firm B starts its own series at 0502',
      );

      const ctx = {
        shared: { brandPrefix: 'ACME' },
        seriesMap: map,
        businessKey: businessKeyOf(kaveri),
        customPrefixes: { 'tax-invoice': 'RPT' },
      };
      eq(
        [
          !!ownPrefixProblem('', ctx),
          !!ownPrefixProblem('inv', ctx),
          !!ownPrefixProblem('ACME', ctx),
          !!ownPrefixProblem('AE', ctx),
          !!ownPrefixProblem('RPT', ctx),
          ownPrefixProblem('KS', ctx),
        ],
        [true, true, true, true, true, ''],
        'An own prefix must be set and unlike any other series (type prefixes, shared, other businesses, Print Settings)',
      );
      eq(
        ownPrefixProblem('AE', { ...ctx, businessKey: businessKeyOf(anant) }),
        '',
        'A business may keep its own prefix when it saves again',
      );
    }
  });
});
