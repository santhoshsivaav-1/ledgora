// The department's cross-field rules for ITR-4 (CBDT e-Filing, "ITR 4 Validation Rules for AY 2026-27", v1.0, 15 May 2026)
// that a file built by itr4.ts could break, applied to the finished JSON. The numbers in the messages are the rule
// numbers of that document. The schema (itr4Schema.ts) checks the shape of each field; this checks the arithmetic and the
// combinations between fields, which a schema can not.

import type { FilingIssue } from './filing.ts';
import { fyBounds } from './fiscal.ts';
import { itrRulesFor, type ItrYearRules } from './itrRules.ts';

// The file is untyped JSON read field by field; every access is guarded below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;
const n = (v: unknown) => Number(v) || 0;
const sum = (xs: unknown[]) => xs.reduce<number>((s, x) => s + n(x), 0);
const err = (code: string, message: string, path = ''): FilingIssue => ({
  id: path ? `${code}:${path}` : code,
  severity: 'error',
  code,
  message,
  path,
});
const warn = (code: string, message: string, path = ''): FilingIssue => ({
  ...err(code, message, path),
  severity: 'warning',
});

/** Rounding to ten rupees (288A / 288B) can move a figure by up to five. */
const near = (a: number, b: number, tol = 5) => Math.abs(a - b) <= tol;

