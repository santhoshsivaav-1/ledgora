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
| D-11 | Stock valuation | weighted average only / FIFO | _pending_ | | | P4, P6, P8 |
| D-12 | ITC 180-day date basis | bill-payment date / cheque clearance | _pending_ | | | P10 |

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

