// Generates src/itr3Skeleton.json from the official ITR-3 schema: for every section of the return, an object holding every
// REQUIRED field (numbers as 0, choices as their first value, required lists empty). The builder (src/itr3Return.ts) fills
// values into it, so a field the schema demands can never be forgotten. Run after adding a new schema to schemas/itr3/.
//   node scripts/gen-itr3-skeleton.mjs [schemas/itr3/AY2026-27.json]
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('../schemas/itr3/AY2026-27.json', import.meta.url).pathname;
const schema = JSON.parse(readFileSync(file, 'utf8'));
const defs = schema.definitions;
const resolve = (n) => (n.$ref ? defs[n.$ref.split('/').pop()] : n);

function build(node) {
  const t = resolve(node);
  if (t.type === 'array') return [];
  if (t.properties) {
    const out = {};
    for (const k of t.required ?? []) out[k] = build(t.properties[k]);
    return out;
  }
  if (t.type === 'integer' || t.type === 'number') return t.minimum && t.minimum > 0 ? t.minimum : 0;
  if (t.enum) return t.enum[0];
  return undefined; // free text / pattern strings: the builder sets them, the schema check names any it missed
}

const itr3 = resolve(defs.ITR.properties.ITR3);
const out = {};
for (const k of Object.keys(itr3.properties)) out[k] = build(itr3.properties[k]);

// Optional parts the builder adds only when they apply, each with its required fields: "Section.child[].grandchild".
const EXTRAS = [
  'ScheduleOS.IncOthThanOwnRaceHorse',
  'ScheduleS.Salaries[]',
  'PartA_GEN2.NatOfBus.NatureOfBusiness[]',
  'ScheduleTDS2.TDSOthThanSalaryDtls[]',
  'ScheduleTDS1.TDSonSalary[]',
  'ScheduleTCS.TCS[]',
  'ScheduleIT.TaxPayment[]',
  'PartA_GEN2.AuditInfo.AuditReportDetails[]',
];
const extras = {};
for (const path of EXTRAS) {
  let node = itr3;
  for (const part of path.split('.')) {
    const isList = part.endsWith('[]');
    const key = isList ? part.slice(0, -2) : part;
    node = resolve(resolve(node).properties[key]);
    if (isList) node = resolve(node.items);
  }
  extras[path] = build(node);
}
writeFileSync(
  new URL('../src/itr3Skeleton.json', import.meta.url),
  JSON.stringify({ required: itr3.required, sections: out, extras }, null, 1) + '\n',
);
console.log(`${Object.keys(out).length} sections, ${itr3.required.length} required, ${EXTRAS.length} extras`);
