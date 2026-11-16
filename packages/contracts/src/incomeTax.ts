import { z } from 'zod';
import { uuid } from './common.ts';

// R2 (docs/FEATURE_GAPS_2026-11.md): income tax. Requests for the taxpayer profile, the return's inputs, challans, advance
// tax, AIS / TIS imports and the ITR-4 build. The engine (packages/tax-engine) does the maths and the checks; these only
// say what may be sent.

const fy = z.string().regex(/^\d{4}-\d{2}$/, 'Use a financial year like 2025-26');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rupees = z.number().finite().min(0).max(99_999_999_999);
const text = (max: number) => z.string().trim().max(max);

export const EMPLOYER_CATEGORIES = [
  'CGOV',
  'SGOV',
  'PSU',
  'PE',
  'PESG',
  'PEPS',
  'PEO',
  'OTH',
  'NA',
] as const;
export const ACCOUNT_TYPES = ['SB', 'CA', 'CC', 'OD', 'NRO', 'OTH'] as const;

/** A bank account on the profile. An existing one is kept by its id; a new one needs its number. */
export const taxpayerBankAccount = z.object({
  id: uuid.optional(),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC is 4 letters, a zero, then 6 letters or digits'),
  bankName: text(125).min(1),
  /** Blank on an existing account keeps the number already saved. */
  accountNo: text(20).optional(),
  accountType: z.enum(ACCOUNT_TYPES).default('SB'),
  useForRefund: z.boolean().default(false),
});

export const taxpayerProfileBody = z.object({
  businessId: uuid,
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN is 5 letters, 4 digits and a letter'),
  firstName: text(25).default(''),
  middleName: text(25).default(''),
  surname: text(75).min(1, 'The surname (or full name) is needed'),
  fatherName: text(125).min(1, 'The father’s name is needed'),
  dob: isoDate,
  residenceNo: text(50).default(''),
  residenceName: text(50).default(''),
  roadOrStreet: text(50).default(''),
  locality: text(50).default(''),
  city: text(50).default(''),
  stateCode: z
    .string()
    .regex(/^(0[1-9]|[1-2][0-9]|3[0-7]|99)?$/)
    .default(''),
  pinCode: z
    .string()
    .regex(/^([1-9][0-9]{5})?$/)
    .default(''),
  mobile: z
    .string()
    .regex(/^([1-9][0-9]{9})?$/)
    .default(''),
  email: text(125).default(''),
  /** 12 digits; blank keeps the number already saved, `clearAadhaar` removes it. */
  aadhaar: z
    .string()
    .regex(/^([0-9]{12})?$/, 'Aadhaar is 12 digits')
    .default(''),
  clearAadhaar: z.boolean().default(false),
  employerCategory: z.enum(EMPLOYER_CATEGORIES).default('NA'),
  place: text(50).default(''),
  bankAccounts: z.array(taxpayerBankAccount).max(10).default([]),
  form10Iea: z
    .object({ ack: z.string().regex(/^[0-9]{15}$/, '15 digits'), filedOn: isoDate })
    .nullable()
    .default(null),
});

const tdsRow = z.object({
  tan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, 'TAN is 4 letters, 5 digits and a letter'),
  name: text(125).min(1),
  section: text(10).min(1),
  gross: rupees,
  tdsDeducted: rupees,
  tdsClaimed: rupees,
  headOfIncome: z.enum(['BP', 'HP', 'OS', 'EI', 'NA']).default('BP'),
});
const particulars = z
  .object({
    partnerMemberOwnCapital: rupees,
    securedLoans: rupees,
    unsecuredLoans: rupees,
    advances: rupees,
    sundryCreditors: rupees,
    othrCurrLiab: rupees,
    fixedAssets: rupees,
    investments: rupees,
    inventories: rupees,
    sundryDebtors: rupees,
    balWithBanks: rupees,
    cashInHand: rupees,
    loansAndAdvances: rupees,
    otherAssets: rupees,
  })
  .partial();
const premium = z.object({ insurer: text(125).min(1), policy: text(75).min(1), amount: rupees });

const dues43B = z
  .object({
    taxDutyCess: rupees,
    pfEsiContribution: rupees,
    bonusCommission: rupees,
    interestToFinancialInstitution: rupees,
    loanFromFinancialCompany: rupees,
    interestToScheduledBank: rupees,
    leaveEncashment: rupees,
    msePayable: rupees,
  })
  .partial();

