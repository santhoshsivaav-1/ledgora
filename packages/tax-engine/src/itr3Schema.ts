// Checks an ITR-3 JSON against the Income Tax Department's published JSON schema (schemas/itr3/AY<year>.json). Server and
// tests only (its own entry, `@ledgora/tax-engine/itr3-schema`); the checking itself is in itrSchemaCheck.ts.

import ay202627 from '../schemas/itr3/AY2026-27.json' with { type: 'json' };
import { schemaChecker } from './itrSchemaCheck.ts';

/** Assessment years with a schema on file. */
export const ITR3_SCHEMAS: Record<string, unknown> = { '2026-27': ay202627 };

export const validateItr3Schema = schemaChecker('ITR-3', 'ITR3_SCHEMA', ITR3_SCHEMAS);
