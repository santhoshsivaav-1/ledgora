// Ported from scripts/tax-test.mjs (Phase 0, change 0.10). Assertions are unchanged; only the
// runner changed (Vitest instead of console output).
import { describe, it, expect } from 'vitest';
import {
  GST_PORTAL_RATES,
  INVOICE_TYPES,
  TCS_SECTIONS,
  amountDue,
  b2clThreshold,
  computeInvoiceTotals,
  deliveryChargeLine,
  docsLink,
  filledOrderDetails,
  findSameBusiness,
  formatDateGST,
  formatDocNumber,
  formatShortDate,
  generateEWayBillJSON,
  getCountryConfig,
  getDefaultUnitForMode,
  getUpcomingFilings,
  invoiceOptionOn,
  isCancelledBill,
  markPaidPatch,
  markUnpaidPatch,
  numberFormatProblem,
  numberToWords,
  parseLocalDate,
  paymentStatusFor,
  placeOfSupplyLabel,
  resolveLineDiscount,
  safePageBoundaries,
  salesSign,
  savedPdfNameFor,
  splitNumberedTerms,
  templateTotals,
} from '../src/utils.js';
import { buildXlsx, colName } from '../src/utils/xlsx.js';
import { bulkRowToProduct, closingStock, stockValueOf } from '../src/utils/products.js';
import { strFromU8, unzipSync } from 'fflate';
import {
  AUTO_CATEGORY_RULES,
  buildITR4FieldMap,
  compute234AInterest,
  compute234BInterest,
  compute234CInterest,
  compute44AE,
  computeAdvanceTaxSchedule,
  computeAllowedDeductions,
  computeSurcharge,
  computeTax,
  effectiveDeductionCap,
  getAdvanceTaxSchedule,
  getCapitalGainsConfig,
  getOldRegimeSlabs,
} from '../src/utils/itr.js';

// Same semantics as the legacy script helpers (JSON-string equality), reported through Vitest.
const eq = (actual, expected, label) =>
  expect.soft(JSON.stringify(actual), label).toBe(JSON.stringify(expected));
const approx = (actual, expected, label, tol = 0.01) =>
  expect
    .soft(Math.abs(actual - expected) < tol, `${label}: expected approx ${expected}, got ${actual}`)
    .toBe(true);
const truthy = (x, label) => expect.soft(!!x, `${label} (got ${JSON.stringify(x)})`).toBe(true);

describe('[H8] 234C for presumptive: 1% × 1 month × Q4 shortfall', () => {
  it('holds', () => {
    {
      const sched = computeAdvanceTaxSchedule(100000, 0, [], 'presumptive');
      // Presumptive: single 100% installment on 15-Mar (Q4). No advance paid.
      // Correct §234C = 1% × 1 month × 100000 = 1000
      const int234c = compute234CInterest(sched);
      approx(int234c, 1000, '234C = 1000 (single Q4 installment, 1% × 1 month)');
    }
  });
});

describe('[H9] Surcharge 15% cap on 111A/112A gains', () => {
  it('holds', () => {
    {
      // ₹5.5Cr salary + ₹1L LTCG. Old code: 37% × entire tax including LTCG.
      // New: 15% cap applies to LTCG's share of tax.
      const s = computeSurcharge(1000000, 55000000, 'new', { specialRateTax: 15000 });
      // Regular-tax portion (985000) gets 25%. LTCG-tax portion (15000) gets 15%.
      // Expected: 25% × 985000 + 15% × 15000 = 246250 + 2250 = 248500
      approx(s, 248500, 'surcharge respects 15% cap on 111A/112A tax portion');
    }
  });
});

describe('[H10] 80D cap depends on senior status', () => {
  it('holds', () => {
    {
      approx(
        effectiveDeductionCap('80D', { selfSenior: false, parentsSenior: false }),
        50_000,
        '80D non-senior+non-senior parents = 50k',
      );
      approx(
        effectiveDeductionCap('80D', { selfSenior: false, parentsSenior: true }),
        75_000,
        '80D non-senior + senior parents = 75k',
      );
      approx(
        effectiveDeductionCap('80D', { selfSenior: true, parentsSenior: true }),
        100_000,
        '80D both senior = 100k',
      );
      approx(effectiveDeductionCap('80C', {}), 150_000, '80C untouched');
    }
  });
});