/** What the person enters for an ITR-3 (books-based) return; the ledger, the asset register and the profile supply the rest. */
export const itr3DraftData = z.object({
  business: z.object({
    name: text(125).default(''),
    /** The nature-of-business code of the schema (five digits). */
    code: text(10).default(''),
    description: text(125).default(''),
    commencedOn: isoDate.optional(),
    method: z.enum(['MERC', 'CASH']).default('MERC'),
  }),
  /** The part of the year's sales that is services, not goods (the ledger holds one sales account). */
  servicesTurnover: rupees.default(0),
  /** Items the Income-tax Act treats differently from the books (they feed Part A-OI and Schedule BP). */
  adjustments: z
    .object({
      personalExpenses: rupees,
      otherNotAllowedUs37: rupees,
      otherNotAllowedUs36: rupees,
      notAllowedUs40: rupees,
      cashPaymentsUs40A3: rupees,
      unpaid43B: dues43B,
      paid43BOfEarlierYears: dues43B,
      deemedIncomeUs41: rupees,
    })
    .partial()
    .default({}),
  audit: z
    .object({
      audited: z.boolean().default(false),
      reportDate: isoDate.optional(),
      ack: z
        .string()
        .regex(/^([0-9]{15})?$/, '15 digits')
        .optional(),
      auditorName: text(125).optional(),
      auditorPan: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, 'PAN is 5 letters, 4 digits and a letter')
        .optional(),
      cashReceiptsPct: z.number().min(0).max(100).optional(),
      cashPaymentsPct: z.number().min(0).max(100).optional(),
    })
    .default({ audited: false }),
  /** The ledger has loan accounts but not whether they are secured; this says how to show them. */
  loansAreSecured: z.boolean().default(false),
  /** Where the salary comes from, when there is salary (Schedule S names the employer). */
  employer: z
    .object({
      name: text(125).min(1),
      address: text(200).min(1),
      city: text(50).min(1),
      stateCode: z.string().regex(/^(0[1-9]|[1-2][0-9]|3[0-7])$/),
    })
    .nullable()
    .default(null),
  declarations: z
    .object({
      houseProperty: z.boolean().default(false),
      capitalGains: z.boolean().default(false),
      foreignAssetsOrIncome: z.boolean().default(false),
      companyDirector: z.boolean().default(false),
      unlistedShares: z.boolean().default(false),
      partnerInFirm: z.boolean().default(false),
      carriedForwardLoss: z.boolean().default(false),
      agriculturalIncomeOver5000: z.boolean().default(false),
      cashDeposits1Crore: z.boolean().default(false),
      foreignTravel2Lakh: z.boolean().default(false),
      electricity1Lakh: z.boolean().default(false),
      manufacturingAccount: z.boolean().default(false),
      speculativeOrSpecifiedBusiness: z.boolean().default(false),
      nonResident: z.boolean().default(false),
    })
    .default({
      houseProperty: false,
      capitalGains: false,
      foreignAssetsOrIncome: false,
      companyDirector: false,
      unlistedShares: false,
      partnerInFirm: false,
      carriedForwardLoss: false,
      agriculturalIncomeOver5000: false,
      cashDeposits1Crore: false,
      foreignTravel2Lakh: false,
      electricity1Lakh: false,
      manufacturingAccount: false,
      speculativeOrSpecifiedBusiness: false,
      nonResident: false,
    }),
});
export type Itr3DraftData = z.infer<typeof itr3DraftData>;

