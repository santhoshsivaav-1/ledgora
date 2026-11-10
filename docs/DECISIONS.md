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
   flagged by Verify, fixed by posting history again. There is no CLI: the endpoint and the Accounting screen do the job.
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
