# Accounting: the ledger, its postings and the period lock

Written for Vyapar parity Phase 4 (see `VYAPAR_IMPLEMENTATION_PHASES.md`, P4-S1…S7). It explains what the ledger holds, how
a document becomes entries, how a correction works, and what locks a period. The code is `packages/tax-engine/src/posting.ts`
(the rules, pure), `apps/api/src/modules/ledgerRules.ts` (writing them), `ledgerBackfill.ts`, `ledger.ts`, `verify.ts`.

## What it is

Every business can switch on a **ledger** (`business_settings.preferences.accounting.ledger`). With it on, each invoice,
purchase, payment and expense is also written as balanced **ledger entries** in the same database transaction as the document.
With it off nothing is written and the app behaves exactly as before. The entries make Trial Balance, party statements and
the Cash & Bank, P&L and Balance Sheet reports of later phases plain queries over one table.

Ledger-lite (decision D-06): double entry underneath, a short fixed chart, parties as sub-ledgers of two control accounts,
stock **not** posted per movement (closing stock is valued at report time, weighted average only, D-11).

## Accounts

`accounts` holds the chart of a business. Enabling the ledger seeds the default chart (idempotent), then accounts appear
on demand: `1101…` for a bank account the first time a payment names it, `5101…` for an expense category the first time an
expense uses it. `1190 Bank (not assigned to an account)` takes UPI, bank and card money until bank accounts exist (Phase 5).
Parties are not accounts: a party's ledger is the Receivable (`1300`) or Payable (`2000`) account filtered by `party_id`.
A system account can be renamed but never deleted or recoded; an account with entries is switched off, not deleted.

## Entries and vouchers

A **voucher** is one balanced set of lines (`voucher_id`). A document may have several (a sale and each payment taken with
it). Each `ledger_entries` row has exactly one non-zero side, a date, an account, optional party and narration, the financial
year, and the document it belongs to (`ref_type`, `ref_id`).

The database enforces it, not just the code: a check refuses a row with both sides, and a **deferred constraint trigger**
refuses to commit any voucher whose debits and credits differ (so a posting bug rolls the document back too). The role the
API runs as has **no UPDATE or DELETE on `ledger_entries`** (migration 0011), so nothing, however buggy, can rewrite history.

## Posting rules

| Document | Entries |
|---|---|
| Sale (tax invoice, bill of supply, composition) | Dr Receivable (total) · Cr Output CGST/SGST/IGST/Cess · Cr TCS Payable · Cr Additional Charges Income · Cr/Dr Round-off · Cr Sales (the rest, so a discount on the whole bill lowers Sales) |
| Money taken with a sale | per row: Dr Cash / Bank / Cheques in Hand · Cr Receivable |
| Credit note | Dr Sales Return · Dr Output tax · Cr Receivable; a cash or bank refund: Dr Receivable · Cr Cash/Bank |
| Payment In | Dr Cash/Bank/Cheques in Hand · Dr TDS Receivable (TDS the customer kept) · Dr Discount Allowed · Cr Receivable (all three) |
| Purchase bill | Dr Purchases (taxable, with charges) · Dr Input GST (credit claimed) · Dr Ineligible GST expensed (the rest) · Cr Payable · Cr TDS Payable (§194Q); money paid with it: Dr Payable · Cr Cash/Bank |
| Reverse charge | the supplier is owed the value without the tax; the tax is Cr RCM Payable and the credit is still claimed (see decision D-13) |
| Debit note | Dr Payable · Cr Purchase Return · Cr Input GST (credit reversed on what goes back) · Cr Ineligible GST expensed; a cash or bank refund: Dr Cash/Bank · Cr Payable |
| Payment Out | Dr Payable (paid + TDS + discount) · Cr Cash/Bank/Cheques Issued · Cr TDS Payable · Cr Discount Received |
| Expense | Dr its category account (and the GST when not claimed) · Dr Input GST · Cr Cash/Bank for what was paid · Cr Payable (the payee) for the rest |
| Other income | Dr Cash/Bank and Receivable · Cr Other Income · Cr Output GST (not for exempt income) |
| TDS deposit (challan) | Dr TDS Payable · Cr Bank |
| Party opening balance | positive: Dr Receivable · Cr Opening Balance Equity; negative: Dr Opening Balance Equity · Cr Payable |
| Journal | whatever the user enters, if it balances |

