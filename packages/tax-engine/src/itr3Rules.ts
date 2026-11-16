// R2.5: the Income Tax Department's validation rules for ITR-3, AY 2026-27 ("CBDT e-Filing ITR 3 Validation Rules", v1.0,
// 18 June 2026, category A: the portal refuses the return). Only the rules the builder can break are checked, each named by
// its serial number in that document. They read the finished file, never the builder's own figures, so a slip in the builder
// is caught independently. The schema (itr3Schema.ts) checks the shape; these check the arithmetic and the cross-references.

import type { FilingIssue } from './filing.ts';

// The file is a schema-shaped document read by field name, so its nodes are untyped on purpose.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;
const get = (o: Json | undefined, path: string): any =>
  path.split('.').reduce((n: any, k) => (n == null ? undefined : n[k]), o);
const num = (o: Json | undefined, path: string) => Number(get(o, path)) || 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Rule serial numbers this module checks, for the documentation and the tests. */
export const ITR3_RULES_CHECKED = [
  52, 53, 54, 55, 56, 57, 58, 59, 60, 70, 72, 73, 75, 79, 81, 82, 84, 90, 92, 94, 95, 96, 97, 153,
  154, 155, 156, 157, 158, 237, 240, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255,
  256, 260, 262, 263, 264, 265, 269, 271, 288, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313,
  316, 317, 318, 319, 321, 322, 323, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336,
  337, 161, 163, 164, 165, 506, 511, 554, 560, 574, 580, 593, 609, 914, 918, 919, 920, 922, 927,
  930, 931, 932, 935, 942, 943, 944, 945, 946, 961, 963, 964, 965, 968, 969, 970, 971, 976, 977,
  981, 983, 986, 987,
] as const;

