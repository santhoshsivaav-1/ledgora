# ITR-4 JSON schema

`AY2026-27.json` is the Income Tax Department's published JSON schema for ITR-4 (Sugam), assessment year 2026-27,
file `ITR-4_2026_Main_V1.1.json` (first released 15 May 2026, revised 30 June 2026), downloaded unchanged from
https://www.incometax.gov.in/iec/foportal/downloads/income-tax-returns (line endings normalised to LF).

The department's cross-field rules for the same year are in "CBDT e-Filing ITR 4 Validation Rules AY 2026-27" (v1.0,
15 May 2026); `src/itr4Rules.ts` implements the ones the builder can break.

Each assessment year: download the new schema, add it here as `AY<year>.json`, run `node scripts/gen-itr4-codes.mjs`,
run the tests (they build a return and validate it against every schema in this folder).
