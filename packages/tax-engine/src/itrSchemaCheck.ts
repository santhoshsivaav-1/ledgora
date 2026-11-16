// Shared by the ITR-4 and ITR-3 schema checks (itr4Schema.ts, itr3Schema.ts). Server and tests only: the published schemas
// are 250 KB to 1 MB, so the web app never imports them.
//
// The published schemas come from XSDs, where a pattern matches the whole value; plain JSON Schema patterns match anywhere
// in it. So every pattern is anchored here, as the portal's own validator treats them.

import Ajv from 'ajv';
import draft04 from 'ajv/lib/refs/json-schema-draft-04.json' with { type: 'json' };
import type { FilingIssue } from './filing.ts';

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

/** A checker over the schemas on file (assessment year → schema); `code` tags each issue (ITR4_SCHEMA, ITR3_SCHEMA). */
export function schemaChecker(form: string, code: string, schemas: Record<string, unknown>) {
  const compiled = new Map<string, ReturnType<Ajv.Ajv['compile']>>();
  const validatorFor = (ay: string) => {
    let v = compiled.get(ay);
    if (!v) {
      const schema = schemas[ay];
      if (!schema) throw new Error(`No ${form} schema on file for assessment year ${ay}`);
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
  };
  /** Every way `json` breaks the schema of that assessment year (empty when it passes). */
  return (json: unknown, ay = '2026-27'): FilingIssue[] => {
    const validate = validatorFor(ay);
    if (validate(json)) return [];
    return (validate.errors ?? []).map((e, i) => {
      const path = (e.dataPath || '').replace(/^\./, '') || '(whole file)';
      const extra =
        e.keyword === 'additionalProperties'
          ? ` "${(e.params as { additionalProperty?: string }).additionalProperty}"`
          : '';
      return {
        id: `SCHEMA:${path}:${e.keyword}:${i}`,
        severity: 'error' as const,
        code,
        message: `${path}: ${e.message ?? 'invalid'}${extra}`,
        path,
      };
    });
  };
}