describe('[M6] 234B uses calendar months (not 30-day months)', () => {
  it('holds', () => {
    {
      // v1.10.31 — Test now specifies fy so compute234BInterest picks the
      // correct April-1 anchor (was hardcoded to 2025-04-01; now FY-relative).
      const sched = { applies: true, netLiability: 100000, totalPaid: 0, fy: '2024-25' };
      // 1-Apr-2025 to 31-May-2025 = 2 calendar months. 1% × 2 × 100000 = 2000.
      const int234b = compute234BInterest(sched, '2025-05-31');
      approx(int234b, 2000, 'Apr-1 to May-31 = 2 calendar months → 2000');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // v1.10.31 — Audit-driven test cases. Every Critical/High tax finding from
    // the July 2026 comprehensive audit gets a regression test here.
    // ═══════════════════════════════════════════════════════════════════════════
  });
});

describe('[V31-C2] FY 25-26 new regime — Budget 2025 slabs + ₹60k rebate at ₹12L', () => {
  it('holds', () => {
    {
      // Salaried ₹12L income, new regime FY 25-26. Correct tax = ₹0 after 87A.
      const r = computeTax({ salary: 1_275_000, regime: 'new', fy: '2025-26' });
      approx(
        r.totalTax,
        0,
        '₹12.75L salary FY 25-26 new regime → ₹0 tax (75k std ded + 60k rebate on ₹12L)',
      );
      // Above the ₹12L threshold: normal slab tax kicks in.
      const r2 = computeTax({ salary: 1_400_000, regime: 'new', fy: '2025-26' });
      truthy(r2.totalTax > 0, '₹14L salary above rebate threshold → some tax');
    }
  });
});

describe('[V31-C4] Capital gains rates — post-July-2024 (STCG 20%, LTCG 12.5%, exempt ₹1.25L)', () => {
  it('holds', () => {
    {
      const cg = getCapitalGainsConfig('2025-26');
      approx(cg.stcgRate, 0.2, 'STCG rate FY 25-26 = 20% (Finance No.2 Act 2024)');
      approx(cg.ltcgRate, 0.125, 'LTCG rate FY 25-26 = 12.5%');
      approx(cg.ltcgExemption, 125_000, 'LTCG exemption FY 25-26 = ₹1.25L');
      // ₹10L LTCG at 12.5% over ₹1.25L exemption = ₹1,09,375
      const r = computeTax({ ltcgAtSpecialRate: 1_000_000, regime: 'new', fy: '2025-26' });
      approx(r.ltcgTax, 109_375, '₹10L LTCG → ₹1,09,375 tax at 12.5% over ₹1.25L exempt');
      // ₹5L STCG at 20% = ₹1,00,000
      const r2 = computeTax({ stcgAtSpecialRate: 500_000, regime: 'new', fy: '2025-26' });
      approx(r2.stcgTax, 100_000, '₹5L STCG → ₹1,00,000 tax at 20%');
    }
  });
});

describe('[V31-C1] 15% surcharge cap on 111A/112A gains now wired through computeTax', () => {
  it('holds', () => {
    {
      // ₹5.5Cr salary + ₹10L LTCG. New regime tier at ₹5.5Cr is 25%.
      // LTCG tax (post exempt): (10L - 1.25L) × 12.5% = ~₹1,09,375
      // Slab tax on ₹5.5Cr: ~₹1,63,20,000. Surcharge = slab × 25% + LTCG × 15%.
      const r = computeTax({
        salary: 55_000_000,
        ltcgAtSpecialRate: 1_000_000,
        regime: 'new',
        fy: '2025-26',
      });
      // Without wiring: surcharge would be 25% on LTCG tax too. Now capped at 15%.
      // The specific ratio: specialRateTax = ₹1,09,375. Its surcharge = 15% × 1,09,375 = ₹16,406.
      // Meanwhile slab-tax-portion surcharge is at 25%. Total surcharge should
      // reflect the blend.
      truthy(r.specialRateTax > 0, 'specialRateTax populated (₹1L+ from LTCG)');
      truthy(r.surcharge > 0, 'surcharge computed');
      // Direct check: computeSurcharge with specialRateTax = specialRateTax
      const specialSurcharge = computeSurcharge(r.specialRateTax, 55_000_000, 'new', {
        specialRateTax: r.specialRateTax,
      });
      approx(
        specialSurcharge,
        r.specialRateTax * 0.15,
        '15% cap on specialRateTax portion honored',
      );
    }
  });
});

describe('[V31-C3] Advance-tax due dates are FY-relative', () => {
  it('holds', () => {
    {
      const s2526 = getAdvanceTaxSchedule('2025-26');
      eq(s2526[0].dueDate, '2025-06-15', 'FY 25-26 Q1 due = 15 Jun 2025');
      eq(s2526[3].dueDate, '2026-03-15', 'FY 25-26 Q4 due = 15 Mar 2026');
      const s2425 = getAdvanceTaxSchedule('2024-25');
      eq(s2425[0].dueDate, '2024-06-15', 'FY 24-25 Q1 due = 15 Jun 2024');
      // Filter test: FY 25-26 filer paying 2025-06-14 → counted for Q1.
      const sched = computeAdvanceTaxSchedule(
        500_000,
        0,
        [{ date: '2025-06-14', amount: 75_000 }],
        'regular',
        '2025-26',
      );
      approx(
        sched.schedule[0].totalPaidByDue,
        75_000,
        'FY 25-26 payment 2025-06-14 counts toward Q1',
      );
    }
  });
});

describe('[V31-H1] effectiveDeductionCap wired into computeAllowedDeductions', () => {
  it('holds', () => {
    {
      // Non-senior with non-senior parents claiming ₹1L for 80D. Statute cap = ₹50k.
      const total = computeAllowedDeductions({ '80D': 100_000 }, 'old', {
        selfSenior: false,
        parentsSenior: false,
      });
      approx(total, 50_000, 'Non-senior 80D capped at ₹50k (not ₹1L which was the static max)');
      // Senior claiming ₹1L for 80D — allowed the full ₹1L (self ₹50k + parents ₹50k).
      const total2 = computeAllowedDeductions({ '80D': 100_000 }, 'old', {
        selfSenior: true,
        parentsSenior: true,
      });
      approx(total2, 100_000, 'Both senior 80D allows full ₹1L');
    }
  });
});

describe('[V31-H5] 80CCD(2) capped at 10% of salary (14% for govt)', () => {
  it('holds', () => {
    {
      // Salary ₹10L, claiming ₹5L employer NPS. Cap should be ₹1L (10%).
      const total = computeAllowedDeductions({ '80CCD2': 500_000 }, 'new', { salary: 1_000_000 });
      approx(total, 100_000, '80CCD(2) private-sector capped at 10% of salary');
      const total2 = computeAllowedDeductions({ '80CCD2': 500_000 }, 'new', {
        salary: 1_000_000,
        isGovtEmployee: true,
      });
      approx(total2, 140_000, '80CCD(2) govt-sector capped at 14% of salary');
      // Excessive claim without salary context → 0 allowed (no cap basis).
      const total3 = computeAllowedDeductions({ '80CCD2': 500_000 }, 'new', {});
      approx(total3, 0, '80CCD(2) without salary context → 0 allowed (safe default)');
    }
  });
});

describe('[V31-H6] Senior / super-senior old-regime basic exemption slabs', () => {
  it('holds', () => {
    {
      const senior = getOldRegimeSlabs(65);
      eq(senior[0].upto, 300_000, 'Senior (60-80) first slab up to ₹3L');
      const superSenior = getOldRegimeSlabs(85);
      eq(superSenior[0].upto, 500_000, 'Super senior (80+) first slab up to ₹5L');
      const regular = getOldRegimeSlabs(30);
      eq(regular[0].upto, 250_000, 'Regular (<60) first slab up to ₹2.5L');
      // Senior with ₹3L income old regime → ₹0 tax (was ₹2,500 before fix).
      const r = computeTax({ salary: 300_000, regime: 'old', fy: '2025-26', age: 65 });
      approx(r.slabTax, 0, 'Senior with ₹3L salary → ₹0 slab tax');
    }
  });
});

describe('[V31-H2] 87A eligibility uses TOTAL income including capital gains', () => {
  it('holds', () => {
    {
      // Old regime, salary ₹5.3L → after ₹50k std ded = ₹4.8L slab-taxable.
      // Plus ₹50k LTCG → total income under Section 2(45) = ₹5.3L > ₹5L threshold.
      // Rebate must be DENIED. Note: LTCG is counted at gross (₹50k), not
      // post-exemption ₹0, because Section 87A eligibility uses total income
      // per Section 2(45), which includes gross capital gains.
      const r = computeTax({
        salary: 530_000,
        ltcgAtSpecialRate: 50_000,
        regime: 'old',
        fy: '2025-26',
      });
      approx(r.rebate87A, 0, '₹5.3L salary + ₹50k LTCG → total ₹5.3L > ₹5L → 87A rebate DENIED');
      // Same salary, no capital gains → total ₹4.8L < ₹5L → rebate applies.
      const r2 = computeTax({ salary: 530_000, regime: 'old', fy: '2025-26' });
      truthy(r2.rebate87A > 0, '₹5.3L salary alone → total ₹4.8L → 87A rebate applies');
    }
  });
});

describe('[V31-H3] Marginal relief on surcharge crossings', () => {
  it('holds', () => {
    {
      // Income ₹50,00,010 old regime. Base tax (before surcharge) ~₹13,12,503.
      // Without relief: 10% surcharge = ~₹1,31,250. That's ₹1.3L extra tax for
      // ₹10 extra income — reduced to ₹10 by marginal relief.
      const tax_at_5cr = 1_312_500; // rough
      const sr = computeSurcharge(tax_at_5cr, 5_000_010, 'old');
      // Marginal relief caps surcharge at delta between thresholds. Actual value
      // depends on exact tax — we just verify it's WAY under ₹1.3L.
      truthy(
        sr < 50_000,
        `Marginal relief at ₹50,00,010 caps surcharge (got ₹${sr.toFixed(0)}, way under raw ₹1,31,250)`,
      );
    }
  });
});

describe('[V31-H4] Rule 119A ₹100 rounding on 234B shortfall', () => {
  it('holds', () => {
    {
      // Shortfall = ₹1,49,999 → round down to ₹1,49,900.
      // At 1% × 2 months → ₹2,998 (not ₹2,999.98).
      const sched = { applies: true, netLiability: 149_999, totalPaid: 0, fy: '2024-25' };
      const int234b = compute234BInterest(sched, '2025-05-31');
      approx(int234b, 2998, 'Rule 119A: shortfall ₹1,49,999 → interest on ₹1,49,900');
    }
  });
});

describe('[V31-M2] Section 234A — late-filing interest', () => {
  it('holds', () => {
    {
      // FY 25-26 (due 31-Jul-2026). Filed 15-Aug-2026 → 1 month at 1%.
      // Outstanding ₹1L → interest = 100_000 × 0.01 × 1 = ₹1,000.
      const int1 = compute234AInterest(100_000, 0, '2026-08-15', undefined, '2025-26');
      approx(int1, 1000, '₹1L outstanding, 15 days late (rounded to 1 month) → ₹1,000');
      // Filed exactly on due date → ₹0.
      const int2 = compute234AInterest(100_000, 0, '2026-07-31', undefined, '2025-26');
      approx(int2, 0, 'Filed on due date → no 234A');
      // Filed 3 months + 1 day late → 4 months × 1% × ₹1L = ₹4,000.
      const int3 = compute234AInterest(100_000, 0, '2026-11-01', undefined, '2025-26');
      approx(int3, 4000, '3m+1d late (Rule 119A: rounds up to 4 months) → ₹4,000');
      // Taxes fully paid via TDS + advance → no outstanding → no 234A.
      const int4 = compute234AInterest(100_000, 100_000, '2026-08-15', undefined, '2025-26');
      approx(int4, 0, 'Zero outstanding (fully paid via TDS/advance) → no 234A');
      // Rule 119A rounding — ₹1,49,999 outstanding → interest on ₹1,49,900.
      const int5 = compute234AInterest(149_999, 0, '2026-08-15', undefined, '2025-26');
      approx(int5, 1499, 'Rule 119A: ₹1,49,999 rounded down to ₹1,49,900 for interest calc');
      // Explicit dueDate override (audit case, 31-Oct-2026).
      const int6 = compute234AInterest(100_000, 0, '2026-11-15', '2026-10-31', '2025-26');
      approx(int6, 1000, 'Audit case: due 31-Oct, filed 15-Nov → 1 month');
    }
  });
});

describe('[V31-M3] §44AE parity — isEligible, negative clamp, declared-below-deemed', () => {
  it('holds', () => {
    {
      // 2 heavy vehicles × 12 tonnes × 12 months → ₹2,88,000 deemed.
      const ok = compute44AE({
        heavyVehicleMonths: 24,
        heavyVehicleTonnage: 12,
        lightVehicleMonths: 0,
      });
      eq(ok.isEligible, true, 'Small fleet within 10-vehicle cap → eligible');
      approx(ok.deemedIncome, 288_000, '2 vehicles × 12t × 12m × ₹1,000 = ₹2,88,000');
      // 11 heavy vehicles × 12 months → 132 vehicle-months → implied fleet 11 > 10.
      const over = compute44AE({
        heavyVehicleMonths: 132,
        heavyVehicleTonnage: 15,
        lightVehicleMonths: 0,
      });
      eq(over.isEligible, false, 'Implied fleet > 10 → NOT eligible');
      truthy(
        over.notes.some((n) => /fleet.*10/i.test(n)),
        'Note explains the 10-vehicle disqualifier',
      );
      // Negative input is clamped to 0 (was silently producing negative income).
      const neg = compute44AE({
        heavyVehicleMonths: -5,
        heavyVehicleTonnage: 15,
        lightVehicleMonths: 0,
      });
      approx(neg.deemedIncome, 0, 'Negative vehicle-months clamped to 0');
      // Declared income below deemed → warning added.
      const under = compute44AE({
        heavyVehicleMonths: 24,
        heavyVehicleTonnage: 12,
        lightVehicleMonths: 0,
        declaredIncome: 100_000,
      });
      truthy(
        under.notes.some((n) => /less than the presumptive minimum/i.test(n)),
        'Warns when declared < deemed',
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.10.66 (#61) — IGST vs CGST + SGST, and the flag the invoice relies on.
    // The printed tax rows now follow `isInterstate` from these totals, so the
    // flag has to be right in every case the rows can be asked to describe.
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[V67-#66] Sales documents, credit notes and cancelled invoices', () => {
  it('holds', () => {
    {
      const doc = (invoiceType, status) => ({ invoiceType, status });
      eq(salesSign(doc('tax-invoice', 'unpaid')), 1, 'A tax invoice is a sale');
      eq(salesSign(doc('bill-of-supply', 'paid')), 1, 'A bill of supply is a sale');
      eq(salesSign(doc('composition', 'paid')), 1, 'A composition bill of supply is a sale');
      eq(salesSign(doc('credit-note', 'unpaid')), -1, 'A credit note takes money back off sales');
      eq(salesSign(doc('proforma', 'unpaid')), 0, 'A proforma is a quote, not a sale');
      eq(salesSign(doc('delivery-challan', 'unpaid')), 0, 'A delivery challan sells nothing');
      eq(salesSign(doc('tax-invoice', 'cancelled')), 0, 'A cancelled invoice counts for nothing');
      eq(
        salesSign(doc('credit-note', 'cancelled')),
        0,
        'A cancelled credit note counts for nothing either',
      );
      eq(
        salesSign({ status: 'unpaid' }),
        1,
        'A bill with no type recorded is treated as a tax invoice',
      );
      truthy(
        isCancelledBill({ status: 'cancelled' }),
        'isCancelledBill spots the cancelled status',
      );
      truthy(!isCancelledBill({ status: 'overdue' }), 'and leaves every other status alone');
      eq(getDefaultUnitForMode('goods'), 'Pcs', 'Goods default to Pcs (#66 item 2)');
      eq(getDefaultUnitForMode('mixed'), 'Pcs', 'Mixed invoices default to Pcs too');
      eq(getDefaultUnitForMode('services'), 'Hrs', 'Services still default to Hrs');
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.10.68 (#68) — what a GSTIN says on its own, with no API key and no
    // internet. The state it names decides place of supply, so a wrong one
    // silently swaps CGST + SGST for IGST on every invoice to that client.
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[V70-ERR-024] Where a PDF page may end', () => {
  it('holds', () => {
    {
      // The footer from the reported invoice, in pixels from the top:
      //   left column:  bank details 1000-1150, terms 1150-1400
      //   right column: signature block 1000-1250, stamp image 1080-1220
      const edges = [0, 1000, 1150, 1250, 1400];
      const keepWhole = [
        [1000, 1150],
        [1150, 1400],
        [1000, 1250],
        [1080, 1220],
      ];
      const safe = safePageBoundaries(edges, keepWhole);
      truthy(
        !safe.includes(1150),
        'The gap between bank details and terms is NOT a place to break - the stamp is beside it',
      );
      truthy(
        !safe.includes(1250),
        'Nor is the bottom of the signature block, while terms still run beside it',
      );
      eq(
        safe,
        [0, 1000, 1400],
        'Only the top of the footer and the bottom of the whole footer are safe',
      );

      // Items-table rows sit edge to edge; every row edge must stay usable.
      const rows = [
        [100, 150],
        [150, 200],
        [200, 250],
      ];
      eq(
        safePageBoundaries([100, 150, 200, 250], rows),
        [100, 150, 200, 250],
        'Row edges between adjacent rows are all still safe',
      );

      eq(
        safePageBoundaries([0, 300, 300, 600], []),
        [0, 300, 600],
        'Duplicates are dropped and the list is sorted',
      );
      eq(
        safePageBoundaries([500], [[400, 401]]),
        [500],
        'Zero-height spans (hidden elements) are ignored',
      );
    }

    // ─────────────────────────────────────────────────────────────────────
    // v1.10.71 - fixes found while writing the documentation
    // ─────────────────────────────────────────────────────────────────────
  });
});

describe('[V71] GST rates and the B2C Large limit', () => {
  it('holds', () => {
    {
      eq(b2clThreshold('2024-07-31'), 250000, 'Before 1 Aug 2024 B2C Large starts above ₹2.5 lakh');
      eq(b2clThreshold('2024-08-01'), 100000, 'From 1 Aug 2024 it starts above ₹1 lakh');
      truthy(GST_PORTAL_RATES.includes(40), 'The GSTR-1 export accepts the 40% rate');
      truthy(getCountryConfig('India').taxRates.includes(40), 'Invoices offer the 40% rate');
    }
  });
});

describe('[V71] Marking an invoice paid records the balance as a payment', () => {
  it('holds', () => {
    {
      const p = markPaidPatch({ totalAmount: 1000, payments: [{ amount: 400 }] });
      eq(p.paidAmount, 1000, 'Paid amount becomes the total');
      eq(p.payments.length, 2, 'One payment is added');
      eq(p.payments[1].amount, 600, 'For exactly the balance');
      truthy(!!p.payments[1].id, 'With an id, so its receipt gets a real number');
      eq(
        markPaidPatch({ totalAmount: 1000, payments: [{ amount: 1000 }] }).payments.length,
        1,
        'Nothing added when already fully paid',
      );
    }
  });
});

describe('[V71] Income tax: bank categories and the ITR-4 80D line', () => {
  it('holds', () => {
    {
      const cat = (d) => (AUTO_CATEGORY_RULES.find((r) => r.pattern.test(d)) || {}).category;
      eq(cat('OFFICE RENT SEPT'), 'business_out', 'Office rent is an expense, not rent received');
      eq(
        cat('NEFT RENT FROM TENANT'),
        'rent_received',
        'Rent from a tenant is still rent received',
      );
      const inputs = {
        salary: 1200000,
        deductions: { '80D': 90000 },
        age: 0,
        parentsSenior: false,
      };
      const row = buildITR4FieldMap(
        inputs,
        computeTax({ ...inputs, regime: 'old' }),
        null,
        inputs.deductions,
      ).find((r) => r.field.startsWith('§80D'));
      eq(row.value, 50000, 'The PDF shows the same ₹50,000 limit the tax used (was ₹1 lakh)');
      const senior = { ...inputs, age: 60, selfSenior: true, parentsSenior: true };
      const row2 = buildITR4FieldMap(
        senior,
        computeTax({ ...senior, regime: 'old' }),
        null,
        senior.deductions,
      ).find((r) => r.field.startsWith('§80D'));
      eq(row2.value, 90000, 'Senior self and parents allow up to ₹1 lakh, so all 90,000 counts');
    }
  });
});

describe('[V73] Customize options, order details, Quotation, docs links', () => {
  it('holds', () => {
    {
      eq(invoiceOptionOn({}, 'showLogo'), true, 'An option never saved is on by default');
      eq(invoiceOptionOn({}, 'showRoundOff'), false, 'Round-off is off unless chosen');
      eq(
        invoiceOptionOn({ pdfStyle: 'tally' }, 'showHsnSummary'),
        true,
        'Tally style shows the HSN summary by default',
      );
      eq(
        invoiceOptionOn({ pdfStyle: 'classic' }, 'showHsnSummary'),
        false,
        'Other designs do not, unless chosen',
      );
      eq(
        invoiceOptionOn({ pdfStyle: 'tally', showHsnSummary: false }, 'showHsnSummary'),
        false,
        'A saved choice always wins',
      );
      // The first click must flip what the box shows (it took two clicks for never-saved options).
      const flipped = { showBusinessName: !invoiceOptionOn({}, 'showBusinessName') };
      eq(
        invoiceOptionOn(flipped, 'showBusinessName'),
        false,
        'One click turns a default-on option off',
      );

      eq(formatShortDate('2026-08-31'), '31-Aug-26', 'Dates print the Tally way');
      const od = filledOrderDetails({
        buyerOrderNo: ' PO/118 ',
        vehicleNo: '',
        buyerOrderDate: '2026-08-02',
      });
      eq(
        od.map((f) => [f.key, f.value]),
        [
          ['buyerOrderNo', 'PO/118'],
          ['buyerOrderDate', '02-Aug-26'],
        ],
        'Only filled order details print, dates formatted',
      );

      eq(INVOICE_TYPES.quotation.prefix, 'QUO', 'Quotations number as QUO');
      eq(salesSign({ invoiceType: 'quotation', totalAmount: 100 }), 0, 'A quotation is not a sale');

      eq(
        docsLink('invoices#toolbar'),
        'https://ledgora.com/free-gst-software-documentation/invoices.html#toolbar',
        'Help links go to the docs section',
      );
      eq(
        docsLink('index'),
        'https://ledgora.com/free-gst-software-documentation/',
        'The docs home link',
      );
      eq(
        TCS_SECTIONS.some((t) => t.code === '206C(1H)'),
        false,
        '206C(1H) (omitted from 1 April 2025) is not offered on new invoices',
      );
    }
  });
});

describe('[V77] #86 choosing Unpaid takes back the "Paid" payment', () => {
  it('holds', () => {
    {
      const bill = { totalAmount: 2778, payments: [] };
      const paid = { ...bill, ...markPaidPatch(bill) };
      eq(
        paid.payments.length === 1 && paid.payments[0].auto === true,
        true,
        'Choosing Paid records one payment, marked as automatic',
      );
      eq(
        markUnpaidPatch(paid),
        { payments: [], paidAmount: 0, status: 'unpaid' },
        'Choosing Unpaid removes it: nothing paid, reminder shows again',
      );
      const legacy = {
        totalAmount: 2778,
        payments: [{ amount: 2778, note: 'Marked paid (bulk)', mode: 'other' }],
      };
      eq(
        markUnpaidPatch(legacy).paidAmount,
        0,
        'Also for a "Marked paid" payment saved before v1.10.77',
      );
      const withReceipt = {
        totalAmount: 1000,
        payments: [
          { amount: 400, receiptNo: 'RCT/1', mode: 'upi' },
          { amount: 600, note: 'Marked paid', auto: true },
        ],
      };
      eq(
        markUnpaidPatch(withReceipt).paidAmount === 400 && markUnpaidPatch(withReceipt).status,
        'partial',
        'A payment with a receipt is kept, so it becomes Partial',
      );
      const edited = {
        totalAmount: 500,
        payments: [{ amount: 500, note: 'Marked paid', mode: 'other', auto: false }],
      };
      eq(
        markUnpaidPatch(edited).paidAmount,
        500,
        'A Marked paid payment you edited is yours now: kept',
      );
      const typed = {
        totalAmount: 500,
        payments: [{ amount: 500, note: 'Marked paid by cheque', mode: 'cheque' }],
      };
      eq(
        markUnpaidPatch(typed).paidAmount,
        500,
        'A payment you noted "Marked paid" yourself (not mode other) is kept',
      );
    }
  });
});

describe('[V77] #84 duplicate business profiles, terms line breaks', () => {
  it('holds', () => {
    {
      const saved = [
        { id: 'a', businessName: 'Anant Exports', gstin: '09AABCU9355J1ZS' },
        { id: 'b', businessName: 'Kaveri Stationers', gstin: '' },
      ];
      eq(
        findSameBusiness(saved, { businessName: 'ANANT EXPORTS PVT', gstin: '09aabcu9355j1zs' })
          ?.id,
        'a',
        'Same GSTIN under another spelling is the same business',
      );
      eq(
        findSameBusiness(saved, { businessName: '  kaveri   stationers ', gstin: '' })?.id,
        'b',
        'No GSTIN: the same name (case and spaces ignored)',
      );
      eq(
        findSameBusiness(saved, { businessName: 'Anant Exports', gstin: '27AAAAA0000A1Z5' }),
        null,
        'Same name but a different GSTIN is a different business',
      );
      eq(
        findSameBusiness(saved, { businessName: 'Anant Exports', gstin: '' }),
        null,
        'No GSTIN never overwrites a saved profile that has one',
      );
      eq(
        findSameBusiness(
          saved,
          { businessName: 'Anant Exports', gstin: '09AABCU9355J1ZT' },
          saved[0],
        )?.id,
        'a',
        'Loaded profile with a corrected GSTIN typo: that profile is updated',
      );
      eq(
        splitNumberedTerms('* Warranty by the maker.\n* Subject to Delhi only.'),
        '* Warranty by the maker.<br />* Subject to Delhi only.',
        'Plain-text terms keep their line breaks',
      );
      eq(
        splitNumberedTerms('<p>a</p>\n<p>b</p>'),
        '<p>a</p>\n<p>b</p>',
        'Formatted terms are left as they are',
      );
    }
  });
});

describe('[V77] #87 delivery charges, #85 Excel export', () => {
  it('holds', () => {
    {
      const line = deliveryChargeLine(
        [{ taxPercent: 5 }, { taxPercent: 18 }, { taxPercent: 12, isCharge: true }],
        150,
      );
      eq(
        [line.name, line.hsn, line.rate, line.taxPercent, line.isCharge, line.productId],
        ['Delivery charges', '996812', 150, 18, true, undefined],
        'Delivery charges: SAC 996812, taxed at the highest goods rate, never stock',
      );
      eq(deliveryChargeLine([]).taxPercent, 18, 'With no goods yet it starts at 18%');
      const t = computeInvoiceTotals({
        items: [
          { quantity: 2, rate: 500, taxPercent: 12 },
          deliveryChargeLine([{ taxPercent: 12 }], 100),
        ],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: { placeOfSupply: 'Punjab' },
        showGST: true,
      });
      approx(t.total, 1232, 'It is in the invoice total with its GST (1,000 + 100 + 12%)');

      eq(
        [colName(0), colName(25), colName(26), colName(701)],
        ['A', 'Z', 'AA', 'ZZ'],
        'Excel column letters',
      );
      const files = unzipSync(
        buildXlsx(
          [
            ['Party', 'Total'],
            ['A & B <Traders>', 1234.5],
            ['=SUM(1)', 0],
          ],
          'Party Outstanding',
        ),
      );
      const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
      eq(
        [
          '[Content_Types].xml',
          '_rels/.rels',
          'xl/workbook.xml',
          'xl/_rels/workbook.xml.rels',
          'xl/styles.xml',
          'xl/worksheets/sheet1.xml',
        ].every((f) => files[f]),
        true,
        'The .xlsx has every part Excel needs',
      );
      eq(
        sheet.includes('<c r="B2"><v>1234.5</v></c>'),
        true,
        'Numbers are stored as numbers (Excel can total them)',
      );
      eq(sheet.includes('A &amp; B &lt;Traders&gt;'), true, 'Text is escaped');
      eq(
        sheet.includes('<t xml:space="preserve">=SUM(1)</t>'),
        true,
        'Text that looks like a formula stays text, never a formula',
      );
      eq(sheet.includes('<c r="A1" t="inlineStr" s="1">'), true, 'Header row is bold');
    }
  });
});

describe('[V77] #85 bulk product edit, closing stock', () => {
  it('holds', () => {
    {
      const pen = {
        id: 'p1',
        name: 'Pen',
        hsn: '9608',
        purchasePrice: 5,
        sellingPrice: 10,
        rate: 10,
        taxPercent: 18,
        unit: 'Nos',
        stock: 50,
      };
      const ok = bulkRowToProduct(pen, { sellingPrice: '12', stock: '40' });
      eq(
        [ok.product.sellingPrice, ok.product.rate, ok.product.stock, ok.product.id, ok.product.hsn],
        [12, 12, 40, 'p1', '9608'],
        'Bulk edit: typed numbers saved as numbers, selling price mirrored to rate, id kept',
      );
      eq(!!bulkRowToProduct(pen, { name: '  ' }).error, true, 'Bulk edit: a blank name is refused');
      eq(
        !!bulkRowToProduct(pen, { taxPercent: '150' }).error,
        true,
        'Bulk edit: GST % over 100 is refused',
      );
      eq(
        !!bulkRowToProduct(pen, { stock: 'abc' }).error,
        true,
        'Bulk edit: stock that is not a number is refused',
      );
      eq(
        bulkRowToProduct({ id: 'x', name: 'Old', rate: 7 }, { hsn: '1' }).product.sellingPrice,
        7,
        'Bulk edit: an old product with only rate keeps its price',
      );

      const products = [
        { id: 'p1', name: 'Pen', stock: 50 },
        { id: 'p2', name: 'Ink', stock: 3 },
      ];
      const bills = [
        { invoiceDate: '2026-09-20', status: 'paid', data: { stockApplied: { p1: -10 } } },
        { invoiceDate: '2026-10-05', status: 'paid', data: { stockApplied: { p1: -5, p2: -1 } } },
        { invoiceDate: '2026-10-06', status: 'cancelled', data: { stockApplied: {} } },
      ];
      const purchases = [
        { date: '2026-10-02', items: [{ name: ' pen ', quantity: 20 }] },
        { date: '2026-09-01', items: [{ name: 'Ink', quantity: 4 }] },
      ];
      const sep = closingStock(products, bills, purchases, '2026-09-30');
      eq(
        [sep.get('p1'), sep.get('p2')],
        [35, 4],
        'Closing stock 30 Sep: later purchases taken off, later sales added back (50 - 20 + 5; 3 + 1)',
      );
      eq(
        closingStock(products, bills, purchases, '2026-10-31').get('p1'),
        50,
        'Closing stock today equals current stock',
      );
      eq(
        stockValueOf({ purchasePrice: 5, sellingPrice: 10 }, 35),
        { price: 5, value: 175, atCost: true },
        'Stock is valued at purchase price',
      );
      eq(
        stockValueOf({ sellingPrice: 10 }, 3),
        { price: 10, value: 30, atCost: false },
        'No purchase price: valued at selling price, marked',
      );
    }
  });
});

describe('[V79] GST 16-character numbers, short year, portal state names, saved PDF names', () => {
  it('holds', () => {
    {
      const fy = '2026-27';
      eq(
        numberFormatProblem({}, { fyLabel: fy }),
        '',
        'Default INV/2026-27/0001 (16) and CN/2026-27/0001 fit the GST limit',
      );
      eq(
        /Credit Note .* 18 characters/.test(
          numberFormatProblem({ brandPrefix: 'XY' }, { fyLabel: fy }),
        ),
        true,
        'Brand XY: XY-CN/2026-27/0001 is 18 characters and is refused',
      );
      eq(
        numberFormatProblem({ brandPrefix: 'XY', fyStyle: 'short' }, { fyLabel: fy }),
        '',
        'With the short year it fits: XY-CN/26-27/0001 (16)',
      );
      eq(
        formatDocNumber({
          settings: { brandPrefix: 'KS', fyStyle: 'short' },
          typePrefix: 'CN',
          next: 7,
          fyLabel: fy,
        }),
        'KS-CN/26-27/0007',
        'Short year writes 26-27',
      );
      eq(
        /ACME\/2026-27\/0001/.test(numberFormatProblem({ brandPrefix: 'ACME' }, { fyLabel: fy })),
        true,
        'A 4-letter brand with the full year is already too long for a tax invoice',
      );
      eq(
        /does not accept "#"/.test(numberFormatProblem({ separator: '#' }, { fyLabel: fy })),
        true,
        'The # separator is refused (the portal rejects it)',
      );
      eq(
        /12345/.test(numberFormatProblem({}, { fyLabel: fy, nextInvoice: 12345 })),
        true,
        'Past 9999 the number grows to 17 characters and is flagged',
      );
      eq(
        numberFormatProblem(
          { brandPrefix: 'KS' },
          { fyLabel: fy, own: true, customPrefixes: { 'tax-invoice': 'VERYLONGPREFIX' } },
        ).includes('VERYLONG'),
        false,
        'An own series ignores Print Settings per-type prefixes',
      );
      eq(
        [placeOfSupplyLabel('01'), placeOfSupplyLabel('26'), placeOfSupplyLabel('97')],
        ['01-Jammu & Kashmir', '26-Dadra & Nagar Haveli & Daman & Diu', '97-Other Territory'],
        'Places of supply spelt as on the GST portal',
      );
      eq(
        savedPdfNameFor({
          invoiceNumber: 'INV/2026-27/0007',
          invoiceType: 'tax-invoice',
          data: { client: { name: 'Meera' } },
        }),
        { fileName: 'INV_INV-2026-27-0007.pdf', clientName: 'Meera' },
        'Saved PDF found under the name the editor saves it with',
      );
      eq(
        savedPdfNameFor({ invoiceNumber: 'CN/2026-27/0002', invoiceType: 'credit-note', data: {} }),
        { fileName: 'CN_CN-2026-27-0002.pdf', clientName: 'General' },
        'A credit note, no client: the General folder',
      );
    }
  });
});

describe('[Audit 2026-10] Math and wiring fixes', () => {
  it('holds', () => {
    {
      eq(
        numberToWords(1500000000),
        'One Hundred and Fifty Crore Rupees Only',
        '₹150 crore in words (was "undefined Crore")',
      );
      eq(
        numberToWords(12345678.9),
        'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight Rupees and Ninety Paise Only',
        'Crore, lakh and paise still read as before',
      );

      // A with-tax discount on a line whose price already includes tax comes off as entered.
      const inclItem = {
        quantity: 1,
        rate: 1180,
        discount: 118,
        discountType: 'fixed',
        discountBase: 'with-tax',
        taxPercent: 18,
        withTaxRule: 2,
      };
      // A line saved before v1.10.80 (no withTaxRule) keeps the old maths, so its
      // GSTR-1 figures and reprints match the total saved with it (₹1,080).
      const oldLine = { ...inclItem, withTaxRule: undefined };
      approx(
        resolveLineDiscount(oldLine, true),
        100,
        'A with-tax discount saved before v1.10.80 is read as before',
      );
      approx(
        computeInvoiceTotals({
          items: [oldLine],
          profile: { country: 'India', state: 'Punjab' },
          client: { state: 'Punjab' },
          details: {},
          showGST: true,
          taxInclusive: true,
        }).total,
        1080,
        'An old saved invoice still totals ₹1,080 (its saved total)',
      );
      approx(
        resolveLineDiscount(inclItem, true),
        118,
        'With-tax discount on a tax-inclusive line: ₹118 off',
      );
      approx(
        resolveLineDiscount({ ...inclItem, rate: 1000 }),
        100,
        'With-tax discount on a tax-exclusive line: tax backed out (₹118 -> ₹100)',
      );
      const inclTotals = computeInvoiceTotals({
        items: [inclItem],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: {},
        showGST: true,
        taxInclusive: true,
      });
      approx(inclTotals.total, 1062, 'Inclusive ₹1,180 less ₹118 with-tax discount = ₹1,062');
      const bos = computeInvoiceTotals({
        items: [{ ...inclItem, rate: 1000 }],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: {},
        showGST: false,
      });
      approx(bos.total, 882, 'Bill of supply (no tax): a with-tax discount comes off as entered');

      // Filing calendar: local dates, March advance tax, this July's ITR, Q4 TDS/TCS returns.
      const due = (today, label) =>
        getUpcomingFilings(today).find((f) => f.label.startsWith(label))?.dueDate;
      eq(
        due(new Date(2026, 9, 1), 'GSTR-3B'),
        '2026-10-20',
        'GSTR-3B due on the 20th (not the 19th, as toISOString gave in India)',
      );
      eq(
        due(new Date(2027, 2, 2), 'Advance Tax Installment 4'),
        '2027-03-15',
        'The 15 March advance-tax instalment shows in early March',
      );
      eq(
        due(new Date(2026, 5, 10), 'ITR filing (non-audit)'),
        '2026-07-31',
        'In June the ITR due this 31 July shows (not next year)',
      );
      eq(
        due(new Date(2026, 3, 5), 'Form 26Q'),
        '2026-05-31',
        'Form 26Q for January-March is due 31 May',
      );
      eq(
        due(new Date(2026, 3, 5), 'Form 27EQ'),
        '2026-05-15',
        'Form 27EQ for January-March is due 15 May',
      );

      eq(parseLocalDate('2026-04-01').getMonth(), 3, 'A YYYY-MM-DD date is read as a local date');
      eq(formatDateGST('2026-04-01'), '01-04-2026', 'GST date format from a local date');

      // TDS: the client pays Net Receivable, so that settles the bill.
      const tdsBill = { totalAmount: 118000, data: { totals: { tdsAmount: 10000 } }, payments: [] };
      eq(amountDue(tdsBill), 108000, 'Amount due = total less TDS');
      eq(
        [
          paymentStatusFor(tdsBill, 108000),
          paymentStatusFor(tdsBill, 50000),
          paymentStatusFor(tdsBill, 0),
        ],
        ['paid', 'partial', 'unpaid'],
        'Paid once Net Receivable is received',
      );
      const marked = markPaidPatch({ ...tdsBill, payments: [{ amount: 8000 }] });
      eq(
        [marked.payments[1].amount, marked.paidAmount],
        [100000, 108000],
        'Mark Paid records the balance of Net Receivable, and paidAmount is what was received',
      );

      // Recurring templates: GST follows the type when the template does not say.
      const tpl = {
        invoiceType: 'bill-of-supply',
        clientName: 'A',
        clientState: 'Punjab',
        items: [{ quantity: 2, rate: 500, taxPercent: 18 }],
      };
      const prof = { country: 'India', state: 'Punjab' };
      eq(templateTotals(tpl, prof).total, 1000, 'A bill-of-supply template charges no GST');
      eq(
        templateTotals({ ...tpl, invoiceType: 'tax-invoice' }, prof).total,
        1180,
        'A tax-invoice template charges GST',
      );
      eq(
        templateTotals({ ...tpl, invoiceType: 'tax-invoice', placeOfSupply: 'Haryana' }, prof).igst,
        180,
        "A template's place of supply decides IGST",
      );

      // E-Way Bill item rates follow the invoice's own split.
      const ewbTotals = computeInvoiceTotals({
        items: [{ quantity: 1, rate: 100, taxPercent: 18 }],
        profile: { country: 'India', state: 'Punjab' },
        client: { state: 'Punjab' },
        details: { placeOfSupply: 'Haryana' },
        showGST: true,
      });
      const ewb = generateEWayBillJSON(
        { country: 'India', state: 'Punjab', pin: '141001' },
        { state: 'Punjab', pin: '141002' },
        { invoiceNumber: 'X', invoiceDate: '2026-10-01' },
        [{ quantity: 1, rate: 100, taxPercent: 18 }],
        ewbTotals,
        'tax-invoice',
      );
      eq(
        [
          ewb.billLists[0].itemList[0].igstRate,
          ewb.billLists[0].itemList[0].cgstRate,
          ewb.billLists[0].igstValue,
        ],
        [18, 0, 18],
        'E-Way Bill item rates match the IGST the invoice charged',
      );
    }
  });
});

describe('[Audit 2026-10] Income tax marginal relief', () => {
  it('holds', () => {
    {
      const t = (inc, regime) => computeTax({ businessIncome: inc, regime, fy: '2025-26' });
      approx(
        t(1_210_000, 'new').totalTax,
        10400,
        '₹12.1L new regime: tax capped at the ₹10,000 above ₹12L, + 4% cess (was ₹63,960)',
      );
      approx(t(1_250_000, 'new').totalTax, 52000, '₹12.5L new regime: ₹50,000 + cess');
      approx(t(1_300_000, 'new').totalTax, 78000, '₹13L: past the relief band, normal slab tax');
      approx(t(530_000, 'old').rebate87A, 0, 'Old regime has no 87A marginal relief');
      const base = t(5_000_000, 'old');
      const over = t(5_010_000, 'old');
      approx(
        over.taxAfterRebate + over.surcharge - (base.taxAfterRebate + base.surcharge),
        10000,
        '₹10,000 over ₹50L: extra tax + surcharge = ₹10,000 (surcharge marginal relief)',
      );
      // §234B: tax paid after 31 March is not advance tax.
      const sched = computeAdvanceTaxSchedule(
        100000,
        0,
        [{ date: '2026-06-10', amount: 100000 }],
        'regular',
        '2025-26',
      );
      approx(
        compute234BInterest(sched, '2026-06-10'),
        3000,
        '234B: ₹1L all paid in June -> 1% x 3 months (paying late no longer wipes it out)',
      );
    }
  });
});
