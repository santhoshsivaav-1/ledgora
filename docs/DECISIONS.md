# Decisions

The decision register for the Vyapar-parity programme (template: Appendix L of
[`VYAPAR_IMPLEMENTATION_PHASES.md`](./VYAPAR_IMPLEMENTATION_PHASES.md)). A slice that hits an open decision stops and
asks; the answer is written here before work continues.

| ID | Decision | Options | Chosen | Owner | Date | Affects |
|---|---|---|---|---|---|---|
| D-01 | Palette | Vyapar navy+red / Ledgora green | **Vyapar layout and navy sidebar, Ledgora green kept as the primary button colour.** `data-brand="vyapar"` on `<html>` switches to the red CTA. | Owner | 2026-11-06 | P0 |
| D-02 | Component library | hand-built / Radix | **Hand-built, no new dependency** (the Phase 0 default; acceptance rule 3). Revisit only if a later phase hits an accessibility gap the hand-built `Modal`/`Combobox` cannot close. Confirm with the owner. | Claude (default, needs owner sign-off) | 2026-11-08 | P0 |
| D-03 | Editor layout | single page / stepper default | _pending_ | | | P2 |
| D-04 | Form 27EQ in scope | yes / no | **Yes, shipped as Beta** (CSV only, no filing; CA review before the Beta tag is removed) | Owner | 2026-11-06 | P6, P10 |
| D-05 | Barcode library | bundled starter / licensed dataset | _pending_ | | | P1 |
| D-06 | Accounting depth | ledger-lite / full double entry | **Ledger-lite plus optional manual journal** | Owner | 2026-11-06 | P4 |
| D-07 | Messaging provider | wa.me link / WhatsApp Cloud / SMS vendor | **`wa.me` link now; email via the existing mail module; WhatsApp Cloud and SMS revisited after launch** | Owner | 2026-11-06 | P9 |
| D-08 | Credit limit semantics | warn / block default | _pending_ | | | P1, P2 |
| D-09 | Service reminder semantics | recurring service / other | _pending_ | | | P8, P9 |
| D-10 | Backup hosting | snapshot export / server snapshots | _pending_ | | | P7 |
| D-11 | Stock valuation | weighted average only / FIFO | **Weighted average only**; FIFO shown as "coming soon". Landed cost per unit is already stored on purchase lines (Phase 3) | Owner | 2026-11-10 | P4, P6, P8 |
| D-12 | ITC 180-day date basis | bill-payment date / cheque clearance | **Payment date** (a cheque counts on its date). Cheque clearing is not tracked until Phase 5; revisit then (and with a CA) | Owner | 2026-11-10 | P10 |

## Notes recorded during Phase 0 (2026-11-08)

These were judgement calls inside the guide's rules, not open decisions; listed so a reviewer can overturn them.

1. **CTA colours adjusted for contrast.** The token table's `#e8294c` (Vyapar red) measures 4.33:1 against white and
   `#16a34a` (Ledgora green) 3.30:1, both under the 4.5:1 the P0-S1 acceptance asks for 14px bold labels. The new
   look uses `#15803d` (green, 5.02:1) and `#e0244a` (red, 4.65:1) instead, in light and dark. The classic look keeps
   `#16a34a`. `test/tokens.test.js` checks the ratios.
2. **The flag is per person, on this computer.** `ui.vyapar` lives in `localStorage` (`ledgora_ui`), like dark mode;
   `VITE_UI_VYAPAR=true` makes the new look the default for a build. A server-side per-user preference can replace
   the storage key later without touching any screen.
3. **Both addresses always work.** `/parties` and `/clients` (and `/sales/payment-in` and `/receipts`) open the same
   screen in either look; the address bar moves to the one the current look uses. This keeps the classic build's
   URLs exactly as before while the guide's new routes exist.
4. **Inline business-name editing only names a business that has no name yet.** Renaming an existing business also
   moves its invoice numbering (`renameNumberSeries`) and saved profiles, which only Settings › Business does, so the
   top bar's pencil opens that page.
5. **No Testing Library / jsdom.** Rule 3 of the Phase 0 acceptance forbids new dependencies. Component tests render
   on the server (`react-dom/server`, already installed) and the interaction logic (sorting, ranges, focus-trap index,
   paste, cell movement, date typing) is pure and unit-tested. Interactive behaviour is covered by a Playwright run
   against the dev server.
6. **Planned screens stay out of the menu.** `NAV` lists every entry of the target sidebar, but entries whose screen a
   later phase builds carry `planned: 'P<n>'` and are hidden, so the new menu never links to a page that does not
   exist.

## Notes recorded during Phase 1 (2026-11-09)

Judgement calls inside the guide's rules, listed so a reviewer can overturn them.

1. **P1-S1: groups cover both party stores.** The Clients screen still keeps clients as workspace documents
   (`documents`, collection `clients`), not rows in `parties`. A group lives in the typed `party_groups` table; a
   typed party points at it with `parties.group_id` (composite FK), a client document with a `groupId` field. The
   party count, the delete guard and **Move to** cover both, so the numbers are right whichever store the screen
   uses. When P1-S3 moves Clients onto `/v1/parties`, the document half can go.
2. **P1-S1: one migration per slice.** The guide's migration map puts P1-S1 and P1-S2 in `0008`. Because an applied
   migration is never edited, `0008_masters_parties.sql` holds P1-S1 only and P1-S2 starts at `0009`.