Quotations, sale orders, proformas, delivery challans, purchase orders and cancelled documents post nothing. Transfers,
loans, cheque events and adjustments have their rules written and tested (`postTransfer`, `postLoanPayment`, `postChequeEvent`,
`postAdjustment`) but their documents arrive in Phase 5.

## Corrections: repost

Nothing is edited. `repost(document)` finds the document's active vouchers, writes a **reversal** of each (the same lines
with sides swapped, `reversal_of` pointing at the original, dated like the original so a period nets to zero), then writes
the new postings. If the new postings are identical to the current ones it writes nothing, so saving an edit that changes no
money, or running a backfill twice, leaves the ledger as it is.

Edit = reverse + post. Cancel and delete = reverse only. Trash restore = post again. A payment that is removed for good is
unposted first. The account ledger hides a reversed pair by default and shows it with **Show reversals**.

## Turning it on: backfill

*Accounting › Ledger setup*, or `POST /v1/accounting/backfill`. **Step 1, check** (a dry run) seeds nothing and writes nothing
but tells you what would happen: documents, vouchers, problems, whether the trial balance balances, and whether every
party's ledger balance equals the balance worked out from the documents (by an independent rule, not by the posting
functions). **Step 2** turns it on, only if the check is clean (or you force it). A dry run and the real run are the same
code: the real work runs inside a savepoint that is rolled back for a dry run or for a run with differences, so the two
always agree and a half-posted ledger is never left behind. Running it again is safe ("Post history again" also picks up
changed party opening balances).

