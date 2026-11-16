// R2.5 (docs/FEATURE_GAPS_2026-11.md): the books of a year in the terms ITR-3 Part A asks for: the trading and profit and loss
// accounts and the balance sheet, read from the ledger, with the fixed assets from the asset register. The ledger is the single
// source: whatever it holds is what the return says, and where the asset register disagrees with it the return is not changed,
// the difference is reported. Nothing here is guessed: an account that cannot be placed under a head goes under "other".
import { and, eq, gte, lte } from 'drizzle-orm';
import { schema, type Tx } from '@ledgora/db';
import {
  ACC,
  balanceSheet,
  bookRegister,
  fyBounds,
  profitAndLoss,
  type FilingIssue,
  type FixedAsset,
  type Itr3BalanceSheet,
  type Itr3Books,
  type NamedAmount,
} from '@ledgora/tax-engine';
import { dayBefore, stockFigures, totalsWithGroup } from '../reports/shared.ts';

const { ledgerEntries } = schema;
const whole = (v: number) => Math.round(v);
const issue = (
  severity: FilingIssue['severity'],
  code: string,
  message: string,
  path?: string,
): FilingIssue => ({
  id: `${code}:${path ?? message}`,
  severity,
  code,
  message,
  ...(path ? { path } : {}),
});

interface Line {
  code?: string;
  name: string;
  amount: number;
}
const sum = (xs: Line[]) => xs.reduce((s, x) => s + x.amount, 0);
const named = (xs: Line[]): NamedAmount[] =>
  xs.filter((x) => whole(x.amount) !== 0).map((x) => ({ name: x.name, amount: whole(x.amount) }));

/** The year's profit and loss account from the ledger, with stock at weighted-average cost (the Profit & Loss report's). */
export async function pnlOfYear(tx: Tx, businessId: string, fy: string) {
  const { start, end } = fyBounds(fy);
  const accts = await totalsWithGroup(tx, businessId, start, end);
  const stock = await stockFigures(tx, end, dayBefore(start));
  return profitAndLoss({
    accounts: accts,
    openingStock: stock.before,
    closingStock: stock.closing,
  });
}

export interface Itr3BooksResult {
  books: Itr3Books;
  balanceSheet: Itr3BalanceSheet;
  issues: FilingIssue[];
  /** The ledger's own net profit, which the return's profit before tax must equal. */
  ledgerNetProfit: number;
}

