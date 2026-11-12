// P11-S2: the initial-JS budget. Sums the gzip size of every script index.html loads or modulepreloads (what the
// browser fetches before first paint) and fails above the budget. Run after `vite build`.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_KB = Number(process.env.INITIAL_JS_BUDGET_KB ?? 350);
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const files = [...new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]))];
let total = 0;
for (const f of files) {
  const kb = gzipSync(readFileSync(path.join(dist, f)), { level: 9 }).length / 1024;
  total += kb;
  console.log(`${kb.toFixed(1).padStart(7)} KB  ${f}`);
}
console.log(`${total.toFixed(1).padStart(7)} KB  initial JS (gzip), budget ${BUDGET_KB} KB`);
if (total > BUDGET_KB) {
  console.error(`Initial JS is ${(total - BUDGET_KB).toFixed(1)} KB over budget.`);
  process.exit(1);
}
