// Checks an ITR-4 JSON against the Income Tax Department's published schema (schemas/itr4/AY<year>.json). Server and
// tests only: the schema is 250 KB, so the web app does not import this file (it is its own entry,
// `@ledgora/tax-engine/itr4-schema`).
//
// The published schemas come from XSDs, where a pattern matches the whole value; plain JSON Schema patterns match anywhere
// in it. So every pattern is anchored here, as the portal's own validator treats them.

import Ajv from 'ajv';
import draft04 from 'ajv/lib/refs/json-schema-draft-04.json' with { type: 'json' };
import ay202627 from '../schemas/itr4/AY2026-27.json' with { type: 'json' };
import type { FilingIssue } from './filing.ts';

/** Assessment years with a schema on file. */
export const ITR4_SCHEMAS: Record<string, unknown> = { '2026-27': ay202627 };

type Node = Record<string, unknown>;
/** A deep copy with every `pattern` anchored (^(?:…)$). */
function anchored(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(anchored);
  if (node && typeof node === 'object') {
    const out: Node = {};
    for (const [k, v] of Object.entries(node as Node))
      out[k] = k === 'pattern' && typeof v === 'string' ? `^(?:${v})$` : anchored(v);
    return out;
  }
  return node;
}

const compiled = new Map<string, ReturnType<Ajv.Ajv['compile']>>();
function validatorFor(ay: string) {
  let v = compiled.get(ay);
  if (!v) {
    const schema = ITR4_SCHEMAS[ay];
    if (!schema) throw new Error(`No ITR-4 schema on file for assessment year ${ay}`);
    const ajv = new Ajv({
      schemaId: 'auto',
      allErrors: true,
      meta: false,
      unknownFormats: 'ignore',
    });
    ajv.addMetaSchema(draft04);
    v = ajv.compile(anchored(schema) as object);
    compiled.set(ay, v);
  }
  return v;
}

/** Every way `json` breaks the schema of that assessment year (empty when it passes). */
export function validateItr4Schema(json: unknown, ay = '2026-27'): FilingIssue[] {
  const validate = validatorFor(ay);
  if (validate(json)) return [];
  return (validate.errors ?? []).map((e, i) => {
    const path = (e.dataPath || '').replace(/^\./, '') || '(whole file)';
    const extra =
      e.keyword === 'additionalProperties'
        ? ` "${(e.params as { additionalProperty?: string }).additionalProperty}"`
        : '';
    const message = `${e.message ?? 'invalid'}${extra}`;
    return {
      id: `SCHEMA:${path}:${e.keyword}:${i}`,
      severity: 'error' as const,
      code: 'ITR4_SCHEMA',
      message: `${path}: ${message}`,
      path,
    };
  });
}
