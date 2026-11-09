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
