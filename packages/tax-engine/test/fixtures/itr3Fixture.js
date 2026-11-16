// A realistic ITR-3 input for tests: a trader (proprietor) with books, a balanced balance sheet, an asset register.
import { computeBlocks } from '../../src/depreciation.ts';

export const taxpayer = (over = {}) => ({
  pan: 'ABCPK1234F',
  firstName: 'Ravi',
  surname: 'Kumar',
  fatherName: 'Suresh Kumar',
  dob: '1985-06-15',
  residenceNo: '12',
  residenceName: 'Lakshmi Nagar',
  roadOrStreet: '3rd Cross Street',
  locality: 'Adyar',
  city: 'Chennai',
  stateCode: '33',
  pinCode: '600020',
  mobile: '9876543210',
  email: 'ravi@example.com',
  employerCategory: 'NA',
  place: 'Chennai',
  bankAccounts: [
    { ifsc: 'HDFC0000123', bankName: 'HDFC Bank', accountNo: '50100123456789', accountType: 'SB', useForRefund: true },
  ],
  ...over,
});

export const assets = [
  { id: 'a1', name: 'Laptop', block: 'PM40', cost: 60000, putToUse: '2025-06-01' },
  { id: 'a2', name: 'Shop fittings', block: 'FF10', cost: 200000, putToUse: '2024-08-01' },
  { id: 'a3', name: 'Printer', block: 'PM40', cost: 20000, putToUse: '2026-01-15' },
];

/** Books of a trading business; every figure is whole rupees. */
export function books(over = {}) {
  return {
    saleOfGoods: 6_000_000,
    saleOfServices: 0,
    openingStock: 400_000,
    closingStock: 500_000,
    purchases: 4_500_000,
    carriageInward: 30_000,
    powerAndFuel: 20_000,
    otherDirectExpenses: [{ name: 'Packing material', amount: 10_000 }],
    interestIncome: 12_000,
    dividendIncome: 3_000,
    rentIncome: 0,
    commissionIncome: 0,
    profitOnSaleOfFixedAssets: 0,
    otherIncome: [{ name: 'Discount received', amount: 15_000 }],
    salariesAndWages: 360_000,
    rentPaid: 180_000,
    interestPaid: 40_000,
    bookDepreciation: 31_000,
    otherExpenses: [
      { name: 'Electricity', amount: 60_000 },
      { name: 'Telephone', amount: 18_000 },
      { name: 'Accountancy fee', amount: 25_000 },
    ],
    ...over,
  };
}

/** A balance sheet that balances for these books: capital is the balancing closing figure. */
export function balanceSheet(over = {}) {
  const base = {
    proprietorCapital: 0,
    securedLoansFromBanks: 300_000,
    securedLoansFromOthers: 0,
    unsecuredLoansFromBanks: 0,
    unsecuredLoansFromOthers: 100_000,
    advancesFromSpecifiedPersons: 0,
    advancesFromOthers: 20_000,
    grossBlock: 280_000,
    accumulatedDepreciation: 60_000,
    capitalWorkInProgress: 0,
    investments: 50_000,
    inventories: 500_000,
    sundryDebtors: 350_000,
    cashInHand: 40_000,
    bankBalances: 260_000,
    otherCurrentAssets: 0,
    loansAndAdvancesRecoverable: 10_000,
    deposits: 60_000,
    balanceWithRevenueAuthorities: 0,
    sundryCreditors: 280_000,
    otherCurrentLiabilities: 40_000,
    provisions: 0,
    ...over,
  };
  const assetsTotal =
    base.grossBlock - base.accumulatedDepreciation + base.capitalWorkInProgress + base.investments +
    base.inventories + base.sundryDebtors + base.cashInHand + base.bankBalances + base.otherCurrentAssets +
    base.loansAndAdvancesRecoverable + base.deposits + base.balanceWithRevenueAuthorities;
  const liabilities =
    base.securedLoansFromBanks + base.securedLoansFromOthers + base.unsecuredLoansFromBanks +
    base.unsecuredLoansFromOthers + base.advancesFromSpecifiedPersons + base.advancesFromOthers +
    base.sundryCreditors + base.otherCurrentLiabilities + base.provisions;
  if (!over.proprietorCapital) base.proprietorCapital = assetsTotal - liabilities;
  return base;
}

export const declarations = (over = {}) => ({
  houseProperty: false, capitalGains: false, foreignAssetsOrIncome: false, companyDirector: false,
  unlistedShares: false, partnerInFirm: false, carriedForwardLoss: false, agriculturalIncomeOver5000: false,
  cashDeposits1Crore: false, foreignTravel2Lakh: false, electricity1Lakh: false, manufacturingAccount: false,
  speculativeOrSpecifiedBusiness: false, nonResident: false, ...over,
});

export function itr3Input(over = {}) {
  return {
    fy: '2025-26',
    filedOn: '2026-07-20',
    regime: 'new',
    taxpayer: taxpayer(),
    business: { name: 'Kumar Stores', code: '09001', description: 'Retail trade', method: 'MERC', commencedOn: '2015-04-01' },
    books: books(),
    balanceSheet: balanceSheet(),
    adjustments: {},
    blocks: computeBlocks('2025-26', assets, []),
    declarations: declarations(),
    swCode: 'SW12345678',
    ...over,
  };
}