export function validateItr4Rules(json: unknown, rules?: ItrYearRules): FilingIssue[] {
  const out: FilingIssue[] = [];
  const doc = ((json as Rec)?.ITR?.ITR4 ?? {}) as Rec;
  if (!doc.IncomeDeductions) return [err('ITR4_EMPTY', 'The file has no ITR.ITR4 return')];
  const ay = String(doc.Form_ITR4?.AssessmentYear ?? '2026');
  const r = rules ?? itrRulesFor(`${Number(ay) - 1}-${String(Number(ay)).slice(2)}`);
  const fy = { from: fyBounds(r.fy).start, to: fyBounds(r.fy).end };
  const inc = doc.IncomeDeductions as Rec;
  const tc = (doc.TaxComputation ?? {}) as Rec;
  const tp = (doc.TaxPaid?.TaxesPaid ?? {}) as Rec;
  const old = doc.FilingStatus?.F10IEACurrAYOldRegime === 'Y';
  const bp = doc.ScheduleBP as Rec | undefined;
  const via = (inc.DeductUndChapVIA ?? {}) as Rec;
  const usr = (inc.UsrDeductUndChapVIA ?? {}) as Rec;

  // ---- business income -------------------------------------------------------------------------------------------
  const ad = bp?.PersumptiveInc44AD as Rec | undefined;
  const ada = bp?.PersumptiveInc44ADA as Rec | undefined;
  const presumptive = n(ad?.TotPersumptiveInc44AD) + n(ada?.TotPersumptiveInc44ADA);
  if (n(inc.IncomeFromBusinessProf) > 0 && !bp)
    out.push(
      err('R1', 'Business income is shown but Schedule BP is not filled (rule 1)', 'ScheduleBP'),
    );
  if (n(inc.IncomeFromBusinessProf) !== presumptive && (bp || n(inc.IncomeFromBusinessProf) > 0))
    out.push(
      err(
        'R2',
        `Business income ₹${n(inc.IncomeFromBusinessProf)} differs from Schedule BP ₹${presumptive} (rule 2)`,
        'IncomeFromBusinessProf',
      ),
    );
  if (ad) {
    const bank = n(ad.GrsTrnOverBank);
    const other = n(ad.GrsTotalTrnOverInCash) + n(ad.GrsTrnOverAnyOthMode);
    if (n(ad.GrsTotalTrnOver) !== bank + other)
      out.push(
        err(
          'R240',
          'Gross turnover under 44AD is not the sum of its modes (rule 240)',
          'ScheduleBP.PersumptiveInc44AD',
        ),
      );
    if (n(ad.PersumptiveInc44AD6Per) < Math.ceil((bank * 6) / 100))
      out.push(
        err(
          'R5',
          'Income under 44AD is less than 6% of receipts through banking channels (rule 5)',
          'ScheduleBP.PersumptiveInc44AD',
        ),
      );
    if (n(ad.PersumptiveInc44AD8Per) < Math.ceil((other * 8) / 100))
      out.push(
        err(
          'R6',
          'Income under 44AD is less than 8% of receipts in any other mode (rule 6)',
          'ScheduleBP.PersumptiveInc44AD',
        ),
      );
    if (n(ad.TotPersumptiveInc44AD) !== n(ad.PersumptiveInc44AD6Per) + n(ad.PersumptiveInc44AD8Per))
      out.push(
        err(
          'R7',
          'Presumptive income under 44AD is not the sum of its 6% and 8% parts (rule 7)',
          'ScheduleBP.PersumptiveInc44AD',
        ),
      );
    if (n(ad.TotPersumptiveInc44AD) > n(ad.GrsTotalTrnOver))
      out.push(
        err(
          'R8',
          'Income under 44AD is more than the turnover (rule 8)',
          'ScheduleBP.PersumptiveInc44AD',
        ),
      );
    if (n(ad.GrsTotalTrnOver) > r.presumptive.ad.limitMostlyDigital)
      out.push(
        err(
          'R9',
          'Turnover above ₹3 crore can not be filed in ITR-4 (rule 9)',
          'ScheduleBP.PersumptiveInc44AD',
        ),
      );
    if (
      n(ad.GrsTotalTrnOver) > r.presumptive.ad.limit &&
      other > n(ad.GrsTotalTrnOver) * r.presumptive.cashShare
    )
      out.push(
        err(
          'R237',
          'Turnover above ₹2 crore with cash above 5% needs a tax audit, so ITR-3 (rule 237)',
          'ScheduleBP.PersumptiveInc44AD',
        ),
      );
    if (!bp?.NatOfBus44AD?.length)
      out.push(
        err(
          'R11',
          'Income under 44AD needs the business code (rule 11)',
          'ScheduleBP.NatOfBus44AD',
        ),
      );
  } else if (bp?.NatOfBus44AD?.length)
    out.push(
      err('R12', 'A 44AD business code needs the income under 44AD (rule 12)', 'ScheduleBP'),
    );
  if (ada) {
    const bank = n(ada.GrsTrnOverBank44ADA);
    const other = n(ada.GrsTotalTrnOverInCash44ADA) + n(ada.GrsTrnOverAnyOthMode44ADA);
    if (n(ada.GrsReceipt) !== bank + other)
      out.push(
        err(
          'R239',
          'Gross receipts under 44ADA are not the sum of its modes (rule 239)',
          'ScheduleBP.PersumptiveInc44ADA',
        ),
      );
    if (n(ada.TotPersumptiveInc44ADA) > n(ada.GrsReceipt))
      out.push(
        err(
          'R13',
          'Income under 44ADA is more than the receipts (rule 13)',
          'ScheduleBP.PersumptiveInc44ADA',
        ),
      );
    if (n(ada.TotPersumptiveInc44ADA) < Math.ceil(n(ada.GrsReceipt) / 2))
      out.push(
        err(
          'R14',
          'Income under 44ADA is less than 50% of the receipts (rule 14)',
          'ScheduleBP.PersumptiveInc44ADA',
        ),
      );
    if (
      n(ada.GrsReceipt) > r.presumptive.ada.limit &&
      other > n(ada.GrsReceipt) * r.presumptive.cashShare
    )
      out.push(
        err(
          'R238',
          'Receipts above ₹50 lakh with cash above 5% need a tax audit, so ITR-3 (rule 238)',
          'ScheduleBP.PersumptiveInc44ADA',
        ),
      );
    if (!bp?.NatOfBus44ADA?.length)
      out.push(
        err(
          'R16',
          'Income under 44ADA needs the profession code (rule 16)',
          'ScheduleBP.NatOfBus44ADA',
        ),
      );
  } else if (bp?.NatOfBus44ADA?.length)
    out.push(err('R17', 'A 44ADA code needs the income under 44ADA (rule 17)', 'ScheduleBP'));
  if (!bp)
    out.push(
      err(
        'R140',
        'ITR-4 is filed but no income under 44AD, 44ADA or 44AE is disclosed (rule 140)',
        'ScheduleBP',
      ),
    );
  const fin = bp?.FinanclPartclrOfBusiness as Rec | undefined;
  if (bp && (ad || ada) && (!fin || n(fin.TotalAssets) + n(fin.TotCapLiabilities) === 0))
    out.push(
      warn(
        'R139',
        'Receipts are shown but the financial particulars (debtors, creditors, stock, cash) are empty (rule 139)',
        'ScheduleBP.FinanclPartclrOfBusiness',
      ),
    );
  if (fin) {
    const liab = sum(
      [
        'PartnerMemberOwnCapital',
        'SecuredLoans',
        'UnSecuredLoans',
        'Advances',
        'SundryCreditors',
        'OthrCurrLiab',
      ].map((k) => fin[k]),
    );
    const assets = sum(
      [
        'FixedAssets',
        'Investments',
        'Inventories',
        'SundryDebtors',
        'BalWithBanks',
        'CashInHand',
        'LoansAndAdvances',
        'OtherAssets',
      ].map((k) => fin[k]),
    );
    if (n(fin.TotCapLiabilities) !== liab)
      out.push(
        err(
          'R3',
          'Total capital and liabilities is not the sum of its parts (rule 3)',
          'ScheduleBP.FinanclPartclrOfBusiness',
        ),
      );
    if (n(fin.TotalAssets) !== assets)
      out.push(
        err(
          'R4',
          'Total assets is not the sum of its parts (rule 4)',
          'ScheduleBP.FinanclPartclrOfBusiness',
        ),
      );
  }

  // ---- gross total income and deductions -------------------------------------------------------------------------
  const gti =
    n(inc.IncomeFromBusinessProf) +
    n(inc.IncomeFromSal) +
    n(inc.TotalIncomeChargeableUnHP) +
    n(inc.IncomeOthSrc);
  if (n(inc.GrossTotIncome) !== gti || n(inc.GrossTotIncomeIncLTCG112A) !== gti)
    out.push(
      err(
        old ? 'R49' : 'R196',
        `Gross total income ₹${n(inc.GrossTotIncomeIncLTCG112A)} is not the sum of the heads ₹${gti} (rule ${old ? 49 : 196})`,
        'GrossTotIncome',
      ),
    );
  const othRows = (inc.OthersInc?.OthersIncDtlsOthSrc ?? []) as Rec[];
  if (n(inc.IncomeOthSrc) !== sum(othRows.map((x) => x.OthSrcOthAmount)))
    out.push(
      err('R62', 'Income from other sources is not the sum of its rows (rule 62)', 'IncomeOthSrc'),
    );
  if (n(inc.NetSalary) - n(inc.DeductionUs16) !== n(inc.IncomeFromSal))
    out.push(
      err(
        'R66',
        'Income from salary is not net salary less the deductions under section 16 (rule 66)',
        'IncomeFromSal',
      ),
    );
  for (const [label, k] of [
    ['usr', usr],
    ['allowed', via],
  ] as const) {
    const parts = Object.entries(k).filter(([key]) => key !== 'TotalChapVIADeductions');
    if (n(k.TotalChapVIADeductions) !== sum(parts.map(([, v]) => v)))
      out.push(
        err(
          'R18',
          `Total of Chapter VI-A deductions (${label}) is not the sum of the individual deductions (rule 18)`,
          'DeductUndChapVIA',
        ),
      );
  }
  if (
    !near(
      n(inc.TotalIncome),
      Math.max(0, n(inc.GrossTotIncomeIncLTCG112A) - n(via.TotalChapVIADeductions)),
    )
  )
    out.push(
      err(
        'R46',
        'Total income is not gross total income less the deductions (rule 46)',
        'TotalIncome',
      ),
    );
  if (n(inc.TotalIncome) % 10 !== 0)
    out.push(
      err(
        'R288A',
        'Total income is rounded to the nearest ten rupees (section 288A)',
        'TotalIncome',
      ),
    );
  if (n(inc.TotalIncome) > r.itr4IncomeLimit)
    out.push(
      err(
        'R267',
        'Total income above ₹50 lakh can not be filed in ITR-4 (rule 267)',
        'TotalIncome',
      ),
    );

  const stdCap = old ? r.standardDeduction.old : r.standardDeduction.new;
  if (n(inc.DeductionUs16ia) > stdCap)
    out.push(
      err(
        old ? 'R143' : 'R262',
        `Standard deduction is at most ₹${stdCap} (rule ${old ? 143 : 262})`,
        'DeductionUs16ia',
      ),
    );
  if (n(inc.GrossSalary) > 0 && doc.PersonalInfo?.EmployerCategory === 'NA')
    out.push(
      err(
        'R255',
        'Salary income needs the nature of employment (rule 255)',
        'PersonalInfo.EmployerCategory',
      ),
    );
  if (!old) {
    const other = Object.entries(via).filter(
      ([k]) => !['Section80CCDEmployer', 'AnyOthSec80CCH', 'TotalChapVIADeductions'].includes(k),
    );
    if (other.some(([, v]) => n(v) > 0))
      out.push(
        err(
          'R183',
          'The new regime allows no Chapter VI-A deduction except 80CCD(2) and 80CCH (rules 183, 189-211)',
          'DeductUndChapVIA',
        ),
      );
    if (n(inc.ProfessionalTaxUs16iii) > 0)
      out.push(
        err(
          'R195',
          'Professional tax under 16(iii) is not allowed in the new regime (rule 195)',
          'ProfessionalTaxUs16iii',
        ),
      );
    if (doc.Schedule80C || doc.Schedule80D)
      out.push(
        err(
          'R305',
          'Schedules 80C / 80D are filled but the new regime is chosen (rules 211, 305)',
          'Schedule80C',
        ),
      );
  } else {
    if (n(via.Section80C) + n(via.Section80CCC) + n(via.Section80CCDEmployeeOrSE) > 150_000)
      out.push(
        err('R21', '80C, 80CCC and 80CCD(1) together exceed ₹1,50,000 (rule 21)', 'Section80C'),
      );
    if (n(via.Section80CCD1B) > 50_000)
      out.push(err('R145', '80CCD(1B) is limited to ₹50,000 (rule 145)', 'Section80CCD1B'));
    if (n(via.Section80C) > 0 && !doc.Schedule80C)
      out.push(
        err('R273', 'Section 80C is claimed without Schedule 80C (rule 273)', 'Schedule80C'),
      );
    if (n(via.Section80D) > 0 && !doc.Schedule80D)
      out.push(
        err('R179', 'Section 80D is claimed without Schedule 80D (rule 179)', 'Schedule80D'),
      );
    if (
      doc.Schedule80C &&
      n(doc.Schedule80C.TotalAmt) !==
        sum((doc.Schedule80C.Schedule80CDtls ?? []).map((x: Rec) => x.Amount))
    )
      out.push(
        err('R296', 'Schedule 80C total is not the sum of its rows (rule 296)', 'Schedule80C'),
      );
    if (doc.Schedule80C && n(usr.Section80C) !== n(doc.Schedule80C.TotalAmt))
      out.push(
        err(
          'R290',
          'Section 80C in Chapter VI-A differs from Schedule 80C (rule 290)',
          'Schedule80C',
        ),
      );
    if (
      n(via.Section80D) !==
      n(doc.Schedule80D?.Sec80DSelfFamSrCtznHealth?.EligibleAmountOfDedn ?? via.Section80D)
    )
      out.push(
        err(
          'R178',
          'Section 80D in Chapter VI-A differs from Schedule 80D (rule 178)',
          'Schedule80D',
        ),
      );
  }
  const salary = n(inc.Salary);
  const ccd2Cap = Math.round(
    salary * (!old || ['CGOV', 'SGOV'].includes(doc.PersonalInfo?.EmployerCategory) ? 0.14 : 0.1),
  );
  if (n(via.Section80CCDEmployer) > ccd2Cap)
    out.push(
      err(
        old ? 'R25' : 'R263',
        `80CCD(2) is more than ${!old || ['CGOV', 'SGOV'].includes(doc.PersonalInfo?.EmployerCategory) ? 14 : 10}% of salary (rule ${old ? 25 : 263})`,
        'Section80CCDEmployer',
      ),
    );

  // ---- the tax --------------------------------------------------------------------------------------------------
  if (n(tc.TaxPayableOnRebate) !== n(tc.TotalTaxPayable) - n(tc.Rebate87A))
    out.push(
      err(
        'R52',
        'Tax after rebate is not the tax on total income less the rebate (rule 52)',
        'TaxPayableOnRebate',
      ),
    );
  if (n(tc.GrossTaxLiability) !== n(tc.TaxPayableOnRebate) + n(tc.EducationCess))
    out.push(
      err(
        'R53',
        'Tax and cess is not the sum of tax after rebate and cess (rule 53)',
        'GrossTaxLiability',
      ),
    );
  if (n(tc.NetTaxLiability) !== n(tc.GrossTaxLiability) - n(tc.Section89))
    out.push(
      err(
        'R56',
        'Net tax liability is not tax and cess less the relief under section 89 (rule 56)',
        'NetTaxLiability',
      ),
    );
  const ip = (tc.IntrstPay ?? {}) as Rec;
  if (
    n(tc.TotTaxPlusIntrstPay) !==
    n(tc.NetTaxLiability) +
      n(ip.IntrstPayUs234A) +
      n(ip.IntrstPayUs234B) +
      n(ip.IntrstPayUs234C) +
      n(ip.LateFilingFee234F) +
      n(ip.FeeFurnish234I)
  )
    out.push(
      err(
        'R54',
        'Total tax, fee and interest is not the sum of its parts (rule 54)',
        'TotTaxPlusIntrstPay',
      ),
    );
  if (n(tc.TotalTaxPayable) > 0 && n(inc.GrossTotIncome) === 0)
    out.push(
      err('R124', 'Tax is computed but gross total income is zero (rule 124)', 'TotalTaxPayable'),
    );
  const cfg = old ? r.rebate87A.old : r.rebate87A.new;
  if (n(tc.Rebate87A) > 0) {
    if (
      n(inc.TotalIncome) > cfg.threshold &&
      (old || n(tc.TaxPayableOnRebate) > n(inc.TotalIncome) - cfg.threshold)
    )
      out.push(
        err(
          old ? 'R51' : 'R227',
          `Rebate under 87A is not allowed on a total income of ₹${n(inc.TotalIncome)} (rules 51, 227)`,
          'Rebate87A',
        ),
      );
    if (n(tc.Rebate87A) > cfg.cap)
      out.push(err('R229', `Rebate under 87A is at most ₹${cfg.cap} (rule 229)`, 'Rebate87A'));
  }

  // ---- taxes paid -----------------------------------------------------------------------------------------------
  const it = (doc.ScheduleIT?.TaxPayment ?? []) as Rec[];
  if (doc.ScheduleIT && n(doc.ScheduleIT.TotalTaxPayments) !== sum(it.map((x) => x.Amt)))
    out.push(
      err('R110', 'Schedule IT total is not the sum of its challans (rule 110)', 'ScheduleIT'),
    );
  const advance = sum(
    it.filter((x) => x.DateDep >= fy.from && x.DateDep <= fy.to).map((x) => x.Amt),
  );
  const selfAss = sum(it.filter((x) => x.DateDep > fy.to).map((x) => x.Amt));
  if (n(tp.AdvanceTax) !== advance)
    out.push(
      err(
        'R133',
        'Advance tax is not the challans dated in the year (rule 133)',
        'TaxPaid.AdvanceTax',
      ),
    );
  if (n(tp.SelfAssessmentTax) !== selfAss)
    out.push(
      err(
        'R134',
        'Self-assessment tax is not the challans dated after 31 March (rule 134)',
        'TaxPaid.SelfAssessmentTax',
      ),
    );
  if (it.some((x) => x.DateDep < fy.from))
    out.push(err('R133', 'A challan is dated before the financial year began', 'ScheduleIT'));
  const tdsSal = doc.TDSonSalaries as Rec | undefined;
  const tdsOth = doc.TDSonOthThanSals as Rec | undefined;
  const tds3 = doc.ScheduleTDS3Dtls as Rec | undefined;
  if (
    tdsSal &&
    n(tdsSal.TotalTDSonSalaries) !== sum((tdsSal.TDSonSalary ?? []).map((x: Rec) => x.TotalTDSSal))
  )
    out.push(
      err('R118', 'TDS on salaries total is not the sum of its rows (rule 118)', 'TDSonSalaries'),
    );
  if (
    tdsOth &&
    n(tdsOth.TotalTDSonOthThanSals) !==
      sum((tdsOth.TDSonOthThanSalDtls ?? []).map((x: Rec) => x.TDSClaimed))
  )
    out.push(
      err(
        'R119',
        'TDS on other income total is not the sum of the amounts claimed (rule 119)',
        'TDSonOthThanSals',
      ),
    );
  for (const [i, x] of ((tdsOth?.TDSonOthThanSalDtls ?? []) as Rec[]).entries()) {
    if (n(x.TDSClaimed) > n(x.GrossAmount))
      out.push(
        err(
          'R117',
          'TDS claimed is more than the income it relates to (rules 116, 117, 142)',
          `TDSonOthThanSals.${i}`,
        ),
      );
    if (n(x.TDSClaimed) > 0 && (!x.GrossAmount || !x.HeadOfIncome))
      out.push(
        err(
          'R122',
          'TDS claimed needs the income and its head (rules 121, 122)',
          `TDSonOthThanSals.${i}`,
        ),
      );
    if (/^(92|192)/.test(String(x.TDSSection)))
      out.push(
        err(
          'R310',
          'Section 192 is salary TDS and belongs in the salary schedule (rule 310)',
          `TDSonOthThanSals.${i}`,
        ),
      );
  }
  const totalTds =
    n(tdsSal?.TotalTDSonSalaries) + n(tdsOth?.TotalTDSonOthThanSals) + n(tds3?.TotalTDS3Details);
  if (n(tp.TDS) !== totalTds)
    out.push(
      err(
        'R131',
        'TDS in taxes paid is not the sum of the TDS schedules (rule 131)',
        'TaxPaid.TDS',
      ),
    );
  if (n(tp.TCS) !== n(doc.ScheduleTCS?.TotalSchTCS))
    out.push(
      err('R132', 'TCS in taxes paid is not the TCS schedule total (rule 132)', 'TaxPaid.TCS'),
    );
  if (n(tp.TotalTaxesPaid) !== n(tp.AdvanceTax) + n(tp.TDS) + n(tp.TCS) + n(tp.SelfAssessmentTax))
    out.push(
      err(
        'R127',
        'Total taxes paid is not the sum of advance tax, TDS, TCS and self-assessment tax (rule 127)',
        'TaxPaid.TotalTaxesPaid',
      ),
    );
  const diff = n(tc.TotTaxPlusIntrstPay) - n(tp.TotalTaxesPaid);
  const bal = n(doc.TaxPaid?.BalTaxPayable);
  const refund = n(doc.Refund?.RefundDue);
  if (!near(bal, Math.max(0, diff)))
    out.push(
      err(
        'R129',
        'Tax payable is inconsistent with tax, interest and taxes paid (rule 129)',
        'TaxPaid.BalTaxPayable',
      ),
    );
  if (!near(refund, Math.max(0, -diff)))
    out.push(
      err(
        'R128',
        'Refund is inconsistent with tax, interest and taxes paid (rule 128)',
        'Refund.RefundDue',
      ),
    );
  if (bal > 0 && refund > 0)
    out.push(err('R128', 'Both tax payable and a refund are shown', 'Refund.RefundDue'));
  if (bal % 10 !== 0 || refund % 10 !== 0)
    out.push(
      err(
        'R288B',
        'Tax payable and refund are rounded to ten rupees (section 288B)',
        'TaxPaid.BalTaxPayable',
      ),
    );

  // ---- regime, filing section, due date -------------------------------------------------------------------------
  const fs = (doc.FilingStatus ?? {}) as Rec;
  if (fs.F10IEACurrAYOldRegime === undefined || fs.Form10IEAEarlierAYOldRegime === undefined)
    out.push(
      err('R260', 'The new-regime option (A23) must be answered (rule 260)', 'FilingStatus'),
    );
  if (
    fs.F10IEACurrAYOldRegime === 'Y' &&
    !(fs.F10IEAAckNoCurrAYOldTax && fs.F10IEADateCurrAYOldTax)
  )
    out.push(
      err(
        'R228',
        'Leaving the new regime needs the Form 10-IEA acknowledgement and date (rule 228)',
        'FilingStatus',
      ),
    );
  if (fs.ItrFilingDueDate !== r.itr4DueDate)
    out.push(
      err(
        'R234',
        `The due date for this year is ${r.itr4DueDate} (rule 234)`,
        'FilingStatus.ItrFilingDueDate',
      ),
    );
  const filed = String(doc.CreationInfo?.JSONCreationDate ?? '');
  if (filed && fs.ReturnFileSec === 11 && filed > r.itr4DueDate)
    out.push(
      err(
        'FILING_SEC',
        'Filed after the due date but marked as filed in time; it is a belated return under 139(4)',
        'FilingStatus.ReturnFileSec',
      ),
    );
  if (filed && fs.ReturnFileSec === 12 && filed <= r.itr4DueDate)
    out.push(
      err(
        'FILING_SEC',
        'Filed in time but marked as a belated return',
        'FilingStatus.ReturnFileSec',
      ),
    );
  if (n(ip.LateFilingFee234F) > 0 && fs.ReturnFileSec === 11)
    out.push(
      err(
        'R234F',
        'A late fee is charged on a return filed in time',
        'IntrstPay.LateFilingFee234F',
      ),
    );
  return out;
}
