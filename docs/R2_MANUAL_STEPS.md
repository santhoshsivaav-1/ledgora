# R2 income tax: what only the owner can do

The code is finished and tested. These steps need your accounts, the department, or real customers' files.

1. **Register the software with the Income Tax Department.** One code for the whole platform, not one per customer.
   Apply on the e-filing site as a software developer (the department may ask for sample files first), then set
   `ITR_SW_CODE=SW########` in the production environment. Until then the file carries a placeholder and the build screen
   warns about it.
2. **Protect the server secret.** Aadhaar and bank account numbers are sealed with a key derived from the server secret
   (`BACKUP_ENCRYPTION_KEY`, falling back to `AUTH_SECRET`) and the organization. If you rotate or lose that secret the
   sealed values become unreadable: the build screen then says so and the customer re-enters them. Back it up separately from
   the database, and set `BACKUP_ENCRYPTION_KEY` explicitly so rotating the login secret does not break them.
3. **Do one real portal upload.** With a test PAN or an early customer who agrees: build an ITR-4, upload it on the portal's
   "Upload JSON" step, and screenshot the result into `docs/acceptance/`. Then change the wording from "checked against the
   published schema and rules" to "portal-proven" in the roadmap and the build screen.
4. **Collect real AIS / TIS files.** Customers use "Did not read well? Report the format": only column headings reach the
   server log (search for `[ais-format]`), never values. Send me those lines and I will extend the importer.
5. **When the department publishes the ITR-4 JSON schema for TY 2026-27**, send me the file and the validation-rules
   document; adding the year is a data file and a rules entry.
6. **Have a CA review** `docs/FEATURE_GAPS_2026-11.md` section R2 and the tax figures once, for the 2025 Act slabs and the
   presumptive rules, before you announce the feature.
7. **Run migration 0033 in production** (`pnpm --filter @ledgora/db migrate`), after a backup.
8. **Run migrations 0034 and 0035 in production** (the asset register, and the `itr3` pack kind), after a backup.
9. **Do one real portal upload of an ITR-3** the same way as step 3 (build it from a pilot business's books, upload it on the
   portal's "Upload JSON" step, screenshot the result into `docs/acceptance/`). The portal also runs its rules on upload; if it
   refuses something this software passed, send me the message: it is a rule to add to `itr3Rules.ts`.
10. **Have a CA review the ITR-3 mapping** once: how the ledger's accounts are placed under the form's heads
    (`apps/api/src/modules/itr3Books.ts`: interest, dividend, rent, salaries and depreciation are found by account name; every
    other account goes under "other"), the section 43B and 40A(3) items on the Business & return tab, and the block table in
    `packages/tax-engine/src/depreciation.ts`. Additional depreciation (s.32(1)(iia)) and the 40% special-rate assets are not covered.
11. **The ITR-3 business codes and the 45% block**: when the department publishes the schema for the next year, download it into
    `packages/tax-engine/schemas/itr3/`, run `node scripts/gen-itr3-skeleton.mjs` and `node scripts/gen-itr3-codes.mjs`, register
    it in `src/itr3Schema.ts`, and re-read its validation-rules document against `src/itr3Rules.ts` (`ITR3_RULES_CHECKED`).

