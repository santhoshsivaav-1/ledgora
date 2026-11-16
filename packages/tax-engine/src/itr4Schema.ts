// Checks an ITR-4 JSON against the Income Tax Department's published JSON schema (schemas/itr4/AY<year>.json). Server and
// tests only (its own entry, `@ledgora/tax-engine/itr4-schema`); the checking itself is in itrSchemaCheck.ts.

import ay202627 from '../schemas/itr4/AY2026-27.json' with { type: 'json' };
import { schemaChecker } from './itrSchemaCheck.ts';

/** Assessment years with a schema on file. */
export const ITR4_SCHEMAS: Record<string, unknown> = { '2026-27': ay202627 };

export const validateItr4Schema = schemaChecker('ITR-4', 'ITR4_SCHEMA', ITR4_SCHEMAS);