3. **P1-S1: permission keys follow the code, not the guide's table.** The guide writes `parties.view/create/edit/
   delete`; the repository's keys are `party:read` and `party:write` (delete is a write). `/v1/party-groups` maps to
   those, so roles needed no change.
4. **P1-S1: deleting with `moveTo` also moves child groups** under the target, so a delete never leaves orphans.
   Without `moveTo`, a group with parties **or** child groups is refused (409).
5. **P1-S1: groups are not in the Trash screen.** They are soft-deleted (`deleted_at`), and a trashed group's name can
   be reused, but there is no restore yet; adding them to `TRASH_ENTITIES` is left for a later slice.
6. **P1-S1: 422 uses the existing `unprocessable` code** (the guide says `VALIDATION`), with zod-style
   `details: [{ path, message }]` so forms can show the message under the field.

## Notes recorded during Phase 2 (2026-11-10)

Judgement calls inside the guide's rules, listed so a reviewer can overturn them.

1. **Golden fixtures for `computeTotals`.** The function is `computeInvoiceTotals` (there is no `computeTotals`), and
   `apps/web/test/tax.test.js` calls it 8 times (5 directly, 3 through `templateTotals`), not 20. The 20 frozen
   fixtures (`apps/web/test/fixtures/totalsFixtures.js`, outputs in `totals.golden.json`, captured before
   `totals.ts` changed) are those 8 plus 12 covering the branches they miss: mixed rates with cess, intra-UT, RCM +
   inclusive, TCS over threshold with round-off, TDS 194J, invoice discount % and capped fixed, export, SEZ, blank
   business state, non-India seller, garbage input. `totalsGolden.test.js` checks each with no charges and with
   `charges: []`. Re-capture only on purpose (`CAPTURE_TOTALS_GOLDEN=1`).
2. **Charges are a top-level `charges` option** of `computeInvoiceTotals`, amounts before tax even on a
   tax-inclusive invoice, left out of `subtotal` (goods) and added to taxable value and tax. Output gains
   `charges`, `chargesTotal`, `chargesTax` only when there are charges. `roundOffMode` (`up` / `down`) is new;
   unset keeps the old nearest-rupee code path.
3. **One migration for the phase, numbered `0009`.** The guide's map says `0010_sale_enhancements` with `0009` for
   P1-S4/S5, but those slices are not written and the journal must stay contiguous. Later Phase 1 migrations take
   the next free number.
4. **Two P1-S2 columns came forward.** P2-S4 needs `parties.credit_limit` / `credit_mode`, and P1-S2 is not done, so
   `0009` adds just those two (contract rule: a mode other than `none` needs a limit > 0). The rest of P1-S2 is
   untouched.
5. **Salesman scope is opt-in.** A member with role Salesman sees only their own invoices once their login is linked
   to a staff row (`staff.user_id`). An unlinked salesman sees what they saw before Phase 2 (the existing
   business-limit test depends on it). A linked salesman creating an invoice is credited automatically and can not
   credit someone else (403).
6. **New error codes** (lowercase like the rest): `over_allocated` and `over_return` (422); `credit_limit`,
   `cash_limit`, `negative_stock`, `period_locked` (409: allowed only after the user confirms, acknowledges, or the
   owner overrides with a reason, which is audited as `guard.override`).
7. **Guards that changed nothing before stay off by default.** Negative stock is `allow` unless Settings > Transaction
   (`business_settings.preferences.transaction.negativeStock`) says `warn` or `block`; the lock date and filed months
   are read from the same preferences (`transaction.lockDate`, `filedMonths`). A credit mode of `none` (the default
   for every existing party) never stops a sale.
8. **`PUT /v1/invoices/:id` without `payments` keeps the saved inline payments** (with it, they are replaced), so a
   client that predates Phase 2 can not wipe them by editing.
9. **Receipts settle `amount + discount + TDS`.** Allocations may total up to that; `unallocated` is the advance. A
   receipt gets `RCT-n` from its own `number_series` row when no number is given. Inline payments carry the invoice
   number and can only be edited from the invoice (422 on `PUT /v1/payments/:id`).
10. **Sale-order advance is unallocated money** linked by `payments.invoice_id`; converting the order applies it to the
    new invoice first. Order status is derived (`GET /v1/invoices/:id/progress`) and also stamped on the order as
    `data.orderStatus` after each conversion.
11. **The web screens still save workspace documents**, so on the web the Phase 2 data lives on the bill:
    `payments[]` entries with `source: 'invoice_inline'`, `data.charges`, `data.salesmanId/salesmanName`,
    `data.returnInfo`, `data.expectedDeliveryDate`, and credit fields on client documents. GST returns turn
    `data.charges` into `isCharge` lines in one place (`withChargeLines`), so every table reports them; a bill without
    charges is passed through unchanged.
12. **`sale.inlinePayments` stays off by default** (`VITE_ENABLE_SALE_INLINE_PAYMENTS=true` turns it on). The P2-S2
    acceptance list passes at the API level, but the guide flips the default only after acceptance, and the web block
    has not had the timed "cash sale in 60 seconds" run. The flag also gates the Salesman menu entry, charges,
    guards, the Payment In fields and the single-page default, so a flag-off build is today's build.
13. **Web Save & New reloads `/invoices/new`** rather than resetting the editor in place: the editor peeks its number
    and loads its defaults on mount, and a reload reuses that path exactly.


## Notes recorded during Phase 3 (2026-11-10)

Judgement calls inside the guide's rules, listed so a reviewer can overturn them. Items marked ⚠️ touch GST or
income-tax treatment and need the owner's (or a CA's) confirmation.

1. **One allocation engine.** `allocatePayment` (tax-engine `payments.ts`) takes a `direction` and generic documents;
   `allocateReceipt` (sale.ts) is now a thin wrapper over it, and `splitSettlement` moved with it. Only the sign of
   the effect on the party balance differs (`paymentBalanceEffect`). Sale and purchase orders share `orderProgress`.
2. **Ineligible credit is shown in 4(A) and reversed in 4(B)(1)**, not reported in 4(D) as the guide says. Checked
   2026-11-10: CBIC Circular 170/02/2022-GST (6 July 2022) puts §17(5) reversals in 4(B)(1) and says no further detail
   is needed in 4(D)(1); the portal advisory is to avail the credit in 4(A) first and reverse it in 4(B)(1). 4(D)(2) is
   for credit restricted by place-of-supply rules (§16(4)), which the app does not model. Blocked and exempt-use lines,
   and expenses marked not ITC-eligible, follow the same path.
3. ⚠️ **Reverse-charge purchases move from 4(A)(5) to 4(A)(3)** (ISRC). Net credit is unchanged; the credit is taken in
   the same period as the 3.1(d) liability (the "claimable on payment" timing and D-12 are Phase 10).
4. **Debit notes reverse credit in 4(B)(2)** as the guide says, line by line using the ITC status of the matching bill
   line (credit never claimed is not reversed again).
5. **Exempt other income goes to 3.1(c)**, not "3B 5" as the guide says: checked 2026-11-10, Table 5 is exempt,
   nil-rated and non-GST *inward* supplies, 3.1(c) the exempt *outward* ones. Other income reaches the returns as
   bills (`incomeAsBills`): income with GST is a tax invoice (GSTR-1 B2B with the payer's GSTIN, else B2CS; HSN
   summary by its SAC; 3.1(a)), exempt income a bill of supply (GSTR-1 Table 8; 3.1(c)), numbered INC-n. Income with
   no GST that is not marked exempt is not a supply and is left out. Whether a given receipt (interest, for example)
   is an exempt supply at all stays the user's call, made with the Exempt box.
6. **TDS defaults** (194H at 2% since 1 October 2024, not the 5% in the guide; 194J ₹50,000, 194H ₹20,000, 194I ₹50,000
   a month, 194C ₹30,000 / ₹1,00,000, 194Q ₹50 lakh at 0.1% on the excess, no-PAN 20% / 5%). Checked 2026-11-10: from
   tax year 2026-27 these deductions sit in the table of section 393(1) of the Income-tax Act, 2025 with the same rates
   and thresholds for contractors, professional / technical fees, commission and rent (secondary sources; the CBDT
   notifications and payment codes are not yet reflected). The app keeps the familiar 1961-Act section names as keys and
   records `newAct: '393(1)'` on each; the TDS register notes the move. 194Q and 194A were not covered by the sources
   checked. P8 makes all of them editable.
7. **No feature flag** (the phase map lists none). GSTR-3B for data recorded before Phase 3 is unchanged to the paisa:
   a bill without flagged lines or charges takes the old code path, the CSV and JSON add rows / keys only when there
   is something reversed or reverse-charge credit, and other income adds zero when there is none. The fixtures in
   `apps/web/test/gstReturnTables.test.js` hold the old computation next to the new one.
8. **Web storage keeps the existing collections.** Purchase orders and debit notes are `purchases` documents with
   `docType`, Payment Out vouchers are `receipts` with `direction: 'out'`, other income is `expenses` with
   `kind: 'income'`. `getAllPurchases`, `getAllReceipts` and `getAllExpenses` filter to what they returned before, so
   the nine existing readers (Dashboard, Reports, Income Tax, Stock, 2B match ...) see exactly the old data; new
   getters return the new kinds. No new collection meant no change to backup, import, trash or permissions.
9. **PaymentVoucher is new and only serves `direction="out"`.** Payment In stays on ReceiptVoucher; moving it onto
   PaymentVoucher is a follow-up. `PaymentBlock` (P2-S2) and `ChargeRows` (P2-S3) are reused on Add Purchase
   (`PaymentBlock` gained `direction`); `LinesGrid` (P0) edits purchase orders, debit notes and itemised expenses.
10. **Converting a purchase order on the web opens Add Purchase pre-filled** with the pending quantities, so the bill
    goes through the one save path that syncs product stock; that save refuses over-receiving and applies the order's
    advance. The API has `POST /v1/purchase-orders/:id/convert`.
11. **A web debit note's cash / bank refund is recorded on the note** (`refundMode`), not as a receipt document, so
    the Receipts screen (customers) does not list supplier refunds. The API records it as a payment in
    (`source: 'debit_note_refund'`).
12. **Allocations answer with only the key they settle** (`invoiceId` or `purchaseId`), so Payment In responses are
    byte-identical to Phase 2.
13. **Landed cost** is stored per bill line (`purchase_lines.landed_cost`) and noted on the stock movement;
    `stock_movements` has no cost column, so valuation (D-11) reads it from the line.
14. **Income categories are seeded on first use** (`GET /v1/expense-categories?kind=income`), idempotently; category
    names are unique per kind so an income and an expense category may share a name.
15. **Permissions and errors:** existing keys (`purchase:*`, `expense:*`, `payment:*`) cover the new routes; new codes
    `duplicate_bill` (409, saved after confirming) and `over_conversion` (422).
16. **The new screens are in the new-shell menu only** (like Salesman in Phase 2); in the classic look they open by
    address (`/purchases/payment-out`, `/purchases/orders`, `/purchases/returns`, `/other-income`).
17. **Closed after the first pass (2026-11-10):** other income in GSTR-1 (item 5); web expense items and category tree
    (kept in workspace settings, `meta/expenseSetup`; children roll up into parents); supplier statement on the web;
    attachments on purchase bills, expenses and Payment Out (the files module: signed upload, then complete); PDFs of
    purchase orders and debit notes (one shared `purchasePdf`); a TDS register by deductee and section per quarter
    with CSV (the data a quarterly TDS return needs; PAN is read from the supplier's GSTIN). A browser run,
    `apps/web/scripts/purchase-e2e.mjs`, drives PO → part delivery → debit note → Payment Out with TDS → GSTR-3B
    Table 4 and passes (16 checks). It found two bugs, both fixed with regression tests: a Payment Out not yet saved
    hid the advance and inline payments already on a bill, and a bill line carrying a product id did not match an
    order (or bill) line typed by name. A refunded debit note also lowered the supplier balance without its refund;
    fixed in both the web and API statements.
18. **Still not done:** ledger posting (Phase 4) and the 180-day ITC timer (Phase 10, waits on D-12); the e-filing
    format of the TDS return itself (Phase 6); editing a purchase through the API (none existed).

## Notes recorded during Phase 4 and the remaining Phase 10 work (2026-11-10)

Judgement calls inside the guide's rules, listed so a reviewer can overturn them. ⚠️ marks money or tax treatment.

1. **Scope.** Built: all seven Phase 4 slices, the 180-day ITC rule (P10-S4), the TDS payable ledger with challans and
   interest (P10-S5), and `PUT /v1/purchases/:id` (purchases had no edit, so the ledger had nothing to repost on edit).
   `docs/ACCOUNTING.md` explains the design.
2. **The ledger posts the typed tables only.** The web screens (Sales, Purchases, Receipts, Expenses) still save workspace
   documents, so for a business using only those screens the ledger is empty until the screen moves onto the typed API.
   A bridge that posts workspace documents was not built: the guide's design is the typed tables, and a bridge would be
   thrown away when the screens move. This is the main limit; the Accounting screens work fully on typed data.
3. **The period check is in each module, not inside `repost`.** The guide puts it in `repost`; that would block the
   owner's override (invoices already have one) and a backfill of old documents. Every write path calls `guardPeriod`
   before writing and a table-driven API test covers 12 of them. `periodLocked` gained closed financial years; the
   lock date is the existing `transaction.lockDate` setting, so nothing existing moved.
4. **`1190 Bank (not assigned)` was added to the chart.** UPI, bank and card money needs a home before bank accounts exist.
   Bank accounts (`1101…`) and expense-category accounts (`5101…`) are created on first use. "Duties & taxes" holds both
   Input GST (asset) and Output GST (liability), so Add Account asks for the kind in that group.
5. **A reversal is dated like its original**, so a period nets to zero, and `repost` writes nothing when the postings did
   not change (idempotent backfill, edits that change no money). The viewer hides reversed pairs unless asked.
6. **Sales is the balancing line of a sale.** Cr Sales = total − tax − TCS − charges − round-off, so a discount on the whole
   bill lowers Sales rather than needing an account of its own. Likewise Ineligible GST expensed is total tax − credit
   claimed, so a paisa between the per-head credit split and the stored tax can never unbalance a voucher.
7. **Backfill**: a dry run and a real run are the same code inside a savepoint (rolled back for a dry run or when party
   balances differ), so they cannot disagree. It posts party opening balances (the `parties.opening_balance` sign:
   positive = they owe us) dated the start of the first document's financial year. Changing an opening balance later is
   flagged by Verify, fixed by posting history again. The CLI `pnpm --filter @ledgora/api backfill:ledger` runs the same code
   and has no `--force`: with differences it prints the diff table, keeps nothing and exits 1.
8. ⚠️ **D-13 (open): reverse-charge bills.** The ledger records a supplier as owed the value without the RCM tax (the tax is
   Cr RCM Payable). Phase 3's `total`, and the amount the Payment Out screen shows as due on such a bill, include the tax.
   Paying the full "due" therefore leaves the supplier with a ₹ advance equal to the RCM tax in the books. Verify does not
   flag it (its document balance uses the same rule as the ledger). Recommended: make what is due on an RCM bill exclude
   the RCM tax in `dueOfPurchase` and the web screens. Not changed here because it changes Phase 3 behaviour.
9. ⚠️ **ITC 180 days** counts a supplier payment on its own date (D-12). Credit is reversed from the day after the deadline
   (invoice date + 180 days) for the part unpaid at the deadline, in proportion; a later payment re-claims it, never more
   than was reversed. On the web the return of a period shows the reversal in 4(B)(2) (with a Review list) and the re-claim
   as "Re-claimed ITC" in 4(A)(5); fixtures in `gstReturnTables.test.js` show before and after. The rule is not applied to
   expenses, and a debit note settled by adjustment is not counted as payment.
10. ⚠️ **TDS payable**: due the 7th of the next month (30 April for March), interest 1.5% a month or part from the date of
    deduction when deposited late (§201(1A)); no PAN is flagged. Government deductors and the 1% late-*deduction* rate are
    in the engine but the screens only compute the late-deposit case. The 26Q file itself (official format) was not built.
11. **TDS entries follow their source** (a Payment Out, a §194Q bill); a deposited entry is never changed or removed by a
    later edit or delete of its source. The API keeps them in `tds_entries`; the web keeps the challan on the voucher or
    bill document (`tdsChallan`).
12. **Permissions** (new keys, checked on every route): `ledger:read` (everyone who reads the books), `journal:write` (owner,
    admin, accountant), `accounting:manage` (owner, admin: switch the ledger on, accounts, lock, close a year),
    `verify:run` (owner, admin, accountant). The TDS endpoints use `payment:read/write`.
13. **Still not done:** posting from workspace documents (item 2); P4-S7's "click Ref opens the source document" goes to the
    document's list screen, not the document; per-party statement from the ledger; FIFO (D-11); a timed run on a
    10,000-document business (the backfill does a few queries per document and has not been profiled).

## Notes recorded during Phase 5 (2026-11-11)

Cash & Bank, all seven slices, behind the per-business flag `business_settings.preferences.cashbank.enabled`, which only
counts while `accounting.ledger` is on (`GET/PUT /v1/cashbank/settings`; turning it on needs `accounting:manage`). The
pure rules came first, with tests: `tax-engine/loan.ts`, `cheque.ts` (state machine + postings), `recon.ts`,
`cashbank.ts`. Every slice's API tests end with the Verify My Data trial-balance check (no unbalanced voucher, Dr = Cr,
party balances = documents); all passed, so no slice stopped on Dr ≠ Cr.

1. **Nothing new writes the ledger directly.** Transfers, cash entries, cheques, loans, loan payments and bank opening
   balances post through `repost()` (`cashbankRules.ts syncCashbank / syncBankOpening`): edit and delete are reverse +
   repost, as in Phase 4. Migration `0012_cash_bank.sql` is additive (new tables with forced RLS, three defaulted columns on
   `payment_accounts`). `ledger_entries` stays append-only.
2. **A bank account is still a `payment_accounts` row.** Its ledger account (1101…) is the `accounts` row whose
   `bank_account_id` points at it, so the guide's `payment_accounts.account_id` column was not added (it would duplicate
   that link). `account_type` and `swift` already existed. Turning Cash & Bank on gives every existing bank its ledger
   account and posts its opening balance (dated the day the bank was added when it had no date). Deleting a bank with
   entries is refused (409) on both the new and the old payment-account endpoints.
3. **Two system accounts added to the default chart:** 3010 Owner's Drawings and 5270 Cash Over / Short. `seedChart` adds
   them to existing businesses when Cash & Bank is turned on.
4. **Deposit / Withdraw (the guide flagged the naming as inferred), settled the Indian way:** on a bank, Deposit means
   cash taken to the counter and Withdraw cash taken out, so both default to a contra entry with Cash in Hand (a transfer,
   Dr Bank / Cr Cash or the reverse). The other choices: Deposit from Owner's Capital; Withdraw to Owner's Drawings, Bank
   Charges or an account the user picks. Money from customers stays Payment In.
   Adjust (bank or cash) is against Opening Balance Equity; "count as income" uses Other Income for more and Cash Over /
   Short for less. The day-end count posts only a difference, to Cash Over / Short.
5. **Cheques always come with a payment.** Add Cheque records a Payment In / Out (mode cheque) through the same code as the
   payment screens, and a payment by cheque made elsewhere joins the register when Cash & Bank is on. The payment posts
   Dr Cheques in Hand / Cr Receivable (issued: Dr Payable / Cr Cheques Issued); clearing posts Dr Bank / Cr Cheques in Hand.
   **Bounce and cancel void the payment** (soft delete: allocations removed, invoices reopen, postings reversed, accrued
   TDS dropped), so "the invoice balance reopens" holds by construction and Verify's party check still agrees. Bounce
   charges: received → to the party (Dr Receivable / Cr Other Income) or to us (Bank Charges); issued → always ours. A
   payment whose cheque has been deposited or cleared can not be edited or deleted (409); act on the cheque instead.
6. **State machine:** received open → deposited → cleared / bounced, open → cancelled, and (the way most shops record it)
   open → cleared or bounced directly; issued open → cleared / bounced / cancelled. Cheque numbers are unique per
   direction and party among live cheques. Actions lock the cheque row (`SELECT … FOR UPDATE`), so two people can not
   clear and bounce the same cheque at once.
7. **Loans:** EMI and schedule per the guide (textbook ₹10,00,000 at 12% for 12 months = ₹88,848.79), paisa rounding with
   the last row absorbing it. The stored schedule is rebuilt from the terms and every payment (`scheduleFor`), so deleting
   a payment is exact. A part payment or prepayment keeps the EMI and shortens the tenure by default, or keeps the end
   date and lowers the EMI. A processing fee is Bank Charges. The loan account's balance always equals the schedule's
   outstanding (tested). Money terms can not be edited after a loan is added (delete and re-add while it has no payments).
8. **Transfers:** cash can never go below zero; banks only with "allow overdraft" on, or when the bank is an OD / CC account.
   A transfer fee is Bank Charges taken from the source account.
9. **Reconciliation:** matching is pure (`matchStatement`: same amount on the right side, ±3 days, a payment / cheque /
   transfer reference in the description first, each row and entry used once); statement rows are fingerprinted so a
   re-uploaded statement shows what was already reconciled. Finishing with a difference needs a reason, written to the
   audit log. Statements upload as CSV or Excel .xlsx (read by `apps/web/src/lib/xlsx.js`, no dependency: the browser's
   DecompressionStream unzips it; Excel date cells are serial numbers, read by `normalizeStatementDate`). An old binary
   .xls is refused with a hint to save it as .xlsx or CSV. An unmatched row can be recorded on the spot (bank charges,
   owner drawing, cash withdrawn; interest / other income, owner's capital, cash deposited) and is matched again at once,
   or ignored with a reason (`bank_recon.ignored`, migration 0013), and a re-uploaded statement shows it as done. Party
   money still goes through Payment In / Out (the row links there).
10. **Permissions:** `cashbank:read` (every role that reads the books, viewer included), `cashbank:write` (owner, admin,
    accountant). The period lock applies to every Cash & Bank write.
11. **Increase Loan** is a `topup` loan payment: Dr Bank (less any charges, which are Bank Charges) / Cr the loan; the
    schedule is rebuilt keeping the end date (higher EMI, the default) or the EMI (longer). A top-up on a paid-off loan
    reopens it. Deleting a top-up that later repayments depend on is refused. The loan **Statement** reads the loan's
    ledger account: borrowed, repaid and the principal outstanding after each.
12. **India-specific rules (Phase 5 follow-up, 2026-11-11):**
    - **Cheque validity (RBI, CTS-2010):** three months from the cheque's date. A stale cheque can not be deposited or
      cleared (409); the register shows "Stale since …". A cheque can not be presented before its date either.
    - **NI Act §138 / §142:** a bounced received cheque carries its clock: demand notice within 30 days of the return
      memo; once the owner records when the notice reached the drawer (`cheques.notice_served_on`), 15 days to pay, then
      one month to file a complaint. Shown in the register as a reminder, with "not legal advice" on the screen.
    - **§269SS / §269T:** taking a loan, or repaying one with its interest, of ₹20,000 or more in cash is refused
      (`cash_limit`, 409) unless the owner types an acknowledgement, which is audited (`guard.cash_loan`), the same
      pattern as the existing §269ST receipt guard. Checked after the amounts are valid, so a wrong amount is reported first.
    - **§40A(3):** cash paid to one party in a day above ₹10,000 (Payment Out or an expense paid in cash) is listed on
      the Cash in Hand screen and in the summary (`cashOutWatch`) next to the §269ST receipts watch. A warning only: the
      ₹35,000 transporter limit is not distinguished.
    - **Income Tax link:** `GET /v1/loans/tax-summary` totals interest and principal paid in a financial year on loans
      marked housing or education; the Regime Calculator shows them and fills §24(b) (capped at ₹2,00,000, self-occupied)
      and §80E, and can add home-loan principal to §80C (its ₹1,50,000 cap is shared, so it is added, not capped).
      Counted from payments recorded (cash basis); the screen says to check the lender's interest certificate.
13. **Production hardening:** every Save in the Cash & Bank screens runs once at a time (no double payments from a double
    click); loan payments lock the loan row; the Home widgets and the Cash & Bank data load as separate chunks.
14. **ITC 180 days and cheques (D-12 extended):** on the API, a Payment Out made by a cheque in the register counts for
    the 180-day rule on the day the cheque **cleared**; while it is open or deposited it has paid nothing, and a bounced
    or cancelled cheque never pays (`chequePaidOn`, `itcRules.ts`). A cheque handed over before the deadline but cleared
    after it therefore leaves the credit due for reversal. Payments without a register entry keep their own date. The
    web screens' own 180-day view (workspace documents, which have no cheque register) is unchanged.
15. **§194A TDS on loan interest:** a loan records who lent it (`lender_type`: bank / co-op bank / LIC / insurer are
    exempt under §194A(3)(iii); NBFC, company, individual, other are not), the lender's PAN and, optionally, the lender
    as a party (interest is then added up across all their loans). Each repayment works out TDS with the existing engine
    (`tdsCalc('194A')`): 10%, 20% without PAN (§206AA), once the year's interest to the lender passes ₹10,000, the
    crossing payment covering the whole year (catch-up); rounded to the rupee. It posts Dr Loan Interest (full) /
    Cr TDS Payable / Cr Bank (net), and a `tds_entries` row (section 194A) that the TDS Payable screen, challans and the
    §201(1A) interest already handle. A loan can be marked exempt (Form 15G / 15H, or a deductor not required to deduct);
    a payment may override the figure. TDS is recorded when interest is paid, not when it is credited without payment;
    deleting a payment removes its accrued TDS but does not re-work later payments' catch-up.
16. **Cash & Bank reports (Phase 6, P6-S6 subset):** Bank Statement (any bank or Cash in Hand: opening row, deposits,
    withdrawals, running balance, reconciled ✔), Loan Statement (disbursal, each EMI / part payment / prepayment /
    top-up with principal, interest, charges, TDS and the balance after) and Cheque Register (direction, status, days
    past the cheque date), at `/reports/cash-bank/:id`, linked from Reports and the Cash & Bank screen. Built on
    ReportShell, so they filter, total and export (Print / PDF, Excel, CSV, Share) like every report. Bank closing =
    the account's balance and loan balance = the schedule's outstanding (tested). The rest of Phase 6 is not built.
17. **IFSC branch lookup:** `GET /v1/ifsc/:code` asks the IFSC directory (`IFSC_API_URL`, Razorpay's open API by default)
    from the API server, because the app's CSP lets the browser connect to nothing else. 4-second timeout, answers
    cached a day; slow, failing or switched off (`IFSC_API_URL=off`) it falls back to the bundled bank name. The form's
    "Find branch" fills bank and branch (stored on `payment_accounts.branch`, migration 0014) and shows address and MICR.
18. **§194A at credit (interest credited before it is paid):** "Credit interest" on a loan (an EMI fallen due, the
    31 March accrual) books Dr Loan Interest / Cr Interest Payable (new system account 2420) / Cr TDS Payable, keeping
    the TDS on the day of credit (the Act takes the earlier of credit and payment) and writing its `tds_entries` row.
    A later payment settles credited interest first in, first out (`accruedSettlement`): that part clears Interest
    Payable at its net, with no second expense and no second TDS; only interest beyond it is new expense with its own
    TDS. The year's threshold counts interest credited plus interest paid that was not credited. A credit a payment has
    already paid can not be deleted (delete the payment first). Migration 0015.
19. **Browser test:** `apps/web/scripts/cashbank-e2e.mjs` drives the Cash & Bank screens and the core reports in Firefox
    (28 checks: bank account with IFSC, cash adjust, transfer, a cheque through deposit and clearing, a loan with its
    EMI, statement reconciliation with a quick entry, the Home widget, the report hub, Trial Balance and Balance Sheet
    balanced, Cash Flow = Cash & Bank, an Excel export, no page errors, Verify clean). Run against a throwaway database
    with the API serving the built app; it passed. Found and fixed on the way: an empty `IFSC_API_URL` does not switch
    the lookup off (the env loader drops empty values), so it is `IFSC_API_URL=off`; report and Cash & Bank pages lit
    Dashboard in the sidebar and showed its footer (the router now maps /reports/* and /cash-bank/*); statement money
    was not in Indian grouping.

## Notes recorded during Phase 6, core first (2026-11-11)

Scope agreed: the engine and hub, then the money reports that read the ledger, each with a server handler and a
cross-check; the rest of Phase 6 is next.

1. **Engine.** A report is a definition (`apps/api/src/reports/registry.ts`: id, title, group, zod params, `run`) served
   at `GET /v1/reports/:id` and listed at `GET /v1/reports`; no route per report (tested by registering a toy report in
   a test). The web draws each with ReportShell from a definition in `features/reports/definitions.js`; a server report
   without one still opens, with columns taken from its rows. Totals and opening/closing figures come from the server
   and reach the summary chips (ReportShell passes `totals` and `meta` to `summary`).
2. **Reports built:** Day Book, Cash Flow (direct method, by what posted the money; a transfer nets to its fee), Party
   Statement (the party's lines on Receivable and Payable, running Dr/Cr), Payable Ageing (0–30 / 31–60 / 61–90 / 90+ by
   bill date), Profit & Loss (Indian layout: direct income, cost of sales with opening and closing stock, gross profit,
   indirect, net), Trial Balance (with groups), Balance Sheet (assets with closing stock against capital, retained
   earnings, current-year profit and liabilities; any difference shown as "Difference in opening balances", never
   hidden). All of them hide reversed pairs, so they show what the books say now.
3. **Stock in the statements.** Stock is not posted (D-06), so the P&L is periodic and the Balance Sheet adds closing
   stock, both valued at moving weighted-average cost (`weightedAverageCost`): a purchase at its line's landed cost, the
   opening quantity at the item's purchase price, everything else at the running average; a movement is dated by its
   bill or invoice. The stock items were opened with stands as capital ("Opening stock (capital introduced)"), which is
   what keeps the sheet balanced. Items belong to the organization, so with several businesses the stock is the
   organization's (to revisit when stock moves per business).
4. **Cross-checks** (`report-crosschecks.test.ts`, one business with stock, sales, purchases, payments, an expense, a
   loan, a transfer and a cleared cheque): Day Book and Cash Flow close at the Cash & Bank total; Party Statement at
   the party's ledger balance; Trial Balance balanced and equal to the ledger's; P&L net = income − expenses + closing −
   opening stock, closing stock checked by hand (₹1,206.67); Balance Sheet balanced with the P&L's profit and stock;
   Payable Ageing = the supplier's ledger; Bank Statement = the bank balance. A property test (200 random ledgers)
   shows the Balance Sheet always balances.
5. **Permissions.** `report:read` for every report; new `report:profit` (owner, admin, accountant) for Profit & Loss and
   Balance Sheet, the "hide profit reports" switch: a viewer reads the Day Book but gets 403 on the P&L. Ledger reports
   on a business without the ledger answer 409, not an empty report.
6. **Hub.** `/reports` lists the groups with a search; reports a role or a business can not use are shown greyed with
   why. The old analytics page is at `/reports/classic` (Sales analytics), linked from the hub; `/reports/cash-bank/:id`
   redirects to `/reports/:id`.
7. **Not built yet:** the document reports (Sale, Purchase, All Transactions, Bill Wise Profit), the rest of the party
   reports, item and stock reports, GST rate / HSN / SAC / sale-purchase with GST / 27EQ / e-way register, expense,
   discount and order reports, salesman; favourites, recent, saved views, scheduled e-mail; the server-side streaming
   CSV for 100k rows (exports today run in the browser over the rows loaded); Payable Ageing counts payments made after
   its date (it ages what is due today on bills dated up to it). Receivable ageing stays in Sales analytics.

## Notes recorded during Phase 12, Point of Sale (2026-11-11)

1. **A POS bill is an invoice.** `POST /v1/pos/sales` calls `createInvoice`, so numbering, guards, stock, inline payments and the ledger are the existing code, and every report, GST return and Cash & Bank statement includes the bill with no extra work. The POS adds only `loyalty_points`.
2. **The counter sells typed items and customers**, not the workspace documents the older Products and Clients screens still keep (the same limit as decision 2 of Phase 4). So the screen has two bridges: "Add an item" (name, code, barcode, price, GST, opening stock) and "Import my products and customers", which copies the workspace products and clients into the typed tables once (items already there, same name and HSN, are skipped). The POS bills do not appear in the older Sales list; they are in Reports, the ledger and Recent bills on the counter. Moving the Sales screens onto the typed API removes this seam.
3. **Barcode is `items.extra.barcode`**, not a column (the guide's P1-S5 column was not built), with a partial unique index per organization among live items. Item code is the existing `sku`. `extra.salePriceInclTax` says a stored price already has GST in it; the counter converts to the `pricing` setting.
4. **Bill discount is taken before GST**, spread over lines by value in paise, last line taking the remainder, so each line's GST falls with it. Loyalty points redeemed are the same kind of discount. Free quantity is quantity on the line (it leaves stock) plus its value in the line's discount.
5. **Cash is the only mode that can exceed the bill.** The excess is change and is not recorded. Credit needs a customer. "Cash Sale by default" is how a bill with no customer behaves (the walk-in party), not a separate setting.
6. **Idempotent save.** The bill's `clientKey` is stored in `invoices.data.pos`; a repeat returns the first bill. The retry is by lookup, not a unique index, so two truly simultaneous requests with one key could both pass; the counter sends one at a time (the Save button is disabled while saving).
7. **Settings live in `business_settings.preferences.pos`.** `PUT /v1/businesses/:id/settings` replaces `preferences` as a whole (existing behaviour), so a client that writes it without first reading it back would drop `pos` (and `cashbank`, `accounting.ledger`). The settings screen reads then writes, so nothing is lost today; the POS settings PUT merges. Not changed here.
8. **Shortcuts.** Browsers keep Ctrl+T and Ctrl+W, so there are Alt+N and Alt+W twins; Ctrl+P is taken over on the POS page for Save & Print. One table (`posKeys.js`) drives the handler and the help list.
9. **Not built:** barcode printing and label sheets (Phase 7), serial / batch / expiry on a counter line (Phase 1 tracking is not built), multiple secondary units with price per unit (Change Unit changes the label only), a customer display or cash drawer kick, offline selling (a bill needs the server), sale of a quotation or order from the counter, a POS return (use a credit note), per-cashier shift close and day-end report (Cash in Hand day-end count and the Day Book cover the cash side), the receipt on a connected thermal printer without the browser print dialog (needs the Web USB / native path), and a browser click-through of the printed receipt (the HTML is unit-tested; the print dialog is not driven by the script).

## Notes recorded during Phase 7, Utilities (2026-11-11)

1. **Order of work.** `tally.ts`, `fiscal.ts`, `barcode.ts` and `setup.ts` were written as pure functions with tests before any route: 18 barcode tests (EAN-13 vectors, every Code 128 pattern is 11 modules, sheet geometry), 14 Tally tests with six golden XML files, 14 fiscal tests (closing journal values, 200 random years, equality, checks). The golden XML was read by hand once; fixing it caught a real error (sales goods had the debit sign). **Owner to do before release:** import `Master.xml` then `Voucher.xml` into a copy of a Tally Prime company and record the result here. Until then the format is unverified against Tally itself.
2. **Barcode (P7-S1).** Code 128 (set B) and EAN-13 are drawn from the tax engine's own encoders (no `jsbarcode` dependency). **QR** is drawn from the `qrcode` package (medium error correction, in the web app only; the tax engine stays dependency-free).  A missing code is the next in-store EAN-13: prefix 200 (GS1 reserves 200 to 299 for shop use, so it never clashes with a manufacturer's code) + 9-digit sequence + check digit, taken under an advisory lock per organization (a test runs four overlapping assignments and finds no duplicate) with the unique barcode index of Phase 12 as the backstop. Barcode stays `items.extra.barcode`. The PDF is the browser's Save as PDF from the print dialog. The label size, barcode type, copies and what to show are saved per business (`preferences.barcode`, read and written whole).
3. **Tally (P7-S2).** The ledger is required (guide and instruction), so the screen shows Enable accounting. Mapping is saved per business in `preferences.tally`. Round off, additional charges and taxes become ledger entries; **there is no separate discount ledger**: a line's discount is already inside its taxable amount, which is what Tally's AMOUNT must equal. Customer opening balances go into the party ledger; supplier opening balances are not sent (their sign is not recorded unambiguously). Vouchers are read from the typed tables (invoices, credit notes, purchase bills, debit notes), so a business using only the older workspace screens has nothing to export until those screens move onto the typed API (decision 2 of Phase 4). Payments, receipts and expenses are the optional extras, off by default (see "Phase 7 follow-up" below). Errors block with the document named; warnings do not.
4. **Close FY (P7-S3) writes one entry, not opening entries.** The ledger is continuous across years, so party balances, bank, cash, loans, open cheques and stock already carry into the new year; re-posting them as opening entries would count them twice. What closing does: **(a)** posts `fy_close` dated the last day of the year, clearing every income and expense account into Retained Earnings (account 3100, the existing "Retained Earnings / Opening Balance Equity"), **(b)** sets the series to restart each financial year (`numberSettings.resetOn = 'fy'`, and the new prefix for the prefix method; the counter key carries the year), **(c)** closes and locks the year, **(d)** records the summary. The carry-forward checkboxes in the guide's wireframe are therefore a summary on the result page, not choices.
   Period reports leave the closing entry out (`accountTotals` with a from date skips `fy_close`), so the year's own Profit & Loss still shows its profit; balance sheets after the year show the profit as Retained Earnings and do not show it again as "current year". Tests: the year-end balance sheet is identical before and after; the balance sheet at 1 April of the new year has the same assets and liabilities; Retained Earnings equals the year's profit; a second year adds to it.
   Closing needs the ledger, a finished year, no earlier year open, the typed year, and a backup from the last 24 hours (the screen's "Back up now" makes one). Reopen is the owner's, with a reason, refused while a later year is closed; it reverses the closing entry. The old plain unlock (`POST /financial-years/:id/reopen`) is refused for a year closed this way, so it can not leave a closing entry standing. **Limit:** an owner who overrides the lock to edit a closed year leaves the closing entry stale (its profit no longer matches); reopen, edit, close again. A Verify My Data check for a stale closing entry is not built.
5. **Backup (P7-S4) is a snapshot of the whole organization.** One `.ledgora` file: gzip of JSON per table with a manifest (app version, schema version = migration count, counts, a SHA-256 per table); with a password it is AES-256-GCM, key from PBKDF2-SHA256 (200,000 rounds, random salt and IV). The guide says "zip"; a single gzip container is used (no zip library, same guarantees). It holds the typed tables **and** the workspace documents and key-values the current screens use. Not in it: users and sessions, files' bytes (logos, attachments), the audit log, jobs.
   **Restore never deletes.** It adds the snapshot's businesses and rows under fresh ids (all strings equal to an old id are rewritten, inside documents too) to an organization that has no business data yet; the ledger is append-only and a replace could not be done safely. Otherwise it answers 409 with what is in the way. It verifies hashes and schema (a newer file is refused; an older one is read, missing columns take defaults), asks for the word RESTORE, is owner-only, and takes a **safety snapshot of the current organization first** (kind `safety`, in the history); everything runs in one transaction, so a failure writes nothing (the tests try wrong password, a changed file, a changed manifest, a newer schema, not-a-backup). The round trip test restores a trading business into a new organization and compares invoice counts, totals, numbers, the trial balance and the older screens' documents.
   The schedule (daily or weekly at an hour, IST) is claimed per slot under a row lock, so it runs once per slot; `keepLast` prunes old scheduled backups. **Scheduled backups are not encrypted** (the server must not keep your password). **Google Drive is not built** (needs OAuth). Files live in the same storage as other uploads.
6. **Setup checklist (P7-S5)** counts typed rows and the older screens' documents, whichever the business uses; "logo" is not required for the first row. The card can be hidden from 5 of 8 done (checked on the server); the dot is in the new top bar only.
7. **Trash and Share with CA (P7-S6).** Restoring a purchase or expense is refused inside a locked period (the owner may restore with a reason in `x-override-reason`), reposts the ledger, and bulk restore reports each failure and restores the rest; emptying the trash is the owner's. **Tax invoices are cancelled, never trashed**, so the trash holds purchases, expenses, parties, items, quotations, recurring schedules and templates. The new screen lists the typed trash; the older bills' own 30-day trash is unchanged.
   New role `ca`: every read, reports and exports, audit log; nothing that writes (twelve write endpoints are tested, including restore and Close FY). Verify My Data is left out because its fix action writes and shares one permission with the check. An invitation can carry `dataFrom` / `dataTo` (kept on the member) and a link life up to 30 days; **the date range is enforced on reports (run and export) only**, not on the list screens or the ledger.
8. **Not built after the follow-up below:** a Tally import test (only the owner can run it: `docs/TALLY_IMPORT_CHECK.md`), replace-style restore, and a live run against Google.

### Phase 7 follow-up (2026-11-11): the items first left out

1. **Tally: receipts, payments, expenses, other income.** Optional extras (off by default) written as Tally `Receipt` and `Payment` vouchers with their own ledger entries, not items. A receipt credits the party with money + discount + TDS (debit Bank or Cash, Discount Allowed, TDS Receivable); a payment out is the mirror; an expense debits its head and input GST (CGST + SGST, or IGST between states) and credits Cash or Bank; other income is a receipt with output GST. New mapping names: Cash, Bank, Discount allowed / received, TDS receivable / payable, expense and other-income groups. The masters file creates the cash, bank, discount, TDS and expense-head ledgers it names. An expense paid only in part is exported as paid in full, with a warning.
2. **Tally reads the older screens too.** Their bills, purchases, receipts and expenses (workspace documents) are turned into the same vouchers, totalled by the same engine (`computeInvoiceTotals`), so a business that only used those screens has something to export. A document is skipped when a typed one of the same type and number exists (an imported bill is not sent twice); the switch "also include what the billing screens saved" turns it off. A party typed by hand on a bill and a typed party of the same name (as Tally reads names) are one ledger; two different typed parties with one name are still an error. The old screens' purchase orders are skipped, their debit notes are Debit Notes.
3. **Tally is still unverified against Tally.** `docs/TALLY_IMPORT_CHECK.md` is the 15-minute check for the owner, with `packages/tax-engine/scripts/tally-sample.ts` to make the files. New golden files cover a receipt with discount and TDS, a payment out, two expenses, other income and the accounting masters; a well-formedness check runs over everything the exporter writes (it caught nothing wrong, and a deliberately broken file fails it).
4. **Stale closing entry is a Verify My Data check** (`fy_close_stale`): for each year closed with Close FY and not reopened, the profit moved at close is compared with the profit the books show now. The fix posts the closing entry again (the old one is reversed) and records the new profit; the year stays closed. A test overrides the lock as the owner, finds the check, fixes it and checks the year-end balances.
5. **Backups.** (a) **Scheduled backups are encrypted** with a password derived from a server key (`BACKUP_ENCRYPTION_KEY`, else `AUTH_SECRET`) and the organization id; the history opens them without asking. A downloaded copy of one can only be opened on a server with the same key, which the screen says. Rotating the key makes older scheduled backups unreadable, so keep a manual, password-encrypted one if you rotate. (b) **Attachments are in the backup**: logos, signatures, stamps and bill files, up to 40 MB in all (a file past that is listed without bytes and comes back "pending"); backups and exports are not copied into backups. Restore stores them under new ids and the business, purchase and so on point at the new ones. (c) **Google Drive**: OAuth with the `drive.file` scope (the app sees only what it created, in a "Ledgora Backups" folder), the refresh token stored encrypted, a copy uploaded after each backup when connected (a Drive failure never fails the backup and is shown), the Drive copy deleted with the backup, disconnect revokes. It needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with the Drive API enabled and `${API_URL}/v1/backups/drive/callback` as a redirect URI. **It was tested against a stand-in for Google, not Google**: connect it once with a real account and watch one backup land before relying on it.
6. **Share with CA: the date range holds on every screen.** For a member with a range, any GET with `from`, `to` or `asOf` outside it is refused, rows of a list dated outside it are removed, and a single record dated outside it is refused (`middleware/range.ts`, applied by the route registrar). **Not recomputed:** figures the server totals across all rows (a party's balance, a dashboard card, the ledger's opening balance), so a CA given one year still sees balances that include other years. Reports are the exception: they run only inside the range.
