// R2.5: the ITR-3 file, from the input (itr3Return.ts) and its computation. Field names are the department's (schema
// schemas/itr3/AY2026-27.json); the comments give the serial numbers of the department's validation rules each figure must
// satisfy (itr3Rules.ts re-checks them on the finished file).

import type { BlockYear } from './depreciation.ts';
import { schedule80D } from './itr4.ts';
import { itrRulesFor, type ItrYearRules } from './itrRules.ts';
import type { FilingIssue } from './filing.ts';
import {
  ITR3_SKELETON,
  auditDueDate,
  mergedOtherSources,
  type Itr3Computation,
  type Itr3Input,
} from './itr3Return.ts';

// The file is a schema-shaped document built and navigated by field name, so its nodes are untyped on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const int = (v: unknown) => Math.round(Number(v) || 0);
const pos = (v: unknown) => Math.max(0, int(v));
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const SW_DEFAULT = 'SW00000000';

const skeleton = () => clone(ITR3_SKELETON.sections) as Json;
const extra = (path: string): Json => clone((ITR3_SKELETON.extras as Json)[path]);

const dateRange = (q: number[]) => ({
  Upto15Of6: q[0] ?? 0,
  Up16Of6To15Of9: q[1] ?? 0,
  Up16Of9To15Of12: q[2] ?? 0,
  Up16Of12To15Of3: q[3] ?? 0,
  Up16Of3To31Of3: q[4] ?? 0,
});

/** Which DPM / DOA rate object a block belongs to. */
const DPM_KEY: Record<string, string> = {
  PM15: 'Rate15',
  PM30: 'Rate30',
  PM40: 'Rate40',
  PM45: 'Rate45',
};
const DOA_PATH: Record<string, [string, string]> = {
  BLD5: ['Building', 'Rate5'],
  BLD10: ['Building', 'Rate10'],
  BLD40: ['Building', 'Rate40'],
  FF10: ['FurnitureFittings', 'Rate10'],
  INT25: ['IntangibleAssets', 'Rate25'],
  SHIP20: ['Ships', 'Rate20'],
};

function depreciationDetail(
  b: BlockYear | undefined,
  withTotal: boolean,
  noAdditions = false,
): Json {
  const z = (k: keyof BlockYear) => (b ? (b[k] as number) : 0);
  const d: Json = {
    WDVFirstDay: z('WDVFirstDay'),
    ...(withTotal ? { Total: z('WDVFirstDay') } : {}),
    AdditionsGrThan180Days: z('AdditionsGrThan180Days'),
    RealizationTotalPeriod: z('RealizationTotalPeriod'),
    FullRateDeprAmt: z('FullRateDeprAmt'),
    AdditionsLessThan180Days: z('AdditionsLessThan180Days'),
    RealizationPeriodLessThan180days: z('RealizationPeriodLessThan180days'),
    HalfRateDeprAmt: z('HalfRateDeprAmt'),
    DepreciationAtFullRate: z('DepreciationAtFullRate'),
    DepreciationAtHalfRate: z('DepreciationAtHalfRate'),
    TotalDepreciation: z('TotalDepreciation'),
    DepDisAllowUs38_2: 0,
    NetAggregateDepreciation: z('NetAggregateDepreciation'),
    ProportionateAggDepreciation: z('ProportionateAggDepreciation'),
    ExpdrOnTrforSaleAsset: z('ExpdrOnTrforSaleAsset'),
    CapGainUs50: z('CapGainUs50'),
    WDVLastDay: z('WDVLastDay'),
  };
  // The 45% block (vehicles bought in 2019-20) takes no additions: its detail has no addition or half-rate lines.
  if (noAdditions)
    for (const key of [
      'AdditionsGrThan180Days',
      'AdditionsLessThan180Days',
      'RealizationPeriodLessThan180days',
      'HalfRateDeprAmt',
      'DepreciationAtHalfRate',
    ])
      delete d[key];
  return d;
}

/** The business and professional depreciation schedules: DPM (plant and machinery), DOA (other assets) and DEP (summary). */
function depreciationSchedules(blocks: BlockYear[]) {
  const by = new Map(blocks.map((b) => [b.block as string, b]));
  const dpm: Json = { PlantMachinery: {} };
  for (const [code, key] of Object.entries(DPM_KEY))
    dpm.PlantMachinery[key] = {
      DepreciationDetail: depreciationDetail(by.get(code), true, code === 'PM45'),
    };
  const doa: Json = {};
  const land = by.get('LAND');
  doa.Land = {
    DepreciationDetail: { WDVFirstDay: land?.WDVFirstDay ?? 0, WDVLastDay: land?.WDVLastDay ?? 0 },
  };
  for (const [code, [group, rate]] of Object.entries(DOA_PATH)) {
    doa[group] ??= {};
    doa[group][rate] = { DepreciationDetail: depreciationDetail(by.get(code), false) };
  }
  const dep = (code: string) => by.get(code)?.NetAggregateDepreciation ?? 0;
  const pm = { a: dep('PM15'), b: dep('PM30'), c: dep('PM40'), d: dep('PM45') };
  const bld = { a: dep('BLD5'), b: dep('BLD10'), c: dep('BLD40') };
  const total =
    sum(Object.values(pm)) + sum(Object.values(bld)) + dep('FF10') + dep('INT25') + dep('SHIP20');
  const depSched = {
    SummaryFromDeprSch: {
      PlantMachinerySummary: {
        DeprBlockTot15Percent: pm.a,
        DeprBlockTot30Percent: pm.b,
        DeprBlockTot40Percent: pm.c,
        DeprBlockTot45Percent: pm.d,
        TotPlntMach: sum(Object.values(pm)),
      },
      BuildingSummary: {
        DeprBlockTot5Percent: bld.a,
        DeprBlockTot10Percent: bld.b,
        DeprBlockTot40Percent: bld.c,
        TotBuildng: sum(Object.values(bld)),
      },
      FurnitureSummary: dep('FF10'),
      IntangibleAssetSummary: dep('INT25'),
      ShipsSummary: dep('SHIP20'),
      TotalDepreciation: total,
    },
  };
  return { dpm, doa, dep: depSched, total };
}