/** What the person enters for one return; the profile, the challans and the books supply the rest. */
export const itrDraftData = z.object({
  /** Which return is being prepared: the presumptive ITR-4, or the books-based ITR-3. */
  form: z.enum(['itr4', 'itr3']).default('itr4'),
  /** Only for ITR-3. */
  itr3: itr3DraftData.nullable().default(null),
  regime: z.enum(['new', 'old']).default('new'),
  business: z
    .object({
      section: z.enum(['44AD', '44ADA']),
      code: text(10).default(''),
      name: text(75).default(''),
      description: text(75).default(''),
      digitalReceipts: rupees.default(0),
      cashReceipts: rupees.default(0),
      declaredIncome: rupees.optional(),
      particulars: particulars.optional(),
    })
    .nullable()
    .default(null),
  salary: z
    .object({
      gross: rupees,
      basicAndDa: rupees.optional(),
      professionalTax: rupees.optional(),
      tds: z
        .array(
          z.object({ tan: tdsRow.shape.tan, name: text(125).min(1), income: rupees, tds: rupees }),
        )
        .max(20)
        .default([]),
    })
    .nullable()
    .default(null),
  otherSources: z
    .object({
      savingsInterest: rupees.default(0),
      depositInterest: rupees.default(0),
      refundInterest: rupees.default(0),
      dividend: z.tuple([rupees, rupees, rupees, rupees, rupees]).default([0, 0, 0, 0, 0]),
      other: z
        .array(z.object({ description: text(125).min(1), amount: rupees }))
        .max(20)
        .default([]),
    })
    .default({
      savingsInterest: 0,
      depositInterest: 0,
      refundInterest: 0,
      dividend: [0, 0, 0, 0, 0],
      other: [],
    }),
  deductions: z
    .object({
      sec80C: z
        .array(z.object({ id: text(50).min(1), amount: rupees }))
        .max(30)
        .default([]),
      sec80CCD1B: rupees.default(0),
      sec80CCD2: rupees.default(0),
      sec80D: z
        .object({
          selfSenior: z.boolean().default(false),
          selfPremiums: z.array(premium).max(10).default([]),
          selfCheckup: rupees.default(0),
          selfMedical: rupees.default(0),
          parentsSenior: z.boolean().default(false),
          parentsPremiums: z.array(premium).max(10).default([]),
          parentsCheckup: rupees.default(0),
          parentsMedical: rupees.default(0),
        })
        .optional(),
      claimInterestDeduction: z.boolean().default(true),
    })
    .default({ sec80C: [], sec80CCD1B: 0, sec80CCD2: 0, claimInterestDeduction: true }),
  tds: z.array(tdsRow).max(200).default([]),
  tcs: z
    .array(
      z.object({ tan: tdsRow.shape.tan, name: text(125).min(1), tcs: rupees, claimed: rupees }),
    )
    .max(50)
    .default([]),
  declarations: z
    .object({
      houseProperty: z.boolean().default(false),
      capitalGains: z.boolean().default(false),
      foreignAssetsOrIncome: z.boolean().default(false),
      companyDirector: z.boolean().default(false),
      unlistedShares: z.boolean().default(false),
      carriedForwardLoss: z.boolean().default(false),
      agriculturalIncomeOver5000: z.boolean().default(false),
      section44AE: z.boolean().default(false),
    })
    .default({
      houseProperty: false,
      capitalGains: false,
      foreignAssetsOrIncome: false,
      companyDirector: false,
      unlistedShares: false,
      carriedForwardLoss: false,
      agriculturalIncomeOver5000: false,
      section44AE: false,
    }),
});
export type ItrDraftData = z.infer<typeof itrDraftData>;

export const itrDraftBody = z.object({ businessId: uuid, fy, data: itrDraftData });
export const itrQuery = z.object({ businessId: uuid, fy });

export const taxChallanBody = z.object({
  businessId: uuid,
  /** The financial year the payment is for (the challan states the assessment year). */
  fy,
  bsr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{3}[0-9A-Z]{4}$/, 'BSR code is 7 characters'),
  date: isoDate,
  serial: z.number().int().min(0).max(99999),
  amount: z.number().positive().max(99_999_999_999),
  note: text(200).default(''),
});
export const taxChallanPatch = taxChallanBody.omit({ businessId: true }).partial();
export const taxChallanQuery = z.object({ businessId: uuid, fy: fy.optional() });

export const advanceTaxQuery = z.object({
  businessId: uuid,
  fy,
  /** The day to plan from (default today, Indian time). */
  asOf: isoDate.optional(),
});

export const AIS_ROW_CATEGORIES = [
  'tds',
  'tcs',
  'salary',
  'interest_savings',
  'interest_deposits',
  'dividend',
  'rent',
  'securities',
  'property',
  'gst_turnover',
  'foreign',
  'refund_interest',
  'other',
] as const;
export const aisRow = z.object({
  category: z.enum(AIS_ROW_CATEGORIES),
  description: text(300),
  source: text(200).default(''),
  sourceId: text(30).default(''),
  reported: z.number().finite(),
  accepted: z.number().finite().default(0),
  tds: z.number().finite().default(0),
  section: text(20).default(''),
});
/** A file's text, sent to be read and shown back before anything is saved. */
export const aisPreviewBody = z.object({ text: z.string().min(1).max(5_000_000) });
/** `send: false` only shows what would be shared. */
export const aisFormatReportBody = z.object({
  text: z.string().min(1).max(5_000_000),
  send: z.boolean().default(false),
});
export const aisImportBody = z.object({
  businessId: uuid,
  fy,
  kind: z.enum(['ais', 'tis']),
  fileName: text(200).default(''),
  rows: z.array(aisRow).min(1).max(5000),
});

export const buildItr3Body = z.object({
  businessId: uuid,
  fy,
  /** The day the return will be filed: it decides the late fee, interest under 234A and the filing section. */
  filedOn: isoDate,
});
export const buildItr4Body = z.object({
  businessId: uuid,
  fy,
  /** The day the return will be filed: it decides the late fee, interest under 234A and the filing section. */
  filedOn: isoDate,
});