From the command line (same code, run as the app role inside the business's tenant):

```sh
pnpm --filter @ledgora/api backfill:ledger -- --business <id> [--dry-run] [--from 2024-04-01] [--org <id>]
```

It prints the document and voucher counts, the trial balance, and a table of every party whose ledger balance differs from
its documents (plus any document that could not be posted, with its id). The CLI has **no `--force`**: with any difference
or problem it keeps nothing, leaves the ledger off and exits 1. `--org` is needed only when the database role in
`DATABASE_URL` is not a superuser (row-level security hides the business otherwise).

## Verify My Data

*Utilities › Verify My Data* (`GET /v1/verify`) runs 13 checks: negative stock, invoice totals, over-allocated payments,
invoice number gaps and duplicates, invalid GSTINs, missing HSN/SAC, unbalanced or missing ledger entries, orphan stock
movements, party balances ledger vs documents, future-dated documents, duplicate parties. The ledger checks, and
over-allocation, have an automatic fix (`POST /v1/verify/:check/fix`): it is idempotent and audited.

## Period lock

A write is refused (`409 period_locked`) when its date is on or before the **lock date**, inside a **closed financial year**,
or in a **GST month marked filed** (unless "a filed GST month does not lock the books" is on). It applies to invoices,
purchases, purchase orders (on conversion), payments, expenses, journals and account opening balances, on create, edit
and delete. The owner may save into a locked period by giving a reason (the editor asks for it; elsewhere send the header
`x-override-reason`); the override is written to the audit log. The check is made by each module before it writes, not
inside `repost`, so the owner's override applies and a backfill can still post old documents.

## Limits to know

* The ledger is built from the **typed API tables** (`invoices`, `purchases`, `payments`, `expenses`). The web screens still
  save their documents in the workspace store, so a business that has only used those screens has nothing to post yet.
  Moving each screen onto the typed API (the migration the project is doing feature by feature) is what fills the ledger.
  Documents written some other way show up in Verify as "missing from the ledger" and the fix posts them.
* Changing a party's opening balance does not repost it by itself; Verify flags it and Post history again fixes it.
* Parties belong to the organization, so a party's opening balance is posted into whichever business is backfilled.

## Cash & Bank (Phase 5)

Switched on per business in *Cash & Bank* (`PUT /v1/cashbank/settings`), only once the ledger is on. Every balance on
those screens is read from the ledger, so they always agree with the Trial Balance.

| Document | Entries |
|---|---|
| Bank account opening balance | Dr the bank (1101…) / Cr Opening Balance Equity; negative (overdrawn) the other way |
| Deposit / Withdraw on a bank | cash taken to or from the bank (default): a transfer with Cash in Hand; or Dr bank / Cr Owner's Capital; or Dr Owner's Drawings (Bank Charges, a chosen account) / Cr bank |
| Adjust cash or bank | Dr/Cr the account against Opening Balance Equity (Other Income or Cash Over / Short when counted as income) |
| Day-end count | the difference only, against Cash Over / Short; an equal count posts nothing |
| Transfer | Dr destination / Cr source; a fee is Dr Bank Charges / Cr source |
| Cheque | its payment posts Dr Cheques in Hand / Cr Receivable (issued: Dr Payable / Cr Cheques Issued); cleared: Dr Bank / Cr Cheques in Hand (issued: Dr Cheques Issued / Cr Bank); bounced or cancelled: the payment is voided (reversed, invoices reopen); bounce charges Dr Receivable / Cr Other Income, or Dr Bank Charges / Cr Bank |
| Loan received | Dr bank (less any processing fee) and Dr Bank Charges (fee) / Cr the loan account (2301…) |
| Loan payment | Dr loan (principal), Dr Loan Interest, Dr Bank Charges / Cr TDS Payable (§194A, non-bank lenders past ₹10,000 of interest in the year) / Cr bank or cash for the rest |
| Increase Loan (top-up) | Dr bank (less charges) and Dr Bank Charges / Cr the loan account |

The cheque state machine (received: open → deposited → cleared / bounced, open → cancelled; issued: open → cleared /
bounced / cancelled) and the loan schedule are pure functions in `packages/tax-engine` (`cheque.ts`, `loan.ts`). A loan's
schedule is rebuilt from its terms and all its payments, so the loan account's balance always equals what the schedule
says is outstanding. Reconciliation ticks bank ledger entries off against statement rows (`bank_recon`); it never
changes the books.

India-specific checks: a cheque is stale three months after its date and can not be presented; a bounced received
cheque shows its NI Act §138 dates; loans taken or repaid in cash at ₹20,000 or more (§269SS / §269T) need a typed,
audited acknowledgement; cash paid to one party above ₹10,000 in a day is flagged (§40A(3)); housing and education loans
feed §24(b), §80C and §80E in the Regime Calculator. See the Phase 5 notes in `DECISIONS.md`.
Reports: Bank Statement, Loan Statement and Cheque Register (`/reports/cash-bank/:id`) read the same entries and
export to PDF, Excel and CSV. For the GST 180-day rule, a supplier paid by cheque counts as paid when the cheque clears.

## Reports (Phase 6, core)

`/reports` lists every report; each opens at `/reports/:id`, filters, totals and exports. The ledger reports read the
same entries as everything above: **Day Book** and **Cash Flow** (closing = the Cash & Bank total), **Party Statement**
(closing = the party's ledger balance), **Trial Balance**, **Profit & Loss** and **Balance Sheet**. Stock is not
posted, so the P&L takes opening and closing stock at weighted-average cost and the Balance Sheet carries closing stock
as an asset, with the stock items were opened with as capital. Profit reports need the `report:profit` permission.

Interest credited to a lender before it is paid ("Credit interest" on a loan) keeps §194A TDS on the day of credit and
sits in Interest Payable (2420) until a payment clears it.


## Point of Sale (Phase 12)

A counter bill is a tax invoice saved through the same path as any sale (`POST /v1/pos/sales` → `createInvoice`), so with
the ledger on it posts in the same transaction: Dr Cash / Bank (the amount kept, never the cash handed over) and Dr
Accounts Receivable for what is left on credit, Cr Sales and Cr output GST; stock leaves with the invoice. Free quantity
and a bill discount reduce the taxable value, so GST is on what is charged. Loyalty points are not money and are not
posted; the points a bill spends take the same amount off its taxable value. Cancelling a bill reverses all of it.