/** Whole-rupee turnover band the audit questions use. */
const turnoverBand = (t: number) =>
  t <= 10_000_000 ? 'Upto1CR' : t <= 100_000_000 ? 'Upto10CR' : 'MoreThan10CR';

/** The ITR-3 file for the schema of the year. `c` is `computeItr3(input)`. */
export function itr3Json(
  input: Itr3Input,
  c: Itr3Computation,
  rules: ItrYearRules = itrRulesFor(input.fy),
): Json {
  const t = input.taxpayer;
  const k = c.calc;
  const b = input.books;
  const s = input.balanceSheet;
  const adj = input.adjustments ?? {};
  const sw = input.swCode && /^SW\d{8}$/.test(input.swCode) ? input.swCode : SW_DEFAULT;
  const S = skeleton();
  const dep = depreciationSchedules(input.blocks);
  const audited = k.auditLiable;

  // ---- identity and the year ------------------------------------------------------------------------------------------------
  const out: Json = {
    CreationInfo: {
      SWVersionNo: '1.0',
      SWCreatedBy: sw,
      JSONCreatedBy: sw,
      JSONCreationDate: input.createdOn ?? input.filedOn,
      IntermediaryCity: t.city.slice(0, 25),
      Digest: '-',
    },
    Form_ITR3: {
      FormName: 'ITR-3',
      Description: 'Individuals and HUFs with business or professional income',
      AssessmentYear: rules.ay.slice(0, 4),
      SchemaVer: 'Ver1.0',
      FormVer: 'Ver1.0',
    },
  };

  const gen1: Json = {
    PersonalInfo: {
      AssesseeName: {
        ...(t.firstName ? { FirstName: t.firstName } : {}),
        ...(t.middleName ? { MiddleName: t.middleName } : {}),
        SurNameOrOrgName: t.surname,
      },
      PAN: t.pan.toUpperCase(),
      Address: {
        ResidenceNo: t.residenceNo,
        ...(t.residenceName ? { ResidenceName: t.residenceName } : {}),
        ...(t.roadOrStreet ? { RoadOrStreet: t.roadOrStreet } : {}),
        LocalityOrArea: t.locality,
        CityOrTownOrDistrict: t.city,
        StateCode: t.stateCode,
        CountryCode: '91',
        PinCode: Number(t.pinCode),
        CountryCodeMobile: 91,
        MobileNo: Number(t.mobile),
        EmailAddress: t.email,
      },
      SecondaryAdd: 'N',
      DOB: t.dob,
      Status: 'I',
      ...(input.business.commencedOn ? { DateofBusCommencement: input.business.commencedOn } : {}),
      ...(t.aadhaar ? { AadhaarCardNo: t.aadhaar } : {}),
    },
    FilingStatus: {
      ReturnFileSec: c.returnFileSection,
      IncFrmBusOrProf: 'Y',
      // The new regime is the default; leaving it takes Form 10-IEA (a person with business income can do so once).
      F10IEACurrAYNewRegime: 'N',
      F10IEACurrAYOldRegime: input.regime === 'old' && input.form10IEA ? 'Y' : 'N',
      ...(input.regime === 'old' && input.form10IEA
        ? {
            F10IEADateCurrAYOldTax: input.form10IEA.filedOn,
            F10IEAAckNoCurrAYOldTax: Number(input.form10IEA.ack),
          }
        : {}),
      OptOldRegimeCurrAY: input.regime === 'old' ? 'Y' : 'N',
      SeventhProvisio139: 'N',
      DepAmtAggAmtExcd1CrPrYrFlg: 'N',
      IncrExpAggAmt2LkTrvFrgnCntryFlg: 'N',
      IncrExpAggAmt1LkElctrctyPrYrFlg: 'N',
      clauseiv7provisio139i: 'N',
      ResidentialStatus: 'RES',
      AsseseeRepFlg: 'N',
      CompDirectorPrvYrFlg: 'N',
      PartnerInFirmFlg: 'N',
      HeldUnlistedEqShrPrYrFlg: 'N',
      ForeignExchangeFlag: 'N',
      FiiFpiFlag: 'N',
      ItrFilingDueDate: audited ? auditDueDate(rules) : rules.itr4DueDate,
    },
  };
  out.PartA_GEN1 = gen1;

  // Audit information (rules 13-17, 24, 25, 28-30, 39).
  const a = input.audit;
  const audit: Json = {
    LiableSec44AAflg: 'Y',
    IncDclrdUs: 'N',
    TotalSalesExcOneCr: turnoverBand(k.turnover),
    ...(turnoverBand(k.turnover) === 'Upto10CR'
      ? {
          AgrOFAllAmtsRcvd: (a?.cashReceiptsPct ?? 100) <= 5 ? 'Upto5Per' : 'MoreThan5Per',
          AgrOFAllPayMade: (a?.cashPaymentsPct ?? 100) <= 5 ? 'Upto5Per' : 'MoreThan5Per',
        }
      : {}),
    LiableSec44ABflg: audited ? 'Y' : 'N',
    ...(audited ? { Cndnfor44AB: 'bi' } : {}),
    ...(a?.audited
      ? {
          AuditAccountantFlg: 'Y',
          AuditReportFurnishDate: a.reportDate,
          AckNum44AB: Number(a.ack),
          AudFrmName: a.auditorName,
          AudFrmPAN: a.auditorPan,
        }
      : { AuditAccountantFlg: 'N' }),
    LiableSec92Eflg: 'N',
    AccountAuditFlag: 'N',
  };
  out.PartA_GEN2 = {
    AuditInfo: audit,
    NatOfBus: {
      NatureOfBusiness: [
        {
          Code: input.business.code,
          TradeName1: input.business.name.slice(0, 125),
          ...(input.business.description
            ? { Description: input.business.description.slice(0, 125) }
            : {}),
        },
      ],
    },
  };

  // ---- Part A balance sheet -----------------------------------------------------------------------------------------------
  const bs = S.PARTA_BS;
  const loansBank = pos(s.securedLoansFromBanks);
  const loansOth = pos(s.securedLoansFromOthers);
  const uBank = pos(s.unsecuredLoansFromBanks);
  const uOth = pos(s.unsecuredLoansFromOthers);
  const fs = bs.FundSrc;
  fs.PropFund.PropCap = int(s.proprietorCapital);
  fs.PropFund.TotPropFund = int(s.proprietorCapital); // rule 53
  fs.LoanFunds.SecrLoan.RupeeLoan = {
    FrmBank: loansBank,
    FrmOthrs: loansOth,
    TotRupeeLoan: loansBank + loansOth,
  };
  fs.LoanFunds.SecrLoan.TotSecrLoan = loansBank + loansOth;
  fs.LoanFunds.UnsecrLoan = { FrmBank: uBank, FrmOthrs: uOth, TotUnSecrLoan: uBank + uOth };
  fs.LoanFunds.TotLoanFund = loansBank + loansOth + uBank + uOth; // rule 54
  const advSpec = pos(s.advancesFromSpecifiedPersons);
  const advOth = pos(s.advancesFromOthers);
  fs.Advances = { FromPrsn: advSpec, FromOthers: advOth, TotalAdvances: advSpec + advOth }; // rule 60
  fs.TotFundSrc = k.fundsSource; // rule 55
  const fa = bs.FundApply;
  fa.FixedAsset = {
    GrossBlock: pos(s.grossBlock),
    Depreciation: pos(s.accumulatedDepreciation),
    NetBlock: k.netBlock,
    CapWrkProg: pos(s.capitalWorkInProgress),
    TotFixedAsset: k.netBlock + pos(s.capitalWorkInProgress),
  };
  fa.Investments.LongTermInv.GovOthSecUnQoted = pos(s.investments);
  fa.Investments.LongTermInv.TotLongTermInv = pos(s.investments);
  fa.Investments.TotInvestments = pos(s.investments); // rule 56
  const ca = fa.CurrAssetLoanAdv;
  ca.CurrAsset.Inventories.FinOrTradGood = pos(s.inventories);
  ca.CurrAsset.Inventories.TotInventries = pos(s.inventories);
  ca.CurrAsset.SndryDebtors = pos(s.sundryDebtors);
  const cashBank = pos(s.cashInHand) + pos(s.bankBalances);
  ca.CurrAsset.CashOrBankBal = {
    CashinHand: pos(s.cashInHand),
    BankBal: pos(s.bankBalances),
    TotCashOrBankBal: cashBank,
  };
  ca.CurrAsset.OthCurrAsset = pos(s.otherCurrentAssets);
  const totCurrAsset =
    pos(s.inventories) + pos(s.sundryDebtors) + cashBank + pos(s.otherCurrentAssets);
  ca.CurrAsset.TotCurrAsset = totCurrAsset; // rule 57
  const loansAdv =
    pos(s.loansAndAdvancesRecoverable) + pos(s.deposits) + pos(s.balanceWithRevenueAuthorities);
  ca.LoanAdv = {
    AdvRecoverable: pos(s.loansAndAdvancesRecoverable),
    Deposits: pos(s.deposits),
    BalWithRevAuth: pos(s.balanceWithRevenueAuthorities),
    TotLoanAdv: loansAdv,
  };
  ca.TotCurrAssetLoanAdv = totCurrAsset + loansAdv;
  // The form has no line for other current liabilities: they are shown with sundry creditors.
  const creditors = pos(s.sundryCreditors) + pos(s.otherCurrentLiabilities);
  ca.CurrLiabilitiesProv.CurrLiabilities = {
    SundryCred: creditors,
    LiabForLeasedAsset: 0,
    AccrIntonLeasedAsset: 0,
    AccrIntNotDue: 0,
    TotCurrLiabilities: creditors,
  };
  ca.CurrLiabilitiesProv.Provisions = {
    ITProvision: 0,
    ELSuperAnnGratProvision: 0,
    OthProvision: pos(s.provisions),
    TotProvisions: pos(s.provisions),
  };
  ca.CurrLiabilitiesProv.TotCurrLiabilitiesProvision = creditors + pos(s.provisions);
  ca.NetCurrAsset = ca.TotCurrAssetLoanAdv - ca.CurrLiabilitiesProv.TotCurrLiabilitiesProvision; // rule 58
  fa.TotFundApply =
    fa.FixedAsset.TotFixedAsset +
    fa.Investments.TotInvestments +
    ca.NetCurrAsset +
    fa.MiscAdjust.TotMiscAdjust; // rule 59
  out.PARTA_BS = bs;

  // ---- Part A trading account (rules 69-79) -------------------------------------------------------------------------------------
  const ta = S.TradingAccount;
  Object.assign(ta, {
    SaleOfGoods: pos(b.saleOfGoods),
    SaleOfServices: pos(b.saleOfServices),
    OperatingRevenueTotal: 0,
    SalesGrossReceiptsTotal: k.revenue, // rule 70
    GrossRcptFromProfession: 0,
    TotRevenueFrmOperations: k.revenue, // rule 72 (duties and taxes are not collected into revenue)
    ClsngStckOfFinishedStcks: pos(b.closingStock),
    TardingAccTotCred: k.tradingCredits,
    OpngStckOfFinishedStcks: pos(b.openingStock),
    Purchases: pos(b.purchases),
    DirectExpenses: k.directExpenses,
    CarriageInward: pos(b.carriageInward),
    PowerAndFuel: pos(b.powerAndFuel),
    ...(b.otherDirectExpenses.length
      ? {
          OtherIncDtls: b.otherDirectExpenses
            .filter((x) => pos(x.amount) > 0)
            .map((x) => ({ NatureOfIncome: x.name.slice(0, 125), Amount: pos(x.amount) })),
        }
      : {}),
    DirectExpensesTotal: k.directExpenses, // rule 73
    GrossProfitFrmBusProf: k.grossProfit, // rule 75
  });
  ta.ExciseCustomsVAT = { ...(ta.ExciseCustomsVAT ?? {}), TotExciseCustomsVAT: 0 };
  out.TradingAccount = ta;

  // ---- Part A profit and loss account (rules 80-98) -------------------------------------------------------------------------------
  const pl = S.PARTA_PL;
  const oi = pl.CreditsToPL.OthIncome;
  const miscItems = b.otherIncome.filter((x) => pos(x.amount) > 0);
  Object.assign(oi, {
    RentInc: pos(b.rentIncome),
    Comissions: pos(b.commissionIncome),
    Dividends: pos(b.dividendIncome),
    InterestInc: pos(b.interestIncome),
    ProfitOnSaleFixedAsset: pos(b.profitOnSaleOfFixedAssets),
    ...(miscItems.length
      ? {
          OtherIncDtls: miscItems.map((x) => ({
            NatureOfIncome: x.name.slice(0, 125),
            Amount: pos(x.amount),
          })),
        }
      : {}),
    MiscOthIncome: sum(miscItems.map((x) => pos(x.amount))),
    TotOthIncome: k.otherIncomeTotal, // rule 81
  });
  pl.CreditsToPL.GrossProfitTrnsfFrmTrdAcc = k.grossProfit;
  pl.CreditsToPL.TotCreditsToPL = k.totalCredits; // rule 82
  const db = pl.DebitsToPL;
  db.EmployeeComp.SalsWages = pos(b.salariesAndWages);
  db.EmployeeComp.TotEmployeeComp = pos(b.salariesAndWages); // rule 84
  db.RentExpdr = pos(b.rentPaid);
  const others = b.otherExpenses.filter((x) => pos(x.amount) > 0);
  if (others.length)
    db.OtherExpensesDtls = others.map((x) => ({
      ExpenseNature: x.name.slice(0, 125),
      Amount: pos(x.amount),
    }));
  db.OtherExpenses = k.otherExpensesTotal; // rule 90
  db.PBIDTA = k.pbidta; // rule 92
  db.InterestExpdrtDtls = {
    NonResOtherCompany: 0,
    Others: pos(b.interestPaid),
    InterestExpdr: pos(b.interestPaid),
  }; // rule 93
  db.DepreciationAmort = pos(b.bookDepreciation);
  db.PBT = k.profitBeforeTax; // rule 94
  pl.TaxProvAppr = {
    ProvForCurrTax: 0,
    ProvDefTax: 0,
    ProfitAfterTax: k.profitBeforeTax, // rule 95
    BalBFPrevYr: 0,
    AmtAvlAppr: k.profitBeforeTax, // rule 96
    TrfToReserves: 0,
    ProprietorAccBalTrf: k.profitBeforeTax, // rule 97
  };
  out.PARTA_PL = pl;

  // ---- Part A other information (rules 148-159) ------------------------------------------------------------------------------------
  const poi = S.PARTA_OI;
  poi.MethodOfAcct = input.business.method;
  poi.AmtDisallUs36.OthDisallowances = k.oi.s36;
  poi.AmtDisallUs36.TotAmtDisallUs36 = k.oi.s36; // rule 153
  poi.AmtDisallUs37.PersonalExp = pos(adj.personalExpenses);
  poi.AmtDisallUs37.OthAmtNotAllowUs37 = pos(adj.otherNotAllowedUs37);
  poi.AmtDisallUs37.TotAmtDisallUs37 = k.oi.s37; // rule 154
  poi.AmtDisallUs40.OthDisallow = k.oi.s40;
  poi.AmtDisallUs40.TotAmtDisallUs40 = k.oi.s40; // rule 155
  poi.AmtDisallUs40A.AmtGT20kCash = k.oi.s40A;
  poi.AmtDisallUs40A.TotAmtDisallUs40A = k.oi.s40A; // rule 156
  const dues = (src: Record<string, number> | undefined) => {
    const o: Json = {};
    let total = 0;
    const map: Record<string, string> = {
      taxDutyCess: 'TaxDutyCesAmt',
      pfEsiContribution: 'ContToEmpPFSFGF',
      bonusCommission: 'EmpBonusComm',
      interestToFinancialInstitution: 'IntPayaleToFI',
      loanFromFinancialCompany: 'SumPayaleLoanBrToFinComp',
      interestToScheduledBank: 'IntPayaleToFISchBank',
      leaveEncashment: 'LeaveEncashPayable',
      msePayable: 'MSEPayable',
    };
    for (const [key, field] of Object.entries(map)) {
      o[field] = pos(src?.[key]);
      total += o[field];
    }
    o.TotAmtUs43b = total;
    return o;
  };
  poi.AmtDisall43B.AmtUs43B = dues(adj.unpaid43B as Record<string, number> | undefined); // rule 158
  poi.AmtDisallUs43BPyNowAll.AmtUs43B = dues(
    adj.paid43BOfEarlierYears as Record<string, number> | undefined,
  ); // rule 157
  poi.ProfTaxAmtUs41 = k.oi.s41;
  poi.ScheduleTPSAFlg = 'N';
  out.PARTA_OI = poi;

  // ---- Schedule BP (rules 237-302) --------------------------------------------------------------------------------------------------
  const bpS = S.ITR3ScheduleBP;
  const bp = bpS.BusinessIncOthThanSpec;
  bp.ProfBfrTaxPL = k.profitBeforeTax; // rule 237
  bp.NetPLFromSpecBus = 0;
  bp.NetPLFromSpecifiedBus = 0;
  bp.IncRecCredPLOthHeadDtls = {
    Salary: 0,
    HouseProperty: 0,
    CapitalGains: 0,
    OtherSources: k.otherSourcesCredited,
    Dividend: pos(b.dividendIncome),
    OtherThanDividend: pos(b.interestIncome) + pos(b.rentIncome), // rules 288, 291
    Us115BBF: 0,
    Us115BBG: 0,
    '115BBH': 0,
  };
  bp.BalancePLOthThanSpecBus = k.balancePl; // rule 244
  bp.ExpDebToPLOthHeadDtls = {
    Salary: 0,
    HouseProperty: 0,
    CapitalGains: 0,
    OtherSources: 0,
    Us115BBF: 0,
    Us115BBG: 0,
    '115BBH': 0,
  };
  bp.TotExpDebPL = 0; // rule 245
  bp.AdjustedPLOthThanSpecBus = k.balancePl; // rule 246
  bp.DepreciationDebPLCosAct = k.bookDepreciation; // rule 271
  bp.DepreciationAllowITAct32 = {
    DepreciationAllowUs32_1_ii: dep.total,
    DepreciationAllowUs32_1_i: 0,
    TotDeprAllowITAct: dep.total, // rules 240, 247
  };
  bp.AdjustPLAfterDeprOthSpecInc = k.adjustedForDepreciation; // rule 248
  bp.AmtDebPLDisallowUs36 = k.oi.s36; // rule 251
  bp.AmtDebPLDisallowUs37 = k.oi.s37; // rule 252
  bp.AmtDebPLDisallowUs40 = k.oi.s40; // rule 253
  bp.AmtDebPLDisallowUs40A = k.oi.s40A; // rule 254
  bp.AmtDebPLDisallowUs43B = k.oi.s43B; // rule 255
  bp.InterestDisAllowUs23SMEAct = 0;
  bp.DeemIncUs41 = k.oi.s41; // rule 256
  bp.TotAfterAddToPLDeprOthSpecInc = k.addbacks; // rule 249 (the sum of the additions A14 to A25)
  bp.DeductUs32_1_iii = 0;
  bp.DebPLUs35ExcessAmt = 0;
  bp.AmtDisallUs40NowAllow = 0;
  bp.AmtDisallUs43BNowAllow = k.oi.s43BPrior; // rule 260
  bp.AnyOthAmtAllDeduct = 0;
  bp.DecProfIncLossAccICDSAdj = 0;
  bp.TotDeductionAmts = k.deductions; // rule 250
  bp.PLAftAdjDedBusOthThanSpec = k.businessIncome; // rule 262
  bp.DeemedProfitBusUs.TotDeemedProfitBusUs = 0; // rule 263
  bp.NetPLAftAdjBusOthThanSpec = k.businessIncome; // rule 264
  bp.NetPLBusOthThanSpec7A7B7C = k.businessIncome;
  bp.IncomeOtherThanRule = k.businessIncome; // rule 265
  bpS.IncChrgUnHdProftGain = k.businessIncome; // rule 269 (D)
  // Set-off of a business loss against other sources (rules 274-276): there is no speculative or specified income here.
  bpS.BusSetoffCurrYr.LossSetOffOnBusLoss = 0;
  out.ITR3ScheduleBP = bpS;

  // Depreciation schedules.
  out.ScheduleDPM = dep.dpm;
  out.ScheduleDOA = dep.doa;
  out.ScheduleDEP = dep.dep;

  // ---- Salary (Schedule S) -------------------------------------------------------------------------------------------------------
  if (c.grossSalary > 0 && input.salary?.employer) {
    const e = input.salary.employer;
    const row = extra('ScheduleS.Salaries[]');
    Object.assign(row, {
      NameOfEmployer: e.name.slice(0, 125),
      NatureOfEmployment: e.nature === 'NA' ? 'OTH' : e.nature,
      AddressDetail: {
        AddrDetail: e.address.slice(0, 200),
        CityOrTownOrDistrict: e.city.slice(0, 50),
        StateCode: e.stateCode,
      },
      Salarys: {
        GrossSalary: c.grossSalary,
        Salary: c.grossSalary,
        ValueOfPerquisites: 0,
        ProfitsinLieuOfSalary: 0,
      },
    });
    out.ScheduleS = {
      ...S.ScheduleS,
      Salaries: [row],
      TotalGrossSalary: c.grossSalary,
      AllwncExtentExemptUs10: 0,
      NetSalary: c.grossSalary,
      DeductionUS16: c.salaryDeduction16,
      DeductionUnderSection16ia: c.standardDeduction,
      EntertainmntalwncUs16ii: 0,
      ProfessionalTaxUs16iii: c.professionalTax,
      TotIncUnderHeadSalaries: c.incomeFromSalary,
    };
  }

  // ---- Other sources (Schedule OS) ---------------------------------------------------------------------------------------------------
  const m = mergedOtherSources(input);
  const quarters = m.quarters;
  const otherOs = m.other.map((o) => ({ d: o.description, a: o.amount }));
  const osTotal =
    m.savings +
    m.deposits +
    m.refund +
    m.interestFromBooks +
    m.dividend +
    m.rentFromBooks +
    sum(otherOs.map((o) => o.a));
  if (osTotal > 0) {
    const iot = extra('ScheduleOS.IncOthThanOwnRaceHorse');
    const intAll = m.savings + m.deposits + m.refund + m.interestFromBooks;
    const otherSum = sum(otherOs.map((o) => o.a));
    Object.assign(iot, {
      DividendGross: m.dividend,
      DividendOthThan22e: m.dividend,
      Dividend22e: 0,
      InterestGross: intAll,
      IntrstFrmSavingBank: m.savings,
      IntrstFrmTermDeposit: m.deposits,
      IntrstFrmIncmTaxRefund: m.refund,
      IntrstFrmOthers: m.interestFromBooks,
      RentFromMachPlantBldgs: m.rentFromBooks,
      AnyOtherIncome: otherSum,
      ...(otherOs.length
        ? {
            OthersInc: {
              OthersIncDtls: otherOs.map((o) => ({
                OthNatOfInc: o.d.slice(0, 50),
                OthAmount: o.a,
              })),
            },
          }
        : {}),
      GrossIncChrgblTaxAtAppRate: osTotal,
      BalanceNoRaceHorse: osTotal,
    });
    out.ScheduleOS = {
      ...S.ScheduleOS,
      IncOthThanOwnRaceHorse: iot,
      TotOthSrcNoRaceHorse: osTotal,
      IncChargeable: osTotal,
      DividendIncUs115BBDA: { DateRange: dateRange(quarters) },
    };
  }

  // ---- Loss set-off (Schedules CYLA and BFLA) -----------------------------------------------------------------------------------
  const cyla = S.ScheduleCYLA;
  const bfla = S.ScheduleBFLA;
  const businessUnder = k.businessIncome; // negative when a loss
  const osUnder = osTotal;
  const salaryUnder = c.incomeFromSalary;
  const setOff = c.businessLossSetOff;
  cyla.Salary = {
    IncCYLA: { IncOfCurYrUnderThatHead: salaryUnder, IncOfCurYrAfterSetOff: salaryUnder },
  };
  // The schedule takes the year's income under a head as a figure of zero or more; a business loss is the TotBusLoss line below.
  cyla.BusProfExclSpecProf = {
    IncCYLA: {
      IncOfCurYrUnderThatHead: Math.max(0, businessUnder),
      IncOfCurYrAfterSetOff: Math.max(0, businessUnder),
    },
  };
  cyla.OthSrcExclRaceHorse = {
    IncCYLA: { IncOfCurYrUnderThatHead: osUnder, IncOfCurYrAfterSetOff: c.incomeOtherSources },
  };
  cyla.TotalCurYr = {
    TotHPlossCurYr: 0,
    TotBusLoss: Math.max(0, -businessUnder),
    TotOthSrcLossNoRaceHorse: 0,
  };
  cyla.TotalLossSetOff = {
    TotHPlossCurYrSetoff: 0,
    TotBusLossSetoff: setOff,
    TotOthSrcLossNoRaceHorseSetoff: 0,
  };
  cyla.LossRemAftSetOff = {
    BalHPlossCurYrAftSetoff: 0,
    BalBusLossAftSetoff: c.lossCarriedForward,
    BalOthSrcLossNoRaceHorseAftSetoff: 0,
  };
  out.ScheduleCYLA = cyla;
  const bf = (head: string, v: number) => {
    bfla[head] = {
      IncBFLA: {
        IncOfCurYrUndHeadFromCYLA: v,
        BFUnabsorbedDeprSetoff: 0,
        BFAllUs35Cl4Setoff: 0,
        IncOfCurYrAfterSetOffBFLosses: v,
      },
    };
  };
  bfla.Salary = {
    IncBFLA: { IncOfCurYrUndHeadFromCYLA: salaryUnder, IncOfCurYrAfterSetOffBFLosses: salaryUnder },
  };
  bf('BusProfExclSpecProf', Math.max(0, businessUnder));
  bf('OthSrcExclRaceHorse', c.incomeOtherSources);
  bfla.TotalBFLossSetOff = {
    TotBFLossSetoff: 0,
    TotUnabsorbedDeprSetoff: 0,
    TotAllUs35cl4Setoff: 0,
  };
  bfla.IncomeOfCurrYrAftCYLABFLA = c.grossTotalIncome;
  out.ScheduleBFLA = bfla;

  // ---- Chapter VI-A deductions --------------------------------------------------------------------------------------------------
  const user: Json = { ...S.ScheduleVIA.UsrDeductUndChapVIA };
  const via: Json = { ...S.ScheduleVIA.DeductUndChapVIA };
  const setVia = (key: string, claimed: number, allowedAmt: number) => {
    if (claimed || allowedAmt) {
      user[key] = claimed;
      via[key] = allowedAmt;
    }
  };
  setVia('Section80CCDEmployer', c.claimed['80CCD2'] ?? 0, c.allowed['80CCD2'] ?? 0);
  setVia('Section80C', c.claimed['80C'] ?? 0, c.allowed['80C'] ?? 0);
  setVia('Section80CCD1B', c.claimed['80CCD1B'] ?? 0, c.allowed['80CCD1B'] ?? 0);
  setVia('Section80D', c.claimed['80D'] ?? 0, c.allowed['80D'] ?? 0);
  setVia('Section80TTA', c.claimed['80TTA'] ?? 0, c.allowed['80TTA'] ?? 0);
  setVia('Section80TTB', c.claimed['80TTB'] ?? 0, c.allowed['80TTB'] ?? 0);
  const partB = (o: Json) =>
    sum(
      [
        'Section80C',
        'Section80CCC',
        'Section80CCDEmployeeOrSE',
        'Section80CCD1B',
        'Section80CCDEmployer',
        'Section80D',
        'Section80DD',
        'Section80DDB',
        'Section80E',
        'Section80EE',
        'Section80EEA',
        'Section80EEB',
        'Section80G',
        'Section80GG',
        'Section80GGA',
        'Section80GGC',
      ].map((x) => o[x] ?? 0),
    );
  const partCA = (o: Json) =>
    sum(['Section80TTA', 'Section80TTB', 'Section80U', 'AnyOthSec80CCH'].map((x) => o[x] ?? 0));
  for (const o of [user, via]) {
    o.TotPartBchapterVIA = partB(o);
    o.TotPartCchapterVIA = 0;
    o.TotPartCAandDchapterVIA = partCA(o);
    o.TotalChapVIADeductions =
      o.TotPartBchapterVIA + o.TotPartCchapterVIA + o.TotPartCAandDchapterVIA;
  }
  out.ScheduleVIA = { UsrDeductUndChapVIA: user, DeductUndChapVIA: via };

  // ---- Part B-TI and Part B-TTI ---------------------------------------------------------------------------------------------------
  const afterSetoff = Math.max(0, businessUnder);
  out['PartB-TI'] = {
    ...S['PartB-TI'],
    Salaries: c.incomeFromSalary,
    IncomeFromHP: 0,
    ProfBusGain: {
      ProfGainNoSpecBus: afterSetoff,
      ProfGainSpecBus: 0,
      ProfGainSpecifiedBus: 0,
      ProfIncome115BBF: 0,
      TotProfBusGain: afterSetoff,
    },
    // Heads are shown before the set-off of the year's loss (rules 919, 927); the loss set off is item 7, the balance item 8.
    IncFromOS: {
      OtherSrcThanOwnRaceHorse: osTotal,
      IncChargblSplRate: 0,
      FromOwnRaceHorse: 0,
      TotIncFromOS: osTotal,
    },
    TotalTI: c.incomeFromSalary + afterSetoff + osTotal,
    CurrentYearLoss: c.businessLossSetOff,
    BalanceAfterSetoffLosses: c.grossTotalIncome,
    BroughtFwdLossesSetoff: 0,
    GrossTotalIncome: c.grossTotalIncome,
    IncChargeTaxSplRate111A112: 0,
    DeductionsUndSchVIADtl: {
      PartBchapterVIA: via.TotPartBchapterVIA + via.TotPartCAandDchapterVIA, // 12(a): Parts B, CA and D (rule 942)
      PartCchapterVIA: via.TotPartCchapterVIA,
      TotDeductUndSchVIA: c.totalDeductions,
    },
    DeductionsUnder10Aor10AA: 0,
    TotalIncome: c.totalIncome,
    AggregateIncome: c.totalIncome,
    DeemedIncomeUs115JC: 0,
  };
  const tti = S.PartB_TTI;
  const cl = tti.ComputationOfTaxLiability;
  Object.assign(cl.TaxPayableOnTI, {
    TaxAtNormalRatesOnAggrInc: c.taxOnTotalIncome,
    TaxAtSpecialRates: 0,
    RebateOnAgriInc: 0,
    TaxPayableOnTotInc: c.taxOnTotalIncome,
    Rebate87A: c.rebate87A,
    TaxPayableOnRebate: c.taxAfterRebate,
    TotalSurcharge: c.surcharge,
    EducationCess: c.cess,
    GrossTaxLiability: c.grossTaxLiability,
  });
  cl.GrossTaxPayable = c.grossTaxLiability;
  cl.CreditUS115JD = 0;
  cl.TaxPayAfterCreditUs115JD = c.grossTaxLiability;
  cl.TaxRelief = { TotTaxRelief: 0 };
  cl.NetTaxLiability = c.netTaxLiability;
  cl.IntrstPay = {
    IntrstPayUs234A: c.interest234A,
    IntrstPayUs234B: c.interest234B,
    IntrstPayUs234C: c.interest234C,
    LateFilingFee234F: c.fee234F,
  };
  cl.AggregateTaxInterestLiability = c.totalTaxAndInterest;
  tti.TaxPaid = {
    TaxesPaid: {
      AdvanceTax: c.advanceTaxPaid,
      TDS: c.tdsTotal,
      TCS: c.tcsTotal,
      SelfAssessmentTax: c.selfAssessmentTaxPaid,
      TotalTaxesPaid: c.totalTaxesPaid,
    },
    BalTaxPayable: c.balanceTaxPayable,
  };
  tti.Refund = {
    RefundDue: c.refundDue,
    BankAccountDtls: {
      BankDtlsFlag: 'Y',
      AddtnlBankDetails: t.bankAccounts.map((x) => ({
        IFSCCode: x.ifsc,
        BankName: x.bankName,
        BankAccountNo: x.accountNo,
        AccountType: x.accountType,
        UseForRefund: String(x.useForRefund),
      })),
    },
  };
  tti.AssetOutIndiaFlag = 'NO';
  out.PartB_TTI = tti;

  if (c.claimed['80C'] && input.deductions?.sec80C?.length)
    out.Schedule80C = {
      Schedule80CDtls: input.deductions.sec80C.map((r) => ({
        IdentificationNo: r.id.slice(0, 50),
        Amount: pos(r.amount),
      })),
      TotalAmt: c.claimed['80C'],
    };
  if (input.deductions?.sec80D && c.claimed['80D'])
    out.Schedule80D = schedule80D(input.deductions.sec80D);

  // ---- Tax paid and credits ---------------------------------------------------------------------------------------------------------
  const challans = input.challans ?? [];
  if (challans.length)
    out.ScheduleIT = {
      TaxPayment: challans.map((x) => ({
        BSRCode: x.bsr,
        DateDep: x.date,
        SrlNoOfChaln: x.serial,
        Amt: pos(x.amount),
      })),
      TotalTaxPayments: sum(challans.map((x) => pos(x.amount))),
    };
  const sal = input.salary?.tds ?? [];
  if (sal.length)
    out.ScheduleTDS1 = {
      TDSonSalary: sal.map((x) => ({
        EmployerOrDeductorOrCollectDetl: { TAN: x.tan, EmployerOrDeductorOrCollecterName: x.name },
        IncChrgSal: pos(x.income),
        TotalTDSSal: pos(x.tds),
      })),
      TotalTDSonSalaries: sum(sal.map((x) => pos(x.tds))),
    };
  const oth = input.tds ?? [];
  if (oth.length)
    out.ScheduleTDS2 = {
      TDSOthThanSalaryDtls: oth.map((r) => ({
        TDSCreditName: 'S',
        TANOfDeductor: r.tan,
        TDSSection: r.section,
        TaxDeductCreditDtls: { TaxClaimedOwnHands: pos(r.tdsClaimed) },
        AmtCarriedFwd: Math.max(0, pos(r.tdsDeducted) - pos(r.tdsClaimed)),
      })),
      TotalTDSonOthThanSals: sum(oth.map((r) => pos(r.tdsClaimed))),
    };
  const tcs = input.tcs ?? [];
  if (tcs.length)
    out.ScheduleTCS = {
      TCS: tcs.map((x) => ({
        TCSCreditOwner: '1',
        EmployerOrDeductorOrCollectTAN: x.tan,
        AmtCarriedFwd: Math.max(0, pos(x.tcs) - pos(x.claimed)),
        TCSClaimedThisYearDtls: { TCSAmtCollOthrHands: undefined },
      })),
      TotalSchTCS: sum(tcs.map((x) => pos(x.claimed))),
    };

  // GST turnover by registration.
  const g = input.business.gstTurnover ?? [];
  if (g.length)
    out.ScheduleGST = {
      TurnoverGrsRcptForGSTIN: g.map((x) => ({
        GSTINNo: x.gstin.toUpperCase(),
        AmtTurnGrossRcptGSTIN: pos(x.amount),
      })),
    };

  out.Verification = {
    Declaration: {
      AssesseeVerName: [t.firstName, t.middleName, t.surname]
        .filter(Boolean)
        .join(' ')
        .slice(0, 125),
      FatherName: t.fatherName,
      AssesseeVerPAN: t.pan.toUpperCase(),
    },
    Capacity: 'S',
    Date: input.filedOn,
    Place: t.place.slice(0, 50),
  };
  return { ITR: { ITR3: JSON.parse(JSON.stringify(out)) } };
}

export type { FilingIssue };
