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