/** Every department rule the file breaks (empty when it keeps them all). */
export function validateItr3Rules(file: unknown): FilingIssue[] {
  const r = (file as Json)?.ITR?.ITR3 as Json | undefined;
  const out: FilingIssue[] = [];
  if (!r) return out;
  const fail = (rule: number, message: string, path?: string) =>
    out.push({
      id: `RULE${rule}:${path ?? message}`,
      severity: 'error',
      code: `ITR3_RULE_${rule}`,
      message: `Rule ${rule}: ${message}`,
      ...(path ? { path } : {}),
    });
  /** `actual` must equal `expected` (within `tol` rupees). */
  const eq = (
    rule: number,
    msg: string,
    actual: number,
    expected: number,
    path?: string,
    tol = 1,
  ) => {
    if (Math.abs(actual - expected) > tol)
      fail(
        rule,
        `${msg} (${actual.toLocaleString('en-IN')} against ${expected.toLocaleString('en-IN')})`,
        path,
      );
  };

  // ---- Part A balance sheet
  const bs = r.PARTA_BS;
  const src = bs?.FundSrc;
  const app = bs?.FundApply;
  if (bs) {
    eq(
      52,
      'sources of funds must equal application of funds',
      num(src, 'TotFundSrc'),
      num(app, 'TotFundApply'),
      'PARTA_BS',
    );
    eq(
      53,
      "total proprietor's fund must be capital plus reserves and surplus",
      num(src, 'PropFund.TotPropFund'),
      num(src, 'PropFund.PropCap') + num(src, 'PropFund.ResrNSurp.TotResrNSurp'),
      'PARTA_BS.FundSrc.PropFund',
    );
    eq(
      54,
      'total loan funds must be secured plus unsecured loans',
      num(src, 'LoanFunds.TotLoanFund'),
      num(src, 'LoanFunds.SecrLoan.TotSecrLoan') + num(src, 'LoanFunds.UnsecrLoan.TotUnSecrLoan'),
      'PARTA_BS.FundSrc.LoanFunds',
    );
    eq(
      55,
      "total sources must be proprietor's fund, loans, deferred tax and advances",
      num(src, 'TotFundSrc'),
      num(src, 'PropFund.TotPropFund') +
        num(src, 'LoanFunds.TotLoanFund') +
        num(src, 'DeferredTax') +
        num(src, 'Advances.TotalAdvances'),
      'PARTA_BS.FundSrc',
    );
    eq(
      56,
      'total investments must be long-term plus trade investments',
      num(app, 'Investments.TotInvestments'),
      num(app, 'Investments.LongTermInv.TotLongTermInv') +
        num(app, 'Investments.TradeInv.TotTradeInv'),
      'PARTA_BS.FundApply.Investments',
    );
    const ca = app?.CurrAssetLoanAdv;
    eq(
      57,
      'total current assets must be inventories, debtors, cash and bank and other',
      num(ca, 'CurrAsset.TotCurrAsset'),
      num(ca, 'CurrAsset.Inventories.TotInventries') +
        num(ca, 'CurrAsset.SndryDebtors') +
        num(ca, 'CurrAsset.CashOrBankBal.TotCashOrBankBal') +
        num(ca, 'CurrAsset.OthCurrAsset'),
      'PARTA_BS.FundApply.CurrAssetLoanAdv',
    );
    eq(
      58,
      'net current assets must be current assets less current liabilities',
      num(ca, 'NetCurrAsset'),
      num(ca, 'TotCurrAssetLoanAdv') - num(ca, 'CurrLiabilitiesProv.TotCurrLiabilitiesProvision'),
      'PARTA_BS.FundApply.CurrAssetLoanAdv',
    );
    eq(
      59,
      'total application of funds must be fixed assets, investments, net current assets and miscellaneous',
      num(app, 'TotFundApply'),
      num(app, 'FixedAsset.TotFixedAsset') +
        num(app, 'Investments.TotInvestments') +
        num(ca, 'NetCurrAsset') +
        num(app, 'MiscAdjust.TotMiscAdjust'),
      'PARTA_BS.FundApply',
    );
    eq(
      60,
      'total advances must be those from specified persons plus others',
      num(src, 'Advances.TotalAdvances'),
      num(src, 'Advances.FromPrsn') + num(src, 'Advances.FromOthers'),
      'PARTA_BS.FundSrc.Advances',
    );
  }

  // ---- Part A trading account
  const ta = r.TradingAccount;
  if (ta) {
    eq(
      70,
      'sales and gross receipts must be goods, services and other operating revenue',
      num(ta, 'SalesGrossReceiptsTotal'),
      num(ta, 'SaleOfGoods') + num(ta, 'SaleOfServices') + num(ta, 'OperatingRevenueTotal'),
      'TradingAccount',
    );
    eq(
      72,
      'total revenue from operations must be sales, professional receipts and duties and taxes',
      num(ta, 'TotRevenueFrmOperations'),
      num(ta, 'SalesGrossReceiptsTotal') +
        num(ta, 'GrossRcptFromProfession') +
        num(ta, 'ExciseCustomsVAT.TotExciseCustomsVAT'),
      'TradingAccount',
    );
    eq(
      73,
      'total direct expenses must be carriage, power and fuel and other direct expenses',
      num(ta, 'DirectExpensesTotal'),
      num(ta, 'CarriageInward') +
        num(ta, 'PowerAndFuel') +
        sum((ta.OtherIncDtls ?? []).map((x: Json) => Number(x.Amount) || 0)),
      'TradingAccount',
    );
    eq(
      75,
      'gross profit must be credits less opening stock, purchases, direct expenses and duties',
      num(ta, 'GrossProfitFrmBusProf'),
      num(ta, 'TardingAccTotCred') -
        num(ta, 'OpngStckOfFinishedStcks') -
        num(ta, 'Purchases') -
        num(ta, 'DirectExpensesTotal') -
        num(ta, 'DutyTaxPay.ExciseCustomsVAT.TotExciseCustomsVAT') -
        num(ta, 'GoodsCostPrdcdFrmMA'),
      'TradingAccount',
    );
    eq(
      79,
      'gross profit carried to the profit and loss account must equal the trading account result',
      num(r.PARTA_PL, 'CreditsToPL.GrossProfitTrnsfFrmTrdAcc'),
      num(ta, 'GrossProfitFrmBusProf') + num(ta, 'IncomeIntradayTrd') + num(ta, 'IncomeFutureTrd'),
      'PARTA_PL.CreditsToPL',
    );
  }

  // ---- Part A profit and loss account
  const pl = r.PARTA_PL;
  if (pl) {
    const oi = pl.CreditsToPL?.OthIncome ?? {};
    const parts = [
      'RentInc',
      'Comissions',
      'Dividends',
      'InterestInc',
      'ProfitOnSaleFixedAsset',
      'ProfitOnInvChrSTT',
      'ProfitOnOthInv',
      'ProfitOnCurrFluct',
      'ProfitOnCnvInvntryToCapAsst',
      'ProfitOnAgriIncome',
      'MiscOthIncome',
      'LiabilityWrittenBack',
    ].map((k) => Number(oi[k]) || 0);
    eq(
      81,
      'total other income must be the sum of its parts',
      num(oi, 'TotOthIncome'),
      sum(parts),
      'PARTA_PL.CreditsToPL.OthIncome',
    );
    eq(
      82,
      'total credits must be gross profit plus other income',
      num(pl, 'CreditsToPL.TotCreditsToPL'),
      num(pl, 'CreditsToPL.GrossProfitTrnsfFrmTrdAcc') + num(oi, 'TotOthIncome'),
      'PARTA_PL.CreditsToPL',
    );
    const d = pl.DebitsToPL ?? {};
    eq(
      84,
      'compensation to employees must be the sum of its parts',
      num(d, 'EmployeeComp.TotEmployeeComp'),
      sum(
        [
          'SalsWages',
          'Bonus',
          'MedExpReimb',
          'LeaveEncash',
          'LeaveTravelBenft',
          'ContToSuperAnnFund',
          'ContToPF',
          'ContToGratFund',
          'ContToOthFund',
          'OthEmpBenftExpdr',
        ].map((k) => Number(d.EmployeeComp?.[k]) || 0),
      ),
      'PARTA_PL.DebitsToPL.EmployeeComp',
    );
    eq(
      90,
      'other expenses must be the sum of the items listed',
      num(d, 'OtherExpenses'),
      sum((d.OtherExpensesDtls ?? []).map((x: Json) => Number(x.Amount) || 0)),
      'PARTA_PL.DebitsToPL',
    );
    const heads =
      sum(
        [
          'Freight',
          'ConsumptionOfStores',
          'PowerFuel',
          'RentExpdr',
          'RepairsBldg',
          'RepairMach',
          'StaffWelfareExp',
          'Entertainment',
          'Hospitality',
          'Conference',
          'SalePromoExp',
          'Advertisement',
          'HotelBoardLodge',
          'TravelExp',
          'ForeignTravelExp',
          'ConveyanceExp',
          'TelephoneExp',
          'GuestHouseExp',
          'ClubExp',
          'FestivalCelebExp',
          'Scholarship',
          'Gift',
          'Donation',
          'AuditFee',
          'ProvForBadDoubtDebt',
          'OthProvisionsExpdr',
        ].map((k) => Number(d[k]) || 0),
      ) +
      num(d, 'EmployeeComp.TotEmployeeComp') +
      num(d, 'Insurances.TotInsurances') +
      num(d, 'CommissionExpdrDtls.Total') +
      num(d, 'RoyalityDtls.Total') +
      num(d, 'ProfessionalConstDtls.Total') +
      num(d, 'RatesTaxesPays.ExciseCustomsVAT.TotExciseCustomsVAT') +
      num(d, 'OtherExpenses') +
      num(d, 'BadDebtDtls.BadDebt');
    eq(
      92,
      'profit before interest, depreciation and taxes must be total credits less the expenses',
      num(d, 'PBIDTA'),
      num(pl, 'CreditsToPL.TotCreditsToPL') - heads,
      'PARTA_PL.DebitsToPL',
    );
    eq(
      94,
      'net profit before tax must be PBIDTA less interest and depreciation',
      num(d, 'PBT'),
      num(d, 'PBIDTA') - num(d, 'InterestExpdrtDtls.InterestExpdr') - num(d, 'DepreciationAmort'),
      'PARTA_PL.DebitsToPL',
    );
    const ap = pl.TaxProvAppr ?? {};
    eq(
      95,
      'profit after tax must be profit before tax less the tax provisions',
      num(ap, 'ProfitAfterTax'),
      num(d, 'PBT') - num(ap, 'ProvForCurrTax') - num(ap, 'ProvDefTax'),
      'PARTA_PL.TaxProvAppr',
    );
    eq(
      96,
      'amount available for appropriation must be profit after tax plus the balance brought forward',
      num(ap, 'AmtAvlAppr'),
      num(ap, 'ProfitAfterTax') + num(ap, 'BalBFPrevYr'),
      'PARTA_PL.TaxProvAppr',
    );
    eq(
      97,
      "balance carried to the proprietor's account must be the amount available less the transfer to reserves",
      num(ap, 'ProprietorAccBalTrf'),
      num(ap, 'AmtAvlAppr') - num(ap, 'TrfToReserves'),
      'PARTA_PL.TaxProvAppr',
    );
  }

  // ---- Part A other information
  const oi = r.PARTA_OI;
  if (oi) {
    const tot = (o: Json | undefined, parts: string[], totalKey: string) =>
      sum(parts.map((k) => Number(o?.[k]) || 0)) - num(o, totalKey);
    const s36 = Object.keys(oi.AmtDisallUs36 ?? {}).filter((k) => k !== 'TotAmtDisallUs36');
    eq(
      153,
      'the total disallowed under section 36 must be the sum of its items',
      num(oi, 'AmtDisallUs36.TotAmtDisallUs36'),
      sum(s36.map((k) => num(oi.AmtDisallUs36, k))),
      'PARTA_OI.AmtDisallUs36',
    );
    const s37 = Object.keys(oi.AmtDisallUs37 ?? {}).filter((k) => k !== 'TotAmtDisallUs37');
    eq(
      154,
      'the total disallowed under section 37 must be the sum of its items',
      num(oi, 'AmtDisallUs37.TotAmtDisallUs37'),
      sum(s37.map((k) => num(oi.AmtDisallUs37, k))),
      'PARTA_OI.AmtDisallUs37',
    );
    const s40 = Object.keys(oi.AmtDisallUs40 ?? {}).filter(
      (k) => k !== 'TotAmtDisallUs40' && k !== 'AmtDisallUs40PyNowAll',
    );
    eq(
      155,
      'the total disallowed under section 40 must be the sum of its items',
      num(oi, 'AmtDisallUs40.TotAmtDisallUs40'),
      sum(s40.map((k) => num(oi.AmtDisallUs40, k))),
      'PARTA_OI.AmtDisallUs40',
    );
    const s40a = Object.keys(oi.AmtDisallUs40A ?? {}).filter((k) => k !== 'TotAmtDisallUs40A');
    eq(
      156,
      'the total disallowed under section 40A must be the sum of its items',
      num(oi, 'AmtDisallUs40A.TotAmtDisallUs40A'),
      sum(s40a.map((k) => num(oi.AmtDisallUs40A, k))),
      'PARTA_OI.AmtDisallUs40A',
    );
    const d43 = (o: Json | undefined) =>
      sum(
        Object.keys(o ?? {})
          .filter((k) => k !== 'TotAmtUs43b')
          .map((k) => num(o, k)),
      );
    eq(
      157,
      'the section 43B amount allowed now must be the sum of its items',
      num(oi, 'AmtDisallUs43BPyNowAll.AmtUs43B.TotAmtUs43b'),
      d43(oi.AmtDisallUs43BPyNowAll?.AmtUs43B),
      'PARTA_OI.AmtDisallUs43BPyNowAll',
    );
    eq(
      158,
      'the section 43B amount disallowed must be the sum of its items',
      num(oi, 'AmtDisall43B.AmtUs43B.TotAmtUs43b'),
      d43(oi.AmtDisall43B?.AmtUs43B),
      'PARTA_OI.AmtDisall43B',
    );
    void tot;
  }

  // ---- Schedule BP
  const bp = r.ITR3ScheduleBP?.BusinessIncOthThanSpec;
  if (bp) {
    eq(
      237,
      'profit before tax in Schedule BP must equal the profit and loss account',
      num(bp, 'ProfBfrTaxPL'),
      num(pl, 'DebitsToPL.PBT') +
        num(pl, 'NoBooksOfAccPL.NetProfit') +
        num(pl, 'PersumptiveInc44AD.TotPersumptiveInc44AD') +
        num(pl, 'PersumptiveInc44ADA.TotPersumptiveInc44ADA'),
      'ITR3ScheduleBP',
    );
    eq(
      240,
      'depreciation allowed in Schedule BP must equal the total in Schedule DEP',
      num(bp, 'DepreciationAllowITAct32.TotDeprAllowITAct'),
      num(r.ScheduleDEP, 'SummaryFromDeprSch.TotalDepreciation'),
      'ITR3ScheduleBP',
    );
    const credited = sum(
      [
        'Salary',
        'HouseProperty',
        'CapitalGains',
        'OtherSources',
        'Us115BBF',
        'Us115BBG',
        '115BBH',
      ].map((k) => num(bp.IncRecCredPLOthHeadDtls, k)),
    );
    eq(
      244,
      'A6 must be profit less speculative, other-head, covered-activity and exempt income',
      num(bp, 'BalancePLOthThanSpecBus'),
      num(bp, 'ProfBfrTaxPL') -
        num(bp, 'NetPLFromSpecBus') -
        num(bp, 'NetPLFromSpecifiedBus') -
        credited -
        num(bp, 'PLUs44sChapXIIG') -
        num(bp, 'TotalProfitFrmActCvrd') -
        num(bp, 'IncCredPL.TotExempIncPL') -
        num(bp, 'IncCredPLNotChargable'),
      'ITR3ScheduleBP',
    );
    const exp =
      sum(
        [
          'Salary',
          'HouseProperty',
          'CapitalGains',
          'OtherSources',
          'Us115BBF',
          'Us115BBG',
          '115BBH',
        ].map((k) => num(bp.ExpDebToPLOthHeadDtls, k)),
      ) +
      num(bp, 'ExpDebToPLExemptInc') +
      num(bp, 'ExpDebToPLExemptIncDisAllwUs14A');
    eq(
      245,
      'A9 must be the expenses relating to other heads and exempt income',
      num(bp, 'TotExpDebPL'),
      exp,
      'ITR3ScheduleBP',
    );
    eq(
      246,
      'A10 must be A6 plus A9',
      num(bp, 'AdjustedPLOthThanSpecBus'),
      num(bp, 'BalancePLOthThanSpecBus') + num(bp, 'TotExpDebPL'),
      'ITR3ScheduleBP',
    );
    eq(
      247,
      'depreciation allowed must be the sum of 32(1)(ii) and 32(1)(i)',
      num(bp, 'DepreciationAllowITAct32.TotDeprAllowITAct'),
      num(bp, 'DepreciationAllowITAct32.DepreciationAllowUs32_1_ii') +
        num(bp, 'DepreciationAllowITAct32.DepreciationAllowUs32_1_i'),
      'ITR3ScheduleBP',
    );
    eq(
      248,
      'A13 must be A10 plus book depreciation less the depreciation allowed',
      num(bp, 'AdjustPLAfterDeprOthSpecInc'),
      num(bp, 'AdjustedPLOthThanSpecBus') +
        num(bp, 'DepreciationDebPLCosAct') -
        num(bp, 'DepreciationAllowITAct32.TotDeprAllowITAct'),
      'ITR3ScheduleBP',
    );
    const adds = sum(
      [
        'AmtDebPLDisallowUs36',
        'AmtDebPLDisallowUs37',
        'AmtDebPLDisallowUs40',
        'AmtDebPLDisallowUs40A',
        'AmtDebPLDisallowUs43B',
        'InterestDisAllowUs23SMEAct',
        'DeemIncUs41',
        'DeemIncUs3380HHD80IA',
        'DeemIncUs32AD',
        'DeemIncUs33AB',
        'DeemIncUs33ABA',
        'DeemIncUs35ABA',
        'DeemIncUs35ABB',
        'DeemIncUs40A3A',
        'DeemIncUs72A',
        'DeemIncUs80HHD',
        'DeemIncUs80IA',
        'DeemIncUs43CA',
        'OthItemDisallowUs28To44DA',
        'AnyOthIncNotInclInExpDisallowPL',
        'AnyOthIncNotInclInSalary',
        'AnyOthIncNotInclInBonus',
        'AnyOthIncNotInclInCommission',
        'AnyOthIncNotInclInInterest',
        'AnyOthIncNotInclInOthers',
        'IncProfDecLossAccICDSAdj',
      ].map((k) => num(bp, k)),
    );
    eq(
      249,
      'A26 must be the sum of the additions A14 to A25',
      num(bp, 'TotAfterAddToPLDeprOthSpecInc'),
      adds,
      'ITR3ScheduleBP',
    );
    const deds = sum(
      [
        'DeductUs32_1_iii',
        'DebPLUs35ExcessAmt',
        'AmtDisallUs40NowAllow',
        'AmtDisallUs43BNowAllow',
        'AnyOthAmtAllDeduct',
        'DecProfIncLossAccICDSAdj',
      ].map((k) => num(bp, k)),
    );
    eq(
      250,
      'A33 must be the sum of the deductions A27 to A32',
      num(bp, 'TotDeductionAmts'),
      deds,
      'ITR3ScheduleBP',
    );
    eq(
      251,
      'A14 must equal item 6s of Part A-OI',
      num(bp, 'AmtDebPLDisallowUs36'),
      num(oi, 'AmtDisallUs36.TotAmtDisallUs36'),
      'ITR3ScheduleBP',
    );
    eq(
      252,
      'A15 must equal item 7j of Part A-OI',
      num(bp, 'AmtDebPLDisallowUs37'),
      num(oi, 'AmtDisallUs37.TotAmtDisallUs37'),
      'ITR3ScheduleBP',
    );
    eq(
      253,
      'A16 must equal item 8Aj of Part A-OI',
      num(bp, 'AmtDebPLDisallowUs40'),
      num(oi, 'AmtDisallUs40.TotAmtDisallUs40'),
      'ITR3ScheduleBP',
    );
    eq(
      254,
      'A17 must equal item 9f of Part A-OI',
      num(bp, 'AmtDebPLDisallowUs40A'),
      num(oi, 'AmtDisallUs40A.TotAmtDisallUs40A'),
      'ITR3ScheduleBP',
    );
    eq(
      255,
      'A18 must equal item 11 of Part A-OI',
      num(bp, 'AmtDebPLDisallowUs43B'),
      num(oi, 'AmtDisall43B.AmtUs43B.TotAmtUs43b'),
      'ITR3ScheduleBP',
    );
    eq(
      256,
      'A20 must equal item 14 of Part A-OI',
      num(bp, 'DeemIncUs41'),
      num(oi, 'ProfTaxAmtUs41'),
      'ITR3ScheduleBP',
    );
    eq(
      260,
      'A30 must equal item 10i of Part A-OI',
      num(bp, 'AmtDisallUs43BNowAllow'),
      num(oi, 'AmtDisallUs43BPyNowAll.AmtUs43B.TotAmtUs43b'),
      'ITR3ScheduleBP',
    );
    eq(
      262,
      'A34 must be A13 plus A26 less A33',
      num(bp, 'PLAftAdjDedBusOthThanSpec'),
      num(bp, 'AdjustPLAfterDeprOthSpecInc') +
        num(bp, 'TotAfterAddToPLDeprOthSpecInc') -
        num(bp, 'TotDeductionAmts'),
      'ITR3ScheduleBP',
    );
    const deemed = sum(
      [
        'Section44AD',
        'Section44ADA',
        'Section44AE',
        'Section44B',
        'Section44BB',
        'Section44BBA',
        'Section44BBC',
        'Section44BBD',
        'Section44DA',
      ].map((k) => num(bp.DeemedProfitBusUs, k)),
    );
    eq(
      263,
      'A35 total must be the sum of the deemed profits',
      num(bp, 'DeemedProfitBusUs.TotDeemedProfitBusUs'),
      deemed,
      'ITR3ScheduleBP',
    );
    eq(
      264,
      'A36 must be A34 plus A35',
      num(bp, 'NetPLAftAdjBusOthThanSpec'),
      num(bp, 'PLAftAdjDedBusOthThanSpec') + num(bp, 'DeemedProfitBusUs.TotDeemedProfitBusUs'),
      'ITR3ScheduleBP',
    );
    eq(
      265,
      'A37 must be the sum of 37a to 37f',
      num(bp, 'NetPLBusOthThanSpec7A7B7C'),
      sum(
        [
          'ChrgblIncUndrRule7',
          'DeemedChrgblIncUndrRule7A',
          'DeemedChrgblIncUndrRule7B1',
          'DeemedChrgblIncUndrRule7B1A',
          'DeemedChrgblIncUndrRule8',
          'IncomeOtherThanRule',
        ].map((k) => num(bp, k)),
      ),
      'ITR3ScheduleBP',
    );
    eq(
      269,
      'D must be A37 plus B42 plus C48',
      num(r.ITR3ScheduleBP, 'IncChrgUnHdProftGain'),
      num(bp, 'NetPLBusOthThanSpec7A7B7C') +
        num(r.ITR3ScheduleBP, 'SpecBusinessInc.AdjustedPLFrmSpecuBus') +
        num(r.ITR3ScheduleBP, 'SpecifiedBusinessInc.PLFrmSpecifiedBus'),
      'ITR3ScheduleBP',
    );
    eq(
      271,
      'depreciation debited in Schedule BP must equal the profit and loss account',
      num(bp, 'DepreciationDebPLCosAct'),
      num(pl, 'DebitsToPL.DepreciationAmort'),
      'ITR3ScheduleBP',
    );
    eq(
      288,
      'other-sources income credited must be dividend plus other',
      num(bp, 'IncRecCredPLOthHeadDtls.OtherSources'),
      num(bp, 'IncRecCredPLOthHeadDtls.Dividend') +
        num(bp, 'IncRecCredPLOthHeadDtls.OtherThanDividend'),
      'ITR3ScheduleBP',
    );
  }

  // ---- Depreciation schedules
  const detail = (
    d: Json | undefined,
    key: string,
    rate: number,
    rules: { half: boolean; dpm: boolean },
    path: string,
  ) => {
    if (!d) return;
    const full = num(d, 'FullRateDeprAmt');
    const half = num(d, 'HalfRateDeprAmt');
    const total = rules.dpm ? num(d, 'Total') : num(d, 'WDVFirstDay');
    if (rules.dpm)
      eq(
        313,
        'item 3 must be the opening value plus the section 115BAC adjustment',
        num(d, 'Total'),
        num(d, 'WDVFirstDay') + num(d, 'AdjustmentSec115BAC'),
        path,
      );
    eq(
      rules.dpm ? 304 : 316,
      'the full-rate amount must be opening value plus additions of 180 days or more less realisation (or zero)',
      full,
      Math.max(0, total + num(d, 'AdditionsGrThan180Days') - num(d, 'RealizationTotalPeriod')),
      path,
    );
    if (rules.half)
      eq(
        rules.dpm ? 305 : 317,
        'the half-rate amount must be additions of under 180 days less their realisation (or zero)',
        half,
        Math.max(
          0,
          num(d, 'AdditionsLessThan180Days') - num(d, 'RealizationPeriodLessThan180days'),
        ),
        path,
      );
    eq(
      rules.dpm ? 311 : 322,
      `depreciation at full rate must be ${rate}% of the full-rate amount`,
      num(d, 'DepreciationAtFullRate'),
      Math.round((rate / 100) * full),
      path,
    );
    if (rules.half)
      eq(
        rules.dpm ? 312 : 323,
        `depreciation at half rate must be ${rate / 2}% of the half-rate amount`,
        num(d, 'DepreciationAtHalfRate'),
        Math.round((rate / 200) * half),
        path,
      );
    eq(
      rules.dpm ? 306 : 318,
      'total depreciation must be the sum of its parts',
      num(d, 'TotalDepreciation'),
      num(d, 'DepreciationAtFullRate') +
        num(d, 'DepreciationAtHalfRate') +
        num(d, 'AddlnDeprOnGT180DayAdditions') +
        num(d, 'AddlnDeprOnLessThan180DayAdditions') +
        num(d, 'AddlnDeprOnAssetLessThan180Days'),
      path,
    );
    eq(
      rules.dpm ? 307 : 319,
      'net aggregate depreciation must be total depreciation less the part disallowed',
      num(d, 'NetAggregateDepreciation'),
      num(d, 'TotalDepreciation') - num(d, 'DepDisAllowUs38_2'),
      path,
    );
    const wdvLast =
      num(d, 'CapGainUs50') !== 0 ? 0 : full + half - num(d, 'NetAggregateDepreciation');
    eq(
      rules.dpm ? 308 : 321,
      'the value on the last day must be the amounts depreciated less the depreciation (or zero)',
      num(d, 'WDVLastDay'),
      Math.max(0, wdvLast),
      path,
    );
    void key;
  };
  const dpmRates: [string, number][] = [
    ['Rate15', 15],
    ['Rate30', 30],
    ['Rate40', 40],
    ['Rate45', 45],
  ];
  for (const [k, rate] of dpmRates) {
    const d = r.ScheduleDPM?.PlantMachinery?.[k]?.DepreciationDetail;
    detail(d, k, rate, { half: k !== 'Rate45', dpm: true }, `ScheduleDPM.PlantMachinery.${k}`);
    if (d && r.Form_ITR3 && get(r, 'PartA_GEN1.FilingStatus.OptOldRegimeCurrAY') === 'N') {
      if (k === 'Rate45' && num(d, 'TotalDepreciation') > 0)
        fail(
          310,
          'under the new tax regime depreciation in the 45% block can not be claimed',
          `ScheduleDPM.PlantMachinery.${k}`,
        );
      if (
        num(d, 'AddlnDeprOnGT180DayAdditions') +
          num(d, 'AddlnDeprOnLessThan180DayAdditions') +
          num(d, 'AddlnDeprOnAssetLessThan180Days') >
        0
      )
        fail(
          309,
          'under the new tax regime additional depreciation can not be claimed',
          `ScheduleDPM.PlantMachinery.${k}`,
        );
    }
  }
  const doa: [string, string, number][] = [
    ['Building', 'Rate5', 5],
    ['Building', 'Rate10', 10],
    ['Building', 'Rate40', 40],
    ['FurnitureFittings', 'Rate10', 10],
    ['IntangibleAssets', 'Rate25', 25],
    ['Ships', 'Rate20', 20],
  ];
  for (const [g, k, rate] of doa)
    detail(
      r.ScheduleDOA?.[g]?.[k]?.DepreciationDetail,
      k,
      rate,
      { half: true, dpm: false },
      `ScheduleDOA.${g}.${k}`,
    );

  const dep = r.ScheduleDEP?.SummaryFromDeprSch;
  if (dep) {
    const pmNet = (k: string) =>
      num(r.ScheduleDPM?.PlantMachinery?.[k]?.DepreciationDetail, 'NetAggregateDepreciation');
    const doaNet = (g: string, k: string) =>
      num(r.ScheduleDOA?.[g]?.[k]?.DepreciationDetail, 'NetAggregateDepreciation');
    const pm = dep.PlantMachinerySummary ?? {};
    eq(
      325,
      'total depreciation on plant and machinery must be the sum of its blocks',
      num(pm, 'TotPlntMach'),
      num(pm, 'DeprBlockTot15Percent') +
        num(pm, 'DeprBlockTot30Percent') +
        num(pm, 'DeprBlockTot40Percent') +
        num(pm, 'DeprBlockTot45Percent'),
      'ScheduleDEP',
    );
    const bd = dep.BuildingSummary ?? {};
    eq(
      326,
      'total depreciation on buildings must be the sum of its blocks',
      num(bd, 'TotBuildng'),
      num(bd, 'DeprBlockTot5Percent') +
        num(bd, 'DeprBlockTot10Percent') +
        num(bd, 'DeprBlockTot40Percent'),
      'ScheduleDEP',
    );
    eq(
      327,
      'total depreciation must be plant, buildings, furniture, intangibles and ships',
      num(dep, 'TotalDepreciation'),
      num(pm, 'TotPlntMach') +
        num(bd, 'TotBuildng') +
        num(dep, 'FurnitureSummary') +
        num(dep, 'IntangibleAssetSummary') +
        num(dep, 'ShipsSummary'),
      'ScheduleDEP',
    );
    eq(
      328,
      'the 15% block must equal Schedule DPM',
      num(pm, 'DeprBlockTot15Percent'),
      pmNet('Rate15'),
      'ScheduleDEP',
    );
    eq(
      329,
      'the 30% block must equal Schedule DPM',
      num(pm, 'DeprBlockTot30Percent'),
      pmNet('Rate30'),
      'ScheduleDEP',
    );
    eq(
      330,
      'the 40% block must equal Schedule DPM',
      num(pm, 'DeprBlockTot40Percent'),
      pmNet('Rate40'),
      'ScheduleDEP',
    );
    eq(
      331,
      'the 45% block must equal Schedule DPM',
      num(pm, 'DeprBlockTot45Percent'),
      pmNet('Rate45'),
      'ScheduleDEP',
    );
    eq(
      332,
      'the 5% building block must equal Schedule DOA',
      num(bd, 'DeprBlockTot5Percent'),
      doaNet('Building', 'Rate5'),
      'ScheduleDEP',
    );
    eq(
      333,
      'the 10% building block must equal Schedule DOA',
      num(bd, 'DeprBlockTot10Percent'),
      doaNet('Building', 'Rate10'),
      'ScheduleDEP',
    );
    eq(
      334,
      'the 40% building block must equal Schedule DOA',
      num(bd, 'DeprBlockTot40Percent'),
      doaNet('Building', 'Rate40'),
      'ScheduleDEP',
    );
    eq(
      335,
      'furniture and fittings must equal Schedule DOA',
      num(dep, 'FurnitureSummary'),
      doaNet('FurnitureFittings', 'Rate10'),
      'ScheduleDEP',
    );
    eq(
      336,
      'intangible assets must equal Schedule DOA',
      num(dep, 'IntangibleAssetSummary'),
      doaNet('IntangibleAssets', 'Rate25'),
      'ScheduleDEP',
    );
    eq(
      337,
      'ships must equal Schedule DOA',
      num(dep, 'ShipsSummary'),
      doaNet('Ships', 'Rate20'),
      'ScheduleDEP',
    );
  }

  // ---- Salary (Schedule S)
  const sal = r.ScheduleS;
  if (sal) {
    eq(
      161,
      'total gross salary must be the sum over the employers',
      num(sal, 'TotalGrossSalary'),
      sum((sal.Salaries ?? []).map((x: Json) => Number(x.Salarys?.GrossSalary) || 0)),
      'ScheduleS',
    );
    eq(
      163,
      'net salary must be total gross salary less the exempt allowances',
      num(sal, 'NetSalary'),
      num(sal, 'TotalGrossSalary') - num(sal, 'AllwncExtentExemptUs10'),
      'ScheduleS',
    );
    eq(
      164,
      'deductions under section 16 must be the sum of 16(ia), 16(ii) and 16(iii)',
      num(sal, 'DeductionUS16'),
      num(sal, 'DeductionUnderSection16ia') +
        num(sal, 'EntertainmntalwncUs16ii') +
        num(sal, 'ProfessionalTaxUs16iii'),
      'ScheduleS',
    );
    eq(
      165,
      'income under salaries must be net salary less the deductions',
      num(sal, 'TotIncUnderHeadSalaries'),
      num(sal, 'NetSalary') - num(sal, 'DeductionUS16'),
      'ScheduleS',
    );
  }

  // ---- Other sources
  const os = r.ScheduleOS;
  if (os?.IncOthThanOwnRaceHorse) {
    const o = os.IncOthThanOwnRaceHorse;
    eq(
      506,
      'item 1 must be the sum of dividend, interest, rent, 56(2)(x) income and other income',
      num(o, 'GrossIncChrgblTaxAtAppRate'),
      num(o, 'DividendGross') +
        num(o, 'InterestGross') +
        num(o, 'RentFromMachPlantBldgs') +
        num(o, 'Tot562x') +
        num(o, 'AnyOtherIncome'),
      'ScheduleOS',
    );
    eq(
      511,
      'income under other sources must be item 7 plus the race-horse balance',
      num(os, 'IncChargeable'),
      num(os, 'TotOthSrcNoRaceHorse') + num(os, 'IncFromOwnHorse.BalanceOwnRaceHorse'),
      'ScheduleOS',
    );
  }

  // ---- Set-off schedules
  const cyla = r.ScheduleCYLA;
  const bfla = r.ScheduleBFLA;
  const heads = [
    'Salary',
    'HP',
    'BusProfExclSpecProf',
    'SpeculativeInc',
    'SpecifiedInc',
    'STCG20Per',
    'STCG30Per',
    'STCGAppRate',
    'STCGDTAARate',
    'LTCG12_5Per',
    'LTCGDTAARate',
    'OthSrcExclRaceHorse',
    'OthSrcRaceHorse',
    'IncOSDTAA',
  ];
  if (cyla) {
    const setOff =
      num(cyla, 'TotalLossSetOff.TotBusLossSetoff') +
      num(cyla, 'TotalLossSetOff.TotHPlossCurYrSetoff') +
      num(cyla, 'TotalLossSetOff.TotOthSrcLossNoRaceHorseSetoff');
    const reduced = sum(
      heads.map(
        (h) =>
          num(cyla[h], 'IncCYLA.IncOfCurYrUnderThatHead') -
          num(cyla[h], 'IncCYLA.IncOfCurYrAfterSetOff'),
      ),
    );
    eq(
      560,
      'the income remaining after set-off must be the income less the losses set off against it',
      reduced,
      setOff,
      'ScheduleCYLA',
    );
    eq(
      574,
      'the loss set off can not exceed the loss to be set off',
      Math.min(
        setOff,
        num(cyla, 'TotalCurYr.TotBusLoss') +
          num(cyla, 'TotalCurYr.TotHPlossCurYr') +
          num(cyla, 'TotalCurYr.TotOthSrcLossNoRaceHorse'),
      ),
      setOff,
      'ScheduleCYLA',
    );
    eq(
      554,
      'the business loss remaining must be the loss less what was set off',
      num(cyla, 'TotalCurYr.TotBusLoss') - num(cyla, 'TotalLossSetOff.TotBusLossSetoff'),
      num(cyla, 'LossRemAftSetOff.BalBusLossAftSetoff'),
      'ScheduleCYLA',
    );
    const salaryAndBp =
      num(cyla, 'Salary.IncCYLA.IncOfCurYrUnderThatHead') +
      num(cyla, 'OthSrcExclRaceHorse.IncCYLA.IncOfCurYrUnderThatHead');
    // Rule 580/581: a loss is set off in full whenever the income is enough to absorb it.
    if (
      num(cyla, 'LossRemAftSetOff.BalBusLossAftSetoff') > 0 &&
      num(cyla, 'OthSrcExclRaceHorse.IncCYLA.IncOfCurYrAfterSetOff') > 0
    )
      fail(
        580,
        'a business loss must be set off in full against other income that can absorb it',
        'ScheduleCYLA',
      );
    void salaryAndBp;
  }
  if (bfla && cyla)
    for (const h of heads) {
      const left = num(cyla[h], 'IncCYLA.IncOfCurYrAfterSetOff');
      const from = num(bfla[h], 'IncBFLA.IncOfCurYrUndHeadFromCYLA');
      if (cyla[h] || bfla[h])
        eq(
          593,
          `Schedule BFLA's ${h} income must be what remained in Schedule CYLA`,
          from,
          left,
          `ScheduleBFLA.${h}`,
        );
      if (bfla[h])
        eq(
          609,
          `Schedule BFLA's ${h} income after set-off must be the income less the brought-forward losses set off`,
          num(bfla[h], 'IncBFLA.IncOfCurYrAfterSetOffBFLosses'),
          from -
            num(bfla[h], 'IncBFLA.BFUnabsorbedDeprSetoff') -
            num(bfla[h], 'IncBFLA.BFAllUs35Cl4Setoff'),
          `ScheduleBFLA.${h}`,
        );
    }

  // ---- Part B-TI and Part B-TTI
  const ti = r['PartB-TI'];
  if (ti) {
    eq(
      914,
      'total profits and gains from business must be the sum of its parts',
      num(ti, 'ProfBusGain.TotProfBusGain'),
      num(ti, 'ProfBusGain.ProfGainNoSpecBus') +
        num(ti, 'ProfBusGain.ProfGainSpecBus') +
        num(ti, 'ProfBusGain.ProfGainSpecifiedBus') +
        num(ti, 'ProfBusGain.ProfIncome115BBF'),
      'PartB-TI',
    );
    eq(
      918,
      'total income from other sources must be the sum of its parts',
      num(ti, 'IncFromOS.TotIncFromOS'),
      num(ti, 'IncFromOS.OtherSrcThanOwnRaceHorse') +
        num(ti, 'IncFromOS.IncChargblSplRate') +
        num(ti, 'IncFromOS.FromOwnRaceHorse'),
      'PartB-TI',
    );
    eq(
      919,
      'item 6 must be salaries, house property, business, capital gains and other sources',
      num(ti, 'TotalTI'),
      num(ti, 'Salaries') +
        num(ti, 'IncomeFromHP') +
        num(ti, 'ProfBusGain.TotProfBusGain') +
        num(ti, 'CapGain.TotalCapGains') +
        num(ti, 'IncFromOS.TotIncFromOS'),
      'PartB-TI',
    );
    eq(
      920,
      'salaries in Part B-TI must equal Schedule S',
      num(ti, 'Salaries'),
      num(sal, 'TotIncUnderHeadSalaries'),
      'PartB-TI',
    );
    eq(
      922,
      'business income in Part B-TI must equal Schedule BP',
      num(ti, 'ProfBusGain.TotProfBusGain'),
      Math.max(0, num(r.ITR3ScheduleBP, 'IncChrgUnHdProftGain')),
      'PartB-TI',
    );
    eq(
      927,
      'other-sources income in Part B-TI must equal Schedule OS',
      num(ti, 'IncFromOS.OtherSrcThanOwnRaceHorse'),
      num(os, 'TotOthSrcNoRaceHorse'),
      'PartB-TI',
    );
    eq(
      930,
      'the losses set off in Part B-TI must equal the total set off in Schedule CYLA',
      num(ti, 'CurrentYearLoss'),
      num(cyla, 'TotalLossSetOff.TotBusLossSetoff') +
        num(cyla, 'TotalLossSetOff.TotHPlossCurYrSetoff') +
        num(cyla, 'TotalLossSetOff.TotOthSrcLossNoRaceHorseSetoff'),
      'PartB-TI',
    );
    eq(
      931,
      'brought-forward losses set off in Part B-TI must equal Schedule BFLA',
      num(ti, 'BroughtFwdLossesSetoff'),
      num(bfla, 'TotalBFLossSetOff.TotBFLossSetoff'),
      'PartB-TI',
    );
    eq(
      945,
      "the balance after the year's losses must be the heads less the losses set off",
      num(ti, 'BalanceAfterSetoffLosses'),
      num(ti, 'TotalTI') - num(ti, 'CurrentYearLoss'),
      'PartB-TI',
    );
    eq(
      932,
      'gross total income must be the balance less brought-forward losses',
      num(ti, 'GrossTotalIncome'),
      num(ti, 'BalanceAfterSetoffLosses') - num(ti, 'BroughtFwdLossesSetoff'),
      'PartB-TI',
    );
    const via = r.ScheduleVIA?.DeductUndChapVIA;
    eq(
      942,
      'deductions of Parts B, CA and D must equal Schedule VI-A',
      num(ti, 'DeductionsUndSchVIADtl.PartBchapterVIA'),
      num(via, 'TotPartBchapterVIA') + num(via, 'TotPartCAandDchapterVIA'),
      'PartB-TI',
    );
    eq(
      943,
      'deductions of Part C must equal Schedule VI-A',
      num(ti, 'DeductionsUndSchVIADtl.PartCchapterVIA'),
      num(via, 'TotPartCchapterVIA'),
      'PartB-TI',
    );
    eq(
      944,
      'total deductions must be the sum of 12(a) and 12(b)',
      num(ti, 'DeductionsUndSchVIADtl.TotDeductUndSchVIA'),
      num(ti, 'DeductionsUndSchVIADtl.PartBchapterVIA') +
        num(ti, 'DeductionsUndSchVIADtl.PartCchapterVIA'),
      'PartB-TI',
    );
    eq(
      935,
      'total income must be gross total income less the Chapter VI-A deductions',
      num(ti, 'TotalIncome'),
      Math.max(
        0,
        num(ti, 'GrossTotalIncome') - num(ti, 'DeductionsUndSchVIADtl.TotDeductUndSchVIA'),
      ),
      'PartB-TI',
      5,
    );
    eq(
      946,
      'aggregate income must be total income less the income at special rates plus agricultural income',
      num(ti, 'AggregateIncome'),
      num(ti, 'TotalIncome') -
        num(ti, 'IncChargeTaxSplRate111A112') +
        num(r.ScheduleEI, 'NetAgriIncOrOthrIncRule7'),
      'PartB-TI',
    );
  }
  const tti = r.PartB_TTI;
  if (tti) {
    const cl = tti.ComputationOfTaxLiability ?? {};
    const t = cl.TaxPayableOnTI ?? {};
    eq(
      963,
      'tax payable on total income must be the normal tax plus special-rate tax less the agricultural rebate',
      num(t, 'TaxPayableOnTotInc'),
      num(t, 'TaxAtNormalRatesOnAggrInc') + num(t, 'TaxAtSpecialRates') - num(t, 'RebateOnAgriInc'),
      'PartB_TTI',
    );
    eq(
      964,
      'tax payable must be the tax on total income less the rebate under section 87A',
      num(t, 'TaxPayableOnRebate'),
      num(t, 'TaxPayableOnTotInc') - num(t, 'Rebate87A'),
      'PartB_TTI',
    );
    eq(
      965,
      'gross tax liability must be tax payable, surcharge and cess',
      num(t, 'GrossTaxLiability'),
      num(t, 'TaxPayableOnRebate') + num(t, 'TotalSurcharge') + num(t, 'EducationCess'),
      'PartB_TTI',
    );
    eq(
      968,
      'total tax relief must be the sum of the reliefs',
      num(cl, 'TaxRelief.TotTaxRelief'),
      num(cl, 'TaxRelief.Section89') + num(cl, 'TaxRelief.Section90_91'),
      'PartB_TTI',
    );
    eq(
      981,
      'net tax liability must be the tax payable less the relief',
      num(cl, 'NetTaxLiability'),
      num(cl, 'TaxPayAfterCreditUs115JD') - num(cl, 'TaxRelief.TotTaxRelief'),
      'PartB_TTI',
    );
    const ip = cl.IntrstPay ?? {};
    eq(
      969,
      'the interest and fee must be the sum of 234A, 234B, 234C and 234F',
      num(ip, 'IntrstPayUs234A') +
        num(ip, 'IntrstPayUs234B') +
        num(ip, 'IntrstPayUs234C') +
        num(ip, 'LateFilingFee234F'),
      num(cl, 'AggregateTaxInterestLiability') - num(cl, 'NetTaxLiability'),
      'PartB_TTI',
    );
    eq(
      970,
      'the aggregate liability must be the net tax liability plus the interest and fee',
      num(cl, 'AggregateTaxInterestLiability'),
      num(cl, 'NetTaxLiability') +
        num(ip, 'IntrstPayUs234A') +
        num(ip, 'IntrstPayUs234B') +
        num(ip, 'IntrstPayUs234C') +
        num(ip, 'LateFilingFee234F'),
      'PartB_TTI',
    );
    const tp = tti.TaxPaid?.TaxesPaid ?? {};
    eq(
      971,
      'total taxes paid must be advance tax, TDS, TCS and self-assessment tax',
      num(tp, 'TotalTaxesPaid'),
      num(tp, 'AdvanceTax') + num(tp, 'TDS') + num(tp, 'TCS') + num(tp, 'SelfAssessmentTax'),
      'PartB_TTI',
    );
    const diff = num(cl, 'AggregateTaxInterestLiability') - num(tp, 'TotalTaxesPaid');
    eq(
      976,
      'the refund must be the taxes paid less the aggregate liability',
      num(tti.Refund, 'RefundDue'),
      Math.max(0, -diff),
      'PartB_TTI',
      10,
    );
    eq(
      977,
      'the tax payable must be the aggregate liability less the taxes paid',
      num(tti.TaxPaid, 'BalTaxPayable'),
      Math.max(0, diff),
      'PartB_TTI',
      10,
    );
    eq(
      986,
      'TCS in Part B-TTI must equal Schedule TCS',
      num(tp, 'TCS'),
      num(r.ScheduleTCS, 'TotalSchTCS'),
      'PartB_TTI',
    );
    eq(
      987,
      'TDS in Part B-TTI must equal the TDS schedules',
      num(tp, 'TDS'),
      num(r.ScheduleTDS1, 'TotalTDSonSalaries') +
        num(r.ScheduleTDS2, 'TotalTDSonOthThanSals') +
        num(r.ScheduleTDS3, 'TotalTDSonOthThanSals'),
      'PartB_TTI',
    );
    eq(
      961,
      'the advance and self-assessment tax claimed must equal the challans in Schedule IT',
      num(tp, 'AdvanceTax') + num(tp, 'SelfAssessmentTax'),
      num(r.ScheduleIT, 'TotalTaxPayments'),
      'PartB_TTI',
    );
    if (get(r, 'PartA_GEN1.FilingStatus.OptOldRegimeCurrAY') === 'N')
      for (const k of ['TaxDeemedTISec115JC', 'SurchargeOnAboveCrore', 'EducationCess', 'TotalTax'])
        if (num(cl, `TaxPayableOnDeemedTI.${k}`) > 0)
          fail(
            983,
            'under the new tax regime the tax on deemed total income can not be above zero',
            'PartB_TTI',
          );
  }
  return out;
}