export async function itr3BooksOf(
  tx: Tx,
  businessId: string,
  fy: string,
  opts: { servicesTurnover: number; loansAreSecured: boolean; assets: FixedAsset[] },
): Promise<Itr3BooksResult> {
  const issues: FilingIssue[] = [];
  const { end } = fyBounds(fy);
  const pnl = await pnlOfYear(tx, businessId, fy);

  // ---- trading and profit and loss account
  const salesTotal = sum(pnl.directIncome);
  const services = Math.min(Math.max(0, opts.servicesTurnover), Math.max(0, salesTotal));
  const buys = pnl.directExpenses.filter(
    (l) => l.code === ACC.PURCHASES || l.code === ACC.PURCHASE_RETURN,
  );
  const directOther = pnl.directExpenses.filter((l) => !buys.includes(l));
  const carriage = directOther.filter((l) => /freight|carriage|cartage|transport/i.test(l.name));
  const power = directOther.filter(
    (l) => !carriage.includes(l) && /power|fuel|electric/i.test(l.name),
  );
  const directRest = directOther.filter((l) => !carriage.includes(l) && !power.includes(l));

  const inc = pnl.indirectIncome;
  const interestInc = inc.filter((l) => /interest/i.test(l.name));
  const dividendInc = inc.filter((l) => !interestInc.includes(l) && /dividend/i.test(l.name));
  const rentInc = inc.filter(
    (l) => !interestInc.includes(l) && !dividendInc.includes(l) && /\brent/i.test(l.name),
  );
  const commissionInc = inc.filter(
    (l) => ![...interestInc, ...dividendInc, ...rentInc].includes(l) && /commission/i.test(l.name),
  );
  const saleOfAssets = inc.filter(
    (l) =>
      ![...interestInc, ...dividendInc, ...rentInc, ...commissionInc].includes(l) &&
      /profit on sale|gain on sale/i.test(l.name),
  );
  const otherInc = inc.filter(
    (l) =>
      ![...interestInc, ...dividendInc, ...rentInc, ...commissionInc, ...saleOfAssets].includes(l),
  );

  const exp = pnl.indirectExpenses;
  const dep = exp.filter((l) => /depreciation|amortis/i.test(l.name));
  const salary = exp.filter((l) => !dep.includes(l) && /salar|wage|bonus|payroll/i.test(l.name));
  const rent = exp.filter(
    (l) =>
      ![...dep, ...salary].includes(l) &&
      /\brent\b/i.test(l.name) &&
      !/received|income/i.test(l.name),
  );
  const interest = exp.filter(
    (l) =>
      ![...dep, ...salary, ...rent].includes(l) &&
      (l.code === ACC.LOAN_INTEREST || /interest/i.test(l.name)),
  );
  const otherExp = exp.filter((l) => ![...dep, ...salary, ...rent, ...interest].includes(l));

  // A negative income line (a loss) is an expense, and a negative expense line (a gain) is income, so the profit is unchanged.
  const lossesInIncome = otherInc
    .filter((l) => l.amount < 0)
    .map((l) => ({ ...l, amount: -l.amount }));
  const gainsInExpense = otherExp
    .filter((l) => l.amount < 0)
    .map((l) => ({ ...l, amount: -l.amount }));

  const books: Itr3Books = {
    saleOfGoods: whole(salesTotal - services),
    saleOfServices: whole(services),
    openingStock: whole(pnl.totals.openingStock),
    closingStock: whole(pnl.totals.closingStock),
    purchases: whole(sum(buys)),
    carriageInward: whole(sum(carriage)),
    powerAndFuel: whole(sum(power)),
    otherDirectExpenses: named(directRest),
    interestIncome: whole(sum(interestInc)),
    dividendIncome: whole(sum(dividendInc)),
    rentIncome: whole(sum(rentInc)),
    commissionIncome: whole(sum(commissionInc)),
    profitOnSaleOfFixedAssets: whole(sum(saleOfAssets)),
    otherIncome: named([...otherInc.filter((l) => l.amount > 0), ...gainsInExpense]),
    salariesAndWages: whole(sum(salary)),
    rentPaid: whole(sum(rent)),
    interestPaid: whole(sum(interest)),
    bookDepreciation: whole(sum(dep)),
    otherExpenses: named([...otherExp.filter((l) => l.amount > 0), ...lossesInIncome]),
  };

  // The register's depreciation for the year should already be in the books.
  const register = bookRegister(
    opts.assets.filter((a) => a.putToUse <= end),
    fy,
  );
  if (Math.abs(register.depreciation - books.bookDepreciation) > 1)
    issues.push(
      issue(
        'warning',
        'ITR3_DEP_NOT_POSTED',
        `The asset register works out depreciation of ₹${whole(register.depreciation).toLocaleString('en-IN')} for the year but the books show ₹${books.bookDepreciation.toLocaleString('en-IN')}. Post the register's depreciation as a journal so the profit and loss account and the balance sheet carry it`,
        'books.bookDepreciation',
      ),
    );

  // ---- balance sheet at the year end
  const accts = await totalsWithGroup(tx, businessId, undefined, end);
  const stock = await stockFigures(tx, end);
  const groupOf = new Map(accts.map((a) => [a.code, a.group]));
  const [closed] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.businessId, businessId),
        eq(ledgerEntries.refType, 'fy_close'),
        gte(ledgerEntries.txnDate, fyBounds(fy).start),
        lte(ledgerEntries.txnDate, end),
      ),
    )
    .limit(1);
  const bs = balanceSheet({
    accounts: accts,
    closingStock: stock.closing,
    openingStock: stock.initial,
    currentProfit: closed ? 0 : pnl.totals.netProfit,
  });

  const out: Itr3BalanceSheet = {
    proprietorCapital: 0,
    securedLoansFromBanks: 0,
    securedLoansFromOthers: 0,
    unsecuredLoansFromBanks: 0,
    unsecuredLoansFromOthers: 0,
    advancesFromSpecifiedPersons: 0,
    advancesFromOthers: 0,
    grossBlock: 0,
    accumulatedDepreciation: 0,
    capitalWorkInProgress: 0,
    investments: 0,
    inventories: 0,
    sundryDebtors: 0,
    cashInHand: 0,
    bankBalances: 0,
    otherCurrentAssets: 0,
    loansAndAdvancesRecoverable: 0,
    deposits: 0,
    balanceWithRevenueAuthorities: 0,
    sundryCreditors: 0,
    otherCurrentLiabilities: 0,
    provisions: 0,
  };
  const loan = (l: Line, amount: number) => {
    const bank = /bank|hdfc|icici|sbi|axis|kotak|canara|pnb|union|idfc|yes bank/i.test(l.name);
    if (opts.loansAreSecured)
      out[bank ? 'securedLoansFromBanks' : 'securedLoansFromOthers'] += amount;
    else out[bank ? 'unsecuredLoansFromBanks' : 'unsecuredLoansFromOthers'] += amount;
  };
  let fixedNet = 0;
  for (const l of bs.assets) {
    const group = l.code ? (groupOf.get(l.code) ?? '') : 'Inventory'; // the closing stock line has no account
    const v = l.amount;
    if (group === 'Fixed assets') fixedNet += v;
    else if (v < 0) {
      // A negative asset is owed: an overdrawn bank is a bank loan, a customer's advance is an advance received.
      if (group === 'Bank') out.securedLoansFromBanks += -v;
      else if (group === 'Receivables') out.advancesFromOthers += -v;
      else out.otherCurrentLiabilities += -v;
    } else if (group === 'Cash') out.cashInHand += v;
    else if (group === 'Bank') out.bankBalances += v;
    else if (group === 'Receivables') out.sundryDebtors += v;
    else if (group === 'Inventory') out.inventories += v;
    else if (group === 'Duties & taxes') out.balanceWithRevenueAuthorities += v;
    else if (group === 'Loans') out.loansAndAdvancesRecoverable += v;
    else out.otherCurrentAssets += v;
  }
  for (const l of bs.liabilities) {
    const group = l.code ? (groupOf.get(l.code) ?? '') : '';
    const v = l.amount;
    if (v < 0) {
      // A debit balance among the liabilities is money due to the business.
      if (group === 'Payables') out.loansAndAdvancesRecoverable += -v;
      else out.otherCurrentAssets += -v;
    } else if (group === 'Payables') out.sundryCreditors += v;
    else if (group === 'Loans') loan(l, v);
    else if (/provision/i.test(l.name)) out.provisions += v;
    else out.otherCurrentLiabilities += v;
  }
  // Proprietor's capital is whatever balances the sheet: capital accounts, drawings, retained profit, this year's profit, and
  // any difference in opening balances (which is shown, never hidden).
  const liabilitiesSide = sum(bs.liabilities);
  out.proprietorCapital = whole(bs.totals.liabilities - liabilitiesSide);
  if (bs.suspense.length)
    issues.push(
      issue(
        'warning',
        'ITR3_OPENING_DIFFERENCE',
        `The books carry a difference in opening balances of ₹${whole(Math.abs(bs.suspense[0]!.amount)).toLocaleString('en-IN')}, which is included in the proprietor's capital. Run Verify My Data to find it`,
        'balanceSheet',
      ),
    );

  // Fixed assets: the ledger is the truth; the register supplies the cost and depreciation split when it agrees with it.
  const alive = opts.assets.filter(
    (a) => a.putToUse <= end && !(a.disposal && a.disposal.date <= end),
  );
  const regRows = bookRegister(alive, fy);
  const registerNet = regRows.netBlock;
  const ledgerNet = whole(fixedNet);
  if (alive.length && Math.abs(registerNet - ledgerNet) <= 1) {
    out.grossBlock = whole(regRows.grossBlock);
    out.accumulatedDepreciation = whole(regRows.accumulated);
  } else {
    out.grossBlock = Math.max(0, ledgerNet);
    if (alive.length || ledgerNet !== 0)
      issues.push(
        issue(
          'warning',
          'ITR3_ASSETS_DIFFER',
          `The asset register's net block is ₹${whole(registerNet).toLocaleString('en-IN')} but the books' fixed assets are ₹${ledgerNet.toLocaleString('en-IN')}. The balance sheet follows the books (net block, no depreciation split); record the purchases and the depreciation journal so the two agree`,
          'balanceSheet.fixedAssets',
        ),
      );
  }
  return { books, balanceSheet: out, issues, ledgerNetProfit: pnl.totals.netProfit };
}
